import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Bundled assets only (no CDN, no remote fonts): the UI must run on a ship LAN with no internet.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
