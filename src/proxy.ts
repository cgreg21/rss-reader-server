import { Env, list } from './env';

const UPSTREAM_HEADER = 'x-upstream';
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const BLOCKED_REQUEST = new Set([
  'host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade',
  'te', 'trailer', 'expect', 'forwarded', 'via', 'x-real-ip', UPSTREAM_HEADER,
]);
const BLOCKED_RESPONSE = new Set(['set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'transfer-encoding', 'content-encoding']);

const blockedRequestHeader = (name: string) =>
  BLOCKED_REQUEST.has(name) || name.startsWith('cf-') || name.startsWith('x-forwarded-') || name.startsWith('sec-');

/** Relays the request to the https origin named by `X-Upstream`, keeping path and query. */
export async function proxy(request: Request, env: Env, cors: Headers): Promise<Response> {
  const text = (status: number, message: string) => new Response(message, { status, headers: cors });
  const value = request.headers.get(UPSTREAM_HEADER);
  if (!value) return text(400, 'Missing X-Upstream header');
  let upstream: URL;
  try {
    upstream = new URL(value);
  } catch {
    return text(400, 'Invalid upstream');
  }
  if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    return text(400, 'Upstream must be an https origin without path');
  }
  const allowed = list(env.ALLOWED_UPSTREAMS);
  if (allowed.length > 0 && !allowed.includes(upstream.origin)) return text(403, 'Upstream not allowed');
  if (!METHODS.includes(request.method)) return text(405, 'Method not allowed');

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, upstream);
  const headers = new Headers();
  for (const [name, val] of request.headers) if (!blockedRequestHeader(name)) headers.set(name, val);
  if (!headers.has('user-agent')) headers.set('User-Agent', 'rss-reader-server');

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
  } catch {
    return text(502, 'Upstream unreachable');
  }

  const out = new Headers(cors);
  const exposed: string[] = [];
  for (const [name, val] of response.headers) {
    if (BLOCKED_RESPONSE.has(name)) continue;
    out.set(name, val);
    exposed.push(name);
  }
  out.set('Access-Control-Expose-Headers', exposed.join(', '));
  const location = out.get('location');
  if (location !== null) {
    const next = new URL(location, target);
    if (next.origin === upstream.origin) out.set('location', next.pathname + next.search);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
}
