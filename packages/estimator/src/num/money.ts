// 金額と為替（prd/03-pricing-schema.md §8）。明細は原通貨のまま持ち、換算は為替の仮定を明示して行う。
import { assertFinite, sum } from './arith.ts';

export const CURRENCIES = ['USD', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Money = { amount: number; currency: Currency };

export function money(amount: number, currency: Currency): Money {
  return { amount: assertFinite(amount, '金額'), currency };
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(
      `通貨が違う金額は直接足せない（為替の仮定を通して換算する）: ${a} と ${b}`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency)
    throw new CurrencyMismatchError(a.currency, b.currency);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sumMoney(items: readonly Money[], currency: Currency): Money {
  for (const m of items) {
    if (m.currency !== currency)
      throw new CurrencyMismatchError(currency, m.currency);
  }
  return { amount: sum(items.map((m) => m.amount)), currency };
}

/**
 * 為替は料金データではなく見積の仮定（basis は常に assumption）。
 * `1 base = rate quote`（例: base USD・quote JPY・rate 150 は 1 USD = 150 円）。
 */
export type ExchangeRate = {
  base: Currency;
  quote: Currency;
  rate: number;
  asOf: string;
  basis: 'assumption';
  note?: string;
};

export function convertMoney(
  m: Money,
  to: Currency,
  rates: readonly ExchangeRate[],
): Money {
  if (m.currency === to) return m;
  const direct = rates.find((r) => r.base === m.currency && r.quote === to);
  if (direct) return { amount: m.amount * direct.rate, currency: to };
  const inverse = rates.find((r) => r.base === to && r.quote === m.currency);
  if (inverse) return { amount: m.amount / inverse.rate, currency: to };
  throw new Error(`為替の仮定がない: ${m.currency} → ${to}`);
}
