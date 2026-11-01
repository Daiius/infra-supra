// 料金計算（prd/03-pricing-schema.md・prd/05-test-strategy.md §2）。純粋関数。
// 使用量（メーター単位）に料金データを当てて Bill を作る。容量・制限の判定（Limit）は P1-8 で別に行う。
//
// 順序: 1 回ごとの丸め → 無料枠のプール（合算してから引く）→ 超過時の挙動 → 期間の丸め → 単価（flat / tiered / volume）
//       → クレジット → 固定費
import { ceilUnits, overage, sum } from '../num/arith.ts';
import type { Currency } from '../num/money.ts';
import { HOURS_PER_MONTH } from '../num/unit.ts';
import { OVERAGE_BEHAVIORS } from './schema.ts';
import type { Meter, Plan, PriceBook, Pricing } from './schema.ts';

export type OverageBehavior = (typeof OVERAGE_BEHAVIORS)[number];

/** 1 か月の平日・休日の日数（730 時間 = 30.416… 日を 5:2 で分ける。prd/01 §3.3 の仮定）。 */
export const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;
export const WEEKDAYS_PER_MONTH = (DAYS_PER_MONTH * 5) / 7;
export const WEEKEND_DAYS_PER_MONTH = (DAYS_PER_MONTH * 2) / 7;

/** どのアカウントがどのプランを契約しているか。 */
export type Subscription = {
  accountId: string;
  provider: string;
  planId: string;
  /** ノード単位の固定費（インスタンスなど）を数えるためのノード。 */
  nodeIds: string[];
  seats?: number;
  region?: string;
  /** 利用者が選んだ超過時の挙動（configurableOnExceed の範囲だけ）。 */
  onExceed?: Record<string, OverageBehavior>;
};

export type MeterUsage = {
  accountId: string;
  nodeId: string;
  provider: string;
  planId: string;
  /** メーターの ID または別名。 */
  meterId: string;
  /** 月間の使用量（メーターの単位）。 */
  quantity: number;
  /** 1 回ごとの丸め（rounding.scope: event）に使う件数。 */
  events?: number;
  /** 日次の無料枠の評価に使う 1 日あたりの使用量。無い場合は月の使用量を日数で均等に割る仮定。 */
  daily?: {
    weekday: number;
    weekend: number;
    /**
     * 月のうち最も多い日（話題・Bot の上乗せが短い期間に集中する日。D-60）。日次の前提の判定だけに使い、課金には使わない。
     * 無ければ平日・休日の多いほう。
     */
    peakDay?: number;
  };
};

export type PricingContext = {
  /** 商用利用か（利用資格の判定。prd/03 §9 の eligibility）。 */
  commercial?: boolean;
};

export type PriceRef = {
  provider: string;
  version: string;
  planId: string;
  meterId?: string;
};

export type TierCharge = {
  from: number;
  to: number | null;
  quantity: number;
  unitPrice: number;
  per: number;
  amount: number;
};

export type LineItem = {
  kind: 'base-fee' | 'usage' | 'credit';
  accountId: string;
  nodeIds: string[];
  currency: Currency;
  /** 金額。料金未取得（unpriced）のときは null で、合計には入らない。 */
  amount: number | null;
  status: 'priced' | 'unpriced' | 'blocked';
  priceRef: PriceRef;
  quantity?: number;
  allowanceApplied?: number;
  billableQuantity?: number;
  tiers?: TierCharge[];
  /** 計算に使った仮定（丸めが記載なし・日次の均等割りなど）。 */
  assumptions: string[];
  note?: string;
  /** kind: 'credit' のとき: どのクレジットを、当てられる従量のいくらに当てたか（使用率の前提に使う。D-48）。 */
  credit?: { id: string; limit: number; eligible: number };
};

export type LimitBreach = {
  kind: 'allowance-exceeded';
  accountId: string;
  nodeIds: string[];
  priceRef: PriceRef;
  behavior: Exclude<OverageBehavior, 'bill'>;
  /** 無料枠・込み分を超えた量（メーターの単位・月あたり）。 */
  excess: number;
  premise?: string;
};

export type EligibilityViolation = {
  accountId: string;
  priceRef: PriceRef;
  requirement: string;
  premise: string;
};

export type Bill = {
  lines: LineItem[];
  /** 通貨ごとの合計（料金未取得の明細は含まない = 下限）。 */
  totals: Partial<Record<Currency, number>>;
  unpricedLines: number;
  breaches: LimitBreach[];
  eligibilityViolations: EligibilityViolation[];
  priceBookVersions: Record<string, string>;
};

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingInputError';
  }
}

type Entry = {
  usage: MeterUsage;
  book: PriceBook;
  plan: Plan;
  meter: Meter;
  sub: Subscription;
  quantity: number; // 1 回ごとの丸めを適用した後
  billable: number; // 無料枠を引いた後
  assumptions: string[];
};

const subKey = (accountId: string, provider: string, planId: string) =>
  `${accountId}|${provider}|${planId}`;

function findMeter(plan: Plan, id: string): Meter | undefined {
  return plan.meters.find((m) => m.id === id || m.aliases?.includes(id));
}

function pricingFor(meter: Meter, region: string | undefined): Pricing {
  const regional = region
    ? meter.regional?.find((r) => r.region === region)
    : undefined;
  return regional?.pricing ?? meter.pricing;
}

function charge(
  pricing: Exclude<Pricing, { model: 'unpriced' }>,
  quantity: number,
): { amount: number; tiers?: TierCharge[] } {
  if (pricing.model === 'flat') {
    return { amount: (quantity / pricing.per) * pricing.unitPrice };
  }
  if (pricing.model === 'volume') {
    const tier =
      pricing.tiers.find((t) => t.upTo === null || quantity <= t.upTo) ??
      pricing.tiers[pricing.tiers.length - 1]!;
    const amount = (quantity / pricing.per) * tier.unitPrice;
    return {
      amount,
      tiers: [
        {
          from: 0,
          to: tier.upTo,
          quantity,
          unitPrice: tier.unitPrice,
          per: pricing.per,
          amount,
        },
      ],
    };
  }
  const tiers: TierCharge[] = [];
  let from = 0;
  for (const t of pricing.tiers) {
    const to = t.upTo;
    const inTier = Math.max(0, Math.min(quantity, to ?? Infinity) - from);
    if (inTier > 0) {
      tiers.push({
        from,
        to,
        quantity: inTier,
        unitPrice: t.unitPrice,
        per: pricing.per,
        amount: (inTier / pricing.per) * t.unitPrice,
      });
    }
    if (to === null || quantity <= to) break;
    from = to;
  }
  return { amount: sum(tiers.map((t) => t.amount)), tiers };
}

export function priceUsage(input: {
  books: readonly PriceBook[];
  subscriptions: readonly Subscription[];
  usage: readonly MeterUsage[];
  context?: PricingContext;
}): Bill {
  const books = new Map(input.books.map((b) => [b.provider, b]));
  const subs = new Map<string, Subscription>();
  for (const s of input.subscriptions) {
    const key = subKey(s.accountId, s.provider, s.planId);
    if (subs.has(key)) throw new PricingInputError(`契約が重複: ${key}`);
    if (!books.get(s.provider)?.plans.some((p) => p.id === s.planId)) {
      throw new PricingInputError(`料金データにないプラン: ${key}`);
    }
    subs.set(key, s);
  }

  // 1. 使用量を料金データに結びつけ、1 回ごとの丸めを当てる
  const entries: Entry[] = input.usage.map((usage) => {
    const sub = subs.get(subKey(usage.accountId, usage.provider, usage.planId));
    if (!sub) {
      throw new PricingInputError(
        `契約のない使用量: ${usage.accountId}/${usage.provider}/${usage.planId}`,
      );
    }
    const book = books.get(usage.provider)!;
    const plan = book.plans.find((p) => p.id === usage.planId)!;
    const meter = findMeter(plan, usage.meterId);
    if (!meter) {
      throw new PricingInputError(
        `プラン ${plan.id} にメーター ${usage.meterId} がない`,
      );
    }
    if (!(usage.quantity >= 0) || !Number.isFinite(usage.quantity)) {
      throw new PricingInputError(
        `使用量は 0 以上の有限の数: ${usage.quantity}`,
      );
    }
    const assumptions: string[] = [];
    let quantity = usage.quantity;
    const r = meter.rounding;
    if (r === 'not-stated') {
      assumptions.push('丸めが料金表に記載なし。丸めなしで計算');
    } else if (r?.scope === 'event') {
      const events = usage.events ?? 0;
      if (events > 0) {
        const unitsPerEvent = ceilUnits(usage.quantity / events, r.granularity);
        quantity = unitsPerEvent * r.granularity * events;
        assumptions.push(
          `1 回ごとに ${r.granularity} ${meter.unit} 単位で切り上げ（全 ${events} 件が平均値をとると仮定）`,
        );
      }
    }
    return {
      usage,
      book,
      plan,
      meter,
      sub,
      quantity,
      billable: quantity,
      assumptions,
    };
  });

  // 2. 無料枠のプール: 同じプールを使う使用量は合算してから引き、超過分を使用量に比例して按分する
  const poolGroups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.meter.allowancePool) continue;
    const pool = e.book.allowancePools.find(
      (p) => p.id === e.meter.allowancePool,
    )!;
    const scopeKey =
      pool.scope === 'node'
        ? `${e.usage.accountId}|${e.usage.nodeId}`
        : e.usage.accountId;
    const key = `${scopeKey}|${e.book.provider}|${pool.id}`;
    poolGroups.set(key, [...(poolGroups.get(key) ?? []), e]);
  }
  for (const group of poolGroups.values()) {
    const first = group[0]!;
    const pool = first.book.allowancePools.find(
      (p) => p.id === first.meter.allowancePool,
    )!;
    const total = sum(group.map((e) => e.quantity));
    if (total === 0) continue;
    let excess: number;
    if (pool.period === 'month') {
      excess = overage(total, pool.quantity);
    } else {
      const perDay = (e: Entry) => {
        if (e.usage.daily) return e.usage.daily;
        const uniform = e.quantity / DAYS_PER_MONTH;
        e.assumptions.push(
          '日次の無料枠: 1 日あたりの使用量を月の均等割りと仮定',
        );
        return { weekday: uniform, weekend: uniform };
      };
      const days = group.map(perDay);
      const weekday = sum(days.map((d) => d.weekday));
      const weekend = sum(days.map((d) => d.weekend));
      excess =
        overage(weekday, pool.quantity) * WEEKDAYS_PER_MONTH +
        overage(weekend, pool.quantity) * WEEKEND_DAYS_PER_MONTH;
    }
    for (const e of group) e.billable = (excess * e.quantity) / total;
  }

  // 3. アカウント × プラン × メーターで集計する（段階料金はアカウントの合計に当てる）
  type Agg = {
    entries: Entry[];
    quantity: number;
    billable: number;
  };
  const aggs = new Map<string, Agg>();
  for (const e of entries) {
    const key = `${subKey(e.usage.accountId, e.book.provider, e.plan.id)}|${e.meter.id}`;
    const a = aggs.get(key) ?? { entries: [], quantity: 0, billable: 0 };
    a.entries.push(e);
    a.quantity += e.quantity;
    a.billable += e.billable;
    aggs.set(key, a);
  }

  const lines: LineItem[] = [];
  const breaches: LimitBreach[] = [];
  for (const a of aggs.values()) {
    const { book, plan, meter, sub } = a.entries[0]!;
    const nodeIds = [...new Set(a.entries.map((e) => e.usage.nodeId))];
    const assumptions = [...new Set(a.entries.flatMap((e) => e.assumptions))];
    const priceRef: PriceRef = {
      provider: book.provider,
      version: book.version,
      planId: plan.id,
      meterId: meter.id,
    };
    const base = {
      kind: 'usage' as const,
      accountId: sub.accountId,
      nodeIds,
      currency: book.currency,
      priceRef,
      quantity: a.quantity,
      allowanceApplied: a.quantity - a.billable,
      assumptions,
    };

    // 4. 超過時の挙動。課金されない挙動は金額 0 の明細と LimitBreach になる
    const chosen = sub.onExceed?.[meter.id];
    if (chosen && !meter.configurableOnExceed?.includes(chosen)) {
      throw new PricingInputError(
        `メーター ${meter.id} の超過時の挙動に ${chosen} は選べない`,
      );
    }
    const behavior = chosen ?? meter.onExceed;
    if (behavior !== 'bill' && a.billable > 0) {
      breaches.push({
        kind: 'allowance-exceeded',
        accountId: sub.accountId,
        nodeIds,
        priceRef,
        behavior,
        excess: a.billable,
        ...(meter.premise ? { premise: meter.premise } : {}),
      });
      lines.push({
        ...base,
        amount: 0,
        status: 'blocked',
        billableQuantity: 0,
      });
      continue;
    }

    // 5. 期間の丸め
    let billable = a.billable;
    const r = meter.rounding;
    if (r !== undefined && r !== 'not-stated' && r.scope === 'period') {
      billable = ceilUnits(billable, r.granularity) * r.granularity;
    }

    // 6. 単価
    const pricing = pricingFor(meter, sub.region);
    if (pricing.model === 'unpriced') {
      lines.push({
        ...base,
        amount: null,
        status: 'unpriced',
        billableQuantity: billable,
        note: pricing.note,
      });
      continue;
    }
    const { amount, tiers } = charge(pricing, billable);
    lines.push({
      ...base,
      amount,
      status: 'priced',
      billableQuantity: billable,
      ...(tiers ? { tiers } : {}),
    });
  }

  // 7. クレジット: 同じアカウント × プランの従量の明細に当てる。余りは繰り越さない。
  //    対象が重なるクレジットが複数あれば、先に当てた分を明細の残りから差し引く（従量を超えて引かない）
  const uncredited = new Map<LineItem, number>(
    lines.map((l) => [l, l.amount ?? 0]),
  );
  for (const sub of input.subscriptions) {
    const book = books.get(sub.provider)!;
    const plan = book.plans.find((p) => p.id === sub.planId)!;
    for (const c of plan.credits) {
      const targets = lines.filter(
        (l) =>
          l.kind === 'usage' &&
          l.accountId === sub.accountId &&
          l.priceRef.provider === book.provider &&
          l.priceRef.planId === plan.id &&
          l.amount !== null &&
          (c.appliesTo === 'all-usage' ||
            c.appliesTo.meterIds.includes(l.priceRef.meterId!)),
      );
      const eligible = sum(targets.map((l) => uncredited.get(l)!));
      const applied = Math.min(c.amount, eligible);
      if (applied <= 0) continue;
      let rest = applied;
      for (const l of targets) {
        const take = Math.min(rest, uncredited.get(l)!);
        uncredited.set(l, uncredited.get(l)! - take);
        rest -= take;
      }
      lines.push({
        kind: 'credit',
        accountId: sub.accountId,
        nodeIds: [...new Set(targets.flatMap((l) => l.nodeIds))],
        currency: book.currency,
        amount: -applied,
        status: 'priced',
        priceRef: {
          provider: book.provider,
          version: book.version,
          planId: plan.id,
        },
        assumptions: [],
        note: `${c.id}（上限 ${c.amount}）`,
        credit: { id: c.id, limit: c.amount, eligible },
      });
    }
  }

  // 8. 固定費
  for (const sub of input.subscriptions) {
    const book = books.get(sub.provider)!;
    const plan = book.plans.find((p) => p.id === sub.planId)!;
    const fee = plan.baseFee;
    if (!fee) continue;
    let perUnit =
      fee.per === 'hour' ? fee.amount * HOURS_PER_MONTH : fee.amount;
    if (fee.monthlyCap !== undefined)
      perUnit = Math.min(perUnit, fee.monthlyCap);
    const count = fee.scope === 'node' ? sub.nodeIds.length : 1;
    const seats = fee.perSeat ? (sub.seats ?? 1) : 1;
    lines.unshift({
      kind: 'base-fee',
      accountId: sub.accountId,
      nodeIds: sub.nodeIds,
      currency: book.currency,
      amount: perUnit * count * seats,
      status: 'priced',
      priceRef: {
        provider: book.provider,
        version: book.version,
        planId: plan.id,
      },
      quantity: count * seats,
      assumptions: fee.per === 'hour' ? ['1 か月 = 730 時間'] : [],
    });
  }

  // 9. 利用資格
  const eligibilityViolations: EligibilityViolation[] = [];
  for (const sub of input.subscriptions) {
    const book = books.get(sub.provider)!;
    const plan = book.plans.find((p) => p.id === sub.planId)!;
    for (const el of plan.eligibility) {
      if (el.requirement === 'non-commercial' && input.context?.commercial) {
        eligibilityViolations.push({
          accountId: sub.accountId,
          priceRef: {
            provider: book.provider,
            version: book.version,
            planId: plan.id,
          },
          requirement: el.requirement,
          premise: el.premise,
        });
      }
    }
  }

  const totals: Partial<Record<Currency, number>> = {};
  for (const l of lines) {
    if (l.amount === null) continue;
    totals[l.currency] = (totals[l.currency] ?? 0) + l.amount;
  }
  const priceBookVersions: Record<string, string> = {};
  for (const s of input.subscriptions) {
    priceBookVersions[s.provider] = books.get(s.provider)!.version;
  }
  return {
    lines,
    totals,
    unpricedLines: lines.filter((l) => l.status === 'unpriced').length,
    breaches,
    eligibilityViolations,
    priceBookVersions,
  };
}
