import { defineConfig } from 'vitest/config';

// 環境非依存の純ロジックだけを置くパッケージなので node 環境の最小構成でよい（prd/02-architecture.md §2）。
export default defineConfig({
  test: {
    environment: 'node',
    // 手元の CPU を使い切らないよう、並べて回す worker は 8 まで（2026-11-25・ユーザーの要望。CI は 4 コアなのでそのまま）
    maxWorkers: 8,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
