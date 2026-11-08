// ゲームモードの画面（Phase 2〜4 の前倒しの試作）。ロジックは game パッケージ、ここは表示と操作だけ。
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  setupCommitments,
  type CommitmentPaymentId,
  applyActions,
  frameworksOf,
  type FrameworkId,
  type RouteOverrides,
  newSave,
  parseSave,
  previousSave,
  replaySave,
  rewindSave,
  withoutPrevious,
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
  type SetupTabsApi,
  type SetupChoices,
} from './setup-components.tsx';
import { frameworkFallbackNotice, StackField } from './stack-field.tsx';
import { MissingParts } from './missing-parts.tsx';
import { useRoutePlanEditor } from './route-plan-field.tsx';
import {
  LAST_SETUP_KEY,
  lastSetupLabel,
  lastSetupOf,
  parseLastSetups,
  restoreLastSetup,
  sameAsRestored,
  withLastSetup,
  type LastSetup,
  type LastSetupStore,
  type SetupState,
} from './last-setup.ts';
import {
  mergeResults,
  parseResults,
  playId,
  RESULTS_KEY,
  resultEntryOf,
  withResult,
  type ResultEntry,
  type ResultStore,
} from './results-history.ts';

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

/**
 * runId: 遊び始め（始めた・再開した・過去の月に戻った）ごとの id。出来事のダイアログを月ごとに 1 回だけ自動で開く（D-126）。
 * 保存には入れない。previous: 保存の前の試行（D-128）を再生した状態（推移のグラフに重ねる）。
 */
type Session = {
  save: SaveData;
  state: GameState;
  previous: GameState | null;
  restored: boolean;
  runId: string;
  /**
   * 再開の知らせをまだ出していない（保存から再開したときだけ true）。出したら false にし、見積の画面から戻って
   * 運営中の画面を作り直しても出し直さない。
   */
  resumeNotice?: boolean;
};
const newRunId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** 保存から再開する。読めない・版が違う・再生で例外が出たら、黙って捨てて初期画面にする。 */
function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = parseSave(JSON.parse(raw));
    if (!parsed) throw new Error('読めない保存');
    const state = replaySave(parsed);
    // 前の試行が再生できなければ、前の試行だけを捨てる（今の試行は続けられる。D-128）
    let save = parsed;
    let previous: GameState | null = null;
    const prev = previousSave(parsed);
    if (prev) {
      try {
        previous = replaySave(prev);
      } catch {
        save = withoutPrevious(parsed);
      }
    }
    return {
      save,
      state,
      previous,
      restored: true,
      runId: newRunId(),
      resumeNotice: true,
    };
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

/** 前回の構成（D-127）を読む。使えない・壊れていれば空（ボタンを出さない）。 */
function loadLastSetups(): LastSetupStore {
  try {
    const raw = localStorage.getItem(LAST_SETUP_KEY);
    return parseLastSetups(raw ? JSON.parse(raw) : null);
  } catch {
    return parseLastSetups(null);
  }
}

/** 「運営を始める」を押したときの選択を、そのシナリオの前回として書く。書けなくても始められる。 */
function storeLastSetup(scenarioId: string, entry: LastSetup) {
  try {
    localStorage.setItem(
      LAST_SETUP_KEY,
      JSON.stringify(withLastSetup(loadLastSetups(), scenarioId, entry)),
    );
  } catch {
    // 保存領域が使えない環境では何もしない（次はボタンが出ないだけ）
  }
}

/** 手元の結果の履歴（D-144）を読む。使えない・壊れていれば空。 */
function loadResults(): ResultStore {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    return parseResults(raw ? JSON.parse(raw) : null);
  } catch {
    return parseResults(null);
  }
}

/**
 * 終わったプレイの 1 件を、保存済みの履歴に足して書く（同じプレイは二重に足さない）。書いた後の履歴を返す。
 * 書く直前に保存済みの履歴を読み直すので、別のタブが足した結果を消さない（OCL-E9D5918D）。
 * 書けない環境では undefined（画面の比較はこの画面が持つ履歴で行う）。
 */
function persistResult(entry: ResultEntry): ResultStore | undefined {
  try {
    const next = withResult(loadResults(), entry);
    localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return undefined;
  }
}

/**
 * persistResult を、タブをまたいで 1 つずつ行う（Web Locks API。同じオリジンのタブが同じ名前の鍵を待つ）。
 * 読み直しから書き込みまでを鍵の中で行うので、2 つのタブが同時に終えても互いの結果を消さない（OCL-E9D5918D）。
 * Web Locks の無い環境（古いブラウザ・テストの jsdom）では鍵なしでその場で書く。
 */
function persistResultLocked(
  entry: ResultEntry,
  done: (stored: ResultStore) => void,
) {
  const run = () => {
    const stored = persistResult(entry);
    if (stored) done(stored);
  };
  const locks = (navigator as Partial<Navigator>).locks;
  if (!locks) {
    run();
    return;
  }
  locks.request(RESULTS_KEY, run).catch(() => run());
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
  // 終わったプレイ（完走・途中終了）を手元の履歴に溜める（D-144。再開・戻ってもう一度終えたときも同じ id なら足さない）
  const [results, setResults] = useState<ResultStore>(loadResults);
  useEffect(() => {
    if (!session || session.state.phase === 'playing') return;
    const entry = resultEntryOf(session.save, session.state, today());
    if (results.entries.some((e) => e.id === entry.id)) return;
    // 画面の比較にはすぐ使い、保存は鍵を取ってから（保存した後の履歴と合わせる）
    setResults((r) => withResult(r, entry));
    persistResultLocked(entry, (stored) =>
      setResults((r) => mergeResults(stored, r)),
    );
  }, [session, results]);
  const [mode, setMode] = useState<Mode>(initialMode);
  // 「最初から」の確認のダイアログ（今のプレイが消えるので確かめる）
  const [confirmRestart, setConfirmRestart] = useState(false);
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
            onClick={() => setConfirmRestart(true)}
          >
            最初から
          </button>
        )}
      </div>
      {confirmRestart && (
        <RestartDialog
          onConfirm={() => {
            setConfirmRestart(false);
            setSession(null);
          }}
          onClose={() => setConfirmRestart(false)}
        />
      )}
      <main className="mx-auto max-w-5xl space-y-4 p-2 sm:p-4">
        <Suspense fallback={<Loading />}>
          {mode === 'estimate' ? (
            <EstimateMode />
          ) : state ? (
            <Game
              // 新しく始めたとき・再開したときは作り直す（ダイアログの状態を引き継がない）
              key={session!.runId}
              state={state}
              restored={session!.restored}
              resumeNotice={session!.resumeNotice ?? false}
              onResumeNoticeShown={() =>
                setSession((s) => (s ? { ...s, resumeNotice: false } : s))
              }
              runId={session!.runId}
              results={results.entries}
              playId={playId(session!.save)}
              onAdvance={(actions) => {
                const next = playMonth(applyActions(state, actions));
                setSession({
                  ...session!,
                  save: withTurn(session!.save, actions),
                  state: next,
                });
                return next;
              }}
              previous={session!.previous}
              onRewind={(month) => {
                // 戻る直前の今の試行を前の試行にする（D-128）。戻った状態は保存の再生と同じ（決定論）。
                // 遊び始めの id を替えて画面を作り直す（戻った月の出来事のダイアログも開き直す）
                const save = rewindSave(session!.save, month);
                setSession({
                  save,
                  state: replaySave(save),
                  previous: state,
                  restored: false,
                  runId: newRunId(),
                });
                scrollTop();
              }}
              onClearPrevious={() =>
                setSession({
                  ...session!,
                  save: withoutPrevious(session!.save),
                  previous: null,
                })
              }
            />
          ) : (
            <Briefing
              onStart={(save) =>
                setSession({
                  save,
                  state: replaySave(save),
                  previous: null,
                  restored: false,
                  runId: newRunId(),
                })
              }
            />
          )}
        </Suspense>
      </main>
    </div>
  );
}

/** 「最初から」の確認（daisyUI の modal）。やり直すと保存したプレイを消して始める画面に戻る。 */
function RestartDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="restart-dialog-title"
      onClose={onClose}
    >
      <div className="modal-box max-w-md">
        <h2 id="restart-dialog-title" className="text-lg font-bold">
          最初からやり直しますか？
        </h2>
        <p className="mt-2 text-sm">
          今のプレイは消えます（前の試行も消えます）。始める画面に戻ります。
        </p>
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-ghost btn-sm">やめる</button>
          </form>
          <button className="btn btn-error btn-sm" onClick={onConfirm}>
            やり直す
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
    setRestoreNotice(null);
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
  // フレームワーク・構成・部品の既定（今の部品でオンデマンドが選べればオンデマンド、選べなければ 5 分。D-125）。部品を替えると
  // 既定も付け替わる（選んだ値は替えない）
  const [revalidateChosen, setRevalidateSec] = useState<number | undefined>(
    undefined,
  );
  const revalidateSec =
    revalidateChosen !== undefined &&
    setupRevalidateOptions(scenario, framework, routes).some(
      (o) => o.value === revalidateChosen,
    )
      ? revalidateChosen
      : defaultRevalidateSec(framework, stack, scenario, routes, parts);
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
  // 部品の ⓘ の比較: 1 か月目の見込みと同じ条件で、そのスロットだけ替えた月の費用（D-124）。① と「残りを選ぶ」のダイアログで共用
  const partsCompare = (slot: string) => ({
    rows: setupComponentComparison(scenario, stack, framework, parts, slot, {
      revalidateSec: revalidateChoosable ? revalidateSec : undefined,
      comments: commentsChoosable ? comments : undefined,
      routes,
    }),
    basis:
      '1 か月目の基準の規模（始める画面の 1 か月目の見込みと同じ条件）で、このスロットだけを替えた月の費用（構成全体）。未選択のスロットは既定の部品で数えます。出来事・話題の上乗せは含めない目安です。縦の線は選んでいる部品の額です',
  });
  // 部品を選び残したときの手段（D-125）: ① のタブを開いてスロットへ移る口と、埋め終えたら移る「運営を始める」
  const tabsApi = useRef<SetupTabsApi>(null);
  const startButton = useRef<HTMLButtonElement>(null);
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
  // 前回の構成（D-127）: 「運営を始める」を押したときの選択をシナリオごとに覚え、まとめて戻す（ゲームモードだけ）
  const [lastSetups] = useState(loadLastSetups);
  const last = lastSetups.scenarios[scenarioId];
  // 戻せなかったものの知らせ（構成・フレームワーク・シナリオを替えると消す）
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const current: SetupState = {
    stack,
    framework,
    components: parts,
    routes,
    revalidateSec: revalidateChosen,
    comments,
    commitments: commits,
  };
  const restored = last ? restoreLastSetup(scenario, last, current) : null;
  const restoreLast = () => {
    if (!restored) return;
    // 他の構成の記憶は change と同じく、戻したフレームワークで選べるものだけにする
    const kept: Record<number, SetupChoices> = {};
    for (const [k, v] of Object.entries({ ...partsByStack, [stack]: parts })) {
      const i = Number(k);
      if (i === restored.stack) continue;
      kept[i] = validSetupChoices(
        scenario,
        i,
        frameworkOnStack(scenario, i, restored.framework),
        v,
      );
    }
    setPartsByStack(kept);
    setStack(restored.stack);
    setFramework(restored.framework);
    setParts(restored.components);
    setRouteChoice(restored.routes);
    setRevalidateSec(restored.revalidateSec);
    setComments(restored.comments);
    setCommits(restored.commitments);
    setFallbackNotice(null);
    setRestoreNotice(restored.notice);
  };
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
          {last && restored && (
            <LastSetupButton
              label={lastSetupLabel(last)}
              same={sameAsRestored(scenario, current, restored)}
              notice={restoreNotice}
              onClick={restoreLast}
            />
          )}
          <div className="mt-2">
            <SetupTabs
              api={tabsApi}
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
                    partsNote="構成の中の役割ごとに選びます（始める前なので手間はかかりません）"
                    // 部品の ⓘ の比較: 1 か月目の見込みと同じ条件で、そのスロットだけ替えた月の費用（D-124）
                    partsCompare={partsCompare}
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
                            undefined,
                            validSetupChoices(scenario, stack, id, parts),
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
                安くなる代わりに取り消せません。乗り換え・部品の切り替えで使わなくなっても支払いは残ります。前払いのある形（さくらの年額・全額前払い）は始めの所持金を超えるので、運営の途中から選べます
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
                    info={<Info title={`${o.label}を結ぶ`}>{o.premise}</Info>}
                    why={null}
                  />
                </label>
              ))}
            </div>
          )}
          {/* 部品を選び残していれば、その名前（押すと ① のそのスロットへ）・残りを選ぶダイアログ・残りを既定にする（D-125） */}
          <MissingParts
            scenario={scenario}
            stackIndex={stack}
            framework={framework}
            value={parts}
            onChange={(v) =>
              setParts(validSetupChoices(scenario, stack, framework, v))
            }
            compare={partsCompare}
            onJump={(slot) => tabsApi.current?.focusSlot(slot)}
            onComplete={() => startButton.current?.focus()}
          />
          {!problem && (
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
              title="この日より後に施行される、実際に予告されている料金・制限の改定だけが出来事として出ます"
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
              ref={startButton}
              className="btn btn-primary"
              disabled={problem !== null}
              title={problem ?? undefined}
              onClick={() => {
                storeLastSetup(scenario.id, lastSetupOf(scenario, current));
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

/** 「前回の構成を選ぶ」（D-127）。前回の構成とフレームワークを添え、今の選択が前回と同じなら押せなくする。 */
function LastSetupButton({
  label,
  same,
  notice,
  onClick,
}: {
  label: string;
  same: boolean;
  notice: string | null;
  onClick: () => void;
}) {
  return (
    <div className="mt-1" data-last-setup>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-outline h-auto min-h-8 max-w-full py-1 text-left font-normal whitespace-normal"
          disabled={same}
          onClick={onClick}
        >
          前回の構成を選ぶ（{label}）
        </button>
        {same && <span className="text-xs opacity-60">前回と同じ</span>}
      </div>
      {notice && (
        <p
          className="alert alert-warning alert-soft mt-1 py-2 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
