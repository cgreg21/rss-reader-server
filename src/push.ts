import { Env, sha256 } from './env';
import { parseFeed } from './feed';
import { PushSubscriptionJson, sendPush, VapidConfig } from './webpush';

interface Record {
  subscription: PushSubscriptionJson;
  feeds: string[];
  seen: { [url: string]: string[] };
}

const MAX_FEEDS_PER_RUN = 40;
const MAX_FEEDS_PER_SUB = 200;
const MAX_SEEN = 300;
const key = async (endpoint: string) => `sub:${await sha256(endpoint)}`;
const isHttps = (value: unknown): value is string => {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const json = (cors: Headers, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: new Headers({ ...Object.fromEntries(cors), 'Content-Type': 'application/json' }) });

export async function handlePush(request: Request, env: Env, cors: Headers, path: string): Promise<Response | null> {
  if (path === '/vapid-key' && request.method === 'GET') {
    return env.VAPID_PUBLIC_KEY ? json(cors, 200, { publicKey: env.VAPID_PUBLIC_KEY }) : json(cors, 503, { error: 'VAPID not configured' });
  }
  if (path !== '/subscribe' && path !== '/unsubscribe') return null;
  if (request.method !== 'POST') return json(cors, 405, { error: 'Method not allowed' });
  const body = (await request.json().catch(() => null)) as {
    subscription?: PushSubscriptionJson; endpoint?: string; feeds?: unknown[];
  } | null;
  if (!body) return json(cors, 400, { error: 'Invalid JSON' });

  if (path === '/unsubscribe') {
    if (!isHttps(body.endpoint)) return json(cors, 400, { error: 'Invalid endpoint' });
    await env.DATA.delete(await key(body.endpoint));
    return json(cors, 200, { ok: true });
  }
  const sub = body.subscription;
  if (!sub || !isHttps(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return json(cors, 400, { error: 'Invalid subscription' });
  const feeds = [...new Set((body.feeds ?? []).filter(isHttps))].slice(0, MAX_FEEDS_PER_SUB);
  const id = await key(sub.endpoint);
  const previous = await env.DATA.get<Record>(id, 'json');
  const seen: Record['seen'] = {};
  for (const url of feeds) if (previous?.seen[url]) seen[url] = previous.seen[url];
  const record: Record = { subscription: { endpoint: sub.endpoint, keys: sub.keys }, feeds, seen };
  await env.DATA.put(id, JSON.stringify(record));
  return json(cors, 200, { ok: true, feeds: feeds.length });
}

/** Cron: fetch the subscribed feeds, push the new items. The first sight of a feed only records its items. */
export async function checkFeeds(env: Env): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return;
  const vapid: VapidConfig = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK, subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com' };

  const records = new Map<string, Record>();
  let cursor: string | undefined;
  do {
    const page = await env.DATA.list({ prefix: 'sub:', cursor });
    for (const entry of page.keys) {
      const record = await env.DATA.get<Record>(entry.name, 'json');
      if (record) records.set(entry.name, record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const urls = [...new Set([...records.values()].flatMap((record) => record.feeds))].slice(0, MAX_FEEDS_PER_RUN);
  const fetched = new Map<string, { title: string; items: { id: string; title: string; link: string }[] }>();
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'rss-reader-server' }, redirect: 'follow' });
      if (response.ok) fetched.set(url, parseFeed(await response.text()));
    } catch { /* feed unreachable: retry on the next run */ }
  }));

  for (const [id, record] of records) {
    let changed = false;
    let dead = false;
    for (const url of record.feeds) {
      const feed = fetched.get(url);
      if (!feed || feed.items.length === 0) continue;
      const known = record.seen[url];
      const ids = feed.items.map((item) => item.id);
      if (known) {
        const fresh = feed.items.filter((item) => !known.includes(item.id));
        if (fresh.length > 0 && !dead) {
          const first = fresh[0];
          const status = await sendPush(record.subscription, {
            notification: {
              title: feed.title || 'RSS Reader',
              body: fresh.length > 1 ? `${first.title} (+${fresh.length - 1})` : first.title,
              icon: 'icons/icon-192x192.png',
              tag: url,
              data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: './' } } },
            },
          }, vapid).catch(() => 0);
          if (status === 404 || status === 410) dead = true;
        }
      }
      record.seen[url] = [...new Set([...ids, ...(known ?? [])])].slice(0, MAX_SEEN);
      changed = true;
    }
    if (dead) await env.DATA.delete(id);
    else if (changed) await env.DATA.put(id, JSON.stringify(record));
  }
}
