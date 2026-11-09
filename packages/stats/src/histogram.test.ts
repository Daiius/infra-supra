// 分布の切り方（D-149・D-166）。
import { describe, expect, it } from 'vitest';
import { HISTOGRAM_BINS, histogramOf } from './histogram.ts';

describe('histogramOf', () => {
  it('連続の軸は最小〜最大を等しい幅で切り、全部の値がどれか 1 本に入る（最大は最後のビン）', () => {
    const values = [0, 1, 2.5, 5, 7.5, 9.99, 10];
    const h = histogramOf(values);
    expect(h.bins).toHaveLength(HISTOGRAM_BINS);
    expect(h.bins[0]!.from).toBe(0);
    expect(h.bins.at(-1)!.to).toBe(10);
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(values.length);
    expect(h.bins.at(-1)!.count).toBe(2);
    expect(h).toMatchObject({ count: 7, min: 0, max: 10 });
  });

  it('④ 費用の合計も連続の値として同じ切り方（D-166）', () => {
    const h = histogramOf([120.5, 300, 999.99]);
    expect(h.bins).toHaveLength(HISTOGRAM_BINS);
    expect(h).toMatchObject({ count: 3, min: 120.5, max: 999.99 });
  });

  it('全部同じ値なら 1 本・値が無ければ空', () => {
    expect(histogramOf([0.8, 0.8]).bins).toEqual([
      { from: 0.8, to: 0.8, count: 2 },
    ]);
    expect(histogramOf([])).toEqual({
      count: 0,
      min: null,
      max: null,
      median: null,
      bins: [],
    });
  });

  it('中央値（奇数は真ん中・偶数は真ん中の 2 つの平均。D-166）', () => {
    expect(histogramOf([5, 1, 3]).median).toBe(3);
    expect(histogramOf([4, 1, 3, 2]).median).toBe(2.5);
  });

  it('value を渡すと、それより大きい数と同じ数を返す（上位 % の元）', () => {
    expect(histogramOf([1, 2, 2, 3, 4], 2).position).toEqual({
      above: 2,
      equal: 2,
    });
    // 最後の桁の差（相対 1e-9 まで）は同じ値に数える（画面の値とサーバーの再生の値。D-162）
    expect(histogramOf([0.8 + 1e-12, 0.9], 0.8).position).toEqual({
      above: 1,
      equal: 1,
    });
    expect(histogramOf([], 2).position).toEqual({
      above: 0,
      equal: 0,
    });
  });
});
