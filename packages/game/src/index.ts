// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間、GD-3 でシナリオのデータと出来事を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// シナリオの値（収益・成長・手間・満足度・障害の影響・出来事・目標）はゲーム上の仮定で、実在の値ではない（prd/07 §10）。
import { loadPriceBooks, MVP_STACKS } from 'catalog';
import {
  estimate,
  type ArchitectureInput,
  type LineItem,
  type PlatformPremise,
  type WorkloadInput,
} from 'estimator';
import { nextRandom } from './random.ts';
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
  satisfactionScore,
  speedHeaviness,
  STAGE_VALUE,
  type EffortBreakdown,
  type Element,
  type Stages,
} from './rules.ts';
import {
  calendarMonth,
  rollSchedule,
  type Effect,
  type EventDef,
  type EventKind,
  type EventTier,
  type Scenario,
  type Scheduled,
  type Stock,
  type Strategy,
  type WorkloadMods,
} from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import type { PremiseSnapshot } from './trends.ts';

export const SCENARIOS: Record<string, Scenario> = {
  [ARTICLE_COMMUNITY.id]: ARTICLE_COMMUNITY,
};

/** ⚠ 為替は取得していない（仮定）。シナリオによらない共通の仮定。 */
export const USD_JPY = 150;

/** テンプレートの SSR 1 回の CPU（シナリオのテンプレートから読む）。 */
export function baseSsrCpuMsOf(sc: Scenario): number {
  return sc.template(1).routes[0]!.processing.cpuMs;
}

/** 記事コミュニティの値の見え方（画面とテストの互換のため。正はシナリオのデータ）。 */
export const GAME = {
  months: ARTICLE_COMMUNITY.months,
  startPV: ARTICLE_COMMUNITY.scale.startPV,
  startCash: ARTICLE_COMMUNITY.startCash,
  usdJpy: USD_JPY,
  baseSsrCpuMs: baseSsrCpuMsOf(ARTICLE_COMMUNITY),
  goal: ARTICLE_COMMUNITY.goal,
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

/** Bot を遮断するルールの手間と効き方（ゲーム上の仮定。製品の料金は未取得。D-20 V-9）。 */
export const BOT_BLOCK = { effort: 2, remaining: 0.5 } as const;

export type Action =
  | { type: 'none' }
  | { type: 'set'; key: SettingKey; value: number }
  | { type: 'optimize' }
  /** 同じ事業者のプランの変更（ほぼ即時・手間なし）。 */
  | { type: 'plan'; stackIndex: number }
  /** 別の事業者への乗り換え（手間・数か月・期間中は新旧両方の費用）。 */
  | { type: 'migrate'; stackIndex: number }
  /** 提案への返事（受ける / 断る）。返事をしなければ断ったことになる。 */
  | { type: 'respond'; eventId: string; accept: boolean }
  /** Bot を遮断するルールを入れる（一度入れれば続く）。 */
  | { type: 'block-bots' };

export type Migration = {
  from: number;
  to: number;
  /** 必要な手間の合計と、入れた手間。 */
  required: number;
  done: number;
};

export type EndReason = 'won' | 'goal' | 'cash' | 'outages' | 'policy';

/** 月の報告に出す出来事（予告・起きた・提案）。 */
export type MonthEvent = {
  id: string;
  kind: EventKind;
  tier: EventTier;
  phase: 'notice' | 'occurred' | 'proposal';
  title: string;
  text: string;
  /** 効果の要約（PV × 3・手間 +10 / 月 など）。 */
  effects: string[];
  /** 当たりうる前提（今の構成で出ているもの。文は catalog のまま）。 */
  premises: { id: string; text: string; ratio?: number; hit: boolean }[];
  /** 席（メンバー）の料金（catalog の members）。 */
  members?: string[];
  /** 提案の「受ける」の説明。 */
  accept?: { label: string; effects: string[]; effort: number };
};

/** 前提が境目を初めて越えた月の記録（見込みが外れた理由の材料。prd/07 §10.7）。 */
export type Crossing = {
  premiseId: string;
  text: string;
  /** この出来事が無ければ、今月は越えなかった（反実仮想の見積で確かめた）。 */
  causes: { eventId: string; title: string; ratioWithout: number }[];
};

export type MonthReport = {
  month: number;
  stackName: string;
  buzz: boolean;
  /** 一時的に流量が増えた月の理由（話題・前兆・Bot）。見込みを出さない（§10.7）。 */
  trafficNote?: string;
  /** 見積に入れた PV（Bot を含む）。 */
  pv: number;
  /** 人の PV（収益が付く）と Bot の PV。 */
  humanPV: number;
  botPV: number;
  /** 出来事の倍率を掛ける前の基準の PV。 */
  basePV: number;
  revenue: number;
  /** 動かしている構成のインフラ費用（乗り換え中は新しい構成の分も含む）。 */
  infraCost: number;
  /** うち乗り換え先の構成の費用（乗り換え中だけ）。 */
  parallelInfraCost: number;
  cash: number;
  status: 'ok' | 'down' | 'incident' | 'slow';
  notes: string[];
  events: MonthEvent[];
  crossings: Crossing[];
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
  stock: Stock;
  seats: number;
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
  scenarioId: string;
  seed: number; // 偶発的な障害の乱数の内部状態（保存すれば同じ続きになる）
  /** 始めたときのシード（台本の表・基準プレイを同じシードで回すため）。 */
  startSeed: number;
  /** 台本の表（newGame で一度に作る。プレイヤーの選択に依存しない）。 */
  schedule: Scheduled[];
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
  /** 月の手間の総量（チームが増えると増える）。 */
  effortPerMonth: number;
  /** 足した席（メンバー）の数。 */
  seats: number;
  /** 提案を受けて変わった Workload（以降ずっと）。 */
  mods: WorkloadMods;
  stock: Stock;
  botBlocked: boolean;
  /** 返事を待っている提案。 */
  pendingProposal: string | null;
  responses: Record<string, 'accepted' | 'declined'>;
  /** 一度起きた状態の出来事。 */
  fired: string[];
  /** 出来事への対応の手間（毎月 points を months か月）。 */
  interrupts: { points: number; months: number; eventId: string }[];
  /** 成長率への上乗せ（毎月 add を months か月）。 */
  growthBonus: { add: number; months: number }[];
  history: MonthReport[];
  phase: 'playing' | 'won' | 'lost';
  end?: { reason: EndReason; month: number };
};

export function scenarioOf(state: Pick<GameState, 'scenarioId'>): Scenario {
  return SCENARIOS[state.scenarioId] ?? ARTICLE_COMMUNITY;
}

export function eventDef(sc: Scenario, id: string): EventDef | undefined {
  return sc.events.find((e) => e.id === id);
}

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
  provider: s.id.replace(/-(free|paid|hobby|pro)$/, ''),
  selfHosted: s.nodes.some((n) => n.config.kind === 'host'),
}));

const books = loadPriceBooks();

export { nextRandom };

/** Workload を組み立てる入力（反実仮想の見積でも同じ関数を使う）。 */
type WorkloadParts = {
  pv: number;
  settings: Settings;
  ssrCpuMs: number;
  mods: WorkloadMods;
  stock: Stock | null;
};

function workloadFor(sc: Scenario, p: WorkloadParts): WorkloadInput {
  const w = sc.template(Math.round(p.pv));
  const ssr = p.mods.ssrShare;
  w.routes = w.routes.map((r) => ({
    ...r,
    processing: { ...r.processing, cpuMs: p.ssrCpuMs },
    ...(r.rendering === 'isr'
      ? { revalidateSeconds: p.settings.revalidateSec }
      : {}),
    ...(ssr !== undefined
      ? { share: r.rendering === 'ssr' ? ssr : 1 - ssr }
      : {}),
    ...(p.stock && r.rendering === 'isr'
      ? { pages: p.stock.articlePages }
      : {}),
  }));
  w.images = {
    ...w.images,
    sizeKB: p.settings.imageKB,
    variants: p.settings.variants,
    uploadsPerMau: w.images.uploadsPerMau * (p.mods.uploadsFactor ?? 1),
    ...(p.stock
      ? { storedGB: p.stock.imagesGB, distinct: Math.round(p.stock.images) }
      : {}),
  };
  if (p.mods.imagesPerPage !== undefined)
    w.perPage = { ...w.perPage, images: p.mods.imagesPerPage };
  if (p.mods.writesPerCall !== undefined)
    w.api = { ...w.api, writesPerCall: p.mods.writesPerCall };
  if (p.stock) w.db = { ...w.db, sizeGB: p.stock.dbGB };
  return w;
}

/** テンプレートの値から在庫の初期値を作る。 */
export function initialStock(sc: Scenario): Stock {
  const w = sc.template(sc.scale.startPV);
  return {
    dbGB: w.db.sizeGB,
    imagesGB: w.images.storedGB,
    images: w.images.distinct,
    articlePages: w.routes.find((r) => r.rendering === 'isr')?.pages ?? 0,
  };
}

/** 席を足した構成（席課金のプランだけ費用が変わる）。 */
function architectureFor(stackIndex: number, seats: number): ArchitectureInput {
  const stack = MVP_STACKS[stackIndex]!;
  if (seats <= 0) return stack;
  const ids = [
    ...new Set(
      stack.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
  return { ...stack, accounts: ids.map((id) => ({ id, seats: 1 + seats })) };
}

const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / USD_JPY;

function lineLabel(l: LineItem): string {
  if (l.kind === 'base-fee')
    return `${l.priceRef.provider} ${l.priceRef.planId} 基本料`;
  if (l.kind === 'credit') return `${l.priceRef.provider} クレジット`;
  return `${l.priceRef.provider} ${l.priceRef.meterId}`;
}

/** 構成が使うプランのメンバー（席）の料金の文（catalog の members）。 */
export function membersOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.members) out.add(plan.members.premise);
  }
  return [...out];
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

function upkeepFor(
  state: Pick<GameState, 'stackIndex' | 'migration' | 'scenarioId'>,
) {
  const running = [
    state.stackIndex,
    ...(state.migration ? [state.migration.to] : []),
  ];
  return running.some((i) => STACKS[i]!.selfHosted)
    ? scenarioOf(state).effort.selfHostedUpkeep
    : 0;
}

function migrationWanted(m: Migration | null): number {
  return m ? Math.min(EFFORT.migrationPerMonth, m.required - m.done) : 0;
}

const interruptOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce((a, i) => a + (i.months > 0 ? i.points : 0), 0);

/** 次の月に、まだ行動に使える手間。 */
export function effortAvailable(state: GameState): number {
  return (
    state.effortPerMonth -
    upkeepFor(state) -
    interruptOf(state) -
    migrationWanted(state.migration) -
    state.plannedEffort
  );
}

/** 次の月の SSR の CPU（今月までの機能開発で重くなった分を含む）。 */
export function nextSsrCpuMs(state: GameState): number {
  return effectiveSsrCpuMs(
    baseSsrCpuMsOf(scenarioOf(state)),
    state.settings.ssrOptimizations,
    state.featurePoints,
  );
}

const acceptEffort = (def: EventDef) =>
  (def.accept?.effects ?? []).reduce(
    (a, e) => a + (e.type === 'interrupt' ? e.points : 0),
    0,
  );

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
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId);
      if (state.pendingProposal !== action.eventId || !def?.accept) return null;
      return action.accept ? acceptEffort(def) : 0;
    }
    case 'block-bots':
      return state.botBlocked ? null : BOT_BLOCK.effort;
  }
}

export function newGame(
  stackIndex: number,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
): GameState {
  // 状態にはシナリオの id だけを持つ（保存のため）。渡されたシナリオを id で引けるようにしておく
  SCENARIOS[scenario.id] ??= scenario;
  return {
    scenarioId: scenario.id,
    seed,
    startSeed: seed,
    schedule: rollSchedule(scenario, seed),
    stackIndex,
    settings: {
      imageKB: 150,
      variants: 3,
      revalidateSec: 300,
      ssrOptimizations: 0,
    },
    cash: scenario.startCash,
    basePV: scenario.scale.startPV,
    outages: 0,
    featurePoints: 0,
    migration: null,
    switching: false,
    plannedEffort: 0,
    policyWarnedMonth: null,
    effortPerMonth: scenario.effort.perMonth,
    seats: 0,
    mods: {},
    stock: initialStock(scenario),
    botBlocked: false,
    pendingProposal: null,
    responses: {},
    fired: [],
    interrupts: [],
    growthBonus: [],
    history: [],
    phase: 'playing',
  };
}

const optionLabel = (key: SettingKey, value: number) =>
  SETTINGS[key].options.find((o) => o.value === value)?.label ?? String(value);

const fmtFactor = (f: number) => `× ${Number(f.toFixed(2))}`;

/** 効果の要約（画面の通知に出す）。 */
export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'traffic':
      return `${e.bot ? 'Bot の' : ''}PV ${fmtFactor(e.factor)}（${e.months} か月${e.earnsRevenue ? '' : '・収益なし'}）`;
    case 'workload': {
      const m = e.mods;
      return [
        m.imagesPerPage !== undefined && `1 PV の画像 ${m.imagesPerPage} 枚`,
        m.uploadsFactor !== undefined &&
          `画像の投稿 ${fmtFactor(m.uploadsFactor)}`,
        m.ssrShare !== undefined &&
          `SSR の割合 ${Math.round(m.ssrShare * 100)}%`,
        m.writesPerCall !== undefined &&
          `API 1 回の書き込み ${m.writesPerCall}`,
        m.dbRateFactor !== undefined &&
          `DB の増え方 ${fmtFactor(m.dbRateFactor)}`,
      ]
        .filter(Boolean)
        .join('・');
    }
    case 'stock':
      return [
        e.add.dbGB && `DB +${e.add.dbGB} GB`,
        e.add.imagesGB && `画像 +${e.add.imagesGB} GB`,
        e.add.articlePages &&
          `記事ページ +${e.add.articlePages.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join('・');
    case 'basePV':
      return `基準の PV ${fmtFactor(e.factor)}（以降ずっと）`;
    case 'seats':
      return `席（メンバー）+${e.add}`;
    case 'effortPerMonth':
      return `開発の手間 +${e.add} / 月`;
    case 'interrupt':
      return `対応の手間 ${e.points} × ${e.months} か月（翌月から）`;
    case 'feature':
      return `機能開発 +${e.points}`;
    case 'growth':
      return `成長 +${Math.round(e.add * 100)} ポイント × ${e.months} か月`;
  }
}

/** 効果を状態に当てる（traffic はその月の計算で扱うのでここでは何もしない）。 */
function applyEffects(
  state: GameState,
  effects: Effect[],
  eventId: string,
): GameState {
  let s = state;
  for (const e of effects) {
    switch (e.type) {
      case 'workload':
        s = { ...s, mods: { ...s.mods, ...e.mods } };
        break;
      case 'stock':
        s = {
          ...s,
          stock: {
            dbGB: s.stock.dbGB + (e.add.dbGB ?? 0),
            imagesGB: s.stock.imagesGB + (e.add.imagesGB ?? 0),
            images: s.stock.images + (e.add.images ?? 0),
            articlePages: s.stock.articlePages + (e.add.articlePages ?? 0),
          },
        };
        break;
      case 'basePV':
        s = { ...s, basePV: s.basePV * e.factor };
        break;
      case 'seats':
        s = { ...s, seats: s.seats + e.add };
        break;
      case 'effortPerMonth':
        s = { ...s, effortPerMonth: s.effortPerMonth + e.add };
        break;
      case 'interrupt':
        s = {
          ...s,
          interrupts: [
            ...s.interrupts,
            { points: e.points, months: e.months, eventId },
          ],
        };
        break;
      case 'feature':
        s = { ...s, featurePoints: s.featurePoints + e.points };
        break;
      case 'growth':
        s = {
          ...s,
          growthBonus: [...s.growthBonus, { add: e.add, months: e.months }],
        };
        break;
      case 'traffic':
        break;
    }
  }
  return s;
}

function premiseRefsOf(
  def: Pick<EventDef, 'premiseRefs'>,
  premises: readonly PlatformPremise[],
): MonthEvent['premises'] {
  return premises
    .filter((p) => def.premiseRefs.some((ref) => p.id.startsWith(ref)))
    .map((p) => ({
      id: p.id,
      text: p.text,
      hit: p.hit,
      ...(p.ratio !== undefined && Number.isFinite(p.ratio)
        ? { ratio: p.ratio }
        : {}),
    }));
}

/** 1 か月を進める（出来事 → 見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 在庫 → 終わりの判定）。 */
export function playMonth(input: GameState): GameState {
  if (input.phase !== 'playing') return input;
  const sc = scenarioOf(input);
  const month = input.history.length + 1;
  const prev = input.history[input.history.length - 1];

  // 返事のない提案は断ったことにする（罰はない。D-20 V-11）
  let state: GameState = input.pendingProposal
    ? {
        ...input,
        responses: { ...input.responses, [input.pendingProposal]: 'declined' },
        pendingProposal: null,
      }
    : input;

  // 台本: 今月起きる出来事と予告
  const events: MonthEvent[] = [];
  const due = state.schedule.filter((x) => x.month === month);
  const noticed = state.schedule.filter((x) => x.noticeMonth === month);
  let humanFactor = 1;
  let botExtra = 0;
  let lasting = false;
  const trafficEvents: {
    id: string;
    title: string;
    bot: boolean;
    factor: number;
  }[] = [];
  const trafficNotes: string[] = [];
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    const n = def.notice!;
    if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: def.title,
        bot: false,
        factor: n.pvFactor,
      });
      trafficNotes.push(n.text);
    }
  }
  // 続いている流量の出来事（Bot は 2 か月など）
  for (const x of state.schedule) {
    if (x.month > month) continue;
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    for (const e of def.effects ?? []) {
      if (e.type !== 'traffic' || month >= x.month + e.months) continue;
      if (e.bot) {
        const extra =
          (e.factor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
        botExtra += extra;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: true,
          factor: 1 + extra,
        });
        trafficNotes.push(`${def.title}（Bot は収益にならない）`);
      } else {
        humanFactor *= e.factor;
        if (e.lasting) lasting = true;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: false,
          factor: e.factor,
        });
        if (!e.lasting) trafficNotes.push(def.title);
      }
    }
  }
  // 台本の効果（流量以外）は起きた月から効く
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    state = applyEffects(state, def.effects ?? [], def.id);
  }
  const buzz = lasting;
  const basePV = state.basePV;
  const humanPV = basePV * humanFactor;
  const botPV = humanPV * botExtra;
  const pv = humanPV + botPV;

  const stackIndexNow = state.stackIndex;
  const stack = MVP_STACKS[stackIndexNow]!;
  const ssrCpuMs = nextSsrCpuMs(state);
  const parts: WorkloadParts = {
    pv,
    settings: state.settings,
    ssrCpuMs,
    mods: state.mods,
    stock: sc.stock ? state.stock : null,
  };
  const workload = workloadFor(sc, parts);
  const architecture = architectureFor(stackIndexNow, state.seats);
  const r = estimate({ workload, architecture, books });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）
  const target = state.migration
    ? estimate({
        workload,
        architecture: architectureFor(state.migration.to, state.seats),
        books,
      })
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  const infraCost = toUsd(r.bill.totals) + parallelInfraCost;

  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      title: def.title,
      text: def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, r.premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.title,
      text: def.notice!.text,
      effects: [],
      premises: premiseRefsOf(def, r.premises),
    });
  }
  // 状態で起きる出来事（前提の使用率が境目を越えた。一度だけ）
  let fired = state.fired;
  for (const def of sc.events) {
    if (def.when.type !== 'premise' || fired.includes(def.id)) continue;
    const w = def.when;
    const p = r.premises.find(
      (q) => q.id.startsWith(w.premiseId) && (q.ratio ?? 0) >= w.atLeast,
    );
    if (!p) continue;
    fired = [...fired, def.id];
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'occurred',
      title: def.title,
      text: def.text,
      effects: [],
      premises: premiseRefsOf(def, r.premises),
    });
  }
  // 料金データの施行日つきの予告（通知だけ。D-20 V-2）
  if (sc.calendarStart) {
    const used = new Set(
      stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
    );
    for (const b of books)
      for (const c of b.scheduledChanges) {
        if (calendarMonth(sc.calendarStart, c.effectiveFrom) !== month)
          continue;
        events.push({
          id: `calendar:${b.provider}:${c.effectiveFrom}`,
          kind: 'script',
          tier: 'common',
          phase: 'occurred',
          title: `料金・制限の改定の施行（${b.provider}・${c.effectiveFrom}）`,
          text: `${c.description}${used.has(b.provider) ? '' : '（今の構成では使っていない事業者）'}。料金と制限は変わる（料金データの施行日つきの予告）`,
          effects: [],
          premises: [],
        });
      }
  }

  // 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    interrupt: interruptOf(state),
    migrationWanted: migrationWanted(state.migration),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;

  const [rand, seed] = nextRandom(state.seed);
  const incident =
    STACKS[stackIndexNow]!.selfHosted &&
    rand < sc.incidents.selfHostedChancePerMonth;

  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = r.premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = r.premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  const loss = sc.revenue.loss;
  let revenue = (humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - loss.block;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - loss.incident;
    outages++;
    status = 'incident';
    notes.push('VPS の障害で数時間止まった（SLA なし・1 台構成）');
  } else if (throttling.length) {
    revenue *= 1 - loss.throttle;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - loss.migration;
    notes.push('乗り換えの切り替えで収益が減った');
  }

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
  const sat = sc.satisfaction;
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs,
      imageKB: state.settings.imageKB,
      variants: state.settings.variants,
      revalidateSec: state.settings.revalidateSec,
      featurePoints,
      month,
      premises: r.premises,
    },
    sat,
  );
  const reasons = stageReasons(sc, stages, {
    blocking,
    throttling,
    incident,
    switching: state.switching,
    ssrCpuMs,
    settings: state.settings,
    heaviness: speedHeaviness(
      { ...state.settings, ssrCpuMs, premises: r.premises },
      sat,
    ),
    featurePoints,
    month,
  });
  const score = satisfactionScore(stages, sat.weights);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad', sc.growth);
  const bonus = state.growthBonus.reduce(
    (a, b) => a + (b.months > 0 ? b.add : 0),
    0,
  );
  const net = g.net + bonus;

  const cash = state.cash + revenue - infraCost;

  // 前提が初めて境目を越えた月: 出来事を外して見積を引き直し、理由を確かめる（prd/07 §10.7）
  const crossings = crossingsOf(sc, {
    prev,
    premises: r.premises,
    parts,
    architecture,
    humanPV,
    basePV,
    trafficEvents,
    state,
  });

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = stackIndexNow;
  let switching = false;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${MVP_STACKS[migration.to]!.name} に切り替える`,
    );
    migration = null;
  }

  // ためていく量（月ごとに増える。prd/07 §10.4）
  const stock = sc.stock ? grow(sc, state, humanPV) : state.stock;

  const report: MonthReport = {
    month,
    stackName: stack.name,
    buzz,
    ...(trafficNotes.length ? { trafficNote: trafficNotes.join('・') } : {}),
    pv,
    humanPV,
    botPV,
    basePV,
    revenue,
    infraCost,
    parallelInfraCost,
    cash,
    status,
    notes,
    events,
    crossings,
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
    stock: state.stock,
    seats: state.seats,
    satisfaction: {
      stages,
      reasons,
      score,
      reputation: rep,
      acquisition: g.acquisition,
      churn: g.churn,
      growth: buzz ? buzzLasting(rep, sc.buzz) - 1 : net,
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

  // 今月届いた提案は、月の終わりに返事を待つ
  const proposal = due.find((x) => eventDef(sc, x.id)!.kind === 'proposal');

  const history = [...state.history, report];
  const finished = month >= sc.months;
  const end: GameState['end'] = accountSuspended
    ? { reason: 'policy', month }
    : outages > sc.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes(sc, { cash, outages, history }) ? 'won' : 'goal',
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
    stock,
    fired,
    pendingProposal: proposal && !end ? proposal.id : null,
    interrupts: state.interrupts
      .map((i) => ({ ...i, months: i.months - 1 }))
      .filter((i) => i.months > 0),
    growthBonus: state.growthBonus
      .map((b) => ({ ...b, months: b.months - 1 }))
      .filter((b) => b.months > 0),
    basePV: buzz ? basePV * buzzLasting(rep, sc.buzz) : basePV * (1 + net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

function grow(sc: Scenario, state: GameState, humanPV: number): Stock {
  const rule = sc.stock!;
  const w = sc.template(1);
  const mau = humanPV / 10;
  const uploads =
    mau * w.images.uploadsPerMau * (state.mods.uploadsFactor ?? 1);
  const s = state.stock;
  return {
    dbGB:
      s.dbGB +
      (rule.dbGBPerMillionPV * humanPV * (state.mods.dbRateFactor ?? 1)) / 1e6,
    imagesGB:
      s.imagesGB + uploads * rule.gbPerImage * (state.settings.imageKB / 150),
    images: s.images + uploads,
    articlePages: s.articlePages,
  };
}

/** 境目を初めて越えた前提について、出来事ごとに効果を外した見積を引き直す（表示のためだけ）。 */
function crossingsOf(
  sc: Scenario,
  c: {
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    parts: WorkloadParts;
    architecture: ArchitectureInput;
    humanPV: number;
    basePV: number;
    trafficEvents: {
      id: string;
      title: string;
      bot: boolean;
      factor: number;
    }[];
    state: GameState;
  },
): Crossing[] {
  const crossed = c.premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.hit &&
      Number.isFinite(p.ratio ?? NaN) &&
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? 0) <= 1,
  );
  if (!crossed.length) return [];
  // 外してみる候補: 流量の出来事・受けた提案（Workload の変化・在庫の一括の増加）
  const variants: { eventId: string; title: string; parts: WorkloadParts }[] =
    [];
  for (const t of c.trafficEvents) {
    const pv = t.bot
      ? c.parts.pv - c.humanPV * (t.factor - 1)
      : c.parts.pv / t.factor;
    variants.push({ eventId: t.id, title: t.title, parts: { ...c.parts, pv } });
  }
  for (const [id, res] of Object.entries(c.state.responses)) {
    if (res !== 'accepted') continue;
    const def = eventDef(sc, id);
    if (!def?.accept) continue;
    let mods = c.parts.mods;
    let stock = c.parts.stock;
    let pv = c.parts.pv;
    for (const e of def.accept.effects) {
      if (e.type === 'workload') {
        const next = { ...mods };
        for (const k of Object.keys(e.mods) as (keyof WorkloadMods)[])
          delete next[k];
        mods = next;
      } else if (e.type === 'stock' && stock) {
        stock = {
          dbGB: stock.dbGB - (e.add.dbGB ?? 0),
          imagesGB: stock.imagesGB - (e.add.imagesGB ?? 0),
          images: stock.images - (e.add.images ?? 0),
          articlePages: stock.articlePages - (e.add.articlePages ?? 0),
        };
      } else if (e.type === 'basePV') pv /= e.factor;
    }
    variants.push({
      eventId: id,
      title: def.title,
      parts: { ...c.parts, mods, stock, pv },
    });
  }
  const ratios = variants.map((v) => {
    const r = estimate({
      workload: workloadFor(sc, v.parts),
      architecture: c.architecture,
      books,
    });
    return new Map(r.premises.map((p) => [p.id, p.ratio ?? 0]));
  });
  return crossed.map((p) => ({
    premiseId: p.id,
    text: p.text,
    causes: variants.flatMap((v, i) => {
      const without = ratios[i]!.get(p.id) ?? 0;
      return without <= 1
        ? [{ eventId: v.eventId, title: v.title, ratioWithout: without }]
        : [];
    }),
  }));
}

function stageReasons(
  sc: Scenario,
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
    const expected = sc.satisfaction.feature.expectedPerMonth * c.month;
    out.feature = `機能開発 ${c.featurePoints} / 期待 ${expected}`;
  }
  return out;
}

export function averageSatisfaction(history: readonly MonthReport[]): number {
  return history.length
    ? history.reduce((a, r) => a + r.satisfaction.score, 0) / history.length
    : 0;
}

function passes(
  sc: Scenario,
  s: {
    cash: number;
    outages: number;
    history: readonly MonthReport[];
  },
): boolean {
  return (
    s.cash >= sc.goal.cash &&
    averageSatisfaction(s.history) >= sc.goal.satisfaction &&
    s.outages <= sc.goal.maxOutageMonths
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
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId)!;
      const responded: GameState = {
        ...state,
        pendingProposal: null,
        responses: {
          ...state.responses,
          [def.id]: action.accept ? 'accepted' : 'declined',
        },
      };
      return withNote(
        `提案「${def.title}」を${action.accept ? '受けた' : '断った'}`,
        action.accept
          ? applyEffects(responded, def.accept!.effects, def.id)
          : responded,
      );
    }
    case 'block-bots':
      return withNote('Bot を遮断するルールを入れた', {
        ...state,
        ...planned,
        botBlocked: true,
      });
  }
}

export function applyActions(
  state: GameState,
  actions: readonly Action[],
): GameState {
  return actions.reduce(applyAction, state);
}

/** 今月見込みを出さない理由（一時的に流量が増えた月。プレイヤーにも見えている出来事。prd/07 §10.7）。 */
export function projectionNote(r: MonthReport): string | undefined {
  if (r.buzz)
    return '話題になった月の伸びは続かないかもしれないので、今月は見込みを出さない';
  if (r.trafficNote)
    return `一時的に流量が増えた月（${r.trafficNote}）なので、今月は見込みを出さない`;
  return undefined;
}

// ---- 評価（prd/07 §9.6）----

export type Axes = {
  /** 累積の利益（最終の所持金 − 開始時）。 */
  profit: number;
  satisfaction: number;
  /** 要素ごとの平均の段階の数値（0〜1）。 */
  elements: Record<Element, number>;
  /** 最終月の基準の PV（話題・Bot の倍率を除く）。 */
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
  const total = h.reduce((a, r) => a + r.effort.total, 0);
  return {
    profit: state.cash - scenarioOf(state).startCash,
    satisfaction: averageSatisfaction(h),
    elements,
    finalPV: last ? last.basePV : 0,
    featurePoints: state.featurePoints,
    featureShare: total ? state.featurePoints / total : 0,
  };
}

export type Check = {
  label: string;
  ok: boolean;
  value: string;
  target: string;
};

export function goalChecks(state: GameState): Check[] {
  const goal = scenarioOf(state).goal;
  const avg = averageSatisfaction(state.history);
  return [
    {
      label: '所持金',
      ok: state.cash >= goal.cash,
      value: `$${state.cash.toFixed(2)}`,
      target: `$${goal.cash} 以上`,
    },
    {
      label: '満足度の平均',
      ok: avg >= goal.satisfaction,
      value: avg.toFixed(2),
      target: `${goal.satisfaction} 以上`,
    },
    {
      label: '止まった月',
      ok: state.outages <= goal.maxOutageMonths,
      value: `${state.outages} 回`,
      target: `${goal.maxOutageMonths} 回以内`,
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

export type Surprise = {
  premiseId: string;
  text: string;
  month: number;
  cause:
    | { kind: 'event'; title: string; ratioWithout: number }
    | { kind: 'action'; action: string }
    | { kind: 'growth' };
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
  /** 見込みより早く超えた前提と、その理由（prd/07 §10.7）。 */
  surprises: Surprise[];
};

/**
 * 見込みが外れた理由（prd/07 §10.7）。境目を初めて越えた月の記録（crossings）から、
 * ① 外すと越えなかった出来事 → ② 前の月のプレイヤーの行動 → ③ 伸びが直近より速かった、の順に理由を決める。
 * earlierIds を渡すと、その前提（推移の見込みより早く超えたもの）だけに絞る。
 */
export function surprisesOf(
  state: GameState,
  earlierIds?: readonly string[],
): Surprise[] {
  const out: Surprise[] = [];
  for (const r of state.history)
    for (const c of r.crossings) {
      if (earlierIds && !earlierIds.includes(c.premiseId)) continue;
      const before = state.history[r.month - 2];
      const top = [...c.causes].sort(
        (a, b) => a.ratioWithout - b.ratioWithout,
      )[0];
      out.push({
        premiseId: c.premiseId,
        text: c.text,
        month: r.month,
        cause: top
          ? { kind: 'event', title: top.title, ratioWithout: top.ratioWithout }
          : before?.action
            ? { kind: 'action', action: before.action }
            : { kind: 'growth' },
      });
    }
  return out;
}

/** 振り返り（①前提とその月の選択 ②「悪い」になった月と理由 ③手間の内訳 ④見込みが外れた理由）。 */
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
    surprises: surprisesOf(state),
  };
}

// ---- 基準プレイ（目標値の根拠・成績の目盛り。prd/07 §9.6・§10.8）----

/** 記事コミュニティの基準プレイ（シナリオのデータ）。 */
export const BASELINES: Strategy[] = ARTICLE_COMMUNITY.baselines;

export function playStrategy(
  s: Strategy,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
): GameState {
  let st = playMonth(newGame(s.stackIndex, seed, scenario));
  for (let i = 0; st.phase === 'playing'; i++)
    st = playMonth(
      applyActions(st, s.decide ? s.decide(st) : (s.actions?.[i] ?? [])),
    );
  return st;
}

export type ComparisonRow = {
  id: string;
  /** 表の 1 列目に出す名前（基準プレイは短い名前）。 */
  name: string;
  /** 長い説明（ツールチップ用）。 */
  description: string;
  axes: Axes;
  you: boolean;
};

/** 結果の比較の表の行（あなた + 同じシードの基準プレイ）。表示用の名前はここで決める。 */
export function comparisonRows(state: GameState): ComparisonRow[] {
  const sc = scenarioOf(state);
  return [
    {
      id: 'you',
      name: 'あなた',
      description: 'あなたのプレイ',
      axes: axesOf(state),
      you: true,
    },
    ...sc.baselines.map((b) => ({
      id: b.id,
      name: b.short ?? b.label,
      description: b.label,
      axes: axesOf(playStrategy(b, state.startSeed, sc)),
      you: false,
    })),
  ];
}

export * from './rules.ts';
export * from './trends.ts';
export * from './scenario.ts';
export { ARTICLE_COMMUNITY };
