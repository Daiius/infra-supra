// 見積モード（D-73）の計算と入力の扱い。純粋関数（DOM・時刻・I/O に触れない）。画面は estimate-mode.tsx。
// 料金は catalog の composeStack と estimator の estimate を直接呼ぶ。game から使うのは、選べる部品の規則と
// テンプレートの Workload の組み立て（ゲームの 1 か月目と同じ数え方。game の estimate-mode.ts）と、設定の選択肢だけ。
import {
  composeStack,
  loadPriceBooks,
  SLOT_LABELS,
  STACK_DEFS,
  type Choices,
  type SlotId,
} from 'catalog';
import {
  estimate,
  type LineItem,
  type PlatformPremise,
  type PriceBook,
} from 'estimator';
import {
  DEFAULT_REVALIDATE_SEC,
  estimateComponents,
  estimateWorkload,
  frameworksOf,
  hiddenSettings,
  IMAGE_FORMAT_KB,
  revalidateSettingOf,
  SCENARIOS,
  SETTINGS,
  stackName,
  stackSupports,
  STACKS,
  USD_JPY,
  type FrameworkId,
  type Scenario,
} from 'game';

export const BOOKS: readonly PriceBook[] = loadPriceBooks();

/** テンプレート（ゲームのシナリオのアプリの形を使う。値はテンプレートの既定で実測ではない）。 */
export const TEMPLATES = [
  { id: 'article', scenarioId: 'article-community', label: '記事コミュニティ' },
  {
    id: 'business',
    scenarioId: 'contract-operations',
    label: '業務アプリ（ログインして使う）',
  },
] as const;
export type TemplateId = (typeof TEMPLATES)[number]['id'];

export const PV_PRESETS = [
  10_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000, 30_000_000,
] as const;
const PV_MIN = 1_000;
const PV_MAX = 100_000_000;

export type ImageFormat = keyof typeof IMAGE_FORMAT_KB;
export const IMAGE_FORMATS: readonly { id: ImageFormat; label: string }[] = [
  { id: 'jpeg', label: 'JPEG（そのまま）' },
  { id: 'webp', label: 'WebP' },
  { id: 'avif', label: 'AVIF' },
];
export const VARIANTS = [3, 2, 1] as const;

export type EstimateInput = {
  template: TemplateId;
  /** 月の PV。 */
  pv: number;
  framework: FrameworkId;
  /** 構成の id（catalog の STACK_DEFS）。 */
  stack: string;
  /** 選んだ部品（選べるスロットだけ）。 */
  parts: Choices;
  /** 再検証の間隔・API のキャッシュの期間・ビルドの間隔（秒。オンデマンドは 0）。フレームワークで意味が替わる。 */
  revalidateSec: number;
  imageFormat: ImageFormat;
  variants: number;
};

export const scenarioOfTemplate = (t: TemplateId): Scenario =>
  SCENARIOS[TEMPLATES.find((x) => x.id === t)!.scenarioId]!;

const stackIndexOf = (id: string) => STACKS.findIndex((s) => s.id === id);

/** 選べる設定（シナリオ・フレームワークで隠すものは出さない）。 */
export function settingsOf(template: TemplateId, framework: FrameworkId) {
  const scenario = scenarioOfTemplate(template);
  const hidden = hiddenSettings({ scenario, framework });
  const revalidateKey = revalidateSettingOf(framework);
  return {
    revalidate: hidden.includes(revalidateKey)
      ? null
      : {
          key: revalidateKey,
          label: SETTINGS[revalidateKey].label,
          note: SETTINGS[revalidateKey].note,
          options: SETTINGS[revalidateKey].options,
        },
    format: !hidden.includes('format'),
    variants: !hidden.includes('variants'),
  };
}

/**
 * 入力を選べる組み合わせに直す（URL から読んだ値・テンプレートを替えた後など）。選べない値は既定にする。
 * 部品は始める画面と同じ規則で選べるものだけを残し、残りは既定（game の estimateComponents）。
 */
export function normalizeInput(raw: Partial<EstimateInput>): EstimateInput {
  const template: TemplateId = TEMPLATES.some((t) => t.id === raw.template)
    ? raw.template!
    : 'article';
  const scenario = scenarioOfTemplate(template);
  const fws = frameworksOf(scenario);
  const framework =
    raw.framework && fws.allowed.includes(raw.framework)
      ? raw.framework
      : fws.default;
  const wanted = raw.stack !== undefined ? stackIndexOf(raw.stack) : -1;
  const stackIndex =
    wanted >= 0 && stackSupports(wanted, framework)
      ? wanted
      : STACKS.find((s) => stackSupports(s.index, framework))!.index;
  const pv =
    raw.pv !== undefined && Number.isFinite(raw.pv)
      ? Math.min(PV_MAX, Math.max(PV_MIN, Math.round(raw.pv)))
      : scenario.scale.startPV;
  const settings = settingsOf(template, framework);
  const revalidateSec =
    settings.revalidate?.options.some((o) => o.value === raw.revalidateSec) ===
    true
      ? raw.revalidateSec!
      : DEFAULT_REVALIDATE_SEC;
  const imageFormat =
    settings.format && IMAGE_FORMATS.some((f) => f.id === raw.imageFormat)
      ? raw.imageFormat!
      : 'jpeg';
  const variants =
    settings.variants && VARIANTS.some((v) => v === raw.variants)
      ? raw.variants!
      : 3;
  return {
    template,
    pv,
    framework,
    stack: STACKS[stackIndex]!.id,
    parts: estimateComponents(scenario, stackIndex, framework, raw.parts ?? {})
      .chosen,
    revalidateSec,
    imageFormat,
    variants,
  };
}

/**
 * 構成を選ぶ（構成の一覧・比較の表）。別の構成に替えるときだけ部品の選択を空にして既定にする。
 * 今の構成を選び直しても部品は保つ（OCL-83383F50）。
 */
export function withStack(
  input: EstimateInput,
  stack: string,
): Partial<EstimateInput> {
  return stack === input.stack ? {} : { stack, parts: {} };
}

// ---- URL のクエリ（共有のため。mode=estimate と一緒に置く）----

const PART_PREFIX = 'c.';

export function toQuery(input: EstimateInput): URLSearchParams {
  const q = new URLSearchParams();
  q.set('mode', 'estimate');
  q.set('t', input.template);
  q.set('pv', String(input.pv));
  q.set('fw', input.framework);
  q.set('s', input.stack);
  q.set('r', String(input.revalidateSec));
  q.set('img', input.imageFormat);
  q.set('v', String(input.variants));
  for (const [slot, id] of Object.entries(input.parts))
    if (id !== undefined) q.set(PART_PREFIX + slot, id);
  return q;
}

/** クエリから読む（読めない値は捨てる。選べる組み合わせへの直しは normalizeInput）。 */
export function fromQuery(search: string): Partial<EstimateInput> {
  const q = new URLSearchParams(search);
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (k: string) => q.get(k) ?? undefined;
  const parts: Choices = {};
  for (const [k, v] of q)
    if (k.startsWith(PART_PREFIX) && k.slice(PART_PREFIX.length) in SLOT_LABELS)
      parts[k.slice(PART_PREFIX.length) as SlotId] = v;
  const out: Partial<EstimateInput> = { parts };
  const set = <K extends keyof EstimateInput>(
    k: K,
    v: EstimateInput[K] | undefined,
  ) => {
    if (v !== undefined) out[k] = v;
  };
  set('template', str('t') as TemplateId | undefined);
  set('pv', num('pv'));
  set('framework', str('fw') as FrameworkId | undefined);
  set('stack', str('s'));
  set('revalidateSec', num('r'));
  set('imageFormat', str('img') as ImageFormat | undefined);
  set('variants', num('v'));
  return out;
}

// ---- 計算 ----

export type LineView = {
  kind: LineItem['kind'];
  label: string;
  /** 使用量（メーターの単位）。 */
  quantity?: number;
  unit?: string;
  /** 無料枠・込み分で賄った量。 */
  allowance?: number;
  billable?: number;
  /** 金額（明細の通貨）。料金未取得は null。 */
  amount: number | null;
  currency: string;
  status: LineItem['status'];
  /** クレジット: 当てられる従量の金額と上限。 */
  credit?: { limit: number; eligible: number };
  note?: string;
};

export type ProviderView = {
  provider: string;
  plans: string[];
  currency: string;
  /** その事業者の小計（明細の通貨・料金未取得を除く）。 */
  subtotal: number;
  lines: LineView[];
};

export type SourceView = {
  provider: string;
  version: string;
  retrievedAt: string;
  taxIncluded: boolean;
  currency: string;
  links: { id: string; url: string; retrievedAt: string }[];
};

export type EstimateView = {
  name: string;
  /** 月の合計（USD。円建ての明細は為替の仮定で換算）。料金未取得の明細は含まない（下限）。 */
  totalUsd: number;
  totalJpy: number;
  totals: Partial<Record<string, number>>;
  unpricedLines: number;
  providers: ProviderView[];
  /** 量の境目がある前提（使用率の高い順）。 */
  thresholds: PlatformPremise[];
  /** 量によらず効く事実。 */
  facts: PlatformPremise[];
  sources: SourceView[];
  mau: number;
};

const toUsd = (totals: Partial<Record<string, number>>) =>
  (totals.USD ?? 0) + (totals.JPY ?? 0) / USD_JPY;

function planOf(provider: string, planId: string) {
  return BOOKS.find((b) => b.provider === provider)?.plans.find(
    (p) => p.id === planId,
  );
}

function lineView(l: LineItem): LineView {
  const plan = planOf(l.priceRef.provider, l.priceRef.planId);
  const meter = l.priceRef.meterId
    ? plan?.meters.find((m) => m.id === l.priceRef.meterId)
    : undefined;
  // 料金データの表示名（D-75）。無ければ ID から作る
  const label =
    l.label ??
    (l.kind === 'base-fee'
      ? `${plan?.name ?? l.priceRef.planId} の基本料`
      : l.kind === 'credit'
        ? `クレジット（${l.credit?.id ?? ''}）`
        : `${plan?.name ?? l.priceRef.planId}・${l.priceRef.meterId ?? ''}`);
  return {
    kind: l.kind,
    label,
    ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
    ...(meter ? { unit: meter.unit } : {}),
    ...(l.allowanceApplied !== undefined
      ? { allowance: l.allowanceApplied }
      : {}),
    ...(l.billableQuantity !== undefined
      ? { billable: l.billableQuantity }
      : {}),
    amount: l.amount,
    currency: l.currency,
    status: l.status,
    ...(l.credit
      ? { credit: { limit: l.credit.limit, eligible: l.credit.eligible } }
      : {}),
    ...(l.note !== undefined ? { note: l.note } : {}),
  };
}

/** 構成が使うプランの出典（プラン・メーター・制限・クレジット・事実・無料枠のプールが挙げる出典だけ）。 */
function sourcesOf(used: { provider: string; planId: string }[]): SourceView[] {
  const providers = [...new Set(used.map((u) => u.provider))];
  return providers.map((provider) => {
    const book = BOOKS.find((b) => b.provider === provider)!;
    const ids = new Set<string>();
    for (const u of used.filter((x) => x.provider === provider)) {
      const plan = book.plans.find((p) => p.id === u.planId);
      if (!plan) continue;
      for (const x of [
        plan,
        ...plan.meters,
        ...plan.limits,
        ...plan.credits,
        ...plan.facts,
      ])
        x.sourceIds.forEach((id) => ids.add(id));
      for (const m of plan.meters)
        if (m.allowancePool)
          book.allowancePools
            .find((p) => p.id === m.allowancePool)
            ?.sourceIds.forEach((id) => ids.add(id));
    }
    return {
      provider,
      version: book.version,
      retrievedAt: book.retrievedAt,
      taxIncluded: book.taxIncluded,
      currency: book.currency,
      links: [...ids]
        .filter((id) => book.sources[id])
        .sort()
        .map((id) => ({ id, ...book.sources[id]! })),
    };
  });
}

type Resolved = {
  scenario: Scenario;
  stackIndex: number;
  components: Choices;
};

function resolve(input: EstimateInput, stackId = input.stack): Resolved {
  const scenario = scenarioOfTemplate(input.template);
  const stackIndex = stackIndexOf(stackId);
  const { components } = estimateComponents(
    scenario,
    stackIndex,
    input.framework,
    stackId === input.stack ? input.parts : {},
  );
  return { scenario, stackIndex, components };
}

function run(input: EstimateInput, r: Resolved) {
  const workload = estimateWorkload(r.scenario, {
    pv: input.pv,
    stackIndex: r.stackIndex,
    framework: input.framework,
    components: r.components,
    settings: {
      imageKB: IMAGE_FORMAT_KB[input.imageFormat],
      variants: input.variants,
      revalidateSec: input.revalidateSec,
    },
  });
  const architecture = composeStack(STACK_DEFS[r.stackIndex]!, r.components, {
    framework: input.framework,
  });
  return estimate({ workload, architecture, books: BOOKS });
}

/** 選んだ条件の見積（入力は normalizeInput を通したもの）。 */
export function runEstimate(input: EstimateInput): EstimateView {
  const r = resolve(input);
  const result = run(input, r);
  const { bill } = result;
  const byProvider = new Map<string, LineItem[]>();
  for (const l of bill.lines)
    byProvider.set(l.priceRef.provider, [
      ...(byProvider.get(l.priceRef.provider) ?? []),
      l,
    ]);
  const providers: ProviderView[] = [...byProvider].map(([provider, ls]) => ({
    provider,
    plans: [
      ...new Set(
        ls.map(
          (l) => planOf(provider, l.priceRef.planId)?.name ?? l.priceRef.planId,
        ),
      ),
    ],
    currency: ls[0]!.currency,
    subtotal: ls.reduce((a, l) => a + (l.amount ?? 0), 0),
    // 基本料 → 従量（金額の大きい順）→ クレジット
    lines: [...ls]
      .sort(
        (a, b) =>
          order(a) - order(b) ||
          Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0),
      )
      .map(lineView),
  }));
  const thresholds = result.premises
    .filter((p) => p.kind === 'threshold')
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const facts = result.premises.filter((p) => p.kind === 'fact');
  const used = result.simulation.architecture.nodes.flatMap((n) =>
    n.billing
      ? [{ provider: n.billing.provider, planId: n.billing.planId }]
      : [],
  );
  const totalUsd = toUsd(bill.totals);
  return {
    name: stackName(r.stackIndex, input.framework, true, r.components),
    totalUsd,
    totalJpy: totalUsd * USD_JPY,
    totals: bill.totals,
    unpricedLines: bill.unpricedLines,
    providers,
    thresholds,
    facts,
    sources: sourcesOf(used),
    mau: result.simulation.workload.input.traffic.mau ?? 0,
  };
}

const order = (l: LineItem) =>
  l.kind === 'base-fee' ? 0 : l.kind === 'credit' ? 2 : 1;

export type ComparisonRow = {
  stack: string;
  name: string;
  totalUsd: number;
  unpricedLines: number;
  /** 当たっている前提のうち、止まる・プランの変更が要るもの（費用の増えるだけの前提は除く）。 */
  blocking: number;
  /** 当たっている前提の数。 */
  hits: number;
  /** 使用率の最も高い前提。 */
  top?: { text: string; ratio: number };
  /** 選んだ構成か。 */
  current: boolean;
};

/**
 * 選んだ条件（テンプレート・PV・フレームワーク・設定）で、そのフレームワークを載せられる全構成の月額。
 * 部品は選んだ構成だけ選んだもの、他の構成は既定。
 */
export function compareStacks(input: EstimateInput): ComparisonRow[] {
  return STACKS.filter((s) => stackSupports(s.index, input.framework)).map(
    (s) => {
      const r = resolve(input, s.id);
      const res = run(input, r);
      const hit = res.premises.filter((p) => p.hit);
      const top = res.premises
        .filter((p) => p.kind === 'threshold')
        .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
      return {
        stack: s.id,
        name: stackName(s.index, input.framework, false, r.components),
        totalUsd: toUsd(res.bill.totals),
        unpricedLines: res.bill.unpricedLines,
        blocking: hit.filter(
          (p) => p.effect === 'block' || p.effect === 'upgrade-required',
        ).length,
        hits: hit.length,
        ...(top ? { top: { text: top.text, ratio: top.ratio ?? 0 } } : {}),
        current: s.id === input.stack,
      };
    },
  );
}

// ---- 費用の曲線（D-74）----

/** 曲線の PV の刻み（対数でほぼ等間隔。1 万〜3,000 万）。点の数は再計算の重さに効くので増やしすぎない。 */
export const CURVE_PVS = [
  10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000,
  30_000_000,
] as const;

/** 既定で曲線に出す構成の数（今の構成を除く、月額の安い順）。 */
export const CURVE_DEFAULT_COUNT = 4;
/** 曲線に同時に出せる構成の数の上限（色と形の組で見分けられる数に抑える）。 */
export const CURVE_MAX = 6;

export type CurvePoint = {
  pv: number;
  totalUsd: number;
  unpricedLines: number;
  /** 当たっている止まる前提（`block`・`upgrade-required`）の文。空なら止まらない。 */
  blocking: string[];
};

export type CurveSeries = {
  stack: string;
  name: string;
  /** 事業者（色に使う）。 */
  provider: string;
  /** 同じ事業者の構成の中での順（形に使う。STACKS の並びで固定）。 */
  variant: number;
  current: boolean;
  points: CurvePoint[];
};

/**
 * 今の条件（テンプレート・フレームワーク・設定）のまま PV だけを振った、構成ごとの月額。
 * 部品は今の構成だけ今の選択、他の構成は既定（構成で選べる部品が違うため。compareStacks と同じ）。
 * 載せられない構成の id は捨てる。
 */
export function costCurves(
  input: EstimateInput,
  stacks: readonly string[],
  pvs: readonly number[] = CURVE_PVS,
): CurveSeries[] {
  return stacks.flatMap((id) => {
    const index = stackIndexOf(id);
    if (index < 0 || !stackSupports(index, input.framework)) return [];
    const r = resolve(input, id);
    const provider = STACKS[index]!.provider;
    const points = pvs.map((pv): CurvePoint => {
      const res = run({ ...input, pv }, r);
      return {
        pv,
        totalUsd: toUsd(res.bill.totals),
        unpricedLines: res.bill.unpricedLines,
        blocking: res.premises
          .filter(
            (p) =>
              p.hit &&
              (p.effect === 'block' || p.effect === 'upgrade-required'),
          )
          .map((p) => p.text),
      };
    });
    return [
      {
        stack: id,
        name: stackName(index, input.framework, false, r.components),
        provider,
        variant: STACKS.filter(
          (s) => s.provider === provider && s.index < index,
        ).length,
        current: id === input.stack,
        points,
      },
    ];
  });
}

/**
 * 曲線に既定で出す構成: 今の構成と、今の PV の月額の安い順に CURVE_DEFAULT_COUNT 構成（今の構成を除く）。
 * 並びは STACKS の順（表示の順位で色や並びが入れ替わらないように）。
 */
export function defaultCurveStacks(
  rows: readonly ComparisonRow[],
  count = CURVE_DEFAULT_COUNT,
): string[] {
  const cheap = sortRows(
    rows.filter((r) => !r.current),
    'cost',
  )
    .slice(0, count)
    .map((r) => r.stack);
  const current = rows.filter((r) => r.current).map((r) => r.stack);
  return inStackOrder([...current, ...cheap]);
}

/**
 * 足し引きした後の曲線の構成: 今の構成を必ず入れ、載せられない構成（フレームワークを替えたとき）は外し、
 * 合わせて CURVE_MAX までに抑える（OCL-E5E5FCBD。選んだ後に未選択の構成へ切り替えても超えない）。
 * 溢れたときは選んだ順の先頭から残す。並びは STACKS の順。
 */
export function pickedCurveStacks(
  picked: readonly string[],
  rows: readonly ComparisonRow[],
  max = CURVE_MAX,
): string[] {
  const current = rows.filter((r) => r.current).map((r) => r.stack);
  const others = [...new Set(picked)]
    .filter((id) => !current.includes(id))
    .filter((id) => rows.some((r) => r.stack === id))
    .slice(0, Math.max(0, max - current.length));
  return inStackOrder([...current, ...others]);
}

/** 曲線の色の枠（0 始まり）。事業者ごとに STACKS に初めて出る順で固定する（表示の順位で塗り替えない）。 */
export function curveColorSlot(provider: string): number {
  return [...new Set(STACKS.map((s) => s.provider as string))].indexOf(
    provider,
  );
}

/** 構成の id を STACKS の順に並べる（重複は除く）。 */
export function inStackOrder(ids: readonly string[]): string[] {
  const set = new Set(ids);
  return STACKS.filter((s) => set.has(s.id)).map((s) => s.id);
}

export type SortKey = 'cost' | 'name' | 'blocking';

export function sortRows(
  rows: readonly ComparisonRow[],
  key: SortKey,
  desc = false,
): ComparisonRow[] {
  const cmp = (a: ComparisonRow, b: ComparisonRow) =>
    key === 'cost'
      ? a.totalUsd - b.totalUsd
      : key === 'blocking'
        ? a.blocking - b.blocking || a.totalUsd - b.totalUsd
        : a.name.localeCompare(b.name, 'ja');
  const out = [...rows].sort(cmp);
  return desc ? out.reverse() : out;
}

export { USD_JPY };
