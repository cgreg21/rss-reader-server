import { Env, list } from './env';
import { checkFeeds, handlePush } from './push';
import { proxy } from './proxy';
import { handleSync } from './sync';

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Upstream, Accept, If-None-Match';

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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
    if (path === '/sync') return handleSync(request, env, cors, ctx);
    const pushed = await handlePush(request, env, cors, path);
    if (pushed) return pushed;
    return proxy(request, env, cors);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkFeeds(env));
  },
} satisfies ExportedHandler<Env>;
