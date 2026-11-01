// 見積モードの入力の組み立て（D-73）: 選べる部品の規則が始める画面と同じで、Workload がゲームの 1 か月目と同じ数え方になること。
import { composeStack, loadPriceBooks, STACK_DEFS } from 'catalog';
import { estimate } from 'estimator';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVALIDATE_SEC,
  DEFAULT_START_DATE,
  estimateComponents,
  estimateWorkload,
  frameworksOf,
  newGame,
  playMonth,
  SCENARIOS,
  setupProblem,
  stackSupports,
  STACKS,
  USD_JPY,
  type FrameworkId,
} from './index.ts';

const books = loadPriceBooks();
const usdOf = (t: Partial<Record<string, number>>) =>
  (t.USD ?? 0) + (t.JPY ?? 0) / USD_JPY;

describe('estimateComponents', () => {
  it('すべてのシナリオ・フレームワーク・構成で、既定の部品は始める画面の選び終えた状態になる', () => {
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed)
        for (const s of STACKS) {
          if (!stackSupports(s.index, fw)) continue;
          const { chosen } = estimateComponents(sc, s.index, fw);
          expect(setupProblem(sc, s.index, fw, chosen), `${s.id} ${fw}`).toBe(
            null,
          );
        }
  });

  it('既定の部品は、ゲームの何もしない基準プレイ（部品を選ばずに始めた newGame）と同じ。指定した部品はそれを優先する', () => {
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed)
        for (const s of STACKS) {
          if (!stackSupports(s.index, fw)) continue;
          expect(
            estimateComponents(sc, s.index, fw).components,
            `${sc.id} ${fw} ${s.id}`,
          ).toEqual(newGame(s.index, 1, sc, DEFAULT_START_DATE, fw).components);
        }
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    expect(estimateComponents(sc, cf, 'nextjs').components.isrCache).toBe('kv');
    expect(
      estimateComponents(sc, cf, 'nextjs', { isrCache: 'workers-cache' })
        .components.isrCache,
    ).toBe('workers-cache');
  });

  it('選べない部品は捨て、選べる部品は残す', () => {
    const sc = SCENARIOS['article-community']!;
    const cf = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
    const { chosen } = estimateComponents(sc, cf, 'nextjs', {
      images: 'none',
      isrCache: 'no-such-part',
    });
    expect(chosen.images).toBe('none');
    expect(chosen.isrCache).not.toBe('no-such-part');
  });
});

describe('estimateWorkload', () => {
  it('始めた月の PV では、ゲームの 1 か月目のインフラ費用と同じになる（出来事の無い月）', () => {
    let checked = 0;
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed as FrameworkId[])
        for (const stackId of [
          'cloudflare-vinext-paid',
          'vercel-supabase-pro',
        ]) {
          const i = STACKS.findIndex((s) => s.id === stackId);
          const { chosen, components } = estimateComponents(sc, i, fw);
          // 出来事で PV が動かない最初のシード
          const report = Array.from({ length: 20 }, (_, k) =>
            playMonth(
              newGame(i, k + 1, sc, DEFAULT_START_DATE, fw, chosen),
            ).history.at(0)!,
          ).find((r) => r.pv === r.basePV && !r.trafficNote && r.seats === 0);
          if (!report) continue;
          const r = estimate({
            workload: estimateWorkload(sc, {
              pv: sc.scale.startPV,
              stackIndex: i,
              framework: fw,
              components,
              settings: {
                imageKB: 150,
                variants: 3,
                revalidateSec: DEFAULT_REVALIDATE_SEC,
              },
            }),
            architecture: composeStack(STACK_DEFS[i]!, components, {
              framework: fw,
            }),
            books,
          });
          expect(usdOf(r.bill.totals), `${sc.id} ${fw} ${stackId}`).toBeCloseTo(
            report.infraCost,
            6,
          );
          checked++;
        }
    expect(checked).toBeGreaterThan(4);
  });

  it('PV を増やすと費用は減らない', () => {
    const sc = SCENARIOS['article-community']!;
    const i = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
    const { components } = estimateComponents(sc, i, 'nextjs');
    const cost = (pv: number) =>
      usdOf(
        estimate({
          workload: estimateWorkload(sc, {
            pv,
            stackIndex: i,
            framework: 'nextjs',
            components,
            settings: { imageKB: 150, variants: 3, revalidateSec: 300 },
          }),
          architecture: composeStack(STACK_DEFS[i]!, components),
          books,
        }).bill.totals,
      );
    expect(cost(3_000_000)).toBeGreaterThan(cost(300_000));
  });
});
