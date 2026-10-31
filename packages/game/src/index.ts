// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// GAME と rules.ts の値（収益・成長・手間・満足度・障害の影響・目標）はゲーム上の仮定で、実在の値ではない。
import { articleCommunity, loadPriceBooks, MVP_STACKS } from 'catalog';
import {
  estimate,
  type LineItem,
  type PlatformPremise,
  type WorkloadInput,
} from 'estimator';
import {
  allocateEffort,
  buzzLasting,
  EFFORT,
  effectiveSsrCpuMs,
  ELEMENT_LABEL,
  ELEMENTS,
  growthFromReputation,
  judgeStages,
  policyStep,
  reputation,
  SATISFACTION,
  satisfactionScore,
  speedHeaviness,
  STAGE_VALUE,
  type EffortBreakdown,
  type Element,
  type Stages,
} from './rules.ts';
import type { PremiseSnapshot } from './trends.ts';

/** ゲームのバランスの値（すべてゲーム上の仮定。prd/07 §9）。 */
export const GAME = {
  months: 12,
  startPV: 150_000,
  buzzMonth: 7,
  buzzFactor: 10,
  adUsdPer1000PV: 0.25,
  startCash: 60,
  usdJpy: 150, // ⚠ 為替は取得していない（仮定）
  /** テンプレートの SSR 1 回の CPU（catalog の articleCommunity と同じ値）。 */
  baseSsrCpuMs: 15,
  /** 乗り換えの切り替えの月に減る収益の割合。 */
  migrationRevenueLoss: 0.15,
  blockRevenueLoss: 0.6,
  throttleRevenueLoss: 0.1,
  noSlaOutageChance: 0.08,
  incidentRevenueLoss: 0.1,
  /**
   * 合格: 所持金 ≥ cash・満足度の 12 か月平均 ≥ satisfaction・止まった月 ≤ maxOutageMonths（D-18 U-2）。
   * 止まった月が上限を超えた時点でゲームオーバー（D-19）。cash は基準プレイから決めた（prd/07 §9.6）:
   * Cloudflare Paid・何もしない（$8,868）の約 70%。Vercel Pro は何もしないと届かず（$6,037）、話題の前に圧縮すると届く（$6,303）。
   */
  goal: { cash: 6200, satisfaction: 0.75, maxOutageMonths: 2 },
} as const;

export type Settings = {
  imageKB: number;
  variants: number;
  revalidateSec: number;
  /** SSR の最適化の段数。 */
  ssrOptimizations: number;
};

/** 戻せる設定（prd/07 §9.5）。値はゲーム上の仮定。 */
export const SETTINGS = {
  compress: {
    label: '画像の圧縮',
    field: 'imageKB',
    effort: EFFORT.setting.compress,
    note: '転送量と速さに効く。画質（満足度）が下がる',
    options: [
      { value: 150, label: 'なし（150 KB）' },
      { value: 100, label: '中（100 KB）' },
      { value: 70, label: '強（70 KB）' },
    ],
  },
  variants: {
    label: '画像のサイズ違い',
    field: 'variants',
    effort: EFFORT.setting.variants,
    note: '画像変換の件数に効く。1 種だと大きい画像を全端末に配るので遅くなる',
    options: [
      { value: 3, label: '3 種' },
      { value: 2, label: '2 種' },
      { value: 1, label: '1 種' },
    ],
  },
  isr: {
    label: 'ISR の再検証の間隔',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note: '再生成の回数に効く。延ばすと記事の更新が遅れて見え、鮮度（満足度）が下がる',
    options: [
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    field: Exclude<keyof Settings, 'ssrOptimizations'>;
    effort: number;
    note: string;
    options: readonly { value: number; label: string }[];
  }
>;
export type SettingKey = keyof typeof SETTINGS;

export type Action =
  | { type: 'none' }
  | { type: 'set'; key: SettingKey; value: number }
  | { type: 'optimize' }
  /** 同じ事業者のプランの変更（ほぼ即時・手間なし）。 */
  | { type: 'plan'; stackIndex: number }
  /** 別の事業者への乗り換え（手間・数か月・期間中は新旧両方の費用）。 */
  | { type: 'migrate'; stackIndex: number };

export type Migration = {
  from: number;
  to: number;
  /** 必要な手間の合計と、入れた手間。 */
  required: number;
  done: number;
};

export type EndReason = 'won' | 'goal' | 'cash' | 'outages' | 'policy';

export type MonthReport = {
  month: number;
  stackName: string;
  buzz: boolean;
  pv: number;
  revenue: number;
  /** 動かしている構成のインフラ費用（乗り換え中は新しい構成の分も含む）。 */
  infraCost: number;
  /** うち乗り換え先の構成の費用（乗り換え中だけ）。 */
  parallelInfraCost: number;
  cash: number;
  status: 'ok' | 'down' | 'incident' | 'slow';
  notes: string[];
  /** 規約違反の指摘を受けた月（翌月も違反したままならアカウント停止。D-19）。 */
  policyWarning: boolean;
  /** 当たった前提と、境目の 70% を超えた前提。 */
  premises: PlatformPremise[];
  /** 量の境目がある前提すべての記録（推移と見込みに使う。prd/07 §5）。 */
  snapshots: PremiseSnapshot[];
  lines: { label: string; amount: number; currency: string }[];
  unpricedLines: number;
  settings: Settings;
  ssrCpuMs: number;
  satisfaction: {
    stages: Stages;
    /** 段階ごとの理由（悪い・普通のときだけ）。 */
    reasons: Partial<Record<Element, string>>;
    score: number;
    reputation: number;
    acquisition: number;
    churn: number;
    growth: number;
  };
  effort: EffortBreakdown;
  /** 今月までの累積の機能ポイント。 */
  featurePoints: number;
  migration?: { toName: string; done: number; required: number };
  action?: string;
};

export type GameState = {
  seed: number; // 乱数の内部状態（保存すれば同じ続きになる）
  /** 始めたときのシード（基準プレイを同じシードで回すため）。 */
  startSeed: number;
  stackIndex: number;
  settings: Settings;
  cash: number;
  basePV: number;
  outages: number;
  featurePoints: number;
  migration: Migration | null;
  /** 次の月が乗り換えの切り替えの月か。 */
  switching: boolean;
  /** 次の月に使う行動の手間。 */
  plannedEffort: number;
  /** 規約違反の指摘を受けた月。 */
  policyWarnedMonth: number | null;
  history: MonthReport[];
  phase: 'playing' | 'won' | 'lost';
  end?: { reason: EndReason; month: number };
};

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
  provider: s.id.replace(/-(free|paid|hobby|pro)$/, ''),
  selfHosted: s.nodes.some((n) => n.config.kind === 'host'),
}));

const books = loadPriceBooks();

/** シード付き乱数（mulberry32）。四則演算とビット演算だけなので、どの JS エンジンでも同じ列になる。 */
function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

function workloadFor(pv: number, s: Settings, ssrCpuMs: number): WorkloadInput {
  const w = articleCommunity(Math.round(pv));
  w.routes = w.routes.map((r) => ({
    ...r,
    processing: { ...r.processing, cpuMs: ssrCpuMs },
    ...(r.rendering === 'isr' ? { revalidateSeconds: s.revalidateSec } : {}),
  }));
  w.images = { ...w.images, sizeKB: s.imageKB, variants: s.variants };
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

/** 同じ事業者のプランの変更か（Cloudflare Free ↔ Paid・Vercel Hobby ↔ Pro）。 */
export function isPlanChange(from: number, to: number): boolean {
  return from !== to && STACKS[from]!.provider === STACKS[to]!.provider;
}

/** 乗り換えに必要な手間の合計（VPS が絡むと長い）。 */
export function migrationEffort(from: number, to: number): number {
  const m = EFFORT.migrationMonths;
  const months =
    STACKS[from]!.selfHosted || STACKS[to]!.selfHosted
      ? m.selfHosted
      : m.serverless;
  return months * EFFORT.migrationPerMonth;
}

function upkeepFor(state: Pick<GameState, 'stackIndex' | 'migration'>) {
  const running = [
    state.stackIndex,
    ...(state.migration ? [state.migration.to] : []),
  ];
  return running.some((i) => STACKS[i]!.selfHosted)
    ? EFFORT.selfHostedUpkeep
    : 0;
}

function migrationWanted(m: Migration | null): number {
  return m ? Math.min(EFFORT.migrationPerMonth, m.required - m.done) : 0;
}

/** 次の月に、まだ行動に使える手間。 */
export function effortAvailable(state: GameState): number {
  return (
    EFFORT.perMonth -
    upkeepFor(state) -
    migrationWanted(state.migration) -
    state.plannedEffort
  );
}

/** 次の月の SSR の CPU（今月までの機能開発で重くなった分を含む）。 */
export function nextSsrCpuMs(state: GameState): number {
  return effectiveSsrCpuMs(
    GAME.baseSsrCpuMs,
    state.settings.ssrOptimizations,
    state.featurePoints,
  );
}

/** 行動の手間（選べない行動は null）。 */
export function actionEffort(state: GameState, action: Action): number | null {
  if (state.phase !== 'playing') return null;
  switch (action.type) {
    case 'none':
      return 0;
    case 'set': {
      const def = SETTINGS[action.key];
      if (!def || !def.options.some((o) => o.value === action.value))
        return null;
      if (state.settings[def.field] === action.value) return null;
      return def.effort;
    }
    case 'optimize':
      return nextSsrCpuMs(state) > EFFORT.minSsrCpuMs ? EFFORT.optimize : null;
    case 'plan':
      return !state.migration &&
        STACKS[action.stackIndex] &&
        isPlanChange(state.stackIndex, action.stackIndex)
        ? EFFORT.plan
        : null;
    case 'migrate':
      return !state.migration &&
        STACKS[action.stackIndex] &&
        action.stackIndex !== state.stackIndex &&
        !isPlanChange(state.stackIndex, action.stackIndex)
        ? 0 // 乗り換えの手間は進行中の月ごとに取る（effortAvailable が減る）
        : null;
  }
}

export function newGame(stackIndex: number, seed = 42): GameState {
  return {
    seed,
    startSeed: seed,
    stackIndex,
    settings: {
      imageKB: 150,
      variants: 3,
      revalidateSec: 300,
      ssrOptimizations: 0,
    },
    cash: GAME.startCash,
    basePV: GAME.startPV,
    outages: 0,
    featurePoints: 0,
    migration: null,
    switching: false,
    plannedEffort: 0,
    policyWarnedMonth: null,
    history: [],
    phase: 'playing',
  };
}

const optionLabel = (key: SettingKey, value: number) =>
  SETTINGS[key].options.find((o) => o.value === value)?.label ?? String(value);

/** 1 か月を進める（見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 終わりの判定）。 */
export function playMonth(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const month = state.history.length + 1;
  const prev = state.history[state.history.length - 1];
  const buzz = month === GAME.buzzMonth;
  const pv = buzz ? state.basePV * GAME.buzzFactor : state.basePV;
  const stack = MVP_STACKS[state.stackIndex]!;
  const ssrCpuMs = nextSsrCpuMs(state);
  const workload = workloadFor(pv, state.settings, ssrCpuMs);
  const r = estimate({ workload, architecture: stack, books });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）
  const target = state.migration
    ? estimate({
        workload,
        architecture: MVP_STACKS[state.migration.to]!,
        books,
      })
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  const infraCost = toUsd(r.bill.totals) + parallelInfraCost;

  // 手間（維持 → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    migrationWanted: migrationWanted(state.migration),
    actions: state.plannedEffort,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;

  const [rand, seed] = nextRandom(state.seed);
  const incident =
    STACKS[state.stackIndex]!.selfHosted && rand < GAME.noSlaOutageChance;

  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = r.premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = r.premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  let revenue = (pv / 1000) * GAME.adUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - GAME.blockRevenueLoss;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - GAME.incidentRevenueLoss;
    outages++;
    status = 'incident';
    notes.push('VPS の障害で数時間止まった（SLA なし・1 台構成）');
  } else if (throttling.length) {
    revenue *= 1 - GAME.throttleRevenueLoss;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - GAME.migrationRevenueLoss;
    notes.push('乗り換えの切り替えで収益が減った');
  }
  if (buzz) notes.unshift('SNS で話題になった！');

  // 規約違反: 最初の月は指摘（警告）、翌月も違反したままならアカウント停止（D-19）
  const ps = policyStep({
    warnedMonth: state.policyWarnedMonth,
    violating: policy.length > 0,
    migrating: state.migration !== null,
    month,
  });
  const policyWarnedMonth = ps.warnedMonth;
  const policyWarning = ps.outcome === 'warned';
  const accountSuspended = ps.outcome === 'suspended';
  if (ps.outcome === 'warned')
    notes.push(
      `運営元から指摘が来た（規約違反の警告: ${policy[0]!.text}）。来月も違反したままならアカウントが停止される`,
    );
  else if (ps.outcome === 'grace')
    notes.push('規約違反のまま乗り換えの作業中（猶予中）');
  else if (accountSuspended)
    notes.push('規約違反が続いたため、アカウントが停止された');

  // 満足度と評判（prd/07 §9.1〜9.3）
  const stages = judgeStages({
    blocked: blocking.length > 0,
    degraded: incident || state.switching,
    ssrCpuMs,
    imageKB: state.settings.imageKB,
    variants: state.settings.variants,
    revalidateSec: state.settings.revalidateSec,
    featurePoints,
    month,
    premises: r.premises,
  });
  const reasons = stageReasons(stages, {
    blocking,
    throttling,
    incident,
    switching: state.switching,
    ssrCpuMs,
    settings: state.settings,
    heaviness: speedHeaviness({
      ...state.settings,
      ssrCpuMs,
      premises: r.premises,
    }),
    featurePoints,
    month,
  });
  const score = satisfactionScore(stages);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad');

  const cash = state.cash + revenue - infraCost;

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = state.stackIndex;
  let switching = false;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${MVP_STACKS[migration.to]!.name} に切り替える`,
    );
    migration = null;
  }

  const report: MonthReport = {
    month,
    stackName: stack.name,
    buzz,
    pv,
    revenue,
    infraCost,
    parallelInfraCost,
    cash,
    status,
    notes,
    policyWarning,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    snapshots: r.premises
      .filter(
        (p) =>
          p.kind === 'threshold' &&
          p.ratio !== undefined &&
          Number.isFinite(p.ratio),
      )
      .map((p) => ({
        id: p.id,
        text: p.text,
        effect: p.effect,
        ratio: p.ratio!,
        hit: p.hit,
        accumulates: p.accumulates ?? false,
      })),
    lines: [r, ...(target ? [target] : [])].flatMap((x) =>
      x.bill.lines
        .filter((l) => l.amount)
        .map((l) => ({
          label: lineLabel(l),
          amount: l.amount!,
          currency: l.currency,
        })),
    ),
    unpricedLines: r.bill.unpricedLines + (target?.bill.unpricedLines ?? 0),
    settings: state.settings,
    ssrCpuMs,
    satisfaction: {
      stages,
      reasons,
      score,
      reputation: rep,
      acquisition: g.acquisition,
      churn: g.churn,
      growth: buzz ? buzzLasting(rep) - 1 : g.net,
    },
    effort,
    featurePoints,
    ...(state.migration
      ? {
          migration: {
            toName: MVP_STACKS[state.migration.to]!.name,
            done: state.migration.done + effort.migration,
            required: state.migration.required,
          },
        }
      : {}),
  };

  const history = [...state.history, report];
  const finished = month >= GAME.months;
  const end: GameState['end'] = accountSuspended
    ? { reason: 'policy', month }
    : outages > GAME.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes({ cash, outages, history }) ? 'won' : 'goal',
              month,
            }
          : undefined;
  return {
    ...state,
    seed,
    stackIndex,
    cash,
    outages,
    featurePoints,
    migration,
    switching,
    plannedEffort: 0,
    policyWarnedMonth,
    basePV: buzz ? state.basePV * buzzLasting(rep) : state.basePV * (1 + g.net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

function stageReasons(
  stages: Stages,
  c: {
    blocking: PlatformPremise[];
    throttling: PlatformPremise[];
    incident: boolean;
    switching: boolean;
    ssrCpuMs: number;
    settings: Settings;
    heaviness: number;
    featurePoints: number;
    month: number;
  },
): Partial<Record<Element, string>> {
  const out: Partial<Record<Element, string>> = {};
  if (stages.availability !== 'good')
    out.availability = c.blocking.length
      ? `止まった: ${c.blocking[0]!.text}`
      : c.incident
        ? '偶発的な障害（数時間）'
        : '乗り換えの切り替え';
  if (stages.speed !== 'good')
    out.speed = c.throttling.length
      ? `前提に当たった: ${c.throttling[0]!.text}`
      : `重さ ${c.heaviness}（SSR ${c.ssrCpuMs} ms・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種）`;
  if (stages.quality !== 'good')
    out.quality = `画像の圧縮 ${optionLabel('compress', c.settings.imageKB)}`;
  if (stages.freshness !== 'good')
    out.freshness = `ISR の間隔 ${optionLabel('isr', c.settings.revalidateSec)}`;
  if (stages.feature !== 'good') {
    const expected = SATISFACTION.feature.expectedPerMonth * c.month;
    out.feature = `機能開発 ${c.featurePoints} / 期待 ${expected}`;
  }
  return out;
}

export function averageSatisfaction(history: readonly MonthReport[]): number {
  return history.length
    ? history.reduce((a, r) => a + r.satisfaction.score, 0) / history.length
    : 0;
}

function passes(s: {
  cash: number;
  outages: number;
  history: readonly MonthReport[];
}): boolean {
  return (
    s.cash >= GAME.goal.cash &&
    averageSatisfaction(s.history) >= GAME.goal.satisfaction &&
    s.outages <= GAME.goal.maxOutageMonths
  );
}

/** 月の終わりの行動（次の月に効く）。1 か月に複数選べる。選べない行動は状態を変えずに返す。 */
export function applyAction(state: GameState, action: Action): GameState {
  const cost = actionEffort(state, action);
  if (cost === null || action.type === 'none') return state;
  if (cost > effortAvailable(state)) return state;
  const last = state.history[state.history.length - 1];
  const withNote = (label: string, s: GameState): GameState =>
    last
      ? {
          ...s,
          history: [
            ...s.history.slice(0, -1),
            {
              ...last,
              action: last.action ? `${last.action}・${label}` : label,
            },
          ],
        }
      : s;
  const planned = { plannedEffort: state.plannedEffort + cost };
  switch (action.type) {
    case 'set': {
      const def = SETTINGS[action.key];
      return withNote(
        `${def.label}: ${optionLabel(action.key, action.value)}`,
        {
          ...state,
          ...planned,
          settings: { ...state.settings, [def.field]: action.value },
        },
      );
    }
    case 'optimize':
      return withNote('SSR を最適化（−5 ms）', {
        ...state,
        ...planned,
        settings: {
          ...state.settings,
          ssrOptimizations: state.settings.ssrOptimizations + 1,
        },
      });
    case 'plan':
      return withNote(`${STACKS[action.stackIndex]!.name} にプラン変更`, {
        ...state,
        ...planned,
        stackIndex: action.stackIndex,
      });
    case 'migrate': {
      const migration: Migration = {
        from: state.stackIndex,
        to: action.stackIndex,
        required: migrationEffort(state.stackIndex, action.stackIndex),
        done: 0,
      };
      // 乗り換えの月ごとの手間と行動を合わせて、来月の手間に収まるか
      if (effortAvailable({ ...state, migration }) < 0) return state;
      return withNote(`${STACKS[action.stackIndex]!.name} へ乗り換えを始めた`, {
        ...state,
        migration,
      });
    }
  }
}

export function applyActions(
  state: GameState,
  actions: readonly Action[],
): GameState {
  return actions.reduce(applyAction, state);
}

// ---- 評価（prd/07 §9.6）----

export type Axes = {
  /** 累積の利益（最終の所持金 − 開始時）。 */
  profit: number;
  satisfaction: number;
  /** 要素ごとの平均の段階の数値（0〜1）。 */
  elements: Record<Element, number>;
  /** 最終月の PV（話題の月は基準の PV）。 */
  finalPV: number;
  featurePoints: number;
  /** 総ポイントに対する機能開発の割合。 */
  featureShare: number;
};

export function axesOf(state: GameState): Axes {
  const h = state.history;
  const n = Math.max(1, h.length);
  const last = h[h.length - 1];
  const elements = Object.fromEntries(
    ELEMENTS.map((e) => [
      e,
      h.reduce((a, r) => a + STAGE_VALUE[r.satisfaction.stages[e]], 0) / n,
    ]),
  ) as Record<Element, number>;
  return {
    profit: state.cash - GAME.startCash,
    satisfaction: averageSatisfaction(h),
    elements,
    finalPV: last ? (last.buzz ? last.pv / GAME.buzzFactor : last.pv) : 0,
    featurePoints: state.featurePoints,
    featureShare: state.featurePoints / (EFFORT.perMonth * n),
  };
}

export type Check = {
  label: string;
  ok: boolean;
  value: string;
  target: string;
};

export function goalChecks(state: GameState): Check[] {
  const avg = averageSatisfaction(state.history);
  return [
    {
      label: '所持金',
      ok: state.cash >= GAME.goal.cash,
      value: `$${state.cash.toFixed(2)}`,
      target: `$${GAME.goal.cash} 以上`,
    },
    {
      label: '満足度の平均',
      ok: avg >= GAME.goal.satisfaction,
      value: avg.toFixed(2),
      target: `${GAME.goal.satisfaction} 以上`,
    },
    {
      label: '止まった月',
      ok: state.outages <= GAME.goal.maxOutageMonths,
      value: `${state.outages} 回`,
      target: `${GAME.goal.maxOutageMonths} 回以内`,
    },
  ];
}

export const END_LABEL: Record<EndReason, string> = {
  won: '目標達成',
  goal: '目標に届かず',
  cash: '所持金が尽きた',
  outages: '止まった回数の上限を超えた',
  policy: '規約違反が続き、アカウントが停止された',
};

export type Reflection = {
  premises: { month: number; text: string; hit: boolean; action?: string }[];
  badMonths: {
    month: number;
    element: Element;
    label: string;
    reason: string;
  }[];
  effort: Omit<EffortBreakdown, 'total'> & { total: number };
};

/** 振り返り（①前提とその月の選択 ②「悪い」になった月と理由 ③手間の内訳）。④ 見込みは画面で trends から出す。 */
export function reflectionOf(state: GameState): Reflection {
  const seen = new Map<string, Reflection['premises'][number]>();
  for (const r of state.history)
    for (const p of r.premises) {
      const cur = seen.get(p.id);
      if (!cur || (!cur.hit && p.hit))
        seen.set(p.id, {
          month: r.month,
          text: p.text,
          hit: p.hit,
          ...(r.action ? { action: r.action } : {}),
        });
    }
  const badMonths = state.history.flatMap((r) =>
    ELEMENTS.filter((e) => r.satisfaction.stages[e] === 'bad').map((e) => ({
      month: r.month,
      element: e,
      label: ELEMENT_LABEL[e],
      reason: r.satisfaction.reasons[e] ?? '',
    })),
  );
  const effort = state.history.reduce(
    (a, r) => ({
      total: a.total + r.effort.total,
      upkeep: a.upkeep + r.effort.upkeep,
      interrupt: a.interrupt + r.effort.interrupt,
      migration: a.migration + r.effort.migration,
      actions: a.actions + r.effort.actions,
      feature: a.feature + r.effort.feature,
    }),
    { total: 0, upkeep: 0, interrupt: 0, migration: 0, actions: 0, feature: 0 },
  );
  return {
    premises: [...seen.values()].sort((a, b) => a.month - b.month),
    badMonths,
    effort,
  };
}

// ---- 基準プレイ（目標値の根拠・成績の目盛り。prd/07 §9.6）----

export type Strategy = {
  id: string;
  label: string;
  /** 表の見出しに使う短い名前。 */
  short?: string;
  stackIndex: number;
  actions: Action[][];
};

/** 毎月の行動を並べた戦略（添字 0 が 1 か月目の終わり）。 */
export const BASELINES: Strategy[] = [
  {
    id: 'cf-paid',
    label: 'Cloudflare Paid・何もしない',
    short: 'CF Paid・何もしない',
    stackIndex: 1,
    actions: [],
  },
  {
    id: 'vps',
    label: 'さくらの VPS・何もしない',
    short: 'VPS・何もしない',
    stackIndex: 4,
    actions: [],
  },
  {
    id: 'vercel-pro',
    label: 'Vercel Pro・何もしない',
    short: 'Vercel Pro・何もしない',
    stackIndex: 3,
    actions: [],
  },
  {
    id: 'vercel-compress-late',
    label: 'Vercel Pro・話題の前（6 か月目）に画像を中程度に圧縮',
    short: 'Vercel Pro・話題前に圧縮',
    stackIndex: 3,
    actions: [
      [],
      [],
      [],
      [],
      [],
      [{ type: 'set', key: 'compress', value: 100 }],
    ],
  },
  {
    id: 'cf-free',
    label: 'Cloudflare Free・何もしない',
    short: 'CF Free・何もしない',
    stackIndex: 0,
    actions: [],
  },
];

export function playStrategy(s: Strategy, seed = 42): GameState {
  let st = playMonth(newGame(s.stackIndex, seed));
  for (let i = 0; st.phase === 'playing'; i++)
    st = playMonth(applyActions(st, s.actions[i] ?? []));
  return st;
}

export * from './rules.ts';
export * from './trends.ts';
