import { describe, expect, it } from 'vitest';
import {
  addMoney,
  convertMoney,
  CurrencyMismatchError,
  money,
  sumMoney,
  type ExchangeRate,
} from './money.ts';
import { addQty, bytesToGb, qty, UnitMismatchError } from './unit.ts';

// 為替はテスト用の架空値（実際の相場ではない）
const FICTIONAL_RATE: ExchangeRate = {
  base: 'USD',
  quote: 'JPY',
  rate: 100,
  asOf: '2000-01-01',
  basis: 'assumption',
  note: 'テスト用の架空の為替',
};

describe('Money', () => {
  it('通貨が違う金額は直接足せない', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'JPY'))).toThrow(
      CurrencyMismatchError,
    );
    expect(() => sumMoney([money(1, 'USD')], 'JPY')).toThrow(
      CurrencyMismatchError,
    );
  });

  it('為替の仮定で換算する（順方向・逆方向）', () => {
    expect(
      convertMoney(money(1.5, 'USD'), 'JPY', [FICTIONAL_RATE]).amount,
    ).toBe(150);
    expect(
      convertMoney(money(250, 'JPY'), 'USD', [FICTIONAL_RATE]).amount,
    ).toBe(2.5);
  });

  it('為替の仮定がなければ例外', () => {
    expect(() => convertMoney(money(1, 'USD'), 'JPY', [])).toThrow();
  });
});

describe('Quantity', () => {
  it('単位が違う数量は足せない', () => {
    expect(() => addQty(qty(1, 'request'), qty(1, 'row'))).toThrow(
      UnitMismatchError,
    );
  });

  it('GB の既定は SI（10^9 バイト）、2 進は明示したときだけ', () => {
    expect(bytesToGb(1_500_000_000)).toBe(1.5);
    expect(bytesToGb(1_073_741_824, 'binary')).toBe(1);
  });
});
