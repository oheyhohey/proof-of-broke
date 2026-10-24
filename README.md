# Proof of Broke

Connect nothing. Spend nothing. Get roasted.

A React + TypeScript + Vite + Tailwind app with static frontend assets and a small same-origin balance proxy that reads a public Solana wallet's **real native SOL balance**, assigns a parody Broke Score, and selects a wallet-specific roast from 120 curated English messages. No wallet adapter, database, API keys, or paid services. The proxy is compatible with Cloudflare Workers Free and uses the public mainnet RPC.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev:full
```

Open **http://localhost:8787**. This builds the unchanged UI and serves both the assets and `/api/balance` using Wrangler's local Worker runtime. No Cloudflare account or deployment is required for local development. Internet access to `api.mainnet-beta.solana.com` is required on the server. After editing frontend files, rebuild; Wrangler watches Worker code.

For frontend hot reload, run `npm run dev:full` in one terminal and `npm run dev` in another. Vite on port 5173 forwards `/api` to the local Worker on 8787. `npm run preview` similarly needs that Worker running. Serve the production app at a domain root so `/api/balance` is on the same origin. A static-only host or downloaded `file://` HTML cannot execute the server endpoint. The old downloadable preview remains visual-only and is not the corrected application.

```sh
npm test
npm run build
npm run check:worker  # local Wrangler bundle validation; --dry-run, no deployment
# Optional real Chromium regression test; set the path to your Chrome/Chromium binary:
CHROME_PATH=/usr/bin/chromium npm run test:browser
```

See [deployment requirements](docs/rpc-proxy.md) and the recorded origin investigation. No merge or deployment has been performed.

## Behavior

- Validates base58 encoding and the decoded 32-byte length before any network request. Off-curve public account addresses are accepted.
- Browser sends only `{address}` to same-origin `POST /api/balance`. The server revalidates it and constructs a fixed `getBalance` request with `confirmed` commitment to `https://api.mainnet-beta.solana.com`. No upstream Origin, cookies, authorization, or CORS headers are forwarded.
- Formats integer lamports with BigInt arithmetic, retaining up to nine decimal places. Rejects unsafe or malformed numeric responses rather than rounding or inventing a balance.
- Uses an FNV-1a address hash to choose the initial roast in the balance category. **Roast again** cycles all 20 messages in that category before repeating, without contacting RPC or changing the score. Rank and roast are parody, not an assessment of personal wealth or wallet history.
- Generates a local 1200×630 PNG using Canvas with shortened address, score, rank, roast, and branding. No external images/fonts are required.
- Opens X Web Intent with a prefilled roast. A deployed URL is included from the current page URL (without query/hash); local development URLs are omitted. Downloaded images must be attached manually. Sharing a card reveals the shortened address; sharing the default X text does not reveal the address.

| Native SOL | Score | Rank |
| --- | --- | --- |
| 0 | 100 | Legendary Broke |
| >0 and <0.01 | 95 | Gas Fee Survivor |
| ≥0.01 and <0.1 | 85 | Professional Reply Guy |
| ≥0.1 and <1 | 65 | Part-Time Degen |
| ≥1 and <10 | 35 | Financially Recovering |
| ≥10 | 10 | Suspiciously Wealthy |

## Privacy and limitations

This app requests no connection, signature, private key, seed phrase, or transaction. Addresses live only in React memory; no local storage, analytics, database, or address-bearing page URLs are used. The same-origin proxy processes the address transiently and sends it to the public RPC provider. Hosting and RPC providers may log metadata; this implementation does not log or persist addresses, cache balance responses, or enable Worker observability. Addresses are in the POST body, not URLs.

The same-origin proxy removes browser-to-RPC CORS dependence, including invalid upstream `Access-Control-Allow-Origin: backend_traffic` responses. It does not guarantee public RPC availability: upstream rate limits, denial, network failures, unsafe/malformed balances, and timeouts return explicit errors, never invented zero balances. There are no retries, alternate providers, paid fallbacks, or embedded API keys. Server-side calls must respect provider access restrictions. No general-purpose CORS proxy is used.

Cloudflare's free-plan limits and shared public RPC availability still bound launch reliability. A backend-capable host is now required for balance checks; a static-only host can display the UI but cannot query balances with this transport. This is the deliberate small architecture change to address the reported CORS failure.

Only native SOL in the submitted account is queried. SPL tokens, NFTs, separate staking accounts, other wallets, transaction history, and total portfolio value are not analyzed. A valid but nonexistent account can legitimately return zero. Results are a snapshot at confirmed commitment; roast cycling does not refresh it. Submit again to refresh. Broke Score is parody, not financial advice or a real measurement of wealth.

## Verification

`npm test` covers address validation, exact conversion, all score boundaries, deterministic roast cycling, all 120 unique messages, client errors, and the restricted proxy's input/method/origin validation, header isolation, no-store responses, upstream status/JSON errors, invalid balances, timeouts, and Worker routing. `npm run build` checks strict TypeScript for the client, server, and browser tests and builds the static frontend. `npm run check:worker` bundles the Worker without deployment.

The optional Chromium test serves the actual production UI and proxy handler over HTTP, with a **test-only HTTP upstream fixture** that returns the reported invalid CORS header. It verifies exact balance rendering, unchanged score and roast cycling without another query, no browser cross-origin requests, and rate-limit failures clearing stale results. This fixture is confined to tests; production always uses the fixed real mainnet endpoint. The browser test is skipped by `npm test` unless `CHROME_PATH` is set.

An unmocked Chromium HTTP-origin test and both `null`/HTTP-origin preflight diagnostics were also attempted in the managed environment. Its enforced egress policy denies the Solana destination, so no successful live balance verification is claimed. See [the detailed investigation](docs/rpc-proxy.md).

Source modules: `src/lib/wallet.ts` (validation/client/conversion), `server/balance.ts` (restricted upstream proxy), `server/worker.ts` (hosting adapter), `src/lib/roasts.ts` (unchanged scoring/library), `src/lib/share.ts` (unchanged export/X), `src/App.tsx` (same layout; privacy wording corrected for proxy transit).
