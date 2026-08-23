/**
 * Helper to route requests through the server-side proxy for URLs that don't support CORS.
 * The Vercel AI Gateway doesn't allow direct browser requests due to CORS restrictions.
 */

const CORS_BLOCKED_HOSTS = [
  'ai-gateway.vercel.sh',
  'api.swiftrouter.com',
];

/**
 * Check if a URL needs to be proxied through our server-side endpoint
 */
export const needsServerProxy = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return CORS_BLOCKED_HOSTS.some(host => parsed.host.includes(host));
  } catch {
    return false;
  }
};

/**
 * OpenRouter only reports usage (including prompt-cache read/write breakdown)
 * when the request opts in via `usage: { include: true }`.
 */
export const wantsUsageAccounting = (url: string): boolean => url.includes('openrouter.ai');

/**
 * `stream_options: { include_usage: true }` is standard OpenAI, but a strict proxy
 * rejects request fields it doesn't know — and completion requests are deliberately
 * single-attempt, so such a rejection is not a bad turn, it is every turn on that
 * host, permanently, with no recovery path. The field is therefore opt-in per host.
 *
 * Add a host here once it is confirmed to accept it. Omitting it costs streamed-usage
 * telemetry (the cache-hit numbers that widen the history window) and nothing else;
 * sending it blind costs the ability to talk to the provider at all.
 */
export const wantsStreamUsageOptions = (url: string): boolean => wantsUsageAccounting(url);

/** OpenRouter uses this key to keep a chat on the provider that owns its warm cache. */
export const openRouterSessionFields = (
  url: string,
  sessionId?: string
): { session_id?: string } => {
  if (!wantsUsageAccounting(url)) return {};
  const normalized = (sessionId ?? '').trim().slice(0, 256);
  return normalized ? { session_id: normalized } : {};
};

/**
 * Get the proxy URL for the local API endpoint
 */
export const getProxyEndpoint = (): string => {
  // In production, this will be the same origin
  // In development, Vite proxies /api requests
  return '/api/proxy/chat';
};

/**
 * Performs a fetch, routing through the server-side proxy if needed for CORS-blocked URLs
 */
export const proxyAwareFetch = async (
  url: string,
  init: RequestInit
): Promise<Response> => {
  if (needsServerProxy(url)) {
    // Route through our server-side proxy
    const proxyEndpoint = getProxyEndpoint();
    const headers = new Headers(init.headers);
    
    // Move the target URL to a header
    headers.set('X-Target-URL', url);
    
    return fetch(proxyEndpoint, {
      ...init,
      headers,
    });
  }
  
  // Direct fetch for URLs that support CORS (like OpenRouter)
  return fetch(url, init);
};

/**
 * Turns a failed upstream HTTP response into a concise, human-readable message.
 * Gateways (Vercel, OpenRouter, OpenAI) return JSON like {"error":{"message":...}}
 * — we surface that message instead of a generic "API error" or a wall of raw JSON,
 * so provider rejections (rate limits, blocked providers, bad keys) are actionable.
 */
export const formatUpstreamError = (status: number, statusText: string, errorBody: string): string => {
  const body = (errorBody ?? '').trim();
  if (body) {
    try {
      const json = JSON.parse(body);
      const msg =
        (typeof json?.error === 'string' ? json.error : json?.error?.message)
        ?? json?.message
        ?? json?.detail;
      if (typeof msg === 'string' && msg.trim()) {
        return `${msg.trim()} (HTTP ${status})`;
      }
    } catch {
      // Not JSON — fall through to the raw body.
    }
    // Plain-text body: show it directly when it's short enough to be a real message.
    if (body.length <= 400) return `${body} (HTTP ${status})`;
  }
  return `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
};

/**
 * Exactly one physical completion request. HTTP and network failures are returned
 * unchanged so retry/regenerate remains an explicit user action.
 */
export const fetchChatCompletion = async (
    url: string,
    init: RequestInit
): Promise<Response> => proxyAwareFetch(url, init);
