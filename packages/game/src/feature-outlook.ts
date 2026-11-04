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
  /**
   * 来月の終わりまでに増える機能開発（来月の余り + 機能の追加の作業 + 加点 + 受けた提案が今すぐ足す加点）。
   * 来月の配分（effort.feature）と違うのは、作業を伴わない提案の加点（受託の c-p-members など）があるときだけ。
   */
  feature: number;
  /** 選んだ行動（提案への返事を含む）で来月の機能開発が変わる量（行動を何も選ばないときとの差）。 */
  change: number;
  /** 来月の手間の配分の見込み（手間の輪のグラフ用）。 */
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
  // 行動を当てた後の状態から配る（作業を伴わない提案の加点は、受けた時点で累計に入る。OCL-750B471F）
  const progress = progressOf(applyActions(state, actions));
  const effort = progress.effort;
  const feature = progress.featurePoints - state.featurePoints;
  const base = progressOf(state).effort.feature;
  return {
    ...featureProgressOf(scenarioOf(state), progress.featurePoints, month),
    month,
    feature,
    change: feature - base,
    effort,
  };
}

/**
 * 余った手間が何に効くかの説明（手間の欄・始める画面の ⓘ で共用）。境目はシナリオの値から組む。
 */
export function featureRuleText(sc: Scenario): string {
  const ft = sc.satisfaction.feature;
  return `余った手間は機能開発に回る。機能開発の累計が期待（月 ${ft.expectedPerMonth} × 経過月数）の ${ft.good} 倍以上なら満足度の「機能」は良い、${ft.fair} 倍以上なら普通、それより下は悪い。満足度は評判を通して PV の伸びに効く。`;
}
