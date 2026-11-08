// 符号つきの差の表示（丸めは表示のときだけ。prd/02 §3）。丸めると 0 になる値に − や + を付けない。

/** 書式を通した文が 0 か（0 以外の数字を含まない。「$0」「0.00」「0%」など）。 */
export const isZeroText = (s: string) => !/[1-9]/.test(s);

/**
 * 符号つきの差（+$5・−$5）。fmtAbs は絶対値の書式。丸めた表示が 0 なら「±」を付ける（「−$0」「+$0」を出さない）。
 */
export function signedText(n: number, fmtAbs: (abs: number) => string): string {
  const s = fmtAbs(Math.abs(n));
  if (isZeroText(s)) return `±${s}`;
  return `${n > 0 ? '+' : '−'}${s}`;
}

/** 金額（$1,234.56）。丸めると 0 になる負の値は「$0.00」（「$-0.00」を出さない）。 */
export const usd = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'negative',
  })}`;

/** 整数に丸める（表示用）。丸めると 0 になる負の値は 0（「-0」と出さない）。 */
export const roundInt = (n: number) => Math.round(n) || 0;
