// 数値の規律（prd/02-architecture.md §3・D-16）。金額・使用量は普通の number で計算する。
// 浮動小数点で実際に困るのは「小数の量を小数の単位で切り上げる境界」だけなので、切り上げはここに閉じ込める。
//
// 規律:
// 1. 課金の切り上げは ceilUnits を使う（Math.ceil を直接使わない）
// 2. 量はできるだけ整数の単位で持つ（バイト・ms・件）。整数は 2^53 まで正確
// 3. 丸めは表示のときだけ（エンジンは表示用に丸めない）
// 4. 結果の再現性に効く値に超越関数（Math.exp / Math.pow / Math.log）を使わない。四則演算と Math.sqrt は IEEE 754 で一致する

/**
 * 切り上げの判定に使う相対的な許容誤差。浮動小数点の誤差（相対 1e-16 程度）は十分に吸収し、
 * 課金の単位として意味のある端数（1e-9 より大きい割合）は切り上げる。
 */
export const ROUNDING_TOLERANCE = 1e-9;

export class NonFiniteError extends RangeError {
  constructor(what: string, value: number) {
    super(`${what} は有限の数である必要がある: ${value}`);
    this.name = 'NonFiniteError';
  }
}

export function assertFinite(value: number, what = '値'): number {
  if (!Number.isFinite(value)) throw new NonFiniteError(what, value);
  return value;
}

/**
 * `value` を `granularity` の単位で切り上げたときの**単位の個数**（整数）を返す（課金の最低単位。prd/03 §5）。
 * 戻り値を個数にするのは、`個数 × granularity` を掛け直すとまた誤差が乗るため。金額は `個数 × 単位あたりの単価` で出す。
 *
 * 例: ceilUnits(0.1 * 3, 0.1) は 3（素朴な Math.ceil では 0.30000000000000004 / 0.1 → 4 になる）。
 * 0 以下の値は 0 を返す（使用量 0 を 1 単位に切り上げない）。
 */
export function ceilUnits(value: number, granularity: number): number {
  assertFinite(value, '切り上げる値');
  if (!(granularity > 0) || !Number.isFinite(granularity)) {
    throw new RangeError(`切り上げの単位は正の有限の数: ${granularity}`);
  }
  if (value <= 0) return 0;
  const q = value / granularity;
  const nearest = Math.round(q);
  if (Math.abs(q - nearest) <= ROUNDING_TOLERANCE * Math.max(1, nearest)) {
    return nearest;
  }
  return Math.ceil(q);
}

/** `max(0, used - included)`。無料枠・込み分を引いた残り。 */
export function overage(used: number, included: number): number {
  return Math.max(0, used - included);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** テスト・比較用: 相対誤差が許容範囲に収まるか。 */
export function nearlyEqual(
  a: number,
  b: number,
  tolerance = ROUNDING_TOLERANCE,
): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}
