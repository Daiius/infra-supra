// ヘッダーのロゴ（D-184）。分数の形で、分子に「Supra」・括線・分母に「Infra」。フォントは Bytesized を使う 8 文字に絞って配る
// （public/fonts。出典とライセンスは同じ場所の SOURCE.txt・Bytesized-OFL.txt）。
// こっそりの演出: 開いて数秒後に 1 回だけ分子と分母が入れ替わって戻る・マウスを乗せる（タッチは押す）と入れ替わる。
// prefers-reduced-motion: reduce では入れ替え自体をしない（styles.css でも動きを止める）。
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motion.tsx';

/** 開いてから入れ替わるまで（ミリ秒）。 */
export const LOGO_INTRO_DELAY_MS = 4000;
/** 入れ替わったまま止まっている長さ（開いたとき・タッチで押したとき。ミリ秒）。 */
export const LOGO_HOLD_MS = 1600;

export function Logo() {
  const reduced = useReducedMotion();
  // 開いたときの 1 回・マウスを乗せている・タッチで押した、のどれかで入れ替える
  const [intro, setIntro] = useState(false);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (reduced) return;
    const on = setTimeout(() => setIntro(true), LOGO_INTRO_DELAY_MS);
    const off = setTimeout(
      () => setIntro(false),
      LOGO_INTRO_DELAY_MS + LOGO_HOLD_MS,
    );
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [reduced]);
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const swapped = !reduced && (intro || hover || pressed);
  return (
    <span
      role="img"
      aria-label="infra-supra"
      title="infra-supra"
      className="logo-fraction"
      data-swapped={swapped || undefined}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHover(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHover(false);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        clearTimeout(pressTimer.current);
        setPressed(true);
        pressTimer.current = setTimeout(() => setPressed(false), LOGO_HOLD_MS);
      }}
    >
      <span aria-hidden className="logo-numerator">
        Supra
      </span>
      <span aria-hidden className="logo-bar" />
      <span aria-hidden className="logo-denominator">
        Infra
      </span>
    </span>
  );
}
