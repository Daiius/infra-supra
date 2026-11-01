// 性質ベースのテスト用の小さな生成器（prd/05 §2b）。決まったシードの乱択なので、失敗はシードで再現できる。
// fast-check は入れていない（縮小が無い代わりに、失敗したシードと入力をそのまま出す。prd/05 §2b）。
import type { PriceBookInput } from './schema.ts';
import type { MeterUsage, Subscription } from './price.ts';

/** mulberry32（game の random.ts と同じ式。estimator は他のパッケージに依存しないので写した）。 */
export function rng(seed: number) {
  let s = seed | 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) =>
    lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const chance = (p: number) => next() < p;
  /** 0〜10^maxExp の量。整数・小数・ちょうど 0 が混ざる。 */
  const amount = (maxExp: number) => {
    if (chance(0.1)) return 0;
    const v = 10 ** (next() * maxExp);
    return chance(0.5) ? Math.round(v) : v;
  };
  return { next, int, pick, chance, amount };
}
export type Rng = ReturnType<typeof rng>;

/** シード 1〜n で本体を回す。失敗したらシードを付けて投げ直す（再現のため）。 */
export function forSeeds(n: number, body: (r: Rng, seed: number) => void) {
  for (let seed = 1; seed <= n; seed++) {
    try {
      body(rng(seed), seed);
    } catch (e) {
      throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
    }
  }
}

export const PROVIDER = 'fictional-gen';
export const PLAN = 'p';
export const ACCOUNT = 'a';

type Options = {
  /** volume を出すか（金額の単調性は volume では成り立たない。prd/05 §3）。 */
  volume?: boolean;
  /** 無料枠のプール・丸め・超過時の挙動・クレジット・基本料を出すか。 */
  pools?: boolean;
  rounding?: boolean;
  blockMeters?: boolean;
  credits?: 'none' | 'bill' | 'any';
  baseFee?: boolean;
};

const PERS = [1, 10, 1_000, 1_000_000] as const;
const PRICES = [0, 0.01, 0.1, 1, 10, 100] as const;
const GRANULARITIES = [0.1, 1, 10, 1_000] as const;

export function genTiers(r: Rng) {
  const n = r.int(1, 4);
  let upTo = 0;
  return Array.from({ length: n }, (_, i) => {
    upTo += r.pick([1, 10, 100, 1_000, 10_000]) * r.int(1, 9);
    return {
      upTo: i === n - 1 ? null : upTo,
      unitPrice: r.pick(PRICES),
    };
  });
}

/** 1 プランの架空の PriceBook を作る（スキーマを通る形）。メーターは m0, m1, … */
export function genBook(r: Rng, o: Options = {}): PriceBookInput {
  const nMeters = r.int(1, 4);
  const pools = o.pools
    ? Array.from({ length: r.int(1, 2) }, (_, i) => ({
        id: `pool${i}`,
        quantity: r.pick([0, 10, 1_000, 100_000]),
        unit: 'request' as const,
        period: r.pick(['month', 'day'] as const),
        scope: r.pick(['account', 'node'] as const),
      }))
    : [];
  const meters = Array.from({ length: nMeters }, (_, i) => {
    const model = r.pick(
      o.volume
        ? (['flat', 'tiered', 'volume'] as const)
        : (['flat', 'tiered'] as const),
    );
    const per = r.pick(PERS);
    const pricing =
      model === 'flat'
        ? { model, per, unitPrice: r.pick(PRICES) }
        : { model, per, tiers: genTiers(r) };
    return {
      id: `m${i}`,
      resource: 'requests' as const,
      unit: 'request' as const,
      ...(pools.length > 0 && r.chance(0.7)
        ? { allowancePool: r.pick(pools).id }
        : {}),
      ...(o.rounding && r.chance(0.5)
        ? {
            rounding: {
              granularity: r.pick(GRANULARITIES),
              scope: r.pick(['event', 'period'] as const),
            },
          }
        : {}),
      ...(o.blockMeters && r.chance(0.3)
        ? { onExceed: r.pick(['block', 'throttle', 'adjust'] as const) }
        : {}),
      pricing,
    };
  });
  const creditKinds =
    o.credits === 'any' ? (['bill', 'block'] as const) : (['bill'] as const);
  const credits =
    o.credits && o.credits !== 'none'
      ? Array.from({ length: r.int(0, 2) }, (_, i) => ({
          id: `c${i}`,
          amount: r.pick([1, 10, 100, 1_000]),
          appliesTo: r.chance(0.5)
            ? ('all-usage' as const)
            : {
                meterIds: meters
                  .filter(() => r.chance(0.5))
                  .map((m) => m.id)
                  .concat('m0'),
              },
          onExhausted: r.pick(creditKinds),
        }))
      : [];
  return {
    schemaVersion: 1,
    provider: PROVIDER,
    version: 'gen',
    status: 'fictional',
    currency: 'USD',
    taxIncluded: false,
    retrievedAt: '2000-01-01',
    allowancePools: pools,
    plans: [
      {
        id: PLAN,
        service: 'gen',
        name: 'Generated',
        ...(o.baseFee && r.chance(0.5)
          ? {
              baseFee: {
                amount: r.pick([1, 10, 100]),
                per: 'month' as const,
                scope: r.pick(['account', 'node'] as const),
              },
            }
          : {}),
        meters,
        credits,
      },
    ],
  };
}

export const genSub = (account = ACCOUNT): Subscription => ({
  accountId: account,
  provider: PROVIDER,
  planId: PLAN,
  nodeIds: ['n1', 'n2'],
});

/** 各メーターに 0〜2 件の使用量（ノード n1・n2 に分ける）。 */
export function genUsage(
  r: Rng,
  book: PriceBookInput,
  account = ACCOUNT,
): MeterUsage[] {
  return book.plans[0]!.meters.flatMap((m) =>
    Array.from({ length: r.int(0, 2) }, (_, i) => ({
      accountId: account,
      nodeId: `n${i + 1}`,
      provider: PROVIDER,
      planId: PLAN,
      meterId: m.id,
      quantity: r.amount(7),
      ...(r.chance(0.5) ? { events: r.int(1, 10_000) } : {}),
    })),
  );
}
