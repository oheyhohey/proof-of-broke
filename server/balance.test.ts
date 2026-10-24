import { describe, expect, it, vi } from 'vitest';
import { handleBalance, MAINNET_RPC } from './balance';
import worker from './worker';
const address = 'So11111111111111111111111111111111111111112';
function request(body: unknown = {address}, headers: Record<string,string> = {}) {
  return new Request('https://proof.example/api/balance', { method: 'POST', headers: {'Content-Type':'application/json',Origin:'https://proof.example',...headers}, body:JSON.stringify(body) });
}
function rpc(value: unknown = 123456789) { return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:123},value}})); }
describe('restricted same-origin balance proxy', () => {
  it('constructs exactly one read-only upstream request and returns validated data', async () => {
    const fetcher=vi.fn().mockResolvedValue(rpc());
    const response=await handleBalance(request(),fetcher);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({jsonrpc:'2.0',id:1,result:{value:123456789}});
    expect(fetcher).toHaveBeenCalledOnce(); const [url,options]=fetcher.mock.calls[0];
    expect(url).toBe(MAINNET_RPC);expect(options.method).toBe('POST');expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual({jsonrpc:'2.0',id:1,method:'getBalance',params:[address,{commitment:'confirmed'}]});
    expect(options.headers).toEqual({'Content-Type':'application/json'});
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('preserves a real zero', async () => { expect((await (await handleBalance(request(),vi.fn().mockResolvedValue(rpc(0)))).json()).result.value).toBe(0); });
  it.each(['null','https://attacker.example'])('rejects Origin %s before upstream', async origin => {const fetcher=vi.fn();expect((await handleBalance(request({address},{Origin:origin}),fetcher)).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
  it('rejects cross-site fetch metadata', async()=>expect((await handleBalance(request({address},{'Sec-Fetch-Site':'cross-site'}),vi.fn())).status).toBe(403));
  it('permits non-browser clients without Origin', async()=>{const req=request();req.headers.delete('Origin');expect((await handleBalance(req,vi.fn().mockResolvedValue(rpc()))).status).toBe(200);});
  it.each(['GET','OPTIONS','PUT','DELETE'])('rejects method %s without permissive CORS',async method=>{const fetcher=vi.fn();const response=await handleBalance(new Request('https://proof.example/api/balance',{method}),fetcher);expect(response.status).toBe(405);expect(response.headers.get('Allow')).toBe('POST');expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);expect(fetcher).not.toHaveBeenCalled();});
  it.each([{},null,[],{address:'bad'},{address,address2:address},{address,url:'https://attacker.example'},{address,method:'sendTransaction'},[{address}]])('rejects invalid input %j before upstream',async body=>{const fetcher=vi.fn();expect((await handleBalance(request(body),fetcher)).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
  it('rejects non-JSON bodies',async()=>expect((await handleBalance(request({address},{'Content-Type':'text/plain'}))).status).toBe(415));
  it('rejects address-bearing query strings',async()=>{const req=new Request('https://proof.example/api/balance?address=abc',request());expect((await handleBalance(req)).status).toBe(400);});
  it('rejects oversized Content-Length before reading',async()=>expect((await handleBalance(request({address},{'Content-Length':'257'}))).status).toBe(413));
  it('bounds actual streamed bytes without Content-Length',async()=>{const fetcher=vi.fn();expect((await handleBalance(request({address:'a'.repeat(300)}),fetcher)).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
  it('rejects malformed JSON',async()=>{const req=new Request('https://proof.example/api/balance',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});expect((await handleBalance(req)).status).toBe(400);});
  it('never forwards caller cookies, auth, or origins to upstream',async()=>{const fetcher=vi.fn().mockResolvedValue(rpc());await handleBalance(request({address},{Cookie:'session=example',Authorization:'Bearer example'}),fetcher);expect(fetcher.mock.calls[0][1].headers).toEqual({'Content-Type':'application/json'});});
  it('discards invalid upstream CORS headers such as backend_traffic',async()=>{const upstream=rpc();upstream.headers.set('Access-Control-Allow-Origin','backend_traffic');upstream.headers.set('Set-Cookie','upstream=secret');const response=await handleBalance(request(),vi.fn().mockResolvedValue(upstream));expect(response.status).toBe(200);expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);expect(response.headers.has('Set-Cookie')).toBe(false);});
  it.each([[429,429],[403,503],[500,502],[301,502]])('maps upstream HTTP %s to %s without raw errors',async(status,expected)=>{const response=await handleBalance(request(),vi.fn().mockResolvedValue(new Response('sensitive provider error',{status})));expect(response.status).toBe(expected);const data=await response.json();expect(data.result).toBeUndefined();expect(data.error).not.toContain('sensitive');expect(response.headers.get('Cache-Control')).toBe('no-store');if(status===429)expect(response.headers.get('Retry-After')).toBe('60');});
  it.each([-1,NaN,null,'100',0.1,Number.MAX_SAFE_INTEGER+1])('rejects invalid or unsafe upstream value %s',async value=>{const response=await handleBalance(request(),vi.fn().mockResolvedValue(rpc(value)));expect(response.status).toBe(502);expect((await response.json()).result).toBeUndefined();});
  it.each([429,-32005,-32602])('handles JSON-RPC error %s',async code=>{const response=await handleBalance(request(),vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code,message:'do not leak me'}}))));expect(response.status).toBe(code===-32602?502:429);expect(JSON.stringify(await response.json())).not.toContain('do not leak');});
  it('rejects non-JSON upstream responses',async()=>expect((await handleBalance(request(),vi.fn().mockResolvedValue(new Response('<html>Blocked</html>')))).status).toBe(502));
  it('rejects an unexpected RPC response id',async()=>expect((await handleBalance(request(),vi.fn().mockResolvedValue(new Response(JSON.stringify({jsonrpc:'2.0',id:2,result:{value:0}}))))).status).toBe(502));
  it('returns an explicit network failure without a result',async()=>{const response=await handleBalance(request(),vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));expect(response.status).toBe(502);expect((await response.json()).result).toBeUndefined();});
  it('times out stalled upstream requests',async()=>{vi.useFakeTimers();try{const fetcher=vi.fn((_url,options)=>new Promise<Response>((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Aborted')))));const pending=handleBalance(request(),fetcher);await vi.advanceTimersByTimeAsync(8000);const response=await pending;expect(response.status).toBe(504);expect((await response.json()).result).toBeUndefined();}finally{vi.useRealTimers();}});
});
describe('Worker routing',()=>{
  it('serves static requests through the assets binding',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response('<html>App</html>'));const response=await worker.fetch(new Request('https://proof.example/'),{ASSETS:{fetch:fetcher}});expect(await response.text()).toContain('App');expect(fetcher).toHaveBeenCalledOnce();});
  it('does not return index.html for unknown API paths',async()=>{const fetcher=vi.fn();const response=await worker.fetch(new Request('https://proof.example/api/other'),{ASSETS:{fetch:fetcher}});expect(response.status).toBe(404);expect(fetcher).not.toHaveBeenCalled();});
});
