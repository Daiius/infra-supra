// 符号つきの差の表示: 丸めると 0 になる値に − や + を付けない（「−$0」の回帰）。
import { describe, expect, it } from 'vitest';
import { roundInt, signedText, usd } from './format.ts';
import { money } from './slot-compare.tsx';

const dollars = (a: number) => `$${Math.round(a).toLocaleString('en-US')}`;

describe('signedText', () => {
  it('丸めた表示が 0 なら ± を付ける（−$0・+$0 を出さない）', () => {
    expect(signedText(-0.3, dollars)).toBe('±$0');
    expect(signedText(0.4, dollars)).toBe('±$0');
    expect(signedText(0, dollars)).toBe('±$0');
    expect(signedText(-0, dollars)).toBe('±$0');
  });
  it('0 でなければ + / −（全角のマイナス）', () => {
    expect(signedText(-1234.4, dollars)).toBe('−$1,234');
    expect(signedText(0.6, dollars)).toBe('+$1');
    expect(signedText(-0.004, money)).toBe('±$0.00');
    expect(signedText(-0.006, money)).toBe('−$0.01');
  });
});

describe('金額の書式', () => {
  it('丸めると 0 になる負の値に符号を付けない', () => {
    expect(usd(-0.001)).toBe('$0.00');
    expect(usd(-5)).toBe('$-5.00');
    expect(money(-0.001)).toBe('$0.00');
    expect(money(-3)).toBe('−$3.00');
    expect(roundInt(-0.3).toLocaleString()).toBe('0');
  });
});
