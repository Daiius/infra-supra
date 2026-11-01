// 単位と数量。汎用リソース（prd/01-domain-model.md §5.1）とメーター（prd/03 §5）が使う単位をここに閉じる。
import { assertFinite } from './arith.ts';

export const UNITS = [
  'count', // 回数一般（実行・変換など）
  'request',
  'row',
  'operation',
  'ms',
  'second',
  'minute', // ビルドの時間（Workers Builds・Vercel の build minutes。prd/06 §6）
  'hour',
  'byte',
  'gb',
  'gb-month',
  'gb-hour',
  'gb-second', // メモリ × 実行時間（Durable Objects の Duration）
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

export class UnitConversionError extends Error {
  constructor(from: Unit, to: Unit) {
    super(`単位を換算できない: ${from} → ${to}`);
    this.name = 'UnitConversionError';
  }
}

/** 時間の単位を時間に直す係数（cpu-hour と hour は同じ「時間」として扱う）。 */
const TO_HOURS: Partial<Record<Unit, number>> = {
  ms: 1 / MS_PER_HOUR,
  second: 1 / SECONDS_PER_HOUR,
  minute: 1 / 60,
  hour: 1,
  'cpu-hour': 1,
};

/** メモリ × 時間の単位を GB 時間に直す係数（Lambda の GB 秒と、関数の memory-gb-hours の換算）。 */
const TO_GB_HOURS: Partial<Record<Unit, number>> = {
  'gb-hour': 1,
  'gb-second': 1 / SECONDS_PER_HOUR,
};

/** 件数の単位は互いに同じ数として扱う（1 リクエスト = 1 回 = 1 操作）。 */
const COUNT_LIKE: ReadonlySet<Unit> = new Set([
  'count',
  'request',
  'operation',
  'row',
]);

/**
 * 汎用リソースの基準の単位からメーターの単位へ換算する（例: CPU 時間 ms → cpu-hour）。
 * 換算できない組み合わせは例外（料金データの誤りを早く見つけるため）。
 */
export function convertUnit(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  const fh = TO_HOURS[from];
  const th = TO_HOURS[to];
  if (fh !== undefined && th !== undefined) return (value * fh) / th;
  const fg = TO_GB_HOURS[from];
  const tg = TO_GB_HOURS[to];
  if (fg !== undefined && tg !== undefined) return (value * fg) / tg;
  if (COUNT_LIKE.has(from) && COUNT_LIKE.has(to)) return value;
  if (from === 'byte' && to === 'gb') return bytesToGb(value);
  throw new UnitConversionError(from, to);
}
