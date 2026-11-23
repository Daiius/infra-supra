// 組み合わせの総当たり（性質ベース。prd/05）: 2 シナリオ × フレームワーク × 構成（隠した構成を除く。D-100）のすべてと、
// 始める画面で選べる部品の pairwise の組み合わせ（どの 2 つのスロットの選択肢の組も、少なくとも 1 つの組み合わせに出る。D-114 CP-14）で、
// 何もしないで最後まで（終わるまで）回し、壊れていないことを確かめる。金額そのものは期待値に書かない（実在の料金のため）。
// 部品の直積は事業者をまたぐ部品（D-114）で桁で増えるので、2026-11-04 に直積から pairwise に切り替えた。構成ごとの既定の部品の組み合わせは必ず回す。
// このファイルは列挙の確かめ（組み合わせの数・pairwise の覆い方）。回す組はシナリオごとの combo-sweep.<シナリオ>.test.ts。
import type { Choices, SlotId } from 'catalog';
import { describe, expect, it, vi } from 'vitest';

// 1 群で数百の組を 12 か月回し、1 本で十数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import {
  choosable,
  GROUPS,
  normalizeChoices,
  pairwiseOf,
  selectableCombos,
} from './combo-sweep.test-helpers.ts';
import { componentConflict, newGame, STACKS } from './index.ts';

describe('組み合わせの総当たり（2 シナリオ × フレームワーク × 構成 × 部品の pairwise）', () => {
  it('組み合わせは十分にある（列挙が空振りしていない）', () => {
    const n = GROUPS.reduce(
      (a, g) => a + selectableCombos(g.sc, g.stackIndex, g.fw).length,
      0,
    );
    expect(GROUPS.length).toBeGreaterThan(20);
    expect(n).toBeGreaterThan(500);
  });

  it('pairwise の組み合わせは、作れる 2 つの組をすべて覆い、作れない組には直接の理由がある（選択で消える・依存に当たる）', () => {
    const problems: string[] = [];
    for (const g of GROUPS) {
      const r = pairwiseOf(g.sc, g.stackIndex, g.fw);
      const platform = STACKS[g.stackIndex]!.provider;
      const id = `${g.sc.id} × ${g.fw} × ${STACKS[g.stackIndex]!.id}`;
      // 先頭は構成の既定の部品（土台の既定の総当たり）
      expect(r.combos[0]).toEqual(
        normalizeChoices(
          g.sc,
          g.stackIndex,
          g.fw,
          newGame(g.stackIndex, 0, g.sc, undefined, g.fw).components,
        ),
      );
      for (const p of r.infeasible) {
        const [[x, a], [y, b]] = p
          .split('&')
          .map((s) => s.split('=') as [SlotId, string]) as [
          [SlotId, string],
          [SlotId, string],
        ];
        const both: Choices = { [x]: a, [y]: b };
        const visible = choosable(g.sc, g.stackIndex, g.fw, both).map(
          (s) => s.slot,
        );
        const direct =
          !visible.includes(x) ||
          !visible.includes(y) ||
          componentConflict(platform, x, a, both, g.fw) !== null ||
          componentConflict(platform, y, b, both, g.fw) !== null;
        if (!direct)
          problems.push(`${id}: ${p} が作れない（直接の理由が無い）`);
      }
    }
    expect(problems).toEqual([]);
  });
});
