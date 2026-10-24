import { assertLamports, isValidAddress } from '../src/lib/wallet';

// No caller-selected URLs or methods: this is a balance endpoint, not an open RPC proxy.
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const MAX_BODY_BYTES = 256;
const UPSTREAM_TIMEOUT_MS = 8_000;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
function failure(status: number, message: string, extra?: Record<string, string>): Response {
  return json({ error: message }, status, extra);
}

/** Bound actual bytes, including chunked bodies; Content-Length alone is not sufficient. */
async function readAddress(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const fields = Object.keys(data);
    if (fields.length !== 1 || fields[0] !== 'address') return null;
    const address = (data as { address: unknown }).address;
    return typeof address === 'string' && isValidAddress(address) ? address : null;
  } catch { return null; }
}

export async function handleBalance(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return failure(405, 'Use POST with a public Solana address.', { Allow: 'POST' });
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if ((origin !== null && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return failure(403, 'Balance requests must come from this application. Open its HTTP or HTTPS URL.');
  }
  if (url.search) return failure(400, 'Send the address in the JSON body, not the URL.');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure(415, 'Send an application/json body.');
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return failure(413, 'Request body is too large.');
  let address: string | null;
  try { address = await readAddress(request); }
  catch { return failure(400, 'Could not read the request body.'); }
  if (!address) return failure(400, 'Provide only a valid public Solana address.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetcher(MAINNET_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }),
      signal: controller.signal, redirect: 'error',
    });
    // Do not forward upstream CORS, cookies, raw errors, or potentially sensitive headers.
    if (upstream.status === 429) return failure(429, 'Solana RPC is rate-limiting requests. Wait a minute and retry.', { 'Retry-After': '60' });
    if (upstream.status === 403) return failure(503, 'Solana RPC denied server access. The operator must check its upstream network/provider access.');
    if (!upstream.ok) return failure(502, 'Solana RPC is unavailable. Try again later.');
    const data = await upstream.json();
    if (data?.error) {
      if (data.error.code === 429 || data.error.code === -32005) return failure(429, 'Solana RPC is busy or rate-limiting requests. Wait a minute and retry.', { 'Retry-After': '60' });
      return failure(502, 'Solana RPC rejected the balance request. No balance was assumed.');
    }
    if (data?.jsonrpc !== '2.0' || data?.id !== 1) return failure(502, 'Unexpected Solana RPC response. No balance was assumed.');
    assertLamports(data?.result?.value);
    // Return only validated data, never arbitrary upstream fields.
    return json({ jsonrpc: '2.0', id: 1, result: { value: data.result.value } });
  } catch {
    return controller.signal.aborted
      ? failure(504, 'Solana RPC timed out. Try again later.')
      : failure(502, 'Could not read a valid balance from Solana RPC. Check server connectivity and retry. No balance was assumed.');
  } finally { clearTimeout(timer); }
}
