// 料金データの検証規則（prd/03-pricing-schema.md §10・prd/05 §4）。
import { describe, expect, it } from 'vitest';
import { FICTIONAL_CLOUD } from './fixtures.test-helpers.ts';
import {
  FictionalPriceBookError,
  parsePriceBook,
  PriceBookSchema,
  type PriceBookInput,
} from './schema.ts';

const clone = (b: PriceBookInput): PriceBookInput =>
  JSON.parse(JSON.stringify(b)) as PriceBookInput;
const issues = (raw: unknown) => {
  const r = PriceBookSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

const officialMinimal = (): PriceBookInput => ({
  schemaVersion: 1,
  provider: 'example-host',
  version: '2000-01-01',
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: '2000-01-01',
  sources: {
    pricing: { url: 'https://example.com/pricing', retrievedAt: '2000-01-01' },
  },
  plans: [
    {
      id: 'plan',
      service: 'svc',
      name: 'Plan',
      sourceIds: ['pricing'],
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
          sourceIds: ['pricing'],
        },
      ],
    },
  ],
});

describe('PriceBookSchema', () => {
  it('架空のデータ一式が通る', () => {
    expect(issues(FICTIONAL_CLOUD)).toEqual([]);
  });

  it('出典のある official の最小データが通る', () => {
    expect(issues(officialMinimal())).toEqual([]);
  });

  it('official は出典が必要で、参照先が sources にある', () => {
    const b = officialMinimal();
    b.plans[0]!.meters[0]!.sourceIds = [];
    expect(issues(b).join()).toContain('出典が必要');
    const c = officialMinimal();
    c.plans[0]!.sourceIds = ['missing'];
    expect(issues(c).join()).toContain('missing');
  });

  it('料金未取得（unpriced）のメーターは出典なしでよい', () => {
    const b = officialMinimal();
    b.plans[0]!.meters.push({
      id: 'kv',
      resource: 'kv-reads',
      unit: 'operation',
      pricing: { model: 'unpriced', note: '未取得' },
    });
    expect(issues(b)).toEqual([]);
  });

  it('provider の接頭辞と status が食い違うと落ちる', () => {
    const b = officialMinimal();
    b.status = 'fictional';
    expect(issues(b).join()).toContain('fictional-');
    const c = clone(FICTIONAL_CLOUD);
    c.provider = 'real-cloud';
    expect(issues(c).join()).toContain('fictional-');
  });

  it('プールの参照・単位、段の並び、クレジットの対象を検証する', () => {
    const b = clone(FICTIONAL_CLOUD);
    b.plans[0]!.meters[0]!.allowancePool = 'nope';
    expect(issues(b).join()).toContain('nope');

    const c = clone(FICTIONAL_CLOUD);
    c.plans[0]!.meters[2]!.allowancePool = 'requests-pool'; // cpu-ms（ms）に request のプール
    expect(issues(c).join()).toContain('単位');

    const d = clone(FICTIONAL_CLOUD);
    const tiered = d.plans[0]!.meters[4]!;
    tiered.pricing = {
      model: 'tiered',
      per: 1,
      tiers: [
        { upTo: 100, unitPrice: 1 },
        { upTo: 50, unitPrice: 1 },
        { upTo: null, unitPrice: 1 },
      ],
    };
    expect(issues(d).join()).toContain('単調増加');

    const e = clone(FICTIONAL_CLOUD);
    e.plans[0]!.credits = [
      { id: 'c', amount: 1, appliesTo: { meterIds: ['ghost'] } },
    ];
    expect(issues(e).join()).toContain('ghost');
  });

  it('負の単価・非有限の数は落ちる', () => {
    const b = officialMinimal();
    b.plans[0]!.meters[0]!.pricing = { model: 'flat', per: 1, unitPrice: -1 };
    expect(issues(b).length).toBeGreaterThan(0);
    const c = officialMinimal();
    c.plans[0]!.meters[0]!.pricing = {
      model: 'flat',
      per: 1,
      unitPrice: Number.NaN,
    };
    expect(issues(c).length).toBeGreaterThan(0);
  });
});

describe('parsePriceBook', () => {
  it('本番（allowFictional: false）では架空の料金を拒否する', () => {
    expect(() =>
      parsePriceBook(FICTIONAL_CLOUD, { allowFictional: false }),
    ).toThrow(FictionalPriceBookError);
    expect(() =>
      parsePriceBook(officialMinimal(), { allowFictional: false }),
    ).not.toThrow();
  });
});
