// ゲームモードの画面（Phase 2〜4 の前倒しの試作）。ロジックは game パッケージ、ここは表示と操作だけ。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actionEffort,
  applyAction,
  applyActions,
  ARTICLE_COMMUNITY,
  axesOf,
  BOT_BLOCK,
  comparisonRows,
  componentEffortLabel,
  componentPreview,
  componentSlots,
  EFFORT,
  effortAvailable,
  ELEMENT_LABEL,
  ELEMENTS,
  END_LABEL,
  eventDef,
  goalChecks,
  growthFromReputation,
  isPlanChange,
  migrationEffort,
  newGame,
  nextSsrCpuMs,
  playMonth,
  premiseTrends,
  projectionNote,
  reflectionOf,
  scenarioOf,
  selectTrends,
  SETTINGS,
  STACKS,
  STAGE_LABEL,
  unavailableReason,
  type Action,
  type Axes,
  type GameState,
  type MonthEvent,
  type MonthReport,
  type Surprise,
  type SettingKey,
  type Stage,
} from 'game';
import type { PlatformPremise } from 'estimator';
import { compact, LineChart, Meter, Sparkline } from './charts.tsx';

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(0)}%`;
const scrollTop = () => window.scrollTo({ top: 0 });
/** 今日の日付（YYYY-MM-DD・端末の現地時刻）。改定の出来事の条件に使う（D-21）。 */
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** 始めるシナリオ（今は記事コミュニティだけ。GD-5 で 2 本目）。 */
const SCENARIO = ARTICLE_COMMUNITY;
/** 画面に出す為替の仮定（game の共通の仮定）。 */
const USD_JPY = 150;
type SlotId = Extract<Action, { type: 'component' }>['slot'];

export function App() {
  const [state, setState] = useState<GameState | null>(null);
  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-sm">
        <span className="px-4 text-lg font-bold">infra-supra（仮称）</span>
        <span className="text-sm opacity-60">
          Web アプリのインフラ運営シミュレーション（試作）
        </span>
        {state && (
          <button
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => setState(null)}
          >
            最初から
          </button>
        )}
      </div>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {state ? (
          <Game state={state} setState={setState} />
        ) : (
          <Briefing onStart={setState} />
        )}
      </main>
    </div>
  );
}

function Briefing({ onStart }: { onStart: (s: GameState) => void }) {
  const [stack, setStack] = useState(1);
  const [seed, setSeed] = useState(42);
  const [startDate, setStartDate] = useState(today);
  return (
    <>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">
            シナリオ: {SCENARIO.name}を {SCENARIO.months} か月運営する
          </h2>
          <p>
            Next.js（App Router）で作った記事 +
            コメントのサイト。広告収入で運営する（商用）。今は月{' '}
            {SCENARIO.scale.startPV.toLocaleString()}{' '}
            PV。利用者の満足度が高ければ口コミで伸び （満足度 0.9 で毎月約{' '}
            {(
              growthFromReputation(0.9, false, SCENARIO.growth).net * 100
            ).toFixed(0)}
            %）、 低ければ解約が増える。
          </p>
          <p>
            運営中に出来事が起きる: SNS で話題になる（前の月に前兆が出る）・Bot
            が大量に来る・チームが増える・機能追加の提案が来る（受けるか断るかを選ぶ）・投稿や画像がたまって前提の境目に近づく。
            まれに、構成の乗り換えを迫るほどの大きな出来事が来る（1
            か月前に予告が出る）。時期は乱数のシードで変わる。始めた日より後に施行される、実際に予告されている料金・制限の改定があれば、それも出来事として出る（改定後の料金を取得していないものは、計算に反映しない）。
          </p>
          <p>
            満足度は可用性・速さ・機能・鮮度・画質の 5
            つの要素で決まる。開発の手間は毎月 {SCENARIO.effort.perMonth}{' '}
            ポイントで、設定の変更・最適化・乗り換え・出来事への対応・自前運用の維持（
            {SCENARIO.effort.selfHostedUpkeep} /
            月）に使った残りが機能開発に回る。
          </p>
          <p>所持金 {usd(SCENARIO.startCash)}。</p>
          <div className="alert alert-info flex-col items-start gap-1">
            <span>
              目標: {SCENARIO.months} か月後に所持金 {usd(SCENARIO.goal.cash)}{' '}
              以上・満足度の平均 {SCENARIO.goal.satisfaction} 以上・止まった月が{' '}
              {SCENARIO.goal.maxOutageMonths} 回以内
            </span>
            <span className="text-sm">
              止まった月が {SCENARIO.goal.maxOutageMonths}{' '}
              回を超えた時点、所持金が尽きた時点、規約違反の指摘を受けた翌月も違反したままのときは、その場で終わる。
            </span>
          </div>
          <h3 className="mt-2 font-bold">
            アプリの形（コストに効く判断ポイント）
          </h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              記事ページは ISR（再検証 5 分・2,000 ページ）、マイページなどは
              SSR。SSR 1 回の CPU は約{' '}
              {SCENARIO.template(1).routes[0]!.processing.cpuMs}{' '}
              ms（機能が増えると重くなる）
            </li>
            <li>
              1 PV あたり画像 5 枚（150 KB）。画像は 5,000 種類 × サイズ違い 3
            </li>
            <li>
              1 PV あたり API 1 回。DB は小さい（0.3
              GB）が、投稿とコメントで少しずつ大きくなる。投稿された画像もたまっていく
            </li>
          </ul>
          <p className="text-sm opacity-60">
            料金は 2026-10-31 時点の公式の料金表（エンジンと実データ）。円建ては
            1 USD = {USD_JPY} 円の仮定で換算。
            収益・成長・満足度・開発の手間・障害の影響はゲーム上の仮定。
          </p>
        </div>
      </div>
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">どの構成で始めますか？</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {STACKS.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-box border p-3 ${stack === s.index ? 'border-primary bg-primary/5' : 'border-base-300'}`}
              >
                <input
                  type="radio"
                  className="radio radio-primary"
                  checked={stack === s.index}
                  onChange={() => setStack(s.index)}
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          <div className="card-actions items-center justify-end">
            <label
              className="flex items-center gap-2 text-sm"
              title="この日より後に施行される、実際に予告されている料金・制限の改定だけが出来事として出る"
            >
              始めた日
              <input
                type="date"
                className="input input-sm input-bordered"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value || today())}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              乱数のシード
              <input
                type="number"
                className="input input-sm input-bordered w-24"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => {
                onStart(playMonth(newGame(stack, seed, SCENARIO, startDate)));
                scrollTop();
              }}
            >
              運営を始める
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Game({
  state,
  setState,
}: {
  state: GameState;
  setState: (s: GameState) => void;
}) {
  const report = state.history[state.history.length - 1]!;
  const playing = state.phase === 'playing';
  // 月が進んだ直後に、その月の出来事をダイアログで出す（D-23）。結果の画面では出さない。
  // auto: 月が進んだ直後に開いた / manual: 月のカードのボタンで開き直した。
  const [eventsOpen, setEventsOpen] = useState<'auto' | 'manual' | null>(() =>
    playing && report.events.length > 0 ? 'auto' : null,
  );
  return (
    <>
      {!playing && <Result state={state} />}
      <Trends history={state.history} />
      <MonthCard
        report={report}
        onShowEvents={playing ? () => setEventsOpen('manual') : undefined}
      />
      {playing && (
        <Actions
          state={state}
          onDecide={(actions) => {
            const next = playMonth(applyActions(state, actions));
            setState(next);
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
          report={report}
          auto={eventsOpen === 'auto'}
          onClose={() => setEventsOpen(null)}
        />
      )}
      <History history={state.history} />
    </>
  );
}

/**
 * その月の出来事のダイアログ（D-23）。`<dialog>` の showModal でフォーカスを閉じ込め、Esc で閉じる。
 * 選択（提案を受けるか断るか）はここに置かず、月の終わりの行動で選ぶ。
 */
function EventsDialog({
  report: r,
  auto,
  onClose,
}: {
  report: MonthReport;
  auto: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // 月が進んだ直後は、閉じたときにフォーカスが「次の月へ」へ戻ってページがそこまでスクロールする。
    // 開く前にフォーカスを外し、閉じた後もページの先頭のままにする（開き直したときはボタンへ戻す）。
    if (auto && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    d.showModal();
  }, [auto]);
  const hasProposal = r.events.some((e) => e.phase === 'proposal');
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="events-dialog-title"
      onClose={onClose}
    >
      <div className="modal-box max-w-2xl">
        <h2 id="events-dialog-title" className="text-lg font-bold">
          {r.month} か月目の出来事（{r.events.length} 件）
        </h2>
        <div className="mt-3 space-y-2">
          {r.events.map((e) => (
            <EventCard key={`${e.id}:${e.phase}`} event={e} />
          ))}
        </div>
        {hasProposal && (
          <div className="mt-3 text-sm opacity-80">
            ◆ 提案は、月の終わりの行動の欄で受けるか断るかを選ぶ。
          </div>
        )}
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-primary" autoFocus>
              閉じて今月の行動へ
            </button>
          </form>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="閉じる" tabIndex={-1}>
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

const STAGE_CLS: Record<Stage, string> = {
  good: 'badge-success',
  fair: 'badge-warning',
  bad: 'badge-error',
};

function MonthCard({
  report: r,
  onShowEvents,
}: {
  report: MonthReport;
  /** 遊んでいる間だけ渡す。出来事は見出しの一覧に詰め、ダイアログで再表示する（D-23）。 */
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
                      <span
                        className={`badge badge-sm ${PHASE_BADGE[e.phase].cls}`}
                      >
                        {PHASE_BADGE[e.phase].label}
                      </span>
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
                  今月の出来事を見る（{r.events.length} 件）
                </button>
              </div>
            )
          : r.events.map((e) => (
              <EventCard key={`${e.id}:${e.phase}`} event={e} />
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
            <ul className="space-y-1 text-sm">
              {ELEMENTS.map((e) => (
                <li key={e} className="flex flex-wrap items-center gap-2">
                  <span className="w-14">{ELEMENT_LABEL[e]}</span>
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
          <EffortBreakdownView report={r} />
        </div>
        {r.premises.length > 0 && (
          <div>
            <h3 className="mb-1 font-bold">プラットフォームの前提</h3>
            <ul className="space-y-1">
              {r.premises.map((p) => (
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
                        ? `${Math.round(l.amount).toLocaleString()} 円`
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

function EffortBreakdownView({ report: r }: { report: MonthReport }) {
  const e = r.effort;
  const parts = [
    { label: '自前運用の維持', value: e.upkeep, cls: 'bg-warning' },
    { label: '出来事への対応', value: e.interrupt, cls: 'bg-error' },
    {
      label: '乗り換え・DB の差し替え',
      value: e.migration,
      cls: 'bg-secondary',
    },
    { label: '行動（設定・最適化・部品）', value: e.actions, cls: 'bg-info' },
    { label: '機能開発', value: e.feature, cls: 'bg-success' },
  ];
  return (
    <div>
      <h3 className="mb-1 font-bold">
        開発の手間 {e.total} ポイント
        <span className="ml-2 text-sm font-normal opacity-70">
          機能開発の累計 {r.featurePoints}
        </span>
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-base-200">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              className={p.cls}
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
            <span className="ml-auto tabular-nums">{p.value}</span>
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
      <div className="mt-1 text-xs opacity-60">
        SSR の CPU {r.ssrCpuMs} ms（機能開発で重くなる）
      </div>
    </div>
  );
}

const PHASE_LABEL: Record<MonthEvent['phase'], string> = {
  notice: '▲ 予告: ',
  occurred: '● ',
  proposal: '◆ 提案: ',
};
const PHASE_BADGE: Record<MonthEvent['phase'], { label: string; cls: string }> =
  {
    notice: { label: '▲ 予告', cls: 'badge-warning' },
    occurred: { label: '● 起きた', cls: 'badge-info' },
    proposal: { label: '◆ 提案', cls: 'badge-primary' },
  };
const TIER_LABEL: Record<MonthEvent['tier'], string> = {
  common: 'ふだん',
  occasional: 'ときどき',
  rare: 'まれ',
};

/** 出来事の通知（prd/07 §10.2）。当たりうる前提は catalog の文のまま出す（D-12）。 */
function EventCard({ event: e }: { event: MonthEvent }) {
  const badge = PHASE_BADGE[e.phase];
  return (
    <div
      className={`rounded-box border p-3 ${e.tier === 'rare' ? 'border-error' : 'border-base-300'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${badge.cls}`}>{badge.label}</span>
        <span className="badge badge-sm badge-outline">
          {TIER_LABEL[e.tier]}
        </span>
        <span className="font-semibold">{e.title}</span>
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
          。月の終わりの行動で受けるか断るかを選ぶ（断っても罰はない）
        </div>
      )}
      {e.accept?.unavailable && (
        <div className="mt-1 text-xs text-error">
          ✗ 受けられない: {e.accept.unavailable}
        </div>
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
          {e.premises.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-1">
              <span
                className={`badge badge-xs ${p.hit ? 'badge-error' : 'badge-ghost'}`}
              >
                {p.hit ? '✗ 当たった' : '○ 当たりうる前提'}
              </span>
              {p.text}
              {p.ratio !== undefined && (
                <span className="tabular-nums opacity-70">
                  （今 {(p.ratio * 100).toFixed(0)}%）
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 見込みが外れた理由の文（prd/07 §10.7）。 */
function surpriseReason(x: Surprise): string {
  switch (x.cause.kind) {
    case 'event':
      return `理由: 出来事「${x.cause.title}」。これが無ければ今月は ${(x.cause.ratioWithout * 100).toFixed(0)}% で、超えなかった`;
    case 'action':
      return `理由: 前の月の選択（${x.cause.action}）`;
    case 'growth':
      return '理由: 伸びが直近の推移より速かった';
  }
}

function PremiseRow({ p }: { p: PlatformPremise }) {
  const blocked = p.hit && p.effect !== 'cost';
  const badge =
    p.kind === 'fact'
      ? p.hit
        ? 'badge-error'
        : 'badge-ghost'
      : blocked
        ? 'badge-error'
        : p.hit
          ? 'badge-warning'
          : 'badge-info';
  const label =
    p.kind === 'fact'
      ? p.hit
        ? '違反'
        : '事実'
      : blocked
        ? '当たった'
        : p.hit
          ? '超過（課金）'
          : 'あと少し';
  const ratio = p.ratio === undefined ? null : Math.min(p.ratio, 1);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className={`badge badge-sm ${badge}`}>{label}</span>
      <span>{p.text}</span>
      {ratio !== null && (
        <span className="flex items-center gap-1 text-xs opacity-70">
          <progress
            className={`progress w-20 ${blocked ? 'progress-error' : p.hit ? 'progress-warning' : 'progress-info'}`}
            value={ratio}
            max={1}
          />
          {(p.ratio! * 100).toFixed(0)}%
        </span>
      )}
    </li>
  );
}

/** 今月の行動。設定はいつでも戻せる。手間のポイントの残りの範囲で、いくつでも選べる。 */
function Actions({
  state,
  onDecide,
}: {
  state: GameState;
  onDecide: (a: Action[]) => void;
}) {
  const [settings, setSettings] = useState<Partial<Record<SettingKey, number>>>(
    {},
  );
  const [optimize, setOptimize] = useState(false);
  const [stackChange, setStackChange] = useState<number | null>(null);
  /** 提案への返事（選ばなければ断る）。 */
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [blockBots, setBlockBots] = useState(false);
  /** 部品の差し替え（スロットごと。D-24）。 */
  const [parts, setParts] = useState<Partial<Record<SlotId, string>>>({});
  const reset = () => {
    setSettings({});
    setOptimize(false);
    setStackChange(null);
    setAnswers({});
    setBlockBots(false);
    setParts({});
  };

  const build = (
    o: {
      settings?: Partial<Record<SettingKey, number>>;
      optimize?: boolean;
      stack?: number | null;
      answers?: Record<string, boolean>;
      blockBots?: boolean;
      parts?: Partial<Record<SlotId, string>>;
    } = {},
  ): Action[] => {
    const st = o.settings ?? settings;
    const opt = o.optimize ?? optimize;
    const stack = o.stack === undefined ? stackChange : o.stack;
    const ans = o.answers ?? answers;
    const ps = o.parts ?? parts;
    const out: Action[] = [];
    // 提案を受ける手間（割り込み）を先に取る
    for (const eventId of state.pendingProposals)
      out.push({ type: 'respond', eventId, accept: ans[eventId] ?? false });
    if (o.blockBots ?? blockBots) out.push({ type: 'block-bots' });
    for (const [slot, option] of Object.entries(ps))
      out.push({ type: 'component', slot: slot as SlotId, option: option! });
    if (stack !== null)
      out.push({
        type: isPlanChange(state.stackIndex, stack) ? 'plan' : 'migrate',
        stackIndex: stack,
      });
    for (const [key, value] of Object.entries(st))
      out.push({ type: 'set', key: key as SettingKey, value: value! });
    if (opt) out.push({ type: 'optimize' });
    return out;
  };
  /** すべての行動が受け付けられるか（手間が足りない・選べない行動があれば false）。 */
  const valid = (actions: Action[]) => {
    let s = state;
    for (const a of actions) {
      const next = applyAction(s, a);
      if (next === s) return false;
      s = next;
    }
    return true;
  };
  const actions = build();
  const draft = applyActions(state, actions);
  const left = effortAvailable(draft);

  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          今月の行動（来月に効く）
          <span className="badge badge-lg">
            来月の手間の残り {left} / {state.effortPerMonth}
          </span>
        </h2>
        <p className="text-sm opacity-70">
          残りは機能開発（満足度の「機能」と成長）に回る。設定はいつでも戻せる。
        </p>
        {state.pendingProposals.length > 0 && (
          <div className="space-y-2">
            <div className="divider my-1 text-xs">
              届いた提案（選ばなければ断る）
            </div>
            {state.pendingProposals.map((id) => {
              const def = eventDef(scenarioOf(state), id)!;
              const unavailable = unavailableReason(state, def);
              const acceptOk = valid(
                build({ answers: { ...answers, [id]: true } }),
              );
              return (
                <div
                  key={id}
                  className="rounded-box border border-base-300 p-3"
                >
                  <div className="font-semibold">{def.title}</div>
                  <div className="mb-1 text-sm opacity-80">{def.text}</div>
                  <div className="flex flex-wrap gap-4">
                    <label
                      className={`flex items-center gap-2 ${acceptOk || answers[id] ? 'cursor-pointer' : 'opacity-50'}`}
                    >
                      <input
                        type="radio"
                        className="radio radio-sm"
                        checked={answers[id] === true}
                        disabled={!acceptOk && !answers[id]}
                        onChange={() => setAnswers({ ...answers, [id]: true })}
                      />
                      {def.accept!.label}
                      {!acceptOk && !answers[id] && (
                        <span className="text-xs">
                          {unavailable
                            ? `（受けられない: ${unavailable}）`
                            : '（手間が足りない）'}
                        </span>
                      )}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        className="radio radio-sm"
                        checked={answers[id] !== true}
                        onChange={() => setAnswers({ ...answers, [id]: false })}
                      />
                      断る（何も変わらない）
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(SETTINGS) as SettingKey[]).map((key) => {
            const def = SETTINGS[key];
            const current = state.settings[def.field];
            const chosen = settings[key] ?? current;
            return (
              <label key={key} className="form-control">
                <span className="label-text font-semibold">
                  {def.label}
                  <span className="ml-1 text-xs font-normal opacity-60">
                    変更 {def.effort} ポイント
                  </span>
                </span>
                <select
                  className="select select-bordered select-sm"
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
                    const ok =
                      o.value === current || valid(build({ settings: trial }));
                    return (
                      <option key={o.value} value={o.value} disabled={!ok}>
                        {o.label}
                        {o.value === current ? '（今）' : ''}
                        {ok ? '' : '（手間が足りない）'}
                      </option>
                    );
                  })}
                </select>
                <span className="mt-1 text-xs opacity-60">{def.note}</span>
              </label>
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
          <span>
            SSR を最適化する（CPU {nextSsrCpuMs(state)} ms →{' '}
            {Math.max(
              EFFORT.minSsrCpuMs,
              nextSsrCpuMs(state) - EFFORT.optimizeStepMs,
            )}{' '}
            ms）{EFFORT.optimize} ポイント
            <span className="block text-xs opacity-60">
              CPU 時間と速さに効く。機能開発が進むとまた重くなる
            </span>
          </span>
        </label>
        {!state.botBlocked && (
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
            <span>
              Bot を遮断するルールを入れる {BOT_BLOCK.effort} ポイント
              <span className="block text-xs opacity-60">
                Bot・クローラーのアクセスが来月から半分になる（一度入れれば続く。対策の製品の料金は未取得なので、手間だけの行動）
              </span>
            </span>
          </label>
        )}
        <ComponentsSection
          state={state}
          parts={parts}
          setParts={setParts}
          valid={(p) => valid(build({ parts: p }))}
        />
        <div className="divider my-1 text-xs">構成を変える</div>
        {state.migration ? (
          <div className="text-sm">
            {STACKS[state.migration.to]!.name} へ乗り換え中（
            {state.migration.done} / {state.migration.required}{' '}
            ポイント）。済むまで別の変更はできない。
          </div>
        ) : (
          <div className="space-y-1">
            {[
              null,
              ...STACKS.filter((s) => s.index !== state.stackIndex).map(
                (s) => s.index,
              ),
            ].map((idx) => {
              const plan = idx !== null && isPlanChange(state.stackIndex, idx);
              const ok = idx === null || valid(build({ stack: idx }));
              const label =
                idx === null
                  ? '構成はこのまま'
                  : plan
                    ? `${STACKS[idx]!.name} にプラン変更（手間なし・来月から）`
                    : `${STACKS[idx]!.name} へ乗り換える（${EFFORT.migrationPerMonth} ポイント × ${migrationEffort(state.stackIndex, idx) / EFFORT.migrationPerMonth} か月。期間中は新旧両方の費用）`;
              return (
                <label
                  key={idx ?? 'keep'}
                  className={`flex items-start gap-3 py-1 ${ok ? 'cursor-pointer' : 'opacity-50'}`}
                >
                  <input
                    type="radio"
                    className="radio radio-sm mt-1"
                    checked={stackChange === idx}
                    disabled={!ok}
                    onChange={() => setStackChange(idx)}
                  />
                  <span>
                    {label}
                    {!ok && (
                      <span className="block text-xs">手間が足りない</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
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
              onDecide(actions);
              reset();
            }}
          >
            次の月へ
          </button>
        </div>
      </div>
    </div>
  );
}

/** 部品の差し替え（同じ事業者の中・D-24・prd/07 §11.3）。今の行動の欄に収める（D-22）。 */
function ComponentsSection({
  state,
  parts,
  setParts,
  valid,
}: {
  state: GameState;
  parts: Partial<Record<SlotId, string>>;
  setParts: (p: Partial<Record<SlotId, string>>) => void;
  valid: (p: Partial<Record<SlotId, string>>) => boolean;
}) {
  const slots = componentSlots(state);
  if (slots.length === 0) return null;
  const busy = state.migration !== null || state.componentSwap !== null;
  return (
    <>
      <div className="divider my-1 text-xs">
        部品（同じ事業者の中で差し替える）
      </div>
      {busy ? (
        <div className="text-sm">
          {state.componentSwap
            ? `DB の差し替え（データの移行）の最中（${state.componentSwap.done} / ${state.componentSwap.required} ポイント）。`
            : '乗り換えの最中。'}
          済むまで部品は差し替えられない。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {slots.map((x) => {
            const chosen = parts[x.slot] ?? x.current;
            const opt = x.options.find((o) => o.id === chosen)!;
            const preview =
              chosen === x.current
                ? []
                : componentPreview(state, x.slot, chosen);
            return (
              <label key={x.slot} className="form-control">
                <span className="label-text font-semibold">
                  {x.label}
                  <span className="ml-1 text-xs font-normal opacity-60">
                    変更 {componentEffortLabel(x.slot)}
                  </span>
                </span>
                <select
                  className="select select-bordered select-sm"
                  value={chosen}
                  onChange={(e) => {
                    const next = { ...parts };
                    if (e.target.value === x.current) delete next[x.slot];
                    else next[x.slot] = e.target.value;
                    setParts(next);
                  }}
                >
                  {x.options.map((o) => {
                    const trial = { ...parts, [x.slot]: o.id };
                    if (o.id === x.current) delete trial[x.slot];
                    const ok = o.id === x.current || valid(trial);
                    return (
                      <option key={o.id} value={o.id} disabled={!ok}>
                        {o.label}
                        {o.inappropriate ? '（不適切・学びのため）' : ''}
                        {o.id === x.current ? '（今）' : ''}
                        {ok ? '' : '（選べない・手間が足りない）'}
                      </option>
                    );
                  })}
                </select>
                <span className="mt-1 text-xs opacity-60">
                  {opt.inappropriate && (
                    <span className="badge badge-xs badge-warning mr-1">
                      ⚠ 不適切
                    </span>
                  )}
                  {opt.note}
                </span>
                {preview.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {preview.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-1"
                      >
                        <span
                          className={`badge badge-xs ${p.hit ? 'badge-error' : 'badge-ghost'}`}
                        >
                          {p.hit ? '✗ 当たる' : '○ 当たりうる前提'}
                        </span>
                        {p.text}
                        {p.ratio !== undefined && (
                          <span className="tabular-nums opacity-70">
                            （今の規模で {(p.ratio * 100).toFixed(0)}%）
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 結果（prd/07 §9.6）: 合否・軸ごとの成績（基準プレイの目盛りつき）・振り返り。 */
function Result({ state }: { state: GameState }) {
  const won = state.phase === 'won';
  const end = state.end!;
  const checks = goalChecks(state);
  const axes = axesOf(state);
  // 行の名前（基準プレイは短い名前）は game の comparisonRows で決める（単体テストあり）
  const table = useMemo(() => comparisonRows(state), [state]);
  const cfPaid = table.find((r) => r.id === 'cf-paid')!;
  /** 短い名前と説明が違う基準プレイだけを注記に出す。 */
  const abbreviated = scenarioOf(state).baselines.filter(
    (b) => b.short && b.short !== b.label,
  );
  const reflection = reflectionOf(state);
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
  const meters = resultMeters(state, checks, axes, {
    label: cfPaid.name,
    axes: cfPaid.axes,
  });
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className={`alert ${won ? 'alert-success' : 'alert-error'}`}>
          <span className="text-lg font-bold">{END_LABEL[end.reason]}</span>
          <span>
            {end.month} か月目で終了・所持金 {usd(state.cash)}・止まった月{' '}
            {state.outages} 回
          </span>
        </div>
        <div className="space-y-3">
          {meters.map((m) => (
            <Meter key={m.label} {...m} />
          ))}
        </div>
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title font-bold">
            基準プレイとの比較の表（軸ごとの成績・満足度の要素）
          </summary>
          <div className="collapse-content">
            <p className="mb-1 text-sm opacity-70">
              1 つの点数にはしない。下の行は同じシードの基準プレイ（目盛り）
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
            振り返り: 当たった前提・満足度が悪かった月・手間の内訳
          </summary>
          <div className="collapse-content">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-bold">当たった前提・近づいた前提</h3>
                {reflection.premises.length ? (
                  <ul className="space-y-1 text-sm">
                    {reflection.premises.map((p) => (
                      <li key={p.text}>
                        <span
                          className={`badge badge-sm mr-1 ${p.hit ? 'badge-error' : 'badge-info'}`}
                        >
                          {p.month} か月目・{p.hit ? '当たった' : '近づいた'}
                        </span>
                        {p.text}
                        {p.action && (
                          <span className="block text-xs opacity-60">
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
                      見込みより早く超えた前提と、その理由
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
                  手間の使い道（合計 {e.total}）
                </h3>
                <ul className="text-sm">
                  {[
                    ['自前運用の維持', e.upkeep],
                    ['出来事への対応', e.interrupt],
                    ['乗り換え', e.migration],
                    ['行動（設定・最適化）', e.actions],
                    ['機能開発', e.feature],
                  ].map(([label, v]) => (
                    <li key={label as string} className="flex">
                      {label}
                      <span className="ml-auto tabular-nums">
                        {v}（
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

/** 結果の上部のメーター（合否の条件 3 つ + 基準プレイと比べる 2 つ）。 */
function resultMeters(
  state: GameState,
  checks: ReturnType<typeof goalChecks>,
  axes: Axes,
  reference: { label: string; axes: Axes },
): Parameters<typeof Meter>[0][] {
  const ok = (label: string) => checks.find((c) => c.label === label)!.ok;
  const pass = (good: boolean) =>
    good
      ? { status: 'good' as const, statusText: '✓ 達成' }
      : { status: 'critical' as const, statusText: '✗ 未達' };
  const goal = scenarioOf(state).goal;
  const avg = axes.satisfaction;
  const limit = goal.maxOutageMonths;
  const ref = reference.axes;
  const vsRef = (mine: number, theirs: number) =>
    theirs > 0 ? `基準の ${Math.round((mine / theirs) * 100)}%` : '';
  return [
    {
      label: '所持金',
      valueText: usd(state.cash),
      value: state.cash,
      max: Math.max(state.cash, goal.cash) * 1.15,
      marker: { value: goal.cash, label: `目標 ${usd(goal.cash)}` },
      ...pass(ok('所持金')),
      ...(ok('所持金') ? {} : { note: `あと ${usd(goal.cash - state.cash)}` }),
    },
    {
      label: '満足度の平均',
      valueText: avg.toFixed(2),
      value: avg,
      max: 1,
      marker: { value: goal.satisfaction, label: `目標 ${goal.satisfaction}` },
      ...pass(ok('満足度の平均')),
      ...(ok('満足度の平均')
        ? {}
        : { note: `あと ${(goal.satisfaction - avg).toFixed(2)}` }),
    },
    {
      label: '止まった月',
      valueText: `${state.outages} 回`,
      value: state.outages,
      max: Math.max(state.outages, limit + 1) + 1,
      marker: { value: limit, label: `上限 ${limit} 回` },
      ...pass(ok('止まった月')),
      note: ok('止まった月')
        ? '少ないほど良い（棒が上限の線より左なら達成）'
        : `少ないほど良い。上限を ${state.outages - limit} 回超えた`,
    },
    {
      label: '最終的な規模（月 PV）',
      valueText: compact(Math.round(axes.finalPV)),
      value: axes.finalPV,
      max: Math.max(axes.finalPV, ref.finalPV) * 1.15,
      marker: { value: ref.finalPV, label: `基準: ${reference.label}` },
      status: 'reference',
      statusText: '○ 参考（合否には入らない）',
      note: vsRef(axes.finalPV, ref.finalPV),
    },
    {
      label: '機能開発に回せた手間',
      valueText: `${axes.featurePoints}（${(axes.featureShare * 100).toFixed(0)}%）`,
      value: axes.featurePoints,
      max: Math.max(axes.featurePoints, ref.featurePoints) * 1.15,
      marker: { value: ref.featurePoints, label: `基準: ${reference.label}` },
      status: 'reference',
      statusText: '○ 参考（合否には入らない）',
      note: vsRef(axes.featurePoints, ref.featurePoints),
    },
  ];
}

function History({ history }: { history: MonthReport[] }) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body overflow-x-auto">
        <h2 className="card-title">これまでの運営</h2>
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
                  <span className={`badge badge-sm ${STATUS[r.status].cls}`}>
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
                    .map((e) => `${PHASE_LABEL[e.phase]}${e.title}`)
                    .join('・')}
                </td>
                <td className="text-xs">{r.action ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 推移と見込み（prd/07 §5・GD-1）。毎月の画面の上に常に出し、続いている感じを見せる。 */
function Trends({ history }: { history: MonthReport[] }) {
  const last = history[history.length - 1]!;
  const prev = history[history.length - 2];
  const cost = (r: MonthReport) => r.infraCost;
  const trends = selectTrends(
    premiseTrends(
      history.map((m) => m.snapshots),
      SCENARIO.months,
      projectionNote(last) ? { skipProjection: projectionNote(last)! } : {},
    ),
  );
  const tiles = [
    {
      label: 'PV',
      value: compact(Math.round(last.pv)),
      series: history.map((r) => r.pv),
      delta: prev ? last.pv / prev.pv - 1 : null,
    },
    {
      label: '収益（月）',
      value: usd(last.revenue),
      series: history.map((r) => r.revenue),
      delta: prev ? last.revenue / prev.revenue - 1 : null,
    },
    {
      label: '費用（月）',
      value: usd(cost(last)),
      series: history.map(cost),
      delta: prev ? cost(last) / cost(prev) - 1 : null,
    },
    {
      label: '所持金',
      value: usd(last.cash),
      series: history.map((r) => r.cash),
      delta: null,
    },
    {
      label: '機能開発（月）',
      value: `${last.effort.feature} / ${last.effort.total}`,
      series: history.map((r) => r.effort.feature),
      delta: null,
    },
  ];
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4">
        <h2 className="card-title">これまでの推移</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-box bg-base-200 p-3">
              <div className="text-xs opacity-70">{t.label}</div>
              <div className="text-xl font-semibold">{t.value}</div>
              <div className="flex flex-wrap items-end justify-between">
                <span className="text-xs opacity-70">
                  {t.delta === null || !Number.isFinite(t.delta)
                    ? ''
                    : `前月比 ${pct(t.delta)}`}
                </span>
                <Sparkline values={t.series} months={SCENARIO.months} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <LineChart
            title="収益と費用（月）"
            months={SCENARIO.months}
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
              },
            ]}
          />
          <LineChart
            title={`満足度と評判（目標の平均 ${SCENARIO.goal.satisfaction}）`}
            months={SCENARIO.months}
            format={(v) => v.toFixed(2)}
            yMax={1}
            reference={{ value: SCENARIO.goal.satisfaction, label: '目標' }}
            series={[
              {
                id: 'score',
                label: '満足度',
                color: 'var(--series-1)',
                values: history.map((r) => r.satisfaction.score),
              },
              {
                id: 'reputation',
                label: '評判',
                color: 'var(--series-2)',
                values: history.map((r) => r.satisfaction.reputation),
              },
            ]}
          />
        </div>
        {trends.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              前提の使用率（境目 = 100%）
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {trends.map((t) => (
                <TrendCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendCard({ t }: { t: ReturnType<typeof premiseTrends>[number] }) {
  const blocked = t.hitNow && t.effect !== 'cost';
  const status = blocked
    ? { cls: 'badge-error', label: '✗ 当たった' }
    : t.hitNow
      ? { cls: 'badge-warning', label: '● 超過（課金）' }
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
    <div className="rounded-box border border-base-300 p-3">
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
      <LineChart
        months={SCENARIO.months}
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
            projection: t.projection.map((p) => ({
              month: p.month,
              value: p.ratio,
            })),
          },
        ]}
      />
      {Math.max(...t.ratios.map((r) => r ?? 0)) > 3 && (
        <div className="text-xs opacity-60">
          300% を超えた部分はグラフの上端で切っている（値は上の %）
        </div>
      )}
    </div>
  );
}
