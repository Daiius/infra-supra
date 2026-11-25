import { defineConfig } from 'vitest/config';

// 環境非依存の純ロジックだけを置くパッケージなので node 環境の最小構成でよい（prd/02-architecture.md §2）。
export default defineConfig({
  test: {
    environment: 'node',
    // 手元の CPU を使い切らないよう、並べて回す worker は 8 まで（2026-11-25・ユーザーの要望。CI は 4 コアなのでそのまま）
    maxWorkers: 8,
    // worker は threads にし、ファイルごとにモジュールを読み直さない（isolate: false）。game のテストは vi.mock などで外を差し替えず、
    // 順序を入れ替えても通る（2026-11-26 に --sequence.shuffle で確かめた）。game の test:fast の分で約 12%・総当たりで約 1 割縮んだ。
    // ファイルをまたいで残るのは、動かないデータから作る小さなもの（始めの状態・テンプレートの事実の WeakMap）だけ
    pool: 'threads',
    isolate: false,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    // 基準プレイ（シード × 構成）を何本も回すテストが多く、全パッケージを並べて回すと既定の 5 秒を超えうる。
    // ファイルごとに上げていたのをここにまとめた（いちばん重い 1 本で約 6 秒。combo-sweep.*.test だけはファイルで別に上げる）
    testTimeout: 30_000,
  },
});
