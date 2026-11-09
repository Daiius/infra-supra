// 振り返りの 4 軸（D-132・D-166）と終わり方（D-131）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  averageSatisfaction,
  DIRECTED_AXES,
  playStrategy,
  RESULT_AXES,
  resultAxesOf,
} from './index.ts';

const CF_FREE = 0;
const CF_PAID = 1;
const PRO = 3;
const idle = (stackIndex: number, seed = 42) =>
  playStrategy({ id: 'idle', label: '何もしない', stackIndex }, seed);

describe('4 軸（resultAxesOf）', () => {
  it('並びは 所持金・満足度の平均・機能開発の累計・費用の合計（D-166）', () => {
    expect(RESULT_AXES.map((a) => a.label)).toEqual([
      '所持金',
      '満足度の平均',
      '機能開発の累計',
      '費用の合計',
    ]);
  });

  it('④ 費用の合計だけが向きを持たない（D-166）', () => {
    expect(DIRECTED_AXES).toEqual(['cash', 'satisfaction', 'featurePoints']);
    expect(RESULT_AXES.find((a) => a.id === 'totalCost')?.directed).toBe(false);
  });

  it('値は最後の月の所持金・満足度の平均・機能ポイントの累計・月の報告の費用の合計', () => {
    const st = idle(CF_PAID);
    const a = resultAxesOf(st);
    expect(a.cash).toBe(st.cash);
    expect(a.satisfaction).toBe(averageSatisfaction(st.history));
    expect(a.featurePoints).toBe(st.featurePoints);
    expect(st.history).toHaveLength(ARTICLE_COMMUNITY.months);
    expect(a.totalCost).toBe(
      st.history.reduce((sum, r) => sum + r.infraCost, 0),
    );
    expect(a.totalCost).toBeGreaterThan(0);
  });

  it('途中終了ではプレイした月だけの費用を足し、止まった回数は軸に入れない', () => {
    const st = idle(CF_FREE);
    expect(st.end?.reason).toBe('outages');
    expect(st.history.length).toBeLessThan(ARTICLE_COMMUNITY.months);
    expect(resultAxesOf(st).totalCost).toBe(
      st.history.reduce((sum, r) => sum + r.infraCost, 0),
    );
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
