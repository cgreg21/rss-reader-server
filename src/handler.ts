import { Env, list } from './env';
import { handlePush } from './push';
import { proxy } from './proxy';
import { handleSocket, handleSync } from './sync';

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Upstream, Accept, If-None-Match';

/** Platform-neutral request handler, shared by the Cloudflare Worker and the Node server. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowedOrigins = list(env.ALLOWED_ORIGINS);
  const allowAll = allowedOrigins.length === 0 || allowedOrigins.includes('*');
  if (!allowAll && (!origin || !allowedOrigins.includes(origin))) return new Response('Origin not allowed', { status: 403 });

  const cors = new Headers({
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const path = new URL(request.url).pathname;
  if (path === '/health') return new Response('ok', { headers: cors });
  if (path === '/sync/ws') return handleSocket(request, env);
  if (path === '/sync') return handleSync(request, env, cors);
  const pushed = await handlePush(request, env, cors, path);
  if (pushed) return pushed;
  return proxy(request, env, cors);
}
