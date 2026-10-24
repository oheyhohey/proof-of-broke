import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Wrangler normalizes its local request URL to port 8787. Validate the browser's
// Vite origin before omitting it on this internal server-to-server development hop.
const apiProxy: ProxyOptions = {
  target: 'http://127.0.0.1:8787',
  configure(proxy) {
    proxy.on('proxyReq', (outgoing, incoming) => {
      if (incoming.headers.origin === `http://${incoming.headers.host}`) outgoing.removeHeader('Origin');
    });
  },
};
export default defineConfig({
  plugins: [react(), tailwindcss()], base: './',
  server: { proxy: { '/api': apiProxy } },
  preview: { proxy: { '/api': apiProxy } },
});
