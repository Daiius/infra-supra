import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { GameState, MonthEvent, MonthReport } from 'game';
import type { PlatformPremise } from 'estimator';
import { eventCategory, EventIcon } from '../event-icons.tsx';
import type { MonthDraft } from '../month-draft.ts';
import { PROPOSAL_BADGE, ProposalChoice } from '../proposal-choice.tsx';
import { hitLabel, hitTone } from '../premise-view.ts';
import { useReducedMotion } from '../motion.tsx';
import { slideInClass, useSwipe } from '../swipe.ts';

/**
 * 出来事のダイアログを自動で開いた月（D-126）。月ごとに 1 回だけ自動で開く（見積の画面から戻って作り直したときに再び開かない）。
 * ゲームの状態（保存）には入れず sessionStorage に「遊び始めの id: 月」を 1 つだけ持つ。使えない環境では覚えない。
 */
const EVENTS_SEEN_KEY = 'infra-supra:events-seen';
export function eventsSeen(runId: string, month: number): boolean {
  try {
    const v = sessionStorage.getItem(EVENTS_SEEN_KEY);
    if (!v) return false;
    const i = v.lastIndexOf(':');
    return v.slice(0, i) === runId && Number(v.slice(i + 1)) >= month;
  } catch {
    return false;
  }
}
export function markEventsSeen(runId: string, month: number) {
  try {
    sessionStorage.setItem(EVENTS_SEEN_KEY, `${runId}:${month}`);
  } catch {
    // 保存領域が使えない環境では覚えない（作り直すと再び開くだけ）
  }
}

// ページ送りの点の大きさと色: 今 > 未読 > 既読
const DOT_CLASS = {
  current: 'h-2.5 w-2.5 bg-base-content/60',
  unread: 'h-2 w-2 bg-primary/40',
  read: 'h-1.5 w-1.5 bg-base-content/30',
} as const;

/**
 * その月の出来事のダイアログ（D-23・D-126）。出来事を 1 件ずつの通知のカードで出し、見出しの下のナビ
 * （「← 前へ」「2 / 4」「次へ →」とページ送りの点）で左右に切り替える（左右の矢印キー・横のスワイプでも）。
 * 未読の数を見出しに、未読だったカードには角に「NEW」を出す。表示したページは既読にする（既読はダイアログを開いている間だけ）。
 * ナビは本文の上に置き、ページの高さが変わっても動かない。本文が長いときは本文だけをスクロールする。
 * `<dialog>` の showModal でフォーカスを閉じ込め、Esc・×・「あとで見る」・最後のページの「閉じる」で閉じる。
 * 選択（提案を受けるか断るか）はここに置かず、月の終わりの行動で選ぶ。
 */
export function EventsDialog({
  report: r,
  state,
  draft,
  auto,
  onClose,
}: {
  report: MonthReport;
  /** 今の状態（提案のページで受ける / 断るを選ぶ。D-202）。 */
  state: GameState;
  /** 今月の行動の下書き（行動の欄と共有する。D-202）。 */
  draft: MonthDraft;
  auto: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // page: 今のページ / read: 表示したページ（今のページを含む） / fresh: 今のページが開いた時点で未読だったか / dir: 移った向き
  const [view, setView] = useState({
    page: 0,
    read: new Set([0]),
    fresh: true,
    dir: 0,
  });
  const { page, read, fresh, dir } = view;
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // 月が進んだ直後は、閉じたときにフォーカスが「次の月へ」へ戻ってページがそこまでスクロールする。
    // 開く前にフォーカスを外し、閉じた後もページの先頭のままにする（開き直したときはボタンへ戻す）。
    if (auto && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    d.showModal();
  }, [auto]);
  const n = r.events.length;
  const last = page >= n - 1;
  const e = r.events[Math.min(page, n - 1)]!;
  // 受ける / 断るをまだ選べる開発依頼か
  const choosing =
    e.phase === 'proposal' && state.pendingProposals.includes(e.id);
  const unread = n - read.size;
  // ページを移ったら本文を先頭へ戻す。押したボタンが端で押せなくなったら、次へ（最後のページでは「閉じる」）へフォーカスを移す
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
    (last ? closeRef : nextRef).current?.focus();
  }, [page, last]);
  const go = (to: number) => {
    if (to < 0 || to >= n || to === page) return;
    moved.current = true;
    setView({
      page: to,
      read: new Set(read).add(to),
      fresh: !read.has(to),
      dir: to > page ? 1 : -1,
    });
  };
  // 横のスワイプ（縦のスクロールと区別する。swipe.ts）
  const swipe = useSwipe((d) => go(page + d));
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="events-dialog-title"
      onClose={onClose}
      onKeyDown={(k) => {
        // 提案のページの受ける / 断るの radio は矢印で選び直すので、ページは送らない（D-202）
        if (k.target instanceof HTMLInputElement) return;
        if (k.key === 'ArrowRight') go(page + 1);
        else if (k.key === 'ArrowLeft') go(page - 1);
      }}
    >
      <div
        // 2 件以上の月は高さを一定にする（modal は縦中央なので、高さが変わると上端・ナビ・閉じるが上下に動く）。
        // 短いページは本文の下が空くだけ。1 件だけの月は内容に合わせる
        className={clsx(
          'modal-box flex w-11/12 max-w-2xl flex-col overflow-hidden px-3 sm:px-6',
          n > 1 && 'h-[min(40rem,calc(100dvh-2rem))]',
        )}
        data-events-fixed-height={n > 1 ? '' : undefined}
      >
        {/* × は見出しの行の右上。ナビは別の行の左に寄せ、× の真下に「次へ」が来ないようにする */}
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2
            id="events-dialog-title"
            className="flex flex-wrap items-center gap-x-2 text-lg font-bold"
          >
            <span>
              {r.month} か月目のイベント（{n} 件）
            </span>
            {n > 1 && (
              <span
                className={`badge badge-sm font-normal ${unread > 0 ? 'badge-primary badge-soft' : 'badge-ghost'}`}
                data-events-unread
              >
                {unread > 0 ? `未読 ${unread}` : '✓ すべて既読'}
              </span>
            )}
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="ダイアログを閉じる"
            >
              ✕
            </button>
          </form>
        </div>
        {n > 1 && (
          <nav
            className="mt-3 shrink-0 space-y-2 border-b border-base-300 pb-3"
            aria-label="イベントのページ"
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
                data-events-position
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
            {/* 位置と未読の数は読み上げにも伝える（ページを移るたびに読む） */}
            <span className="sr-only" aria-live="polite">
              {n} 件中 {page + 1} 件目。
              {unread > 0 ? `未読 ${unread} 件` : 'すべて既読'}
            </span>
            {/* ページ送りの点（daisyUI の status）。今のページは大きい neutral、未読は中くらいの薄い primary、既読は小さい灰色（色だけでなく大きさで見分ける）。押すとそのページへ */}
            <ol className="flex items-center gap-0.5" data-events-dots>
              {r.events.map((x, i) => {
                const state =
                  i === page ? 'current' : read.has(i) ? 'read' : 'unread';
                return (
                  <li key={`${x.id}:${x.phase}`}>
                    <button
                      type="button"
                      className="flex h-6 items-center px-1"
                      aria-label={`${i + 1} 件目（${read.has(i) ? '既読' : '未読'}）: ${x.title}`}
                      aria-current={i === page ? 'step' : undefined}
                      title={x.title}
                      data-dot={state}
                      onClick={() => go(i)}
                    >
                      {/* 普通の塗りの丸。大きさでも見分ける: 今 > 未読 > 既読 */}
                      <span
                        aria-hidden
                        className={clsx('block rounded-full', DOT_CLASS[state])}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <div
          ref={bodyRef}
          className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          data-events-page
          {...swipe}
        >
          {/* key でページごとに作り直し、滑り込みの動きを毎回始める（動きを減らす設定では付けない） */}
          <div
            key={page}
            className={clsx('relative pt-2', slideInClass(dir, reduced))}
          >
            {fresh && n > 1 && (
              <span
                className="badge badge-primary badge-soft badge-xs absolute top-0 right-2 z-10"
                data-events-new
              >
                NEW
              </span>
            )}
            <EventCard
              key={`${e.id}:${e.phase}`}
              event={e}
              premises={r.premises}
              choosing={choosing}
            />
            {/* 提案のページで受ける / 断るを選ぶ（行動の欄と同じ下書き。選べば「次の月へ」の確認は出ない。D-202） */}
            {choosing && (
              <div className="mt-2">
                <ProposalChoice
                  state={state}
                  id={e.id}
                  draft={draft}
                  where="dialog"
                />
              </div>
            )}
          </div>
        </div>
        <div className="modal-action mt-3 shrink-0 flex-wrap items-center gap-2">
          {last ? (
            <form method="dialog">
              <button
                ref={closeRef}
                className="btn btn-primary btn-sm"
                autoFocus={n === 1}
              >
                閉じる
              </button>
            </form>
          ) : (
            <form method="dialog">
              <button className="btn btn-ghost btn-sm">
                あとで見る（閉じる）
              </button>
            </form>
          )}
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

/**
 * 出来事の印（D-28）。予告・予告なしで今月発生・予告どおり起きた・提案を、印・色・文言の 3 つで区別する（色だけにしない）。
 */
export function eventBadge(e: MonthEvent): {
  label: string;
  cls: string;
  /** 印の横に添える短い説明。 */
  note?: string;
} {
  switch (e.phase) {
    case 'notice':
      return { label: '⏳ 予告: 来月起きそう', cls: 'badge-warning' };
    case 'proposal':
      return PROPOSAL_BADGE;
    case 'occurred':
      return e.announced === false
        ? {
            label: '⚡ 今月発生',
            cls: 'badge-error',
            note: e.botBlocked
              ? '今月の費用・満足度に効いています（遮断済みで半分）'
              : '今月の費用・満足度に効いています。対処は来月から',
          }
        : e.announced === true
          ? { label: '● 起きた（先月の予告どおり）', cls: 'badge-info' }
          : { label: '● 起きた', cls: 'badge-info' };
  }
}
/** Bot を遮断済みの月の Bot の出来事・予告に添える印（色だけに頼らず文字も出す。2026-11-04）。 */
export const BLOCKED_LABEL = '🛡 対策済み';
export function BlockedBadge({ event: e }: { event: MonthEvent }) {
  if (!e.botBlocked) return null;
  return <span className="badge badge-sm badge-success">{BLOCKED_LABEL}</span>;
}

export const TIER_LABEL: Record<MonthEvent['tier'], string> = {
  common: 'ふだん',
  occasional: 'ときどき',
  rare: 'まれ',
};

/** 当たった前提の印の色のクラス（D-188。daisyUI のクラスは文字列のまま書く）。 */
export const HIT_BADGE = {
  error: 'badge-error',
  warning: 'badge-warning',
} as const;

/** 出来事の通知（prd/07 §10.2）。当たりうる前提は catalog の文のまま出す（D-12）。 */
export function EventCard({
  event: e,
  premises,
  choosing = false,
}: {
  event: MonthEvent;
  /** 同じ月の前提。出来事の前提の効き方（止まる・課金など）を引き、印の色を分ける（D-188）。 */
  premises: readonly PlatformPremise[];
  /** すぐ下で受ける / 断るを選べる（出来事のダイアログの提案のページ。D-202）。 */
  choosing?: boolean;
}) {
  const badge = eventBadge(e);
  // 効き方が引けない前提は、今までどおり止まる側（赤）に倒す
  const effectOf = (id: string) => premises.find((p) => p.id === id)?.effect;
  return (
    <div
      className={`rounded-box border p-3 ${e.tier === 'rare' ? 'border-error' : 'border-base-300'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${badge.cls}`}>{badge.label}</span>
        <BlockedBadge event={e} />
        {badge.note && <span className="text-xs">{badge.note}</span>}
        <span className="badge badge-sm badge-outline">
          {TIER_LABEL[e.tier]}
        </span>
        {/* 種類の印（D-140）。始める画面の出来事の説明の行と同じ印 */}
        <span className="flex items-center gap-1.5 font-semibold">
          <EventIcon category={eventCategory(e)} />
          {e.title}
        </span>
      </div>
      <div className="mt-1 text-sm">{e.text}</div>
      {e.effects.length > 0 && (
        <div className="mt-1 text-xs opacity-70">
          効果: {e.effects.join('・')}
        </div>
      )}
      {e.accept && (
        <div className="mt-1 text-xs opacity-70">
          受けると: {e.accept.effects.join('・')}
          {choosing ? '' : '。月の終わりのアクションで受けるか断るかを選びます'}
          （
          {e.accept.declineLoss
            ? `断ると${e.accept.declineLoss}`
            : '断っても罰はありません'}
          ）
        </div>
      )}
      {e.unavailable && (
        // 今の構成では受けられない提案は、返事を待たずに断ったことにした（D-201）
        <div className="mt-1 text-xs" data-event-unavailable>
          <span className="mr-1 badge badge-ghost badge-xs">返事は不要</span>
          受けられないので、断ったことになります
        </div>
      )}
      {e.accept?.unavailable && (
        <div className="mt-1 text-xs text-error-strong">
          ✗ 受けられない: {e.accept.unavailable}
        </div>
      )}
      {e.requirementStatus && e.requirementStatus.length > 0 && (
        // 受ける前に、部品ごとに要件を満たせるかを出す（D-32。印とラベルで、色だけにしない）
        <ul className="mt-1 space-y-0.5 text-xs">
          {e.requirementStatus.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-1">
              <span
                className={`badge badge-xs ${r.ok ? 'badge-success' : 'badge-error'}`}
              >
                {r.ok ? '✓ 満たせる' : '✗ 満たせない'}
              </span>
              <span className="font-semibold">
                {r.label}
                {r.current ? '（今）' : ''}
              </span>
              <span className="opacity-80">{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {e.sla && e.sla.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs opacity-80">
          {e.sla.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {e.members && e.members.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs opacity-80">
          {e.members.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {e.premises.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {e.premises.map((p) => {
            const effect = effectOf(p.id);
            const tone = effect ? hitTone(effect) : 'error';
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-1"
                data-event-premise={effect ?? ''}
              >
                <span
                  className={`badge badge-xs ${p.hit ? HIT_BADGE[tone] : 'badge-ghost'}`}
                >
                  {p.hit
                    ? `${tone === 'error' ? '✗' : '●'} ${effect ? hitLabel(effect) : '上限に達した'}`
                    : '○ 達する可能性のある上限'}
                </span>
                {p.text}
                {p.ratio !== undefined && (
                  <span className="tabular-nums opacity-70">
                    （今 {(p.ratio * 100).toFixed(0)}%）
                  </span>
                )}
                {p.detail && (
                  <span className="basis-full opacity-80">{p.detail}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
