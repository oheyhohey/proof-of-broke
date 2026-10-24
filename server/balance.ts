import { isValidAddress } from '../src/lib/wallet';
import { resolveRpcConfig, type RpcEnv, type RpcProvider } from './rpc-config';
export { MAINNET_RPC } from './rpc-config';

// No caller-selected URLs or methods: this is a balance endpoint, not an open RPC proxy.
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

export async function handleBalance(request: Request, fetcher: typeof fetch = fetch, env: RpcEnv = {}): Promise<Response> {
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

  const config = resolveRpcConfig(env.SOLANA_RPC_URL);
  if (!config) return diagnosticFailure(503, 'RPC_CONFIG_ERROR', 'The balance service RPC configuration is invalid. No balance was assumed.', { provider: 'unconfigured', stage: 'config' });
  let stage: RpcStage = 'fetch';
  const details: RpcDiagnostics = { provider: config.provider, stage };
  const fail = (status: number, code: string, message: string, extra?: Record<string, string>) =>
    diagnosticFailure(status, code, message, { ...details, stage }, extra);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetcher(config.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }),
      // Workers does not support 'error'. Never follow a credential-bearing redirect.
      signal: controller.signal, redirect: 'manual',
    });
    stage = 'http';
    details.upstreamStatus = upstream.status;
    details.contentType = classifyContentType(upstream.headers.get('Content-Type'));
    // Never forward upstream headers, bodies, exception text, or credential-bearing URLs.
    if (upstream.status >= 300 && upstream.status < 400) return fail(502, 'RPC_HTTP_ERROR', 'Solana RPC returned an unsuccessful HTTP response. Try again later.');
    if (upstream.status === 429) return fail(429, 'RPC_RATE_LIMIT', 'Solana RPC is rate-limiting requests. Wait a minute and retry.', { 'Retry-After': '60' });
    if (upstream.status === 401) return fail(503, 'RPC_AUTH_ERROR', 'The RPC provider rejected server credentials. The operator must check the Worker secret.');
    if (upstream.status === 403) return fail(503, 'RPC_ACCESS_DENIED', 'Solana RPC denied server access. The operator must check its upstream network/provider access.');
    if (!upstream.ok) return fail(502, 'RPC_HTTP_ERROR', 'Solana RPC returned an unsuccessful HTTP response. Try again later.');

    stage = 'read';
    const text = await readRpcBody(upstream);
    stage = 'parse';
    const data = JSON.parse(text);
    stage = 'validate';
    if (data?.error) {
      const rpcCode = data.error.code;
      // Codes are numeric protocol metadata only; never expose the error message/data.
      if (Number.isSafeInteger(rpcCode)) details.rpcCode = rpcCode;
      if (rpcCode === 429 || rpcCode === -32005) return fail(429, 'RPC_RATE_LIMIT', 'Solana RPC is busy or rate-limiting requests. Wait a minute and retry.', { 'Retry-After': '60' });
      return fail(502, 'RPC_ERROR', 'Solana RPC rejected the balance request. No balance was assumed.');
    }
    if (data?.jsonrpc !== '2.0' || data?.id !== 1) return fail(502, 'RPC_RESPONSE_INVALID', 'Solana RPC returned an unexpected response. No balance was assumed.');
    const value: unknown = data?.result?.value;
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
      return fail(502, 'RPC_BALANCE_INVALID', 'Solana RPC returned an invalid balance. No balance was assumed.');
    }
    if (!Number.isSafeInteger(value)) {
      return fail(502, 'RPC_BALANCE_UNSAFE', 'This SOL balance exceeds the supported exact numeric range. No rounded balance was displayed.');
    }
    return json({ jsonrpc: '2.0', id: 1, result: { value } });
  } catch (error) {
    if (controller.signal.aborted) return fail(504, 'RPC_TIMEOUT', 'Solana RPC timed out. Try again later.');
    if (error instanceof RpcBodyTooLarge) return fail(502, 'RPC_RESPONSE_TOO_LARGE', 'Solana RPC returned an oversized response. No balance was assumed.');
    if (stage === 'fetch') return fail(502, 'RPC_FETCH_FAILED', 'The server could not complete its RPC connection. No balance was assumed.');
    if (stage === 'read') return fail(502, 'RPC_BODY_READ_FAILED', 'The server could not finish reading the RPC response. No balance was assumed.');
    if (stage === 'parse') return fail(502, 'RPC_JSON_INVALID', 'Solana RPC returned unreadable JSON. No balance was assumed.');
    return fail(502, 'RPC_INTERNAL_ERROR', 'The balance service could not process the RPC response. No balance was assumed.');
  } finally { clearTimeout(timer); }
}

// Deliberately small, allowlisted metadata. No request body, address (even hashed),
// balance, URL, raw headers, provider error message, stack, or exception text.
type RpcStage = 'config' | 'fetch' | 'http' | 'read' | 'parse' | 'validate';
interface RpcDiagnostics {
  provider: RpcProvider | 'unconfigured';
  stage: RpcStage;
  upstreamStatus?: number;
  contentType?: 'json' | 'html' | 'other' | 'missing';
  rpcCode?: number;
}
function diagnosticFailure(status: number, code: string, message: string, diagnostics: RpcDiagnostics, extra?: Record<string, string>): Response {
  return json({ error: `${message} [${code}]`, code, diagnostics }, status, extra);
}
function classifyContentType(value: string | null): RpcDiagnostics['contentType'] {
  if (!value) return 'missing';
  const mime = value.split(';')[0].trim().toLowerCase();
  if (mime === 'application/json' || /^application\/[a-z0-9.-]+\+json$/.test(mime)) return 'json';
  return mime === 'text/html' ? 'html' : 'other';
}
class RpcBodyTooLarge extends Error {}
/** Cap edge block pages as well as normal JSON to keep Free-plan memory/CPU bounded. */
async function readRpcBody(response: Response): Promise<string> {
  const limit = 16_384;
  const length = response.headers.get('Content-Length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) throw new RpcBodyTooLarge();
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RpcBodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
