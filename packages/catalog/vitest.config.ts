import { defineConfig } from 'vitest/config';

// 環境非依存の純ロジックだけを置くパッケージなので node 環境の最小構成でよい（prd/02-architecture.md §2）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
