// 説明の ⓘ ボタン（選択肢の長い説明を畳む）。タップ・クリックで開閉し、Esc・外側のクリックで閉じる（hover だけに頼らない）。
// 吹き出しは画面に固定して置き、画面の端からはみ出さないように横位置を詰める（狭い画面でも読める）。
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const WIDTH = 288;
const MARGIN = 8;

export function Info({
  children,
  label = '説明',
}: {
  children: ReactNode;
  /** ボタンの読み上げ（既定「説明」）。 */
  label?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = pos !== null;

  const show = () => {
    const r = button.current!.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
    setPos({
      top: r.bottom + 4,
      left: Math.min(
        Math.max(MARGIN, r.left - 8),
        window.innerWidth - width - MARGIN,
      ),
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t))
        setPos(null);
    };
    // スクロールでは、ボタンに付いて動かす。ボタンが画面の外へ大きく出たときだけ閉じる
    // （開いた直後の慣性スクロールや、数 px のスクロールで閉じないように）
    const follow = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setPos(null);
      else show();
    };
    const close = () => setPos(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-xs btn-circle align-middle"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          // label の中に置かれても、選択肢を切り替えない
          e.preventDefault();
          e.stopPropagation();
          if (open) setPos(null);
          else show();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <circle cx="8" cy="4.8" r="1" fill="currentColor" />
          <rect
            x="7.2"
            y="6.8"
            width="1.6"
            height="5"
            rx="0.8"
            fill="currentColor"
          />
        </svg>
      </button>
      {open &&
        // body に出す（label の中に置かれても、吹き出しのクリックで選択肢が切り替わらないように）
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="rounded-box border border-base-300 bg-base-100 p-3 text-left text-sm font-normal shadow-lg"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: Math.min(WIDTH, window.innerWidth - MARGIN * 2),
              zIndex: 60,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
