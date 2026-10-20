# rss-reader-server

Cloudflare Worker (TypeScript) for [rss-reader](https://github.com/cgreg21/rss-reader). One worker, three features:

| Feature | Endpoint | Purpose |
|---|---|---|
| CORS proxy | any other path, header `X-Upstream: https://host` | Fetch feeds that send no CORS headers |
| Web Push | `GET /vapid-key`, `POST /subscribe`, `POST /unsubscribe`, cron every 15 min | Notify new articles even when the app is closed |
| Sync | `GET/PUT/DELETE /sync` (Bearer sync code) | Share feeds, categories, read/favourite state between devices |

## Prerequisites

Node 22+, a free Cloudflare account, this repo on GitHub.

## Configuration

1. `npm ci`
2. Log in: `npx wrangler login`
3. Create the KV namespace and paste its id into `wrangler.toml` (`[[kv_namespaces]] id`):
   `npx wrangler kv namespace create DATA`
4. Generate VAPID keys: `npm run vapid`
   - put `VAPID_PUBLIC_KEY` in `wrangler.toml` `[vars]`
   - store the private key: `npx wrangler secret put VAPID_PRIVATE_JWK` (paste the JSON)
5. Edit `[vars]` in `wrangler.toml`:
   - `ALLOWED_ORIGINS`: app origin(s), e.g. `https://cgreg21.github.io` (empty or `*` = any)
   - `ALLOWED_UPSTREAMS`: optional allow-list of feed origins for the proxy
   - `VAPID_SUBJECT`: `mailto:you@example.com`

Local run: copy secrets into `.dev.vars` (git-ignored), then `npm run dev`.

## Deployment

Manual: `npm run deploy`. The worker URL is `https://rss-reader-server.<account>.workers.dev`.

GitHub Actions (`.github/workflows`):
- `ci.yml`: typecheck + tests on every push/PR.
- `deploy.yml`: tests then `wrangler deploy` on push to `master` or manually.

Repository secrets (Settings > Secrets and variables > Actions):
- `CLOUDFLARE_API_TOKEN`: token created from the "Edit Cloudflare Workers" template (add Workers KV Storage: Edit)
- `CLOUDFLARE_ACCOUNT_ID`: shown in the Cloudflare dashboard
- `VAPID_PRIVATE_JWK`: the private JWK JSON from step 4

## App settings

In rss-reader > Feeds page: enter the worker URL as proxy URL (enable the proxy) and as the notifications server URL, then enable notifications. On iOS (16.4+) the app must be installed on the Home Screen.

## API details

- Proxy: request `https://<worker><path><query>` with `X-Upstream: https://feeds.example.com`. Cookies are never forwarded.
- `POST /subscribe` `{ subscription, feeds: [urls] }`; `POST /unsubscribe` `{ endpoint }`.
- `/sync`: `Authorization: Bearer <sync code, 16+ chars>`. `GET` returns `{ rev, data }`; `PUT { rev, data }` returns `{ rev }` or `409` with the current document when `rev` is stale (first write: omit `rev`). Only the SHA-256 of the code is used as KV key; keep the code secret. Max 2 MB.

## Limits

- Cron checks at most 40 distinct feeds per run (subrequest limit); first sight of a feed only records its items.
- Dead subscriptions (404/410) are removed automatically.
- Feed parsing is regex-based (no DOMParser in Workers).
- Sync is last-writer-wins on the whole document; the client must merge on 409.
