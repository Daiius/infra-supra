// 振り返りの 4 軸（D-132・D-166・prd/15 §2）。完走・途中終了のどちらでも、終わった状態から同じ関数で数える
// （段 2 ではサーバーも同じ関数で再生した結果を数え、クライアントの値と照合する。prd/15 §5）。
// どれも単体で意味が分かる値だけで、重みで 1 つの点数にまとめない。
import { averageSatisfaction } from './month/satisfaction.ts';
import type { GameState } from './state.ts';

export type ResultAxes = {
  /** ① 所持金（最後の月。完走なら 12 か月目）。 */
  cash: number;
  /** ② 満足度の平均（今の評価と同じ値）。 */
  satisfaction: number;
  /** ③ 機能開発の累計（prd/07 §9.4）。 */
  featurePoints: number;
  /** ④ 費用の合計: プレイした月のインフラの費用（月の報告の費用）の合計（ドル。D-166）。 */
  totalCost: number;
};

export type ResultAxisId = keyof ResultAxes;

/**
 * 並べる順（D-132・D-166）。`directed` は「大きいほど上位」の向きを持つか。
 * ④ 費用の合計は向きを持たない（高いから良い・低いから良いとは言わない）ので、上位 %・上位の判定・
 * 花火の段・自己ベスト・順位を出さない（前回との差と分布の中の位置だけ）。
 */
export const RESULT_AXES: readonly {
  id: ResultAxisId;
  label: string;
  directed: boolean;
}[] = [
  { id: 'cash', label: '所持金', directed: true },
  { id: 'satisfaction', label: '満足度の平均', directed: true },
  { id: 'featurePoints', label: '機能開発の累計', directed: true },
  { id: 'totalCost', label: '費用の合計', directed: false },
];

/** 向きを持つ軸（上位 %・花火の段・自己ベストに使う。D-166）。 */
export const DIRECTED_AXES: readonly ResultAxisId[] = RESULT_AXES.filter(
  (a) => a.directed,
).map((a) => a.id);

/** 4 軸の値（純粋関数）。止まった月の数は軸にしない（振り返りに回数として出す。D-132）。 */
export function resultAxesOf(
  state: Pick<GameState, 'cash' | 'history' | 'featurePoints'>,
): ResultAxes {
  return {
    cash: state.cash,
    satisfaction: averageSatisfaction(state.history),
    featurePoints: state.featurePoints,
    totalCost: state.history.reduce((a, r) => a + r.infraCost, 0),
  };
}
