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

/**
 * 当たった前提の色（D-188）。超えたときの効き方で分ける: 止まる・プランの変更が要る・規約は赤（error）、
 * 遅くなる・費用が増える（課金の境目）・込み分の調整・情報は黄（warning）。色だけにせず、文言は `hitLabel` と組で出す。
 * 推移（game の premiseTrends）の効き方は string なので string で受ける。
 */
export function hitTone(
  effect: PlatformPremise['effect'] | string,
): 'error' | 'warning' {
  return effect === 'block' ||
    effect === 'upgrade-required' ||
    effect === 'policy'
    ? 'error'
    : 'warning';
}

const HIT_LABEL: Record<PlatformPremise['effect'], string> = {
  block: '上限に達した',
  'upgrade-required': '上限に達した（プランの変更が要る）',
  policy: '規約に当たった',
  throttle: '上限に達した（遅くなる）',
  adjust: '上限を超えた（調整）',
  cost: '超過（課金）',
  info: '上限に達した',
};

/** 当たった前提の印の文言（D-188。`hitTone` と組）。 */
export function hitLabel(effect: PlatformPremise['effect'] | string): string {
  return HIT_LABEL[effect as PlatformPremise['effect']] ?? '上限に達した';
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
