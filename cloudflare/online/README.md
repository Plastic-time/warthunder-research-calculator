# K13shot online counter

Independent Cloudflare Worker for the GitHub Pages calculator. This directory does not deploy the calculator, modify vehicle data, or package the desktop app. The browser client is in `docs/online-count.js`, separate from the planning code; see [the Chinese maintenance guide](../../doc/online-counter.md).

## Dashboard setup

In Workers & Pages, create a Worker from `Plastic-time/warthunder-research-calculator`:

| Setting | Value |
| --- | --- |
| Project / Worker name | `k13shot-online` |
| Production branch | `main` |
| Root directory / Path | `cloudflare/online` |
| Build command | Leave empty |
| Deploy command | `npx wrangler deploy` |
| Non-production branch builds | Disabled |
| Protect with Cloudflare Access | Disabled |
| API token | Use the token Cloudflare automatically creates for Workers Builds |

Do not paste an account token into the repository, this README, the browser application, or a chat. No runtime secret is needed for this public counter. The checked-in configuration creates a SQLite-backed Durable Object automatically using `new_sqlite_classes`; do not manually create a KV namespace or change this to `new_classes`.

Keep the account on Workers Free. Do not enable a paid subscription for this feature. Cloudflare supplies the `workers.dev` address; no domain purchase is needed. The root returning 404 is expected. Visit `/health` to check the deployed service identity and timing configuration. This health route does not exercise database storage.

After deployment, share only the public HTTPS Worker URL. Verify a real `/heartbeat` request from the calculator origin before enabling the website badge. Do not invent a Worker subdomain. Keep the existing GitHub Pages URL.

## API and counting rules

- `POST /heartbeat`: a JSON body with exactly one field, `visitorId`, containing a random lowercase UUID v4.
- Send it as `Content-Type: text/plain;charset=UTF-8`, with `credentials: omit`, so browsers can make a simple cross-origin request without an OPTIONS preflight on every heartbeat. Do not put identifiers in URLs.
- The allowed browser origin is exactly `https://plastic-time.github.io`, configured in `wrangler.jsonc`. Origins do not contain `/warthunder-research-calculator/`; CORS cannot isolate paths on the same origin.
- The response is `{ "online": 1, "intervalSeconds": 30, "timeoutSeconds": 90 }`. It never returns other visitors' identifiers or timestamps. Counts are estimates of browsers, not authenticated humans.
- All requests route to one named Durable Object. SQL transactions serialize updates, and SQLite preserves state across Worker eviction/restart. Plain Worker memory is not the source of truth.
- Records last seen 90 seconds ago are excluded before every count; the next accepted write also removes them from the stored snapshot. No background alarm or cron job is required. If nobody visits again, expired random identifiers remain in that bounded snapshot until a later write or manual removal; expiry is not a promise of physical data deletion after 90 seconds.
- Duplicate IDs do not add to the count. Updates for the same ID within 15 seconds do not write again. There is no explicit leave endpoint: closing one of several tabs must not remove another active tab.
- The browser client shares a random identifier across tabs, coordinates requests through Web Locks (with a best-effort local-storage lease fallback), reports about every 30 seconds, pauses when all tabs are hidden, and resumes when visible. An ID is replaced on the next report after 30 minutes of inactivity; browser storage is not automatically erased on tab closure. Blocking local storage disables the counter instead of generating one ID per tab. Private browsing and different browser profiles count separately.

## Limits and failure handling

- Maximum body: 256 bytes, including streaming bodies. Unknown fields, invalid IDs, foreign/missing origins and unsupported methods are rejected before contacting the Durable Object.
- Platform rate limit bindings allow 120 heartbeats/minute per network address and 6/minute per visitor ID at each Cloudflare location. Network addresses are used only as transient platform rate-limit keys, not persisted in the presence table. Shared networks can hit the limit; distributed or spoofed visitors can still affect the count. CORS is not authentication and does not stop non-browser abuse.
- Maximum active IDs: 512. A single SQLite row contains the bounded snapshot and write budget. A normal accepted heartbeat selects one row and updates one row without secondary indexes; repeat requests inside the write interval are read-only. Pruning is included in that same write rather than issuing separate deletes per visitor.
- The counter stops accepting new writes at 80,000/day (UTC), leaving nominal headroom below the published free 100,000 writes/day. This is an application guard, not a cap on total Cloudflare account requests, reads, duration, or spending. Other Workers and abuse can consume those quotas independently. Check actual platform usage after deployment.
- At a 30-second interval, 80,000 regular heartbeats represent about 667 visitor-hours before initial visits and retries. Treat this as an estimate, not a capacity guarantee.
- `429` means throttled; `503` means storage unavailable, capacity reached, or the daily write budget exhausted. Responses include `Retry-After`, exposed through CORS. The browser honors this delay, backs off after network errors, shows unavailable instead of a false zero, and keeps the calculator usable.
- Worker responses are not cached. Application logging is disabled by default; code does not log request bodies or identifiers. Cloudflare still processes connection metadata and may retain platform diagnostics. Do not promise that no infrastructure ever sees an IP address.

## Quotas and maintenance

Official limits checked on 2026-09-21:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): 100,000 requests/day on Free; 10 ms CPU per invocation.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): Free supports SQLite-backed objects, with 100,000 requests/day, 13,000 GB-s/day duration, 5 million rows read/day, 100,000 rows written/day, and 5 GB storage. Daily limits reset at 00:00 UTC. Operations fail when a free limit is exceeded.
- A Worker heartbeat and its Durable Object call each consume their respective request allowance. A preflight is another Worker request. Storage is separately metered. The 80,000 guard does not include manual edits or schema operations.
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/): the root directory isolates the counter; Cloudflare can generate its deployment token. Builds have separate usage limits. After the first deployment, restrict build watch paths to `cloudflare/online/**` in the build settings, and keep non-production builds off.

In Workers & Pages, open `k13shot-online` and check its metrics for requests, CPU, and errors. Check account Workers usage and the Durable Objects storage/usage views as well; the exact dashboard labels may vary. For a failure, first check the build/deployment status, then `/health`, then the browser Network response for `/heartbeat`. A health success with a heartbeat 503 does not prove database health. Do not post full request logs, authorization headers, or tokens when asking for help.

For temporary diagnostics, enable logs only when necessary and do not add visitor IDs or IP addresses to application messages. To stop counting, disable the frontend integration first; this must not disable the calculator. Retain the `v1` migration during updates, and do not rename the class or object without planning how existing state is handled.

## Local checks

### Development dependency security

The scoped npm override pins Miniflare's `sharp` dependency to 0.35.5 to address
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
Miniflare and Wrangler versions are unchanged. Remove the override only after
the upstream dependency includes the fix and the checks below pass. This tooling
dependency is not part of the deployed counter code or the Windows calculator package.

Use Node.js 24 with npm, then run these commands from this directory:

```sh
npm ci --ignore-scripts
npm audit --audit-level=low
npm test
npm run check:deploy
npm run test:runtime
```

The runtime test uses the official local Workers runtime with real SQLite Durable Objects and checks concurrent heartbeats, duplicate IDs, object eviction, persistence across restarts, and expiration. It does not deploy to an account or prove that a particular visitor network can reach `workers.dev`. In particular, test from the audience's actual networks before enabling the public badge.
