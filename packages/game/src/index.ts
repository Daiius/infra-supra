// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間、GD-3 でシナリオのデータと出来事を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// シナリオの値（収益・成長・手間・満足度・障害の影響・出来事・目標）はゲーム上の仮定で、実在の値ではない（prd/07 §10）。
import {
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  DEFAULT_CHOICES,
  loadPriceBooks,
  MVP_STACKS,
  SLOT_LABELS,
  STACK_DEFS,
  type Choices,
  type Platform,
  type SlotId,
} from 'catalog';
import {
  estimate,
  type ArchitectureInput,
  type LineItem,
  type PlatformPremise,
  type PriceBook,
  type ScheduledChange,
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
  rollRevisions,
  rollSchedule,
  type Effect,
  type EventDef,
  type Requirement,
  type EventKind,
  type EventTier,
  type Scenario,
  type Scheduled,
  type Stock,
  type Strategy,
  type WorkloadMods,
} from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import { premiseTrends, type PremiseSnapshot } from './trends.ts';

/** 組み込みのシナリオ（id で引く。保存したゲームを読み込むときに使う）。ゲームの計算はこの表を書き換えない。 */
export const SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  [ARTICLE_COMMUNITY.id]: ARTICLE_COMMUNITY,
});

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
  | { type: 'block-bots' }
  /** スロットの部品を差し替える（同じ事業者の中。D-24・prd/07 §11.3）。 */
  | { type: 'component'; slot: SlotId; option: string }
  /** さくらの VPS のストレージ変更オプションを付ける（ディスク 2 倍・手数料一度だけ・戻せない。D-30）。 */
  | { type: 'storage-option' };

/** DB の差し替えの進行（データの移行。期間中は新旧の両方の DB の費用）。 */
export type ComponentSwap = {
  slot: SlotId;
  option: string;
  required: number;
  done: number;
};

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
  /**
   * 予告を持ちうる台本が起きた月: true は予告どおり、false は予告なしで今月起きた（対処は来月から。D-28）。
   */
  announced?: boolean;
  /** 提案の「受ける」の説明。unavailable は受けられない理由（要件を満たせる構成が無い）。 */
  accept?: {
    label: string;
    effects: string[];
    effort: number;
    unavailable?: string;
  };
  /** 今の構成の SLA の扱い（catalog の uptimeSla）。 */
  sla?: string[];
  /** 要件を満たせるか（部品ごと。受ける前に出す。D-32）。 */
  requirementStatus?: {
    label: string;
    ok: boolean;
    reason: string;
    current: boolean;
  }[];
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
  /** その月の部品の選択（D-24）と、画面に出す要約（選べるスロットだけ）。 */
  components: Choices;
  componentSummary: string;
  componentSwap?: { label: string; done: number; required: number };
  /** 契約の収益（SLA の出来事。収益 revenue に含む）。 */
  contractRevenue: number;
  action?: string;
};

export type GameState = {
  scenarioId: string;
  /**
   * 遊んでいるシナリオ（newGame に渡した不変の入力）。月の計算はこれだけを読む。
   * 保存するときは scenarioId だけを書き、読み込みで SCENARIOS から引き直す（prd/07 §10.1）。
   */
  scenario: Scenario;
  seed: number; // 偶発的な障害の乱数の内部状態（保存すれば同じ続きになる）
  /** 始めたときのシード（台本の表・基準プレイを同じシードで回すため）。 */
  startSeed: number;
  /** 台本の表（newGame で一度に作る。プレイヤーの選択に依存しない）。 */
  schedule: Scheduled[];
  /** 始めた日（YYYY-MM-DD・画面が渡す。エンジンは時刻に触れない）。改定の出来事の条件に使う（D-21）。 */
  startDate: string;
  /** 実際に予告されている改定の出来事（始めた日が施行日より前のものだけ）と、起きる月。 */
  revisions: { id: string; month: number }[];
  stackIndex: number;
  /** 部品の選択（今の構成の事業者のスロット。D-24）。 */
  components: Choices;
  /** 進行中の DB の差し替え。 */
  componentSwap: ComponentSwap | null;
  /** 受けた契約（毎月の収益。要件を満たす月だけ入る）。 */
  contracts: { eventId: string; usdPerMonth: number; requires: Requirement }[];
  /** 受けた提案で以後ずっと求められる要件（D-32）。 */
  requirements: Requirement[];
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
  /** さくらの VPS のストレージ変更オプション（付けたら戻せない）と、手数料をまだ払っていないか（D-30）。 */
  storageOption: boolean;
  /** 申し込んだときのプランの手数料（まだ払っていない。払ったら null。OCL-91E46AC4）。 */
  storageOptionFeeDue: { name: string; amount: number } | null;
  /** 返事を待っている提案。 */
  pendingProposals: string[];
  responses: Record<string, 'accepted' | 'declined'>;
  /** 一度起きた状態の出来事。 */
  fired: string[];
  /** 出来事への対応の手間（毎月 points を months か月）。 */
  interrupts: {
    points: number;
    months: number;
    eventId: string;
    /** 機能の追加の作業（機能開発に数える）と、毎月の加点（D-29）。 */
    featureWork?: boolean;
    bonus?: number;
  }[];
  /** 成長率への上乗せ（毎月 add を months か月）。 */
  growthBonus: { add: number; months: number }[];
  history: MonthReport[];
  phase: 'playing' | 'won' | 'lost';
  end?: { reason: EndReason; month: number };
};

export function scenarioOf(state: Pick<GameState, 'scenario'>): Scenario {
  return state.scenario;
}

export function eventDef(sc: Scenario, id: string): EventDef | undefined {
  return sc.events.find((e) => e.id === id);
}

export const STACKS = MVP_STACKS.map((s, i) => ({
  index: i,
  id: s.id,
  name: s.name,
  /** 事業者（同じ事業者のあいだはプラン変更。さくらの VPS 2GB ↔ 4GB も含む。D-24）。 */
  provider: STACK_DEFS[i]!.platform as Platform,
  plan: STACK_DEFS[i]!.plan,
  selfHosted: s.nodes.some((n) => n.config.kind === 'host'),
  /** ホストのディスク（VPS だけ。下位のプランへ変更できるかの判定に使う）。 */
  diskGB: s.nodes.reduce(
    (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
    0,
  ),
}));

const books = loadPriceBooks();

/** 既定の始めた日（料金データの取得日）。テストと基準プレイの golden はこの日で固定する。 */
export const DEFAULT_START_DATE = '2026-10-31';

/** catalog の施行日つきの予告（id は事業者と施行日）。 */
export const SCHEDULED_CHANGES: (ScheduledChange & {
  id: string;
  provider: string;
})[] = books.flatMap((b) =>
  b.scheduledChanges.map((c) => ({
    ...c,
    id: `revision:${b.provider}:${c.effectiveFrom}`,
    provider: b.provider,
  })),
);

/**
 * その月の料金データ（D-21）。起きた改定のうち、改定後の料金を持つものだけメーターの料金を差し替える。
 * 改定後の料金が無い予告は計算を変えない。同じメーターの改定が複数起きていれば、後に起きたほうを使う。
 */
export function applyRevisions(
  base: readonly PriceBook[],
  changes: readonly (ScheduledChange & { id: string; provider: string })[],
  revisions: readonly { id: string; month: number }[],
  month: number,
): PriceBook[] {
  const occurred = (c: { id: string }) =>
    revisions.find((r) => r.id === c.id && r.month <= month)?.month;
  // 起きた月の順（同じ月なら施行日の順）。後ろの改定が前の改定を上書きする
  const due = changes
    .filter((c) => c.revisedMeters.length > 0 && occurred(c) !== undefined)
    .sort(
      (a, b) =>
        occurred(a)! - occurred(b)! ||
        a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
  if (!due.length) return [...base];
  return base.map((b) => {
    const mine = due.filter((c) => c.provider === b.provider);
    if (!mine.length) return b;
    return {
      ...b,
      plans: b.plans.map((p) => ({
        ...p,
        meters: p.meters.map((m) => {
          const rv = mine
            .flatMap((c) => c.revisedMeters)
            .findLast((x) => x.planId === p.id && x.meterId === m.id);
          return rv ? { ...m, pricing: rv.pricing } : m;
        }),
      })),
    };
  });
}

const booksAt = (state: Pick<GameState, 'revisions'>, month: number) =>
  applyRevisions(books, SCHEDULED_CHANGES, state.revisions, month);

/** 改定の出来事の文（D-21）。計算への影響を正確に書く。 */
export function revisionText(
  c: (typeof SCHEDULED_CHANGES)[number],
  usedByStack: boolean,
): string {
  const effect =
    c.revisedMeters.length > 0
      ? 'あり（改定後の料金を公式の出典つきで持っているので、今月から改定後の料金で計算する）'
      : `なし（${c.notModeledReason}）`;
  return `実際に予告されている改定（${c.provider}・施行日 ${c.effectiveFrom}）: ${c.description}。${usedByStack ? '' : '今の構成では使っていない事業者。'}このモデルの計算への影響: ${effect}`;
}

export { nextRandom };

/** Workload を組み立てる入力（反実仮想の見積でも同じ関数を使う）。 */
type WorkloadParts = {
  pv: number;
  settings: Settings;
  ssrCpuMs: number;
  mods: WorkloadMods;
  stock: Stock | null;
  platform: Platform;
  components: Choices;
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
  if (p.mods.realtime) w.realtime = p.mods.realtime;
  // 部品が Workload の側を変えるもの（キャッシュしない・サイズ違いを作る時・最適化しない。D-24）
  return applyComponentsToWorkload(w, p.platform, p.components, {
    originalImageKB: sc.unoptimizedImageKB,
  });
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

/** 部品の選択と席を足した構成（席課金のプランだけ費用が変わる）。standby は差し替えの途中の新しい部品。 */
function architectureFor(
  stackIndex: number,
  seats: number,
  components: Choices = {},
  standby: Choices = {},
  storageOption = false,
): ArchitectureInput {
  const stack = composeStack(STACK_DEFS[stackIndex]!, components, {
    standby,
    storageOption,
  });
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

/** 構成が要件を満たすか。uptime-sla: 課金先のプランがすべて稼働率の SLA を持つ（catalog の uptimeSla）。 */
export function meetsRequirement(
  stackIndex: number,
  requirement: Requirement,
  components: Choices = {},
): boolean {
  switch (requirement) {
    case 'on-demand-isr':
      return onDemandBlocker(stackIndex, components) === undefined;
    case 'uptime-sla': {
      const plans = composeStack(STACK_DEFS[stackIndex]!, components)
        .nodes.flatMap((n) => (n.billing ? [n.billing] : []))
        .map((b) =>
          books
            .find((x) => x.provider === b.provider)
            ?.plans.find((p) => p.id === b.planId),
        );
      return (
        plans.length > 0 &&
        plans.every((p) => p?.uptimeSla?.status === 'offered')
      );
    }
  }
}

/** 今の構成のプラン変更で要件を満たせるか（受けられない提案の判定）。 */
export function requirementReachable(
  stackIndex: number,
  requirement: Requirement,
): boolean {
  return STACKS.some(
    (s) =>
      s.provider === STACKS[stackIndex]!.provider &&
      meetsRequirement(s.index, requirement),
  );
}

const REQUIREMENT_LABEL: Record<Requirement, string> = {
  'uptime-sla': '稼働率の SLA があるプラン',
  'on-demand-isr': '即時反映（オンデマンド ISR）',
};

/** catalog の事実を「provider:planId:factId」で引く。 */
function factByRef(ref: string) {
  const [provider, planId, factId] = ref.split(':');
  return books
    .find((b) => b.provider === provider)
    ?.plans.find((p) => p.id === planId)
    ?.facts.find((f) => f.id === factId);
}

/** 即時反映を妨げている部品（無ければ undefined）。理由は catalog の事実の文（D-32）。 */
function onDemandBlocker(
  stackIndex: number,
  components: Choices = {},
): { slot: SlotId; label: string; reason: string } | undefined {
  const platform = STACKS[stackIndex]!.provider;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[]) {
    const opt = componentsOf(platform, slot).find((o) => o.id === c[slot]);
    if (opt?.onDemandIsr && !opt.onDemandIsr.ok)
      return {
        slot,
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
      };
  }
  return undefined;
}

/**
 * 要件を満たせるかを、今の事業者の部品ごとに並べる（受ける前のカードに出す。D-32）。
 * 今の部品の組み合わせと、要件にかかわるスロットの選択肢それぞれ。
 */
export function requirementStatus(
  stackIndex: number,
  components: Choices,
  requirement: Requirement,
): { label: string; ok: boolean; reason: string; current: boolean }[] {
  if (requirement !== 'on-demand-isr') return [];
  const platform = STACKS[stackIndex]!.provider;
  const c = { ...DEFAULT_CHOICES[platform], ...components };
  const out: {
    label: string;
    ok: boolean;
    reason: string;
    current: boolean;
  }[] = [];
  for (const slot of Object.keys(SLOT_LABELS) as SlotId[])
    for (const opt of componentsOf(platform, slot)) {
      if (!opt.onDemandIsr) continue;
      out.push({
        label: `${SLOT_LABELS[slot]}: ${opt.label}`,
        ok: opt.onDemandIsr.ok,
        reason: factByRef(opt.onDemandIsr.fact)?.premise ?? '',
        current: c[slot] === opt.id,
      });
    }
  return out;
}

/** 構成が使うプランの SLA の扱いの文（catalog の uptimeSla）。 */
export function slaOf(stackIndex: number): string[] {
  const out = new Set<string>();
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const plan = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId);
    if (plan?.uptimeSla) out.add(plan.uptimeSla.premise);
  }
  return [...out];
}

/** 乗り換えた先の部品の選択（既定。チャットを持っていれば Durable Objects を付ける。D-24 X-9）。 */
function componentsAfterMigration(to: number, mods: WorkloadMods): Choices {
  const platform = STACKS[to]!.provider;
  const base = { ...DEFAULT_CHOICES[platform] };
  if (mods.realtime && platform === 'cloudflare')
    base.realtime = 'durable-objects';
  return base;
}

function withoutRealtime(mods: WorkloadMods): WorkloadMods {
  const out = { ...mods };
  delete out.realtime;
  return out;
}

/** その事業者で、今の部品の選択がリアルタイムを持てるか（チャットを受けたあと）。 */
function realtimeSupported(platform: Platform): boolean {
  return componentsOf(platform, 'realtime').length > 0;
}

export function componentLabel(
  platform: Platform,
  slot: SlotId,
  option: string | undefined,
): string {
  return (
    componentsOf(platform, slot).find((c) => c.id === option)?.label ??
    option ??
    '—'
  );
}

/** 今の構成のプランのストレージ変更オプション（さくらの VPS だけ。catalog の addons。D-30）。 */
export function storageOptionAddon(stackIndex: number) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const a = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.addons.find((x) => x.id === 'storage-change');
    if (a) return a;
  }
  return undefined;
}

/** ストレージ変更オプションの選択肢の文（名前・メタ情報・説明）。VPS でなければ undefined。 */
export function storageOptionText(
  stackIndex: number,
): { name: string; meta: string[]; detail: string } | undefined {
  const addon = storageOptionAddon(stackIndex);
  if (!addon) return undefined;
  const disk = (option: boolean) =>
    composeStack(
      STACK_DEFS[stackIndex]!,
      {},
      { storageOption: option },
    ).nodes.reduce(
      (a, n) => (n.config.kind === 'host' ? n.config.diskGB : a),
      0,
    );
  const scaleUp = STACKS.filter(
    (x) => x.provider === STACKS[stackIndex]!.provider,
  )
    .map((x) => stackFact(x.index, 'scale-up'))
    .find((f) => f !== undefined);
  return {
    name: 'ストレージ変更オプションを付ける',
    meta: [
      `ディスク ${disk(false)} → ${disk(true)} GB`,
      `手数料 ${addon.oneTimeFee.toLocaleString('ja-JP')} 円（一度だけ）`,
      `手間 ${EFFORT.storageOption}`,
      '来月から',
    ],
    detail: `${addon.premise}。申し込みはスケールアップと同じ手順で、${scaleUp?.premise ?? 'サーバーを停止して行う'}。計画的な短い停止なので、止まった月には数えない。戻せない（${addon.interpretation?.adopted ?? ''}）。性能差はこの計算に入れていない。上位のプランへ変更してもオプションは残るとみなす（公式に記載なし）。乗り換え・契約し直しでは外れる。`,
  };
}

/** 同じ事業者のプランの変更か（Cloudflare Free ↔ Paid・Vercel Hobby ↔ Pro）。 */
export function isPlanChange(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    !isRecontract(from, to)
  );
}

/** 構成のプランが持つ事実（catalog の Plan の facts）。 */
function stackFact(stackIndex: number, factId: string) {
  for (const n of MVP_STACKS[stackIndex]!.nodes) {
    if (!n.billing) continue;
    const f = books
      .find((b) => b.provider === n.billing!.provider)
      ?.plans.find((p) => p.id === n.billing!.planId)
      ?.facts.find((x) => x.id === factId);
    if (f) return f;
  }
  return undefined;
}

/**
 * 同じ事業者でも、下位のプランへは変更できず契約し直す（さくらの VPS は今よりディスクが少ないプランへ変更できない。D-27）。
 * 乗り換えと同じ仕組み（手間・期間・新旧両方の費用）で扱う。
 */
export function isRecontract(from: number, to: number): boolean {
  return (
    from !== to &&
    STACKS[from]!.provider === STACKS[to]!.provider &&
    STACKS[to]!.diskGB < STACKS[from]!.diskGB &&
    stackFact(from, 'no-smaller-disk') !== undefined
  );
}

/** プラン変更の手間（さくらの VPS の上位への変更は停止とディスクの拡張の作業がある。D-27）。 */
export function planChangeEffort(from: number): number {
  return stackFact(from, 'scale-up') ? EFFORT.scaleUp : EFFORT.plan;
}

/** 乗り換えに必要な手間の合計（VPS が絡むと長い。下位のプランへの契約し直しは別の値）。 */
export function migrationEffort(from: number, to: number): number {
  const m = EFFORT.migrationMonths;
  const months = isRecontract(from, to)
    ? m.recontract
    : STACKS[from]!.selfHosted || STACKS[to]!.selfHosted
      ? m.selfHosted
      : m.serverless;
  return months * EFFORT.migrationPerMonth;
}

/**
 * 構成を変える選択肢（プラン変更・契約し直し・乗り換え）。label は判断に直接効く数だけの短い文、
 * detail は理由・事実の説明（画面の ⓘ に出す。前提の文は catalog の facts）。
 */
export function stackChangeText(
  from: number,
  to: number,
): { name: string; meta: string[]; detail: string } {
  const target = STACKS[to]!.name;
  const months = migrationEffort(from, to) / EFFORT.migrationPerMonth;
  const per = EFFORT.migrationPerMonth;
  const both = '期間中は新旧両方の費用';
  if (isPlanChange(from, to)) {
    const effort = planChangeEffort(from);
    const fact = stackFact(from, 'scale-up');
    return effort === 0
      ? {
          name: `${target} にプラン変更`,
          meta: ['手間なし', '来月から'],
          detail:
            '同じ事業者のプランの変更。上限と込み分が変わり、来月から効く。',
        }
      : {
          name: `${target} にプラン変更`,
          meta: [`手間 ${effort}`, '来月から'],
          detail: `${fact?.premise ?? ''}。計画的な短い停止なので、止まった月には数えない。`,
        };
  }
  if (isRecontract(from, to))
    return {
      name: `${target} へ契約し直す`,
      meta: [`${per} × ${months} か月`, both],
      detail: `${stackFact(from, 'no-smaller-disk')!.premise}。新しく契約してデータを移す間は、新旧両方を動かして両方の費用を払う。`,
    };
  return {
    name: `${target} へ乗り換える`,
    meta: [`${per} × ${months} か月`, both],
    detail:
      '別の事業者へ移す。作業の間は新旧両方の構成を動かして両方の費用を払い、済んだ翌月に切り替わる（その月は収益が少し減る）。部品は乗り換え先の既定の選択から始まる。',
  };
}

function upkeepFor(
  state: Pick<GameState, 'stackIndex' | 'migration' | 'scenario'>,
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

function swapWanted(s: ComponentSwap | null): number {
  return s ? Math.min(EFFORT.dbSwap.perMonth, s.required - s.done) : 0;
}

const interruptOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && !i.featureWork ? i.points : 0),
    0,
  );
const featureWorkOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? i.points : 0),
    0,
  );
const featureBonusOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? (i.bonus ?? 0) : 0),
    0,
  );

/** 次の月に、まだ行動に使える手間。 */
export function effortAvailable(state: GameState): number {
  return (
    state.effortPerMonth -
    upkeepFor(state) -
    interruptOf(state) -
    featureWorkOf(state) -
    migrationWanted(state.migration) -
    swapWanted(state.componentSwap) -
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

/** 行動を選べない理由（画面はこの文をそのまま出す）。 */
export type ActionBlockReason =
  | 'not-playing' // ゲームが終わっている
  | 'invalid' // 存在しない選択肢
  | 'same' // 今と同じ・すでに選んでいる（予定済み）
  | 'irreversible' // 戻せない（チャットを受けたあとのリアルタイムなど）
  | 'busy' // 乗り換え・DB の差し替えの最中
  | 'unavailable' // 要件を満たせる構成が無い（SLA など）
  | 'via-proposal' // 提案を受けると付く部品
  | 'limit' // これ以上できない（SSR の最適化の下限など）
  | 'effort'; // 手間が足りない

export type ActionCheck =
  | { ok: true; cost: number }
  | { ok: false; reason: ActionBlockReason; message: string };

const ok = (cost: number): ActionCheck => ({ ok: true, cost });
const ng = (reason: ActionBlockReason, message: string): ActionCheck => ({
  ok: false,
  reason,
  message,
});

/**
 * その部品を付ける提案が届いているか（部品の欄で選ぶのは、その提案を受けるのと同じ。D-24 の画面確認）。
 * 届いている提案の「受ける」の効果に、同じスロット・同じ部品を付ける効果があればその id。
 */
export function componentProposal(
  state: Pick<GameState, 'pendingProposals' | 'scenario'>,
  slot: SlotId,
  option: string,
): string | undefined {
  const sc = scenarioOf(state);
  return state.pendingProposals.find((id) =>
    eventDef(sc, id)?.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/** 提案で付く部品か（どの提案の「受ける」にも、この部品を付ける効果がある）。 */
function proposalOnlyComponent(
  sc: Scenario,
  slot: SlotId,
  option: string,
): EventDef | undefined {
  return sc.events.find((d) =>
    d.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/** 行動の規則（手間の残りは見ない）。選べない理由を区別して返す。 */
function actionRule(state: GameState, action: Action): ActionCheck {
  if (state.phase !== 'playing')
    return ng('not-playing', 'ゲームは終わっている');
  const busy = state.migration
    ? ng('busy', '乗り換えの最中は選べない')
    : state.componentSwap
      ? ng('busy', 'DB の差し替え（データの移行）の最中は選べない')
      : null;
  switch (action.type) {
    case 'none':
      return ok(0);
    case 'set': {
      const def = SETTINGS[action.key];
      if (!def || !def.options.some((o) => o.value === action.value))
        return ng('invalid', '選択肢に無い');
      if (state.settings[def.field] === action.value)
        return ng('same', '今と同じ（または選択済み）');
      return ok(def.effort);
    }
    case 'optimize':
      return nextSsrCpuMs(state) > EFFORT.minSsrCpuMs
        ? ok(EFFORT.optimize)
        : ng(
            'limit',
            `SSR の CPU は ${EFFORT.minSsrCpuMs} ms より下げられない`,
          );
    case 'plan':
    case 'migrate': {
      if (busy) return busy;
      if (!STACKS[action.stackIndex]) return ng('invalid', '構成が無い');
      if (action.stackIndex === state.stackIndex)
        return ng('same', '今の構成と同じ');
      const plan = isPlanChange(state.stackIndex, action.stackIndex);
      if ((action.type === 'plan') !== plan)
        return ng(
          'invalid',
          plan
            ? '同じ事業者なのでプラン変更'
            : isRecontract(state.stackIndex, action.stackIndex)
              ? '今よりディスク容量が少ないプランへは変更できないので契約し直し'
              : '別の事業者なので乗り換え',
        );
      // 乗り換えの手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(plan ? planChangeEffort(state.stackIndex) : 0);
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId);
      if (!def?.accept) return ng('invalid', '提案が無い');
      if (!state.pendingProposals.includes(action.eventId))
        return ng('same', 'すでに返事をした');
      if (action.accept) {
        const why = unavailableReason(state, def);
        if (why) return ng('unavailable', why);
      }
      return ok(action.accept ? acceptEffort(def) : 0);
    }
    case 'storage-option': {
      if (busy) return busy;
      if (!storageOptionAddon(state.stackIndex))
        return ng('invalid', 'さくらの VPS のときだけ');
      if (state.storageOption)
        return ng('same', 'すでに付けている（戻せない）');
      return ok(EFFORT.storageOption);
    }
    case 'block-bots':
      return state.botBlocked
        ? ng('same', 'すでに入れている')
        : ok(BOT_BLOCK.effort);
    case 'component': {
      if (busy) return busy;
      const sc = scenarioOf(state);
      const platform = STACKS[state.stackIndex]!.provider;
      const opt = componentsOf(platform, action.slot).find(
        (c) => c.id === action.option,
      );
      if (!opt) return ng('invalid', 'この事業者の部品に無い');
      const current = { ...DEFAULT_CHOICES[platform], ...state.components };
      if (current[action.slot] === action.option)
        return ng('same', '今の部品（または選択済み）');
      // チャットを受けたあとはリアルタイムを外せない
      if (action.slot === 'realtime' && state.mods.realtime)
        return ng('irreversible', 'チャットを受けたので外せない');
      // 提案で付く部品は、提案が届いている月だけ選べる（選ぶと提案を受けたのと同じ）
      const via = proposalOnlyComponent(sc, action.slot, action.option);
      if (via) {
        const pending = componentProposal(state, action.slot, action.option);
        if (!pending)
          return ng('via-proposal', `提案「${via.title}」を受けると付く`);
        return actionRule(state, {
          type: 'respond',
          eventId: pending,
          accept: true,
        });
      }
      if (action.slot === 'db') return ok(0); // 進行中の月ごとに取る（effortAvailable が減る）
      return ok(EFFORT.component[action.slot]);
    }
  }
}

/** 行動の手間（選べない行動は null。手間の残りは見ない）。 */
export function actionEffort(state: GameState, action: Action): number | null {
  const r = actionRule(state, action);
  return r.ok ? r.cost : null;
}

/** 行動を今選べるか（規則と手間の残り）。選べなければ理由を区別して返す。 */
export function checkAction(state: GameState, action: Action): ActionCheck {
  const r = actionRule(state, action);
  if (!r.ok) return r;
  const left = effortAvailable(state);
  const short = (need: number) => ng('effort', `手間が足りない: あと ${need}`);
  if (r.cost > left) return short(r.cost - left);
  if (action.type === 'migrate') {
    const m: Migration = {
      from: state.stackIndex,
      to: action.stackIndex,
      required: migrationEffort(state.stackIndex, action.stackIndex),
      done: 0,
    };
    const after = effortAvailable({ ...state, migration: m });
    if (after < 0) return short(-after);
  }
  if (
    action.type === 'component' &&
    action.slot === 'db' &&
    !proposalOnlyComponent(scenarioOf(state), action.slot, action.option)
  ) {
    const after = effortAvailable({
      ...state,
      componentSwap: {
        slot: 'db',
        option: action.option,
        required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
        done: 0,
      },
    });
    if (after < 0) return short(-after);
  }
  return r;
}

/**
 * 行動を順に当て、最初に選べなかった行動の理由を返す（画面の選択肢の表示に使う）。すべて選べれば ok。
 */
export function checkActions(
  state: GameState,
  actions: readonly Action[],
):
  | { ok: true; state: GameState }
  | { ok: false; index: number; reason: ActionBlockReason; message: string } {
  let s = state;
  for (const [index, a] of actions.entries()) {
    const c = checkAction(s, a);
    if (!c.ok)
      return { ok: false, index, reason: c.reason, message: c.message };
    s = applyAction(s, a);
  }
  return { ok: true, state: s };
}

/** 部品の選択肢（今の事業者のスロットごと）と、今の部品。画面の「部品」の欄に使う。 */
export function componentSlots(state: GameState): {
  slot: SlotId;
  label: string;
  current: string;
  options: ReturnType<typeof componentsOf>;
}[] {
  const platform = STACKS[state.stackIndex]!.provider;
  const current = { ...DEFAULT_CHOICES[platform], ...state.components };
  return (Object.keys(SLOT_LABELS) as SlotId[])
    .map((slot) => ({
      slot,
      label: SLOT_LABELS[slot],
      current: current[slot] ?? '',
      options: componentsOf(platform, slot),
    }))
    .filter((x) => x.options.length > 1);
}

/** 部品の差し替えの手間の説明（DB は進行中の月ごと）。 */
export function componentEffortLabel(slot: SlotId): string[] {
  return slot === 'db'
    ? [
        `${EFFORT.dbSwap.perMonth} × ${EFFORT.dbSwap.months} か月`,
        '期間中は新旧両方の費用',
      ]
    : [`手間 ${EFFORT.component[slot]}`, '来月から'];
}

/**
 * 部品を選ぶ前に出す、当たりうる前提（D-24・選ぶ前に前提の文を出す）。今月の基準の PV で、その部品に替えた見積を引き、
 * 部品の premiseRefs に当たる前提を返す。表示のためだけで、ゲームの状態には入れない。
 */
export function componentPreview(
  state: GameState,
  slot: SlotId,
  option: string,
): MonthEvent['premises'] {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const def = componentsOf(platform, slot).find((c) => c.id === option);
  if (!def || def.premiseRefs.length === 0) return [];
  const components = { ...state.components, [slot]: option };
  const r = estimate({
    workload: workloadFor(sc, {
      pv: state.basePV,
      settings: state.settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: sc.stock ? state.stock : null,
      platform,
      components,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      components,
      {},
      state.storageOption,
    ),
    books: booksAt(state, state.history.length + 1),
  });
  return premiseRefsOf(def, r.premises);
}

/** 提案を受けられない理由（要件を満たせる構成がプラン変更でも無い）。 */
export function unavailableReason(
  state: Pick<GameState, 'stackIndex'>,
  def: EventDef,
): string | undefined {
  if (!def.requires || requirementReachable(state.stackIndex, def.requires))
    return undefined;
  return `今の事業者では「${REQUIREMENT_LABEL[def.requires]}」を選べない（セルフサービスのプランに無く、Enterprise などの契約の料金は取得していない）`;
}

export function newGame(
  stackIndex: number,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
  startDate: string = DEFAULT_START_DATE,
): GameState {
  return {
    startDate,
    revisions: rollRevisions(scenario, seed, startDate, SCHEDULED_CHANGES),
    scenarioId: scenario.id,
    scenario,
    seed,
    startSeed: seed,
    schedule: rollSchedule(scenario, seed),
    stackIndex,
    components: { ...DEFAULT_CHOICES[STACKS[stackIndex]!.provider] },
    storageOption: false,
    storageOptionFeeDue: null,
    componentSwap: null,
    contracts: [],
    requirements: [],
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
    pendingProposals: [],
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
      if (e.featureWork)
        return `機能の追加の作業 ${e.points} × ${e.months} か月（翌月から。その月の機能開発に数える）`;
      return `対応の手間 ${e.points} × ${e.months} か月（翌月から）`;
    case 'feature':
      return `機能開発 +${e.points}`;
    case 'growth':
      return `成長 +${Math.round(e.add * 100)} ポイント × ${e.months} か月`;
    case 'component':
      return `${SLOT_LABELS[e.slot]}に部品を付ける（${componentLabel('cloudflare', e.slot, e.option)}）`;
    case 'requirement':
      return `以後の要件: ${REQUIREMENT_LABEL[e.requirement]}（満たさない月は鮮度が下がる）`;
    case 'contract':
      return `契約の収益 $${e.usdPerMonth} / 月（${REQUIREMENT_LABEL[e.requires]}のときだけ）`;
  }
}

/** 効果を状態に当てる（traffic はその月の計算で扱うのでここでは何もしない）。 */
function applyEffects(
  state: GameState,
  effects: Effect[],
  eventId: string,
): GameState {
  let s = state;
  const deferFeature = effects.some(
    (e) => e.type === 'interrupt' && e.featureWork,
  );
  const featurePointsOf = effects.reduce(
    (a, e) => a + (e.type === 'feature' ? e.points : 0),
    0,
  );
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
            {
              points: e.points,
              months: e.months,
              eventId,
              ...(e.featureWork
                ? { featureWork: true, bonus: featurePointsOf / e.months }
                : {}),
            },
          ],
        };
        break;
      case 'feature':
        // 機能の追加の作業がある提案は、加点を作業の月に按分して足す（D-29）
        if (!deferFeature)
          s = { ...s, featurePoints: s.featurePoints + e.points };
        break;
      case 'growth':
        s = {
          ...s,
          growthBonus: [...s.growthBonus, { add: e.add, months: e.months }],
        };
        break;
      case 'component':
        s = { ...s, components: { ...s.components, [e.slot]: e.option } };
        break;
      case 'requirement':
        s = s.requirements.includes(e.requirement)
          ? s
          : { ...s, requirements: [...s.requirements, e.requirement] };
        break;
      case 'contract':
        s = {
          ...s,
          contracts: [
            ...s.contracts,
            { eventId, usdPerMonth: e.usdPerMonth, requires: e.requires },
          ],
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
  let state: GameState = input.pendingProposals.length
    ? {
        ...input,
        responses: {
          ...input.responses,
          ...Object.fromEntries(
            input.pendingProposals.map((id) => [id, 'declined' as const]),
          ),
        },
        pendingProposals: [],
      }
    : input;

  // 台本: 今月起きる出来事と予告（事業者を限った出来事は、その事業者の構成のときだけ。D-24 X-5）
  const events: MonthEvent[] = [];
  const platformNow = STACKS[state.stackIndex]!.provider;
  const forPlatform = (x: Scheduled) => {
    const ps = eventDef(sc, x.id)!.platforms;
    return !ps || ps.includes(platformNow);
  };
  const due = state.schedule.filter((x) => x.month === month && forPlatform(x));
  const noticed = state.schedule.filter(
    (x) => x.noticeMonth === month && forPlatform(x),
  );
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
    if (n.pvFactor && n.bot) {
      // Bot の前兆（収益にならない。遮断していれば半分）
      const extra =
        (n.pvFactor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
      botExtra += extra;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: true,
        factor: 1 + extra,
      });
      trafficNotes.push(n.title);
    } else if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
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
    platform: platformNow,
    components: state.components,
  };
  const workload = workloadFor(sc, parts);
  const swap = state.componentSwap;
  const architecture = architectureFor(
    stackIndexNow,
    state.seats,
    state.components,
    swap ? { [swap.slot]: swap.option } : {},
    state.storageOption,
  );
  const monthBooks = booksAt(state, month);
  const r = estimate({ workload, architecture, books: monthBooks });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）。乗り換え先は既定の部品（D-24 X-9）
  const target = state.migration
    ? (() => {
        const to = state.migration.to;
        const components = componentsAfterMigration(to, state.mods);
        return estimate({
          workload: workloadFor(sc, {
            ...parts,
            platform: STACKS[to]!.provider,
            components,
          }),
          architecture: architectureFor(to, state.seats, components),
          books: monthBooks,
        });
      })()
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  // ストレージ変更オプションの手数料（付けた次の月に一度だけ。D-30）
  // 申し込んだときのプランの金額を一度だけ払う（同じ月に上位へ変更しても変わらない）
  const fee = state.storageOptionFeeDue;
  const feeUsd = fee ? fee.amount / USD_JPY : 0;
  const infraCost = toUsd(r.bill.totals) + parallelInfraCost + feeUsd;

  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    // 予告を持ちうる台本は、予告どおり起きたか、予告なしで起きたか（D-28）
    const announced =
      def.notice && def.kind !== 'proposal'
        ? { announced: x.noticeMonth !== undefined }
        : {};
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      ...announced,
      title: def.title,
      text:
        def.notice && x.noticeMonth === undefined && def.surpriseText
          ? def.surpriseText
          : def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, r.premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...(def.previewRequirement
        ? {
            requirementStatus: requirementStatus(
              stackIndexNow,
              state.components,
              def.previewRequirement,
            ),
          }
        : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def),
              ...(unavailableReason(state, def)
                ? { unavailable: unavailableReason(state, def)! }
                : {}),
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
      title: def.notice!.title,
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
    // 前の月は境目より下で、今月越えた前提（1 か月目から越えているものは「近づいた」と呼ばない）
    const p = r.premises.find(
      (q) =>
        w.premiseIds.some((id) => q.id.startsWith(id)) &&
        (q.ratio ?? 0) >= w.atLeast &&
        (prev?.snapshots.find((x) => x.id === q.id)?.ratio ?? Infinity) <
          w.atLeast,
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
      premises: premiseRefsOf(
        { premiseRefs: w.premiseIds },
        r.premises.filter((q) => (q.ratio ?? 0) >= w.atLeast),
      ),
    });
  }
  // 実際に予告されている改定（始めた日が施行日より前のものだけ。D-21）
  const used = new Set(
    stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    events.push({
      id: c.id,
      kind: 'script',
      tier: 'common',
      phase: 'occurred',
      title: `${c.kind === 'pricing' ? '料金' : c.kind === 'limit' ? '制限' : '提供条件'}の改定が予告された（${c.provider}・施行日 ${c.effectiveFrom}）`,
      text: revisionText(c, used.has(c.provider)),
      effects: [],
      premises: [],
    });
  }

  // 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    interrupt: interruptOf(state),
    featureWork: featureWorkOf(state),
    featureBonus: featureBonusOf(state),
    // 乗り換えと DB の差し替えは同時に進めない（どちらかだけ）
    migrationWanted:
      migrationWanted(state.migration) + swapWanted(state.componentSwap),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;
  let componentSwap = swap
    ? { ...swap, done: swap.done + effort.migration }
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
  // 契約の収益（要件を満たす構成の月だけ。SLA の出来事・D-24）
  let contractRevenue = 0;
  for (const c of state.contracts) {
    if (meetsRequirement(stackIndexNow, c.requires, state.components))
      contractRevenue += c.usdPerMonth;
    else
      notes.push(
        `契約の収益が入らなかった（${REQUIREMENT_LABEL[c.requires]}でない）`,
      );
  }
  revenue += contractRevenue;

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
  // 部品で変わる判定の入力（D-24）: 最適化しない画像は原本の大きさ・キャッシュしないと記事は常に新しい・
  // KV を DB の代わりにすると書き込みがすぐ見えない
  const comps = { ...DEFAULT_CHOICES[platformNow], ...state.components };
  const viewed: Settings = {
    ...state.settings,
    ...(comps.images === 'none' ? { imageKB: sc.unoptimizedImageKB } : {}),
  };
  const uncached = comps.isrCache === 'none';
  // HTML を前段の CDN でキャッシュすると、オンデマンドの再検証が届かず古いページが出る（D-31。同じく鮮度を 1 段下げる）
  const eventuallyConsistent = comps.db === 'kv' || comps.frontCdn === 'html';
  // 即時反映（オンデマンド ISR）の要件を満たさない構成（D-32）
  const onDemand = state.requirements.includes('on-demand-isr')
    ? onDemandBlocker(stackIndexNow, state.components)
    : undefined;
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs,
      imageKB: viewed.imageKB,
      variants: viewed.variants,
      revalidateSec: viewed.revalidateSec,
      featurePoints,
      month,
      premises: r.premises,
      uncached,
      eventuallyConsistent,
      onDemandUnmet: onDemand !== undefined,
    },
    sat,
  );
  const reasons = stageReasons(sc, stages, {
    blocking,
    throttling,
    incident,
    switching: state.switching,
    ssrCpuMs,
    settings: viewed,
    heaviness: speedHeaviness(
      { ...viewed, ssrCpuMs, premises: r.premises },
      sat,
    ),
    featurePoints,
    month,
    imagesUnoptimized: comps.images === 'none',
    eventuallyConsistent,
    uncached,
    onDemandReason: onDemand
      ? `即時反映の要件を満たさない（${onDemand.label}。${onDemand.reason}）`
      : undefined,
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
    books: monthBooks,
    humanPV,
    basePV,
    trafficEvents,
    state,
  });

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = stackIndexNow;
  let switching = false;
  let components = state.components;
  let mods = state.mods;
  let storageOption = state.storageOption;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    components = componentsAfterMigration(migration.to, state.mods);
    // 乗り換え・契約し直しは新しいサーバーなので、ストレージ変更オプションは付いていない
    storageOption = false;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${MVP_STACKS[migration.to]!.name} に切り替える（部品は既定の選択から始まる）`,
    );
    if (mods.realtime && !realtimeSupported(STACKS[migration.to]!.provider)) {
      mods = withoutRealtime(mods);
      notes.push(
        'チャットは乗り換え先のリアルタイムのデータを取得していないため、乗り換えとともに止めた',
      );
    }
    migration = null;
  }
  // DB の差し替えが済んだら、次の月から新しい DB に切り替える
  if (componentSwap && componentSwap.done >= componentSwap.required) {
    components = { ...components, [componentSwap.slot]: componentSwap.option };
    notes.push(
      `DB の差し替え（データの移行）が済んだ。来月から ${componentLabel(platformNow, componentSwap.slot, componentSwap.option)} を使う`,
    );
    componentSwap = null;
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
    lines: [
      ...[r, ...(target ? [target] : [])].flatMap((x) =>
        x.bill.lines
          .filter((l) => l.amount)
          .map((l) => ({
            label: lineLabel(l),
            amount: l.amount!,
            currency: l.currency,
          })),
      ),
      ...(fee
        ? [
            {
              label: `sakura-vps ${fee.name}（手数料・一度だけ）`,
              amount: fee.amount,
              currency: 'JPY',
            },
          ]
        : []),
    ],
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
    components: comps,
    componentSummary: (Object.keys(SLOT_LABELS) as SlotId[])
      .filter((slot) => componentsOf(platformNow, slot).length > 1)
      .map(
        (slot) =>
          `${SLOT_LABELS[slot]}: ${componentLabel(platformNow, slot, comps[slot])}`,
      )
      .join('・'),
    contractRevenue,
    ...(swap
      ? {
          componentSwap: {
            label: `${SLOT_LABELS[swap.slot]}を ${componentLabel(platformNow, swap.slot, swap.option)} へ`,
            done: swap.done + effort.migration,
            required: swap.required,
          },
        }
      : {}),
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
  const proposals = due.filter((x) => eventDef(sc, x.id)!.kind === 'proposal');

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
    components,
    componentSwap,
    mods,
    storageOption,
    storageOptionFeeDue: null,
    cash,
    outages,
    featurePoints,
    migration,
    switching,
    plannedEffort: 0,
    policyWarnedMonth,
    stock,
    fired,
    pendingProposals: end ? [] : proposals.map((x) => x.id),
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
    books: PriceBook[];
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
      // 前の月にも同じ前提があり、境目より下だった（1 か月目・乗り換えの直後は数えない）
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? Infinity) <= 1,
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
      books: c.books,
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
    imagesUnoptimized: boolean;
    eventuallyConsistent: boolean;
    uncached: boolean;
    onDemandReason?: string | undefined;
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
    out.freshness = [
      !c.uncached &&
        `ISR の間隔 ${optionLabel('isr', c.settings.revalidateSec)}`,
      c.eventuallyConsistent &&
        'KV を DB の代わりにしているか、HTML を前段の CDN でキャッシュしていて、更新がすぐ見えない',
      c.onDemandReason,
    ]
      .filter(Boolean)
      .join('・');
  if (c.imagesUnoptimized && out.speed && !c.throttling.length)
    out.speed += '（画像を最適化していない）';
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
  const check = checkAction(state, action);
  if (!check.ok || action.type === 'none') return state;
  const cost = check.cost;
  // 提案で付く部品を部品の欄で選ぶのは、その提案を受けるのと同じ（どちらから選んでも同じ結果）
  if (action.type === 'component') {
    const pending = componentProposal(state, action.slot, action.option);
    if (pending)
      return applyAction(state, {
        type: 'respond',
        eventId: pending,
        accept: true,
      });
  }
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
        pendingProposals: state.pendingProposals.filter((id) => id !== def.id),
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
    case 'storage-option':
      return withNote('ストレージ変更オプションを付けた', {
        ...state,
        ...planned,
        storageOption: true,
        storageOptionFeeDue: {
          name: storageOptionAddon(state.stackIndex)!.name,
          amount: storageOptionAddon(state.stackIndex)!.oneTimeFee,
        },
      });
    case 'block-bots':
      return withNote('Bot を遮断するルールを入れた', {
        ...state,
        ...planned,
        botBlocked: true,
      });
    case 'component': {
      const platform = STACKS[state.stackIndex]!.provider;
      const label = `${SLOT_LABELS[action.slot]}: ${componentLabel(platform, action.slot, action.option)}`;
      if (action.slot === 'db') {
        const componentSwap: ComponentSwap = {
          slot: 'db',
          option: action.option,
          required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
          done: 0,
        };
        if (effortAvailable({ ...state, componentSwap }) < 0) return state;
        return withNote(`${label} へ差し替えを始めた`, {
          ...state,
          componentSwap,
        });
      }
      return withNote(`${label} に差し替えた`, {
        ...state,
        ...planned,
        components: { ...state.components, [action.slot]: action.option },
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
 * 見込みが外れた理由（prd/07 §10.7）。前提が境目を初めて越えた月のうち、その月までの推移で
 * 「前の月の見込みより早く超えた」（GD-1 の earlierThanProjected）ものについて、
 * ① 外すと越えなかった出来事 → ② 前の月のプレイヤーの行動 → ③ 伸びが直近より速かった、の順に理由を決める。
 */
export function surprisesOf(state: GameState): Surprise[] {
  const months = scenarioOf(state).months;
  const out: Surprise[] = [];
  for (const r of state.history) {
    if (!r.crossings.length) continue;
    const earlier = new Set(
      premiseTrends(
        state.history.slice(0, r.month).map((m) => m.snapshots),
        months,
      )
        .filter((t) => t.earlierThanProjected)
        .map((t) => t.id),
    );
    for (const c of r.crossings) {
      if (!earlier.has(c.premiseId)) continue;
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
      featureWork: a.featureWork + r.effort.featureWork,
      featureBonus: a.featureBonus + r.effort.featureBonus,
      migration: a.migration + r.effort.migration,
      actions: a.actions + r.effort.actions,
      feature: a.feature + r.effort.feature,
    }),
    {
      total: 0,
      upkeep: 0,
      interrupt: 0,
      featureWork: 0,
      featureBonus: 0,
      migration: 0,
      actions: 0,
      feature: 0,
    },
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
  startDate: string = DEFAULT_START_DATE,
): GameState {
  let st = playMonth(newGame(s.stackIndex, seed, scenario, startDate));
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
      axes: axesOf(playStrategy(b, state.startSeed, sc, state.startDate)),
      you: false,
    })),
  ];
}

export * from './rules.ts';
export * from './trends.ts';
export * from './scenario.ts';
export * from './save.ts';
export { ARTICLE_COMMUNITY };
