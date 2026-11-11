// ヘッダーの「ゲームの操作」のメニュー（D-210）。狭い画面（sm 未満）だけ、「過去の月に戻る…」と「新しいゲーム」を
// 1 つのドロップダウンにまとめる（+ のアイコンだけでは新しいゲームだと分からなかった）。sm 以上は文字つきのボタンを並べる（App.tsx）。
// 開くボタンは戻るのアイコン + 下向きの三角。Enter / Space で開き、矢印・Tab で項目へ、Esc・外側のクリック・フォーカスが外へ出ると閉じる。
import { ChevronDown, Plus, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export function GameMenu({
  canRewind,
  onRewind,
  onRestart,
}: {
  /** 戻れる月があるか（1 か月目は無いので、項目は押せない形で見せる）。 */
  canRewind: boolean;
  onRewind: () => void;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const reasonId = useId();
  const rewindLabelId = useId();

  const items = () =>
    [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ] as HTMLElement[];
  const focusItem = (index: number) => {
    const list = items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]!.focus();
  };

  // 開いたら最初の項目へ（キーボードでもタップでも同じ）
  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  // 外側を押すと閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  // 項目を選んだら閉じてフォーカスを開くボタンに戻し、そのあとダイアログを開く（閉じたダイアログはフォーカスを開くボタンへ返す）
  const select = (action: () => void) => {
    close(true);
    action();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(list.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
    }
  };

  const itemClass =
    'flex min-h-10 w-full items-center gap-2 rounded-field px-3 py-2 text-left text-sm';
  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        // フォーカスがメニューの外の要素へ移ったら閉じる（Tab で抜けたとき）。行き先が無い blur（relatedTarget が null）は無視する:
        // Safari（iPhone も）はボタンを押してもフォーカスを移さず、押した瞬間に今の項目を blur するだけなので、ここで閉じると
        // 項目が消えて click が届かず「新しいゲーム」が反応しなかった。外側を押したときは上の pointerdown で閉じる
        const to = e.relatedTarget as Node | null;
        if (open && to && !rootRef.current?.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm gap-0 px-1"
        aria-label="ゲームの操作"
        title="ゲームの操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close(true);
          }
        }}
      >
        <Undo2 aria-hidden className="size-4" />
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      {open && (
        // ヘッダーの右端なので、メニューは右揃え（左へ広がる）にして幅 360px でも画面からはみ出さない
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="ゲームの操作"
          className="absolute top-full right-0 z-50 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
          onKeyDown={onMenuKey}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              aria-disabled={!canRewind || undefined}
              // 名前は項目の見出しだけにし、押せない理由は説明として読む
              aria-labelledby={rewindLabelId}
              aria-describedby={canRewind ? undefined : reasonId}
              className={`${itemClass} ${
                canRewind
                  ? 'hover:bg-base-200 focus-visible:bg-base-200'
                  : 'cursor-not-allowed text-base-content/50'
              }`}
              onClick={() => {
                if (canRewind) select(onRewind);
              }}
            >
              <Undo2 aria-hidden className="size-4 shrink-0" />
              <span className="flex flex-col">
                <span id={rewindLabelId}>過去の月に戻る…</span>
                {!canRewind && (
                  <span id={reasonId} className="text-xs">
                    戻れる月はまだありません
                  </span>
                )}
              </span>
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={`${itemClass} hover:bg-base-200 focus-visible:bg-base-200`}
              onClick={() => select(onRestart)}
            >
              <Plus aria-hidden className="size-4 shrink-0" />
              <span>新しいゲーム</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
