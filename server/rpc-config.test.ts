import { expect, it } from 'vitest';
import { MAINNET_RPC, resolveRpcConfig } from './rpc-config';
it('defaults only an absent secret to the current official mainnet endpoint', () => {
  expect(resolveRpcConfig(undefined)).toEqual({url:MAINNET_RPC,provider:'solana-public'});
  expect(resolveRpcConfig('')).toBeNull();
});
it.each([
  ['https://api.mainnet.solana.com','solana-public'],
  ['https://api.mainnet-beta.solana.com/','solana-public'],
  ['https://mainnet.helius-rpc.com/?api-key=test-only-secret','helius'],
  ['https://solana-mainnet.g.alchemy.com/v2/test_only-key','alchemy'],
])('accepts explicitly supported mainnet URL %s', (url,provider)=>expect(resolveRpcConfig(url)?.provider).toBe(provider));
it.each([
  'bad-url',' ','https://api.devnet.solana.com','https://api.testnet.solana.com',
  'http://api.mainnet.solana.com','https://127.0.0.1','https://localhost',
  'https://api.mainnet.solana.com.attacker.example/','https://attacker.example/',
  'https://api.mainnet.solana.com:8443/','https://user:password@api.mainnet.solana.com/',
  'https://api.mainnet.solana.com/#secret','https://api.mainnet.solana.com/?address=abc',
  'https://api.mainnet.solana.com/anything',' https://api.mainnet.solana.com',
  'https://mainnet.helius-rpc.com/','https://mainnet.helius-rpc.com/?api-key=',
  'https://mainnet.helius-rpc.com/?api-key=a&api-key=b','https://mainnet.helius-rpc.com/?api-key=a&network=devnet',
  'https://devnet.helius-rpc.com/?api-key=secret','https://mainnet.helius-rpc.com/other?api-key=secret',
  'https://solana-devnet.g.alchemy.com/v2/secret','https://solana-mainnet.g.alchemy.com/',
  'https://solana-mainnet.g.alchemy.com/v2/secret?network=devnet','https://solana-mainnet.g.alchemy.com/v2/secret/extra',
])('fails closed on invalid, non-mainnet, or disallowed endpoint %s', url=>expect(resolveRpcConfig(url)).toBeNull());

it.each([null,42,{},true])('rejects mis-typed runtime configuration %s', value=>expect(resolveRpcConfig(value)).toBeNull());
