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

/**
 * 止まる前提が当たっているか（D-190）。赤（`hitTone` が error）のもの = 止まる・プランの変更が要る・規約。
 * 遅くなる・調整・課金・情報は数えない（黄）。見積モードの上限の一覧の「超過」とゲームの画面の印で同じ規則にする。
 */
export function isStopping(p: PlatformPremise): boolean {
  return p.hit && hitTone(p.effect) === 'error';
}

/**
 * 止まる上限（D-190）: 量の境目（threshold）のうち `isStopping` のもの = 止まる・プランの変更が要る。
 * 規約（量によらない事実）は含めない。見積の ① のカード・タブの件数（D-178）・比較の表・費用の曲線の止まる区間（D-180）・
 * 描き方の行の差で数える。
 */
export function isStoppingLimit(p: PlatformPremise): boolean {
  return p.kind === 'threshold' && isStopping(p);
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
