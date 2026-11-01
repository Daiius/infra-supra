import { describe, expect, it } from 'vitest';
import { convertUnit, UnitConversionError } from './unit.ts';

describe('convertUnit', () => {
  it('メモリ × 時間: GB 時間 ↔ GB 秒（Lambda の GB 秒。prd/11）', () => {
    expect(convertUnit(1, 'gb-hour', 'gb-second')).toBe(3600);
    expect(convertUnit(7200, 'gb-second', 'gb-hour')).toBe(2);
  });

  it('時間とメモリ × 時間は換算しない', () => {
    expect(() => convertUnit(1, 'hour', 'gb-hour')).toThrow(
      UnitConversionError,
    );
  });
});
