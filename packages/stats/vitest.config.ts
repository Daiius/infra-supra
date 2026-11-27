import { defineConfig } from 'vitest/config';

// DB は実 Postgres を使わない。drizzle の層のテスト（db/*.test.ts）は PGlite（wasm の Postgres）に同じ migration を当てる。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 再生（12 か月）と PGlite の起動があるので既定の 5 秒より長くする（game と同じ）
    testTimeout: 30_000,
  },
});
