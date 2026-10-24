// Test-only upstream fixture. Production always calls the fixed mainnet URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { handleBalance } from '../server/balance';

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
    const first=await page.locator('blockquote').innerText();
    await page.getByRole('button',{name:'Roast again'}).click();
    expect(await page.locator('blockquote').innerText()).not.toBe(first);expect(calls).toBe(1);
    expect(browserRequests.every(url=>new URL(url).origin===origin)).toBe(true);
    limited=true;await page.getByRole('button',{name:'Roast my wallet'}).click();await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').innerText()).toContain('rate-limiting');expect(await page.locator('.score').count()).toBe(0);
    expect(runtimeErrors).toEqual([]);await page.close();
  },20000);
});
