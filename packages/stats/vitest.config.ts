import { defineConfig } from 'vitest/config';

// DB は実 Postgres を使わない。drizzle の層のテスト（db/*.test.ts）は PGlite（wasm の Postgres）に同じ migration を当てる。
export default defineConfig({
  test: {
    environment: 'node',
    // 手元の CPU を使い切らないよう、並べて回す worker は 8 まで（2026-11-25・ユーザーの要望。CI は 4 コアなのでそのまま）
    maxWorkers: 8,
    include: ['src/**/*.test.ts'],
    // 再生（12 か月）と PGlite の起動があるので既定の 5 秒より長くする（game と同じ）
    testTimeout: 30_000,
  },
});
