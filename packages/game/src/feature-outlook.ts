// 機能開発の効き目の見せ方（2026-11-04 の要望・D-122）。計算は配分（progressOf → allocateEffort）と段階（featureStageOf）を
// そのまま呼ぶだけで、式を持たない。画面はここの値を出す（web で式を複製しない）。
import { applyActions } from './actions/apply.ts';
import { scenarioOf } from './core.ts';
import { progressOf } from './month/transitions.ts';
import { featureStageOf, type EffortBreakdown, type Stage } from './rules.ts';
import type { Scenario } from './scenario.ts';
import type { Action, GameState } from './state.ts';

export type FeatureProgress = {
  /** 機能開発の累計。 */
  total: number;
  /** 期待（月の期待 × 経過月数）。 */
  expected: number;
  /** 累計と期待の比から決まる「機能」の段階（メールが届かない分の下げは含めない）。 */
  stage: Stage;
  /** 「普通」になる累計の下限（期待 × 普通の境目）。 */
  fairAt: number;
  /** 「良い」になる累計の下限（期待 × 良いの境目）。 */
  goodAt: number;
};

/** month か月目の終わりに累計が total のときの、期待と「機能」の段階。 */
export function featureProgressOf(
  sc: Scenario,
  total: number,
  month: number,
): FeatureProgress {
  const ft = sc.satisfaction.feature;
  const expected = ft.expectedPerMonth * month;
  return {
    total,
    expected,
    stage: featureStageOf(expected > 0 ? total / expected : 1, ft),
    fairAt: expected * ft.fair,
    goodAt: expected * ft.good,
  };
}

export type FeatureOutlook = FeatureProgress & {
  /** 見込みの月（来月）。 */
  month: number;
  /** 来月の機能開発（余り + 機能の追加の作業 + 加点）。 */
  feature: number;
  /** 選んだ行動（提案への返事を含む）で来月の機能開発が変わる量（行動を何も選ばないときとの差）。 */
  change: number;
  /** 来月の手間の配分の見込み（月ごとの積み上げのグラフ用）。 */
  effort: EffortBreakdown;
};

/**
 * 選んだ行動を当てたときの、来月の機能開発の見込みと、来月の終わりの累計・期待・「機能」の段階。
 * 配分は playMonth と同じ progressOf を使う。来月に新しく起きる出来事の対応の手間は含めない（見込み）。
 */
export function featureOutlook(
  state: GameState,
  actions: readonly Action[],
): FeatureOutlook {
  const month = state.history.length + 1;
  const effort = progressOf(applyActions(state, actions)).effort;
  const feature = effort.feature;
  const base = progressOf(state).effort.feature;
  return {
    ...featureProgressOf(
      scenarioOf(state),
      state.featurePoints + feature,
      month,
    ),
    month,
    feature,
    change: feature - base,
    effort,
  };
}

/**
 * 選んだ行動を当てたときの、この先 months か月の機能開発の累計の見込み（添字 0 が来月）。提案を受けるか断るかの比較に使う。
 * 毎月 progressOf で配り、割り込み（機能の追加の作業を含む）の残りの月を減らし、乗り換えなどの進みを足す。
 * 新しく起きる出来事・乗り換えの切り替え後の維持の変化は含めない（見込み）。
 */
export function featureProjection(
  state: GameState,
  actions: readonly Action[],
  months: number,
): number[] {
  let s = applyActions(state, actions);
  const out: number[] = [];
  for (let k = 0; k < months; k++) {
    const p = progressOf(s);
    out.push(p.featurePoints);
    s = {
      ...s,
      featurePoints: p.featurePoints,
      plannedEffort: 0,
      migration: p.migration,
      componentSwap: p.componentSwap,
      rewrite: p.rewrite,
      interrupts: s.interrupts
        .map((i) => ({ ...i, months: i.months - 1 }))
        .filter((i) => i.months > 0),
    };
  }
  return out;
}

/**
 * 余った手間が何に効くかの説明（手間の欄・始める画面の ⓘ で共用）。境目はシナリオの値から組む。
 */
export function featureRuleText(sc: Scenario): string {
  const ft = sc.satisfaction.feature;
  return `余った手間は機能開発に回る。機能開発の累計が期待（月 ${ft.expectedPerMonth} × 経過月数）の ${ft.good} 倍以上なら満足度の「機能」は良い、${ft.fair} 倍以上なら普通、それより下は悪い。満足度は評判を通して PV の伸びに効く。`;
}
