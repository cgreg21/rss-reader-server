import { Env, sha256 } from './env';

const MAX_BYTES = 2 * 1024 * 1024;

export interface SyncDocument {
  /** Server-assigned revision (ms since epoch) of the stored document. */
  rev: number;
  /** Opaque client data: feeds, categories, read and favourite article ids. */
  data: unknown;
}

const json = (cors: Headers, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: new Headers({ ...Object.fromEntries(cors), 'Content-Type': 'application/json' }) });

/**
 * GET /sync            -> { rev, data } (404 when nothing is stored)
 * PUT /sync {rev,data} -> stores; 409 with the current document when `rev` is not the stored one
 * The bearer token is the user's sync code: only its SHA-256 is used as the KV key.
 */
export async function handleSync(request: Request, env: Env, cors: Headers): Promise<Response> {
  const token = /^Bearer (.{16,200})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json(cors, 401, { error: 'Bearer sync code (16+ characters) required' });
  const id = `sync:${await sha256(token)}`;
  const current = await env.DATA.get<SyncDocument>(id, 'json');

  if (request.method === 'GET') return current ? json(cors, 200, current) : json(cors, 404, { error: 'Nothing stored' });
  if (request.method === 'DELETE') {
    await env.DATA.delete(id);
    return json(cors, 200, { ok: true });
  }
  if (request.method !== 'PUT') return json(cors, 405, { error: 'Method not allowed' });

  const text = await request.text();
  if (text.length > MAX_BYTES) return json(cors, 413, { error: 'Document too large' });
  let body: { rev?: number; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json(cors, 400, { error: 'Invalid JSON' });
  }
  if (body.data === undefined) return json(cors, 400, { error: 'Missing data' });
  if (current && body.rev !== current.rev) return json(cors, 409, current);
  const next: SyncDocument = { rev: Math.max(Date.now(), (current?.rev ?? 0) + 1), data: body.data };
  await env.DATA.put(id, JSON.stringify(next));
  return json(cors, 200, { rev: next.rev });
}
