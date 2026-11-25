// 組み合わせの総当たり（prd/05）のうち、kifu-analysis のシナリオの astro からのアプリの作り直し（D-81）。フレームワークごとのファイルに分けて
// 並べて回す。中身は combo-sweep.test-helpers.ts の describeRewriteSweep。
import { vi } from 'vitest';

// 1 群で数百の組を 12 か月回し、1 本で十数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import { describeRewriteSweep } from './combo-sweep.test-helpers.ts';

describeRewriteSweep('kifu-analysis', 0, 'astro');
