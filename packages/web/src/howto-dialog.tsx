// 遊び方のダイアログ（D-146）。初めてゲームモードを開いたときに自動で開き、あとは設定の「遊び方を見る」・ヘッダーの「遊び方」で開く。
// 各ページに lucide-react のアイコンを組み合わせた図を置く（生成画像・ラスタは使わない。色は daisyUI のトークンだけで、ダークモードでも替わる）。
// ページ送りは出来事のダイアログ（game-screen/events.tsx の EventsDialog）と同じ作法: 見出しの下のナビ・固定の高さ・左右の矢印キー・横のスワイプ。
import {
  BookOpen,
  BookOpenText,
  CalendarDays,
  Flag,
  Gamepad2,
  Gauge,
  Hammer,
  Layers,
  type LucideIcon,
  Smile,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './motion.tsx';
import { AboutPage } from './howto/about-page.tsx';
import {
  SetupPage,
  MonthPage,
  SatisfactionPage,
  EffortPage,
  LimitsPage,
  EndingPage,
} from './howto/help-pages.tsx';
import { slideInClass, useSwipe } from './swipe.ts';

export { PREMISE_NOTE } from './howto/about-page.tsx';

/** ページの並び（D-146）。題はナビの点の名前にも使う。 */
export const HOWTO_PAGES: {
  title: string;
  Icon: LucideIcon;
  body: () => ReactNode;
}[] = [
  { title: 'このゲームについて', Icon: Gamepad2, body: AboutPage },
  { title: '始め方', Icon: Layers, body: SetupPage },
  { title: '毎月の流れ', Icon: CalendarDays, body: MonthPage },
  { title: '満足度', Icon: Smile, body: SatisfactionPage },
  { title: '開発の手間', Icon: Hammer, body: EffortPage },
  { title: '上限', Icon: Gauge, body: LimitsPage },
  { title: '終わり方と振り返り', Icon: Flag, body: EndingPage },
];

/**
 * 遊び方のダイアログ。× ・Esc・背景・「閉じる」・「始める」で閉じる（どれでも onClose）。
 * どこから開いても、まず 1 ページ目だけを出す（ページ送りを隠す）。1 ページ目を見て閉じるのが既定の動きで、ほかの説明は
 * 遊びながら画面で案内する。2 ページ目以降は機能ごとの詳しい説明（ヘルプに近い）で、「詳しい説明を見る」で開いたときだけ送れる。
 * first: 初めて自動で開いたとき（閉じるボタンを「始める」にし、あとから見直せる場所を添える）。
 */
export function HowtoDialog({
  first,
  onClose,
}: {
  first: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [view, setView] = useState({ page: 0, dir: 0 });
  const { page, dir } = view;
  // まず 1 ページ目だけ（詳しい説明は押したときだけ）
  const [expanded, setExpanded] = useState(false);
  const n = HOWTO_PAGES.length;
  const last = page === n - 1;
  const current = HOWTO_PAGES[page]!;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // ページを移ったら本文を先頭へ戻す。押したボタンが端で押せなくなったら、次へ（最後のページでは「始める」）へフォーカスを移す
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    bodyRef.current?.scrollTo?.({ top: 0 });
    const a = document.activeElement;
    if (
      a instanceof HTMLButtonElement &&
      !a.disabled &&
      ref.current?.contains(a)
    )
      return;
    (last ? doneRef : nextRef).current?.focus();
  }, [page, last]);
  const go = (to: number) => {
    if (!expanded) return;
    if (to < 0 || to >= n || to === page) return;
    moved.current = true;
    setView({ page: to, dir: to > page ? 1 : -1 });
  };
  // 横のスワイプ（縦のスクロールと区別する。swipe.ts）
  const swipe = useSwipe((d) => go(page + d));
  const Body = current.body;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="howto-dialog-title"
      data-howto-dialog
      onClose={onClose}
      onKeyDown={(k) => {
        if (k.key === 'ArrowRight') go(page + 1);
        else if (k.key === 'ArrowLeft') go(page - 1);
      }}
    >
      {/* 高さを一定にする（modal は縦中央なので、ページで高さが変わると上端・ナビが上下に動く。D-146） */}
      <div className="modal-box flex h-[min(42rem,calc(100dvh-2rem))] w-11/12 max-w-2xl flex-col overflow-hidden px-3 sm:px-6">
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2
            id="howto-dialog-title"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <BookOpen aria-hidden className="size-5 text-primary" />
            遊び方
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="遊び方を閉じる"
            >
              ✕
            </button>
          </form>
        </div>
        {expanded && (
          <nav
            className="mt-3 shrink-0 space-y-2 border-b border-base-300 pb-3"
            aria-label="遊び方のページ"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page === 0}
                onClick={() => go(page - 1)}
              >
                ← 前へ
              </button>
              <span
                className="min-w-12 text-center text-sm tabular-nums"
                aria-hidden
                data-howto-position
              >
                {page + 1} / {n}
              </span>
              <button
                ref={nextRef}
                type="button"
                className="btn btn-primary btn-sm"
                disabled={last}
                autoFocus
                onClick={() => go(page + 1)}
              >
                次へ →
              </button>
            </div>
            <span className="sr-only" aria-live="polite">
              {n} ページ中 {page + 1} ページ目: {current.title}
            </span>
            <ol className="flex items-center gap-0.5" data-howto-dots>
              {HOWTO_PAGES.map((p, i) => (
                <li key={p.title}>
                  <button
                    type="button"
                    className="flex h-6 items-center px-1"
                    aria-label={`${i + 1} ページ目: ${p.title}`}
                    aria-current={i === page ? 'step' : undefined}
                    title={p.title}
                    onClick={() => go(i)}
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        'block rounded-full',
                        i === page
                          ? 'h-2.5 w-2.5 bg-base-content/60'
                          : 'h-1.5 w-1.5 bg-base-content/30',
                      )}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div
          ref={bodyRef}
          className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          data-howto-page={page + 1}
          {...swipe}
        >
          <section
            key={page}
            aria-labelledby="howto-page-title"
            className={clsx('space-y-3', slideInClass(dir, reduced))}
          >
            <h3
              id="howto-page-title"
              className="flex items-center gap-2 font-bold"
            >
              <current.Icon aria-hidden className="size-5 text-primary" />
              {current.title}
            </h3>
            <Body />
          </section>
        </div>
        {/* 閉じる（初回は「始める」）を右の主のボタンにし、いつでも押せるようにする。詳しい説明への入口は左の控えめなリンク */}
        <div className="modal-action mt-3 shrink-0 items-end justify-between">
          {!expanded ? (
            <div className="flex min-w-0 flex-col items-start">
              {/* 詳しい説明を開ける印を添える。sm 未満は印だけ（名前は aria-label・title。ヘッダーの「遊び方」と同じ作り） */}
              <button
                type="button"
                className="btn btn-ghost btn-sm px-2"
                aria-label="詳しい説明を見る"
                title="詳しい説明を見る"
                onClick={() => {
                  moved.current = true;
                  setExpanded(true);
                  setView({ page: 1, dir: 1 });
                }}
              >
                <BookOpenText aria-hidden className="size-4" />
                <span className="hidden sm:inline">詳しい説明を見る</span>
              </button>
              {first && (
                <span className="text-xs opacity-70">
                  右上の「遊び方」からいつでも見直せます
                </span>
              )}
            </div>
          ) : (
            <span />
          )}
          <form method="dialog">
            <button
              ref={doneRef}
              className="btn btn-primary btn-sm"
              autoFocus={!expanded}
            >
              {first ? '始める' : '閉じる'}
            </button>
          </form>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>
  );
}
