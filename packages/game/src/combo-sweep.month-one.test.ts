// 組み合わせの総当たり（prd/05）のうち、始める画面の 1 か月目の見込み（D-72）。共通の部品は combo-sweep.test-helpers.ts。
import { describe, expect, it, vi } from 'vitest';

// 1 群で数百の組を 12 か月回し、1 本で十数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import {
  commentAt,
  GROUPS,
  selectableCombos,
} from './combo-sweep.test-helpers.ts';
import {
  newGame,
  partsOfComments,
  playMonth,
  setupCommentOptions,
  setupMonthOneEstimate,
  setupRevalidateOptions,
  STACKS,
} from './index.ts';

// 始める画面の 1 か月目の見込み（D-72）: 出来事の無い 1 か月目の実際の費用と一致し、所持金が尽きる組で警告が出る
describe('1 か月目の費用の見込み（D-72）', () => {
  it('出来事の無い 1 か月目の実際の費用・所持金切れと一致する（pairwise の全組み合わせ）', () => {
    const problems: string[] = [];
    let checked = 0;
    let short = 0;
    for (const { sc, fw, stackIndex } of GROUPS) {
      const revalidate = setupRevalidateOptions(sc, fw).map((o) => o.value);
      const comments = setupCommentOptions(sc, fw).map((o) => o.value);
      selectableCombos(sc, stackIndex, fw).forEach((c, i) => {
        const r = revalidate.length
          ? revalidate[i % revalidate.length]
          : undefined;
        const cm = commentAt(comments, i, revalidate.length);
        const id = `${sc.id} × ${fw} × ${STACKS[stackIndex]!.id} ${JSON.stringify(c)} r=${r} cm=${cm}`;
        const e = setupMonthOneEstimate(sc, stackIndex, fw, c, r, cm);
        // 出来事も障害も無い 1 か月目になるシードを探す
        for (let seed = 1; seed <= 30; seed++) {
          const s = playMonth(
            newGame(
              stackIndex,
              seed,
              sc,
              undefined,
              fw,
              c,
              r,
              partsOfComments(sc, cm),
            ),
          );
          const h = s.history[0]!;
          if (h.events.length > 0 || h.status === 'incident') continue;
          checked++;
          const near = (a: number, b: number) =>
            Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
          if (!near(e.costUsd, h.infraCost))
            problems.push(`${id}: 費用 ${e.costUsd} ≠ ${h.infraCost}`);
          if (!near(e.revenueUsd, h.revenue))
            problems.push(`${id}: 収益 ${e.revenueUsd} ≠ ${h.revenue}`);
          const ranOut = s.end?.reason === 'cash' && s.end.month === 1;
          if (e.short !== ranOut)
            problems.push(`${id}: 見込み ${e.short} ≠ 所持金切れ ${ranOut}`);
          if (e.short) {
            short++;
            if (e.topLines.length === 0) problems.push(`${id}: 主な費用が無い`);
          }
          break;
        }
      });
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(500);
    // 尽きる組は実際にある（網羅テスト #36 で約 390 組）
    expect(short).toBeGreaterThan(50);
  });
});
