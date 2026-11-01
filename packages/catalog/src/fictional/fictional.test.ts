// 架空の料金データ（prd/05 §1）の検証と、料金計算の仕組みを一通り通す手計算の例。
// 値はすべて架空なので、金額をテストに書いてよい（実在の料金の金額は書かない。prd/05 §1）。
import { describe, expect, it } from 'vitest';
import {
  convertMoney,
  FictionalPriceBookError,
  parsePriceBook,
  priceUsage,
  PriceBookSchema,
  type MeterUsage,
  type Subscription,
} from 'estimator';
import { RAW_PRICE_BOOKS } from '../index.ts';
import { FICTIONAL_PRICE_BOOKS, loadFictionalPriceBooks } from './index.ts';

const books = loadFictionalPriceBooks();

const sub = (
  provider: string,
  planId: string,
  extra: Partial<Subscription> = {},
): Subscription => ({
  accountId: 'acct',
  provider,
  planId,
  nodeIds: ['n1'],
  ...extra,
});
const use = (
  provider: string,
  planId: string,
  meterId: string,
  quantity: number,
  extra: Partial<MeterUsage> = {},
): MeterUsage => ({
  accountId: 'acct',
  nodeId: 'n1',
  provider,
  planId,
  meterId,
  quantity,
  ...extra,
});
const bill = (
  subscriptions: Subscription[],
  usage: MeterUsage[],
  commercial = false,
) => priceUsage({ books, subscriptions, usage, context: { commercial } });
const line = (b: ReturnType<typeof bill>, meterId: string) =>
  b.lines.find((l) => l.kind === 'usage' && l.priceRef.meterId === meterId)!;

describe('架空の料金データ', () => {
  it.each(FICTIONAL_PRICE_BOOKS.map((b) => [b.provider, b]))(
    '%s がスキーマを通り、架空と分かる（fictional- の ID・status・出典・備考）',
    (_, raw) => {
      const r = PriceBookSchema.safeParse(raw);
      expect(r.success ? [] : r.error.issues).toEqual([]);
      const b = r.data!;
      expect(b.provider.startsWith('fictional-')).toBe(true);
      expect(b.status).toBe('fictional');
      expect(b.notes.some((n) => n.includes('架空'))).toBe(true);
      for (const s of Object.values(b.sources))
        expect(s.url).toMatch(/^https:\/\/[^/]+\.invalid\//);
    },
  );

  it('本番の読み込み（allowFictional: false）では拒否され、本番の料金データの一覧に入らない', () => {
    for (const raw of FICTIONAL_PRICE_BOOKS) {
      expect(() => parsePriceBook(raw, { allowFictional: false })).toThrow(
        FictionalPriceBookError,
      );
    }
    const official = new Set(RAW_PRICE_BOOKS.map((b) => b.provider));
    for (const b of FICTIONAL_PRICE_BOOKS)
      expect(official.has(b.provider)).toBe(false);
  });
});

describe('fictional-edge（USD・税抜）', () => {
  const P = 'fictional-edge';

  it('Pro: 月の無料枠・1 回ごとと期間の切り上げ・段階料金・ノード単位の枠・料金未取得・席・クレジット', () => {
    const b = bill(
      [sub(P, 'pro', { nodeIds: ['n1', 'n2'], seats: 2 })],
      [
        // 300 万件 − 枠 100 万 = 200 万件 × $1 / 100 万 = $2
        use(P, 'pro', 'requests', 3_000_000),
        // 平均 12 ms × 1,000 件 → 1 件 20 ms（10 ms 単位で切り上げ）× 1,000 = 20,000 ms × $0.01 / 1,000 = $0.2
        use(P, 'pro', 'cpu-ms', 12_000, { events: 1_000 }),
        // 1,000 × 0.1 + 9,000 × 0.05 + 2,000 × 0.01 = 100 + 450 + 20 = $570
        use(P, 'pro', 'egress', 12_000),
        // ノードごとに 10 GB 月の枠: n1 は 0.5 超え・n2 は枠内 → 合計 0.5 を 1 単位に切り上げ → $1
        use(P, 'pro', 'disk', 10.5, { nodeId: 'n1' }),
        use(P, 'pro', 'disk', 3, { nodeId: 'n2' }),
        use(P, 'pro', 'logs', 5_000),
      ],
    );
    expect(line(b, 'requests').amount).toBe(2);
    expect(line(b, 'cpu-ms').quantity).toBe(20_000);
    expect(line(b, 'cpu-ms').amount).toBeCloseTo(0.2, 12);
    expect(line(b, 'egress').tiers!.map((t) => t.amount)).toEqual([
      100, 450, 20,
    ]);
    expect(line(b, 'disk').billableQuantity).toBe(1);
    expect(line(b, 'disk').amount).toBe(1);
    expect(line(b, 'logs')).toMatchObject({ amount: null, status: 'unpriced' });
    expect(b.unpricedLines).toBe(1);
    // クレジットは all-usage に $10。基本料は 2 席 × $20
    expect(b.lines.find((l) => l.kind === 'credit')!.amount).toBe(-10);
    expect(b.lines.find((l) => l.kind === 'base-fee')!.amount).toBe(40);
    expect(b.totals.USD).toBeCloseTo(2 + 0.2 + 570 + 1 - 10 + 40, 9);
  });

  it('Pro: 従量がクレジットより少なければ、クレジットは従量の分だけ（合計は基本料）', () => {
    const b = bill(
      [sub(P, 'pro')],
      [use(P, 'pro', 'requests', 4_000_000)], // $3 < $10
    );
    expect(b.lines.find((l) => l.kind === 'credit')!.amount).toBe(-3);
    expect(b.totals.USD).toBe(20);
  });

  it('Free: 月の枠・日の枠を超えると止まり、商用だと利用資格の違反', () => {
    const b = bill(
      [sub(P, 'free')],
      [
        use(P, 'free', 'requests', 1_000_001),
        // 月の合計は 1,000 × 30 日ほどでも、平日の 1 日 1,500 は日の枠 1,000 を超える
        use(P, 'free', 'kv-writes', 30_000, {
          daily: { weekday: 1_500, weekend: 0 },
        }),
      ],
      true,
    );
    expect(b.totals.USD).toBe(0);
    expect(b.breaches.map((x) => [x.priceRef.meterId, x.behavior])).toEqual([
      ['requests', 'block'],
      ['kv-writes', 'block'],
    ]);
    expect(b.breaches[0]!.excess).toBe(1);
    expect(b.eligibilityViolations).toHaveLength(1);
  });
});

describe('fictional-yen-host（JPY・税込）', () => {
  const P = 'fictional-yen-host';

  it('Starter: 使い切ると止まるクレジット。内なら 0 円・超えても請求せず止まる', () => {
    // 50 万件 × 10 円 / 1 万件 = 500 円 + 40 GB × 10 円 = 400 円 → 900 円 ≤ 1,000 円
    const within = bill(
      [sub(P, 'starter')],
      [
        use(P, 'starter', 'requests', 500_000),
        use(P, 'starter', 'transfer', 40),
      ],
    );
    expect(within.totals.JPY).toBe(0);
    expect(within.breaches).toEqual([]);
    // 500 円 + 60 GB × 10 円 = 1,100 円 > 1,000 円 → 超えた 100 円は請求せず、止まる
    const over = bill(
      [sub(P, 'starter')],
      [
        use(P, 'starter', 'requests', 500_000),
        use(P, 'starter', 'transfer', 60),
      ],
    );
    expect(over.totals.JPY).toBe(0);
    expect(over.breaches).toEqual([
      expect.objectContaining({
        kind: 'credit-exhausted',
        behavior: 'block',
        excess: 100,
      }),
    ]);
  });

  it('Flat: 定額で、込み分を超えても請求は増えず調整（adjust）の印。一度だけの手数料はデータに持つ', () => {
    const b = bill([sub(P, 'flat')], [use(P, 'flat', 'transfer', 1_500)]);
    expect(b.totals.JPY).toBe(5_000);
    expect(b.breaches).toEqual([
      expect.objectContaining({
        kind: 'allowance-exceeded',
        behavior: 'adjust',
        excess: 500,
      }),
    ]);
    const plan = books
      .find((x) => x.provider === P)!
      .plans.find((p) => p.id === 'flat')!;
    expect(plan.addons.map((a) => a.oneTimeFee)).toEqual([10_000]);
  });

  it('VPS: ノード単位の基本料。円の合計を為替の仮定（1 USD = 100 円）で換算する', () => {
    const b = bill([sub(P, 'vps', { nodeIds: ['n1', 'n2'] })], []);
    expect(b.totals).toEqual({ JPY: 2_000 });
    const usd = convertMoney(
      { amount: b.totals.JPY!, currency: 'JPY' },
      'USD',
      [
        {
          base: 'USD',
          quote: 'JPY',
          rate: 100,
          asOf: '2000-01-01',
          basis: 'assumption',
          note: '架空の為替',
        },
      ],
    );
    expect(usd).toEqual({ amount: 20, currency: 'USD' });
  });
});

describe('fictional-db（USD・税抜）', () => {
  const P = 'fictional-db';

  it('時間課金の月額上限・volume（段を上がると総額が下がる）・丸めの記載なし', () => {
    const at = (gb: number) =>
      bill(
        [sub(P, 'instance', { nodeIds: ['n1', 'n2'] })],
        [
          use(P, 'instance', 'storage', gb),
          use(P, 'instance', 'rows-read', 2_500_000),
        ],
      );
    const b = at(100);
    // $0.01 × 730 時間 = $7.3 は上限 $5 で止まる × 2 ノード
    expect(b.lines.find((l) => l.kind === 'base-fee')!.amount).toBe(10);
    expect(line(b, 'storage').amount).toBe(100); // 100 × $1
    expect(line(at(150), 'storage').amount).toBe(75); // 150 × $0.5（全量に次の段の単価）
    expect(line(b, 'rows-read').amount).toBe(2.5);
    expect(line(b, 'rows-read').assumptions).toEqual([
      '丸めが料金表に記載なし。丸めなしで計算',
    ]);
  });
});

describe('架空の料金データの上の性質', () => {
  it('volume を持たないプランは、使用量を倍にしても合計が減らない', () => {
    const cases: [string, string, MeterUsage[]][] = [
      [
        'fictional-edge',
        'pro',
        ['requests', 'cpu-ms', 'egress', 'disk', 'logs'].map((m, i) =>
          use('fictional-edge', 'pro', m, 10 ** (i + 2), { events: 100 }),
        ),
      ],
      [
        'fictional-yen-host',
        'starter',
        [
          use('fictional-yen-host', 'starter', 'requests', 100_000),
          use('fictional-yen-host', 'starter', 'transfer', 10),
        ],
      ],
    ];
    for (const [provider, planId, usage] of cases) {
      let prev = -Infinity;
      for (const k of [0, 0.5, 1, 2, 4, 8, 16, 64]) {
        const b = bill(
          [sub(provider, planId)],
          usage.map((u) => ({ ...u, quantity: u.quantity * k })),
        );
        const t = b.totals.USD ?? b.totals.JPY ?? 0;
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });
});
