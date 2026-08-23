# Security

## Reporting

Report vulnerabilities privately rather than as a public issue: use this
repository's **Security** tab → *Report a vulnerability*, which opens a private
advisory only the maintainers can see.

## What the threat model actually is

RWE is a client-side app: chats, characters, and API keys live in the browser's
`localStorage` and are sent only to the provider you configured. There is no
backend holding user data, and no account system. That removes most of the usual
surface — but leaves two things worth attention.

### The CORS proxy

`api/proxy/chat.ts` is a serverless function that forwards requests to providers
that don't send CORS headers. It forwards only to a hardcoded allowlist of known
gateways, extended per deployment through `PROXY_ALLOWED_HOSTS`.

**If you self-host, keep that allowlist tight.** A proxy that forwards anywhere
is an open relay: anyone who finds your deployment can use it to reach arbitrary
hosts, with your infrastructure as the origin. Add only hosts you control or
intend to call.

Anything that widens what the proxy will forward to — a wildcard, a
user-supplied host, a redirect that escapes the check — is a security bug worth
reporting.

### Keys in the bundle

Keys set through `VITE_*` variables are compiled into the JavaScript bundle and
readable by anyone who loads the page. That is inherent to a client-side app, not
a bug — but it means a public deployment with a key baked in is a key you have
published. Prefer letting each user enter their own under API Settings.

## Scope

Out of scope: what a model generates, provider-side issues, and content
concerns. RWE is an uncensored roleplay frontend by design — see the README.
