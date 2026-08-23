// Node runtime (not edge): edge functions are killed if the upstream doesn't
// send the first byte within 25s, and SwiftRouter holds the entire response
// until prompt processing finishes — large RP prompts routinely exceed that.
// Node functions only enforce total maxDuration (see vercel.json). The Node
// runtime requires named HTTP-method exports for the web handler signature.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-URL',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const targetUrl = request.headers.get('X-Target-URL');
    const authorization = request.headers.get('Authorization');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing X-Target-URL header' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only proxy to known AI gateways — an open relay here would let anyone use
    // the deployment to reach arbitrary hosts. Self-hosted or tunnelled
    // inference servers are opted in per deployment through PROXY_ALLOWED_HOSTS,
    // a comma-separated list of hostnames.
    const allowedHosts = [
      'ai-gateway.vercel.sh',
      'openrouter.ai',
      'api.openai.com',
      'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'api.swiftrouter.com',
      ...(process.env.PROXY_ALLOWED_HOSTS ?? '')
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean),
    ];

    const url = new URL(targetUrl);
    const isAllowedHost = allowedHosts.some(host => url.host === host || url.host.endsWith(`.${host}`));
    if (!isAllowedHost) {
      return new Response(JSON.stringify({ error: 'Target URL not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.text();

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { 'Authorization': authorization } : {}),
      },
      body,
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy request failed' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
