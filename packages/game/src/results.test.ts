// 振り返りの 4 軸（D-132・D-141）と終わり方（D-131）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  averageSatisfaction,
  isEdgeMonth,
  playStrategy,
  RESULT_AXES,
  resultAxesOf,
  type MonthReport,
  type PremiseSnapshot,
} from './index.ts';

const CF_FREE = 0;
const CF_PAID = 1;
const PRO = 3;
const idle = (stackIndex: number, seed = 42) =>
  playStrategy({ id: 'idle', label: '何もしない', stackIndex }, seed);

const snap = (
  ratio: number,
  effect: PremiseSnapshot['effect'] = 'block',
): PremiseSnapshot => ({
  id: `p:${effect}:${ratio}`,
  text: 'x',
  effect,
  ratio,
  hit: ratio >= 1,
  accumulates: false,
});
const month = (
  snapshots: PremiseSnapshot[],
  status: MonthReport['status'] = 'ok',
) => ({ status, snapshots });

describe('④ ギリギリを攻める（isEdgeMonth）', () => {
  it('使用率 90% 以上 100% 未満の上限があれば数え、境目は 90% を含み 100% を含まない', () => {
    expect(isEdgeMonth(month([snap(0.9)]))).toBe(true);
    expect(isEdgeMonth(month([snap(0.999)]))).toBe(true);
    expect(isEdgeMonth(month([snap(0.8999)]))).toBe(false);
    expect(isEdgeMonth(month([snap(1)]))).toBe(false);
    expect(isEdgeMonth(month([snap(0.5), snap(0.95)]))).toBe(true);
    expect(isEdgeMonth(month([]))).toBe(false);
  });

  it('止まった月（上限で止まった・自前の障害）は数えない。遅くなっただけの月は数える', () => {
    expect(isEdgeMonth(month([snap(0.95)], 'down'))).toBe(false);
    expect(isEdgeMonth(month([snap(0.95)], 'incident'))).toBe(false);
    expect(isEdgeMonth(month([snap(0.95)], 'slow'))).toBe(true);
  });

  it('数えるのは止まる・遅くなる・プランの変更が要る上限だけ（規約の制限・課金の境目は数えない。D-141）', () => {
    for (const e of ['block', 'throttle', 'upgrade-required'])
      expect(isEdgeMonth(month([snap(0.95, e)])), e).toBe(true);
    for (const e of ['policy', 'cost', 'adjust', 'info'])
      expect(isEdgeMonth(month([snap(0.95, e)])), e).toBe(false);
  });
});

describe('4 軸（resultAxesOf）', () => {
  it('並びは 所持金・満足度の平均・機能開発の累計・ギリギリを攻める', () => {
    expect(RESULT_AXES.map((a) => a.label)).toEqual([
      '所持金',
      '満足度の平均',
      '機能開発の累計',
      'ギリギリを攻める',
    ]);
  });

  it('値は最後の月の所持金・満足度の平均・機能ポイントの累計・ギリギリの月の数', () => {
    const st = idle(CF_PAID);
    const a = resultAxesOf(st);
    expect(a.cash).toBe(st.cash);
    expect(a.satisfaction).toBe(averageSatisfaction(st.history));
    expect(a.featurePoints).toBe(st.featurePoints);
    expect(a.edgeMonths).toBe(st.history.filter(isEdgeMonth).length);
    expect(a.edgeMonths).toBeGreaterThanOrEqual(0);
    expect(a.edgeMonths).toBeLessThanOrEqual(ARTICLE_COMMUNITY.months);
  });

  it('止まった月は ④ に数えず、止まった回数は軸に入れない', () => {
    const st = idle(CF_FREE);
    expect(st.end?.reason).toBe('outages');
    const down = st.history.filter((r) => r.status === 'down');
    expect(down.length).toBeGreaterThan(0);
    expect(down.some(isEdgeMonth)).toBe(false);
    expect(Object.keys(resultAxesOf(st))).not.toContain('outages');
  });
});

describe('終わり方（D-131）', () => {
  it('12 か月を走り切れば、所持金が少なくても完走（合否を付けない）', () => {
    const st = idle(PRO);
    expect(st.phase).toBe('completed');
    expect(st.end).toEqual({ reason: 'completed', month: 12 });
    expect(st.cash).toBeLessThan(idle(CF_PAID).cash);
  });

  it('途中終了の 3 条件はそのまま（止まった月の上限を超えると lost）', () => {
    const st = idle(CF_FREE);
    expect(st.phase).toBe('lost');
    expect(st.end?.month).toBeLessThan(12);
  });
});
