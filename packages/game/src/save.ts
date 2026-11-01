// 遊んでいる途中の保存（D-26・prd/02 §5）。GameState そのものは保存せず、始めたときの選択と月ごとの行動の列だけを持つ。
// ゲームは決定論なので、同じ選択と行動を同じ順に再生すれば同じ状態に戻る。ここは純粋関数だけ（保存・読み込みの I/O は web）。
import {
  applyActions,
  newGame,
  playMonth,
  SCENARIOS,
  type Action,
  type GameState,
} from './index.ts';
import type { Choices, FrameworkId } from 'catalog';

const FRAMEWORK_IDS: readonly FrameworkId[] = ['nextjs', 'vite-spa'];

export const SAVE_VERSION = 1;

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

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * 保存の形を確かめる（読めない・版が違うなら null）。行動の中身は再生のときに確かめる
 * （選べない行動は applyAction が状態を変えずに返すので、再生の結果の月数で食い違いを見つける）。
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!isObject(raw) || raw.version !== SAVE_VERSION) return null;
  const { scenarioId, stackIndex, seed, startDate, turns } = raw;
  const framework = raw.framework ?? 'nextjs';
  const components = raw.components;
  const revalidateSec = raw.revalidateSec;
  if (
    revalidateSec !== undefined &&
    !(typeof revalidateSec === 'number' && Number.isFinite(revalidateSec))
  )
    return null;
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
    ...(revalidateSec !== undefined ? { revalidateSec } : {}),
    turns: turns as Action[][],
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
    ),
  );
  for (const actions of save.turns) {
    if (s.phase !== 'playing')
      throw new Error('保存の行動の途中でゲームが終わっている');
    s = playMonth(applyActions(s, actions));
  }
  if (s.history.length !== save.turns.length + 1)
    throw new Error('再生した月数が保存と合わない');
  return s;
}
