import { describe, expect, it } from 'vitest';
import {
  ceilUnits,
  nearlyEqual,
  NonFiniteError,
  overage,
  sum,
} from './arith.ts';

describe('ceilUnits', () => {
  it('浮動小数点の誤差で 1 単位多く切り上げない（0.1 × 3 を 0.1 単位で → 3）', () => {
    expect(0.1 * 3).not.toBe(0.3); // 前提: 素朴に計算すると誤差が出る
    expect(Math.ceil((0.1 * 3) / 0.1)).toBe(4); // 素朴な切り上げは 1 単位多い
    expect(ceilUnits(0.1 * 3, 0.1)).toBe(3);
  });

  it('境界ちょうどは切り上げない・境界 + 1 は次の単位へ（整数の量）', () => {
    expect(ceilUnits(1_000_000, 1_000_000)).toBe(1);
    expect(ceilUnits(1_000_001, 1_000_000)).toBe(2);
  });

  it('意味のある端数は切り上げる（1.1 GB 月 → 2 単位）', () => {
    expect(ceilUnits(1.1, 1)).toBe(2);
    expect(ceilUnits(1.000001, 1)).toBe(2);
  });

  it('平均 2.3 ms を 1 ms 単位で → 3（1 回ごとの切り上げ。prd/05 P-03）', () => {
    expect(ceilUnits(2.3, 1)).toBe(3);
  });

  it('0 以下は 0 単位', () => {
    expect(ceilUnits(0, 10)).toBe(0);
    expect(ceilUnits(-5, 10)).toBe(0);
  });

  it('単位が 0 以下・非有限なら例外、値が非有限なら例外', () => {
    expect(() => ceilUnits(1, 0)).toThrow(RangeError);
    expect(() => ceilUnits(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => ceilUnits(Number.NaN, 1)).toThrow(NonFiniteError);
  });

  it('大きな整数の量でも正確（月 1000 万 PV × 画像 20 枚 × 200 KB のバイト数）', () => {
    const bytes = 10_000_000 * 20 * 200_000; // 4 × 10^13
    expect(Number.isSafeInteger(bytes)).toBe(true);
    expect(ceilUnits(bytes, 1_000_000_000)).toBe(40_000);
  });
});

describe('overage・sum・nearlyEqual', () => {
  it('込み分を引いた残りは負にならない', () => {
    expect(overage(5, 10)).toBe(0);
    expect(overage(15, 10)).toBe(5);
    // 足し算の誤差だけの超過は 0（D-78）。意味のある端数は残す
    expect(overage(0.1 + 0.2, 0.3)).toBe(0);
    expect(overage(0.31, 0.3)).toBeCloseTo(0.01);
    // 大きな整数の枠を 1 だけ超えた超過は消さない（OCL-CD13AA33。D1 の 250 億行の枠など）
    expect(overage(25_000_000_001, 25_000_000_000)).toBe(1);
    expect(overage(1e15 + 1, 1e15)).toBe(1);
    // 大きな小数の枠でも、意味のある端数（0.5）は残す
    expect(overage(25_000_000_000.5, 25_000_000_000)).toBe(0.5);
  });

  it('730 時間の積み上げは表示の桁で一致する', () => {
    const hourly = Array.from({ length: 730 }, () => 0.01344);
    expect(sum(hourly)).not.toBe(9.8112);
    expect(nearlyEqual(sum(hourly), 9.8112)).toBe(true);
    expect(sum(hourly).toFixed(2)).toBe('9.81');
  });
});
