// 分布の切り方（D-149）。
import { describe, expect, it } from 'vitest';
import { HISTOGRAM_BINS, histogramOf } from './histogram.ts';

describe('histogramOf', () => {
  it('連続の軸は最小〜最大を等しい幅で切り、全部の値がどれか 1 本に入る（最大は最後のビン）', () => {
    const values = [0, 1, 2.5, 5, 7.5, 9.99, 10];
    const h = histogramOf('cash', values);
    expect(h.bins).toHaveLength(HISTOGRAM_BINS);
    expect(h.bins[0]!.from).toBe(0);
    expect(h.bins.at(-1)!.to).toBe(10);
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(values.length);
    expect(h.bins.at(-1)!.count).toBe(2);
    expect(h).toMatchObject({ count: 7, min: 0, max: 10 });
  });

  it('ギリギリを攻める（整数）は値ごとに幅 1 のビン', () => {
    const h = histogramOf('edgeMonths', [0, 0, 2, 3, 3, 3]);
    expect(h.bins).toEqual([
      { from: 0, to: 1, count: 2 },
      { from: 1, to: 2, count: 0 },
      { from: 2, to: 3, count: 1 },
      { from: 3, to: 4, count: 3 },
    ]);
  });

  it('全部同じ値なら 1 本・値が無ければ空', () => {
    expect(histogramOf('satisfaction', [0.8, 0.8]).bins).toEqual([
      { from: 0.8, to: 0.8, count: 2 },
    ]);
    expect(histogramOf('cash', [])).toEqual({
      count: 0,
      min: null,
      max: null,
      bins: [],
    });
  });

  it('value を渡すと、それより大きい数と同じ数を返す（上位 % の元）', () => {
    expect(histogramOf('cash', [1, 2, 2, 3, 4], 2).position).toEqual({
      above: 2,
      equal: 2,
    });
    expect(histogramOf('cash', [], 2).position).toEqual({
      above: 0,
      equal: 0,
    });
  });
});
