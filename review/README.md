# Proof of Broke review preview and live RPC check

This branch contains review artifacts for PR #1. It is not a deployment. The app source is unchanged from PR commit c4ff084.

## Open the working visual preview

Download `preview.html` using GitHub's **Download raw file** button, then open the downloaded file in your browser. The single HTML file contains the production JavaScript and CSS; no npm install is needed. Alternatively, serve this folder with `python3 -m http.server 5174` and open http://localhost:5174/preview.html. The preview has no mocked balance responses. Live analysis still depends on your network and public RPC access. Desktop and mobile PNG screenshots show the design without requiring a server.

## Live test — 24 October 2026, 15:09 Istanbul time

- Real headless Chromium, normal web security, environment's configured HTTP proxy, no request interception and no mocked responses.
- Publicly identified Binance address: `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`.
- Explorer reference: https://www.solanatracker.io/explorer/account/9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM . The search-indexed explorer reports a nonzero balance, but it is not a same-slot authoritative balance and was not used as an RPC substitute.
- The application's actual POST targets `https://api.mainnet-beta.solana.com`, method `getBalance`, confirmed commitment.
- Chromium result: `net::ERR_TUNNEL_CONNECTION_FAILED`. No upstream HTTP response and no SOL balance were obtained. The UI displays its connection error and no score/result.
- Independent curl diagnostic through the same environment proxy: `HTTP/1.1 403 Forbidden`, `server: envoy`, followed by `CONNECT tunnel failed, response 403`.
- Environment status reports an enforced restricted egress policy. The Solana hostname is absent from the allowed destinations. Therefore this observed failure is the environment proxy refusing the HTTPS CONNECT tunnel, before reaching Solana. It does not establish an upstream CORS, HTTP 403, or HTTP 429 failure.

**Live balance correctness is not verified. Do not treat this as a passing live integration test.** Full browser evidence is in `live-rpc-evidence.json`; the error state is in `live-rpc-attempt.png`. The unrelated favicon 404 in the console does not cause the RPC failure.

## Recommended next step

For this verification, add `api.mainnet-beta.solana.com` to the cloud environment's allowed network destinations using its configuration UI, then rerun the unmocked browser test. This is free and does not require changing the application or deploying it. Compare `getBalance` with a same-slot `getAccountInfo` lamport value or an independent live explorer/provider, recording the context slot. An actively used wallet can change balance between requests. Choose a wallet whose balance fits JSON's safe integer range; the current app explicitly rejects unsafe lamport numbers instead of presenting rounded results.

For public launch reliability, Solana explicitly says shared public endpoints are not for production: https://solana.com/docs/rpc . There is no guaranteed reliable free, no-key public endpoint to recommend. If the no-key constraint can be relaxed, Helius currently lists a $0 tier with 1M monthly credits and 10 requests/second: https://www.helius.dev/pricing . This is a practical small-MVP option, subject to quotas, not an uptime guarantee. It requires a provider account/API key; do not commit the key or embed a confidential key in a static bundle. A small rate-limited serverless proxy on a free tier can protect it, but changes the original no-backend architecture and would need approval before implementation/deployment. A random public CORS proxy is not a reliable fix.

No merge, deployment, paid service, or new RPC provider has been introduced.
