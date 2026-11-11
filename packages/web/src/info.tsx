// 説明の ⓘ ボタン（Info。選択肢の長い説明を畳む）と、構成図の箱の吹き出し（Popover）。
// Info は押すとダイアログ（daisyUI の modal）で中身を出す（D-129。説明が長いものが多く、吹き出しでは読みにくかった）。
// Popover は箱を押すと出る吹き出しで、タップ・クリックで開閉し、Esc・外側のクリックで閉じる（hover だけに頼らない）。
// 吹き出しは画面に固定して置き、画面の端からはみ出さないように横位置を詰める（狭い画面でも読める）。
// 縦は、ボタンの下（足りなければ上の広い方）に置き、残りの高さを上限にして中でスクロールする（長い説明でも末尾まで読める）。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * 吹き出し・説明のダイアログを描く先（既定は body）。モーダルの `<dialog>`（top layer）の中では body に描くとダイアログの後ろに隠れるので、
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

/** 見出しの既定: 読み上げの名前（「…の説明」）から「の説明」を外したもの。 */
export function infoTitle(label: string): string {
  return label.replace(/\s*の説明$/, '') || label;
}

/**
 * 説明の ⓘ（D-129）。押すとモーダルのダイアログで中身を出す。× と Esc と背景で閉じ、閉じたらフォーカスを ⓘ に戻す。
 * ダイアログは開いている間だけ描く（1 つの画面に ⓘ が多数並ぶので、閉じた ⓘ は DOM にダイアログを置かない）。
 * 見出しは title（省略すると label から「の説明」を外したもの）。中身が長ければ本文だけスクロールする。
 */
export function Info({
  children,
  label = '説明',
  title,
  className = 'btn btn-ghost btn-xs btn-circle align-middle',
}: {
  children: ReactNode;
  /** ボタンの読み上げ（既定「説明」）。 */
  label?: string;
  /** ダイアログの見出し（対象の名前。省略すると infoTitle(label)）。 */
  title?: ReactNode;
  /** ボタンの class（既定は丸い小さいボタン）。 */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-info-button
        onClick={(e) => {
          // label の中に置かれても、選択肢を切り替えない
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <InfoIcon />
      </button>
      {open && (
        <InfoDialog
          title={title ?? infoTitle(label)}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        >
          {children}
        </InfoDialog>
      )}
    </>
  );
}

/** 説明のダイアログ（Info が開いている間だけ描く）。slot-compare.tsx の比較のダイアログと同じ組み方。 */
function InfoDialog({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const container = useContext(PortalContainer);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      data-info-dialog
      onClose={(e) => {
        // portal でも React の木では親のダイアログの子なので、close・キーの操作を親（比較・出来事のダイアログなど）へ伝えない
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      // label の中に置かれても、ダイアログの中のクリックで選択肢が切り替わらないように
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-box flex w-11/12 max-w-lg flex-col overflow-hidden px-3 py-4 text-left text-sm font-normal whitespace-normal sm:px-6">
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 text-base font-bold break-words">
            {title}
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="閉じる"
              autoFocus
            >
              ✕
            </button>
          </form>
        </div>
        <div
          className="mt-2 min-h-0 space-y-2 overflow-y-auto overscroll-contain break-words"
          data-info-body
        >
          {children}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>,
    container ?? document.body,
  );
}

/** 構成図の箱の吹き出し（部品の選択の UI。ⓘ の説明ではないのでダイアログにしない。D-129）。 */
export function Popover({
  children,
  label = '説明',
  trigger,
  className = 'btn btn-ghost btn-xs btn-circle align-middle',
  interactive = false,
  nameFromContent = false,
  hiddenName = false,
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
  /**
   * ボタンの名前を aria-label でなく中身（trigger）から取る（label は吹き出しの名前にだけ使う）。中身に見えている文字があるときに使う
   * （WCAG 2.5.3: 名前は見えている文字で始める。補足は中身の sr-only で後ろに足す。D-196）。
   */
  nameFromContent?: boolean;
  /**
   * ボタンの名前を、ボタンの中の hidden の要素（label の文字列）から aria-labelledby で取る（aria-label は付けない）。
   * 構成図の foreignObject の中の箱で使う: sr-only は position: absolute で、WebKit は foreignObject の中の位置指定の要素を
   * viewBox の拡大縮小を受けずに描く（D-213）。label は見えている文字で始める（WCAG 2.5.3。D-196）。
   */
  hiddenName?: boolean;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  // ボタンの要素は state に持つ（close を children(close) で渡すので、ref だと render 中に読むとみなされ React Compiler が最適化を諦める）
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  // 中の ⓘ の説明のダイアログ（画像の箱の設定のチップなど）は吹き出しの中に描く（外側のクリックとみなして閉じないように）
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const panelRef = useCallback((el: HTMLDivElement | null) => {
    panel.current = el;
    setPanelEl(el);
  }, []);
  const id = useId();
  const nameId = useId();
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
      // 中の説明のダイアログが開いていれば、Esc はそのダイアログを閉じる（吹き出しは閉じない）
      if (panel.current?.querySelector('dialog[open]')) return;
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
        aria-label={nameFromContent || hiddenName ? undefined : label}
        aria-labelledby={hiddenName ? nameId : undefined}
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
        {hiddenName && (
          <span id={nameId} hidden>
            {label}
          </span>
        )}
      </button>
      {open &&
        // body に出す（label の中に置かれても、吹き出しのクリックで選択肢が切り替わらないように）
        createPortal(
          <div
            ref={panelRef}
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
            <PortalContainer.Provider value={panelEl}>
              {typeof children === 'function' ? children(close) : children}
            </PortalContainer.Provider>
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
