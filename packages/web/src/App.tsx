// ゲームモードの画面（Phase 2〜4 の前倒しの試作）。ロジックは game パッケージ、ここは表示と操作だけ。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actionEffort,
  applyActions,
  averageSatisfaction,
  axesOf,
  BOT_BLOCK,
  cashProjectionOf,
  comparisonRows,
  checkActions,
  componentEffortLabel,
  componentFlavor,
  componentPreview,
  componentProposal,
  componentSlots,
  pageWeightOf,
  settingInactiveReason,
  settingNote,
  EFFORT,
  effortAvailable,
  ELEMENT_LABEL,
  ELEMENTS,
  END_LABEL,
  eventDef,
  goalChecks,
  isPlanChange,
  stackChangeText,
  stackFlavor,
  stackName,
  frameworksOf,
  hiddenSettings,
  type FrameworkId,
  storageOptionText,
  migrationEffort,
  newSave,
  nextSsrCpuMs,
  parseSave,
  replaySave,
  validSetupChoices,
  withTurn,
  playMonth,
  premiseTrends,
  projectionNote,
  reflectionOf,
  retryHintsOf,
  scenarioOf,
  SCENARIOS,
  selectTrends,
  setupProblem,
  setupRevalidateOptions,
  DEFAULT_REVALIDATE_SEC,
  invalidationNote,
  onDemandInvalidationEstimate,
  settingFlavor,
  SETTINGS,
  STACKS,
  STAGE_LABEL,
  type Action,
  type Axes,
  type GameState,
  type MonthEvent,
  type MonthReport,
  type SaveData,
  type Scenario,
  type Surprise,
  type SettingKey,
  type Stage,
} from 'game';
import type { PlatformPremise } from 'estimator';
import { compact, LineChart, Meter, Sparkline } from './charts.tsx';
import { Info } from './info.tsx';
import {
  EffortBar,
  FrameworkField,
  ScenarioDescription,
  ScenarioPicker,
  SCENARIO_LIST,
} from './scenario-briefing.tsx';
import { Meta, NameWithInfo, OptionText } from './option-text.tsx';
import {
  SetupComponents,
  SetupRevalidate,
  type SetupChoices,
} from './setup-components.tsx';
import {
  CountUp,
  FireworksCanvas,
  FireworksEngine,
  useReducedMotion,
} from './motion.tsx';

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
/** 画面に出す為替の仮定（game の共通の仮定）。 */
const USD_JPY = 150;
type SlotId = Extract<Action, { type: 'component' }>['slot'];

/** 遊んでいる途中の保存（D-26）。行動の履歴だけを持ち、読み込みは再生で復元する。 */
const SAVE_KEY = 'infra-supra:game-save';

type Session = { save: SaveData; state: GameState; restored: boolean };

/** 保存から再開する。読めない・版が違う・再生で例外が出たら、黙って捨てて初期画面にする。 */
function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = parseSave(JSON.parse(raw));
    if (!save) throw new Error('読めない保存');
    return { save, state: replaySave(save), restored: true };
  } catch {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // 保存領域が使えない環境では何もしない
    }
    return null;
  }
}

function storeSave(save: SaveData | null) {
  try {
    if (save) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // 保存できなくても遊べる（再読み込みで最初からになるだけ）
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  useEffect(() => storeSave(session?.save ?? null), [session?.save]);
  const state = session?.state ?? null;
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
            onClick={() => setSession(null)}
          >
            最初から
          </button>
        )}
      </div>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {state ? (
          <Game
            // 新しく始めたとき・再開したときは作り直す（ダイアログの状態を引き継がない）
            key={`${session!.save.seed}:${session!.save.stackIndex}:${session!.save.framework}:${session!.save.startDate}:${session!.restored}`}
            state={state}
            restored={session!.restored}
            onAdvance={(actions) => {
              const next = playMonth(applyActions(state, actions));
              setSession({
                save: withTurn(session!.save, actions),
                state: next,
                restored: session!.restored,
              });
              return next;
            }}
          />
        ) : (
          <Briefing
            onStart={(save) =>
              setSession({ save, state: replaySave(save), restored: false })
            }
          />
        )}
      </main>
    </div>
  );
}

function Briefing({ onStart }: { onStart: (s: SaveData) => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIO_LIST[0]!.id);
  const scenario = SCENARIOS[scenarioId]!;
  const frameworks = frameworksOf(scenario);
  const [frameworkChoice, setFramework] = useState<FrameworkId>(
    frameworks.default,
  );
  // シナリオを替えたときに選べないフレームワークなら既定にする
  const framework = frameworks.allowed.includes(frameworkChoice)
    ? frameworkChoice
    : frameworks.default;
  // 既定は一覧の 1 番目（正解になりやすい構成を既定にしない。D-41）
  const [stack, setStack] = useState(0);
  const [seed, setSeed] = useState(42);
  const [startDate, setStartDate] = useState(today);
  // 部品は既定なしで、スロットごとに選ぶ（D-45）。構成・フレームワーク・シナリオを替えたら、選べなくなった選択を
  // 状態からも外す（元の組み合わせに戻しても復活しない。OCL-09D12A43）
  const [parts, setParts] = useState<SetupChoices>({});
  const change = (next: {
    scenarioId?: string;
    stack?: number;
    framework?: FrameworkId;
  }) => {
    const sc = SCENARIOS[next.scenarioId ?? scenarioId]!;
    const fws = frameworksOf(sc);
    const fwChoice = next.framework ?? frameworkChoice;
    const fw = fws.allowed.includes(fwChoice) ? fwChoice : fws.default;
    const st = next.stack ?? stack;
    if (next.scenarioId !== undefined) setScenarioId(next.scenarioId);
    if (next.framework !== undefined) setFramework(next.framework);
    if (next.stack !== undefined) setStack(next.stack);
    setParts(validSetupChoices(sc, st, fw, parts));
  };
  const problem = setupProblem(scenario, stack, framework, parts);
  // ISR の再検証（D-49。Next.js のときだけ出る。既定は 5 分）
  const [revalidateSec, setRevalidateSec] = useState(DEFAULT_REVALIDATE_SEC);
  return (
    <>
      <ScenarioPicker
        value={scenarioId}
        onChange={(id) => change({ scenarioId: id })}
      />
      <ScenarioDescription scenario={scenario} usdJpy={USD_JPY} />
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">どの構成で始めますか？</h2>
          {/* フレームワークは構成と同列の判断（D-35）。シナリオの属性として先に選ばせない */}
          <FrameworkField
            scenario={scenario}
            allowed={frameworks.allowed}
            value={framework}
            onChange={(id) => change({ framework: id })}
          />
          <h3 className="mt-2 font-bold">インフラの構成</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {STACKS.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-start gap-3 rounded-box border p-3 ${stack === s.index ? 'border-primary bg-primary/5' : 'border-base-300'}`}
              >
                <input
                  type="radio"
                  className="radio radio-primary mt-0.5 shrink-0"
                  checked={stack === s.index}
                  onChange={() => change({ stack: s.index })}
                />
                <span className="block min-w-0">
                  <span className="block">
                    {stackName(s.index, framework, false)}
                  </span>
                  {/* 短い説明（フレーバー。事実だが、それだけで選ぶと外れうる。D-41） */}
                  <span className="mt-0.5 block text-xs opacity-70">
                    {stackFlavor(s.index)}
                  </span>
                  <EffortBar
                    scenario={scenario}
                    stackIndex={s.index}
                    // 選んでいる構成は、選んだ部品で増える他の事業者の管理も出す（D-52）
                    {...(stack === s.index
                      ? { components: parts, framework }
                      : {})}
                  />
                </span>
              </label>
            ))}
          </div>
          <SetupComponents
            scenario={scenario}
            stackIndex={stack}
            framework={framework}
            value={parts}
            // 選んだ直後も依存の崩れた選択（VPS の API のキャッシュなど）を外して持つ
            onChange={(v) =>
              setParts(validSetupChoices(scenario, stack, framework, v))
            }
          />
          <SetupRevalidate
            scenario={scenario}
            stackIndex={stack}
            framework={framework}
            components={parts}
            value={revalidateSec}
            onChange={setRevalidateSec}
          />
          {problem && (
            <p className="text-right text-sm" role="status">
              {problem}
            </p>
          )}
          <div className="card-actions flex-wrap items-center justify-end">
            <label
              className="flex items-center gap-2 text-sm whitespace-nowrap"
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
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
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
              disabled={problem !== null}
              title={problem ?? undefined}
              onClick={() => {
                onStart(
                  newSave({
                    scenarioId: scenario.id,
                    stackIndex: stack,
                    framework,
                    seed,
                    startDate,
                    components: parts,
                    ...(setupRevalidateOptions(scenario, framework).length
                      ? { revalidateSec }
                      : {}),
                  }),
                );
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
  restored,
  onAdvance,
}: {
  state: GameState;
  /** 保存から再開した（出来事・達成のダイアログを自動では開かない。D-26）。 */
  restored: boolean;
  /** 月の終わりの行動を当てて次の月へ進める（保存も更新する）。 */
  onAdvance: (actions: Action[]) => GameState;
}) {
  const report = state.history[state.history.length - 1]!;
  const playing = state.phase === 'playing';
  // 月が進んだ直後に、その月の出来事をダイアログで出す（D-23）。結果の画面では出さない。
  // auto: 月が進んだ直後に開いた / manual: 月のカードのボタンで開き直した。
  /**
   * 目標達成のダイアログを開いた回数（結果の画面のボタンで開き直す。D-25）。null は開いていない
   * （保存から再開したときは自動で開かない。D-26）。
   */
  const [celebration, setCelebration] = useState<number | null>(
    restored ? null : 0,
  );
  useEffect(() => {
    if (state.phase !== 'won') setCelebration(0);
  }, [state.phase]);
  const [eventsOpen, setEventsOpen] = useState<'auto' | 'manual' | null>(() =>
    playing && !restored && report.events.length > 0 ? 'auto' : null,
  );
  return (
    <>
      {state.phase === 'won' && celebration !== null && (
        // key を変えると最初と同じように開き直す（暗い背景と花火も再開）
        <VictoryCelebration
          key={celebration}
          state={state}
          auto={celebration === 0}
        />
      )}
      {!playing && (
        <Result
          state={state}
          onCelebrate={() => setCelebration((n) => (n ?? 0) + 1)}
        />
      )}
      <Trends
        history={state.history}
        scenario={scenarioOf(state)}
        ended={state.phase !== 'playing'}
      />
      <MonthCard
        report={report}
        onShowEvents={playing ? () => setEventsOpen('manual') : undefined}
      />
      {playing && (
        <Actions
          state={state}
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
 * 目標達成のダイアログと花火（D-25）。開いている間は暗い背景の上で花火を打ち上げ続ける（ダイアログの背面・背景の前面）。
 * 閉じると背景が消え、新しい花火は出さない。空中に残った粒は少し薄くして、寿命で消えるまで描いてから片付ける。
 * 動きを減らす設定では、ダイアログだけ出して花火は出さない。作法は出来事のダイアログ（D-23）と同じ。
 */
function VictoryCelebration({
  state,
  auto,
}: {
  state: GameState;
  /** 達成した直後に開いた（true）か、結果の画面のボタンで開き直した（false）か。 */
  auto: boolean;
}) {
  const reduced = useReducedMotion();
  const engine = useMemo(() => new FireworksEngine(), []);
  const [open, setOpen] = useState(true);
  const [afterglow, setAfterglow] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // 達成した直後はフォーカスを外して開く（閉じた後もページの先頭のまま）。開き直したときはボタンへ戻す（D-23 と同じ）
    if (auto && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    d.showModal();
  }, [auto]);
  // 合否の 3 つ（所持金・満足度の平均・止まった月）だけを、結果の画面と同じメーターで出す
  const meters = useMemo(() => {
    const cfPaid = comparisonRows(state).find((r) => r.id === 'cf-paid')!;
    return resultMeters(state, goalChecks(state), axesOf(state), {
      label: cfPaid.name,
      axes: cfPaid.axes,
    }).filter((m) => m.status !== 'reference');
  }, [state]);
  return (
    <>
      {open && (
        <dialog
          ref={ref}
          className="modal"
          // 花火が映える暗い背景
          style={{ backgroundColor: 'rgba(6, 8, 22, 0.86)' }}
          aria-labelledby="victory-title"
          onClose={() => {
            setOpen(false);
            setAfterglow(!reduced && engine.particles.length > 0);
          }}
        >
          <div className="modal-box relative z-10 max-w-lg overflow-hidden p-0">
            {/* 成功の色の帯で見出しを強調する（色だけにせず ✓ とラベルを添える） */}
            <div className="bg-success px-6 py-5 text-success-content">
              <h2 id="victory-title" className="text-3xl font-bold">
                ✓ 目標達成
              </h2>
              <p className="mt-1 text-sm">
                {state.end!.month} か月の運営で、3 つの条件をすべて満たした
              </p>
            </div>
            <div className="space-y-4 px-6 pt-5">
              {/* 結果の画面と同じメーター（目標・上限の目盛りつき）。開いたときに伸びる（動きを減らす設定では即時） */}
              {meters.map((m) => (
                <Meter key={m.label} {...m} size="lg" />
              ))}
            </div>
            <div className="modal-action px-6 pb-6">
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
                      <span className={`badge badge-sm ${eventBadge(e).cls}`}>
                        {eventBadge(e).label}
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
    // 構成の既定より増えた事業者のアカウントの維持（D-52）。増えていなければ出さない
    ...(e.accounts
      ? [{ label: '他の事業者の管理', value: e.accounts, cls: 'bg-warning/50' }]
      : []),
    { label: '出来事への対応', value: e.interrupt, cls: 'bg-error' },
    {
      label: '乗り換え・DB の差し替え',
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
        開発の手間 {e.total} ポイント
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
      return { label: '◆ 提案', cls: 'badge-primary' };
    case 'occurred':
      return e.announced === false
        ? {
            label: '⚡ 今月発生',
            cls: 'badge-error',
            note: '今月の費用・満足度に効いている。対処は来月から',
          }
        : e.announced === true
          ? { label: '● 起きた（先月の予告どおり）', cls: 'badge-info' }
          : { label: '● 起きた', cls: 'badge-info' };
  }
}
const TIER_LABEL: Record<MonthEvent['tier'], string> = {
  common: 'ふだん',
  occasional: 'ときどき',
  rare: 'まれ',
};

/** 出来事の通知（prd/07 §10.2）。当たりうる前提は catalog の文のまま出す（D-12）。 */
function EventCard({ event: e }: { event: MonthEvent }) {
  const badge = eventBadge(e);
  return (
    <div
      className={`rounded-box border p-3 ${e.tier === 'rare' ? 'border-error' : 'border-base-300'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${badge.cls}`}>{badge.label}</span>
        {badge.note && <span className="text-xs">{badge.note}</span>}
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
  /** さくらの VPS のストレージ変更オプション（D-30）。 */
  const [storage, setStorage] = useState(false);
  /** 部品の差し替え（スロットごと。D-24）。 */
  const [parts, setParts] = useState<Partial<Record<SlotId, string>>>({});
  const reset = () => {
    setSettings({});
    setOptimize(false);
    setStackChange(null);
    setAnswers({});
    setBlockBots(false);
    setStorage(false);
    setParts({});
  };

  const build = (
    o: {
      settings?: Partial<Record<SettingKey, number>>;
      optimize?: boolean;
      stack?: number | null;
      answers?: Record<string, boolean>;
      blockBots?: boolean;
      storage?: boolean;
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
    if (o.storage ?? storage) out.push({ type: 'storage-option' });
    // VPS の API の応答のキャッシュは前段の CDN が要る（D-37）。付けるときは前段の CDN の後、外すときは先に当てる
    const order = ([slot, option]: [string, string | undefined]) =>
      slot === 'apiCache' ? (option === 'none' ? -1 : 1) : 0;
    for (const [slot, option] of Object.entries(ps).sort(
      (a, b) => order(a) - order(b),
    ))
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
  /**
   * 選べない理由（すべて選べれば null）。理由はエンジンが区別して返す文をそのまま出す
   * （手間が足りない・今と同じ・最中・要件・提案を受けると付く など）。
   */
  const blocked = (actions: Action[]): string | null => {
    const r = checkActions(state, actions);
    return r.ok ? null : r.message;
  };
  const valid = (actions: Action[]) => blocked(actions) === null;
  const actions = build();
  const draft = applyActions(state, actions);
  const left = effortAvailable(draft);
  // このシナリオで効かない行動は出さない（D-33・prd/09 E-6）
  const hidden = scenarioOf(state).hidden;
  // シナリオで効かない設定と、SPA の ISR の間隔は出さない（OCL-8DFFDBEC）
  const hiddenKeys = hiddenSettings(state);
  const settingKeys = (Object.keys(SETTINGS) as SettingKey[]).filter(
    (k) => !hiddenKeys.includes(k),
  );
  // オンデマンドにしたときの CloudFront の無効化の見込み（今月の規模・OpenNext。D-66）。
  // 選んでいる行動を当てた draft から引く（同じ月に CDN の料金のプラン・ISR の部品を替えると、見込みもそれに合わせる。OCL-7EDA42D6）
  const showIsr = settingKeys.includes('isr');
  const draftKey = `${draft.stackIndex}:${JSON.stringify(draft.components)}`;
  const invalidation = useMemo(() => {
    if (!showIsr) return undefined;
    const e = onDemandInvalidationEstimate(draft);
    return e && invalidationNote(e);
    // draft は描画ごとに作り直すので、見込みに効く構成と部品の選択（draftKey）が変わったときだけ引き直す
  }, [state, showIsr, draftKey]);

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
              const acceptWhy = blocked(
                build({ answers: { ...answers, [id]: true } }),
              );
              const acceptOk = acceptWhy === null;
              return (
                <div
                  key={id}
                  className="rounded-box border border-base-300 p-3"
                >
                  <div className="mb-1 font-semibold">
                    {def.title} <Info>{def.text}</Info>
                  </div>
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
                        <span className="text-xs">（{acceptWhy}）</span>
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
          {settingKeys.map((key) => {
            const def = SETTINGS[key];
            const current = state.settings[def.field];
            const chosen = settings[key] ?? current;
            return (
              <label key={key} className="form-control">
                <span className="label-text mb-1 block">
                  <span className="block font-semibold">
                    <NameWithInfo
                      name={def.label}
                      info={<Info>{def.note}</Info>}
                    />
                  </span>
                  <Meta
                    items={[
                      // 時間 → オンデマンドだけ実装の手間がかかる（D-49）
                      key === 'isr'
                        ? `手間 ${def.effort}（オンデマンドへは ${EFFORT.onDemandSwitch}）`
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
                        {o.value === current ? '（今）' : ''}
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
                    オンデマンドでは {invalidation}
                  </span>
                )}
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
          <OptionText
            name="SSR を最適化する"
            meta={[
              `CPU ${nextSsrCpuMs(state)} → ${Math.max(EFFORT.minSsrCpuMs, nextSsrCpuMs(state) - EFFORT.optimizeStepMs)} ms`,
              `手間 ${EFFORT.optimize}`,
              '来月から',
            ]}
            info={
              <Info>
                CPU 時間と速さに効く。機能開発が進むと SSR
                はまた重くなるので、繰り返し判断が要る。
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
                <Info>
                  Bot・クローラーのアクセスが来月から半分になる。一度入れれば続く。対策の製品（WAF
                  など）の料金は取得していないので、手間だけの行動。
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
                info={<Info>{t.detail}</Info>}
                why={why}
              />
            </label>
          );
        })()}
        <ComponentsSection
          state={state}
          parts={parts}
          setParts={setParts}
          answers={answers}
          setAnswers={setAnswers}
          blocked={(o) => blocked(build(o))}
        />
        <div className="divider my-1 text-xs">構成を変える</div>
        {state.migration ? (
          <div className="text-sm">
            {stackName(state.migration.to, state.framework)} へ乗り換え中（
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
              const why = idx === null ? null : blocked(build({ stack: idx }));
              const ok = why === null;
              const text =
                idx === null
                  ? null
                  : stackChangeText(state.stackIndex, idx, state.framework);
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
                  {text ? (
                    <OptionText
                      name={text.name}
                      meta={text.meta}
                      info={<Info>{text.detail}</Info>}
                      why={why}
                    />
                  ) : (
                    <span>構成はこのまま</span>
                  )}
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
  answers,
  setAnswers,
  blocked,
}: {
  state: GameState;
  parts: Partial<Record<SlotId, string>>;
  setParts: (p: Partial<Record<SlotId, string>>) => void;
  /** 提案への返事（提案で付く部品は、部品の欄で選ぶと提案を受けたことになる）。 */
  answers: Record<string, boolean>;
  setAnswers: (a: Record<string, boolean>) => void;
  blocked: (o: {
    parts?: Partial<Record<SlotId, string>>;
    answers?: Record<string, boolean>;
  }) => string | null;
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
        <div className="grid gap-3 md:grid-cols-3">
          {slots.map((x) => {
            // 届いている提案で付く部品（チャットの Durable Objects など）。選ぶのは提案を受けるのと同じ
            const viaProposal = x.options.flatMap((o) => {
              const id = componentProposal(state, x.slot, o.id);
              return id ? [{ option: o.id, id }] : [];
            });
            const accepted = viaProposal.find((v) => answers[v.id]);
            const chosen = accepted?.option ?? parts[x.slot] ?? x.current;
            const opt = x.options.find((o) => o.id === chosen)!;
            const preview =
              chosen === x.current
                ? []
                : componentPreview(state, x.slot, chosen);
            return (
              <label key={x.slot} className="form-control">
                <span className="label-text mb-1 block">
                  <span className="block font-semibold">
                    {/* select の選択肢の中には置けないので、選択肢ごとの説明をまとめて出す */}
                    <NameWithInfo
                      name={x.label}
                      info={
                        <Info>
                          <ul className="space-y-1">
                            {x.options.map((o) => (
                              <li key={o.id}>
                                <span className="font-semibold">{o.label}</span>
                                : {o.note}
                                {x.slot === 'images' &&
                                  `（${pageWeightOf(state, o.id)}・画像込み）`}
                              </li>
                            ))}
                          </ul>
                          {x.slot === 'db' && (
                            <p className="mt-2 opacity-80">
                              DB
                              の差し替えはデータの移行があるので、手間を入れ終えた翌月に切り替わる。期間中は新旧両方の
                              DB の費用を払う。
                            </p>
                          )}
                        </Info>
                      }
                    />
                  </span>
                  <Meta items={componentEffortLabel(x.slot, state, chosen)} />
                </span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={chosen}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = { ...parts };
                    delete next[x.slot];
                    const nextAnswers = { ...answers };
                    for (const p of viaProposal)
                      nextAnswers[p.id] = p.option === v;
                    if (
                      v !== x.current &&
                      !viaProposal.some((p) => p.option === v)
                    )
                      next[x.slot] = v;
                    setParts(next);
                    if (viaProposal.length) setAnswers(nextAnswers);
                  }}
                >
                  {x.options.map((o) => {
                    const p = viaProposal.find((q) => q.option === o.id);
                    const restParts = { ...parts };
                    delete restParts[x.slot];
                    const why =
                      o.id === x.current
                        ? null
                        : p
                          ? blocked({
                              parts: restParts,
                              answers: { ...answers, [p.id]: true },
                            })
                          : blocked({
                              parts: { ...restParts, [x.slot]: o.id },
                            });
                    return (
                      <option key={o.id} value={o.id} disabled={why !== null}>
                        {o.label}
                        {o.id === x.current ? '（今）' : ''}
                        {p ? '（届いた提案を受ける）' : ''}
                        {why ? `（${why}）` : ''}
                      </option>
                    );
                  })}
                </select>
                {/* 選んだ部品の短い説明（フレーバー。「不適切」の印は出さない。D-45） */}
                <span className="mt-1 block text-xs opacity-70">
                  {componentFlavor(opt)}
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

/** 結果（prd/07 §9.6）: 合否・軸ごとの成績（基準プレイの目盛りつき）・振り返り。 */
function Result({
  state,
  onCelebrate,
}: {
  state: GameState;
  /** 目標達成のダイアログを開き直す（達成のときだけ使う）。 */
  onCelebrate: () => void;
}) {
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
  // 次のプレイへのヒント（未達成・ゲームオーバーのとき。達成なら空。D-40）
  const hints = retryHintsOf(state);
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
    // 達成は花火、未達成・ゲームオーバーは控えめにフェードインだけ（D-25。動きを減らす設定では出さない）
    <div className="card motion-fade-in bg-base-100 shadow">
      <div className="card-body gap-4">
        <div className={`alert ${won ? 'alert-success' : 'alert-error'}`}>
          {/* 中身を 1 つのブロックにする（alert の grid で横に割られて途中で折り返さないように） */}
          <div className="min-w-0">
            <div className="text-lg font-bold">{END_LABEL[end.reason]}</div>
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
          </div>
          {won && (
            // 帯の中の花火のアイコンのボタン（SVG。端末のフォントに依存しない）。帯の文字の色で描く
            <button
              className="btn btn-circle btn-sm ml-auto border-current bg-transparent text-current shadow-none hover:bg-black/10"
              onClick={onCelebrate}
              aria-label="もう一度祝う（達成のダイアログを開く）"
              title="もう一度祝う（達成のダイアログを開く）"
            >
              <FireworkIcon />
            </button>
          )}
        </div>
        {hints.length > 0 && (
          // 折りたたまずに出す。原因と対策の方向だけで、正解の構成名は出さない（D-40）
          <section
            className="rounded-box border-2 border-warning bg-warning/10 p-3 sm:p-4"
            aria-labelledby="retry-hints-title"
          >
            <h3 id="retry-hints-title" className="mb-2 font-bold">
              次のプレイへのヒント
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
                    .map((e) => `${eventBadge(e).label}: ${e.title}`)
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

/** 所持金の見込みの判定の印と文字（色だけに頼らない。D-42）。 */
const OUTLOOK = {
  ahead: { cls: 'badge-success', label: '● 届きそう' },
  close: { cls: 'badge-info', label: '◐ 目標の前後' },
  behind: { cls: 'badge-warning', label: '▲ 届かなそう' },
} as const;

/** 推移と見込み（prd/07 §5・GD-1）。毎月の画面の上に常に出し、続いている感じを見せる。 */
function Trends({
  history,
  scenario,
  ended,
}: {
  history: MonthReport[];
  scenario: Scenario;
  /** 終わったら見込みを出さない（途中のゲームオーバーで残りの月を伸ばさない）。 */
  ended: boolean;
}) {
  const last = history[history.length - 1]!;
  // 所持金の見込み（目安。直近 3 か月の月の利益の平均で線形に伸ばす。D-42）
  const cashProj = ended ? undefined : cashProjectionOf({ history, scenario });
  const prev = history[history.length - 2];
  const cost = (r: MonthReport) => r.infraCost;
  const trends = selectTrends(
    premiseTrends(
      history.map((m) => m.snapshots),
      scenario.months,
      projectionNote(last) ? { skipProjection: projectionNote(last)! } : {},
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
      <div className="card-body gap-4">
        <h2 className="card-title">これまでの推移</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-box bg-base-200 p-3">
              <div className="text-xs opacity-70">{t.label}</div>
              <div className="text-xl font-semibold tabular-nums">
                {/* 月が進むと前の月の値から数え上げる（D-25） */}
                <CountUp value={t.value} format={t.format} />
              </div>
              <div className="flex flex-wrap items-end justify-between">
                <span className="text-xs opacity-70">
                  {t.delta === null || !Number.isFinite(t.delta)
                    ? ''
                    : `前月比 ${pct(t.delta)}`}
                </span>
                <Sparkline values={t.series} months={scenario.months} />
              </div>
            </div>
          ))}
        </div>
        {cashProj && cashProj.projection.length > 0 && (
          <p className="text-sm">
            <span
              className={`badge badge-sm mr-1 ${OUTLOOK[cashProj.outlook].cls}`}
            >
              {OUTLOOK[cashProj.outlook].label}
            </span>
            <span className="whitespace-nowrap">このペースだと</span> <wbr />
            <span className="whitespace-nowrap">
              {`${scenario.months} か月目に約 ${usd(Math.round(cashProj.final))}`}
            </span>
            <wbr />
            <span className="whitespace-nowrap">
              {`（目標 ${usd(cashProj.goal)} の ${Math.round(cashProj.ratio * 100)}%）`}
            </span>{' '}
            <Info label="所持金の見込みの出し方">
              {cashProj.method === 'growth'
                ? `月の利益（収益 − 費用。乗り換え中の並行の費用・一度だけの手数料も含む、所持金の実際の増減）を、直近の月の利益の前月比（直近 3 つの比の中央値を 0.8〜1.2 倍に収めた値。今は ${cashProj.growth.toFixed(2)} 倍）で残りの月も伸ばして足したゲーム上の目安。来月の月の利益は約 ${usd(Math.round(cashProj.nextProfit))}。`
                : `月の利益（収益 − 費用。所持金の実際の増減）が 0 以下なので、伸びを入れず直近 3 か月の平均（約 ${usd(Math.round(cashProj.nextProfit))}）で残りの月を線形に伸ばしたゲーム上の目安。`}
              話題・前兆・Bot で一時的に流量が増えた月は、基準にも比にも使わない
              {cashProj.skipped > 0
                ? `（今回は ${cashProj.skipped} か月を除いた）`
                : ''}
              。予告済みの出来事・料金の改定は織り込まない。見込みが目標の ±5%
              なら「目標の前後」と出す
            </Info>
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <LineChart
            title={`所持金（目標 ${usd(scenario.goal.cash)}）`}
            months={scenario.months}
            format={(v) => `$${compact(Math.round(v))}`}
            reference={{ value: scenario.goal.cash, label: '目標' }}
            series={[
              {
                id: 'cash',
                label: '所持金',
                color: 'var(--series-1)',
                // 負の値は軸の下に出ないよう 0 で切る（表示だけ。負になった月にゲームは終わる）
                values: history.map((r) => Math.max(0, r.cash)),
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
              },
            ]}
          />
          <LineChart
            title={`満足度と評判（目標の平均 ${scenario.goal.satisfaction}）`}
            months={scenario.months}
            format={(v) => v.toFixed(2)}
            yMax={1}
            reference={{ value: scenario.goal.satisfaction, label: '目標' }}
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
