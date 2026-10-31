// プラットフォームの前提の判定（prd/01-domain-model.md §8.1・D-12）。純粋関数。
// 「この構成で当たっている前提」と「あと少しで当たる前提」を、見積の説明とゲームのイベントで同じ文のまま使えるように出す。
import { HOURS_PER_MONTH, type Unit } from './num/unit.ts';
import type { Bill, MeterUsage } from './pricing/price.ts';
import type { PriceBook } from './pricing/schema.ts';
import type { Simulation } from './simulate/simulate.ts';

const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

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

  // 1. 無料枠・込み分のプール（料金データの premise の文を使う）
  type PoolAgg = {
    quantity: number;
    weekday: number;
    nodeIds: Set<string>;
    meterIds: Set<string>;
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
    const key = `${u.accountId}|${u.provider}|${u.planId}|${meter.allowancePool}`;
    const agg = pools.get(key) ?? {
      quantity: 0,
      weekday: 0,
      nodeIds: new Set(),
      meterIds: new Set(),
    };
    agg.quantity += u.quantity;
    agg.weekday += u.daily?.weekday ?? u.quantity / (HOURS_PER_MONTH / 24);
    agg.nodeIds.add(u.nodeId);
    agg.meterIds.add(meter.id);
    pools.set(key, agg);
  }
  for (const [key, agg] of pools) {
    const [, provider, planId, poolId] = key.split('|') as [
      string,
      string,
      string,
      string,
    ];
    const book = books.get(provider)!;
    const pool = book.allowancePools.find((p) => p.id === poolId)!;
    const plan = book.plans.find((p) => p.id === planId)!;
    const meter = plan.meters.find((m) => agg.meterIds.has(m.id))!;
    const text = meter.premise ?? pool.premise;
    if (!text) continue;
    out.push(
      threshold({
        id: `pool:${provider}:${planId}:${poolId}`,
        text,
        effect: meter.onExceed === 'bill' ? 'cost' : meter.onExceed,
        nodeIds: [...agg.nodeIds],
        provider,
        planId,
        used: pool.period === 'day' ? agg.weekday : agg.quantity,
        limit: pool.quantity,
        unit: pool.unit,
        accumulates: pool.unit === 'gb-month',
      }),
    );
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
        (node.config.kind === 'sql-db' || node.config.kind === 'managed-db')
      ) {
        used = nu.resources['storage-gb-month'] ?? 0;
      } else if (
        limit.measure === 'peak-concurrency' &&
        node.config.kind === 'managed-db'
      ) {
        used = (nu.busyMs / 1000) * peak;
      }
      if (used === undefined) continue;
      out.push(
        threshold({
          id: `limit:${b.provider}:${b.planId}:${limit.id}:${node.id}`,
          text:
            limit.premise ??
            `${plan!.name} の ${limit.id} は ${limit.value} ${limit.unit} まで`,
          effect: limit.onExceed === 'bill' ? 'cost' : limit.onExceed,
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
        text: `回線 ${c.lineMbps} Mbps は共有で、使えるのはその一部（ピーク時間帯）`,
        effect: 'throttle',
        used: h.peakMbps,
        limit: c.lineMbps * c.lineUsable,
        unit: 'count',
        assumption: `使える割合 ${c.lineUsable}`,
      }),
      threshold({
        ...base,
        id: `host:cpu:${node.id}`,
        text: `${c.vcpu} vCPU をピーク時間帯に使い切ると遅くなる`,
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
