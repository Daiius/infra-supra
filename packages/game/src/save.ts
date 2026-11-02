// 遊んでいる途中の保存（D-26・prd/02 §5）。GameState そのものは保存せず、始めたときの選択と月ごとの行動の列だけを持つ。
// ゲームは決定論なので、同じ選択と行動を同じ順に再生すれば同じ状態に戻る。ここは純粋関数だけ（保存・読み込みの I/O は web）。
import {
  applyActions,
  newGame,
  playMonth,
  SCENARIOS,
  type Action,
  type CommitmentPaymentId,
  type GameState,
} from './index.ts';
import {
  ROUTE_STRATEGIES,
  type Choices,
  type FrameworkId,
  type RouteStrategyId,
} from 'catalog';

const FRAMEWORK_IDS: readonly FrameworkId[] = [
  'nextjs',
  'vite-spa',
  'astro',
  'nextjs-export',
];

/**
 * 保存の版。2 でページごとの描き方（routes。D-107）を足した。1 の保存も読み、描き方はフレームワークの既定
 * （今の routeChoices で決まるもの。描き方を選べるようになる前の結果と同じ）として再生する。
 */
export const SAVE_VERSION = 2;

/** 読める古い版。 */
const READABLE_VERSIONS: readonly number[] = [1, 2];

export type SaveData = {
  version: typeof SAVE_VERSION;
  scenarioId: string;
  stackIndex: number;
  /**
   * アプリのフレームワーク（prd/10 F-04）。フレームワークを選べるようになる前の保存には無く、
   * そのときは Next.js として読む（版は上げない。prd/10 B-9）。
   */
  framework: FrameworkId;
  seed: number;
  /** 始めた日（YYYY-MM-DD）。改定の出来事の条件（D-21）。 */
  startDate: string;
  /**
   * 始める画面で選んだ部品（D-45）。部品を選べるようになる前の保存には無く、そのときは今の既定の部品で読む（版は上げない）。
   */
  components?: Choices;
  /** 始める画面で選んだ ISR の再検証（D-49。秒・オンデマンドは 0）。無い保存は今の既定（5 分）で読む。 */
  revalidateSec?: number;
  /** 始める画面で選んだコメントの描き方（D-82。0 ブラウザ・1 記事のページ）。無い保存は既定（ブラウザで読み込む）で読む。 */
  comments?: number;
  /** 始める画面で結んだ確約（D-97）。無い保存は確約なしで読む（版は上げない）。 */
  commitments?: { key: string; payment: CommitmentPaymentId }[];
  /** 始める画面で選んだページごとの描き方（版 2・D-107）。無い保存はフレームワークの既定で読む。 */
  routes?: Partial<Record<string, RouteStrategyId>>;
  /** 月ごとの行動（添字 0 が 1 か月目の終わりに選んだ行動）。 */
  turns: Action[][];
};

/** 始めたときの保存（まだ行動なし）。 */
export function newSave(
  input: Omit<SaveData, 'version' | 'turns' | 'framework'> & {
    framework?: FrameworkId;
  },
): SaveData {
  return {
    version: SAVE_VERSION,
    ...input,
    framework: input.framework ?? 'nextjs',
    turns: [],
  };
}

/** 月の終わりの行動を足した保存。 */
export function withTurn(save: SaveData, actions: readonly Action[]): SaveData {
  return { ...save, turns: [...save.turns, [...actions]] };
}

/**
 * 古い保存の行動を今の形に直す（版は上げない）。設定「画像の圧縮」（compress: 150 / 100 / 70 KB）は「画像の形式」（format）に
 * 置き換えた（D-58）ので、近い大きさの形式に読み替える: 150 → JPEG・100 → WebP（105）・70 → AVIF（84）。
 */
function migrateAction(a: Action): Action {
  const old = a as { type: string; key?: string; value?: number };
  if (old.type !== 'set' || old.key !== 'compress') return a;
  const v = old.value ?? 150;
  return {
    type: 'set',
    key: 'format',
    value: v >= 150 ? 150 : v >= 100 ? 105 : 84,
  };
}

/**
 * その時点の状態に合わせて古い行動を読み替える（D-103。版は上げない）。Astro の記事は「ビルドの間隔」（buildInterval）を
 * 「記事のキャッシュ」（pageCache）に替えた。値は同じ revalidateSec なので、その時点のフレームワークが Astro の
 * buildInterval だけを pageCache に読み替える（途中で作り直した保存は、行動のときのフレームワークで判断する。
 * Next.js の静的書き出しの buildInterval はそのまま）。
 */
export function migrateActionFor(
  state: Pick<GameState, 'framework'>,
  a: Action,
): Action {
  if (
    a.type === 'set' &&
    a.key === 'buildInterval' &&
    state.framework === 'astro'
  )
    return { ...a, key: 'pageCache' };
  return a;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * 保存の形を確かめる（読めない・版が違うなら null）。行動の中身は再生のときに確かめる
 * （選べない行動は applyAction が状態を変えずに返すので、再生の結果の月数で食い違いを見つける）。
 */
export function parseSave(raw: unknown): SaveData | null {
  if (
    !isObject(raw) ||
    typeof raw.version !== 'number' ||
    !READABLE_VERSIONS.includes(raw.version)
  )
    return null;
  const routes = raw.routes;
  if (
    routes !== undefined &&
    !(
      isObject(routes) &&
      Object.values(routes).every(
        (v) => typeof v === 'string' && v in ROUTE_STRATEGIES,
      )
    )
  )
    return null;
  const { scenarioId, stackIndex, seed, startDate, turns } = raw;
  const framework = raw.framework ?? 'nextjs';
  const components = raw.components;
  const revalidateSec = raw.revalidateSec;
  const comments = raw.comments;
  const commitments = raw.commitments;
  if (
    commitments !== undefined &&
    !(
      Array.isArray(commitments) &&
      commitments.every(
        (c) =>
          isObject(c) &&
          typeof c.key === 'string' &&
          (c.payment === 'no-upfront' || c.payment === 'all-upfront'),
      )
    )
  )
    return null;
  const badNum = (v: unknown) =>
    v !== undefined && !(typeof v === 'number' && Number.isFinite(v));
  if (badNum(revalidateSec) || badNum(comments)) return null;
  if (
    components !== undefined &&
    !(
      isObject(components) &&
      Object.values(components).every((v) => typeof v === 'string')
    )
  )
    return null;
  if (
    !FRAMEWORK_IDS.includes(framework as FrameworkId) ||
    typeof scenarioId !== 'string' ||
    !(scenarioId in SCENARIOS) ||
    !Number.isInteger(stackIndex) ||
    typeof seed !== 'number' ||
    !Number.isFinite(seed) ||
    typeof startDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !Array.isArray(turns) ||
    !turns.every(
      (t) =>
        Array.isArray(t) &&
        t.every((a) => isObject(a) && typeof a.type === 'string'),
    )
  )
    return null;
  return {
    version: SAVE_VERSION,
    scenarioId,
    stackIndex: stackIndex as number,
    framework: framework as FrameworkId,
    seed,
    startDate,
    ...(components ? { components: components as Choices } : {}),
    ...(revalidateSec !== undefined
      ? { revalidateSec: revalidateSec as number }
      : {}),
    ...(comments !== undefined ? { comments: comments as number } : {}),
    ...(commitments !== undefined
      ? {
          commitments: commitments as NonNullable<SaveData['commitments']>,
        }
      : {}),
    ...(routes !== undefined
      ? { routes: routes as NonNullable<SaveData['routes']> }
      : {}),
    turns: (turns as Action[][]).map((t) => t.map(migrateAction)),
  };
}

/**
 * 保存から状態を再生する。始めた月を進め、各月の終わりに保存した行動を当てて次の月へ進める（画面の操作と同じ順）。
 * 再生した月数が保存と合わない（途中で終わった・構成が無い）ときは例外。
 */
export function replaySave(save: SaveData): GameState {
  const scenario = SCENARIOS[save.scenarioId];
  if (!scenario) throw new Error(`シナリオが無い: ${save.scenarioId}`);
  let s = playMonth(
    newGame(
      save.stackIndex,
      save.seed,
      scenario,
      save.startDate,
      save.framework,
      save.components,
      save.revalidateSec,
      save.comments,
      save.commitments,
      save.routes,
    ),
  );
  for (const actions of save.turns) {
    if (s.phase !== 'playing')
      throw new Error('保存の行動の途中でゲームが終わっている');
    // 行動は 1 つずつ、その時点の状態で読み替えて当てる（applyActions と同じ順・同じ結果）
    let t = s;
    for (const a of actions) t = applyActions(t, [migrateActionFor(t, a)]);
    s = playMonth(t);
  }
  if (s.history.length !== save.turns.length + 1)
    throw new Error('再生した月数が保存と合わない');
  return s;
}
