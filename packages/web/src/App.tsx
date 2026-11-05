// ゲームモードの画面（Phase 2〜4 の前倒しの試作）。ロジックは game パッケージ、ここは表示と操作だけ。
import { lazy, Suspense, useEffect, useState } from 'react';
import {
  setupCommitments,
  type CommitmentPaymentId,
  applyActions,
  frameworksOf,
  type FrameworkId,
  type RouteOverrides,
  newSave,
  parseSave,
  replaySave,
  validSetupChoices,
  setupComponentComparison,
  validRouteOverrides,
  routePlanRows,
  resolvedRouteStrategies,
  withTurn,
  playMonth,
  SCENARIOS,
  setupProblem,
  setupRevalidateOptions,
  setupRouteNotice,
  setupCommentOptions,
  COMMENTS_IN_BROWSER,
  partsOfComments,
  defaultRevalidateSec,
  frameworkOnStack,
  stackName,
  stackUnsupportedReason,
  FRAMEWORKS,
  type GameState,
  type SaveData,
} from 'game';
import { Info } from './info.tsx';
import {
  FrameworkField,
  ScenarioDescription,
  ScenarioPicker,
  SCENARIO_LIST,
} from './scenario-briefing.tsx';
import { OptionText } from './option-text.tsx';
import { commitmentMeta } from './commitment-meta.ts';
import {
  SetupCostPreview,
  SetupTabs,
  type SetupChoices,
} from './setup-components.tsx';
import { frameworkFallbackNotice, StackField } from './stack-field.tsx';
import { useRoutePlanEditor } from './route-plan-field.tsx';

const scrollTop = () => window.scrollTo({ top: 0 });
/** 今日の日付（YYYY-MM-DD・端末の現地時刻）。改定の出来事の条件に使う（D-21）。 */
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** 画面に出す為替の仮定（game の共通の仮定）。 */
const USD_JPY = 150;

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

/** 見積モードとゲームモードの切り替え（D-73）。見積モードは URL の mode=estimate で開く（入力もクエリに残る）。 */
type Mode = 'game' | 'estimate';
/** 見積モードは開いたときに読む（ゲームの画面の初回の読み込みに含めない）。 */
const EstimateMode = lazy(() =>
  import('./estimate/estimate-mode.tsx').then((m) => ({
    default: m.EstimateMode,
  })),
);
/** 運営中の画面も分けて読む（始める画面・見積の画面の初回の読み込みに含めない）。 */
const Game = lazy(() =>
  import('./game-screen.tsx').then((m) => ({ default: m.Game })),
);
const initialMode = (): Mode =>
  new URLSearchParams(window.location.search).get('mode') === 'estimate'
    ? 'estimate'
    : 'game';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  useEffect(() => storeSave(session?.save ?? null), [session?.save]);
  const state = session?.state ?? null;
  const [mode, setMode] = useState<Mode>(initialMode);
  const switchMode = (m: Mode) => {
    // ゲームに戻るときは見積の入力を URL から外す（見積の入力は見積の画面が書く）
    if (m === 'game')
      window.history.replaceState(null, '', window.location.pathname);
    setMode(m);
  };
  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar flex-wrap gap-y-1 bg-base-100 shadow-sm">
        <span className="px-4 text-lg font-bold">infra-supra（仮称）</span>
        <span className="text-sm opacity-60">
          Web アプリのインフラ運営シミュレーション（試作）
        </span>
        <div role="tablist" className="tabs tabs-box tabs-sm mx-2">
          {(
            [
              ['game', 'ゲーム'],
              ['estimate', '見積'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`tab ${mode === m ? 'tab-active' : ''}`}
              onClick={() => switchMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'game' && state && (
          <button
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => setSession(null)}
          >
            最初から
          </button>
        )}
      </div>
      <main className="mx-auto max-w-5xl space-y-4 p-2 sm:p-4">
        <Suspense fallback={<Loading />}>
          {mode === 'estimate' ? (
            <EstimateMode />
          ) : state ? (
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
        </Suspense>
      </main>
    </div>
  );
}

/** 分けて読む画面の読み込み中の表示。 */
function Loading() {
  return (
    <p className="p-8 text-center text-sm opacity-60" role="status">
      読み込み中…
    </p>
  );
}

function Briefing({ onStart }: { onStart: (s: SaveData) => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIO_LIST[0]!.id);
  const scenario = SCENARIOS[scenarioId]!;
  const frameworks = frameworksOf(scenario);
  // 既定は一覧の 1 番目（正解になりやすい構成を既定にしない。D-41）
  const [stack, setStack] = useState(0);
  const [frameworkChoice, setFramework] = useState<FrameworkId>(
    frameworks.default,
  );
  // シナリオを替えたときに選べないフレームワークなら既定にする（構成に載せられなければ載せられるもの。D-113）
  const framework = frameworkOnStack(
    scenario,
    stack,
    frameworks.allowed.includes(frameworkChoice)
      ? frameworkChoice
      : frameworks.default,
  );
  const [seed, setSeed] = useState(42);
  const [startDate, setStartDate] = useState(today);
  // 部品は既定なしで、スロットごとに選ぶ（D-45）。構成・フレームワーク・シナリオを替えたら、選べなくなった選択を
  // 状態からも外す（元の組み合わせに戻しても復活しない。OCL-09D12A43）。構成ごとの記憶は partsByStack
  const [parts, setParts] = useState<SetupChoices>({});
  // 他の構成で選んでいた部品（構成の index → 選択）。構成を替えるときに覚え、戻ったら戻す。計算・始めるのに使うのは今の構成の
  // parts だけ。ページを開いている間だけ持つ（D-116 の補足）
  const [partsByStack, setPartsByStack] = useState<
    Record<number, SetupChoices>
  >({});
  // ページごとの描き方（D-107）。フレームワークを替えると既定に戻す。構成で使えないものは validRouteOverrides で外す
  const [routeChoice, setRouteChoice] = useState<RouteOverrides>({});
  const routes = validRouteOverrides(scenario, stack, framework, routeChoice);
  // 構成を替えて、載せられるフレームワークに戻したときの知らせ（D-113）
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  // インフラの構成を先に選ぶ（D-113）。構成は替えず、載せられないフレームワーク（Astro × AWS など。D-68）を選んでいたら、
  // シナリオの並びで最初の載せられるフレームワークに戻して知らせる（フレームワークの欄では載せられないものは選べない）
  const change = (next: {
    scenarioId?: string;
    stack?: number;
    framework?: FrameworkId;
  }) => {
    const sc = SCENARIOS[next.scenarioId ?? scenarioId]!;
    const fws = frameworksOf(sc);
    const fwChoice = next.framework ?? frameworkChoice;
    const want = fws.allowed.includes(fwChoice) ? fwChoice : fws.default;
    const st = next.stack ?? stack;
    const fw = frameworkOnStack(sc, st, want);
    setFallbackNotice(
      fw === want
        ? null
        : frameworkFallbackNotice(st, want, fw, Object.keys(routes).length > 0),
    );
    if (next.scenarioId !== undefined) setScenarioId(next.scenarioId);
    if (fw !== frameworkChoice) setFramework(fw);
    if (fw !== framework || next.scenarioId !== undefined) setRouteChoice({});
    if (st !== stack) setStack(st);
    // 今の構成の選択も覚えてから、どの構成の記憶も今のシナリオ・フレームワークで選べるものだけにする（その構成に
    // 載せられないフレームワークなら、選んだときに付け替わる先で見る）
    const kept: Record<number, SetupChoices> = {};
    for (const [k, v] of Object.entries({ ...partsByStack, [stack]: parts })) {
      const i = Number(k);
      kept[i] = validSetupChoices(sc, i, frameworkOnStack(sc, i, fw), v);
    }
    setParts(kept[st] ?? {});
    delete kept[st];
    setPartsByStack(kept);
  };
  const problem = setupProblem(scenario, stack, framework, parts);
  // ISR の再検証（D-49）・Astro の記事のキャッシュ（D-103）など。② のカードの記事のページの行で選ぶ（D-119）。選ぶまでは、
  // フレームワークと構成の既定（Astro は消せる置き場ならオンデマンド、それ以外は 5 分）
  const [revalidateChosen, setRevalidateSec] = useState<number | undefined>(
    undefined,
  );
  const revalidateSec =
    revalidateChosen !== undefined &&
    setupRevalidateOptions(scenario, framework, routes).some(
      (o) => o.value === revalidateChosen,
    )
      ? revalidateChosen
      : defaultRevalidateSec(framework, stack, scenario, routes);
  const revalidateChoosable =
    setupRevalidateOptions(scenario, framework, routes).length > 0;
  // 記事のページのコメント欄（D-82。フレームワークのカードの記事のページの欄で選ぶページの部品。D-109・D-112。記事のページがあり、コメントのあるシナリオだけ。
  // 既定はブラウザで読み込む）
  const [comments, setComments] = useState(COMMENTS_IN_BROWSER);
  const commentsChoosable =
    setupCommentOptions(scenario, framework, routes).length > 0;
  // 構成・フレームワークを替えると既定に戻る描き方（カードに添える。D-107 の補足）
  const routeNotice = (next: {
    stackIndex?: number;
    framework?: FrameworkId;
  }) =>
    setupRouteNotice(
      scenario,
      {
        stackIndex: stack,
        framework,
        components: parts,
        revalidateSec,
        revalidateChosen,
        routes,
      },
      next,
    );
  // ページごとの描き方の行・要件の判定・選んだときの書き換え（フレームワークのカードで選ぶ。D-107・D-112）
  const routeEditor = useRoutePlanEditor({
    scenario,
    stackIndex: stack,
    framework,
    components: parts,
    revalidateSec,
    comments,
    routes,
    onChange: (r, v) => {
      setRouteChoice(r);
      if (v !== undefined) setRevalidateSec(v);
    },
    onCommentsChange: setComments,
  });
  // 始めから結ぶ確約（台数の予約・年払いで、前払いが始めの所持金に収まるものだけ。D-97）
  const [commits, setCommits] = useState<Record<string, CommitmentPaymentId>>(
    {},
  );
  const commitOptions = problem
    ? []
    : setupCommitments(scenario, stack, framework, parts);
  const chosenCommits = commitOptions
    .filter((o) => commits[o.key] === o.payment)
    .map((o) => ({ key: o.key, payment: o.payment }));
  return (
    <>
      <ScenarioPicker
        value={scenarioId}
        onChange={(id) => change({ scenarioId: id })}
      />
      <ScenarioDescription scenario={scenario} usdJpy={USD_JPY} />
      <div className="card bg-base-100 shadow">
        <div className="card-body px-3 sm:px-6">
          <h2 className="card-title">どの構成で始めますか？</h2>
          {/* ① インフラの構成と ② フレームワークと描き方はタブで切り替える（どちらから選んでもよい。D-116 の補足）。
              タブの見出しにそれぞれの今の選択と注意（未選択の部品・付け替えの知らせ）を出す */}
          <div className="mt-2">
            <SetupTabs
              storageKey="infra-supra:setup-tab:game"
              stack={{
                label: '① インフラの構成',
                summary: stackName(stack, framework, false, parts),
                warn: problem,
                panel: (
                  <StackField
                    scenario={scenario}
                    framework={framework}
                    value={stack}
                    onChange={(i) => change({ stack: i })}
                    components={parts}
                    // 選んでいないカードの題・図・手間の棒は、前にその構成で選んだ部品で描く（D-116 の補足）
                    rememberedOf={(i) => partsByStack[i]}
                    comments={commentsChoosable ? comments : undefined}
                    routes={routes}
                    routeNotice={(i) => routeNotice({ stackIndex: i })}
                    // 部品は構成のカードの構成図の箱か、機能ごとのチップで選ぶ（タブで切り替える。D-116 とその補足）。選んだ直後も依存の崩れた選択（VPS の API のキャッシュなど）を外して持つ
                    onComponentsChange={(v) =>
                      setParts(validSetupChoices(scenario, stack, framework, v))
                    }
                    partsNote="構成の中の役割ごとに選ぶ（始める前なので手間はかからない）"
                    // 部品の ⓘ の比較: 1 か月目の見込みと同じ条件で、そのスロットだけ替えた月の費用（D-124）
                    partsCompare={(slot) => ({
                      rows: setupComponentComparison(
                        scenario,
                        stack,
                        framework,
                        parts,
                        slot,
                        {
                          revalidateSec: revalidateChoosable
                            ? revalidateSec
                            : undefined,
                          comments: commentsChoosable ? comments : undefined,
                          routes,
                        },
                      ),
                      basis:
                        '1 か月目の基準の規模（始める画面の 1 か月目の見込みと同じ条件）で、このスロットだけを替えた月の費用（構成全体）。未選択のスロットは既定の部品で数える。出来事・話題の上乗せは含めない目安。縦の線は選んでいる部品の額',
                    })}
                  />
                ),
              }}
              // ② フレームワークと描き方（構成と同列の判断。D-35）。選んでいる構成に載せられないものは選べない（D-113）
              framework={{
                label: '② フレームワークと描き方',
                summary: FRAMEWORKS[framework].label,
                warn: fallbackNotice,
                live: fallbackNotice,
                panel: (
                  <FrameworkField
                    scenario={scenario}
                    allowed={frameworks.allowed}
                    value={framework}
                    onChange={(id) => change({ framework: id })}
                    // 見取り図のコメント欄はコメントの描き方で変わる（D-82・D-102）
                    comments={commentsChoosable ? comments : undefined}
                    // 既定のページごとの描き方（D-106）: 選んでいる構成で、各フレームワークの既定から
                    routePlan={(id) =>
                      routePlanRows(scenario, {
                        framework: id,
                        stackIndex: stack,
                        settings: {
                          revalidateSec: defaultRevalidateSec(
                            id,
                            stack,
                            scenario,
                          ),
                        },
                        components: validSetupChoices(
                          scenario,
                          stack,
                          id,
                          parts,
                        ),
                        routeParts: partsOfComments(scenario, comments),
                      })
                    }
                    routes={routes}
                    // 見取り図は表・計算と同じ実際の描き方で描く（選んでいるカードは選んだ描き方、ほかは既定。OCL-CD192A98）
                    resolvedRoutes={(id, selected) =>
                      resolvedRouteStrategies(scenario, {
                        framework: id,
                        stackIndex: stack,
                        components: validSetupChoices(
                          scenario,
                          stack,
                          id,
                          parts,
                        ),
                        ...(selected ? { routes } : {}),
                      })
                    }
                    routeNotice={(id) => routeNotice({ framework: id })}
                    // ページの描き方（D-107）は、カードのページの欄のチップで選ぶ（表は「詳しく比べる」。D-112）。
                    // 再検証の間隔などの描き方の設定も、記事のページの行で選ぶ（D-119）
                    editor={routeEditor}
                    unsupported={(id) => stackUnsupportedReason(stack, id)}
                    notice={fallbackNotice}
                  />
                ),
              }}
            />
          </div>
          {commitOptions.length > 0 && (
            <div className="mt-2">
              <h3 className="font-bold">長期の確約（1 年）</h3>
              <p className="text-xs opacity-70">
                安くなる代わりに取り消せない。乗り換え・部品の切り替えで使わなくなっても支払いは残る。前払いのある形（さくらの年額・全額前払い）は始めの所持金を超えるので、運営の途中から選べる
              </p>
              {commitOptions.map((o) => (
                <label
                  key={`${o.key}:${o.payment}`}
                  className="flex cursor-pointer items-start gap-3 py-1"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-1"
                    checked={commits[o.key] === o.payment}
                    onChange={(e) => {
                      const v = { ...commits };
                      if (e.target.checked) v[o.key] = o.payment;
                      else delete v[o.key];
                      setCommits(v);
                    }}
                  />
                  <OptionText
                    name={`${o.label}を結ぶ`}
                    meta={[...commitmentMeta(o), '1 か月目から']}
                    info={<Info>{o.premise}</Info>}
                    why={null}
                  />
                </label>
              ))}
            </div>
          )}
          {problem ? (
            <p className="text-right text-sm" role="status">
              {problem}
            </p>
          ) : (
            // すべて選んだら 1 か月目の費用の見込み（D-72）
            <SetupCostPreview
              scenario={scenario}
              stackIndex={stack}
              framework={framework}
              components={parts}
              revalidateSec={revalidateChoosable ? revalidateSec : undefined}
              comments={commentsChoosable ? comments : undefined}
              routes={routes}
            />
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
                    ...(revalidateChoosable ? { revalidateSec } : {}),
                    ...(commentsChoosable && partsOfComments(scenario, comments)
                      ? { routeParts: partsOfComments(scenario, comments)! }
                      : {}),
                    ...(Object.keys(routes).length
                      ? { routes: { ...routes } }
                      : {}),
                    ...(chosenCommits.length
                      ? { commitments: chosenCommits }
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
