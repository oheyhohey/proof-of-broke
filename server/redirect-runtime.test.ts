import { afterAll, describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const address = 'So11111111111111111111111111111111111111112';
const secret = 'test-only-redirect-secret';
const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${secret}`;
const calls: string[] = [];
let upstreamStatus = 200;
const script = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { handleBalance } from './server/balance';
      export default { async fetch(request) {
        const mode = new URL(request.url).searchParams.get('mode');
        if (mode) {
          try {
            const response = await fetch(${JSON.stringify(rpcUrl)}, { redirect: mode });
            return Response.json({ status: response.status });
          } catch (error) {
            return Response.json({ name: error.name, message: error.message });
          }
        }
        return handleBalance(request, fetch, { SOLANA_RPC_URL: ${JSON.stringify(rpcUrl)} });
      } };
    `,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'browser', write: false,
}).outputFiles[0].text;
// The real workerd fetch is used. Only network transport is replaced, so there
// are no live RPC calls, credentials, or provider dependencies in these tests.
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true, script, compatibilityDate: '2026-10-24',
  outboundService: async request => {
    calls.push(request.url);
    const body = upstreamStatus === 200
      ? JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 123 } })
      : `${secret} ${address} ${rpcUrl}`;
    return new Response(upstreamStatus === 304 ? null : body, {
      status: upstreamStatus,
      headers: { 'Content-Type': 'application/json', Location: `https://attacker.example/?api-key=${secret}` },
    });
  },
}));
afterAll(() => runtime.dispose());

describe('Workers redirect compatibility and credential isolation (workerd)', () => {
  it.each(['error', 'unsupported'])('rejects redirect mode %s before sending HTTP', async mode => {
    calls.length = 0;
    const result = await runtime.dispatchFetch(`https://proof.example/?mode=${mode}`);
    expect(await result.json()).toMatchObject({ name: 'TypeError' });
    expect(calls).toEqual([]);
  });

  it('accepts manual mode and completes a real Worker balance request', async () => {
    calls.length = 0;
    upstreamStatus = 200;
    const result = await balance();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { value: 123 } });
    expect(calls).toEqual([rpcUrl]);
  });

  it.each(Array.from({ length: 100 }, (_, i) => 300 + i))('rejects upstream %s without following Location or exposing credentials', async status => {
    calls.length = 0;
    upstreamStatus = status;
    const result = await balance();
    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      code: 'RPC_HTTP_ERROR',
      diagnostics: { provider: 'helius', stage: 'http', upstreamStatus: status },
    });
    expect(result.headers.get('Location')).toBeNull();
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toEqual([rpcUrl]);
  });
});

async function balance() {
  const result = await runtime.dispatchFetch('https://proof.example/api/balance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }),
  });
  // Both response headers and body must remain free of upstream URLs/secrets.
  const serialized = JSON.stringify([...result.headers]) + await result.clone().text();
  for (const forbidden of [secret, rpcUrl, 'attacker.example', address]) expect(serialized).not.toContain(forbidden);
  return result;
}
