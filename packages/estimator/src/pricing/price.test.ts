// prd/05-test-strategy.md §2 の料金計算のテスト（P-01〜P-14）。料金はすべて架空（fixtures.test-helpers.ts）。
import { describe, expect, it } from 'vitest';
import { nearlyEqual } from '../num/arith.ts';
import { FICTIONAL_CLOUD, FICTIONAL_YEN_VPS } from './fixtures.test-helpers.ts';
import {
  priceUsage,
  PricingInputError,
  WEEKDAYS_PER_MONTH,
  WEEKEND_DAYS_PER_MONTH,
  type MeterUsage,
  type Subscription,
} from './price.ts';
import { parsePriceBook } from './schema.ts';

const cloud = parsePriceBook(FICTIONAL_CLOUD, { allowFictional: true });
const yen = parsePriceBook(FICTIONAL_YEN_VPS, { allowFictional: true });

const sub = (
  planId: string,
  extra: Partial<Subscription> = {},
): Subscription => ({
  accountId: 'acct',
  provider: 'fictional-cloud',
  planId,
  nodeIds: ['n1'],
  ...extra,
});
const use = (
  meterId: string,
  quantity: number,
  extra: Partial<MeterUsage> = {},
): MeterUsage => ({
  accountId: 'acct',
  nodeId: 'n1',
  provider: 'fictional-cloud',
  planId: 'basic',
  meterId,
  quantity,
  ...extra,
});

function bill(usage: MeterUsage[], subs: Subscription[] = [sub('basic')]) {
  return priceUsage({ books: [cloud, yen], subscriptions: subs, usage });
}
const usageLine = (b: ReturnType<typeof bill>, meterId: string) =>
  b.lines.find((l) => l.kind === 'usage' && l.priceRef.meterId === meterId)!;

describe('P-01 定額単価', () => {
  it('数量 × 単価 / per。端数は比例で扱う', () => {
    const b = bill([use('cpu-ms', 1500)]);
    expect(usageLine(b, 'cpu-ms').amount).toBe(1.5);
  });
});

describe('P-02 期間で切り上げ', () => {
  it('境界ちょうど・境界 + 端数', () => {
    expect(usageLine(bill([use('storage', 3)]), 'storage').amount).toBe(3);
    expect(usageLine(bill([use('storage', 3.1)]), 'storage').amount).toBe(4);
  });

  it('浮動小数点の誤差では切り上げない（0.1 × 30 GB 月 → 3）', () => {
    expect(usageLine(bill([use('storage', 0.1 * 30)]), 'storage').amount).toBe(
      3,
    );
  });
});

describe('P-03 1 回ごとの切り上げ', () => {
  it('平均 2.3 ms × 1,000 件を 1 ms 単位で → 3 ms × 1,000', () => {
    const l = usageLine(
      bill([use('cpu-ms', 2300, { events: 1000 })]),
      'cpu-ms',
    );
    expect(l.quantity).toBe(3000);
    expect(l.amount).toBe(3);
    expect(l.assumptions.join()).toContain('平均値');
  });
});

describe('P-04 無料枠', () => {
  it.each([
    [500, 0],
    [1000, 0],
    [3000, 2],
  ])('使用量 %i → 金額 %d（枠 1,000）', (q, amount) => {
    const b = bill([use('requests', q)], [sub('basic')]);
    const l = usageLine(b, 'requests');
    expect(l.amount).toBe(amount);
    expect(l.allowanceApplied).toBe(Math.min(q, 1000));
  });
});

describe('P-05 共有プール', () => {
  it('2 つのメーターが同じプールを使うと、合算してから引く', () => {
    // 個別に引けば 800・800 とも枠内で 0。合算すると 1,600 − 1,000 = 600 が課金対象
    const b = bill([use('requests', 800), use('functions-requests', 800)]);
    const a = usageLine(b, 'requests');
    const f = usageLine(b, 'functions-requests');
    expect(a.billableQuantity).toBe(300);
    expect(f.billableQuantity).toBe(300);
    expect((a.amount ?? 0) + (f.amount ?? 0)).toBeCloseTo(0.6, 12);
  });

  it('ノードが 2 つでもアカウント単位のプールは 1 つ', () => {
    const b = bill([
      use('requests', 800),
      use('requests', 800, { nodeId: 'n2' }),
    ]);
    const l = usageLine(b, 'requests');
    expect(l.nodeIds).toEqual(['n1', 'n2']);
    expect(l.billableQuantity).toBe(600);
  });

  it('按分は使用量に比例する', () => {
    const b = bill([use('requests', 1500), use('functions-requests', 500)]);
    expect(usageLine(b, 'requests').billableQuantity).toBe(750);
    expect(usageLine(b, 'functions-requests').billableQuantity).toBe(250);
  });
});

describe('P-06 日次プール', () => {
  it('月合計は枠内でも、平日の 1 日が枠を超えると超過になる（block）', () => {
    // 平日 150/日・休日 0/日。月合計は約 3,259 で、月の枠に換算すれば 100 × 30.4 = 3,041 を少し超える程度だが、
    // 判定は日ごと: 平日は毎日 50 超過
    const b = bill(
      [
        use('requests', 150 * WEEKDAYS_PER_MONTH, {
          planId: 'free',
          daily: { weekday: 150, weekend: 0 },
        }),
      ],
      [sub('free')],
    );
    expect(b.breaches).toHaveLength(1);
    const breach = b.breaches[0]!;
    expect(breach.behavior).toBe('block');
    expect(nearlyEqual(breach.excess, 50 * WEEKDAYS_PER_MONTH)).toBe(true);
    expect(breach.premise).toContain('1 日 100');
  });

  it('毎日が枠内なら超過なし', () => {
    const b = bill(
      [
        use('requests', 1, {
          planId: 'free',
          daily: { weekday: 90, weekend: 100 },
        }),
      ],
      [sub('free')],
    );
    expect(b.breaches).toHaveLength(0);
  });

  it('1 日あたりが無ければ均等割りを仮定し、仮定を残す', () => {
    const b = bill(
      [
        use(
          'requests',
          100 * (WEEKDAYS_PER_MONTH + WEEKEND_DAYS_PER_MONTH) * 2,
          { planId: 'free' },
        ),
      ],
      [sub('free')],
    );
    expect(b.breaches).toHaveLength(1);
    expect(usageLine(b, 'requests').assumptions.join()).toContain('均等割り');
  });
});

describe('P-07 / P-08 tiered と volume', () => {
  it('同じ 1,000 単位で、tiered は 999 × 1 + 1 × 0.9、volume は 1,000 × 0.9', () => {
    const t = usageLine(bill([use('egress-tiered', 1000)]), 'egress-tiered');
    const v = usageLine(bill([use('egress-volume', 1000)]), 'egress-volume');
    expect(t.amount).toBeCloseTo(999.9, 9);
    expect(t.tiers).toHaveLength(2);
    expect(v.amount).toBeCloseTo(900, 9);
  });

  it('volume は段を上がると総額が下がりうる（金額の単調性を性質にしない理由。prd/05 §3）', () => {
    const below = usageLine(bill([use('egress-volume', 999)]), 'egress-volume');
    const above = usageLine(
      bill([use('egress-volume', 1000)]),
      'egress-volume',
    );
    expect(above.amount!).toBeLessThan(below.amount!);
  });
});

describe('P-09 クレジット', () => {
  it.each([
    [3000, 2, -2], // 対象の金額 2 < クレジット 5
    [6000, 5, -5], // = 5
    [9000, 8, -5], // > 5。余りは繰り越さない
  ])('requests %i → 対象 %d・クレジット %d', (q, eligible, credit) => {
    const b = bill([use('requests', q)]);
    expect(usageLine(b, 'requests').amount).toBe(eligible);
    expect(b.lines.find((l) => l.kind === 'credit')!.amount).toBe(credit);
  });

  it('対象外のメーターには当たらない', () => {
    const b = bill([use('cpu-ms', 4000)]);
    expect(b.lines.some((l) => l.kind === 'credit')).toBe(false);
  });

  it('all-usage はプランの従量すべてに当たる', () => {
    const b = bill([use('usage', 30, { planId: 'team' })], [sub('team')]);
    expect(b.lines.find((l) => l.kind === 'credit')!.amount).toBe(-20);
  });

  it('対象が重なる複数のクレジットは、先に当てた分を差し引いた残りに当てる（従量を超えて引かない）', () => {
    const twoCredits = parsePriceBook(
      {
        ...FICTIONAL_CLOUD,
        plans: FICTIONAL_CLOUD.plans.map((p) =>
          p.id === 'team'
            ? {
                ...p,
                credits: [
                  ...(p.credits ?? []),
                  { id: 'extra-credit', amount: 20, appliesTo: 'all-usage' },
                ],
              }
            : p,
        ),
      },
      { allowFictional: true },
    );
    const run = (q: number) =>
      priceUsage({
        books: [twoCredits],
        subscriptions: [sub('team')],
        usage: [use('usage', q, { planId: 'team' })],
      });
    const b = run(30); // 従量 30 = 20 + 10
    expect(
      b.lines.filter((l) => l.kind === 'credit').map((l) => l.amount),
    ).toEqual([-20, -10]);
    expect(b.totals.USD).toBe(20); // 固定費 20 だけ残る
    const small = run(10); // 1 つ目で使い切る
    expect(small.lines.filter((l) => l.kind === 'credit')).toHaveLength(1);
    expect(small.totals.USD).toBe(20);
  });

  it('使い切ると止まるクレジット（onExhausted: block。D-71）: 超えた分は請求せず、止まった印を残す', () => {
    const blocking = parsePriceBook(
      {
        ...FICTIONAL_CLOUD,
        plans: FICTIONAL_CLOUD.plans.map((p) =>
          p.id === 'team'
            ? {
                ...p,
                credits: (p.credits ?? []).map((c) => ({
                  ...c,
                  onExhausted: 'block' as const,
                })),
              }
            : p,
        ),
      },
      { allowFictional: true },
    );
    const run = (q: number) =>
      priceUsage({
        books: [blocking],
        subscriptions: [sub('team')],
        usage: [use('usage', q, { planId: 'team' })],
      });
    const within = run(10);
    expect(within.totals.USD).toBe(20);
    expect(within.breaches).toHaveLength(0);
    const over = run(30); // 従量 30 > クレジット 20
    expect(over.totals.USD).toBe(20); // 固定費だけ（超えた 10 は請求されない）
    const credit = over.lines.find((l) => l.kind === 'credit')!;
    expect(credit.amount).toBe(-30);
    expect(credit.credit).toEqual({
      id: expect.any(String),
      limit: 20,
      eligible: 30,
    });
    expect(over.breaches).toEqual([
      expect.objectContaining({
        kind: 'credit-exhausted',
        behavior: 'block',
        excess: 10,
      }),
    ]);
  });
});

describe('P-10 固定費', () => {
  it('アカウント単位はノードが 3 つでも 1 回、ノード単位は 3 回', () => {
    const acct = bill([], [sub('basic', { nodeIds: ['a', 'b', 'c'] })]);
    expect(acct.totals.USD).toBe(10);
    const node = bill([], [sub('instance', { nodeIds: ['a', 'b', 'c'] })]);
    expect(node.totals.USD).toBe(30);
  });

  it('席課金', () => {
    expect(bill([], [sub('team', { seats: 3 })]).totals.USD).toBe(60);
  });
});

describe('P-11 時間課金の月額上限', () => {
  it('730 時間 × 0.02 = 14.6 は上限 10 で止まる', () => {
    const b = bill([], [sub('instance')]);
    expect(b.lines[0]!.amount).toBe(10);
  });
});

describe('P-12 超過時の挙動', () => {
  it('block は金額 0 の明細と LimitBreach', () => {
    const b = bill(
      [
        use('requests', 1000, {
          planId: 'free',
          daily: { weekday: 200, weekend: 200 },
        }),
      ],
      [sub('free')],
    );
    expect(usageLine(b, 'requests')).toMatchObject({
      status: 'blocked',
      amount: 0,
    });
    expect(b.breaches[0]!.behavior).toBe('block');
  });

  it('利用者が選べる挙動の範囲で上書きできる（予算での一時停止など）', () => {
    const b = bill(
      [use('capped-transfer', 5)],
      [sub('basic', { onExceed: { 'capped-transfer': 'block' } })],
    );
    expect(usageLine(b, 'capped-transfer').status).toBe('blocked');
  });

  it('選べない挙動は入力の誤り', () => {
    expect(() =>
      bill(
        [use('cpu-ms', 5)],
        [sub('basic', { onExceed: { 'cpu-ms': 'block' } })],
      ),
    ).toThrow(PricingInputError);
  });
});

describe('P-13 通貨', () => {
  it('原通貨が混ざった Bill は通貨ごとに合計する（換算しない）', () => {
    const b = bill(
      [use('cpu-ms', 2000)],
      [
        sub('basic'),
        {
          accountId: 'vps',
          provider: 'fictional-yen-vps',
          planId: 'small',
          nodeIds: ['v1'],
        },
      ],
    );
    expect(b.totals).toEqual({ USD: 12, JPY: 1000 });
  });
});

describe('P-14 明細の根拠', () => {
  it('すべての明細が priceRef を持ち、合計と一致する。料金未取得は合計に入らず件数が出る', () => {
    const b = bill([
      use('requests', 3000),
      use('cpu-ms', 1000),
      use('kv-reads', 1_000_000),
      use('not-stated', 2),
    ]);
    for (const l of b.lines) {
      expect(l.priceRef.provider).toBe('fictional-cloud');
      expect(l.priceRef.version).toBe('test-1');
      if (l.kind === 'usage') {
        expect(l.quantity).toBeDefined();
        expect(l.allowanceApplied).toBeDefined();
      }
    }
    const summed = b.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    expect(b.totals.USD).toBe(summed);
    expect(b.unpricedLines).toBe(1);
    expect(usageLine(b, 'kv-reads')).toMatchObject({
      status: 'unpriced',
      amount: null,
    });
    expect(usageLine(b, 'not-stated').assumptions.join()).toContain('記載なし');
  });

  it('別名でメーターを指定できる', () => {
    expect(
      usageLine(bill([use('edge-requests', 2000)]), 'requests').amount,
    ).toBe(1);
  });
});

describe('利用資格・入力の誤り', () => {
  it('非商用のみのプランを商用で使うと違反として出る', () => {
    const b = priceUsage({
      books: [cloud],
      subscriptions: [sub('free')],
      usage: [],
      context: { commercial: true },
    });
    expect(b.eligibilityViolations[0]!.premise).toBe('Free は非商用のみ');
  });

  it('契約のない使用量・存在しないメーターは例外', () => {
    expect(() => bill([use('cpu-ms', 1, { planId: 'team' })])).toThrow(
      PricingInputError,
    );
    expect(() => bill([use('nope', 1)])).toThrow(PricingInputError);
  });
});

describe('決定論', () => {
  it('同じ入力で 2 回計算して JSON が一致する', () => {
    const usage = [use('requests', 3000), use('egress-tiered', 1500)];
    expect(JSON.stringify(bill(usage))).toBe(JSON.stringify(bill(usage)));
  });
});

describe('表示名（D-75）', () => {
  it('メーター・基本料の label を明細の行に写す。無ければ持たない', () => {
    const labeled = parsePriceBook(
      {
        ...FICTIONAL_CLOUD,
        plans: FICTIONAL_CLOUD.plans.map((p) => ({
          ...p,
          ...(p.baseFee
            ? { baseFee: { ...p.baseFee, label: '基本料（架空）' } }
            : {}),
          meters: p.meters.map((m) => ({ ...m, label: `${m.id}（架空）` })),
        })),
      },
      { allowFictional: true },
    );
    const b = priceUsage({
      books: [labeled],
      subscriptions: [sub('basic')],
      usage: [use('cpu-ms', 1500)],
    });
    expect(usageLine(b, 'cpu-ms').label).toBe('cpu-ms（架空）');
    expect(b.lines.find((l) => l.kind === 'base-fee')?.label).toBe(
      '基本料（架空）',
    );
    expect(usageLine(bill([use('cpu-ms', 1500)]), 'cpu-ms').label).toBe(
      undefined,
    );
  });
});
