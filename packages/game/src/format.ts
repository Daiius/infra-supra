// 金額・倍率・明細の表示用の小さな書式（計算には使わない。丸めは表示のときだけ。prd/02 §3）。
import type { LineItem } from 'estimator';
import { USD_JPY } from './core.ts';

export const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / USD_JPY;
export const usdOf = (amount: number, currency: string) =>
  currency === 'JPY' ? amount / USD_JPY : amount;

/** 明細の行の名前。料金データの label があればそれ（D-75）、無ければ ID から作る（架空の料金など）。 */
export function lineLabel(l: LineItem): string {
  if (l.label) return l.label;
  if (l.kind === 'base-fee')
    return `${l.priceRef.provider} ${l.priceRef.planId} 基本料`;
  if (l.kind === 'credit') return `${l.priceRef.provider} クレジット`;
  return `${l.priceRef.provider} ${l.priceRef.meterId}`;
}

export const fmtFactor = (f: number) => `× ${Number(f.toFixed(2))}`;

/** 整数に丸めて 3 桁ごとにカンマを入れる。 */
export const commas = (x: number) =>
  Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const usd = (x: number) => `$${commas(x)}`;
