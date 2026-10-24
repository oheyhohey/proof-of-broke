import { describe, expect, it, vi } from 'vitest';
import { handleBalance } from './balance';
import worker from './worker';
const address='So11111111111111111111111111111111111111112';
const secret='test-only-private-secret';
const rpcUrl=`https://mainnet.helius-rpc.com/?api-key=${secret}`;
const env={SOLANA_RPC_URL:rpcUrl};
const request=()=>new Request('https://proof.example/api/balance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})});
function response(data: unknown,headers: Record<string,string>={}) { return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json',...headers}}); }
function envelope(value: unknown) { return {jsonrpc:'2.0',id:1,result:{value}}; }
async function diagnose(upstream: Response|Error) {
  const fetcher=upstream instanceof Error?vi.fn().mockRejectedValue(upstream):vi.fn().mockResolvedValue(upstream);
  const result=await handleBalance(request(),fetcher,env);
  const data=await result.json();
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
  expect(data.result).toBeUndefined();
  // Deliberately include sensitive-looking values in provider payloads/exceptions.
  const serialized=JSON.stringify(data);
  for(const forbidden of [address,secret,rpcUrl,'sensitive-provider-payload','sensitive-header'])expect(serialized).not.toContain(forbidden);
  return {result,data,fetcher};
}
describe('sanitized production diagnostics',()=>{
  it('separates a fetch rejection from parsing and validation',async()=>{
    const {data}=await diagnose(new TypeError(`${rpcUrl} ${address} sensitive-provider-payload`));
    expect(data.code).toBe('RPC_FETCH_FAILED');expect(data.error).toContain('[RPC_FETCH_FAILED]');
    expect(data.diagnostics).toEqual({provider:'helius',stage:'fetch'});
  });
  it.each([[401,'RPC_AUTH_ERROR',503],[403,'RPC_ACCESS_DENIED',503],[429,'RPC_RATE_LIMIT',429],[500,'RPC_HTTP_ERROR',502]])('identifies upstream HTTP %s',async(status,code,expected)=>{
    const {result,data}=await diagnose(new Response(`${address} ${secret} sensitive-provider-payload`,{status:status as number,headers:{'Content-Type':`text/html; address=${address}`,'X-Private':'sensitive-header'}}));
    expect(result.status).toBe(expected);expect(data.code).toBe(code);expect(data.diagnostics).toEqual({provider:'helius',stage:'http',upstreamStatus:status,contentType:'html'});
    expect(result.headers.get('X-Private')).toBeNull();
  });
  it('distinguishes a successful HTTP block page from a connection failure',async()=>{
    const {data}=await diagnose(new Response(`<html>${secret} ${address} sensitive-provider-payload</html>`,{headers:{'Content-Type':'text/html'}}));
    expect(data.code).toBe('RPC_JSON_INVALID');expect(data.diagnostics).toEqual({provider:'helius',stage:'parse',upstreamStatus:200,contentType:'html'});
  });
  it('distinguishes a broken response stream from JSON syntax errors',async()=>{
    const body=new ReadableStream({start(controller){controller.error(new Error(`${rpcUrl} sensitive-provider-payload`));}});
    const {data}=await diagnose(new Response(body,{headers:{'Content-Type':'application/json'}}));
    expect(data.code).toBe('RPC_BODY_READ_FAILED');expect(data.diagnostics.stage).toBe('read');
  });
  it.each([{},null,{jsonrpc:'1.0',id:1,result:{value:0}},{jsonrpc:'2.0',id:2,result:{value:0}}])('distinguishes schema mismatch %j',async value=>{
    const {data}=await diagnose(response(value));expect(data.code).toBe('RPC_RESPONSE_INVALID');expect(data.diagnostics.stage).toBe('validate');
  });
  it.each([null,'100',-1,0.1])('distinguishes invalid balance %s',async value=>{
    const {data}=await diagnose(response(envelope(value)));expect(data.code).toBe('RPC_BALANCE_INVALID');
  });
  it('identifies unsafe large balances instead of blaming the network',async()=>{
    const {data}=await diagnose(response(envelope(11_175_975_387_100_000)));expect(data.code).toBe('RPC_BALANCE_UNSAFE');expect(data.diagnostics.stage).toBe('validate');
  });
  it('returns only the numeric JSON-RPC code, never message/data',async()=>{
    const {data}=await diagnose(response({error:{code:-32602,message:`${address} ${secret}`,data:'sensitive-provider-payload'}}));
    expect(data.code).toBe('RPC_ERROR');expect(data.diagnostics.rpcCode).toBe(-32602);
  });
  it('does not echo nonnumeric protocol codes',async()=>{
    const {data}=await diagnose(response({error:{code:secret,message:address}}));expect(data.diagnostics.rpcCode).toBeUndefined();
  });
  it.each([false,true])('caps oversized upstream bodies (declared Content-Length: %s)',async declared=>{
    const headers: Record<string,string>={};if(declared)headers['Content-Length']='17000';
    const {data}=await diagnose(new Response('x'.repeat(17000),{headers}));expect(data.code).toBe('RPC_RESPONSE_TOO_LARGE');expect(data.diagnostics.stage).toBe('read');
  });
  it('marks a timeout separately without raw abort errors',async()=>{
    vi.useFakeTimers();try{
      const fetcher=vi.fn((_url,options)=>new Promise<Response>((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error(secret)))));
      const pending=handleBalance(request(),fetcher,env);await vi.advanceTimersByTimeAsync(8000);
      const result=await pending;const data=await result.json();expect(result.status).toBe(504);expect(data.code).toBe('RPC_TIMEOUT');expect(JSON.stringify(data)).not.toContain(secret);
    }finally{vi.useRealTimers();}
  });
  it('fails invalid server configuration without a request or fallback',async()=>{
    const fetcher=vi.fn();const result=await handleBalance(request(),fetcher,{SOLANA_RPC_URL:`https://attacker.example/${secret}`});const data=await result.json();
    expect(result.status).toBe(503);expect(data.code).toBe('RPC_CONFIG_ERROR');expect(data.diagnostics).toEqual({provider:'unconfigured',stage:'config'});expect(JSON.stringify(data)).not.toContain(secret);expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses only the operator-configured URL without retries',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(envelope(0)));const result=await handleBalance(request(),fetcher,env);
    expect(result.status).toBe(200);expect((await result.json()).result.value).toBe(0);expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toBe(rpcUrl);
  });
  it('passes the Worker secret to server transport, not to browser responses',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(envelope(123)));vi.stubGlobal('fetch',fetcher);
    try{const result=await worker.fetch(request(),{...env,ASSETS:{fetch:vi.fn()}});expect(fetcher.mock.calls[0][0]).toBe(rpcUrl);expect(await result.json()).toEqual(envelope(123));}finally{vi.unstubAllGlobals();}
  });
  it('handles provider setup through the Alchemy mainnet secret too',async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error(secret));const result=await handleBalance(request(),fetcher,{SOLANA_RPC_URL:`https://solana-mainnet.g.alchemy.com/v2/${secret}`});const data=await result.json();expect(data.diagnostics.provider).toBe('alchemy');expect(JSON.stringify(data)).not.toContain(secret);
  });
});
