// ヘッダーのロゴ（D-184）。分数の形で、分子に「Supra」・括線・分母に「Infra」。フォントは Philosopher Bold を使う 8 文字に絞って配る
// （public/fonts。出典とライセンスは同じ場所の SOURCE.txt・Philosopher-OFL.txt）。
// こっそりの演出: 開いてしばらくすると分子と分母がゆっくりのフェードで入れ替わり、しばらくその位置のまま、またしれっと戻る。
// これを繰り返す（タブが見えていない間は止め、見えるようになったら続きから。2026-11-10・ユーザーの要望）。
// マウスを乗せている間（タッチは押してしばらく）は入れ替えた形を保ち、離したら周期の形に戻る。
// できるだけ目立たないように動かない（位置は動かさず、2 つの重ねた形の不透明度だけを替える）。
// prefers-reduced-motion: reduce では入れ替え自体をしない（styles.css でも動きを止める）。
// OGP の画像（og-card.tsx）では `still` で入れ替えを止め、`size` で大きく描く（括線・空きは em なので比率は変わらない）。
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motion.tsx';

/** 開いてから最初に入れ替わるまで（ミリ秒）。 */
export const LOGO_INTRO_DELAY_MS = 8000;
/** 入れ替わったまま止まっている長さ（周期の中・タッチで押したとき。ミリ秒）。 */
export const LOGO_HOLD_MS = 12000;
/** 戻ってから次に入れ替わるまで、普段の形でいる長さ（ミリ秒）。 */
export const LOGO_NORMAL_MS = 20000;

/**
 * 入れ替えの周期（普段の形 → 入れ替えた形 → 普段の形 …）。最初だけ LOGO_INTRO_DELAY_MS で入れ替え、その後は
 * 入れ替えた形を LOGO_HOLD_MS・普段の形を LOGO_NORMAL_MS ずつ繰り返す。タブが見えていない間（document.hidden）は
 * 残りの時間を持ったまま止め、見えるようになったら続きから進める。enabled が false の間は動かさず false を返す。
 */
function useLogoCycle(enabled: boolean): boolean {
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let phase = false;
    let remaining = LOGO_INTRO_DELAY_MS;
    let deadline = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      deadline = Date.now() + remaining;
      timer = setTimeout(() => {
        phase = !phase;
        setSwapped(phase);
        remaining = phase ? LOGO_HOLD_MS : LOGO_NORMAL_MS;
        run();
      }, remaining);
    };
    const pause = () => {
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, deadline - Date.now());
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer !== undefined) pause();
      } else if (timer === undefined) {
        run();
      }
    };
    if (!document.hidden) run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      setSwapped(false);
    };
  }, [enabled]);
  return enabled && swapped;
}

export function Logo({
  still = false,
  size,
}: {
  /** 入れ替えをしない（OGP の画像など、静止した絵にするとき）。 */
  still?: boolean;
  /** 字の大きさ（px）。省くとヘッダーの 18px。 */
  size?: number;
} = {}) {
  const reduced = useReducedMotion();
  const animated = !still && !reduced;
  const cycle = useLogoCycle(animated);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const swapped = animated && (cycle || hover || pressed);
  return (
    <span
      role="img"
      aria-label="infra-supra"
      title="infra-supra"
      className="logo-fraction"
      data-swapped={swapped || undefined}
      style={
        size === undefined
          ? undefined
          : ({ '--logo-size': `${size}px` } as CSSProperties)
      }
      onPointerEnter={(e) => {
        if (animated && e.pointerType === 'mouse') setHover(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHover(false);
      }}
      onPointerDown={(e) => {
        if (!animated || e.pointerType === 'mouse') return;
        clearTimeout(pressTimer.current);
        setPressed(true);
        pressTimer.current = setTimeout(() => setPressed(false), LOGO_HOLD_MS);
      }}
    >
      {/* 普段の形と入れ替えた形を同じ場所に重ね、不透明度だけをゆっくり替える */}
      <span aria-hidden className="logo-layer logo-layer-normal">
        <span className="logo-numerator">Supra</span>
        <span className="logo-bar" />
        <span className="logo-denominator">Infra</span>
      </span>
      <span aria-hidden className="logo-layer logo-layer-swapped">
        <span className="logo-numerator">Infra</span>
        <span className="logo-bar" />
        <span className="logo-denominator">Supra</span>
      </span>
    </span>
  );
}
