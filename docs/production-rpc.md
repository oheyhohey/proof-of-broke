# Production RPC diagnosis and free-provider configuration

## What the existing production message actually establishes

The reported message is emitted by the old `server/balance.ts` catch block. That block catches **three materially different failures**:

1. `fetch()` rejects before returning headers: connection/DNS/TLS/reset failures, a rejected redirect (`redirect: error`), or an unexpected fetch/runtime exception.
2. Reading/parsing the response fails: a truncated stream or HTML/text instead of JSON, including a provider/intermediary block page returned with HTTP 200.
3. `assertLamports()` rejects the response value: malformed values **or an otherwise real balance above JavaScript's exact-number range**. The existing maximum is 9,007,199,254,740,991 lamports (9,007,199.254740991 SOL). A large exchange wallet can exceed it; changing provider would not solve this case.

Normal upstream HTTP 403, HTTP 429, HTTP non-success, JSON-RPC errors, mismatched IDs, and an 8-second timeout already had other messages. Therefore the reported text alone does **not** prove an ordinary provider HTTP 403/429. Transport failure or an unreadable response is a plausible explanation for shared public RPC, but unsafe balance rejection is also possible. No exact production root cause is claimed without stage/status evidence.

The fact that the page loads and the app displays this server-generated message establishes that browser-to-Worker routing and the same-origin API work. Opera VPN changes the browser's path to Cloudflare; it does not choose the Worker's outbound path to Solana. This is no longer a browser-to-RPC CORS issue.

The code uses standard Workers-supported Fetch, AbortController, streams, timers, JSON, and BigInt validation. There is no Node-only RPC client, proxy agent, or native package in the Worker. Local workerd runs the handler successfully; runtime incompatibility is not indicated by the available evidence. A network `TypeError` alone cannot distinguish DNS vs TLS vs reset, or absolutely rule out an unexpected fetch/runtime problem.

## What was independently tested

On 24 October 2026, the deployed host `proof-of-broke.purificationforeveryone.workers.dev` was requested read-only using a known public account. The managed execution environment refused the HTTPS CONNECT tunnel with HTTP 403 from its outbound proxy; the web reader also could not open the site. This is an environment restriction **before the production Worker**, not proof of a production HTTP 403 or Cloudflare-to-Solana failure. No VPN, alternate routing, or security bypass was used. No successful live production/provider balance test is claimed from this environment.

The new handler was also smoke-tested in local workerd. With the environment's restricted outbound path it returned readable JSON with `RPC_FETCH_FAILED` and `stage: fetch`. Unit and Chromium tests separately verify response classification and unchanged application behavior using explicit test-only upstream fixtures. These fixtures never ship as production responses.

## Sanitized diagnostics in this PR

No new public debug endpoint, database, persistent logs, or address-bearing URL is added. All server RPC failures return a small JSON response with `Cache-Control: no-store`:

```json
{
  "error": "Solana RPC returned unreadable JSON. No balance was assumed. [RPC_JSON_INVALID]",
  "code": "RPC_JSON_INVALID",
  "diagnostics": {
    "provider": "solana-public",
    "stage": "parse",
    "upstreamStatus": 200,
    "contentType": "html"
  }
}
```

This example describes a possible classification, not an observed production response. The existing UI displays the sanitized error and code; its layout/styles, scoring, ranks, share cards, and all 120 roasts are unchanged.

Only these metadata fields are emitted: fixed provider alias, processing stage, upstream HTTP status when obtained, a coarse MIME category (`json`, `html`, `other`, `missing`), and a numeric JSON-RPC code when supplied. The response does not contain an address (full, shortened, or hashed), balance on failure, request body, endpoint URL, API key, raw response/header, exception message, or stack. Raw provider errors can echo credentials/addresses and are never returned or logged. Worker observability remains disabled. Hosting/RPC providers may independently log requests.

| Diagnostic code | What is known | Next step |
| --- | --- | --- |
| `RPC_CONFIG_ERROR` | Worker configuration is empty, malformed, or not an allowed mainnet URL | Correct the server secret; there is no silent fallback |
| `RPC_FETCH_FAILED`, stage `fetch` | No usable response headers reached the handler | Check server-to-provider connectivity, rejected redirects, provider availability; cannot infer DNS/TLS specifics from this alone |
| `RPC_TIMEOUT` | The upstream operation exceeded 8 seconds | Retry later; check provider latency/connectivity |
| `RPC_AUTH_ERROR`, status 401 | Provider refused server credentials | Check/rotate the Worker secret and account/plan status |
| `RPC_ACCESS_DENIED`, status 403 | Provider or upstream intermediary explicitly denied the request | Check provider policy and host egress; do not bypass restrictions |
| `RPC_RATE_LIMIT` | HTTP 429 or known busy JSON-RPC code | Wait; inspect free quota; no automatic retry storm |
| `RPC_HTTP_ERROR` | Other non-success upstream HTTP status | Investigate the recorded status, e.g. 5xx upstream service/edge failure |
| `RPC_BODY_READ_FAILED` | Headers arrived, but response stream failed | Investigate upstream stream/network interruption |
| `RPC_JSON_INVALID` | Body arrived but is not valid JSON | Check coarse MIME/status; 200 + html suggests an edge/block/misconfigured response |
| `RPC_RESPONSE_TOO_LARGE` | Upstream body exceeds 16 KiB | Provider response is inconsistent with a tiny getBalance response; inspect provider health/configuration |
| `RPC_RESPONSE_INVALID` | JSON parsed but envelope/id is wrong | Provider or integration returned unexpected data |
| `RPC_ERROR` | Upstream JSON-RPC protocol error | Inspect numeric rpcCode; raw message/data are deliberately excluded |
| `RPC_BALANCE_INVALID` | Value is missing, wrong type, negative, or fractional | Provider data/schema problem; no substitute zero |
| `RPC_BALANCE_UNSAFE` | Integer balance exceeds exact numeric support | This is a precision limit, not connectivity. Use a supported-size account to confirm connectivity. Supporting larger balances exactly needs a separate lossless-number change, not relaxed validation or a different provider |
| `RPC_INTERNAL_ERROR` | Unexpected processing failure after earlier stages | Review code/runtime using sanitized metadata; no raw exception text |

To collect evidence **after an approved deployment**: open browser DevTools → Network → `/api/balance` → Response. Copy only the response's `code` and `diagnostics`, plus HTTP status if needed. Do not share a HAR, request payload, Copy-as-cURL, raw Worker tail, screenshot of the input, or upstream URL containing a secret. Do not enable broad request-body/exception logging. A platform-level Worker crash (e.g. a non-JSON Cloudflare error) will not have this diagnostic envelope; use platform outcome/error category only and inspect code locally without publishing request/secret data.

## Official endpoint and free alternatives

Sources checked 24 October 2026; quotas/policies can change. These are documented offerings, not a claim of measured availability from this production Worker.

| Option | Free access | Evaluation |
| --- | --- | --- |
| Solana public mainnet | No account/key; shared rate-limited endpoint | Current official docs list `https://api.mainnet.solana.com`. Older official docs use `https://api.mainnet-beta.solana.com`; this is not evidence the older hostname is invalid. Shared public access may block traffic (403), rate-limit (429), and has no production reliability guarantee. The new default follows current docs; it is not represented as a proven connectivity repair. The legacy URL remains explicitly configurable. |
| **Helius Free — recommended for this small MVP** | Currently $0, 1M credits/month, 10 requests/sec; account/API key required | Solana-focused authenticated standard JSON-RPC. Configure `https://mainnet.helius-rpc.com/?api-key=YOUR_OWN_KEY` as a **Worker secret**. No new database/runtime/provider SDK needed. Free quotas still apply; not an SLA. |
| Alchemy Free | Currently 30M compute units/month; free account/key | Reputable alternative supporting Solana mainnet: `https://solana-mainnet.g.alchemy.com/v2/YOUR_OWN_KEY`. Units are method-weighted and not equivalent to requests. Supported by the same server-only configuration. |
| Ankr Public/Freemium | Public shared endpoints; documented free account tier with 200M API credits/month | Reputable option, but shared/free traffic is lower-priority under load and authentication/chain access must be checked in its dashboard. Not chosen as an unverified anonymous fallback or added to this PR's narrow URL allowlist. |

Sources:
- https://solana.com/docs/rpc
- https://solana.com/docs/references/clusters
- https://github.com/solana-foundation/developer-content/blob/main/docs/core/clusters.md (legacy endpoint)
- https://www.helius.dev/pricing
- https://www.helius.dev/docs/api-reference/rpc/http/getbalance
- https://www.alchemy.com/pricing
- https://www.alchemy.com/rpc/solana
- https://www.ankr.com/docs/rpc-service/service-plans/
- https://developers.cloudflare.com/workers/configuration/secrets/

The simplest more dependable setup is the **existing Worker on Workers Free + a Helius Free mainnet URL in its server secret**. This avoids anonymous shared public-RPC dependence while keeping a single same-origin browser endpoint. It is a recommendation, not a live-verified guarantee. It will not cure `RPC_BALANCE_UNSAFE`, and should not be described as a universal fix before the new diagnostic result is known. Do not enroll in paid plans, top up, enable paid overages, or configure paid fallbacks.

## Implemented configuration and unchanged controls

`server/worker.ts` passes its optional `SOLANA_RPC_URL` binding to the server transport. An absent binding uses the current official public endpoint. A present but invalid binding fails closed. Only HTTPS mainnet routes for the two official hostnames, Helius, and Alchemy are allowed. Devnet/testnet, arbitrary hosts, localhost/private addresses, URL userinfo, unusual ports, fragments, extra routes/parameters, and caller-selected URLs are rejected. The API continues to accept exactly `{address}`; clients cannot select a provider.

The URL can contain an API key, so treat the **whole value** as a secret. It is not included in Wrangler plaintext vars, `.env`, `VITE_*`, browser bundles, API responses, or logs. No real provider credential has been created/configured in this PR. Tests use clearly labeled dummy credentials only. The endpoint remains read-only with same-origin checks, bounded requests, redirect rejection, timeout, no-store responses, no automatic retries, and no automatic provider/network fallback. Provider response reads are now also bounded to 16 KiB.

## Local verification and approval-gated production setup

No deployment, secret change, account change, or merge was performed for this fix.

For local testing, leave `SOLANA_RPC_URL` absent to test the public default, or privately create an ignored `.dev.vars` with your own free-tier endpoint. Do not paste the real key into chat, a shell command/history, or committed files:

```text
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_OWN_KEY"
```

```sh
npm ci
npm run dev:full
# http://localhost:8787 (server must be allowed to reach the selected provider)
```

Validation without publishing:

```sh
npm run build
CHROME_PATH=/usr/bin/chromium npm test
npm run check:worker  # wrangler deploy --dry-run only
```

Production steps require approval:

1. Select **Helius Free** (or Alchemy Free), create a mainnet read-only app key where offered, and stay within its free quota. Do not enable paid services. Do not configure a browser-origin restriction that would prevent server-side Worker requests.
2. Bind the complete URL as the Worker's encrypted `SOLANA_RPC_URL` secret. **Cloudflare documents that `wrangler secret put` deploys immediately**: do not run it without deployment approval. `wrangler versions secret put` stages a version without deploying, but is still a production configuration mutation requiring review. The dashboard may also deploy when saving secrets. None of these actions has been run here.
3. Deploy the reviewed commit and selected secret together only after approval, to the existing Worker. The code needs no additional Cloudflare paid feature or Node.js compatibility flag.
4. Perform one real HTTPS lookup with no mocks and inspect only the sanitized response if it fails. Check a legitimate zero and a known nonzero supported-size account; use an independent provider/explorer near the same time for comparison. Never insert an explorer's cached balance as a production fallback.
5. If a provider key is exposed accidentally, rotate it server-side after approval. No raw URL/exception output should be shared during debugging.
