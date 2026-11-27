// 組み合わせの総当たり（prd/05）のうち、kifu-analysis のシナリオの vite-spaの始める画面の 1 か月目の見込み（D-72）。シナリオ（棋譜解析はフレームワーク）ごとの
// ファイルに分けて並べて回す。中身は combo-sweep.test-helpers.ts の describeMonthOneSweep。
import { vi } from 'vitest';

// 1 群で数百〜数千の組を回し、1 本で数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import { describeMonthOneSweep } from './combo-sweep.test-helpers.ts';

describeMonthOneSweep('kifu-analysis', { checked: 2700, short: 0 }, 'vite-spa');
