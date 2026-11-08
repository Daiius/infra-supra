// 分布（ヒストグラム）の形（D-149・prd/15 §6）。段 3 の画面が棒を描き、自分の値の「上位何 %」を出せる形にする。
// 純粋関数（値の列 → ビン）。DB の層は絞り込んだ値の列を返すだけ。
import type { ResultAxisId } from 'game';
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
 * - ④ ギリギリを攻める（edgeMonths）は 0〜12 の整数なので、幅 1 のビンを最小〜最大の整数ごとに 1 本ずつ（from = 値・to = 値 + 1）。
 * - ほかの軸は最小〜最大を HISTOGRAM_BINS 本の等しい幅に分ける（最後のビンは上端を含む）。全部同じ値なら 1 本。
 * 同じシード / 全シードの分布は別々に切る（範囲が違うので、段 3 は軸ごとに 2 つの棒を別々に描く）。
 */
export function histogramOf(
  axis: ResultAxisId,
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
    return { count: 0, min: null, max: null, bins: [], ...position };
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  let bins: HistogramBin[];
  if (axis === 'edgeMonths') {
    bins = [];
    for (let k = Math.floor(min); k <= Math.floor(max); k++)
      bins.push({ from: k, to: k + 1, count: 0 });
    for (const v of values) bins[Math.floor(v) - Math.floor(min)]!.count++;
  } else if (min === max) {
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
  return { count: values.length, min, max, bins, ...position };
}
