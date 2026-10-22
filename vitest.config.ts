import { defineConfig } from 'vitest/config';

// Server tests only; the web app has its own config (web/vite.config.ts) and runs via `npm run verify:web`.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
