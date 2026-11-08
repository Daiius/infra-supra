// 手元の結果の履歴（D-144・prd/15 §3.3）。終わったプレイ（完走・途中終了）ごとに 4 軸の値などを localStorage に溜め、
// 集計（段 2・3）が無い間の比較（自己ベスト・前回との差・過去の中での順位）の元にする。
// ここは純粋な部分だけ（形の確かめ・足し方・比べ方・花火の段）。localStorage の読み書きは App.tsx。
import {
  RESULT_AXES,
  resultAxesOf,
  stackName,
  FRAMEWORKS,
  type EndReason,
  type GameState,
  type ResultAxes,
  type ResultAxisId,
  type SaveData,
} from 'game';

/** localStorage のキー（値は ResultStore の JSON）。 */
export const RESULTS_KEY = 'infra-supra:results';

/** 履歴の版。形を変えたら上げる（読めない版は黙って捨てる）。 */
export const RESULTS_VERSION = 1;

/** 溜める件数の上限（新しい順に残す）。 */
export const RESULTS_LIMIT = 50;

export type ResultEntry = {
  /** プレイの id（始めたときの選択と行動の列から決まる。同じプレイを二重に溜めない）。 */
  id: string;
  scenarioId: string;
  seed: number;
  startDate: string;
  /** 終わった日（YYYY-MM-DD・端末の日付）。 */
  finishedAt: string;
  /** 構成の要約（構成の名前・フレームワーク）。 */
  setup: string;
  axes: ResultAxes;
  /** 止まった月の数（軸ではない。振り返りに出す）。 */
  outages: number;
  end: { reason: EndReason; month: number };
};

export type ResultStore = {
  version: typeof RESULTS_VERSION;
  /** 新しい順。 */
  entries: ResultEntry[];
};

const EMPTY: ResultStore = { version: RESULTS_VERSION, entries: [] };
const END_REASONS: readonly EndReason[] = [
  'completed',
  'cash',
  'outages',
  'policy',
];

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseEntry(x: unknown): ResultEntry | null {
  if (!isObject(x)) return null;
  const { id, scenarioId, seed, startDate, finishedAt, setup, axes, outages } =
    x;
  const end = x.end;
  if (
    !isStr(id) ||
    !isStr(scenarioId) ||
    !isNum(seed) ||
    !isStr(startDate) ||
    !isStr(finishedAt) ||
    !isStr(setup) ||
    !isNum(outages) ||
    !isObject(axes) ||
    !RESULT_AXES.every((a) => isNum(axes[a.id])) ||
    !isObject(end) ||
    !END_REASONS.includes(end.reason as EndReason) ||
    !isNum(end.month)
  )
    return null;
  return {
    id,
    scenarioId,
    seed,
    startDate,
    finishedAt,
    setup,
    axes: Object.fromEntries(
      RESULT_AXES.map((a) => [a.id, axes[a.id] as number]),
    ) as ResultAxes,
    outages,
    end: { reason: end.reason as EndReason, month: end.month },
  };
}

/** 保存した履歴を読む。形・版が違えば空（黙って捨てる）。中の 1 件だけ壊れていれば、その件だけ捨てる。 */
export function parseResults(x: unknown): ResultStore {
  if (
    !isObject(x) ||
    x.version !== RESULTS_VERSION ||
    !Array.isArray(x.entries)
  )
    return EMPTY;
  const entries = x.entries
    .map(parseEntry)
    .filter((e): e is ResultEntry => e !== null);
  return { version: RESULTS_VERSION, entries: entries.slice(0, RESULTS_LIMIT) };
}

/** 32 ビットの FNV-1a（16 進）。プレイの id に使う（暗号の用途ではない）。 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * プレイの id。前の試行（D-128）を除いた保存の中身から決めるので、再開しても同じ id になり、
 * 戻って違う行動で終えたら別の id になる。
 */
export function playId(save: SaveData): string {
  const { previous: _, ...rest } = save;
  return fnv1a(JSON.stringify(rest));
}

/** 終わった状態から履歴の 1 件を作る。 */
export function resultEntryOf(
  save: SaveData,
  state: GameState,
  finishedAt: string,
): ResultEntry {
  return {
    id: playId(save),
    scenarioId: save.scenarioId,
    seed: save.seed,
    startDate: save.startDate,
    finishedAt,
    setup: `${stackName(state.stackIndex, state.framework, false)}・${FRAMEWORKS[state.framework].label}`,
    axes: resultAxesOf(state),
    outages: state.outages,
    end: state.end!,
  };
}

/** 新しい 1 件を先頭に足す（同じ id がすでにあれば足さない）。上限を超えた古いものは落とす。 */
export function withResult(
  store: ResultStore,
  entry: ResultEntry,
): ResultStore {
  if (store.entries.some((e) => e.id === entry.id)) return store;
  return {
    version: RESULTS_VERSION,
    entries: [entry, ...store.entries].slice(0, RESULTS_LIMIT),
  };
}

export type AxisComparison = {
  id: ResultAxisId;
  label: string;
  value: number;
  /** 比べた過去の完走の数（今回を除く）。 */
  count: number;
  /** 過去の完走の中の最高（無ければ undefined）。 */
  best?: number;
  /** 過去の最高を上回った（同じ値は更新に数えない）。過去が無ければ false。 */
  newBest: boolean;
  /** 前回（今回を除く最新の完走）との差。 */
  diffFromLast?: number;
  /** 今回を含めた中での順位（1 が最上位。同じ値は同じ順位）。 */
  rank: number;
};

/**
 * 手元の履歴との比較（段 1。prd/15 §3.1 の「集計が無いときの比較」）。比べる相手は同じシナリオの完走だけ
 * （途中終了の値は 12 か月目の値ではないので混ぜない）。今回の id の記録は除く。
 */
export function compareWithHistory(
  current: { id: string; scenarioId: string; axes: ResultAxes },
  entries: readonly ResultEntry[],
): AxisComparison[] {
  const past = entries.filter(
    (e) =>
      e.id !== current.id &&
      e.scenarioId === current.scenarioId &&
      e.end.reason === 'completed',
  );
  const last = past[0];
  return RESULT_AXES.map(({ id, label }) => {
    const value = current.axes[id];
    const values = past.map((e) => e.axes[id]);
    const best = values.length ? Math.max(...values) : undefined;
    return {
      id,
      label,
      value,
      count: past.length,
      ...(best !== undefined ? { best } : {}),
      newBest: best !== undefined && value > best,
      ...(last ? { diffFromLast: value - last.axes[id] } : {}),
      rank: 1 + values.filter((v) => v > value).length,
    };
  });
}

/**
 * 花火の段（1〜3。ST-01 の暫定・D-145）: 自己ベストを更新した軸の数で分ける（0 → 1・1〜2 → 2・3〜4 → 3）。
 * 段 3 で「上位に入った軸の数」に置き換える。
 */
export function fireworkLevel(cmp: readonly AxisComparison[]): 1 | 2 | 3 {
  const n = cmp.filter((c) => c.newBest).length;
  return n >= 3 ? 3 : n >= 1 ? 2 : 1;
}
