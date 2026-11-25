import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API runs behind Caddy on http://localhost (backend `docker compose up`).
// Proxying keeps the panel same-origin, so the httpOnly refresh cookie just works.
const API = process.env.API_PROXY_TARGET ?? 'http://localhost';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: API, changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    css: false,
  },
});
