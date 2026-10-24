const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Solana addresses are base58 encodings of exactly 32 bytes; off-curve accounts are valid. */
export function isValidAddress(address: string): boolean {
  if (address.length < 32 || address.length > 44) return false;
  let n = 0n;
  for (const c of address) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n > 0n) { bytes++; n >>= 8n; }
  const leadingZeros = address.match(/^1*/)?.[0].length ?? 0;
  return bytes + leadingZeros === 32;
}
export function assertLamports(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('RPC returned an invalid or unsafe balance. No result was generated.');
}
export function lamportsToSol(lamports: number): string {
  assertLamports(lamports);
  const amount = BigInt(lamports);
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${amount / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`;
}
export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
export const RPC_ENDPOINT = '/api/balance';
export async function getBalance(address: string, fetcher: typeof fetch = fetch): Promise<number> {
  if (!isValidAddress(address)) throw new Error('Enter a valid Solana public address (32-byte base58).');
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') throw new Error('Balance checks require the full application at an HTTP or HTTPS URL. A downloaded HTML file is a visual preview only.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(RPC_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }), signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (response.status === 429) throw new Error('The public Solana RPC is rate-limiting requests. Wait a minute, then try again.');
    if (!response.ok) {
      let message = `Balance service returned HTTP ${response.status}. Ensure the app is served with its /api/balance endpoint and try again later.`;
      try {
        const body = await response.json();
        if (typeof body?.error === 'string' && body.error.length <= 300) message = body.error;
      } catch { /* A static host or gateway can return HTML instead of JSON. */ }
      throw new Error(message);
    }
    const data = await response.json();
    if (data?.error) {
      if (data.error.code === 429 || data.error.code === -32005) throw new Error('Solana RPC is busy or rate-limiting requests. Try again in a minute.');
      throw new Error('Solana RPC rejected the balance request. Try again later.');
    }
    if (data?.jsonrpc !== '2.0' || data?.id !== 1) throw new Error('Unexpected RPC response. No result was generated.');
    const value: unknown = data?.result?.value;
    assertLamports(value);
    return value;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Solana took too long to respond. Try again.');
    if (error instanceof SyntaxError) throw new Error('The balance endpoint returned an invalid response. Run the full app server, not a static-only preview. No balance was assumed.');
    if (error instanceof TypeError) throw new Error('Could not reach the balance service. Open the application through its HTTP or HTTPS server; downloaded file previews cannot check balances. No balance was assumed.');
    throw error;
  } finally { clearTimeout(timer); }
}
