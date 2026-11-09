// 分布（ヒストグラム）の形（D-149・prd/15 §6）。段 3 の画面が棒を描き、自分の値の「上位何 %」を出せる形にする。
// 純粋関数（値の列 → ビン）。DB の層は絞り込んだ値の列を返すだけ。
import { sameAxisValue } from './verify.ts';

/** 連続の値の軸のビンの数。 */
export const HISTOGRAM_BINS = 20;

export type HistogramBin = {
  /** 下端（含む）。 */
  from: number;
  /** 上端（最後のビンだけ含む。ほかは含まない）。 */
  to: number;
  count: number;
};

export type Histogram = {
  /** 入れたプレイの数（完走・戻っていない）。 */
  count: number;
  /** 値が無ければ null。 */
  min: number | null;
  /**
   * 中央値（件数が偶数なら真ん中の 2 つの平均）。値が無ければ null。向きを持たない軸（④ 費用の合計）は上位 % の代わりに
   * 「全体の中央値は $X です」と出す（D-166）。
   */
  median: number | null;
  max: number | null;
  bins: HistogramBin[];
  /**
   * value を指定したときの位置: それより大きい値の数・同じ値の数（上位 % = above / count など）。同じかは照合と同じ幅
   * （相対 1e-9。sameAxisValue）で見る。画面が送る値とサーバーが再生した値の最後の桁の差で、自分を「上」に数えないため（D-162）。
   */
  position?: { above: number; equal: number };
};

/**
 * ビンの切り方:
 * - どの軸も最小〜最大を HISTOGRAM_BINS 本の等しい幅に分ける（最後のビンは上端を含む）。全部同じ値なら 1 本。
 *   （前の ④ ギリギリを攻めるは整数の軸で幅 1 だった。D-166 で ④ を連続の値の費用の合計に替えた）
 * 同じシード / 全シードの分布は別々に切る（範囲が違うので、段 3 は軸ごとに 2 つの棒を別々に描く）。
 */
export function histogramOf(
  values: readonly number[],
  value?: number,
): Histogram {
  const position =
    value === undefined
      ? {}
      : {
          position: {
            above: values.filter((v) => v > value && !sameAxisValue(v, value))
              .length,
            equal: values.filter((v) => sameAxisValue(v, value)).length,
          },
        };
  if (values.length === 0)
    return {
      count: 0,
      min: null,
      max: null,
      median: null,
      bins: [],
      ...position,
    };
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  let bins: HistogramBin[];
  if (min === max) {
    bins = [{ from: min, to: max, count: values.length }];
  } else {
    const width = (max - min) / HISTOGRAM_BINS;
    bins = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
      from: min + width * i,
      to: i === HISTOGRAM_BINS - 1 ? max : min + width * (i + 1),
      count: 0,
    }));
    for (const v of values) {
      const i = Math.min(HISTOGRAM_BINS - 1, Math.floor((v - min) / width));
      bins[i]!.count++;
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { count: values.length, min, max, median, bins, ...position };
}

/** 比較の図の行ごとのヒストグラムの棒の数（全部の行で同じ区切り。D-175）。 */
export const GROUP_BINS = 12;

/**
 * 構成（またはフレームワーク）ごとの分布の要約（ST-11・D-175）。比較の図が行ごとに小さなヒストグラムと中央値の印を描く元。
 * 分位は Postgres の percentile_cont と同じ線形の補間（並べた値の (n - 1) × p の位置）。DB の層は SQL で同じ値を出す。
 */
export type GroupStat = {
  /** 構成の id（stack_id）かフレームワークの id。 */
  key: string;
  count: number;
  p25: number;
  median: number;
  p75: number;
  /** 共通の区切り（GroupStats の binEdges）での棒ごとの件数（GROUP_BINS 本）。 */
  bins: number[];
};

/** 鍵ごとの要約と、全部の鍵で共通の棒の区切り。 */
export type GroupStats = {
  /**
   * 棒の区切り（GROUP_BINS + 1 個。その軸のその条件での全体の最小〜最大を等しい幅に分ける）。行が無ければ空。
   * 最後の棒だけ上端を含む。全部同じ値なら幅 0 で、全部を最初の棒に入れる。
   */
  binEdges: number[];
  groups: GroupStat[];
};

/** 区切りの幅（最小・最大から。全部同じ値なら 0）。 */
export const binWidthOf = (min: number, max: number) =>
  (max - min) / GROUP_BINS;

/**
 * 値の棒の番号（0〜GROUP_BINS - 1）。DB の層も同じ式（floor((v - min) / width)・最後の棒に寄せる）を SQL で数える
 * （width_bucket は内部の計算の順が違い、境目の値で 1 本ずれうるので使わない）。
 */
export const binIndexOf = (v: number, min: number, width: number) =>
  width > 0 ? Math.min(GROUP_BINS - 1, Math.floor((v - min) / width)) : 0;

/** 区切り（GROUP_BINS + 1 個）。 */
export const binEdgesOf = (min: number, max: number) => {
  const width = binWidthOf(min, max);
  return Array.from({ length: GROUP_BINS + 1 }, (_, i) =>
    i === GROUP_BINS ? max : min + width * i,
  );
};

/** 並べた値の分位（percentile_cont と同じ線形の補間）。sorted は昇順・1 件以上。 */
export function quantileOf(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** 鍵と値の組から、鍵ごとの要約（鍵の順に並べる）と共通の区切り。 */
export function groupStatsOf(
  rows: readonly { key: string; value: number }[],
): GroupStats {
  if (rows.length === 0) return { binEdges: [], groups: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    if (r.value < min) min = r.value;
    if (r.value > max) max = r.value;
  }
  const width = binWidthOf(min, max);
  const byKey = new Map<string, number[]>();
  for (const r of rows) {
    const list = byKey.get(r.key);
    if (list) list.push(r.value);
    else byKey.set(r.key, [r.value]);
  }
  const groups = [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const bins = Array<number>(GROUP_BINS).fill(0);
      for (const v of sorted) bins[binIndexOf(v, min, width)]!++;
      return {
        key,
        count: sorted.length,
        p25: quantileOf(sorted, 0.25),
        median: quantileOf(sorted, 0.5),
        p75: quantileOf(sorted, 0.75),
        bins,
      };
    });
  return { binEdges: binEdgesOf(min, max), groups };
}
