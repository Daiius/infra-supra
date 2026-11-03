// 前提の見せ方の共有（見積モードとゲームの画面）。表示だけで、計算には触れない。
import type { PlatformPremise } from 'estimator';

/**
 * 込みのクレジットの消費（超えても止まらず、超えた分が従量で請求される）か。
 * 使い切ると止まるクレジット（effect: block）は含めない。
 */
export function isCreditUse(p: PlatformPremise): boolean {
  return (
    p.kind === 'threshold' &&
    p.currency !== undefined &&
    p.effect === 'cost' &&
    p.used !== undefined &&
    p.limit !== undefined
  );
}

/** 止まる・制限される・プランの変更が要る（費用が増えるだけではない）前提が当たっているか。 */
export function isStopping(p: PlatformPremise): boolean {
  return p.hit && p.effect !== 'cost' && p.effect !== 'info';
}

/** 「$20 のクレジットのうち $159 分を使用（超えた分 $139 は従量で請求）」 */
export function creditUseText(
  p: PlatformPremise,
  money: (n: number) => string,
): string {
  const used = p.used ?? 0;
  const limit = p.limit ?? 0;
  const head = `${money(limit)} のクレジットのうち ${money(used)} 分を使用`;
  return used > limit
    ? `${head}（超えた分 ${money(used - limit)} は従量で請求）`
    : head;
}
