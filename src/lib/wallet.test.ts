import { describe, expect, it, vi } from 'vitest';
import { getBalance, isValidAddress, lamportsToSol } from './wallet';
const address = 'So11111111111111111111111111111111111111112';
describe('address validation', () => {
  it.each(['11111111111111111111111111111111', address, 'Vote111111111111111111111111111111111111111'])('accepts 32-byte public addresses including off-curve accounts: %s', value => expect(isValidAddress(value)).toBe(true));
  it.each(['', '0'.repeat(44), 'O'.repeat(32), '1'.repeat(31), '1'.repeat(33), 'z'.repeat(44), ' abc ', '<script>alert(1)</script>'])('rejects invalid encodings: %s', value => expect(isValidAddress(value)).toBe(false));
});
describe('exact SOL conversion', () => {
  it.each([[0,'0'],[1,'0.000000001'],[10_000_000,'0.01'],[1_000_000_000,'1'],[1_234_567_890,'1.23456789'],[Number.MAX_SAFE_INTEGER,'9007199.254740991']])('converts %s lamports', (value, expected) => expect(lamportsToSol(value as number)).toBe(expected));
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe values %s', value => expect(() => lamportsToSol(value)).toThrow());
});
function rpcResponse(value: unknown) { return new Response(JSON.stringify({ jsonrpc:'2.0', id:1, result:{value} }), {status:200}); }
describe('real balance transport', () => {
  it('validates before contacting RPC', async () => { const fetcher = vi.fn(); await expect(getBalance('invalid', fetcher)).rejects.toThrow('valid Solana'); expect(fetcher).not.toHaveBeenCalled(); });
  it('requests confirmed mainnet balance and accepts a real zero', async () => {
    const fetcher = vi.fn().mockResolvedValue(rpcResponse(0));
    expect(await getBalance(address, fetcher)).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('/api/balance');
    expect(JSON.parse(request.body)).toEqual({address});
    expect(request.credentials).toBe('omit');
  });
  it('explains HTTP rate limits', async () => { await expect(getBalance(address, vi.fn().mockResolvedValue(new Response('', {status:429})))).rejects.toThrow('rate-limiting'); });
  it('explains balance-service connection failures', async () => { await expect(getBalance(address, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).rejects.toThrow('HTTP or HTTPS'); });
  it.each([undefined, null, -1, '123', 0.1, Number.MAX_SAFE_INTEGER + 1])('never substitutes a balance for invalid RPC value %s', async value => { await expect(getBalance(address, vi.fn().mockResolvedValue(rpcResponse(value)))).rejects.toThrow(); });
  it('handles JSON-RPC errors', async () => { const response = new Response(JSON.stringify({error:{code:-32005}})); await expect(getBalance(address,vi.fn().mockResolvedValue(response))).rejects.toThrow('rate-limiting'); });
  it('rejects unrelated response IDs', async () => { await expect(getBalance(address,vi.fn().mockResolvedValue(new Response(JSON.stringify({jsonrpc:'2.0',id:2,result:{value:0}}))))).rejects.toThrow('Unexpected RPC'); });
  it('times out a stalled request', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
      const promise = expect(getBalance(address,fetcher)).rejects.toThrow('too long');
      await vi.advanceTimersByTimeAsync(12_000); await promise;
    } finally { vi.useRealTimers(); }
  });
});

it('surfaces a sanitized server connectivity error', async () => {
  await expect(getBalance(address, vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Solana RPC denied server access.'}),{status:503})))).rejects.toThrow('denied server access');
});
it('explains a static-only server returning HTML instead of the API', async () => {
  await expect(getBalance(address,vi.fn().mockResolvedValue(new Response('<!doctype html>')))).rejects.toThrow('full app server');
});
it('rejects file previews explicitly before a request', async () => {
  vi.stubGlobal('window', {location:{protocol:'file:'}});
  const fetcher = vi.fn();
  try {
    await expect(getBalance(address,fetcher)).rejects.toThrow('visual preview only');
    expect(fetcher).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
