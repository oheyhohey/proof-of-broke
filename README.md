# Proof of Broke

Connect nothing. Spend nothing. Get roasted.

A static React + TypeScript + Vite + Tailwind app that reads a public Solana wallet's **real native SOL balance**, assigns a parody Broke Score, and selects a wallet-specific roast from 120 curated English messages. No wallet adapter, backend, database, API keys, or paid services.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Vite prints the local development URL. Production files go to `dist/`. Serve that directory on any static host, including a subdirectory (relative asset paths are configured). There are no client-side routes or server requirements. Deployment is deliberately not configured or performed by this change.

## Behavior

- Validates base58 encoding and the decoded 32-byte length before any network request. Off-curve public account addresses are accepted.
- Calls `getBalance` with `confirmed` commitment directly from the browser at `https://api.mainnet-beta.solana.com`.
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

This app requests no connection, signature, private key, seed phrase, or transaction. Addresses live only in React memory; no local storage, analytics, backend, or address-bearing page URLs are used. The public RPC provider receives the address and normal request metadata and may log them. Your static host receives ordinary page requests.

Public mainnet RPC is best-effort: it can rate-limit (429), reject browser origins (CORS), restrict public access (403), time out, or fail. The UI explains these failures and never presents fabricated results. Retry manually after a pause; there are no automatic repeated requests or paid fallbacks. CORS failures cannot be distinguished reliably from other network errors in browsers. The app intentionally does not proxy around provider restrictions. Reliability for a widely shared public launch is limited by this no-backend/no-key constraint.

Only native SOL in the submitted account is queried. SPL tokens, NFTs, separate staking accounts, other wallets, transaction history, and total portfolio value are not analyzed. A valid but nonexistent account can legitimately return zero. Results are a snapshot at confirmed commitment; roast cycling does not refresh it. Submit again to refresh. Broke Score is parody, not financial advice or a real measurement of wealth.

## Verification

`npm test` covers 32-byte address validation, exact conversion, every score boundary, malformed/error RPC responses, rate limits, network/CORS failures, timeouts, deterministic selection, full category cycling, the unique 120-message library, and X intent encoding. `npm run build` runs strict TypeScript checking and the production build. Network tests use mocked responses and do not establish live public RPC availability.

Source modules: `src/lib/wallet.ts` (validation/RPC/conversion), `src/lib/roasts.ts` (scoring/library), `src/lib/share.ts` (Canvas export/X), `src/App.tsx` (UI).
