// 料金データのスキーマ（prd/03-pricing-schema.md）。データ（catalog）はこのスキーマで検証してから使う。
import { z } from 'zod';
import { CURRENCIES } from '../num/money.ts';
import { UNITS } from '../num/unit.ts';
import { IsoDateSchema, SourceRefSchema } from '../provenance.ts';
import { RESOURCES } from './resources.ts';

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case の ID');
const NonNegative = z.number().finite().nonnegative();
const Positive = z.number().finite().positive();
const SourceIds = z.array(z.string()).default([]);

/** プラットフォームの前提として人が読める 1 文（prd/01 §8.1）。見積の説明とゲームのイベントで同じ文を使う。 */
const Premise = z.string().min(1);

export const OVERAGE_BEHAVIORS = [
  'bill', // 超過料金
  'block', // リクエスト・操作が失敗する
  'throttle', // 遅くなる
  'upgrade-required', // 上位プランが必須
  // 超えても請求は増えず止まりもしないが、超えた状態が続くと性能が調整されうる（CloudFront の定額のプラン。D-61）
  'adjust',
] as const;
export const OverageBehaviorSchema = z.enum(OVERAGE_BEHAVIORS);

/** 公式の文書が食い違う箇所で採用した解釈（D-10）。計算は採用した解釈だけで行う。 */
export const InterpretationSchema = z.object({
  adopted: z.string(),
  rejected: z.array(z.object({ reading: z.string(), reason: z.string() })),
  verifiedAt: IsoDateSchema.optional(),
});

const TierSchema = z.object({
  upTo: Positive.nullable(),
  unitPrice: NonNegative,
});

function tiersAreOrdered(
  tiers: { upTo: number | null }[],
  ctx: z.RefinementCtx,
) {
  tiers.forEach((t, i) => {
    const last = i === tiers.length - 1;
    if (last && t.upTo !== null) {
      ctx.addIssue({ code: 'custom', message: '最後の段の upTo は null' });
    }
    if (!last && t.upTo === null) {
      ctx.addIssue({ code: 'custom', message: '最後以外の段の upTo は数値' });
    }
    const prev = tiers[i - 1]?.upTo;
    if (i > 0 && t.upTo !== null && prev != null && t.upTo <= prev) {
      ctx.addIssue({ code: 'custom', message: '段の upTo は単調増加' });
    }
  });
}

export const PricingSchema = z.discriminatedUnion('model', [
  /** `per` 単位あたり `unitPrice`（例: per 1_000_000・unitPrice 0.3 は 100 万件あたり 0.3）。 */
  z.object({ model: z.literal('flat'), per: Positive, unitPrice: NonNegative }),
  /** 段ごとに別の単価（graduated）。 */
  z
    .object({
      model: z.literal('tiered'),
      per: Positive,
      tiers: z.array(TierSchema).min(1),
    })
    .superRefine((v, ctx) => tiersAreOrdered(v.tiers, ctx)),
  /** 到達した段の単価を全量にかける。 */
  z
    .object({
      model: z.literal('volume'),
      per: Positive,
      tiers: z.array(TierSchema).min(1),
    })
    .superRefine((v, ctx) => tiersAreOrdered(v.tiers, ctx)),
  /** 料金を取得していない（D-09）。明細は金額なしで残り、合計は下限になる。 */
  z.object({ model: z.literal('unpriced'), note: z.string() }),
]);
export type Pricing = z.infer<typeof PricingSchema>;

export const RoundingSchema = z.union([
  z.object({
    granularity: Positive,
    /** event: 1 回ごとに切り上げ（全件が平均値をとると仮定）/ period: 期間の課金対象の合計を切り上げ */
    scope: z.enum(['event', 'period']),
  }),
  /** 丸めが料金表に書かれていない。エンジンは丸めなしで計算し、仮定を使ったことを残す。 */
  z.literal('not-stated'),
]);

export const MeterSchema = z.object({
  id: Id,
  /** 表示名（明細の行の名前。D-75）。日本語の説明に公式の名称を括弧で残す。計算には使わない。 */
  label: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(), // 名称変更（Edge Requests → CDN Requests など）
  resource: z.enum(RESOURCES),
  unit: z.enum(UNITS),
  allowancePool: Id.optional(),
  rounding: RoundingSchema.optional(),
  pricing: PricingSchema,
  /** 無料枠・込み分を超えたときの挙動。既定は bill。 */
  onExceed: OverageBehaviorSchema.default('bill'),
  /** 利用者が構成で超過時の挙動を選べる（予算での一時停止など）。 */
  configurableOnExceed: z.array(OverageBehaviorSchema).optional(),
  regional: z
    .array(z.object({ region: z.string(), pricing: PricingSchema }))
    .optional(),
  interpretation: InterpretationSchema.optional(),
  premise: Premise.optional(),
  sourceIds: SourceIds,
});
export type Meter = z.infer<typeof MeterSchema>;

export const AllowancePoolSchema = z.object({
  id: Id,
  quantity: NonNegative,
  unit: z.enum(UNITS),
  period: z.enum(['month', 'day']),
  /** 共有の単位。MVP の計算は account と node を扱う（project は gap）。 */
  scope: z.enum(['account', 'project', 'node']),
  premise: Premise.optional(),
  sourceIds: SourceIds,
});
export type AllowancePool = z.infer<typeof AllowancePoolSchema>;

export const BaseFeeSchema = z.object({
  /** 表示名（明細の行の名前。D-75）。日本語の説明に公式の名称を括弧で残す。計算には使わない。 */
  label: z.string().min(1).optional(),
  amount: NonNegative,
  per: z.enum(['month', 'hour']),
  monthlyCap: NonNegative.optional(),
  scope: z.enum(['account', 'node']),
  perSeat: z.boolean().default(false),
});

export const CreditSchema = z.object({
  id: Id,
  /** 表示名（明細の行の名前。D-75）。日本語の説明に公式の名称を括弧で残す。計算には使わない。 */
  label: z.string().min(1).optional(),
  amount: NonNegative,
  /** 当てる先。'all-usage' は同じプランの従量の明細すべて。 */
  appliesTo: z.union([
    z.literal('all-usage'),
    z.object({ meterIds: z.array(Id).min(1) }),
  ]),
  period: z.literal('month').default('month'),
  /**
   * 使い切ったときの挙動（D-71）。bill: 超えた分を請求する（Vercel Pro など）。block: 超えると止まり、超えた分は請求されない
   * （Netlify のクレジットを使い切るとサイトが止まる）。前提の effect は bill なら cost、block なら block。
   */
  onExhausted: z.enum(['bill', 'block']).default('bill'),
  /**
   * 使用率を前提として出すときの 1 文（無料枠のプールの premise と同じ扱い。D-48）。
   * 使った割合は「当てられる従量の金額 / クレジットの額」で、超えると請求が増える（effect: cost）。
   */
  premise: Premise.optional(),
  interpretation: InterpretationSchema.optional(),
  sourceIds: SourceIds,
});

/** 制限が何を測るか（容量の判定で、資源シミュレーションのどの値と比べるか。prd/01 §5.4）。 */
export const LIMIT_MEASURES = [
  'cpu-ms-per-request', // 1 リクエストあたりの CPU 時間の最大
  'storage-gb', // ノードの保存量
  'peak-concurrency', // ピーク時間帯の同時接続・同時実行
  'writes-per-second-per-key', // 同じキーへの書き込みの頻度（ピーク時間帯・1 秒あたり。KV など）
] as const;

export const LimitSchema = z.object({
  id: Id,
  measure: z.enum(LIMIT_MEASURES),
  value: NonNegative,
  unit: z.enum(UNITS),
  scope: z.enum(['request', 'node', 'account', 'day', 'month']),
  onExceed: OverageBehaviorSchema,
  premise: Premise.optional(),
  sourceIds: SourceIds,
});

/**
 * 量の境目を持たない事実（KV の反映の遅れ・D1 の 1 行の上限など）。常に効くわけではないので、
 * 構成のノードが `facts` で id を挙げたときだけ前提として出す（D-24。部品の選び方しだいで効く事実）。
 */
export const PlanFactSchema = z.object({
  id: Id,
  premise: Premise,
  interpretation: InterpretationSchema.optional(),
  sourceIds: SourceIds,
});

/**
 * 稼働率の SLA（D-24・07 §11.5）。offered は稼働率の値と組。書かれていなければ not-stated（無いと断定しない）、
 * 「含まれない」と書かれていれば none。補償（減額・クレジット）は計算に使わない。
 */
export const UptimeSlaSchema = z
  .object({
    status: z.enum(['offered', 'none', 'not-stated']),
    percent: z.number().finite().min(0).max(100).optional(),
    premise: Premise,
    sourceIds: SourceIds,
  })
  .refine((s) => (s.status === 'offered') === (s.percent !== undefined), {
    message: 'percent は status: offered のときだけ持つ',
  });

/**
 * 一度きりの費用がかかる追加のオプション（D-30。さくらの VPS のストレージ変更オプションなど）。
 * 月額は変わらず、申し込んだときに oneTimeFee を一度だけ払う（通貨・税込かは PriceBook に合わせる）。
 * 何が変わるか（ディスクの大きさなど）は構成のデータ（catalog の stacks）が持つ。
 */
export const AddonSchema = z.object({
  id: Id,
  name: z.string(),
  /** 一度だけの手数料の明細の行の名前（D-75）。 */
  label: z.string().min(1).optional(),
  oneTimeFee: NonNegative,
  premise: Premise,
  interpretation: InterpretationSchema.optional(),
  sourceIds: SourceIds,
});
export type Addon = z.infer<typeof AddonSchema>;

/** 数量でない利用資格（D-09。Vercel Hobby の商用利用不可など）。 */
export const EligibilitySchema = z.object({
  id: Id,
  requirement: z.enum(['non-commercial']),
  premise: Premise,
  sourceIds: SourceIds,
});

/**
 * メンバー（席）の料金（D-20 V-6）。per-seat は baseFee.perSeat と組で使う。
 * 料金が無いと書かれていれば included、書かれていなければ not-stated（無料と断定しない）。
 */
export const MembersSchema = z.object({
  pricing: z.enum(['per-seat', 'included', 'not-stated']),
  premise: Premise,
  sourceIds: SourceIds,
});

/**
 * 施行日つきの予告（D-09・D-21）。改定後の料金を公式の出典つきで取得したときだけ revisedMeters に持ち、
 * ゲームは施行の月からそれで計算する。持っていなければ計算に反映せず、その理由を notModeledReason に書く（架空の料金を作らない）。
 */
export const ScheduledChangeSchema = z.object({
  effectiveFrom: IsoDateSchema,
  description: z.string(),
  /** 料金の改定か、制限の改定か。 */
  kind: z.enum(['pricing', 'limit', 'other']),
  revisedMeters: z
    .array(z.object({ planId: Id, meterId: Id, pricing: PricingSchema }))
    .default([]),
  notModeledReason: z.string().min(1).optional(),
  sourceIds: SourceIds,
});
export type ScheduledChange = z.infer<typeof ScheduledChangeSchema>;

export const PlanSchema = z.object({
  id: Id,
  service: Id,
  name: z.string(),
  baseFee: BaseFeeSchema.optional(),
  meters: z.array(MeterSchema),
  credits: z.array(CreditSchema).default([]),
  limits: z.array(LimitSchema).default([]),
  eligibility: z.array(EligibilitySchema).default([]),
  members: MembersSchema.optional(),
  facts: z.array(PlanFactSchema).default([]),
  addons: z.array(AddonSchema).default([]),
  uptimeSla: UptimeSlaSchema.optional(),
  notes: z.array(z.string()).default([]), // 支払いの条件など（D-14）
  sourceIds: SourceIds,
});
export type Plan = z.infer<typeof PlanSchema>;

export const PriceBookSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: Id,
    version: z.string().min(1),
    status: z.enum(['official', 'fictional']),
    currency: z.enum(CURRENCIES),
    taxIncluded: z.boolean(),
    retrievedAt: IsoDateSchema,
    sources: z.record(z.string(), SourceRefSchema).default({}),
    allowancePools: z.array(AllowancePoolSchema).default([]),
    plans: z.array(PlanSchema).min(1),
    /** 施行日つきの予告（D-09）。MVP は記録だけで、計算には使わない（gap）。 */
    scheduledChanges: z.array(ScheduledChangeSchema).default([]),
    notes: z.array(z.string()).default([]),
  })
  .superRefine((book, ctx) => {
    const fictionalId = book.provider.startsWith('fictional-');
    if (fictionalId !== (book.status === 'fictional')) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message:
          'provider が fictional- で始まるときだけ status: fictional（それ以外は official）',
      });
    }
    const pools = new Map(book.allowancePools.map((p) => [p.id, p]));
    const requireSources = (ids: string[], path: (string | number)[]) => {
      if (book.status !== 'official') return;
      if (ids.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'official のデータには出典が必要',
        });
      }
      for (const id of ids) {
        if (!(id in book.sources)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `出典 ${id} が sources にない`,
          });
        }
      }
    };
    book.scheduledChanges.forEach((c, ci) => {
      const path = ['scheduledChanges', ci];
      requireSources(c.sourceIds, [...path, 'sourceIds']);
      if (c.revisedMeters.length === 0 && !c.notModeledReason)
        ctx.addIssue({
          code: 'custom',
          path,
          message:
            '改定後の料金（revisedMeters）が無い予告は、計算に反映しない理由（notModeledReason）が必要',
        });
      for (const r of c.revisedMeters) {
        const ok = book.plans
          .find((p) => p.id === r.planId)
          ?.meters.some((m) => m.id === r.meterId);
        if (!ok)
          ctx.addIssue({
            code: 'custom',
            path,
            message: `改定の対象のメーターが無い: ${r.planId}/${r.meterId}`,
          });
      }
    });
    const seenPlans = new Set<string>();
    book.plans.forEach((plan, pi) => {
      if (seenPlans.has(plan.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['plans', pi, 'id'],
          message: `プランの ID が重複: ${plan.id}`,
        });
      }
      seenPlans.add(plan.id);
      requireSources(plan.sourceIds, ['plans', pi, 'sourceIds']);
      if (plan.members) {
        requireSources(plan.members.sourceIds, ['plans', pi, 'members']);
        if (
          (plan.members.pricing === 'per-seat') !==
          (plan.baseFee?.perSeat ?? false)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['plans', pi, 'members', 'pricing'],
            message:
              'members.pricing が per-seat なのは baseFee.perSeat のときだけ',
          });
        }
      }
      const seenMeters = new Set<string>();
      plan.meters.forEach((m, mi) => {
        const path = ['plans', pi, 'meters', mi];
        if (seenMeters.has(m.id)) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `メーターの ID が重複: ${m.id}`,
          });
        }
        seenMeters.add(m.id);
        if (m.pricing.model !== 'unpriced') {
          requireSources(m.sourceIds, [...path, 'sourceIds']);
        }
        if (m.allowancePool) {
          const pool = pools.get(m.allowancePool);
          if (!pool) {
            ctx.addIssue({
              code: 'custom',
              path,
              message: `無料枠のプール ${m.allowancePool} がない`,
            });
          } else if (pool.unit !== m.unit) {
            ctx.addIssue({
              code: 'custom',
              path,
              message: `プール ${pool.id} の単位（${pool.unit}）とメーターの単位（${m.unit}）が違う`,
            });
          }
        }
      });
      plan.credits.forEach((c, ci) => {
        if (c.appliesTo !== 'all-usage') {
          for (const id of c.appliesTo.meterIds) {
            if (!seenMeters.has(id)) {
              ctx.addIssue({
                code: 'custom',
                path: ['plans', pi, 'credits', ci],
                message: `クレジットの対象メーター ${id} がない`,
              });
            }
          }
        }
      });
      plan.limits.forEach((l, li) =>
        requireSources(l.sourceIds, ['plans', pi, 'limits', li, 'sourceIds']),
      );
      plan.facts.forEach((f, fi) =>
        requireSources(f.sourceIds, ['plans', pi, 'facts', fi, 'sourceIds']),
      );
      plan.addons.forEach((a, ai) =>
        requireSources(a.sourceIds, ['plans', pi, 'addons', ai, 'sourceIds']),
      );
      if (plan.uptimeSla)
        requireSources(plan.uptimeSla.sourceIds, ['plans', pi, 'uptimeSla']);
    });
    book.allowancePools.forEach((p, i) =>
      requireSources(p.sourceIds, ['allowancePools', i, 'sourceIds']),
    );
  });

export type PriceBookInput = z.input<typeof PriceBookSchema>;
export type PriceBook = z.output<typeof PriceBookSchema>;

export class FictionalPriceBookError extends Error {
  constructor(provider: string) {
    super(`架空の料金データ（${provider}）は本番では読み込めない`);
    this.name = 'FictionalPriceBookError';
  }
}

/**
 * 料金データを検証して読み込む。本番の UI は allowFictional: false で呼び、架空の料金を拒否する（prd/05 §4）。
 */
export function parsePriceBook(
  raw: unknown,
  options: { allowFictional: boolean },
): PriceBook {
  const book = PriceBookSchema.parse(raw);
  if (book.status === 'fictional' && !options.allowFictional) {
    throw new FictionalPriceBookError(book.provider);
  }
  return book;
}
