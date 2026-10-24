// Test-only upstream fixture. Production always calls the fixed mainnet URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { handleBalance } from '../server/balance';
import { roasts } from '../src/lib/roasts';

const describeBrowser = process.env.CHROME_PATH ? describe : describe.skip;
describeBrowser('HTTP browser → real proxy handler → test-only HTTP upstream', () => {
  let upstream: Server;
  let app: Server;
  let browser: Browser;
  let origin: string;
  let upstreamOrigin: string;
  let calls = 0;
  let limited = false;
  async function listen(server: Server): Promise<string> {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    return `http://127.0.0.1:${address.port}`;
  }
  beforeAll(async () => {
    upstream = createServer((_req, res) => {
      calls++;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', 'backend_traffic');
      if (limited) { res.statusCode = 429; res.end('provider error'); return; }
      res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{value:123456789}}));
    });
    upstreamOrigin = await listen(upstream);
    app = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', origin);
        if (url.pathname === '/api/balance') {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const response = await handleBalance(new Request(url, {method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks).toString()}),
            (_url, options) => fetch(upstreamOrigin, options));
          res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
        }
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        if (path.includes('..')) {res.writeHead(400);res.end();return;}
        const contents = await readFile(join(process.cwd(),'dist',path));
        res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(contents);
      } catch { res.writeHead(500); res.end('Test harness error'); }
    });
    origin = await listen(app);
    browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox']});
  });
  afterAll(async () => { await browser?.close(); await Promise.all([app,upstream].filter(Boolean).map(server=>new Promise<void>(resolve=>server.close(()=>resolve())))); });
  it('renders a valid test balance despite invalid upstream CORS, then shows rate-limit failure without a stale score',async()=>{
    const page = await browser.newPage();
    const runtimeErrors: string[]=[];page.on('pageerror',error=>runtimeErrors.push(error.message));
    const browserRequests: string[]=[];page.on('request',request=>browserRequests.push(request.url()));
    await page.goto(origin);
    await page.getByLabel('SOLANA WALLET ADDRESS').fill('So11111111111111111111111111111111111111112');
    const responsePromise=page.waitForResponse(response=>response.url()===`${origin}/api/balance`);
    await page.getByRole('button',{name:'Roast my wallet'}).click();
    const response=await responsePromise;
    expect(response.status()).toBe(200);expect(response.headers()['access-control-allow-origin']).toBeUndefined();
    await page.getByText('Part-Time Degen',{exact:true}).waitFor();
    expect(await page.locator('.balance').innerText()).toContain('0.123456789');
    expect(await page.locator('.score').innerText()).toBe('65');
    const section = await page.locator('.result-section').elementHandle();
    const first=await page.locator('blockquote').innerText();
    const balance = await page.locator('.balance').innerText();
    const wallet = await page.locator('.result-top').innerText();
    const rank = await page.locator('.rank').innerText();
    const navigations: string[] = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.evaluate(() => {
      const state = { submits: 0, removed: false, canvasText: [] as string[] };
      Object.assign(window, { roastTest: state });
      document.addEventListener('submit', () => state.submits++);
      const section = document.querySelector('.result-section')!;
      new MutationObserver(records => {
        if (records.some(record => [...record.removedNodes].some(node => node === section || node.contains(section)))) state.removed = true;
      }).observe(document.getElementById('root')!, { childList: true, subtree: true });
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fillText>) {
        state.canvasText.push(args[0]);
        return fillText.apply(this, args);
      };
    });
    expect(await page.getByRole('button', { name: 'Roast again' }).getAttribute('type')).toBe('button');
    expect(await page.getByRole('button', { name: 'Download card' }).getAttribute('type')).toBe('button');
    const seen = new Set([first]);
    for (let click = 1; click <= 20; click++) {
      const previous = await page.locator('blockquote').innerText();
      await page.getByRole('button',{name:'Roast again'}).click();
      const current = await page.locator('blockquote').innerText();
      expect(current).not.toBe(previous);
      expect(roasts[65].map(roast => `“${roast}”`)).toContain(current);
      if (click < 20) { expect(seen.has(current)).toBe(false); seen.add(current); }
      else { expect(seen.size).toBe(20); expect(current).toBe(first); }
      expect(await section!.evaluate(node => node === document.querySelector('.result-section') && node.isConnected)).toBe(true);
      expect(await page.locator('.score').innerText()).toBe('65');
      expect(await page.locator('.balance').innerText()).toBe(balance);
      expect(await page.locator('.rank').innerText()).toBe(rank);
      expect(await page.locator('.result-top').innerText()).toBe(wallet);
      expect(await page.getByLabel('SOLANA WALLET ADDRESS').inputValue()).toBe('So11111111111111111111111111111111111111112');
      const share = new URL((await page.getByRole('link', { name: 'Share on X' }).getAttribute('href'))!);
      expect(share.searchParams.get('text')).toContain(current);
      if (click === 7) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download card' }).click();
        const download = await downloaded;
        expect(await download.failure()).toBeNull();
        const png = await readFile((await download.path())!);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
        const text = await page.evaluate(() => (window as unknown as { roastTest: { canvasText: string[] } }).roastTest.canvasText.join(' '));
        expect(text).toContain(current);
      }
      expect(calls).toBe(1);
      expect(browserRequests.filter(url => new URL(url).pathname === '/api/balance')).toHaveLength(1);
    }
    expect(navigations).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { roastTest: { submits: number; removed: boolean } }).roastTest)).toMatchObject({ submits: 0, removed: false });
    expect(browserRequests.every(url=>new URL(url).origin===origin)).toBe(true);
    limited=true;await page.getByRole('button',{name:'Roast my wallet'}).click();await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain('rate-limiting');expect(await page.locator('.score').count()).toBe(0);
    expect(runtimeErrors).toEqual([]);await page.close();
  },20000);
  it.each([
    { name: 'desktop', width: 1280, height: 900, touch: false },
    { name: 'mobile', width: 390, height: 844, touch: true },
  ])('one $name Roast Again interaction does not resubmit the focused wallet form', async ({ width, height, touch }) => {
    limited = false;
    calls = 0;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const page = await context.newPage();
    try {
      await page.goto(origin);
      await page.locator('#wallet').fill('So11111111111111111111111111111111111111112');
      await page.getByRole('button', { name: 'Roast my wallet' }).click();
      await page.locator('.result-section').waitFor();
      // Start observing only after the successful analysis, like a cleared Network log.
      const requests: string[] = [];
      const navigations: string[] = [];
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      const before = await page.locator('blockquote').innerText();
      const snapshot = await page.locator('.result-top').innerText();
      await page.locator('#wallet').focus();
      await page.evaluate(() => {
        const section = document.querySelector('.result-section')!;
        const state = { submits: [] as string[], clicks: [] as string[], removed: false };
        Object.assign(window, { singleRoastTest: state });
        document.addEventListener('submit', event => state.submits.push(event.submitter?.textContent ?? ''), true);
        document.addEventListener('click', event => {
          state.clicks.push((event.target as Element).closest('button')?.textContent ?? '');
        }, true);
        new MutationObserver(records => {
          if (records.some(record => [...record.removedNodes].some(node => node === section || node.contains(section)))) state.removed = true;
        }).observe(document.getElementById('root')!, { childList: true, subtree: true });
      });
      const button = page.getByRole('button', { name: 'Roast again' });
      expect(await button.evaluate(node => (node as HTMLButtonElement).form)).toBeNull();
      // Real pointer/touch events, with no forced click or direct handler invocation.
      if (touch) await button.tap();
      else await button.click();
      // Catch a delayed analysis response too (the reported production request took 258 ms).
      await page.waitForTimeout(600);
      expect(requests).toEqual([]);
      expect(calls).toBe(1);
      expect(navigations).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as {
        singleRoastTest: { submits: string[]; clicks: string[]; removed: boolean };
      }).singleRoastTest)).toEqual({ submits: [], clicks: ['↻ Roast again'], removed: false });
      expect(await page.locator('blockquote').innerText()).not.toBe(before);
      expect(await page.locator('.score').innerText()).toBe('65');
      expect(await page.locator('.balance').innerText()).toContain('0.123456789');
      expect(await page.locator('.result-top').innerText()).toBe(snapshot);
      expect(await page.locator('#wallet').inputValue()).toBe('So11111111111111111111111111111111111111112');
    } finally {
      await context.close();
    }
  }, 15000);
});
