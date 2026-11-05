// 説明の ⓘ ボタン（選択肢の長い説明を畳む）。タップ・クリックで開閉し、Esc・外側のクリックで閉じる（hover だけに頼らない）。
// 吹き出しは画面に固定して置き、画面の端からはみ出さないように横位置を詰める（狭い画面でも読める）。
// 縦は、ボタンの下（足りなければ上の広い方）に置き、残りの高さを上限にして中でスクロールする（長い説明でも末尾まで読める）。
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * 吹き出しを描く先（既定は body）。モーダルの `<dialog>`（top layer）の中では body に描くとダイアログの後ろに隠れるので、
 * ダイアログがその要素を渡す（OCL-8E844E7C）。位置は画面に固定なので、描く先が替わっても計算は同じ。
 */
export const PortalContainer = createContext<HTMLElement | null>(null);

const WIDTH = 288;
const MARGIN = 8;
const GAP = 4;
/** 下にこれだけ入れば、上の方が広くても下に置く。 */
const MIN_BELOW = 200;

type Pos = { left: number; maxHeight: number } & (
  { top: number; bottom?: undefined } | { bottom: number; top?: undefined }
);

export function Info({
  children,
  label = '説明',
  trigger,
  className = 'btn btn-ghost btn-xs btn-circle align-middle',
  interactive = false,
}: {
  /** 中身。関数なら閉じる関数を受ける（中の操作で閉じるとき。interactive と使う）。 */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** ボタンの読み上げ（既定「説明」）。 */
  label?: string;
  /** ボタンの中身（既定は ⓘ。構成図の縦の図では箱そのものを押して説明を出す）。 */
  trigger?: ReactNode;
  /** ボタンの class（既定は丸い小さいボタン）。 */
  className?: string;
  /**
   * 中に操作（部品の差し替えのボタン。D-116）を置く吹き出し。開くと吹き出しに focus を移し（ポータルの先は Tab の順で遠いので）、
   * focus が吹き出しとボタンの外へ出たら閉じる。読み上げは説明（tooltip）でなく、名前つきの dialog（モーダルでない）。
   */
  interactive?: boolean;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  // ボタンの要素は state に持つ（close を children(close) で渡すので、ref だと render 中に読むとみなされ React Compiler が最適化を諦める）
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const container = useContext(PortalContainer);
  const open = pos !== null;
  const close = () => {
    setPos(null);
    button?.focus();
  };

  const show = () => {
    const r = button!.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(
      Math.max(MARGIN, r.left - 8),
      window.innerWidth - width - MARGIN,
    );
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    setPos(
      below >= MIN_BELOW || below >= above
        ? { left, top: r.bottom + GAP, maxHeight: below }
        : { left, bottom: window.innerHeight - r.top + GAP, maxHeight: above },
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // モーダルの中では、Esc はまず吹き出しだけを閉じる（ダイアログは閉じない）
        e.preventDefault();
        e.stopPropagation();
        setPos(null);
        button?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button?.contains(t)) setPos(null);
    };
    // スクロールでは、ボタンに付いて動かす。ボタンが画面の外へ大きく出たときだけ閉じる
    // （開いた直後の慣性スクロールや、数 px のスクロールで閉じないように）
    const follow = () => {
      const r = button?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setPos(null);
      else show();
    };
    const close = () => setPos(null);
    if (interactive) panel.current?.focus();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', close);
    };
  }, [open, interactive, button]);

  return (
    <>
      <button
        ref={setButton}
        type="button"
        className={className}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup={interactive ? 'dialog' : undefined}
        aria-controls={id}
        aria-describedby={open && !interactive ? id : undefined}
        onClick={(e) => {
          // label の中に置かれても、選択肢を切り替えない
          e.preventDefault();
          e.stopPropagation();
          if (open) setPos(null);
          else show();
        }}
      >
        {trigger ?? <InfoIcon />}
      </button>
      {open &&
        // body に出す（label の中に置かれても、吹き出しのクリックで選択肢が切り替わらないように）
        createPortal(
          <div
            ref={panel}
            id={id}
            role={interactive ? 'dialog' : 'tooltip'}
            aria-label={interactive ? label : undefined}
            tabIndex={interactive ? -1 : undefined}
            onBlur={
              interactive
                ? (e) => {
                    // focus が吹き出しの外（ボタンを除く）へ出たら閉じる（Tab で抜けたとき）
                    const to = e.relatedTarget as Node | null;
                    if (
                      to &&
                      !e.currentTarget.contains(to) &&
                      !button?.contains(to)
                    )
                      setPos(null);
                  }
                : undefined
            }
            className="rounded-box border border-base-300 bg-base-100 p-3 text-left text-sm font-normal shadow-lg focus:outline-none"
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              maxHeight: pos.maxHeight,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              width: Math.min(WIDTH, window.innerWidth - MARGIN * 2),
              zIndex: 60,
            }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          container ?? document.body,
        )}
    </>
  );
}

/** ⓘ の印（説明のボタンの中身。部品の比較のボタンでも使う）。 */
export function InfoIcon() {
  return (
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
  );
}
