# Same-origin balance proxy: investigation and deployment

The original CORS investigation below is historical. For current endpoint configuration, production error classification, and server-only free-provider secrets, see [production-rpc.md](production-rpc.md).

## Finding and scope of the fix

Chrome's reported `Access-Control-Allow-Origin: backend_traffic` is invalid. That header must identify an allowed serialized origin (or use the permitted wildcard); `backend_traffic` is not a web origin. A `file://` document normally sends `Origin: null`, which can itself be rejected by an RPC provider, but HTTP hosting alone cannot repair an invalid allow-origin response header. We cannot determine from the error alone whether the header originates at the Solana provider, its load balancer, or another intermediary. The exact OPTIONS response/headers on the user's network, compared with another network, would be needed to attribute that layer. No attribution is invented here.

A browser cannot repair remote CORS headers. `mode: no-cors` returns an opaque unreadable response and cannot produce a verified balance. Disabling Chrome security, browser extensions, and random public CORS proxies are not solutions for this product.

The implemented path is:

```
Browser -- same-origin POST /api/balance --> Worker
Worker -- fixed getBalance / confirmed --> Solana mainnet RPC
```

The Worker consumes and validates the upstream response server-to-server. It never copies upstream CORS headers (including `backend_traffic`) back to the browser. The browser never contacts the RPC host, and no cross-origin browser preflight is needed. This fixes the reported browser CORS dependency, while preserving explicit failures if the server cannot reach/read a valid mainnet response. It does not bypass network restrictions or guarantee that public RPC will accept a hosting provider's egress IP.

## Origin and network investigation — 24 October 2026

| Test | Observed result | What it establishes |
| --- | --- | --- |
| User's downloaded preview in Chrome, `file://` | Preflight rejected: invalid `backend_traffic` allow-origin header | Real direct-browser failure on the user's path; successful balance not established |
| Live OPTIONS with `Origin: null`, managed environment | Proxy CONNECT rejected with HTTP 403, `server: envoy` | Environment denies destination before upstream response |
| Live OPTIONS with `Origin: http://localhost:5173`, same environment | Same proxy CONNECT HTTP 403 | Changing the origin does not remove this environment restriction |
| Real Chromium page served by Wrangler at `http://localhost:8787`, direct live RPC fetch | `net::ERR_TUNNEL_CONNECTION_FAILED`; fetch rejected | Normal HTTP origin was tested; direct live success remains blocked here |
| Same real Chromium page, new `/api/balance` transport, no mocks | Browser receives readable same-origin JSON HTTP 502; explicit connectivity error; no result or score | Browser-to-app transport works without CORS; upstream live access still fails |
| Unit + HTTP browser regression with test-only invalid-CORS upstream fixture | Validated balance reaches UI; upstream CORS headers are discarded | Reproduces and verifies the CORS fix independently of blocked external network access; not evidence of a live balance |

Unmocked HTTP test used the public wrapped-SOL account `So11111111111111111111111111111111111111112` for transport diagnosis; no account balance is asserted. Earlier wallet testing is recorded on the separate review-artifact branch. Managed environment status reports enforced restricted egress with the RPC domain absent from allowed destinations. Live verification requires that hostname be allowed through the environment configuration, or testing the local full app on an unrestricted authorized network. No proxy/header workaround can grant blocked network access.

The UI, scoring thresholds, ranks, and all 120 roasts remain as before. Only transport, tests/configuration/docs, and one truthful privacy sentence have changed. The previous single-file preview predates this fix; use the full HTTP app to test balances.

## Endpoint behavior

- Only `POST /api/balance` with `application/json` and exactly `{ "address": "..." }` is supported.
- Validates 32-byte base58 addresses in both client and server; limits request body bytes to 256. No arbitrary methods, target URLs, batches, wallet signatures, or transactions.
- Rejects `Origin: null`, foreign origins, and cross-site Fetch Metadata. Non-browser clients without Origin remain possible: these checks are not authentication or a comprehensive bot/rate limiter.
- Upstream is fixed by server configuration, never by callers; the current official default is `https://api.mainnet.solana.com/`. The legacy endpoint and supported free-provider mainnet routes can be explicitly configured (see the production runbook). Redirects are rejected. No incoming auth, cookies, or origin headers are forwarded.
- One upstream call, 8-second timeout, no automatic retries or fallback providers. Client timeout is 12 seconds.
- Every API response has `Cache-Control: no-store`; addresses are in JSON POST bodies, not query strings. No app-level persistence or address logging. Worker observability is disabled in configuration; hosting/RPC providers may independently retain metadata.
- Upstream HTTP/JSON-RPC rate limits become HTTP 429 with a conservative 60-second retry hint. Upstream 403 becomes a readable 503 operator-access error. Other bad responses/network failures become 502; timeout becomes 504. Error bodies are sanitized; no raw provider payloads are exposed.
- Only a safe nonnegative integer lamport value is returned in the existing result envelope. Unsafe numbers are rejected rather than rounded, matching existing behavior. Public high-balance exchange accounts can exceed JavaScript's safe integer range; supporting these exactly requires a separate lossless JSON-number change.
- No keys are required or configured by default. Optional free-provider credentials are supported only through the server-side `SOLANA_RPC_URL` secret, never `VITE_*`, frontend source, or committed files. No provider account/key has been created.

## Recommended free host: Cloudflare Workers with static assets

This is one project and one origin for the existing Vite assets and the small Worker. It needs no database, provider key, external proxy service, or paid plan. A `.workers.dev` URL avoids buying a domain. The included `wrangler.jsonc` routes `/api/*` to the Worker first and serves `dist/` through the ASSETS binding. Unknown API paths return JSON 404 rather than the SPA HTML. The app is intended to be served at the domain root.

Current documented Free limits include 100,000 Worker requests/day and 10ms CPU per invocation; static asset requests are free. Upstream waiting time is not CPU execution. Free quotas and upstream rate limits still apply; no uptime guarantee is claimed. Do not enable a paid plan or paid add-ons for this MVP.

Sources:
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://solana.com/docs/rpc (shared public RPC is not intended for production reliability)

### Local review — no deployment

```sh
npm ci
npm run dev:full
# Open http://localhost:8787
```

This runs entirely locally with Wrangler, including the actual Worker routing and static assets. For Vite hot reload, leave the Worker running and start `npm run dev` in a second terminal; open Vite's HTTP URL. `file://` is deliberately unsupported for real balance checks.

### Deployment requirements — approval required before executing

1. Cloudflare account on **Workers Free**, with `.workers.dev` enabled. No database or secrets required.
2. Run `npm ci`, `npm test`, `npm run build`, and `npm run check:worker`. The last command is explicitly a dry run and does not publish.
3. After the user's deployment approval only: authenticate Wrangler to the intended account and run `npx wrangler deploy`. Do not connect automatic Git deployment before approval.
4. Verify the resulting HTTPS origin and same-origin `/api/balance` with a real wallet/account and no mocks. Record RPC context/time when comparing independent balances; balances can change between requests.
5. If the public RPC denies the host's server IP or rate-limits it, retain the explicit error. Reconsider an authorized free-tier provider or other infrastructure; never silently switch networks, fabricate data, or evade provider restrictions.

Static-only GitHub Pages cannot run this Worker. Another host needs a compatible server/function adapter at exactly `/api/balance`; serving `dist/` alone is insufficient. No deployment has been performed, and account authentication is not needed for local development or dry-run bundling.
