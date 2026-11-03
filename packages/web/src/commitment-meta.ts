// 始める画面（App）と運営中の画面（game-screen）の両方が使う表示の小物。運営中の画面は分けて読むので、ここに置いて共有する。
import { PAYMENT_LABEL, type CommitmentOffer } from 'game';

export const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 確約の選択肢の文（期間・支払い・割引の率。D-97）。 */
export function commitmentMeta(o: CommitmentOffer): string[] {
  const money = (n: number) =>
    o.currency === 'JPY' ? `${Math.round(n).toLocaleString()} 円` : usd(n);
  return [
    `1 年・${PAYMENT_LABEL[o.payment]}`,
    o.upfront > 0
      ? o.months < 12
        ? `前払い ${money(o.upfront)}（1 年分 ${money(o.upfrontYear)} のうちゲームの残り ${o.months} か月分）`
        : `前払い ${money(o.upfront)}`
      : `毎月 ${money(o.monthly)}`,
    `月 ${money(o.covers)} 分まで割引`,
    `1 年で ${Math.round(o.discount * 100)}% 安い`,
  ];
}
