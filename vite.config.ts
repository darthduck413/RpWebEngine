import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        hmr: false,
        proxy: {
          // Proxy /api requests to handle them locally in dev
          // In production, Vercel automatically routes /api to serverless functions
        }
      },
      plugins: [
        react(),
        // Dev middleware to handle API routes locally
        {
          name: 'api-proxy-middleware',
          configureServer(server) {
            server.middlewares.use('/api/proxy/chat', async (req, res) => {
              if (req.method === 'OPTIONS') {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Target-URL');
                res.statusCode = 204;
                res.end();
                return;
              }

              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Method not allowed' }));
                return;
              }

              const targetUrl = req.headers['x-target-url'] as string;
              const authorization = req.headers['authorization'] as string;

              if (!targetUrl) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing X-Target-URL header' }));
                return;
              }

              // Collect request body
              let body = '';
              for await (const chunk of req) {
                body += chunk;
              }

              try {
                const response = await fetch(targetUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authorization ? { 'Authorization': authorization } : {}),
                  },
                  body,
                });

                res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.statusCode = response.status;

                // Stream the upstream body through (mirrors api/proxy/chat.ts) so
                // SSE chunks reach the client as they arrive instead of being
                // buffered until the generation finishes.
                if (response.body) {
                  const reader = response.body.getReader();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                  }
                }
                res.end();
              } catch (error) {
                console.error('Proxy error:', error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ error: 'Proxy request failed' }));
              }
            });
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
