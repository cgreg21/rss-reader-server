import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { alias: { 'cloudflare:workers': new URL('./test/cloudflare-workers.stub.ts', import.meta.url).pathname } },
});
