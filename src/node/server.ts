import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

import { Env, sha256 } from '../env';
import { handleRequest } from '../handler';
import { checkFeeds } from '../push';
import { FileStore, RedisStore } from './store';

const port = Number(process.env.PORT ?? 8787);
const CHECK_INTERVAL_MS = 15 * 60_000;

const rooms = new Map<string, Set<WebSocket>>();
const broadcast = (room: string): void => {
  for (const socket of rooms.get(room) ?? []) if (socket.readyState === WebSocket.OPEN) socket.send('changed');
};

const env: Env = {
  DATA:
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? new RedisStore(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN)
      : new FileStore(process.env.DATA_FILE ?? 'data.json'),
  SYNC_ROOM: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async () => {
        broadcast(String(id));
        return new Response('ok');
      },
    }),
  },
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  ALLOWED_UPSTREAMS: process.env.ALLOWED_UPSTREAMS,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_JWK: process.env.VAPID_PRIVATE_JWK,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
};

const toRequest = (req: IncomingMessage): Request => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers };
  if (hasBody) {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, init);
};

const send = (response: Response, res: ServerResponse): void => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== 'content-length') headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.end();
};

const server = createServer((req, res) => {
  handleRequest(toRequest(req), env)
    .then((response) => send(response, res))
    .catch((error) => {
      console.error(error);
      res.writeHead(500).end('Internal error');
    });
});

const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token') ?? '';
  if (url.pathname !== '/sync/ws' || token.length < 16) {
    socket.destroy();
    return;
  }
  void sha256(token).then((hash) => {
    const room = `sync:${hash}`;
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const members = rooms.get(room) ?? new Set<WebSocket>();
      members.add(ws);
      rooms.set(room, members);
      ws.on('message', (data) => {
        if (data.toString() === 'ping') ws.send('pong');
      });
      ws.on('close', () => {
        members.delete(ws);
        if (members.size === 0) rooms.delete(room);
      });
    });
  });
});

setInterval(() => void checkFeeds(env).catch((error) => console.error('checkFeeds', error)), CHECK_INTERVAL_MS);

server.listen(port, () => console.log(`rss-reader-server listening on :${port}`));
