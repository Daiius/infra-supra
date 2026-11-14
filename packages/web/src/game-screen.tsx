// ゲームモードの運営中の画面（月の報告・行動・推移・結果）。App から分けて読む（始める画面の初回の読み込みに含めない）。
import { useEffect, useState } from 'react';
import { resultAxesOf, scenarioOf, type Action, type GameState } from 'game';
import type { StatsQuery } from './stats-client.ts';
import type { StatsView } from './distribution.ts';
import { compareWithHistory, type ResultEntry } from './results-history.ts';
import { useMonthDraft } from './month-draft.ts';
import {
  EventsDialog,
  eventsSeen,
  markEventsSeen,
} from './game-screen/events.tsx';
import { MonthCard } from './game-screen/month-card.tsx';
import { Actions } from './game-screen/actions.tsx';
import { VictoryCelebration, Result } from './game-screen/result.tsx';
import { Trends, History } from './game-screen/trends.tsx';

export { EventCard } from './game-screen/events.tsx';

const scrollTop = () => window.scrollTo({ top: 0 });

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
