// 料金計算の性質ベースのテスト（prd/05 §2b）。料金データは生成器で作る架空のもの（provider: fictional-gen）。
// 例で確かめる P-01〜P-14（price.test.ts）と違い、多数の乱択の入力で「どの入力でも成り立つこと」を確かめる。
import { describe, expect, it } from 'vitest';
import { ceilUnits, nearlyEqual, ROUNDING_TOLERANCE } from '../num/arith.ts';
import { convertMoney, type ExchangeRate } from '../num/money.ts';
import { priceUsage, type Bill, type MeterUsage } from './price.ts';
import {
  ACCOUNT,
  forSeeds,
  genBook,
  genSub,
  genTiers,
  genUsage,
  PLAN,
  PROVIDER,
} from './random.test-helpers.ts';
import {
  parsePriceBook,
  type PriceBook,
  type PriceBookInput,
} from './schema.ts';

const RUNS = 300;
const parse = (b: PriceBookInput) =>
  parsePriceBook(b, { allowFictional: true });
const run = (book: PriceBook, usage: MeterUsage[], accounts = [ACCOUNT]) =>
  priceUsage({
    books: [book],
    subscriptions: accounts.map((a) => genSub(a)),
    usage,
  });
const total = (b: Bill) => b.totals.USD ?? 0;
/**
 * 比較の許容誤差（足し算の順の違いで出る誤差だけを吸収する）。大きな従量とクレジットが打ち消し合うと、
 * 合計は小さくても誤差は明細の大きさに比例するので、scale に明細の絶対値の和を渡す。
 */
const close = (a: number, b: number, scale = 0) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b), scale);
const atLeast = (a: number, b: number, scale = 0) =>
  a >= b || close(a, b, scale);
const magnitude = (...bills: Bill[]) =>
  bills
    .flatMap((b) => b.lines)
    .reduce((s, l) => s + Math.abs(l.amount ?? 0), 0);

describe('単調性', () => {
  it('flat と tiered だけなら、使用量を増やしても合計は減らない（プール・丸め・止まる挙動・クレジットを含む）', () => {
    forSeeds(RUNS, (r) => {
      const book = parse(
        genBook(r, {
          pools: true,
          rounding: true,
          blockMeters: true,
          credits: 'any',
          baseFee: true,
        }),
      );
      const usage = genUsage(r, book);
      const factor = r.pick([1, 1.001, 1.5, 2, 10]);
      const target = r.int(-1, usage.length - 1); // -1 は全部を増やす
      const more = usage.map((u, i) =>
        target === -1 || i === target
          ? { ...u, quantity: u.quantity * factor + r.amount(3) }
          : u,
      );
      const b0 = run(book, usage);
      const b1 = run(book, more);
      const [before, after] = [total(b0), total(b1)];
      expect(
        atLeast(after, before, magnitude(b0, b1)),
        `${before} → ${after}`,
      ).toBe(true);
    });
  });

  it('volume は単調でない例がある（だから金額の単調性は flat・tiered に限る。prd/05 §3）', () => {
    const book = parse(
      singleMeter({
        model: 'volume',
        per: 1,
        tiers: [
          { upTo: 10, unitPrice: 1 },
          { upTo: null, unitPrice: 0.1 },
        ],
      }),
    );
    const at = (q: number) => total(run(book, [usageOf('m0', q)]));
    expect(at(11)).toBeLessThan(at(10));
  });
});

describe('無料枠', () => {
  it('月のプールの内なら従量の金額は 0（丸め・単価・段によらない）', () => {
    forSeeds(RUNS, (r) => {
      const raw = genBook(r, { volume: true, rounding: true });
      const quantity = r.pick([0, 1, 1_000, 123_456]);
      const book = parse({
        ...raw,
        allowancePools: [
          {
            id: 'pool',
            quantity,
            unit: 'request',
            period: 'month',
            scope: r.pick(['account', 'node']),
          },
        ],
        plans: raw.plans.map((p) => ({
          ...p,
          meters: p.meters.map((m) => ({
            ...m,
            allowancePool: 'pool',
            rounding:
              m.rounding && m.rounding !== 'not-stated'
                ? { ...m.rounding, scope: 'period' as const }
                : undefined,
          })),
        })),
      });
      // プールの量をメーターに配り切らない範囲で分ける
      let rest = quantity;
      const usage = book.plans[0]!.meters.map((m) => {
        const q = r.chance(0.3) ? rest : Math.floor(rest * r.next());
        rest -= q;
        return usageOf(m.id, q);
      });
      const b = run(book, usage);
      for (const l of b.lines.filter((l) => l.kind === 'usage')) {
        expect(l.amount).toBe(0);
        expect(l.billableQuantity).toBe(0);
      }
      expect(b.breaches).toEqual([]);
    });
  });

  it('日のプール: 平日・休日とも 1 日の量が枠の内なら 0、どちらかが超えれば超えた日数ぶんだけ課金される', () => {
    forSeeds(RUNS, (r) => {
      const quantity = r.pick([10, 100, 1_000]);
      const unitPrice = r.pick([0.1, 1, 10]);
      const book = parse(
        singleMeter(
          { model: 'flat', per: 1, unitPrice },
          {
            allowancePools: [
              {
                id: 'day',
                quantity,
                unit: 'request',
                period: 'day',
                scope: 'account',
              },
            ],
          },
          { allowancePool: 'day' },
        ),
      );
      const weekday = quantity * r.next() * 2;
      const weekend = quantity * r.next() * 2;
      const b = run(book, [usageOf('m0', 1, { daily: { weekday, weekend } })]);
      const line = b.lines.find((l) => l.kind === 'usage')!;
      const daysOver =
        (Math.max(0, weekday - quantity) * ((730 / 24) * 5)) / 7 +
        (Math.max(0, weekend - quantity) * ((730 / 24) * 2)) / 7;
      expect(close(line.amount!, daysOver * unitPrice)).toBe(true);
      if (weekday <= quantity && weekend <= quantity)
        expect(line.amount).toBe(0);
    });
  });

  it('プールをちょうど使い切る量を小数で分けても、足し算の誤差で超過（止まる）にしない', () => {
    // 例: 0.1 + 0.2 = 0.30000000000000004 > 0.3
    forSeeds(RUNS, (r) => {
      const parts = Array.from({ length: r.int(2, 4) }, () =>
        r.pick([0.1, 0.2, 0.3, 0.7, 1.1, 2.9]),
      );
      const quantity = parts.reduce((s, p) => s + p, 0);
      // 枠は 10 進の正確な和（人が書いた値）。使用量の浮動小数点の和とは足し算の誤差の分だけずれうる
      const pool = Number(quantity.toFixed(9));
      const book = parse(
        singleMeter(
          { model: 'flat', per: 1, unitPrice: 1 },
          {
            allowancePools: [
              {
                id: 'pool',
                quantity: pool,
                unit: 'request',
                period: 'month',
                scope: 'account',
              },
            ],
          },
          { allowancePool: 'pool', onExceed: 'block' },
        ),
      );
      const b = run(
        book,
        parts.map((q, i) => usageOf('m0', q, { nodeId: `n${i}` })),
      );
      expect(b.breaches).toEqual([]);
      // 使い切ると止まるクレジットも同じ（従量の金額の和がちょうどクレジットの額）
      const credited = parse(
        singleMeter({ model: 'flat', per: 1, unitPrice: 1 }, {}, {}, [
          {
            id: 'c',
            amount: pool,
            appliesTo: 'all-usage',
            onExhausted: 'block',
          },
        ]),
      );
      const c = run(
        credited,
        parts.map((q, i) => usageOf('m0', q, { nodeId: `n${i}` })),
      );
      expect(c.breaches).toEqual([]);
    });
  });

  it('大きな整数の枠を 1 だけ超えたら、1 の超過として課金・breach する（誤差の許容で消さない）', () => {
    const book = (onExceed: 'bill' | 'block') =>
      parse(
        singleMeter(
          { model: 'flat', per: 1, unitPrice: 1 },
          {
            allowancePools: [
              {
                id: 'pool',
                quantity: 25_000_000_000,
                unit: 'request',
                period: 'month',
                scope: 'account',
              },
            ],
          },
          { allowancePool: 'pool', onExceed },
        ),
      );
    const usage = [
      usageOf('m0', 20_000_000_000, { nodeId: 'n1' }),
      usageOf('m0', 5_000_000_001, { nodeId: 'n2' }),
    ];
    const billed = run(book('bill'), usage);
    expect(billed.lines.find((l) => l.kind === 'usage')).toMatchObject({
      billableQuantity: 1,
      amount: 1,
    });
    expect(run(book('block'), usage).breaches).toEqual([
      expect.objectContaining({ behavior: 'block', excess: 1 }),
    ]);
  });
});

describe('段階料金の境目', () => {
  it('tiered は境目で連続（境目の前後の差は δ × 単価 / per を超えない）', () => {
    forSeeds(RUNS, (r) => {
      const per = r.pick([1, 1_000]);
      const tiers = genTiers(r);
      const book = parse(singleMeter({ model: 'tiered', per, tiers }));
      const at = (q: number) => total(run(book, [usageOf('m0', q)]));
      const maxPrice = Math.max(...tiers.map((t) => t.unitPrice));
      for (const t of tiers) {
        if (t.upTo === null) continue;
        const delta = r.pick([1e-6, 0.5, 1]);
        const below = at(t.upTo - delta);
        const on = at(t.upTo);
        const above = at(t.upTo + delta);
        // 境目の手前の量（upTo - δ）を作る引き算の誤差の分だけ許す
        const bound = (delta * maxPrice) / per + 1e-9 * Math.max(1, on);
        expect(Math.abs(on - below)).toBeLessThanOrEqual(bound);
        expect(Math.abs(above - on)).toBeLessThanOrEqual(bound);
      }
    });
  });

  it('tiered は各段の量 × 単価の和（段の量の合計は使用量）', () => {
    forSeeds(RUNS, (r) => {
      const per = r.pick([1, 10, 1_000]);
      const tiers = genTiers(r);
      const book = parse(singleMeter({ model: 'tiered', per, tiers }));
      const q = r.amount(6);
      const line = run(book, [usageOf('m0', q)]).lines.find(
        (l) => l.kind === 'usage',
      )!;
      const charged = line.tiers ?? [];
      expect(
        close(
          charged.reduce((s, t) => s + t.quantity, 0),
          q,
        ),
      ).toBe(true);
      expect(
        close(
          charged.reduce((s, t) => s + t.amount, 0),
          line.amount!,
        ),
      ).toBe(true);
    });
  });

  it('volume は仕様どおり境目で不連続: 境目ちょうどはその段、超えると次の段の単価が全量にかかる', () => {
    forSeeds(RUNS, (r) => {
      const per = r.pick([1, 1_000]);
      const tiers = genTiers(r);
      const book = parse(singleMeter({ model: 'volume', per, tiers }));
      const at = (q: number) => total(run(book, [usageOf('m0', q)]));
      tiers.forEach((t, i) => {
        if (t.upTo === null) return;
        const next = tiers[i + 1]!;
        expect(close(at(t.upTo), (t.upTo / per) * t.unitPrice)).toBe(true);
        const over = t.upTo + 0.5;
        expect(close(at(over), (over / per) * next.unitPrice)).toBe(true);
      });
    });
  });
});

describe('クレジット', () => {
  it('クレジットは従量を超えて引かない（プランの従量 + クレジットは負にならず、合計は基本料を下回らない）', () => {
    forSeeds(RUNS, (r) => {
      const book = parse(
        genBook(r, {
          volume: true,
          pools: true,
          rounding: true,
          credits: 'any',
          baseFee: true,
        }),
      );
      const b = run(book, genUsage(r, book));
      const usage = b.lines
        .filter((l) => l.kind === 'usage')
        .reduce((s, l) => s + (l.amount ?? 0), 0);
      const credits = b.lines.filter((l) => l.kind === 'credit');
      const credit = credits.reduce((s, l) => s + l.amount!, 0);
      expect(
        atLeast(usage + credit, 0, magnitude(b)),
        `${usage} + ${credit}`,
      ).toBe(true);
      for (const c of credits) {
        expect(c.amount!).toBeLessThan(0);
        expect(-c.amount!).toBeLessThanOrEqual(
          c.credit!.eligible * (1 + 1e-12),
        );
      }
      const fees = b.lines
        .filter((l) => l.kind === 'base-fee')
        .reduce((s, l) => s + l.amount!, 0);
      expect(atLeast(total(b), fees, magnitude(b))).toBe(true);
    });
  });

  it('使い切ったら請求する（bill）クレジットは、上限までしか引かない', () => {
    forSeeds(RUNS, (r) => {
      const book = parse(genBook(r, { credits: 'bill' }));
      const b = run(book, genUsage(r, book));
      for (const c of b.lines.filter((l) => l.kind === 'credit')) {
        expect(-c.amount!).toBeLessThanOrEqual(c.credit!.limit);
        expect(
          close(-c.amount!, Math.min(c.credit!.limit, c.credit!.eligible)),
        ).toBe(true);
      }
      expect(b.breaches.filter((x) => x.kind === 'credit-exhausted')).toEqual(
        [],
      );
    });
  });

  it('使い切ると止まる（block）クレジットは、従量を打ち消し、上限を超えたときだけ超えた額で breach を出す', () => {
    forSeeds(RUNS, (r) => {
      const amount = r.pick([1, 10, 100]);
      const unitPrice = r.pick([0.01, 0.1, 1]);
      const book = parse(
        singleMeter({ model: 'flat', per: 1, unitPrice }, {}, {}, [
          { id: 'c', amount, appliesTo: 'all-usage', onExhausted: 'block' },
        ]),
      );
      const q = r.amount(4);
      const b = run(book, [usageOf('m0', q)]);
      const eligible = q * unitPrice;
      expect(close(total(b), 0)).toBe(true);
      const breaches = b.breaches.filter((x) => x.kind === 'credit-exhausted');
      if (eligible - amount > 1e-9 * amount) {
        expect(breaches).toHaveLength(1);
        expect(close(breaches[0]!.excess, eligible - amount)).toBe(true);
        expect(breaches[0]!.behavior).toBe('block');
      } else {
        expect(breaches).toEqual([]);
      }
    });
  });
});

describe('切り上げ（ceilUnits）', () => {
  it('ceilUnits は値を覆う最小の単位の個数（浮動小数点の誤差の分だけ許す）', () => {
    forSeeds(RUNS * 3, (r) => {
      const g = r.pick([0.001, 0.1, 0.3, 1, 7, 1_000]);
      const v = r.chance(0.3) ? r.int(0, 1_000) * g : r.amount(6);
      const k = ceilUnits(v, g);
      expect(Number.isInteger(k)).toBe(true);
      expect(k * g).toBeGreaterThanOrEqual(
        v * (1 - ROUNDING_TOLERANCE) - 1e-12,
      );
      if (k > 0) expect((k - 1) * g).toBeLessThan(v);
    });
  });

  it('期間の切り上げ: 課金対象は単位の整数倍で、切り上げ前から 1 単位未満だけ増える', () => {
    forSeeds(RUNS, (r) => {
      const granularity = r.pick([0.1, 1, 10, 1_000]);
      const book = parse(
        singleMeter(
          { model: 'flat', per: 1, unitPrice: 1 },
          {},
          { rounding: { granularity, scope: 'period' } },
        ),
      );
      const q = r.chance(0.3) ? r.int(0, 100) * granularity : r.amount(5);
      const line = run(book, [usageOf('m0', q)]).lines.find(
        (l) => l.kind === 'usage',
      )!;
      const billable = line.billableQuantity!;
      const units = billable / granularity;
      expect(close(units, Math.round(units))).toBe(true);
      expect(atLeast(billable, q)).toBe(true);
      expect(billable - q).toBeLessThan(granularity);
    });
  });

  it('1 回ごとの切り上げ: 1 件あたりが単位の整数倍で、平均から 1 単位未満だけ増える', () => {
    forSeeds(RUNS, (r) => {
      const granularity = r.pick([0.1, 1, 10]);
      const book = parse(
        singleMeter(
          { model: 'flat', per: 1, unitPrice: 1 },
          {},
          { rounding: { granularity, scope: 'event' } },
        ),
      );
      const events = r.int(1, 10_000);
      const q = r.amount(6);
      const line = run(book, [usageOf('m0', q, { events })]).lines.find(
        (l) => l.kind === 'usage',
      )!;
      const perEvent = line.quantity! / events;
      expect(
        close(perEvent / granularity, Math.round(perEvent / granularity)),
      ).toBe(true);
      expect(atLeast(perEvent, q / events)).toBe(true);
      expect(perEvent - q / events).toBeLessThan(granularity);
    });
  });
});

describe('通貨の換算（JPY ↔ USD）', () => {
  it('換算は足し算と入れ替えられ、順方向と逆方向の為替で往復すると元に戻る', () => {
    forSeeds(RUNS, (r) => {
      const rate = r.pick([100, 150, 151.5, 160]);
      const usdToJpy: ExchangeRate = {
        base: 'USD',
        quote: 'JPY',
        rate,
        asOf: '2000-01-01',
        basis: 'assumption',
      };
      const a = r.amount(6);
      const b = r.amount(6);
      const toUsd = (v: number) =>
        convertMoney({ amount: v, currency: 'JPY' }, 'USD', [usdToJpy]).amount;
      expect(close(toUsd(a + b), toUsd(a) + toUsd(b))).toBe(true);
      const back = convertMoney({ amount: toUsd(a), currency: 'USD' }, 'JPY', [
        usdToJpy,
      ]).amount;
      expect(close(back, a)).toBe(true);
      // 同じ為替を逆向き（base JPY）で書いても同じ値になる
      const jpyToUsd: ExchangeRate = {
        ...usdToJpy,
        base: 'JPY',
        quote: 'USD',
        rate: 1 / rate,
      };
      expect(
        close(
          convertMoney({ amount: a, currency: 'JPY' }, 'USD', [jpyToUsd])
            .amount,
          toUsd(a),
        ),
      ).toBe(true);
    });
  });

  it('円建ての Bill の合計を換算した値は、明細を 1 行ずつ換算した和と一致する', () => {
    forSeeds(RUNS, (r) => {
      const raw = genBook(r, {
        pools: true,
        rounding: true,
        credits: 'any',
        baseFee: true,
      });
      const book = parse({ ...raw, currency: 'JPY', taxIncluded: true });
      const b = run(book, genUsage(r, book));
      const rate: ExchangeRate = {
        base: 'USD',
        quote: 'JPY',
        rate: 150,
        asOf: '2000-01-01',
        basis: 'assumption',
      };
      const toUsd = (v: number) =>
        convertMoney({ amount: v, currency: 'JPY' }, 'USD', [rate]).amount;
      expect(b.totals.USD).toBeUndefined();
      const lines = b.lines
        .filter((l) => l.amount !== null)
        .reduce((s, l) => s + toUsd(l.amount!), 0);
      expect(close(toUsd(b.totals.JPY ?? 0), lines, toUsd(magnitude(b)))).toBe(
        true,
      );
    });
  });
});

describe('料金未取得と合計', () => {
  it('料金未取得のメーターの使用量は合計を変えず、件数だけ 1 増える', () => {
    forSeeds(RUNS, (r) => {
      const raw = genBook(r, {
        volume: true,
        pools: true,
        rounding: true,
        credits: 'any',
        baseFee: true,
      });
      const book = parse({
        ...raw,
        plans: raw.plans.map((p) => ({
          ...p,
          meters: [
            ...p.meters,
            {
              id: 'unpriced',
              resource: 'requests',
              unit: 'request',
              pricing: { model: 'unpriced', note: 'gen' },
            },
          ],
        })),
      });
      const usage = genUsage(r, book).filter((u) => u.meterId !== 'unpriced');
      const without = run(book, usage);
      const withUnpriced = run(book, [
        ...usage,
        usageOf('unpriced', r.amount(6) + 1),
      ]);
      expect(withUnpriced.totals).toEqual(without.totals);
      expect(withUnpriced.unpricedLines).toBe(without.unpricedLines + 1);
      const line = withUnpriced.lines.find(
        (l) => l.priceRef.meterId === 'unpriced',
      )!;
      expect(line).toMatchObject({ amount: null, status: 'unpriced' });
    });
  });

  it('アカウントは互いに独立: 2 つのアカウントをまとめて計算した合計は、別々に計算した合計の和', () => {
    forSeeds(RUNS, (r) => {
      const book = parse(
        genBook(r, {
          volume: true,
          pools: true,
          rounding: true,
          credits: 'any',
          baseFee: true,
        }),
      );
      const a = genUsage(r, book, 'a');
      const b = genUsage(r, book, 'b');
      const together = run(book, [...a, ...b], ['a', 'b']);
      const [ba, bb] = [run(book, a, ['a']), run(book, b, ['b'])];
      expect(
        close(total(together), total(ba) + total(bb), magnitude(together)),
      ).toBe(true);
    });
  });
});

// --- 小さな組み立て ---

function usageOf(
  meterId: string,
  quantity: number,
  extra: Partial<MeterUsage> = {},
): MeterUsage {
  return {
    accountId: ACCOUNT,
    nodeId: 'n1',
    provider: PROVIDER,
    planId: PLAN,
    meterId,
    quantity,
    ...extra,
  };
}

type MeterInput = PriceBookInput['plans'][number]['meters'][number];
type CreditInput = NonNullable<
  PriceBookInput['plans'][number]['credits']
>[number];

function singleMeter(
  pricing: MeterInput['pricing'],
  book: Partial<PriceBookInput> = {},
  meter: Partial<MeterInput> = {},
  credits: CreditInput[] = [],
): PriceBookInput {
  return {
    schemaVersion: 1,
    provider: PROVIDER,
    version: 'gen',
    status: 'fictional',
    currency: 'USD',
    taxIncluded: false,
    retrievedAt: '2000-01-01',
    ...book,
    plans: [
      {
        id: PLAN,
        service: 'gen',
        name: 'Single',
        meters: [
          {
            id: 'm0',
            resource: 'requests',
            unit: 'request',
            pricing,
            ...meter,
          },
        ],
        credits,
      },
    ],
  };
}
