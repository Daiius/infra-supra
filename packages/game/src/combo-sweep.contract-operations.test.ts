// 組み合わせの総当たり（性質ベース。prd/05）のうち、contract-operations のシナリオの組（フレームワーク × 構成 × 部品の pairwise）。
// 何もしないで最後まで回し、壊れていないことを確かめる。中身は combo-sweep.test-helpers.ts の sweepGroup（シナリオごとにファイルを分けて並べて回す）。
import { describe, it, vi } from 'vitest';

// 1 群で数百の組を 12 か月回し、1 本で十数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import { groupName, groupsOf, sweepGroup } from './combo-sweep.test-helpers.ts';

describe('組み合わせの総当たり（contract-operations × フレームワーク × 構成 × 部品の pairwise）', () => {
  it.each(groupsOf('contract-operations').map((g) => [groupName(g), g]))(
    '%s',
    (_, g) => sweepGroup(g),
  );
});
