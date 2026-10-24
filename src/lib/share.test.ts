import { expect, it } from 'vitest';
import { xShareUrl } from './share';
it('encodes the roast and deployed URL without exposing the full wallet address', () => {
  const url = new URL(xShareUrl({address:'private-to-the-browser',score:100,rank:'Legendary Broke',roast:'Liquidity & feelings?'},'https://example.com/proof/'));
  expect(url.hostname).toBe('twitter.com'); expect(url.searchParams.get('text')).toContain('Liquidity & feelings?');
  expect(url.searchParams.get('text')).not.toContain('private-to-the-browser'); expect(url.searchParams.get('url')).toBe('https://example.com/proof/');
});
it('omits an unavailable deployed URL', () => { expect(new URL(xShareUrl({address:'a',score:10,rank:'Rich',roast:'Test'})).searchParams.has('url')).toBe(false); });
