import { handleBalance } from './balance';
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/balance') return handleBalance(request);
    if (path.startsWith('/api/')) return Response.json({ error: 'Unknown API endpoint.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return env.ASSETS.fetch(request);
  },
};
