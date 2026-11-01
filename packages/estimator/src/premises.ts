// プラットフォームの前提の判定（prd/01-domain-model.md §8.1・D-12）。純粋関数。
// 「この構成で当たっている前提」と「あと少しで当たる前提」を、見積の説明とゲームのイベントで同じ文のまま使えるように出す。
import type { Currency } from './num/money.ts';
import { HOURS_PER_MONTH, type Unit } from './num/unit.ts';
import type { Bill, MeterUsage, OverageBehavior } from './pricing/price.ts';
import type { PriceBook } from './pricing/schema.ts';
import type { Simulation } from './simulate/simulate.ts';

const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

/** 超過時の挙動の重い順（前提の挙動を 1 つに選ぶとき）。 */
const OVERAGE_SEVERITY: readonly OverageBehavior[] = [
  'block',
  'upgrade-required',
  'throttle',
  'bill',
];

export type PremiseEffect =
  'block' | 'throttle' | 'upgrade-required' | 'cost' | 'policy' | 'info';

export type PlatformPremise = {
  id: string;
  text: string;
  /** threshold: 量の境目がある / fact: 常に効く事実（spike 所見 14） */
  kind: 'threshold' | 'fact';
  effect: PremiseEffect;
  nodeIds: string[];
  provider?: string;
  planId?: string;
  used?: number;
  limit?: number;
  unit?: Unit;
  /** used・limit が金額のとき（クレジット）の通貨。このとき unit は持たない。 */
  currency?: Currency;
  /** used / limit。threshold のときだけ。 */
  ratio?: number;
  /** 当たっている（境目を超えた・資格を満たさない）。 */
  hit: boolean;
  /**
   * ためていく量（保存量・容量）か。true なら月ごとの増分で、false（流量）なら伸び率で先を見込む（prd/07 §5）。
   */
  accumulates?: boolean;
  /** 仮定に基づく判定か（ホストの容量など）。 */
  assumption?: string;
};

function threshold(
  p: Omit<PlatformPremise, 'kind' | 'ratio' | 'hit'> & {
    used: number;
    limit: number;
  },
): PlatformPremise {
  const ratio = p.limit > 0 ? p.used / p.limit : p.used > 0 ? Infinity : 0;
  return { ...p, kind: 'threshold', ratio, hit: ratio > 1 };
}

export function assessPremises(input: {
  simulation: Simulation;
  usage: readonly MeterUsage[];
  bill: Bill;
  books: readonly PriceBook[];
}): PlatformPremise[] {
  const { simulation: sim, usage, bill } = input;
  const books = new Map(input.books.map((b) => [b.provider, b]));
  const out: PlatformPremise[] = [];
  const peak = sim.workload.peakHourFactor / SECONDS_PER_MONTH;

  // 1. 無料枠・込み分のプール（料金データの premise の文を使う）。
  //    集計の単位は料金計算と同じ（prd/03 §4・§11）: node 単位はノードごと、account 単位はプランをまたいで合算する。
  //    日次のプールは平日・休日の 1 日分のうち多いほうで判定する（料金計算も両方で超過を数える）。
  type PoolAgg = {
    accountId: string;
    provider: string;
    poolId: string;
    nodeId?: string;
    quantity: number;
    weekday: number;
    weekend: number;
    /** プールを使ったプランごとのメーターとノード（出てきた順）。前提の文と挙動はプランごとに出す。 */
    plans: Map<string, { meterIds: Set<string>; nodeIds: Set<string> }>;
  };
  const pools = new Map<string, PoolAgg>();
  const factMeters = new Map<
    string,
    { provider: string; planId: string; meterId: string; nodeIds: Set<string> }
  >();
  for (const u of usage) {
    const book = books.get(u.provider);
    const meter = book?.plans
      .find((p) => p.id === u.planId)
      ?.meters.find((m) => m.id === u.meterId);
    if (!book || !meter) continue;
    if (!meter.allowancePool) {
      if (meter.premise) {
        const key = `${u.provider}|${u.planId}|${meter.id}`;
        const f = factMeters.get(key) ?? {
          provider: u.provider,
          planId: u.planId,
          meterId: meter.id,
          nodeIds: new Set(),
        };
        f.nodeIds.add(u.nodeId);
        factMeters.set(key, f);
      }
      continue;
    }
    const pool = book.allowancePools.find((p) => p.id === meter.allowancePool)!;
    const nodeId = pool.scope === 'node' ? u.nodeId : undefined;
    const key = `${u.accountId}|${nodeId ?? ''}|${u.provider}|${pool.id}`;
    const agg = pools.get(key) ?? {
      accountId: u.accountId,
      provider: u.provider,
      poolId: pool.id,
      ...(nodeId !== undefined ? { nodeId } : {}),
      quantity: 0,
      weekday: 0,
      weekend: 0,
      plans: new Map(),
    };
    const uniform = u.quantity / (HOURS_PER_MONTH / 24);
    agg.quantity += u.quantity;
    agg.weekday += u.daily?.weekday ?? uniform;
    agg.weekend += u.daily?.weekend ?? uniform;
    const pu = agg.plans.get(u.planId) ?? {
      meterIds: new Set<string>(),
      nodeIds: new Set<string>(),
    };
    pu.meterIds.add(meter.id);
    pu.nodeIds.add(u.nodeId);
    agg.plans.set(u.planId, pu);
    pools.set(key, agg);
  }
  for (const agg of pools.values()) {
    const book = books.get(agg.provider)!;
    const pool = book.allowancePools.find((p) => p.id === agg.poolId)!;
    const used =
      pool.period === 'day' ? Math.max(agg.weekday, agg.weekend) : agg.quantity;
    // 量はプールの単位で合算し、文と超過時の挙動はプランごとに出す（課金と停止のプランが同じ枠を使うことがある）。
    // プランの中で挙動が分かれるときは重いほう（止まる → 有料プランが要る → 遅くなる → 費用）を出す
    for (const [planId, pu] of agg.plans) {
      const meters = book.plans
        .find((p) => p.id === planId)!
        .meters.filter((m) => pu.meterIds.has(m.id));
      const meter = meters.reduce((a, m) =>
        OVERAGE_SEVERITY.indexOf(m.onExceed) <
        OVERAGE_SEVERITY.indexOf(a.onExceed)
          ? m
          : a,
      );
      const text = meter.premise ?? pool.premise;
      if (!text) continue;
      out.push(
        threshold({
          // ノード単位ならノードを足す（前方一致の参照は保つ）
          id: `pool:${agg.provider}:${planId}:${pool.id}${agg.nodeId !== undefined ? `:${agg.nodeId}` : ''}`,
          text,
          effect: meter.onExceed === 'bill' ? 'cost' : meter.onExceed,
          nodeIds: [...pu.nodeIds],
          provider: agg.provider,
          planId,
          used,
          limit: pool.quantity,
          unit: pool.unit,
          accumulates: pool.unit === 'gb-month',
        }),
      );
    }
  }
  for (const f of factMeters.values()) {
    const meter = books
      .get(f.provider)!
      .plans.find((p) => p.id === f.planId)!
      .meters.find((m) => m.id === f.meterId)!;
    out.push({
      id: `fact:${f.provider}:${f.planId}:${f.meterId}`,
      text: meter.premise!,
      kind: 'fact',
      effect: 'info',
      nodeIds: [...f.nodeIds],
      provider: f.provider,
      planId: f.planId,
      hit: false,
    });
  }

  // 1b. 金額のクレジット（料金データの premise の文を使う。D-48）。
  //     使用率は「当てられる従量の金額 / クレジットの額」。超えても止まらず、超えた分が請求される（cost）。
  //     流量と同じく伸び率で先を見込む（accumulates: false）
  for (const l of bill.lines) {
    if (l.kind !== 'credit' || !l.credit) continue;
    const credit = books
      .get(l.priceRef.provider)
      ?.plans.find((p) => p.id === l.priceRef.planId)
      ?.credits.find((c) => c.id === l.credit!.id);
    if (!credit?.premise) continue;
    out.push(
      threshold({
        id: `credit:${l.priceRef.provider}:${l.priceRef.planId}:${credit.id}`,
        text: credit.premise,
        effect: 'cost',
        nodeIds: l.nodeIds,
        provider: l.priceRef.provider,
        planId: l.priceRef.planId,
        used: l.credit.eligible,
        limit: l.credit.limit,
        currency: l.currency,
        accumulates: false,
      }),
    );
  }

  // 2. 制限（Limit）: 資源シミュレーションの値と比べる
  for (const node of sim.architecture.nodes) {
    const b = node.billing;
    if (!b) continue;
    const plan = books.get(b.provider)?.plans.find((p) => p.id === b.planId);
    const nu = sim.nodes[node.id]!;
    for (const limit of plan?.limits ?? []) {
      let used: number | undefined;
      if (
        limit.measure === 'cpu-ms-per-request' &&
        node.config.kind === 'function'
      ) {
        used = nu.maxCpuMsPerRequest;
      } else if (
        limit.measure === 'storage-gb' &&
        (node.config.kind === 'sql-db' ||
          node.config.kind === 'managed-db' ||
          node.config.kind === 'request-db' ||
          node.config.kind === 'processing-db')
      ) {
        used = nu.resources['storage-gb-month'] ?? 0;
      } else if (
        limit.measure === 'peak-concurrency' &&
        node.config.kind === 'managed-db'
      ) {
        used = (nu.peakBusyMs / 1000) * peak;
      } else if (
        limit.measure === 'writes-per-second-per-key' &&
        node.config.kind === 'kv' &&
        node.config.hotKeyShare > 0
      ) {
        used =
          (nu.resources['kv-writes'] ?? 0) * node.config.hotKeyShare * peak;
      }
      if (used === undefined) continue;
      // 同じキーへの書き込みは、超えた書き込みが失敗する（料金データの onExceed）が、サイト全体は止まらない。
      // 止める（block）のでなく遅くなる（throttle）として返すのは仮定（D-24 X-3）
      const perKey = limit.measure === 'writes-per-second-per-key';
      out.push(
        threshold({
          id: `limit:${b.provider}:${b.planId}:${limit.id}:${node.id}`,
          text:
            limit.premise ??
            `${plan!.name} の ${limit.id} は ${limit.value} ${limit.unit} まで`,
          ...(perKey
            ? {
                assumption: `集中するキーへの書き込みの割合 ${node.config.kind === 'kv' ? node.config.hotKeyShare : 0}（仮定）。超えた書き込みは失敗するが、サイト全体は止まらないので遅くなるとして扱う（仮定）`,
              }
            : {}),
          effect: perKey
            ? 'throttle'
            : limit.onExceed === 'bill'
              ? 'cost'
              : limit.onExceed,
          nodeIds: [node.id],
          provider: b.provider,
          planId: b.planId,
          used,
          limit: limit.value,
          unit: limit.unit,
          accumulates: limit.measure === 'storage-gb',
        }),
      );
    }
  }

  // 2b. ノードが挙げた事実（部品の選び方しだいで効く。D-24）
  for (const node of sim.architecture.nodes) {
    const b = node.billing;
    if (!b || node.facts.length === 0) continue;
    const plan = books.get(b.provider)?.plans.find((p) => p.id === b.planId);
    for (const id of node.facts) {
      const fact = plan?.facts.find((f) => f.id === id);
      if (!fact) continue;
      out.push({
        id: `fact:${b.provider}:${b.planId}:${fact.id}`,
        text: fact.premise,
        kind: 'fact',
        effect: 'info',
        nodeIds: [node.id],
        provider: b.provider,
        planId: b.planId,
        hit: false,
      });
    }
  }

  // 3. ホストの容量（値は構成の仮定）
  for (const node of sim.architecture.nodes) {
    const c = node.config;
    const h = sim.nodes[node.id]!.host;
    if (c.kind !== 'host' || !h) continue;
    const base = {
      nodeIds: [node.id],
      ...(node.billing
        ? { provider: node.billing.provider, planId: node.billing.planId }
        : {}),
    };
    out.push(
      threshold({
        ...base,
        id: `host:line:${node.id}`,
        text: `回線 ${c.lineMbps} Mbps は共有で、使えるのはその一部（ピーク時間帯。話題・Bot の上乗せは短い期間に集中すると仮定）`,
        effect: 'throttle',
        used: h.peakMbps,
        limit: c.lineMbps * c.lineUsable,
        unit: 'count',
        assumption: `使える割合 ${c.lineUsable}`,
      }),
      threshold({
        ...base,
        id: `host:cpu:${node.id}`,
        text: `${c.vcpu} vCPU をピーク時間帯に使い切ると遅くなる（話題・Bot の上乗せは短い期間に集中すると仮定）`,
        effect: 'throttle',
        used: h.peakCores,
        limit: c.vcpu * c.cpuUtilMax,
        unit: 'count',
        assumption: `使用率 ${c.cpuUtilMax} まで`,
      }),
      threshold({
        ...base,
        id: `host:memory:${node.id}`,
        text: `メモリ ${c.memoryGB} GB に OS・DB・アプリが同居する`,
        effect: 'block',
        used: h.memoryGB,
        limit: c.memoryGB,
        unit: 'gb',
        assumption: '常駐メモリは仮定',
      }),
      threshold({
        ...base,
        id: `host:disk:${node.id}`,
        text: `ディスク ${c.diskGB} GB に DB と画像を置く`,
        effect: 'block',
        used: h.diskGB,
        limit: c.diskGB,
        unit: 'gb',
        accumulates: true,
      }),
    );
  }

  // 4. 利用資格
  for (const v of bill.eligibilityViolations) {
    out.push({
      id: `eligibility:${v.priceRef.provider}:${v.priceRef.planId}:${v.requirement}`,
      text: v.premise,
      kind: 'fact',
      effect: 'policy',
      nodeIds: [],
      provider: v.priceRef.provider,
      planId: v.priceRef.planId,
      hit: true,
    });
  }

  // 当たっている止まる前提 → 当たっている前提 → 近い順
  const severity = (p: PlatformPremise) =>
    p.hit && (p.effect === 'block' || p.effect === 'policy')
      ? 0
      : p.hit
        ? 1
        : 2;
  return out.sort(
    (a, b) => severity(a) - severity(b) || (b.ratio ?? -1) - (a.ratio ?? -1),
  );
}
