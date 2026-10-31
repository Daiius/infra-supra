// 単位と数量。汎用リソース（prd/01-domain-model.md §5.1）とメーター（prd/03 §5）が使う単位をここに閉じる。
import { assertFinite } from './arith.ts';

export const UNITS = [
  'count', // 回数一般（実行・変換など）
  'request',
  'row',
  'operation',
  'ms',
  'second',
  'hour',
  'byte',
  'gb',
  'gb-month',
  'gb-hour',
  'cpu-hour',
] as const;
export type Unit = (typeof UNITS)[number];

export type Quantity = { value: number; unit: Unit };

export function qty(value: number, unit: Unit): Quantity {
  return { value: assertFinite(value, '数量'), unit };
}

export class UnitMismatchError extends Error {
  constructor(a: Unit, b: Unit) {
    super(`単位が違う数量は足せない: ${a} と ${b}`);
    this.name = 'UnitMismatchError';
  }
}

export function addQty(a: Quantity, b: Quantity): Quantity {
  if (a.unit !== b.unit) throw new UnitMismatchError(a.unit, b.unit);
  return { value: a.value + b.value, unit: a.unit };
}

/**
 * GB の定義。料金表は多くの場合どちらかを明記しない（スパイクの所見: D1 の GB は定義の記載なし）。
 * 既定は SI（10^9 バイト）とし、プロバイダーが 2 進を明記している場合だけ binary を使う。
 */
export type GigabyteDefinition = 'si' | 'binary';

const BYTES_PER_GB: Record<GigabyteDefinition, number> = {
  si: 1_000_000_000,
  binary: 1_073_741_824,
};

export function bytesToGb(
  bytes: number,
  definition: GigabyteDefinition = 'si',
): number {
  return bytes / BYTES_PER_GB[definition];
}

export const MS_PER_HOUR = 3_600_000;
export const SECONDS_PER_HOUR = 3_600;

/** 課金の基本単位の 1 か月 = 730 時間（prd/01 §3.3。月による日数の差は捨てる仮定）。 */
export const HOURS_PER_MONTH = 730;
