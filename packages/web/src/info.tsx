// 説明の ⓘ ボタン（Info。選択肢の長い説明を畳む）と、構成図の箱を押したときの説明と部品の差し替え（Popover）。
// どちらも押すとダイアログ（daisyUI の modal）で中身を出す（D-129。Popover も D-221 で吹き出しからダイアログにした）。
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import { BookOpenText, ChevronDown } from 'lucide-react';
import { createPortal, flushSync } from 'react-dom';

/**
 * 吹き出し・説明のダイアログを描く先（既定は body）。モーダルの `<dialog>`（top layer）の中では body に描くとダイアログの後ろに隠れるので、
 * ダイアログがその要素を渡す（OCL-8E844E7C）。
 */
export const PortalContainer = createContext<HTMLElement | null>(null);

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
        // 中に重ねたダイアログ（ⓘ の中の「詳しく比べる」。D-219）の close は、React の木を伝ってここに来るので無視する
        if (e.target !== e.currentTarget) return;
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

/** 構成図の箱を押したときの説明と部品の差し替え（ⓘ と同じダイアログ。D-221 で吹き出しからダイアログにした）。 */
export function Popover({
  children,
  label = '説明',
  trigger,
  className = 'btn btn-ghost btn-xs btn-circle align-middle',
  nameFromContent = false,
  hiddenName = false,
}: {
  /** 中身。関数なら閉じる関数を受ける（部品を選んで閉じるとき）。 */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** ボタンの読み上げ（既定「説明」）。 */
  label?: string;
  /** ボタンの中身（既定は ⓘ。構成図の縦の図では箱そのものを押して説明を出す）。 */
  trigger?: ReactNode;
  /** ボタンの class（既定は丸い小さいボタン）。 */
  className?: string;
  /**
   * ボタンの名前を aria-label でなく中身（trigger）から取る（label はダイアログの見出しにだけ使う）。中身に見えている文字があるときに使う
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
  // 中身が多い（部品の差し替え・説明）ので、吹き出しでなく ⓘ と同じモーダルのダイアログで出す（D-221。画面の幅によらない）
  const [open, setOpen] = useState(false);
  // ボタンの要素は state に持つ（close を children(close) で渡すので、ref だと render 中に読むとみなされ React Compiler が最適化を諦める）
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const nameId = useId();
  const close = () => {
    // モーダルのダイアログが残っている間は背後の箱が inert で focus が効かないので、先にダイアログを外してから箱へ戻す
    // （中の「表と月額で比べる」で閉じて比較を開き、比較を閉じたときに箱へ戻れるように。OCL-349609BC）
    flushSync(() => setOpen(false));
    button?.focus();
  };
  return (
    <>
      <button
        ref={setButton}
        type="button"
        className={className}
        aria-label={nameFromContent || hiddenName ? undefined : label}
        aria-labelledby={hiddenName ? nameId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(e) => {
          // label の中に置かれても、選択肢を切り替えない
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {trigger ?? <InfoIcon />}
        {hiddenName && (
          <span id={nameId} hidden>
            {label}
          </span>
        )}
      </button>
      {open && (
        <InfoDialog title={infoTitle(label)} onClose={close}>
          {typeof children === 'function' ? children(close) : children}
        </InfoDialog>
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

/**
 * ⓘ のダイアログの中で、詳しい説明を畳む（遊び方の「詳しい説明を見る」と同じ形。2026-11-14）。
 * 押すとボタンの下に中身を出し、もう一度押すと畳む（うっかり開いたときに戻せる）。
 */
export function MoreDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm px-2"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <BookOpenText aria-hidden className="size-4" />
        {open ? '詳しい説明を畳む' : '詳しい説明を見る'}
        {/* 開けることが分かるように、開くと上を向く chevron を添える */}
        <ChevronDown
          aria-hidden
          className={clsx(
            'size-4 motion-safe:transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div id={id} className="space-y-2" data-more-details>
          {children}
        </div>
      )}
    </div>
  );
}
