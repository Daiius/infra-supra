// ゲームモードの運営中の画面（月の報告・行動・推移・結果）。App から分けて読む（始める画面の初回の読み込みに含めない）。
import { useEffect, useRef, useState } from 'react';
import {
  isPolicyViolation,
  policyCauseOf,
  premisePlanLabel,
  activeCommitments,
  commitmentOffers,
  PAYMENT_LABEL,
  type CommitmentPaymentId,
  actionEffort,
  resultAxesOf,
  BOT_BLOCK,
  cashProjectionOf,
  isTrafficSpike,
  comparisonRows,
  fixedSettingValue,
  settingInactiveReason,
  settingNote,
  EFFORT,
  effortTotalNote,
  featureOutlook,
  featureProgressOf,
  featureRuleText,
  ELEMENT_LABEL,
  ELEMENTS,
  END_LABEL,
  eventDef,
  hiddenSettings,
  storageOptionText,
  nextSsrCpuMs,
  premiseTrends,
  projectionNote,
  reflectionOf,
  retryHintsOf,
  scenarioOf,
  selectTrends,
  offeredBaselines,
  invalidationNote,
  onDemandInvalidationEstimate,
  settingFlavor,
  SETTINGS,
  STAGE_LABEL,
  type Action,
  type Axes,
  type GameState,
  type MonthEvent,
  type MonthReport,
  type Scenario,
  type Surprise,
  type SettingKey,
  type Stage,
  ASTRO_ON_DEMAND,
  NEXT_ON_DEMAND,
} from 'game';
import type { PlatformPremise } from 'estimator';
import { compact, LineChart, Sparkline, useNarrowScreen } from './charts.tsx';
import { ResultAxesPanel } from './result-axes.tsx';
import { ResultStatsSection } from './stats-breakdown.tsx';
import type { StatsQuery } from './stats-client.ts';
import {
  distributionFireworkLevel,
  TOP_PERCENT,
  topAxesCount,
  type StatsView,
} from './distribution.ts';
import {
  compareWithHistory,
  type AxisComparison,
  type ResultEntry,
} from './results-history.ts';
import { Info } from './info.tsx';
import { eventCategory, EventIcon } from './event-icons.tsx';
import { FeatureRing, featureStageView } from './feature-ring.tsx';
import { Meta, NameWithInfo, OptionText } from './option-text.tsx';
import { SetupChangeField } from './setup-change-field.tsx';
import { useMonthDraft, type MonthDraft } from './month-draft.ts';
import { PROPOSAL_BADGE, ProposalChoice } from './proposal-choice.tsx';
import { commitmentMeta, usd } from './commitment-meta.ts';
import { CreditBar } from './credit-bar.tsx';
import {
  creditUseText,
  hitLabel,
  hitTone,
  isCreditUse,
  isStopping,
} from './premise-view.ts';
import {
  CountUp,
  FireworksCanvas,
  FireworksEngine,
  useReducedMotion,
} from './motion.tsx';
import { isZeroText, roundInt, signedText } from './format.ts';

const pct = (n: number) => signedText(n, (a) => `${(a * 100).toFixed(0)}%`);
const scrollTop = () => window.scrollTo({ top: 0 });

/** 確約の行動（D-97）。今月の明細に対象の使用がある確約だけ出す。結んだ確約は期間を出す。 */
function CommitmentsSection({
  state,
  value,
  onChange,
  blocked,
}: {
  state: GameState;
  value: Record<string, CommitmentPaymentId>;
  onChange: (v: Record<string, CommitmentPaymentId>) => void;
  blocked: (v: Record<string, CommitmentPaymentId>) => string | null;
}) {
  const active = activeCommitments(state);
  const offers = commitmentOffers(state).filter(
    (o) => !active.some((c) => c.key === o.key),
  );
  if (!active.length && !offers.length) return null;
  return (
    <>
      <div className="divider my-1 text-xs">
        1 年契約（途中でやめられません）
      </div>
      {active.map((c) => (
        <div key={c.key} className="py-1 text-sm">
          1 年契約中: {c.label}（{PAYMENT_LABEL[c.payment]}・{c.endMonth}{' '}
          か月目まで。取り消せません）
        </div>
      ))}
      {offers.map((o) => {
        const on = value[o.key] === o.payment;
        const next = { ...value, [o.key]: o.payment };
        const why = on ? null : blocked(next);
        return (
          <label
            key={`${o.key}:${o.payment}`}
            className="flex cursor-pointer items-start gap-3 py-1"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-1"
              checked={on}
              disabled={!on && why !== null}
              onChange={(e) => {
                const v = { ...value };
                if (e.target.checked) v[o.key] = o.payment;
                else delete v[o.key];
                onChange(v);
              }}
            />
            <OptionText
              name={`${o.label}を結ぶ`}
              meta={[...commitmentMeta(o), '来月から']}
              info={
                <Info title={`${o.label}を結ぶ`}>
                  {o.premise}
                  。契約の額は今月の対象の使用（オンデマンドの額）で決まり、超えた分はオンデマンドのままです。取り消せず、乗り換え・部品の切り替えで使わなくなっても支払いは残ります。
                </Info>
              }
              why={why}
            />
          </label>
        );
      })}
    </>
  );
}

/**
 * 出来事のダイアログを自動で開いた月（D-126）。月ごとに 1 回だけ自動で開く（見積の画面から戻って作り直したときに再び開かない）。
 * ゲームの状態（保存）には入れず sessionStorage に「遊び始めの id: 月」を 1 つだけ持つ。使えない環境では覚えない。
 */
const EVENTS_SEEN_KEY = 'infra-supra:events-seen';
function eventsSeen(runId: string, month: number): boolean {
  try {
    const v = sessionStorage.getItem(EVENTS_SEEN_KEY);
    if (!v) return false;
    const i = v.lastIndexOf(':');
    return v.slice(0, i) === runId && Number(v.slice(i + 1)) >= month;
  } catch {
    return false;
  }
}
function markEventsSeen(runId: string, month: number) {
  try {
    sessionStorage.setItem(EVENTS_SEEN_KEY, `${runId}:${month}`);
  } catch {
    // 保存領域が使えない環境では覚えない（作り直すと再び開くだけ）
  }
}

/** 再開の知らせを出しておく時間（ミリ秒）。 */
const RESUMED_TOAST_MS = 6000;

/** 保存から再開したことの知らせ（daisyUI の toast。画面の右下）。 */
function ResumedToast({
  month,
  ended,
  onClose,
}: {
  month: number;
  ended: boolean;
  onClose: () => void;
}) {
  return (
    <div className="toast toast-end toast-bottom z-50">
      <div
        role="status"
        data-resumed-toast
        className="alert alert-info py-2 text-sm shadow"
      >
        <span>
          {ended
            ? `前回の結果（${month} か月目に終了）を表示しています`
            : `前回の続き（${month} か月目）から再開しました`}
        </span>
        <button
          className="btn btn-ghost btn-xs btn-circle"
          aria-label="知らせを閉じる"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function Game({
  state,
  restored,
  resumeNotice,
  onResumeNoticeShown,
  runId,
  results,
  playId,
  stats,
  statsQuery = null,
  onAdvance,
  previous,
  onPickRewind,
  onClearPrevious,
}: {
  state: GameState;
  /** 保存から再開した（出来事・完走のダイアログを自動では開かない。D-26）。 */
  restored: boolean;
  /** 再開の知らせをまだ出していない（保存から再開した直後だけ true）。 */
  resumeNotice: boolean;
  /** 再開の知らせを出した（App のセッションに印を付け、作り直しても出し直さない）。 */
  onResumeNoticeShown: () => void;
  /** 遊び始め（始めた・再開した）ごとの id。出来事のダイアログを月ごとに 1 回だけ自動で開くのに使う（D-126）。 */
  runId: string;
  /** 手元の結果の履歴（D-144。新しい順。今のプレイの記録を含みうる）。 */
  results: readonly ResultEntry[];
  /** 今のプレイの id（履歴の中の今のプレイの記録を比較から除く）。 */
  playId: string;
  /** 集計の分布の中での位置（段 3・D-161）。ready でなければ手元の履歴との比較（段 1）を出す。 */
  stats: StatsView;
  /** 結果の画面の絞り込みと比較の図の元（始めたときの構成など。D-175）。無ければ出さない。 */
  statsQuery?: Omit<StatsQuery, 'axes'> | null;
  /** 月の終わりの行動を当てて次の月へ進める（保存も更新する）。 */
  onAdvance: (actions: Action[]) => GameState;
  /** 前の試行（D-128。保存の前の試行を再生した状態）。無ければ null。 */
  previous: GameState | null;
  /** 履歴の行の「この月に戻る」で、その月を選んだ状態で戻るダイアログを開く（D-128・D-192。ダイアログは App が持つ）。 */
  onPickRewind: (month: number) => void;
  /** 前の試行を消す（D-128）。 */
  onClearPrevious: () => void;
}) {
  const report = state.history[state.history.length - 1]!;
  const playing = state.phase === 'playing';
  // 4 軸と手元の履歴との比較（D-132・D-144）。終わったときだけ
  const comparisons = playing
    ? []
    : compareWithHistory(
        {
          id: playId,
          scenarioId: scenarioOf(state).id,
          axes: resultAxesOf(state),
        },
        results,
      );
  // 月が進んだ直後に、その月の出来事をダイアログで出す（D-23）。結果の画面では出さない。
  // auto: 月が進んだ直後に開いた / manual: 月のカードのボタンで開き直した。
  /**
   * 完走のダイアログを開いた回数（結果の画面のボタンで開き直す。D-25）。null は開いていない
   * （保存から再開したときは自動で開かない。D-26）。
   */
  const [celebration, setCelebration] = useState<number | null>(
    restored ? null : 0,
  );
  useEffect(() => {
    if (state.phase !== 'completed') setCelebration(0);
  }, [state.phase]);
  const [eventsOpen, setEventsOpen] = useState<'auto' | 'manual' | null>(() =>
    playing &&
    !restored &&
    report.events.length > 0 &&
    !eventsSeen(runId, report.month)
      ? 'auto'
      : null,
  );
  useEffect(() => {
    if (eventsOpen === 'auto') markEventsSeen(runId, report.month);
  }, [eventsOpen, runId, report.month]);
  // 保存から再開したときに一度だけ出す知らせ（数秒で消える・× で閉じる）。出したことは外側（App のセッション）に返し、
  // 見積の画面から戻ってこの画面を作り直しても出し直さない
  const [resumed, setResumed] = useState(resumeNotice);
  useEffect(() => {
    if (resumeNotice) onResumeNoticeShown();
    // 作られたときに一度だけ（出した印を返す）
  }, []);
  useEffect(() => {
    if (!resumed) return;
    const t = setTimeout(() => setResumed(false), RESUMED_TOAST_MS);
    return () => clearTimeout(t);
  }, [resumed]);
  // 戻れるのは行動を選んだ月（今の月より前）だけ（D-128）。戻る入口はヘッダーと履歴の行（D-192）
  const rewindable = state.history.length - 1;
  // 今月の行動の下書き。行動の欄と出来事のダイアログの提案のページで共有する（どちらで返事を選んでも同じ。D-202）
  const monthDraft = useMonthDraft(state);
  return (
    <>
      {resumed && (
        <ResumedToast
          month={report.month}
          ended={!playing}
          onClose={() => setResumed(false)}
        />
      )}
      {state.phase === 'completed' && celebration !== null && (
        // key を変えると最初と同じように開き直す（暗い背景と花火も再開）
        <VictoryCelebration
          key={celebration}
          state={state}
          comparisons={comparisons}
          stats={stats}
          auto={celebration === 0}
        />
      )}
      {!playing && (
        <Result
          state={state}
          comparisons={comparisons}
          stats={stats}
          statsQuery={
            statsQuery ? { ...statsQuery, axes: resultAxesOf(state) } : null
          }
          onCelebrate={() => setCelebration((n) => (n ?? 0) + 1)}
        />
      )}
      <Trends
        history={state.history}
        scenario={scenarioOf(state)}
        ended={state.phase !== 'playing'}
        previous={previous}
        onClearPrevious={onClearPrevious}
      />
      <MonthCard
        report={report}
        scenario={scenarioOf(state)}
        onShowEvents={playing ? () => setEventsOpen('manual') : undefined}
      />
      {playing && (
        <Actions
          state={state}
          draft={monthDraft}
          onDecide={(actions) => {
            const next = onAdvance(actions);
            const last = next.history[next.history.length - 1]!;
            setEventsOpen(
              next.phase === 'playing' && last.events.length > 0
                ? 'auto'
                : null,
            );
            scrollTop();
          }}
        />
      )}
      {playing && eventsOpen && (
        <EventsDialog
          // 月が替わったら 1 ページ目から
          key={report.month}
          report={report}
          state={state}
          draft={monthDraft}
          auto={eventsOpen === 'auto'}
          onClose={() => setEventsOpen(null)}
        />
      )}
      <History
        history={state.history}
        rewindable={rewindable}
        onRewind={onPickRewind}
      />
    </>
  );
}

/**
 * 完走のダイアログと花火（D-25・D-131）。4 軸の値と集計の分布の中での位置（段 3・D-161）か手元の履歴との比較を出し、分布があれば上位に入った軸（向きのある 3 軸）が多いほど花火を増やす（D-163）。分布が無ければ花火はいつも 1 段（D-168）。開いている間は暗い背景の上で花火を打ち上げ続ける（ダイアログの背面・背景の前面）。
 * 閉じると背景が消え、新しい花火は出さない。空中に残った粒は少し薄くして、寿命で消えるまで描いてから片付ける。
 * 動きを減らす設定では、ダイアログだけ出して花火は出さない。作法は出来事のダイアログ（D-23）と同じ。
 */
function VictoryCelebration({
  state,
  comparisons,
  stats,
  auto,
}: {
  state: GameState;
  comparisons: readonly AxisComparison[];
  stats: StatsView;
  /** 完走した直後に開いた（true）か、結果の画面のボタンで開き直した（false）か。 */
  auto: boolean;
}) {
  const reduced = useReducedMotion();
  // 書き換えながら使い、effect の依存にもなるので、参照が変わらない useState で持つ（useMemo は捨てられうる）
  const [engine] = useState(() => new FireworksEngine());
  const [open, setOpen] = useState(true);
  const [afterglow, setAfterglow] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // 完走した直後はフォーカスを外して開く（閉じた後もページの先頭のまま）。開き直したときはボタンへ戻す（D-23 と同じ）
    if (auto && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    d.showModal();
  }, [auto]);
  // 分布があれば上位に入った軸の数で花火の段を決め、無ければいつも 1 段（D-163・D-168。自己ベストの数では変えない）
  const dist = stats.status === 'ready' ? stats.view : null;
  const level = dist ? distributionFireworkLevel(dist) : 1;
  const topAxes = dist ? topAxesCount(dist) : 0;
  const cashGuide = scenarioOf(state).goal.cash;
  return (
    <>
      {open && (
        <dialog
          ref={ref}
          className="modal"
          // 花火が映える暗い背景
          style={{ backgroundColor: 'rgba(6, 8, 22, 0.86)' }}
          aria-labelledby="victory-title"
          data-firework-level={level}
          onClose={() => {
            setOpen(false);
            setAfterglow(!reduced && engine.particles.length > 0);
          }}
        >
          {/* 見出しと閉じるボタンは固定し、4 軸の欄だけを縦にスクロールする（狭い画面で分布が高さを超える。OCL-3AA8C258） */}
          <div className="modal-box relative z-10 flex max-w-lg flex-col overflow-hidden p-0">
            {/* 成功の色の帯で見出しを強調する（色だけにせず ✓ とラベルを添える） */}
            <div className="shrink-0 bg-success px-6 py-5 text-success-content">
              <h2 id="victory-title" className="text-3xl font-bold">
                ✓ 完走
              </h2>
              <p className="mt-1 text-sm">
                {state.end!.month} か月の運営を走り切りました。4
                つの軸で振り返りましょう
                {dist &&
                  topAxes > 0 &&
                  `（${topAxes} つの軸で上位 ${TOP_PERCENT}% に入りました）`}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
              <ResultAxesPanel
                comparisons={comparisons}
                stats={stats}
                outages={state.outages}
                cashGuide={cashGuide}
                size="lg"
              />
            </div>
            <div className="modal-action shrink-0 px-6 pb-6">
              <form method="dialog">
                <button className="btn btn-success" autoFocus>
                  閉じて結果を見る
                </button>
              </form>
            </div>
          </div>
          {/* 花火はダイアログより前面に描く（操作は妨げない） */}
          {!reduced && (
            <FireworksCanvas
              engine={engine}
              spawn
              level={level}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
            />
          )}
          <form method="dialog" className="modal-backdrop">
            <button aria-label="閉じる" tabIndex={-1}>
              閉じる
            </button>
          </form>
        </dialog>
      )}
      {afterglow && (
        <FireworksCanvas
          engine={engine}
          spawn={false}
          alpha={0.45}
          className="pointer-events-none fixed inset-0 z-40 h-full w-full"
          onEmpty={() => setAfterglow(false)}
        />
      )}
    </>
  );
}

/**
 * その月の出来事のダイアログ（D-23・D-126）。出来事を 1 件ずつの通知のカードで出し、見出しの下のナビ
 * （「← 前へ」「2 / 4」「次へ →」とページ送りの点）で左右に切り替える（左右の矢印キー・横のスワイプでも）。
 * 未読の数を見出しに、未読だったカードには角に「NEW」を出す。表示したページは既読にする（既読はダイアログを開いている間だけ）。
 * ナビは本文の上に置き、ページの高さが変わっても動かない。本文が長いときは本文だけをスクロールする。
 * `<dialog>` の showModal でフォーカスを閉じ込め、Esc・×・「あとで見る」・最後のページの「閉じる」で閉じる。
 * 選択（提案を受けるか断るか）はここに置かず、月の終わりの行動で選ぶ。
 */
function EventsDialog({
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
  // 横のスワイプ（縦のスクロールと区別するため、横の動きが縦より大きく 50px 以上のときだけ）
  const touch = useRef<{ x: number; y: number } | null>(null);
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
        className={`modal-box flex max-h-[calc(100dvh-2rem)] w-11/12 max-w-2xl flex-col overflow-hidden px-3 sm:px-6 ${n > 1 ? 'h-[min(40rem,calc(100dvh-2rem))]' : ''}`}
        data-events-fixed-height={n > 1 ? '' : undefined}
      >
        {/* × は見出しの行の右上。ナビは別の行の左に寄せ、× の真下に「次へ」が来ないようにする */}
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2
            id="events-dialog-title"
            className="flex flex-wrap items-center gap-x-2 text-lg font-bold"
          >
            <span>
              {r.month} か月目の出来事（{n} 件）
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
            aria-label="出来事のページ"
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
                        className={`block rounded-full ${
                          state === 'current'
                            ? 'h-2.5 w-2.5 bg-base-content/60'
                            : state === 'unread'
                              ? 'h-2 w-2 bg-primary/40'
                              : 'h-1.5 w-1.5 bg-base-content/30'
                        }`}
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
          onTouchStart={(t) => {
            const p = t.touches[0];
            touch.current = p ? { x: p.clientX, y: p.clientY } : null;
          }}
          onTouchEnd={(t) => {
            const s0 = touch.current;
            const p = t.changedTouches[0];
            touch.current = null;
            if (!s0 || !p) return;
            const dx = p.clientX - s0.x;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(p.clientY - s0.y))
              go(dx < 0 ? page + 1 : page - 1);
          }}
        >
          {/* key でページごとに作り直し、滑り込みの動きを毎回始める（動きを減らす設定では付けない） */}
          <div
            key={page}
            className={`relative pt-2 ${
              reduced || dir === 0
                ? ''
                : dir > 0
                  ? 'motion-slide-from-right'
                  : 'motion-slide-from-left'
            }`}
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
              choosing={
                e.phase === 'proposal' && state.pendingProposals.includes(e.id)
              }
            />
            {/* 提案のページで受ける / 断るを選ぶ（行動の欄と同じ下書き。選べば「次の月へ」の確認は出ない。D-202） */}
            {e.phase === 'proposal' &&
              state.pendingProposals.includes(e.id) && (
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

const STATUS: Record<MonthReport['status'], { label: string; cls: string }> = {
  ok: { label: '正常', cls: 'badge-success' },
  slow: { label: '遅延', cls: 'badge-warning' },
  incident: { label: '数時間の障害', cls: 'badge-warning' },
  down: { label: '停止', cls: 'badge-error' },
};

/** 手間のポイント（加点の按分で小数になりうる）の表示。丸めは表示のときだけ。 */
const fmtPoints = (n: number) => String(Number(n.toFixed(1)));

const STAGE_CLS: Record<Stage, string> = {
  good: 'badge-success',
  fair: 'badge-warning',
  bad: 'badge-error',
};

function MonthCard({
  report: r,
  scenario: sc,
  onShowEvents,
}: {
  report: MonthReport;
  scenario: Scenario;
  /** 遊んでいる間だけ渡す。出来事は見出しの一覧に詰め、ダイアログで再表示する（D-23・D-126）。 */
  onShowEvents?: (() => void) | undefined;
}) {
  const s = r.satisfaction;
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          {r.month} か月目{' '}
          <span className="font-normal opacity-70">{r.stackName}</span>
          <span className={`badge ${STATUS[r.status].cls}`}>
            {STATUS[r.status].label}
          </span>
        </h2>
        {r.componentSummary && (
          <div className="text-xs opacity-70">部品 {r.componentSummary}</div>
        )}
        {r.contractRevenue > 0 && (
          <div className="text-xs opacity-70">
            契約の収益 {usd(r.contractRevenue)}（収益に含む）
          </div>
        )}
        {onShowEvents
          ? r.events.length > 0 && (
              <div className="rounded-box border border-base-300 p-3">
                <ul className="space-y-1">
                  {r.events.map((e) => (
                    <li
                      key={`${e.id}:${e.phase}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className={`badge badge-sm ${eventBadge(e).cls}`}>
                        {eventBadge(e).label}
                      </span>
                      <BlockedBadge event={e} />
                      {e.tier === 'rare' && (
                        <span className="badge badge-sm badge-outline badge-error">
                          {TIER_LABEL[e.tier]}
                        </span>
                      )}
                      <span>{e.title}</span>
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-sm btn-outline mt-2"
                  onClick={onShowEvents}
                >
                  出来事を 1 件ずつ見る（{r.events.length} 件）
                </button>
              </div>
            )
          : r.events.map((e) => (
              <EventCard
                key={`${e.id}:${e.phase}`}
                event={e}
                premises={r.premises}
              />
            ))}
        {r.notes.map((n) => (
          <div
            key={n}
            className={`alert ${r.policyWarning && n.includes('規約') ? 'alert-error' : 'alert-warning'} py-2`}
          >
            {n}
          </div>
        ))}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-bold">
              満足度 {s.score.toFixed(2)}
              <span className="ml-2 text-sm font-normal opacity-70">
                評判（前月との平均）{s.reputation.toFixed(2)}
              </span>
            </h3>
            {/* 狭い画面は要素を横に並べて折り返す（D-189）。sm 以上は 1 要素 1 行のまま */}
            <ul
              className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:block sm:space-y-1"
              data-satisfaction-elements
            >
              {ELEMENTS.map((e) => (
                <li
                  key={e}
                  className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-2"
                  data-satisfaction-element={e}
                >
                  <span className="whitespace-nowrap sm:w-14">
                    {ELEMENT_LABEL[e]}
                  </span>
                  <span className={`badge badge-sm ${STAGE_CLS[s.stages[e]]}`}>
                    {STAGE_LABEL[s.stages[e]]}
                  </span>
                  {s.reasons[e] && (
                    <span className="text-xs opacity-70">{s.reasons[e]}</span>
                  )}
                </li>
              ))}
            </ul>
            {r.botPV > 0 && (
              <div className="mt-2 text-sm opacity-80">
                PV {compact(Math.round(r.pv))} のうち Bot{' '}
                {compact(Math.round(r.botPV))}（収益にならない）
              </div>
            )}
            <div className="mt-2 text-sm opacity-80">
              {r.buzz
                ? `話題の後に残る伸び ${pct(s.growth)}`
                : `口コミ ${pct(s.acquisition)}・解約 ${pct(-s.churn)} → 来月の伸び ${pct(s.growth)}`}
            </div>
          </div>
          <EffortBreakdownView report={r} scenario={sc} />
        </div>
        {r.premises.length > 0 && (
          <div>
            <h3 className="mb-1 font-bold">プラットフォームの上限・制限</h3>
            <ul className="space-y-1">
              {/* 規約違反の行を一番上に（ほかは estimator の並び順のまま） */}
              {[
                ...r.premises.filter(isPolicyViolation),
                ...r.premises.filter((p) => !isPolicyViolation(p)),
              ].map((p) => (
                <PremiseRow key={p.id} p={p} />
              ))}
            </ul>
          </div>
        )}
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title text-sm">
            料金の明細
            {r.parallelInfraCost > 0
              ? `（乗り換え先の ${usd(r.parallelInfraCost)} を含む）`
              : ''}
            {r.unpricedLines
              ? `（料金未取得 ${r.unpricedLines} 件。費用は下限）`
              : ''}
          </summary>
          <div className="collapse-content">
            <table className="table table-sm">
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.label}</td>
                    <td className="text-right font-mono">
                      {l.currency === 'JPY'
                        ? `${roundInt(l.amount).toLocaleString()} 円`
                        : usd(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * 機能開発の累計と期待、「機能」の段階（D-122）。良いのときも出す。余った手間が何に効くかは ⓘ に畳む（狭い画面で溢れない）。
 */
function FeatureProgressLine({
  scenario: sc,
  total,
  month,
  prefix = '',
  actual,
  note,
}: {
  scenario: Scenario;
  total: number;
  month: number;
  /** 「来月の」など。 */
  prefix?: string;
  /** 実際の「機能」の段階（月の報告。メールが届かない分の下げを含む）。 */
  actual?: Stage;
  /** 段階に添える断り（来月の見込み）。 */
  note?: string;
}) {
  const p = featureProgressOf(sc, total, month);
  const shown = featureStageView(p.stage, actual, note);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>
        {prefix}機能開発の累計 {Math.round(p.total)} / 期待 {p.expected} →
        「機能」は
      </span>
      <span className={`badge badge-sm ${STAGE_CLS[shown.stage]}`}>
        {STAGE_LABEL[shown.stage]}
      </span>
      {shown.note && <span className="text-xs opacity-70">{shown.note}</span>}
      <Info label="余った手間の効き目">{featureRuleText(sc)}</Info>
    </span>
  );
}

function EffortBreakdownView({
  report: r,
  scenario: sc,
}: {
  report: MonthReport;
  scenario: Scenario;
}) {
  const e = r.effort;
  const parts = [
    { label: '自前運用の維持', value: e.upkeep, cls: 'bg-warning' },
    // 主のアカウント以外の事業者のアカウントの維持（D-52・D-123）。無ければ出さない
    ...(e.accounts
      ? [{ label: '他の事業者の管理', value: e.accounts, cls: 'bg-warning/50' }]
      : []),
    { label: '出来事への対応', value: e.interrupt, cls: 'bg-error' },
    {
      label: '乗り換え・作り直し・DB や API の移し替え',
      value: e.migration,
      cls: 'bg-secondary',
    },
    { label: '行動（設定・最適化・部品）', value: e.actions, cls: 'bg-info' },
    // 機能追加の提案への対応は機能開発に数える（D-29）。棒は手間の総量の内訳なので、加点は棒に入れず下に添える
    {
      label: '機能の追加（提案）',
      value: e.featureWork,
      cls: 'bg-accent',
    },
    {
      label: '機能開発（残り）',
      value: e.feature - e.featureWork - e.featureBonus,
      cls: 'bg-success',
    },
  ];
  return (
    <div>
      <h3 className="mb-1 font-bold">
        開発の手間 {fmtPoints(e.total)} ポイント
        {/* 既定の構成の事業者の管理の分を足した月は内訳を添える（D-123） */}
        {e.accountAllowance ? (
          <span className="ml-1 text-sm font-normal opacity-70">
            {effortTotalNote(e.total, e.accountAllowance)}
          </span>
        ) : null}
        <span className="ml-2 text-sm font-normal opacity-70">
          機能開発 {Math.round(e.feature)}
          {e.featureBonus > 0 &&
            `（うち提案の加点 +${Number(e.featureBonus.toFixed(1))}）`}
          ・累計 {Math.round(r.featurePoints)}
        </span>
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-base-200">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              className={`${p.cls} motion-width`}
              style={{ width: `${(p.value / e.total) * 100}%` }}
              title={`${p.label} ${p.value}`}
            />
          ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${p.cls}`} />
            {p.label}
            <span className="ml-auto tabular-nums">{fmtPoints(p.value)}</span>
          </li>
        ))}
      </ul>
      {r.componentSwap && (
        <div className="mt-2 text-sm">
          {r.componentSwap.label}差し替え中（データの移行）:{' '}
          {r.componentSwap.done} / {r.componentSwap.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.componentSwap.done}
            max={r.componentSwap.required}
          />
        </div>
      )}
      {r.migration && (
        <div className="mt-2 text-sm">
          {r.migration.toName} へ乗り換え中: {r.migration.done} /{' '}
          {r.migration.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.migration.done}
            max={r.migration.required}
          />
        </div>
      )}
      {r.rewrite && (
        <div className="mt-2 text-sm">
          {r.rewrite.toLabel} へ作り直し中（今月は旧アプリのまま）:{' '}
          {r.rewrite.done} / {r.rewrite.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.rewrite.done}
            max={r.rewrite.required}
          />
        </div>
      )}
      <div className="mt-2 text-sm">
        <FeatureProgressLine
          scenario={sc}
          total={r.featurePoints}
          month={r.month}
          actual={r.satisfaction.stages.feature}
        />
      </div>
      <div className="mt-2">
        <FeatureRing
          scenario={sc}
          month={r.month}
          total={r.featurePoints}
          effort={r.effort}
          actual={r.satisfaction.stages.feature}
        />
      </div>
      <div className="mt-1 text-xs opacity-70">
        サーバーで描く CPU 時間（SSR） {r.ssrCpuMs} ms（機能開発で重くなる）
      </div>
    </div>
  );
}

/** 提案の印（D-28）。出来事の一覧・ダイアログと、行動の欄の提案の選択肢で共有する（D-126）。 */

/**
 * 出来事の印（D-28）。予告・予告なしで今月発生・予告どおり起きた・提案を、印・色・文言の 3 つで区別する（色だけにしない）。
 */
function eventBadge(e: MonthEvent): {
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
const BLOCKED_LABEL = '🛡 対策済み';
function BlockedBadge({ event: e }: { event: MonthEvent }) {
  if (!e.botBlocked) return null;
  return <span className="badge badge-sm badge-success">{BLOCKED_LABEL}</span>;
}

const TIER_LABEL: Record<MonthEvent['tier'], string> = {
  common: 'ふだん',
  occasional: 'ときどき',
  rare: 'まれ',
};

/** 当たった前提の印の色のクラス（D-188。daisyUI のクラスは文字列のまま書く）。 */
const HIT_BADGE = { error: 'badge-error', warning: 'badge-warning' } as const;

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
          {choosing ? '' : '。月の終わりの行動で受けるか断るかを選びます'}（
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

/** 見込みが外れた理由の文（prd/07 §10.7）。 */
function surpriseReason(x: Surprise): string {
  switch (x.cause.kind) {
    case 'event':
      return `理由: 出来事「${x.cause.title}」。これが無ければ今月は ${(x.cause.ratioWithout * 100).toFixed(0)}% で、超えませんでした`;
    case 'action':
      return `理由: 前の月の選択（${x.cause.action}）`;
    case 'growth':
      return '理由: 伸びが直近の推移より速かったため';
  }
}

function PremiseRow({ p }: { p: PlatformPremise }) {
  // 規約違反（Vercel Hobby の非商用など）は原因のプランの名前を目立たせる（どの選択が原因か分かるように）
  if (isPolicyViolation(p)) {
    const plan = premisePlanLabel(p);
    return (
      <li
        className="flex flex-wrap items-center gap-2 rounded-box border border-error bg-error/10 px-2 py-1"
        data-policy-violation
      >
        <span className="badge badge-sm badge-error">規約違反</span>
        {plan && (
          <span className="font-bold text-error-strong" data-policy-cause>
            原因: {plan}
          </span>
        )}
        <span>{p.text}</span>
      </li>
    );
  }
  // 止まる・プランの変更が要るは赤、遅くなる・課金・調整は黄（D-188）
  const blocked = isStopping(p);
  // 込みのクレジットの消費は異常ではない（超えた分は従量で請求）。超過の印にせず消費として見せる
  const credit = isCreditUse(p);
  const badge =
    p.kind === 'fact'
      ? p.hit
        ? 'badge-error'
        : 'badge-ghost'
      : blocked
        ? 'badge-error'
        : credit
          ? 'badge-info'
          : p.hit
            ? 'badge-warning'
            : 'badge-info';
  const label =
    p.kind === 'fact'
      ? p.hit
        ? '違反'
        : '事実'
      : credit
        ? '付属クレジットの消費'
        : p.hit
          ? hitLabel(p.effect)
          : 'あと少し';
  const ratio = p.ratio === undefined ? null : Math.min(p.ratio, 1);
  return (
    <li className="flex flex-wrap items-center gap-2">
      {/* バッジ・使用率のグラフ・説明の順（バッジとグラフは横幅を取らないので同じ高さに並べる。2026-11-10・ユーザーの要望） */}
      <span className={`badge badge-sm ${badge}`}>{label}</span>
      {ratio !== null && (
        <span className="flex items-center gap-1 text-xs opacity-70">
          {credit ? (
            <CreditBar
              ratio={p.ratio!}
              label={`${p.text} ${(p.ratio! * 100).toFixed(0)}%`}
              className="w-20"
            />
          ) : (
            <progress
              className={`progress w-20 ${blocked ? 'progress-error' : p.hit ? 'progress-warning' : 'progress-info'}`}
              value={ratio}
              max={1}
            />
          )}
          {(p.ratio! * 100).toFixed(0)}%
        </span>
      )}
      <span>{credit ? creditUseText(p, usd) : p.text}</span>
      {p.detail && (
        <span className="basis-full text-xs opacity-80">{p.detail}</span>
      )}
      {/* 判定に置いた仮定（話題・Bot の日の集中など。D-60）は ⓘ に畳む */}
      {p.assumption && (
        <Info label="この判定の仮定">{`仮定: ${p.assumption}`}</Info>
      )}
    </li>
  );
}

/** 今月の行動。設定はいつでも戻せる。手間のポイントの残りの範囲で、いくつでも選べる。 */
function Actions({
  state,
  draft: d,
  onDecide,
}: {
  state: GameState;
  /** 今月の行動の下書き（出来事のダイアログの提案のページと共有する。D-202）。 */
  draft: MonthDraft;
  onDecide: (a: Action[]) => void;
}) {
  const {
    settings,
    setSettings,
    optimize,
    setOptimize,
    change,
    setChange,
    blockBots,
    setBlockBots,
    storage,
    setStorage,
    commits,
    setCommits,
    resets,
    reset,
    build,
    blocked,
    valid,
    actions,
    draft,
    left,
    undecided,
  } = d;
  /** 未決の提案があるときに「次の月へ」で出す確認（D-140）。 */
  const [confirmDecline, setConfirmDecline] = useState(false);
  const proceed = () => {
    onDecide(actions);
    reset();
  };
  // 来月の機能開発の見込み（選んだ行動・提案への返事を当てた配分。D-122）
  const outlook = featureOutlook(state, actions);
  // 今月の「機能」がメールが届かない分で下がっていれば、来月の見込みの段階は機能開発の比だけで見たものと断る（OCL-7D797D79）
  const lastReport = state.history[state.history.length - 1];
  const stageNote =
    lastReport &&
    lastReport.satisfaction.stages.feature !==
      featureProgressOf(
        scenarioOf(state),
        lastReport.featurePoints,
        lastReport.month,
      ).stage
      ? '（機能開発の分だけで見た段階。メールが届かないと下がります）'
      : '';
  const sc = scenarioOf(state);
  // このシナリオで効かない行動は出さない（D-33・prd/09 E-6）
  const hidden = scenarioOf(state).hidden;
  // シナリオで効かない設定と、SPA の ISR の間隔は出さない（OCL-8DFFDBEC）
  const hiddenKeys = hiddenSettings(state);
  const settingKeys = (Object.keys(SETTINGS) as SettingKey[]).filter(
    (k) => !hiddenKeys.includes(k),
  );
  // オンデマンドにしたときの CloudFront の無効化の見込み（今月の規模・OpenNext。D-66）。
  // 選んでいる行動を当てた draft から毎回引く（部品・提案への返事など、見積が読む行動の値をすべて反映する。OCL-7EDA42D6・OCL-8B602E76）
  const invalidationEst = settingKeys.includes('isr')
    ? onDemandInvalidationEstimate(draft)
    : undefined;
  const invalidation = invalidationEst && invalidationNote(invalidationEst);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          今月の行動（来月に効く）
          <span className="badge badge-lg">
            {/* 分母も選んでいる行動を当てた draft から（プラン変更で既定の分が替わる。D-123・OCL-ADB0B195） */}
            来月の手間の残り {fmtPoints(left)} / {fmtPoints(d.total)}
          </span>
        </h2>
        <p className="text-sm opacity-70">
          残りは機能開発に回り、満足度の「機能」（累計 / 期待）と、評判を通して
          PV の伸びに効きます。設定はいつでも戻せます。
        </p>
        <div className="space-y-0.5 text-sm" data-testid="feature-outlook">
          <div>
            来月の機能開発 {fmtPoints(outlook.feature)}
            {!isZeroText(fmtPoints(Math.abs(outlook.change))) &&
              `（行動で ${signedText(outlook.change, fmtPoints)}）`}
          </div>
          <FeatureProgressLine
            scenario={sc}
            total={outlook.total}
            month={outlook.month}
            prefix="来月の"
            note={stageNote}
          />
          <div className="text-xs opacity-70">
            {outlook.total >= outlook.expected
              ? '来月の累計は期待に届きます'
              : `来月の累計は期待にあと ${fmtPoints(outlook.expected - outlook.total)} 届きません`}
            （来月に新しく起きる出来事の対応の手間は含めません）
          </div>
          <div className="mt-2">
            <FeatureRing
              scenario={sc}
              month={outlook.month}
              total={outlook.total}
              effort={outlook.effort}
              feature={outlook.feature}
              change={outlook.change}
              next
              note={stageNote}
            />
          </div>
        </div>
        {state.pendingProposals.length > 0 && (
          <div className="space-y-2">
            <div className="divider my-1 text-xs">
              届いた提案（選ばなければ断る）
            </div>
            {state.pendingProposals.map((id) => (
              <ProposalChoice
                key={id}
                state={state}
                id={id}
                draft={d}
                where="actions"
              />
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {settingKeys.map((key) => {
            const def = SETTINGS[key];
            const current = state.settings[def.field];
            // 欄を無効にして固定しているなら、選んだ値でなく固定の値を見せる（数えるのもその値。D-58 の補足）
            const fixed = fixedSettingValue(draft, key);
            const chosen = settings[key] ?? fixed ?? current;
            return (
              // 外側を label にしない: label の中で最初の操作できる要素は ⓘ のボタンなので、欄のどこを押しても説明が開く。
              // ⓘ を含む見出しは label にできない（他の操作できる要素を含めない）ので、名前は select の aria-label で付ける
              <div key={key} className="form-control">
                <span className="label-text mb-1 block">
                  <span className="block font-semibold">
                    <NameWithInfo
                      name={def.label}
                      info={<Info title={def.label}>{def.note}</Info>}
                    />
                  </span>
                  <Meta
                    items={[
                      // 時間 → オンデマンドだけ実装の手間がかかる（D-49）
                      key === 'isr' ||
                      key === 'buildInterval' ||
                      key === 'pageCache'
                        ? `手間 ${def.effort}（${key === 'buildInterval' ? '更新のたびにビルド' : key === 'pageCache' ? ASTRO_ON_DEMAND : NEXT_ON_DEMAND}へは ${EFFORT.onDemandSwitch}）`
                        : `手間 ${def.effort}`,
                      '来月から',
                    ]}
                  />
                  {settingInactiveReason(draft, key) && (
                    <span className="block text-xs opacity-70">
                      今は効かない: {settingInactiveReason(draft, key)}
                    </span>
                  )}
                  {settingNote(draft, key) && (
                    <span className="block text-xs opacity-70">
                      {settingNote(draft, key)}
                    </span>
                  )}
                </span>
                <select
                  aria-label={def.label}
                  className="select select-bordered select-sm w-full"
                  disabled={
                    settingInactiveReason(draft, key) !== undefined &&
                    settings[key] === undefined
                  }
                  value={chosen}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const next = { ...settings };
                    if (v === current) delete next[key];
                    else next[key] = v;
                    setSettings(next);
                  }}
                >
                  {def.options.map((o) => {
                    const trial = { ...settings, [key]: o.value };
                    if (o.value === current) delete trial[key];
                    const why =
                      o.value === current
                        ? null
                        : blocked(build({ settings: trial }));
                    return (
                      <option
                        key={o.value}
                        value={o.value}
                        disabled={why !== null}
                      >
                        {o.label}
                        {fixed !== undefined
                          ? o.value === fixed
                            ? '（固定）'
                            : ''
                          : o.value === current
                            ? '（今）'
                            : ''}
                        {why ? `（${why}）` : ''}
                      </option>
                    );
                  })}
                </select>
                {settingFlavor(key, chosen) && (
                  <span className="mt-1 block text-xs opacity-70">
                    {settingFlavor(key, chosen)}
                  </span>
                )}
                {key === 'isr' && invalidation && (
                  <span className="mt-1 block text-xs text-warning">
                    「{NEXT_ON_DEMAND}」では {invalidation}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <label className="flex cursor-pointer items-start gap-3 py-1">
          <input
            type="checkbox"
            className="checkbox checkbox-sm mt-1"
            checked={optimize}
            disabled={!optimize && !valid(build({ optimize: true }))}
            onChange={(e) => setOptimize(e.target.checked)}
          />
          <OptionText
            name="SSR を最適化する"
            meta={[
              `CPU ${nextSsrCpuMs(state)} → ${Math.max(EFFORT.minSsrCpuMs, nextSsrCpuMs(state) - EFFORT.optimizeStepMs)} ms`,
              `手間 ${EFFORT.optimize}`,
              '来月から',
            ]}
            info={
              <Info title="SSR を最適化する">
                CPU 時間と速さに効きます。機能開発が進むと SSR
                はまた重くなるので、繰り返し判断が要ります。
              </Info>
            }
            why={optimize ? null : blocked(build({ optimize: true }))}
          />
        </label>
        {!state.botBlocked && !hidden?.blockBots && (
          <label className="flex cursor-pointer items-start gap-3 py-1">
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-1"
              checked={blockBots}
              disabled={
                !blockBots &&
                (actionEffort(state, { type: 'block-bots' }) === null ||
                  !valid(build({ blockBots: true })))
              }
              onChange={(e) => setBlockBots(e.target.checked)}
            />
            <OptionText
              name="Bot を遮断するルールを入れる"
              meta={[`手間 ${BOT_BLOCK.effort}`, '来月から効く']}
              info={
                <Info title="Bot を遮断するルールを入れる">
                  Bot・クローラーのアクセスが来月から半分になります。一度入れれば続きます。対策の製品（WAF
                  など）の料金は取得していないので、手間だけの行動です。
                </Info>
              }
              why={blockBots ? null : blocked(build({ blockBots: true }))}
            />
          </label>
        )}
        {(() => {
          const t = storageOptionText(state.stackIndex);
          if (!t || state.storageOption) return null;
          const why = storage ? null : blocked(build({ storage: true }));
          return (
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-1"
                checked={storage}
                disabled={!storage && why !== null}
                onChange={(e) => setStorage(e.target.checked)}
              />
              <OptionText
                name={t.name}
                meta={t.meta}
                info={<Info title={t.name}>{t.detail}</Info>}
                why={why}
              />
            </label>
          );
        })()}
        <CommitmentsSection
          state={state}
          value={commits}
          onChange={setCommits}
          blocked={(c) => blocked(build({ commits: c }))}
        />
        {/* 構成を変える（D-185）: ①② のタブで今の状態から選び直し、差を行動に写し取る。毎月は変えない選択なので畳んで出し、
            見出しに登録した行動の要約を出す。乗り換えの最中も出し、描き方とコメント欄だけ選び直せる（見出しに進み具合。OCL-0B7CAFEB）。
            key を月ごとに替えて毎月畳んだ状態から */}
        <SetupChangeField
          key={`change-${state.history.length}-${resets}`}
          state={state}
          registered={change}
          onRegister={setChange}
          wrap={(g) => build({ change: g })}
        />
        <div className="card-actions items-center justify-end">
          {actions.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              選択を戻す
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!valid(actions)}
            onClick={() => {
              if (undecided.length > 0) setConfirmDecline(true);
              else proceed();
            }}
          >
            次の月へ
          </button>
        </div>
      </div>
      {confirmDecline && (
        <DeclineConfirmDialog
          titles={undecided.map(
            (id) => eventDef(scenarioOf(state), id)?.title ?? id,
          )}
          onDecline={() => {
            setConfirmDecline(false);
            proceed();
          }}
          onBack={() => {
            setConfirmDecline(false);
            // 選び残した最初の提案の行へ移る（受ける・断るを選べるように）
            const row = document.querySelector<HTMLElement>(
              `[data-proposal-choice="${CSS.escape(undecided[0]!)}"]`,
            );
            row?.scrollIntoView?.({ block: 'center' });
            row
              ?.querySelector<HTMLInputElement>('input:not(:disabled)')
              ?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * 未決の提案があるまま「次の月へ」を押したときの確認（D-140）。進むと断ったことになる（受けると付く効果は無く、
 * 断ると起きること（画質が下がるなど）が起きる）。「提案を選ぶ」で行動の欄の提案の行へ戻る。
 */
function DeclineConfirmDialog({
  titles,
  onDecline,
  onBack,
}: {
  /** 未決の提案の題。 */
  titles: string[];
  onDecline: () => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // 「断って進む」で閉じたときに onBack を呼ばない
  const declined = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="decline-dialog-title"
      data-decline-confirm
      onClose={() => {
        if (!declined.current) onBack();
      }}
    >
      <div className="modal-box max-w-md">
        <h2 id="decline-dialog-title" className="text-lg font-bold">
          未決の提案が {titles.length} 件あります
        </h2>
        <p className="mt-2 text-sm">
          このまま進むと、次の提案は断ったことになります。
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {titles.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className={`badge badge-sm ${PROPOSAL_BADGE.cls}`}>
                {PROPOSAL_BADGE.label}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-primary btn-sm" autoFocus>
              提案を選ぶ
            </button>
          </form>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              declined.current = true;
              ref.current?.close();
              onDecline();
            }}
          >
            断って進む
          </button>
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

/** 花火のアイコン（中心から放射する線と点。currentColor で描く）。 */
function FireworkIcon() {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      {rays.map((a) => (
        <line
          key={a}
          x1={12 + Math.cos(a) * 3.5}
          y1={12 + Math.sin(a) * 3.5}
          x2={12 + Math.cos(a) * 8}
          y2={12 + Math.sin(a) * 8}
        />
      ))}
      {rays.map((a) => (
        <circle
          key={`d${a}`}
          cx={12 + Math.cos(a + Math.PI / 8) * 10.5}
          cy={12 + Math.sin(a + Math.PI / 8) * 10.5}
          r="0.9"
          fill="currentColor"
          stroke="none"
        />
      ))}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 結果（prd/07 §9.6・prd/15 §3）: 終わり方・4 軸と手元の履歴との比較（完走のとき）・基準プレイとの比較・振り返り。 */
function Result({
  state,
  comparisons,
  stats,
  statsQuery,
  onCelebrate,
}: {
  state: GameState;
  comparisons: readonly AxisComparison[];
  stats: StatsView;
  /** 絞り込みのチップと比較の図の元（D-175）。 */
  statsQuery: StatsQuery | null;
  /** 完走のダイアログを開き直す（完走のときだけ使う）。 */
  onCelebrate: () => void;
}) {
  const completed = state.phase === 'completed';
  const end = state.end!;
  // 行の名前（基準プレイは短い名前）は game の comparisonRows で決める（単体テストあり）
  const table = comparisonRows(state);
  /** 短い名前と説明が違う基準プレイだけを注記に出す。 */
  const abbreviated = offeredBaselines(scenarioOf(state)).filter(
    (b) => b.short && b.short !== b.label,
  );
  const reflection = reflectionOf(state);
  // 次のプレイへのヒント（途中終了のとき。完走のときは伸ばせる所として出す。D-40・D-143）
  const hints = retryHintsOf(state);
  // 規約違反で終わったときの原因のプラン（それ以外は null）
  const policy = policyCauseOf(state);
  const rows: { label: string; get: (a: Axes) => string }[] = [
    { label: '累積の利益', get: (a) => usd(a.profit) },
    { label: '満足度の平均', get: (a) => a.satisfaction.toFixed(2) },
    {
      label: '最終的な規模（月 PV）',
      get: (a) => compact(Math.round(a.finalPV)),
    },
    {
      label: '機能開発に回せた手間',
      get: (a) => `${a.featurePoints}（${(a.featureShare * 100).toFixed(0)}%）`,
    },
  ];
  const e = reflection.effort;
  return (
    // 完走は花火、途中終了は控えめにフェードインだけ（D-25。動きを減らす設定では出さない）
    <div className="card motion-fade-in bg-base-100 shadow">
      <div className="card-body gap-4">
        {/* 完走の帯は始める画面の紹介の箱（D-133）と同じ形: success の枠と印だけで、全面は塗りつぶさない（D-170）。途中終了は今の塗りのまま */}
        <div
          className={`alert ${completed ? 'border-2 border-success bg-base-100 text-base-content' : 'alert-error'}`}
          data-result-band={completed ? 'completed' : 'lost'}
        >
          {/* 中身を 1 つのブロックにする（alert の grid で横に割られて途中で折り返さないように） */}
          <div className="min-w-0">
            <div className="text-lg font-bold">
              {completed && (
                <span className="text-success" aria-hidden>
                  ✓{' '}
                </span>
              )}
              {END_LABEL[end.reason]}
            </div>
            <div>
              <span className="whitespace-nowrap">
                {end.month} か月目で終了
              </span>
              ・
              <span className="whitespace-nowrap">
                所持金 {usd(state.cash)}
              </span>
              ・
              <span className="whitespace-nowrap">
                止まった月 {state.outages} 回
              </span>
            </div>
            {policy && (
              // 規約違反で終わったとき: 原因のプラン・部品を強調する（どの選択が原因か分かるように）
              <div className="mt-1" data-policy-cause-result>
                原因のプラン:{' '}
                <span className="badge badge-neutral font-bold">
                  {policy.label ?? policy.text}
                </span>
                <span className="ml-1 text-sm">
                  （{policy.text}
                  {policy.warnedMonth !== null &&
                    `。${policy.warnedMonth} か月目に指摘を受けました`}
                  ）
                </span>
              </div>
            )}
          </div>
          {completed && (
            // 帯の中の花火のアイコンのボタン（SVG。端末のフォントに依存しない）。帯の文字の色で描く
            <button
              className="btn btn-circle btn-sm ml-auto border-current bg-transparent text-current shadow-none hover:bg-black/10"
              onClick={onCelebrate}
              aria-label="もう一度祝う（完走のダイアログを開く）"
              title="もう一度祝う（完走のダイアログを開く）"
            >
              <FireworkIcon />
            </button>
          )}
        </div>
        {completed && (
          // 結果の画面だけ、絞り込みのチップと構成ごとの比較の図を足す（完走のダイアログは今のまま。D-175）
          <ResultStatsSection
            comparisons={comparisons}
            stats={stats}
            outages={state.outages}
            cashGuide={scenarioOf(state).goal.cash}
            query={statsQuery}
          />
        )}
        {hints.length > 0 && (
          // 折りたたまずに出す。原因と対策の方向だけで、正解の構成名は出さない（D-40）
          <section
            className="rounded-box border-2 border-warning bg-warning/10 p-3 sm:p-4"
            aria-labelledby="retry-hints-title"
          >
            <h3 id="retry-hints-title" className="mb-2 font-bold">
              {completed ? '次のプレイで伸ばせる所' : '次のプレイへのヒント'}
            </h3>
            <ol className="space-y-3">
              {hints.map((x, i) => (
                <li key={`${x.kind}:${i}`} className="flex gap-2">
                  <span className="badge badge-warning badge-sm mt-0.5 shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm">{x.what}</p>
                    <p className="mt-1 text-sm">
                      <span className="mr-1 font-semibold whitespace-nowrap">
                        次に試せる方向:
                      </span>
                      {x.next}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title font-bold">
            基準プレイとの比較の表（軸ごとの成績・満足度の要素）
          </summary>
          <div className="collapse-content">
            <p className="mb-1 text-sm opacity-70">
              1
              つの点数にはしません。下の行は同じシードの基準プレイ（目盛り）です
            </p>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">戦略</th>
                    {rows.map((r) => (
                      <th
                        key={r.label}
                        className="whitespace-nowrap text-right"
                      >
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((p) => (
                    <tr key={p.id} className={p.you ? 'font-semibold' : ''}>
                      <td className="whitespace-nowrap" title={p.description}>
                        {p.name}
                      </td>
                      {rows.map((r) => (
                        <td
                          key={r.label}
                          className={`whitespace-nowrap text-right tabular-nums ${p.you ? '' : 'opacity-70'}`}
                        >
                          {r.get(p.axes)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 className="mt-3 mb-1 text-sm font-semibold">
              満足度の要素の平均（良い 1・普通 0.5・悪い 0）
            </h4>
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">戦略</th>
                    {ELEMENTS.map((el) => (
                      <th key={el} className="whitespace-nowrap text-right">
                        {ELEMENT_LABEL[el]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.map((p) => (
                    <tr key={p.id} className={p.you ? 'font-semibold' : ''}>
                      <td className="whitespace-nowrap" title={p.description}>
                        {p.name}
                      </td>
                      {ELEMENTS.map((el) => (
                        <td
                          key={el}
                          className={`text-right tabular-nums ${p.you ? '' : 'opacity-70'}`}
                        >
                          {p.axes.elements[el].toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {abbreviated.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs opacity-70">
                {abbreviated.map((b) => (
                  <li key={b.id}>
                    {b.short}: {b.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title font-bold">
            振り返り: 達した上限・満足度が悪かった月・手間の内訳
          </summary>
          <div className="collapse-content">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-bold">達した上限・近づいた上限</h3>
                {reflection.premises.length ? (
                  <ul className="space-y-1 text-sm">
                    {reflection.premises.map((p) => (
                      <li key={p.text}>
                        <span
                          className={`badge badge-sm mr-1 ${p.hit ? 'badge-error' : 'badge-info'}`}
                        >
                          {p.month} か月目・{p.hit ? '達した' : '近づいた'}
                        </span>
                        {p.text}
                        {p.action && (
                          <span className="block text-xs opacity-70">
                            その月の選択: {p.action}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">なし</p>
                )}
                {reflection.surprises.length > 0 && (
                  <>
                    <h3 className="mt-3 mb-1 font-bold">
                      見込みより早く超えた上限と、その理由
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {reflection.surprises.map((x) => (
                        <li key={`${x.premiseId}:${x.month}`}>
                          <span className="badge badge-sm badge-outline mr-1">
                            {x.month} か月目
                          </span>
                          {x.text}
                          <span className="block text-xs opacity-70">
                            {surpriseReason(x)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <h3 className="mb-1 font-bold">満足度が「悪い」になった月</h3>
                {reflection.badMonths.length ? (
                  <ul className="space-y-1 text-sm">
                    {reflection.badMonths.map((b, i) => (
                      <li key={i}>
                        {b.month} か月目・{b.label}
                        <span className="ml-1 text-xs opacity-70">
                          {b.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">なし</p>
                )}
                <h3 className="mt-3 mb-1 font-bold">
                  手間の使い道（合計 {fmtPoints(e.total)}
                  {effortTotalNote(e.total, e.accountAllowance)}）
                </h3>
                <ul className="text-sm">
                  {[
                    ['自前運用の維持', e.upkeep],
                    ...(e.accounts ? [['他の事業者の管理', e.accounts]] : []),
                    ['出来事への対応', e.interrupt],
                    ['乗り換え', e.migration],
                    ['行動（設定・最適化）', e.actions],
                    ['機能の追加（提案）', e.featureWork],
                    [
                      '機能開発（残り）',
                      e.feature - e.featureWork - e.featureBonus,
                    ],
                  ].map(([label, v]) => (
                    <li key={label as string} className="flex">
                      {label}
                      <span className="ml-auto tabular-nums">
                        {fmtPoints(v as number)}（
                        {e.total
                          ? (((v as number) / e.total) * 100).toFixed(0)
                          : 0}
                        %）
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function History({
  history,
  rewindable,
  onRewind,
}: {
  history: MonthReport[];
  /** 戻れる月の数（1〜rewindable か月目。D-128）。 */
  rewindable: number;
  onRewind: (month: number) => void;
}) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        {/* 月ごとの行が積み重なって長くなるので、既定で畳む（D-187）。見出しに月数を出す */}
        <details className="collapse collapse-arrow" data-history>
          <summary className="collapse-title flex flex-wrap items-baseline gap-x-2 px-0 pe-10">
            <h2 className="card-title">これまでの運営</h2>
            <span className="text-sm opacity-70" data-history-months>
              （{history.length} か月）
            </span>
          </summary>
          <div className="collapse-content overflow-x-auto px-0">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>月</th>
                  <th>構成</th>
                  <th className="text-right">PV</th>
                  <th className="text-right">収益</th>
                  <th className="text-right">費用</th>
                  <th className="text-right">所持金</th>
                  <th className="text-right">満足度</th>
                  <th className="text-right">機能開発</th>
                  <th>状態</th>
                  <th>出来事</th>
                  <th>行動</th>
                  <th>
                    <span className="sr-only">戻る</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{r.stackName}</td>
                    <td className="text-right">
                      {Math.round(r.pv).toLocaleString()}
                    </td>
                    <td className="text-right">{usd(r.revenue)}</td>
                    <td className="text-right">{usd(r.infraCost)}</td>
                    <td className="text-right">{usd(r.cash)}</td>
                    <td className="text-right">
                      {r.satisfaction.score.toFixed(2)}
                    </td>
                    <td className="text-right">{r.effort.feature}</td>
                    <td>
                      <span
                        className={`badge badge-sm ${STATUS[r.status].cls}`}
                      >
                        {STATUS[r.status].label}
                      </span>
                      {r.policyWarning && (
                        <span className="badge badge-sm badge-error ml-1">
                          規約違反の指摘
                        </span>
                      )}
                    </td>
                    <td className="text-xs">
                      {r.events
                        .map(
                          (e) =>
                            `${eventBadge(e).label}${e.botBlocked ? `（${BLOCKED_LABEL}）` : ''}: ${e.title}`,
                        )
                        .join('・')}
                    </td>
                    <td className="text-xs">{r.action ?? ''}</td>
                    <td>
                      {r.month <= rewindable && (
                        <button
                          className="btn btn-ghost btn-xs whitespace-nowrap"
                          aria-label={`${r.month} か月目に戻る`}
                          onClick={() => onRewind(r.month)}
                        >
                          この月に戻る
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

/** 推移と見込み（prd/07 §5・GD-1）。毎月の画面の上に常に出し、続いている感じを見せる。 */
function Trends({
  history,
  scenario,
  ended,
  previous,
  onClearPrevious,
}: {
  history: MonthReport[];
  scenario: Scenario;
  /** 終わったら見込みを出さない（途中のゲームオーバーで残りの月を伸ばさない）。 */
  ended: boolean;
  /** 前の試行（D-128）。所持金・PV・費用・満足度の線に破線で重ねる。 */
  previous: GameState | null;
  onClearPrevious: () => void;
}) {
  const narrow = useNarrowScreen();
  const prevHistory = previous?.history;
  const prevOf = (get: (r: MonthReport) => number) =>
    prevHistory ? { previous: prevHistory.map(get) } : {};
  const last = history[history.length - 1]!;
  // 所持金の見込み（目安。直近 3 か月の月の利益の平均で線形に伸ばす。D-42）
  const cashProj = ended ? undefined : cashProjectionOf({ history, scenario });
  // 所持金の目標の目安（シナリオの goal.cash。表示だけで合否にしない。D-167）。
  // 後で集計の分布（完走した人の 12 か月目の所持金の上位 90% の線など）から出す余地を残す（prd/15 §2.1）
  const cashGuide = scenario.goal.cash;
  const prev = history[history.length - 2];
  const cost = (r: MonthReport) => r.infraCost;
  const trends = selectTrends(
    premiseTrends(
      history.map((m) => m.snapshots),
      scenario.months,
      {
        ...(projectionNote(last)
          ? { skipProjection: projectionNote(last)! }
          : {}),
        spikes: history.map(isTrafficSpike),
      },
    ),
  );
  const tiles = [
    {
      label: 'PV',
      value: last.pv,
      format: (n: number) => compact(Math.round(n)),
      series: history.map((r) => r.pv),
      delta: prev ? last.pv / prev.pv - 1 : null,
    },
    {
      label: '収益（月）',
      value: last.revenue,
      format: usd,
      series: history.map((r) => r.revenue),
      delta: prev ? last.revenue / prev.revenue - 1 : null,
    },
    {
      label: '費用（月）',
      value: cost(last),
      format: usd,
      series: history.map(cost),
      delta: prev ? cost(last) / cost(prev) - 1 : null,
    },
    {
      label: '所持金',
      value: last.cash,
      format: usd,
      series: history.map((r) => r.cash),
      delta: null,
    },
    {
      label: '機能開発（月）',
      value: last.effort.feature,
      // 提案の作業と加点を含む（D-29）。総量を超えうるので「/ 総量」でなく内訳を添える
      format: (n: number) => {
        const p = last.effort.featureWork + last.effort.featureBonus;
        return p > 0
          ? `${Math.round(n)}（うち提案 ${Math.round(p)}）`
          : `${Math.round(n)} / ${last.effort.total}`;
      },
      series: history.map((r) => r.effort.feature),
      delta: null,
    },
  ];
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-3 sm:gap-4">
        <h2 className="card-title">これまでの推移</h2>
        {/* 狭い画面は 1 行に名前・値・前月比・小さな推移を並べた細い行を積む（D-186） */}
        <div
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-3 md:grid-cols-5"
          data-trend-tiles
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-2 rounded-box bg-base-200 px-3 py-1.5 sm:block sm:p-3"
              data-trend-tile
            >
              <div className="w-20 shrink-0 text-xs opacity-70 sm:w-auto">
                {t.label}
              </div>
              <div className="min-w-0 flex-1 text-base font-semibold tabular-nums sm:text-xl">
                {/* 月が進むと前の月の値から数え上げる（D-25） */}
                <CountUp value={t.value} format={t.format} />
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:flex-wrap sm:items-end sm:justify-between sm:gap-0">
                <span className="text-xs whitespace-nowrap opacity-70">
                  {t.delta === null || !Number.isFinite(t.delta) ? (
                    ''
                  ) : (
                    <>
                      <span className="max-sm:hidden">前月比 </span>
                      {pct(t.delta)}
                    </>
                  )}
                </span>
                <Sparkline
                  values={t.series}
                  months={scenario.months}
                  {...(narrow ? { width: 64, height: 20 } : {})}
                />
              </div>
            </div>
          ))}
        </div>
        {cashProj && cashProj.projection.length > 0 && (
          <p className="text-sm" data-cash-projection>
            <span className="whitespace-nowrap">所持金はこのペースだと</span>{' '}
            <wbr />
            <span className="whitespace-nowrap">
              {`${scenario.months} か月目に約 ${usd(Math.round(cashProj.final))}`}
            </span>
            の見込みです{' '}
            <Info label="所持金の見込みの出し方">
              {cashProj.method === 'growth'
                ? `月の利益（収益 − 費用。乗り換え中の並行の費用・一度だけの手数料も含む、所持金の実際の増減）を、直近の月の利益の前月比（直近 3 つの比の中央値を 0.8〜1.2 倍に収めた値。今は ${cashProj.growth.toFixed(2)} 倍）で残りの月も伸ばして足したゲーム上の目安。来月の月の利益は約 ${usd(Math.round(cashProj.nextProfit))}。`
                : `月の利益（収益 − 費用。所持金の実際の増減）が 0 以下なので、伸びを入れず直近 3 か月の平均（約 ${usd(Math.round(cashProj.nextProfit))}）で残りの月を線形に伸ばしたゲーム上の目安。`}
              話題・前兆・Bot
              で一時的に流量が増えた月は、基準にも比にも使いません
              {cashProj.skipped > 0
                ? `（今回は ${cashProj.skipped} か月を除きました）`
                : ''}
              。予告済みの出来事・料金の改定は織り込みません
            </Info>
          </p>
        )}
        {!ended && (
          <p className="text-sm" data-cash-guide>
            {`目標の目安は ${scenario.months} か月目に所持金 ${usd(cashGuide)} です`}
            {cashProj && cashProj.projection.length > 0
              ? cashProj.final >= cashGuide
                ? `（見込みは目安を約 ${usd(Math.round(cashProj.final - cashGuide))} 上回ります）`
                : `（見込みでは目安まで約 ${usd(Math.round(cashGuide - cashProj.final))} です）`
              : ''}
            。届かなくても完走になり、合否はありません{' '}
            <Info label="目標の目安とは">
              {`シナリオが想定した ${scenario.months} か月目の所持金の目安です（ゲーム上の仮定）。下回っても途中で終わったり失敗になったりはしません。完走したら、4 つの軸で振り返ります。所持金のグラフの点線が目安の額です`}
            </Info>
          </p>
        )}
        {previous && (
          <div
            className="flex flex-wrap items-center gap-2 text-xs opacity-80"
            data-previous-trial
          >
            <span>
              {`グラフの灰色の点線は前の試行（${previous.history.length} か月目${previous.phase === 'playing' ? 'まで' : `で${previous.phase === 'completed' ? '完走' : '終了'}`}）`}
            </span>
            <button
              className="btn btn-ghost btn-xs opacity-70"
              onClick={onClearPrevious}
            >
              前の試行を消す
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
          <LineChart
            title="所持金"
            months={scenario.months}
            format={(v) => `$${compact(Math.round(v))}`}
            reference={{
              value: cashGuide,
              label: `目標の目安 $${compact(Math.round(cashGuide))}`,
              tone: 'neutral',
            }}
            series={[
              {
                id: 'cash',
                label: '所持金',
                color: 'var(--series-1)',
                // 負の値は軸の下に出ないよう 0 で切る（表示だけ。負になった月にゲームは終わる）
                values: history.map((r) => Math.max(0, r.cash)),
                ...prevOf((r) => Math.max(0, r.cash)),
                ...(cashProj && cashProj.projection.length > 1
                  ? {
                      projection: cashProj.projection.map((p) => ({
                        month: p.month,
                        value: Math.max(0, p.value),
                      })),
                    }
                  : {}),
              },
            ]}
          />
          <LineChart
            title="収益と費用（月）"
            months={scenario.months}
            format={(v) => `$${compact(Math.round(v))}`}
            series={[
              {
                id: 'revenue',
                label: '収益',
                color: 'var(--series-1)',
                values: history.map((r) => r.revenue),
              },
              {
                id: 'cost',
                label: '費用',
                color: 'var(--series-2)',
                values: history.map(cost),
                ...prevOf(cost),
              },
            ]}
          />
          <LineChart
            title="満足度と評判"
            months={scenario.months}
            format={(v) => v.toFixed(2)}
            yMax={1}
            series={[
              {
                id: 'score',
                label: '満足度',
                color: 'var(--series-1)',
                values: history.map((r) => r.satisfaction.score),
                ...prevOf((r) => r.satisfaction.score),
              },
              {
                id: 'reputation',
                label: '評判',
                color: 'var(--series-2)',
                values: history.map((r) => r.satisfaction.reputation),
              },
            ]}
          />
          <LineChart
            title="PV（月）"
            months={scenario.months}
            format={(v) => compact(Math.round(v))}
            series={[
              {
                id: 'pv',
                label: 'PV',
                color: 'var(--series-1)',
                values: history.map((r) => r.pv),
                ...prevOf((r) => r.pv),
              },
            ]}
          />
        </div>
        {trends.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              上限の使用率（境目 = 100%）
            </h3>
            <div className="grid gap-2 sm:gap-3 md:grid-cols-2">
              {trends.map((t) => (
                <TrendCard key={t.id} t={t} months={scenario.months} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendCard({
  t,
  months,
}: {
  t: ReturnType<typeof premiseTrends>[number];
  months: number;
}) {
  // 効き方で色を分ける（D-188。月の報告の上限の一覧・出来事と同じ）
  const blocked = t.hitNow && hitTone(t.effect) === 'error';
  const status = blocked
    ? { cls: HIT_BADGE.error, label: `✗ ${hitLabel(t.effect)}` }
    : t.hitNow
      ? { cls: HIT_BADGE.warning, label: `● ${hitLabel(t.effect)}` }
      : t.monthsUntil !== null
        ? {
            cls: 'badge-warning',
            label: `▲ ${t.monthsUntil} か月後に超える見込み`,
          }
        : t.latest >= 0.5
          ? { cls: 'badge-info', label: '◐ あと少し' }
          : { cls: 'badge-ghost', label: '○ まだ遠い' };
  const peak = Math.max(
    ...t.ratios.map((r) => r ?? 0),
    ...t.projection.map((p) => p.ratio),
  );
  return (
    <div className="rounded-box border border-base-300 p-2 sm:p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${status.cls}`}>{status.label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {(t.latest * 100).toFixed(0)}%
        </span>
        {t.earlierThanProjected && (
          <span className="badge badge-sm badge-outline">
            見込みより早く超えた
          </span>
        )}
      </div>
      <div className="mb-1 text-sm">{t.text}</div>
      {t.projectionNote && (
        <div className="mb-1 text-xs opacity-70">{t.projectionNote}</div>
      )}
      {!t.projectionNote && !t.hitNow && t.excluded.length > 0 && (
        <div className="mb-1 text-xs opacity-70">
          {`${t.excluded.map((i) => i + 1).join('・')} か月目は一時的に流量が増えた月なので、見込みの計算から除きました`}
        </div>
      )}
      {t.breaks.length > 0 && (
        <div className="mb-1 text-xs opacity-70">
          {`${t.breaks.map((i) => i + 1).join('・')} か月目に効く部品を替えたので、線（縦の破線）と見込みはそこで区切りました`}
        </div>
      )}
      <LineChart
        months={months}
        height={120}
        format={(v) => `${Math.round(v * 100)}%`}
        yMax={Math.min(Math.max(1.2, peak), 3)}
        reference={{ value: 1, label: '境目' }}
        series={[
          {
            id: t.id,
            label: '使用率',
            color: 'var(--series-1)',
            values: t.ratios,
            breaks: t.breaks,
            projection: t.projection.map((p) => ({
              month: p.month,
              value: p.ratio,
            })),
          },
        ]}
      />
      {Math.max(...t.ratios.map((r) => r ?? 0)) > 3 && (
        <div className="text-xs opacity-70">
          300% を超えた部分はグラフの上端で切っています（値は上の %）
        </div>
      )}
    </div>
  );
}
