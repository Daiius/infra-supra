// プラットフォームの前提の判定（prd/01 §8.1）。無料枠のプールの集計を料金計算（prd/03 §4・§11）と揃える。料金はすべて架空。
import { describe, expect, it } from 'vitest';
import { assessPremises } from './premises.ts';
import { priceUsage, type MeterUsage } from './pricing/price.ts';
import { parsePriceBook, type PriceBookInput } from './pricing/schema.ts';
import type { Simulation } from './simulate/simulate.ts';

const book = parsePriceBook(
  {
    schemaVersion: 1,
    provider: 'fictional-premise',
    version: 'test-1',
    status: 'fictional',
    currency: 'USD',
    taxIncluded: false,
    retrievedAt: '2000-01-01',
    allowancePools: [
      {
        id: 'node-disk',
        quantity: 8,
        unit: 'gb-month',
        period: 'month',
        scope: 'node',
        premise: 'ディスクはノードごとに 8 GB まで込み',
      },
      {
        id: 'shared-requests',
        quantity: 1000,
        unit: 'request',
        period: 'month',
        scope: 'account',
        premise: 'リクエストはアカウント全体で 1000 件まで込み',
      },
      {
        id: 'daily-requests',
        quantity: 100,
        unit: 'request',
        period: 'day',
        scope: 'account',
        premise: '1 日 100 リクエストまで（超えると止まる）',
      },
    ],
    plans: [
      {
        id: 'db',
        service: 'database',
        name: 'DB',
        meters: [
          {
            id: 'disk',
            resource: 'storage-gb-month',
            unit: 'gb-month',
            allowancePool: 'node-disk',
            pricing: { model: 'flat', per: 1, unitPrice: 1 },
          },
        ],
      },
      {
        id: 'fn-a',
        service: 'compute',
        name: 'A',
        meters: [
          {
            id: 'requests',
            resource: 'requests',
            unit: 'request',
            allowancePool: 'shared-requests',
            pricing: { model: 'flat', per: 1000, unitPrice: 1 },
          },
        ],
      },
      {
        id: 'fn-b',
        service: 'compute',
        name: 'B',
        meters: [
          {
            id: 'requests',
            resource: 'requests',
            unit: 'request',
            allowancePool: 'shared-requests',
            pricing: { model: 'flat', per: 1000, unitPrice: 1 },
          },
        ],
      },
      {
        id: 'fn-capped',
        service: 'compute',
        name: 'Capped',
        meters: [
          {
            id: 'requests',
            resource: 'requests',
            unit: 'request',
            allowancePool: 'shared-requests',
            onExceed: 'block',
            premise: 'Capped は共有の 1000 件を超えると止まる',
            pricing: { model: 'flat', per: 1000, unitPrice: 0 },
          },
        ],
      },
      {
        id: 'free',
        service: 'compute',
        name: 'Free',
        meters: [
          {
            id: 'requests',
            resource: 'requests',
            unit: 'request',
            allowancePool: 'daily-requests',
            onExceed: 'block',
            pricing: { model: 'flat', per: 1000, unitPrice: 0 },
          },
        ],
      },
      {
        id: 'team',
        service: 'compute',
        name: 'Team',
        baseFee: { amount: 20, per: 'month', scope: 'account' },
        meters: [
          {
            id: 'requests',
            resource: 'requests',
            unit: 'request',
            pricing: { model: 'flat', per: 1000, unitPrice: 2 },
          },
          {
            id: 'egress',
            resource: 'egress-gb',
            unit: 'gb',
            pricing: { model: 'flat', per: 1, unitPrice: 0.5 },
          },
        ],
        credits: [
          {
            id: 'usage-credit',
            amount: 10,
            appliesTo: 'all-usage',
            premise:
              '月 $10 のクレジットがすべての従量に当たり、超えると請求される',
          },
        ],
      },
    ],
  } satisfies PriceBookInput,
  { allowFictional: true },
);

/** 制限・ホストの判定に使わない最小のシミュレーション（プールの判定だけを見る）。 */
const sim = {
  workload: { peakHourFactor: 1 },
  architecture: { nodes: [] },
  nodes: {},
} as unknown as Simulation;

const use = (
  planId: string,
  meterId: string,
  quantity: number,
  extra: Partial<MeterUsage> = {},
): MeterUsage => ({
  accountId: 'acct',
  nodeId: 'n1',
  provider: 'fictional-premise',
  planId,
  meterId,
  quantity,
  ...extra,
});

function assess(usage: MeterUsage[]) {
  const planIds = [...new Set(usage.map((u) => u.planId))];
  const bill = priceUsage({
    books: [book],
    subscriptions: planIds.map((planId) => ({
      accountId: 'acct',
      provider: 'fictional-premise',
      planId,
      nodeIds: [...new Set(usage.map((u) => u.nodeId))],
    })),
    usage,
  });
  return {
    bill,
    premises: assessPremises({ simulation: sim, usage, bill, books: [book] }),
  };
}

describe('無料枠のプールの前提は、料金計算と同じ単位で集計する', () => {
  it('ノード単位のプールはノードごとに判定する（2 ノード × 8 GB は超過でない）', () => {
    const { bill, premises } = assess([
      use('db', 'disk', 8, { nodeId: 'a' }),
      use('db', 'disk', 8, { nodeId: 'b' }),
    ]);
    expect(bill.totals.USD ?? 0).toBe(0);
    const pools = premises.filter((p) => p.id.startsWith('pool:'));
    expect(pools.map((p) => [p.nodeIds, p.used, p.hit])).toEqual([
      [['a'], 8, false],
      [['b'], 8, false],
    ]);
    // ノードごとに別の前提として区別できる（前方一致で引く既存の参照は変わらない）
    expect(new Set(pools.map((p) => p.id)).size).toBe(2);
    expect(
      pools.every((p) =>
        p.id.startsWith('pool:fictional-premise:db:node-disk'),
      ),
    ).toBe(true);
  });

  it('アカウント単位のプールはプランをまたいで合算する（600 + 600 > 1000）', () => {
    const { bill, premises } = assess([
      use('fn-a', 'requests', 600),
      use('fn-b', 'requests', 600),
    ]);
    expect(bill.totals.USD).toBeCloseTo(0.2);
    const pools = premises.filter((p) => p.id.startsWith('pool:'));
    // 量は合算し、前提はプランごとに出す
    expect(pools.map((p) => [p.id, p.nodeIds, p.used, p.hit])).toEqual([
      ['pool:fictional-premise:fn-a:shared-requests', ['n1'], 1200, true],
      ['pool:fictional-premise:fn-b:shared-requests', ['n1'], 1200, true],
    ]);
  });

  it('課金と停止のプランが同じプールを使うと、入力の順によらず両方の挙動が前提に残る', () => {
    for (const usage of [
      [use('fn-a', 'requests', 600), use('fn-capped', 'requests', 600)],
      [use('fn-capped', 'requests', 600), use('fn-a', 'requests', 600)],
    ]) {
      const { bill, premises } = assess(usage);
      expect(bill.breaches.map((b) => [b.priceRef.planId, b.behavior])).toEqual(
        [['fn-capped', 'block']],
      );
      const byPlan = Object.fromEntries(
        premises
          .filter((p) => p.id.startsWith('pool:'))
          .map((p) => [p.planId, p]),
      );
      expect(byPlan['fn-capped']).toMatchObject({
        effect: 'block',
        text: 'Capped は共有の 1000 件を超えると止まる',
        used: 1200,
        hit: true,
      });
      expect(byPlan['fn-a']).toMatchObject({ effect: 'cost', hit: true });
      // 当たっている止まる前提が先頭に来る
      expect(premises[0]!.planId).toBe('fn-capped');
    }
  });

  it('1 プランだけなら前提の id は従来どおり', () => {
    const { premises } = assess([use('fn-a', 'requests', 600)]);
    expect(premises.map((p) => p.id)).toEqual([
      'pool:fictional-premise:fn-a:shared-requests',
    ]);
  });
});

describe('日次のプールの前提は平日と休日の両方で判定する', () => {
  it('休日だけが上限を超えるとき、料金計算の停止と同じく当たる', () => {
    const { bill, premises } = assess([
      use('free', 'requests', 3000, { daily: { weekday: 60, weekend: 120 } }),
    ]);
    expect(bill.breaches).toHaveLength(1);
    const p = premises.find((x) => x.id.startsWith('pool:'))!;
    expect(p).toMatchObject({ used: 120, limit: 100, hit: true });
  });

  it('平日のほうが多ければ平日の値で判定する', () => {
    const { premises } = assess([
      use('free', 'requests', 3000, { daily: { weekday: 90, weekend: 30 } }),
    ]);
    expect(premises[0]).toMatchObject({ used: 90, hit: false });
  });

  it('話題・Bot が集中する日（peakDay）があれば、その日で判定し仮定を添える。課金は平日・休日のまま（D-60）', () => {
    const daily = { weekday: 90, weekend: 30 };
    const flat = assess([use('free', 'requests', 3000, { daily })]);
    const spike = assess([
      use('free', 'requests', 3000, { daily: { ...daily, peakDay: 250 } }),
    ]);
    const p = spike.premises[0]!;
    expect(p).toMatchObject({ used: 250, hit: true });
    expect(p.assumption).toContain('短い期間に集中');
    expect(flat.premises[0]!.assumption).toBeUndefined();
    // 課金（超過・明細）は変わらない
    expect(spike.bill.totals).toEqual(flat.bill.totals);
    expect(spike.bill.breaches).toEqual(flat.bill.breaches);
    // 平日より少ない集中の日は判定を変えない
    const small = assess([
      use('free', 'requests', 3000, { daily: { ...daily, peakDay: 80 } }),
    ]);
    expect(small.premises[0]).toMatchObject({ used: 90 });
    expect(small.premises[0]!.assumption).toBeUndefined();
  });
});

describe('金額のクレジットの使用率（D-48）', () => {
  it('当てられる従量の金額 / クレジットの額を、超えると請求が増える前提として出す', () => {
    // 3000 件 × $2/1000 = $6、4 GB × $0.5 = $2 → $8 / $10
    const { bill, premises } = assess([
      use('team', 'requests', 3000),
      use('team', 'egress', 4),
    ]);
    expect(bill.totals.USD).toBeCloseTo(20, 12); // 基本料だけ（従量はクレジットに収まる）
    const p = premises.find((x) => x.id.startsWith('credit:'))!;
    expect(p).toMatchObject({
      id: 'credit:fictional-premise:team:usage-credit',
      kind: 'threshold',
      effect: 'cost',
      currency: 'USD',
      limit: 10,
      hit: false,
      accumulates: false,
    });
    expect(p.used).toBeCloseTo(8, 12);
    expect(p.ratio).toBeCloseTo(0.8, 12);
    expect(p.unit).toBeUndefined();
  });

  it('超えても止まらず、使用率は 1 を超え、超えた分だけ請求される', () => {
    // 6000 件 = $12、8 GB = $4 → $16 / $10
    const { bill, premises } = assess([
      use('team', 'requests', 6000),
      use('team', 'egress', 8),
    ]);
    expect(bill.breaches).toEqual([]);
    expect(bill.totals.USD).toBeCloseTo(20 + 6, 12);
    const p = premises.find((x) => x.id.startsWith('credit:'))!;
    expect(p).toMatchObject({ hit: true, effect: 'cost' });
    expect(p.ratio).toBeCloseTo(1.6, 12);
  });

  it('従量が 0 なら前提を出さない', () => {
    const { premises } = assess([use('team', 'requests', 0)]);
    expect(premises.some((x) => x.id.startsWith('credit:'))).toBe(false);
  });
});
