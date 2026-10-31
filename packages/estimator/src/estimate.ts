// 見積の組み立て（prd/01 §1）: Workload → 資源シミュレーション → メーターの使用量 → 料金計算。純粋関数。
// 容量の判定（P1-8）と Estimate のスナップショット（P1-9）は後で足す。
import { convertUnit } from './num/unit.ts';
import { RESOURCE_UNITS, type ResourceKey } from './pricing/resources.ts';
import {
  priceUsage,
  PricingInputError,
  type Bill,
  type MeterUsage,
  type Subscription,
} from './pricing/price.ts';
import type { PriceBook } from './pricing/schema.ts';
import type { ArchitectureInput } from './architecture/schema.ts';
import { assessPremises, type PlatformPremise } from './premises.ts';
import { simulateResources, type Simulation } from './simulate/simulate.ts';
import { resolveWorkload } from './workload/resolve.ts';
import type { WorkloadInput } from './workload/schema.ts';

const DAYS_PER_MONTH = 730 / 24;

/** 課金先のメーターに対応のないリソース（説明表示用。課金されないのが正しいか、データの欠落かを人が見分ける）。 */
export type UnmeteredResource = {
  nodeId: string;
  resource: ResourceKey;
  quantity: number;
};

export type EstimateResult = {
  simulation: Simulation;
  usage: MeterUsage[];
  unmetered: UnmeteredResource[];
  bill: Bill;
  premises: PlatformPremise[];
};

export function toMeterUsage(
  sim: Simulation,
  books: readonly PriceBook[],
): {
  usage: MeterUsage[];
  unmetered: UnmeteredResource[];
  subscriptions: Subscription[];
} {
  const byProvider = new Map(books.map((b) => [b.provider, b]));
  const usage: MeterUsage[] = [];
  const unmetered: UnmeteredResource[] = [];
  const subs = new Map<string, Subscription>();
  const { dayFactors } = sim.workload;

  for (const node of sim.architecture.nodes) {
    const nu = sim.nodes[node.id]!;
    const billing = node.billing;
    if (!billing) {
      for (const [r, q] of Object.entries(nu.resources) as [
        ResourceKey,
        number,
      ][]) {
        unmetered.push({ nodeId: node.id, resource: r, quantity: q });
      }
      continue;
    }
    const key = `${billing.accountId}|${billing.provider}|${billing.planId}`;
    const account = sim.architecture.accounts.find(
      (a) => a.id === billing.accountId,
    );
    const sub = subs.get(key) ?? {
      accountId: billing.accountId,
      provider: billing.provider,
      planId: billing.planId,
      nodeIds: [],
      ...(account?.seats !== undefined ? { seats: account.seats } : {}),
      ...(account?.region !== undefined ? { region: account.region } : {}),
    };
    sub.nodeIds.push(node.id);
    subs.set(key, sub);

    const plan = byProvider
      .get(billing.provider)
      ?.plans.find((p) => p.id === billing.planId);
    if (!plan) throw new PricingInputError(`料金データにないプラン: ${key}`);
    for (const [r, q] of Object.entries(nu.resources) as [
      ResourceKey,
      number,
    ][]) {
      const meterId = billing.meters[r];
      const meter = meterId
        ? plan.meters.find(
            (m) => m.id === meterId || m.aliases?.includes(meterId),
          )
        : undefined;
      if (!meter) {
        unmetered.push({ nodeId: node.id, resource: r, quantity: q });
        continue;
      }
      const quantity = convertUnit(q, RESOURCE_UNITS[r], meter.unit);
      const perDay = quantity / DAYS_PER_MONTH;
      usage.push({
        accountId: billing.accountId,
        nodeId: node.id,
        provider: billing.provider,
        planId: billing.planId,
        meterId: meter.id,
        quantity,
        ...(r === 'cpu-ms' && nu.events > 0 ? { events: nu.events } : {}),
        daily: {
          weekday: perDay * dayFactors.weekday,
          weekend: perDay * dayFactors.weekend,
        },
      });
    }
  }
  return { usage, unmetered, subscriptions: [...subs.values()] };
}

export function estimate(input: {
  workload: WorkloadInput;
  architecture: ArchitectureInput;
  books: readonly PriceBook[];
}): EstimateResult {
  const workload = resolveWorkload(input.workload);
  const simulation = simulateResources(workload, input.architecture);
  const { usage, unmetered, subscriptions } = toMeterUsage(
    simulation,
    input.books,
  );
  const bill = priceUsage({
    books: input.books,
    subscriptions,
    usage,
    context: { commercial: workload.input.commercial },
  });
  const premises = assessPremises({
    simulation,
    usage,
    bill,
    books: input.books,
  });
  return { simulation, usage, unmetered, bill, premises };
}
