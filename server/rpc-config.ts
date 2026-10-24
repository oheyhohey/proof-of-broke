/** Worker-only configuration. Never import this module into the frontend. */
export const MAINNET_RPC = 'https://api.mainnet.solana.com/';
export type RpcProvider = 'solana-public' | 'helius' | 'alchemy';
export interface RpcConfig { url: string; provider: RpcProvider; }
export interface RpcEnv { SOLANA_RPC_URL?: string; }

/** Fail closed on bad configuration; never use a URL supplied by an API caller. */
export function resolveRpcConfig(value: unknown): RpcConfig | null {
  const raw = value === undefined ? MAINNET_RPC : value;
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || raw.trim() !== raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
  if (['api.mainnet.solana.com', 'api.mainnet-beta.solana.com'].includes(url.hostname) && url.pathname === '/' && !url.search) {
    return { url: url.href, provider: 'solana-public' };
  }
  if (url.hostname === 'mainnet.helius-rpc.com' && url.pathname === '/') {
    const keys = [...url.searchParams.keys()];
    if (keys.length === 1 && keys[0] === 'api-key' && url.searchParams.get('api-key')?.trim()) return { url: url.href, provider: 'helius' };
  }
  if (url.hostname === 'solana-mainnet.g.alchemy.com' && /^\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search) {
    return { url: url.href, provider: 'alchemy' };
  }
  return null;
}
