// 横のスワイプでページを送る（遊び方・イベントのダイアログで共用）。
import { useRef, type TouchEvent } from 'react';

/**
 * 横のスワイプの受け手（onTouchStart・onTouchEnd を要素に広げる）。縦のスクロールと区別するため、横の動きが縦より大きく
 * 50px 以上のときだけ onSwipe を呼ぶ（左へ払うと 1 = 次へ、右へ払うと -1 = 前へ）。
 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (t: TouchEvent) => {
      const p = t.touches[0];
      start.current = p ? { x: p.clientX, y: p.clientY } : null;
    },
    onTouchEnd: (t: TouchEvent) => {
      const s0 = start.current;
      const p = t.changedTouches[0];
      start.current = null;
      if (!s0 || !p) return;
      const dx = p.clientX - s0.x;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(p.clientY - s0.y))
        onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** ページを送ったときの滑り込みのクラス（次へは右から、前へは左から。動きを減らす設定・最初の表示では付けない）。 */
export const slideInClass = (dir: number, reduced: boolean) =>
  reduced || dir === 0
    ? undefined
    : dir > 0
      ? 'motion-slide-from-right'
      : 'motion-slide-from-left';
