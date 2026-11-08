// 振り返りの 4 軸（D-132・prd/15 §2）。完走・途中終了のどちらでも、終わった状態から同じ関数で数える
// （段 2 ではサーバーも同じ関数で再生した結果を数え、クライアントの値と照合する。prd/15 §5）。
// どれも単体で意味が分かる値だけで、重みで 1 つの点数にまとめない。
import type { PremiseEffect } from 'estimator';
import { averageSatisfaction } from './month/satisfaction.ts';
import type { GameState, MonthReport } from './state.ts';

export type ResultAxes = {
  /** ① 所持金（最後の月。完走なら 12 か月目）。 */
  cash: number;
  /** ② 満足度の平均（今の評価と同じ値）。 */
  satisfaction: number;
  /** ③ 機能開発の累計（prd/07 §9.4）。 */
  featurePoints: number;
  /** ④ ギリギリを攻める: 止まらずに、どれかの上限の使用率が 90% 以上 100% 未満だった月の数。 */
  edgeMonths: number;
};

export type ResultAxisId = keyof ResultAxes;

/** 並べる順（D-132）。どれも大きいほど上位。 */
export const RESULT_AXES: readonly { id: ResultAxisId; label: string }[] = [
  { id: 'cash', label: '所持金' },
  { id: 'satisfaction', label: '満足度の平均' },
  { id: 'featurePoints', label: '機能開発の累計' },
  { id: 'edgeMonths', label: 'ギリギリを攻める' },
];

/** ④ で「ギリギリ」とみなす使用率の幅（下限を含み、上限を含まない）。 */
export const EDGE_RATIO = { min: 0.9, max: 1 } as const;

/**
 * ④ で数える上限（D-141・ST-02）: 当たると止まる・遅くなる・プランの変更が要る上限だけ（部品の比較の表の上限と同じ）。
 * 規約の制限（policy）・課金の境目（cost）・込み分の調整（adjust）は数えない。
 */
const EDGE_EFFECTS: ReadonlySet<PremiseEffect> = new Set([
  'block',
  'throttle',
  'upgrade-required',
]);

/**
 * その月が「ギリギリを攻めた」月か。止まった月（上限で止まった・自前の障害）は数えない。
 * 遅くなった月（別の上限が 100% を超えた）は止まっていないので、ほかの上限が 90〜100% なら数える。
 */
export function isEdgeMonth(
  r: Pick<MonthReport, 'status' | 'snapshots'>,
): boolean {
  if (r.status === 'down' || r.status === 'incident') return false;
  return r.snapshots.some(
    (p) =>
      EDGE_EFFECTS.has(p.effect as PremiseEffect) &&
      p.ratio >= EDGE_RATIO.min &&
      p.ratio < EDGE_RATIO.max,
  );
}

/** 4 軸の値（純粋関数）。止まった月の数は軸にしない（振り返りに回数として出す。D-132）。 */
export function resultAxesOf(
  state: Pick<GameState, 'cash' | 'history' | 'featurePoints'>,
): ResultAxes {
  return {
    cash: state.cash,
    satisfaction: averageSatisfaction(state.history),
    featurePoints: state.featurePoints,
    edgeMonths: state.history.filter(isEdgeMonth).length,
  };
}
