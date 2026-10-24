import { describe, expect, it } from 'vitest';
import { hashAddress, ranks, roasts, scoreForLamports, selectRoast, type Score } from './roasts';
describe('score thresholds in integer lamports', () => {
  it.each([[0,100],[1,95],[9_999_999,95],[10_000_000,85],[99_999_999,85],[100_000_000,65],[999_999_999,65],[1_000_000_000,35],[9_999_999_999,35],[10_000_000_000,10],[Number.MAX_SAFE_INTEGER,10]])('%s → %s', (lamports, score) => expect(scoreForLamports(lamports)).toBe(score));
  it.each([-1,NaN,Infinity,0.5])('rejects %s', n => expect(() => scoreForLamports(n)).toThrow());
});
describe('curated roast selection', () => {
  it('contains at least 120 unique messages', () => { const all = Object.values(roasts).flat(); expect(all.length).toBeGreaterThanOrEqual(120); expect(new Set(all).size).toBe(all.length); });
  it.each(Object.keys(roasts).map(Number) as Score[])('cycles the whole category %s without repeats or score changes', score => {
    const address = 'So11111111111111111111111111111111111111112';
    const first = selectRoast(address,score);
    expect(selectRoast(address,score)).toBe(first);
    expect(ranks[score]).toBeTruthy();
    const cycle = Array.from({length:roasts[score].length},(_,i) => selectRoast(address,score,i));
    expect(new Set(cycle).size).toBe(roasts[score].length);
    expect(cycle.every(message => (roasts[score] as readonly string[]).includes(message))).toBe(true);
    expect(selectRoast(address,score,roasts[score].length)).toBe(first);
  });
  it('uses a stable address-specific hash', () => { expect(hashAddress('hello')).toBe(1335831723); expect(hashAddress('wallet-a')).not.toBe(hashAddress('wallet-b')); });
});
