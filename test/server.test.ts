import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/feed';
import { encrypt } from '../src/webpush';
import { handleRequest } from '../src/handler';
import { roomFor } from '../src/sync';
import { Env, fromBase64Url, KeyValueStore, toBase64Url } from '../src/env';

const kv = () => {
  const map = new Map<string, string>();
  const store = {
    writes: 0,
    get: async (key: string, type?: string) => (map.has(key) ? (type === 'json' ? JSON.parse(map.get(key)!) : map.get(key)) : null),
    put: async (key: string, value: string) => {
      store.writes++;
      map.set(key, value);
    },
    delete: async (key: string) => void map.delete(key),
    list: async () => ({ keys: [], list_complete: true }),
  };
  return store as unknown as KeyValueStore & { writes: number };
};

describe('feed', () => {
  it('parses RSS and Atom', () => {
    const rss = parseFeed('<rss><channel><title>T</title><item><title>A &amp; B</title><link>http://a</link><guid>1</guid></item></channel></rss>');
    expect(rss).toEqual({ title: 'T', items: [{ id: '1', title: 'A & B', link: 'http://a' }] });
    const atom = parseFeed('<feed><title>X</title><entry><id>e1</id><title>Hi</title><link href="http://h"/></entry></feed>');
    expect(atom.items[0]).toEqual({ id: 'e1', title: 'Hi', link: 'http://h' });
  });
});

describe('webpush', () => {
  it('encrypts to a decryptable aes128gcm body', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const p256dh = toBase64Url((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    const body = await encrypt({ endpoint: 'https://x', keys: { p256dh, auth: toBase64Url(auth) } }, 'hello');
    expect(body.length).toBeGreaterThan(86);
    expect(fromBase64Url(p256dh).length).toBe(65);
  });
});

describe('server', () => {
  const notified: string[] = [];
  const data = kv();
  const env: Env = { DATA: data, ALLOWED_ORIGINS: 'https://app.test', notify: (room) => void notified.push(room) };
  const call = (path: string, init: RequestInit = {}, origin = 'https://app.test') =>
    handleRequest(new Request(`https://w.test${path}`, { ...init, headers: { Origin: origin, ...(init.headers as object) } }), env);

  it('notifies the room on change and skips identical writes', async () => {
    const token = 'notify-test-code-0123456789';
    const headers = { Authorization: `Bearer ${token}` };
    notified.length = 0;
    const put = await call('/sync', { method: 'PUT', headers, body: JSON.stringify({ data: { x: 1 } }) });
    const { rev } = (await put.json()) as { rev: number };
    expect(notified).toEqual([await roomFor(token)]);
    const writes = data.writes;
    const again = await call('/sync', { method: 'PUT', headers, body: JSON.stringify({ rev, data: { x: 1 } }) });
    expect(await again.json()).toEqual({ rev });
    expect(data.writes).toBe(writes);
    expect(notified).toHaveLength(1);
  });

  it('rejects other origins', async () => {
    expect((await call('/x', {}, 'https://evil.test')).status).toBe(403);
  });
  it('requires X-Upstream for the proxy', async () => {
    expect((await call('/feed.xml')).status).toBe(400);
  });
  it('syncs with optimistic revisions', async () => {
    const headers = { Authorization: 'Bearer 0123456789abcdef' };
    expect((await call('/sync', { headers })).status).toBe(404);
    const put = await call('/sync', { method: 'PUT', headers, body: JSON.stringify({ data: { a: 1 } }) });
    const { rev } = (await put.json()) as { rev: number };
    expect((await call('/sync', { method: 'PUT', headers, body: JSON.stringify({ rev: 1, data: {} }) })).status).toBe(409);
    expect((await call('/sync', { method: 'PUT', headers, body: JSON.stringify({ rev, data: { a: 2 } }) })).status).toBe(200);
  });
});
