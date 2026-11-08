// 集計の分布の中での位置（段 3・D-161〜D-164・prd/15 §3.1・§6）。サーバーの分布（4 軸 × 同じシード / 全シード）と自分の値から、
// 軸ごとの「上位何 %」と、上位に入った軸の数（花火の段）を出す。純粋な部分だけ（取得は stats-client.ts、順序は App.tsx）。
import { RESULT_AXES, type ResultAxes, type ResultAxisId } from 'game';
import type { Distribution, Histogram } from 'stats';

/**
 * 分布として見せる最少の件数（自分を含む）。全シードの分布がこれより少なければ分布を出さず、手元の履歴との比較（段 1）に戻る。
 * 同じシードの分布がこれより少なければ、その分布だけ「まだ少ない」と出す（D-163）。
 */
export const MIN_DISTRIBUTION_COUNT = 10;

/** 「上位に入った」の線（上位 25% 以内。ST-01・D-163）。 */
export const TOP_PERCENT = 25;

/** 1 つの分布の中での位置。 */
export type Standing = {
  /** 比べた件数（自分を含む）。 */
  n: number;
  /** 上位何 %（自分以上の件数 ÷ n を百分率の整数に丸めた値。1〜100）。 */
  topPercent: number;
  /** 上位 TOP_PERCENT % 以内か（丸めた topPercent で見る。表示と食い違わない）。 */
  inTop: boolean;
  /** 棒を描く元（サーバーの分布そのまま）。 */
  histogram: Histogram;
};

export type AxisStanding = {
  id: ResultAxisId;
  label: string;
  value: number;
  /** 同じシードの分布の中での位置。件数が少なければ null（seedCount に件数）。 */
  seed: Standing | null;
  seedCount: number;
  /** 全シードの分布の中での位置（DistributionView がある間は必ずある）。 */
  all: Standing;
  /**
   * 上位に入ったか（花火の段に数える）。同じシードの分布が見せられればそちら（楽なシードを選び直しても有利にならない。D-136）、
   * 見せられなければ全シードで見る。
   */
  inTop: boolean;
};

export type DistributionView = {
  axes: AxisStanding[];
  /** 自分が分布に入っているか（送信が保存された・戻っていない）。入っていなければ自分を 1 件足して数える。 */
  included: boolean;
  /** 開発用の架空の分布か（stats-mock.ts。画面に明記する）。 */
  mock: boolean;
};

/** 画面に渡す集計の状態。ready のときだけ分布を出し、ほかは段 1 の表示に戻る（注記だけ変える）。 */
export type StatsView =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'few'; count: number }
  | { status: 'ready'; view: DistributionView };

function standingOf(
  h: Histogram,
  included: boolean,
): { n: number; atOrAbove: number } {
  const p = h.position ?? { above: 0, equal: 0 };
  // 入っていれば自分は equal に数えられている（最後の桁の差は stats の histogramOf が同じとみなす）。入っていなければ 1 件足す
  return included
    ? { n: h.count, atOrAbove: p.above + Math.max(p.equal, 1) }
    : { n: h.count + 1, atOrAbove: p.above + p.equal + 1 };
}

/** 上位何 %（自分と同じ値の人も自分より上に数える控えめな数え方。全員が同じ値なら 100%）。 */
export function topPercentOf(n: number, atOrAbove: number): number {
  if (n <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round((atOrAbove / n) * 100)));
}

function toStanding(h: Histogram, included: boolean): Standing {
  const { n, atOrAbove } = standingOf(h, included);
  const topPercent = topPercentOf(n, atOrAbove);
  return { n, topPercent, inTop: topPercent <= TOP_PERCENT, histogram: h };
}

/**
 * 分布と自分の値から、軸ごとの位置を出す。全シードの分布が少なすぎれば few（段 1 に戻す）。
 * included は自分が分布に入っているか（App.tsx が送信の結末から決める。D-162）。
 */
export function standingsOf(
  dist: Distribution,
  axes: ResultAxes,
  included: boolean,
  mock = false,
): StatsView {
  const allCount = standingOf(dist.axes.cash.all, included).n;
  if (allCount < MIN_DISTRIBUTION_COUNT)
    return { status: 'few', count: allCount };
  return {
    status: 'ready',
    view: {
      included,
      mock,
      axes: RESULT_AXES.map(({ id, label }) => {
        const d = dist.axes[id];
        const all = toStanding(d.all, included);
        const seedStanding = toStanding(d.seed, included);
        const seed =
          seedStanding.n >= MIN_DISTRIBUTION_COUNT ? seedStanding : null;
        return {
          id,
          label,
          value: axes[id],
          seed,
          seedCount: seedStanding.n,
          all,
          inTop: (seed ?? all).inTop,
        };
      }),
    },
  };
}

/** 上位に入った軸の数。 */
export const topAxesCount = (view: DistributionView) =>
  view.axes.filter((a) => a.inTop).length;

/**
 * 花火の段（1〜3。ST-01・D-163）: 分布があるときは上位に入った軸の数で分ける（0 → 1・1〜2 → 2・3〜4 → 3。段 1 の D-145 と同じ区切り）。
 */
export function distributionFireworkLevel(view: DistributionView): 1 | 2 | 3 {
  const n = topAxesCount(view);
  return n >= 3 ? 3 : n >= 1 ? 2 : 1;
}
