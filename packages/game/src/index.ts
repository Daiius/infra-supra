// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移した）。純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// GAME の値（収益・成長・行動の費用・障害の影響）はゲーム上の仮定で、実在の値ではない。
import { articleCommunity, loadPriceBooks, MVP_STACKS } from 'catalog';
import {
  estimate,
  type LineItem,
  type PlatformPremise,
  type WorkloadInput,
} from 'estimator';

export const GAME = {
  months: 12,
  startPV: 150_000,
  growth: 0.4,
  buzzMonth: 7,
  buzzFactor: 10,
  buzzLasting: 1.8,
  adUsdPer1000PV: 0.25,
  startCash: 60,
  usdJpy: 150, // ⚠ 為替は取得していない（仮定）
  migrationCost: 40,
  migrationRevenueLoss: 0.15,
  blockRevenueLoss: 0.6,
  blockGrowth: -0.2,
  throttleRevenueLoss: 0.1,
  throttleGrowthPenalty: 0.5,
  selfHostedOpsUsdPerMonth: 30,
  noSlaOutageChance: 0.08,
  incidentRevenueLoss: 0.1,
  incidentGrowthPenalty: 0.7,
  goal: { cash: 6500, maxOutageMonths: 2 },
} as const;

export type Mods = {
  imageKB: number;
  ssrCpuMs: number;
  revalidateSec: number;
  variants: number;
};

export const IMPROVEMENTS = [
  {
    key: 'compress',
    label: '画像を圧縮する（150 KB → 70 KB）',
    cost: 20,
    note: '転送量に効く',
  },
  {
    key: 'optimize',
    label: 'SSR を最適化する（CPU 15 ms → 8 ms）',
    cost: 60,
    note: 'CPU 時間に効く',
  },
  {
    key: 'isr',
    label: 'ISR の再検証の間隔を延ばす（5 分 → 1 時間）',
    cost: 0,
    note: '再生成の回数に効く。記事の更新は遅れて見える',
  },
  {
    key: 'variants',
    label: '画像のサイズ違いを減らす（3 → 1）',
    cost: 10,
    note: '画像変換の件数に効く',
  },
] as const;
export type ImprovementKey = (typeof IMPROVEMENTS)[number]['key'];

const APPLY: Record<ImprovementKey, (m: Mods) => Mods> = {
  compress: (m) => ({ ...m, imageKB: 70 }),
  optimize: (m) => ({ ...m, ssrCpuMs: 8 }),
  isr: (m) => ({ ...m, revalidateSec: 3600 }),
  variants: (m) => ({ ...m, variants: 1 }),
};

export type Action =
  | { type: 'none' }
  | { type: 'improve'; key: ImprovementKey }
  | { type: 'migrate'; stackIndex: number };

export type MonthReport = {
  month: number;
  stackName: string;
  buzz: boolean;
  pv: number;
  revenue: number;
  infraCost: number;
  opsCost: number;
  cash: number;
  status: 'ok' | 'down' | 'incident' | 'slow';
  notes: string[];
  /** 当たった前提と、境目の 70% を超えた前提。 */
  premises: PlatformPremise[];
  lines: { label: string; amount: number; currency: string }[];
  unpricedLines: number;
  action?: string;
};

export type GameState = {
  seed: number; // 乱数の内部状態（保存すれば同じ続きになる）
  stackIndex: number;
  mods: Mods;
  improvements: ImprovementKey[];
  cash: number;
  basePV: number;
  growth: number;
  outages: number;
  pendingMigration: boolean;
  history: MonthReport[];
  phase: 'playing' | 'won' | 'lost';
};

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
}));

const books = loadPriceBooks();

/** シード付き乱数（mulberry32）。四則演算とビット演算だけなので、どの JS エンジンでも同じ列になる。 */
function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

function workloadFor(pv: number, m: Mods): WorkloadInput {
  const w = articleCommunity(Math.round(pv));
  w.routes = w.routes.map((r) => ({
    ...r,
    processing: { ...r.processing, cpuMs: m.ssrCpuMs },
    ...(r.rendering === 'isr' ? { revalidateSeconds: m.revalidateSec } : {}),
  }));
  w.images = { ...w.images, sizeKB: m.imageKB, variants: m.variants };
  return w;
}

const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / GAME.usdJpy;

function lineLabel(l: LineItem): string {
  if (l.kind === 'base-fee')
    return `${l.priceRef.provider} ${l.priceRef.planId} 基本料`;
  if (l.kind === 'credit') return `${l.priceRef.provider} クレジット`;
  return `${l.priceRef.provider} ${l.priceRef.meterId}`;
}

export function newGame(stackIndex: number, seed = 42): GameState {
  return {
    seed,
    stackIndex,
    mods: { imageKB: 150, ssrCpuMs: 15, revalidateSec: 300, variants: 3 },
    improvements: [],
    cash: GAME.startCash,
    basePV: GAME.startPV,
    growth: GAME.growth,
    outages: 0,
    pendingMigration: false,
    history: [],
    phase: 'playing',
  };
}

/** 1 か月を進める（見積 → 収益 → 前提の判定 → 所持金）。 */
export function playMonth(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const month = state.history.length + 1;
  const buzz = month === GAME.buzzMonth;
  const pv = buzz ? state.basePV * GAME.buzzFactor : state.basePV;
  const stack = MVP_STACKS[state.stackIndex]!;
  const r = estimate({
    workload: workloadFor(pv, state.mods),
    architecture: stack,
    books,
  });

  const selfHosted = r.simulation.architecture.nodes.some(
    (n) => n.config.kind === 'host',
  );
  const opsCost = selfHosted ? GAME.selfHostedOpsUsdPerMonth : 0;
  const infraCost = toUsd(r.bill.totals);
  const [rand, seed] = nextRandom(state.seed);
  const incident = selfHosted && rand < GAME.noSlaOutageChance;

  const blocking = r.premises.filter(
    (p) =>
      p.hit &&
      (p.effect === 'block' ||
        p.effect === 'policy' ||
        p.effect === 'upgrade-required'),
  );
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  let revenue = (pv / 1000) * GAME.adUsdPer1000PV;
  let growth = state.growth; // この月だけの成長率（基準の state.growth は変えない）
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - GAME.blockRevenueLoss;
    growth = GAME.blockGrowth;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - GAME.incidentRevenueLoss;
    growth *= GAME.incidentGrowthPenalty;
    outages++;
    status = 'incident';
    notes.push('VPS の障害で数時間止まった（SLA なし・1 台構成）');
  } else if (throttling.length) {
    revenue *= 1 - GAME.throttleRevenueLoss;
    growth *= GAME.throttleGrowthPenalty;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.pendingMigration) {
    revenue *= 1 - GAME.migrationRevenueLoss;
    notes.push('乗り換えの作業で収益が減った');
  }
  if (buzz) notes.unshift('SNS で話題になった！');
  const cash = state.cash + revenue - infraCost - opsCost;

  const report: MonthReport = {
    month,
    stackName: stack.name,
    buzz,
    pv,
    revenue,
    infraCost,
    opsCost,
    cash,
    status,
    notes,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    lines: r.bill.lines
      .filter((l) => l.amount)
      .map((l) => ({
        label: lineLabel(l),
        amount: l.amount!,
        currency: l.currency,
      })),
    unpricedLines: r.bill.unpricedLines,
  };
  const lost = cash < 0;
  const finished = month >= GAME.months;
  const won =
    finished && cash >= GAME.goal.cash && outages <= GAME.goal.maxOutageMonths;
  return {
    ...state,
    seed,
    cash,
    outages,
    basePV: buzz
      ? state.basePV * GAME.buzzLasting
      : state.basePV * (1 + growth),
    pendingMigration: false,
    history: [...state.history, report],
    phase: lost ? 'lost' : finished ? (won ? 'won' : 'lost') : 'playing',
  };
}

/** 月の終わりの行動（次の月に効く）。 */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.phase !== 'playing') return state;
  const last = state.history[state.history.length - 1];
  const withNote = (label: string, s: GameState): GameState =>
    last
      ? {
          ...s,
          history: [...s.history.slice(0, -1), { ...last, action: label }],
        }
      : s;
  if (action.type === 'improve') {
    const imp = IMPROVEMENTS.find((i) => i.key === action.key);
    if (!imp || state.improvements.includes(action.key)) return state;
    return withNote(imp.label, {
      ...state,
      mods: APPLY[action.key](state.mods),
      improvements: [...state.improvements, action.key],
      cash: state.cash - imp.cost,
    });
  }
  if (action.type === 'migrate') {
    if (
      action.stackIndex === state.stackIndex ||
      !MVP_STACKS[action.stackIndex]
    )
      return state;
    return withNote(`${MVP_STACKS[action.stackIndex]!.name} へ乗り換え`, {
      ...state,
      stackIndex: action.stackIndex,
      cash: state.cash - GAME.migrationCost,
      pendingMigration: true,
    });
  }
  return state;
}
