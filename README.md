# rss-reader-server

Node.js server (TypeScript, run with `tsx`) for [rss-reader](https://github.com/cgreg21/rss-reader), hosted on Render. One server, three features:

| Feature | Endpoint | Purpose |
|---|---|---|
| CORS proxy | any other path, header `X-Upstream: https://host` | Fetch feeds that send no CORS headers |
| Web Push | `GET /vapid-key`, `POST /subscribe`, `POST /unsubscribe`, feed check every 15 min | Notify new articles even when the app is closed |
| Sync | `GET/PUT/DELETE /sync` (bearer sync code), WebSocket `/sync/ws?token=<code>` | Share feeds, categories, read/favourite state between devices; sockets receive `changed` after each update |
| Health | `GET /health` | Liveness check / keep-alive ping |

## Prerequisites

Node 22+, a free Render account, this repo on GitHub. Optional: a free Upstash Redis database for persistent storage.

## Configuration

1. `npm ci`
2. Generate VAPID keys: `npm run vapid` (prints `VAPID_PUBLIC_KEY` and the private JWK JSON).
3. Environment variables:
   - `PORT`: listening port (default `8787`; set by Render).
   - `ALLOWED_ORIGINS`: app origin(s), e.g. `https://cgreg21.github.io` (empty or `*` = any).
   - `ALLOWED_UPSTREAMS`: optional allow-list of feed origins for the proxy.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK` (secret, the JSON), `VAPID_SUBJECT` (`mailto:you@example.com`).
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`: persistent storage in Upstash Redis.
   - `DATA_FILE`: local JSON file used when Redis is not configured (default `data.json`). On Render's free tier it is lost at every restart.

Local run: `npm run dev` (watch mode) or `npm start`.

## Deployment (Render)

1. Render > New > Blueprint, pick this repo (`render.yaml`), or create a Node Web Service (build `npm ci`, start `npm start`).
2. Set the environment variables above (`VAPID_PRIVATE_JWK` and the Upstash token as secrets).
3. Render redeploys automatically on every push to the default branch.
4. The free service sleeps after ~15 min without requests (WebSockets and the feed check stop): ping `/health` every 10 min (UptimeRobot, cron-job.org).

GitHub Actions: `ci.yml` runs typecheck + tests on every push/PR.

## App settings

In rss-reader > Feeds page: enter the Render URL as proxy URL (enable the proxy) and as the notifications server URL, then enable notifications. On iOS (16.4+) the app must be installed on the Home Screen.

## API details

- Proxy: request `https://<server><path><query>` with `X-Upstream: https://feeds.example.com`. Cookies are never forwarded.
- `POST /subscribe` `{ subscription, feeds: [urls] }`; `POST /unsubscribe` `{ endpoint }`.
- `/sync`: `Authorization: Bearer <sync code, 16+ chars>`. `GET` returns `{ rev, data }`; `PUT { rev, data }` returns `{ rev }` or `409` with the current document when `rev` is stale (first write: omit `rev`). Identical data is not rewritten. Only the SHA-256 of the code is used as storage key; keep the code secret. Max 2 MB.

## Limits

- Each check handles at most 40 distinct feeds; first sight of a feed only records its items.
- Dead subscriptions (404/410) are removed automatically.
- Feed parsing is regex-based.
- Sync is last-writer-wins on the whole document; the client must merge on 409.
