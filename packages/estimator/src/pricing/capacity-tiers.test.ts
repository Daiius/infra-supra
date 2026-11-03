// 容量の段（D-120。Vercel の Flat Rate CDN の形）と、読者の地域の単価（regionBy）。料金はすべて架空。
import { describe, expect, it } from 'vitest';
import { FICTIONAL_CLOUD } from './fixtures.test-helpers.ts';
import {
  priceUsage,
  PricingInputError,
  type MeterUsage,
  type Subscription,
} from './price.ts';
import { parsePriceBook, PriceBookSchema } from './schema.ts';

// 架空のプラン: CDN の 2 つの次元（リクエスト・転送）を段の定額で払う。段に込みでない従量（origin）とクレジットもある
const tiered = parsePriceBook(
  {
    ...FICTIONAL_CLOUD,
    plans: [
      ...FICTIONAL_CLOUD.plans,
      {
        id: 'cdn',
        service: 'cdn',
        name: 'CDN',
        meters: [
          {
            id: 'req',
            resource: 'requests',
            unit: 'request',
            pricing: { model: 'flat', per: 1, unitPrice: 1 },
            regionBy: 'viewer',
            regional: [
              {
                region: 'far',
                pricing: { model: 'flat', per: 1, unitPrice: 2 },
              },
            ],
          },
          {
            id: 'out',
            resource: 'egress-gb',
            unit: 'gb',
            pricing: { model: 'flat', per: 1, unitPrice: 1 },
          },
          {
            id: 'origin',
            resource: 'origin-transfer-gb',
            unit: 'gb',
            pricing: { model: 'flat', per: 1, unitPrice: 1 },
            regional: [
              {
                region: 'far',
                pricing: { model: 'flat', per: 1, unitPrice: 3 },
              },
            ],
          },
        ],
        credits: [{ id: 'c', amount: 5, appliesTo: 'all-usage' }],
        capacityTiers: [
          {
            id: 'flat',
            label: '段',
            dimensions: [
              {
                id: 'requests',
                label: 'リクエスト',
                unit: 'request',
                meterIds: ['req'],
              },
              {
                id: 'transfer',
                label: '転送',
                unit: 'gb',
                meterIds: ['out'],
              },
            ],
            tiers: [
              {
                id: 't0',
                label: '込み',
                fee: 0,
                capacity: { requests: 100, transfer: 10 },
              },
              {
                id: 't1',
                label: '中',
                fee: 30,
                capacity: { requests: 1000, transfer: 100 },
              },
            ],
            premise: '段',
          },
        ],
      },
    ],
  },
  { allowFictional: true },
);

const use = (meterId: string, quantity: number): MeterUsage => ({
  accountId: 'acct',
  nodeId: 'n1',
  provider: 'fictional-cloud',
  planId: 'cdn',
  meterId,
  quantity,
});
const run = (usage: MeterUsage[], extra: Partial<Subscription> = {}) =>
  priceUsage({
    books: [tiered],
    subscriptions: [
      {
        accountId: 'acct',
        provider: 'fictional-cloud',
        planId: 'cdn',
        nodeIds: ['n1'],
        ...extra,
      },
    ],
    usage,
  });
type Bill = ReturnType<typeof run>;
const line = (b: Bill, meterId: string) =>
  b.lines.find((l) => l.kind === 'usage' && l.priceRef.meterId === meterId)!;
const tierFee = (b: Bill) =>
  b.lines.find((l) => l.kind === 'base-fee' && l.capacityTier);

describe('容量の段（D-120）', () => {
  it('fit: 量が収まる最小の段の月額を払い、対象のメーターは 0（クレジットは月額に当てない）', () => {
    const b = run([use('req', 500), use('out', 5), use('origin', 2)]);
    expect(b.capacityTiers).toEqual([
      expect.objectContaining({
        set: 'flat',
        applied: 't1',
        fitting: 't1',
        usage: { requests: 500, transfer: 5 },
        onDemand: 505,
      }),
    ]);
    expect(tierFee(b)).toMatchObject({
      amount: 30,
      capacityTier: { set: 'flat', tier: 't1' },
    });
    expect(line(b, 'req').amount).toBe(0);
    expect(line(b, 'out').amount).toBe(0);
    // 段に込みでない従量にだけクレジットが当たる（2 < 5）
    expect(b.lines.find((l) => l.kind === 'credit')!.amount).toBe(-2);
    expect(b.totals.USD).toBe(30);
  });

  it('段の id: 量が段を超えてもその段の月額のまま（翌月から上の段にするのは使う側）', () => {
    const b = run([use('req', 500), use('out', 5)], {
      capacityTiers: { flat: 't0' },
    });
    expect(b.capacityTiers[0]).toMatchObject({ applied: 't0', fitting: 't1' });
    expect(tierFee(b)!.amount).toBe(0);
    expect(b.totals.USD).toBe(0);
  });

  it('lowest: 選んでいない段の集まりは最小の段（始めたばかりの契約）', () => {
    const b = run([use('req', 500)], { capacityTierDefault: 'lowest' });
    expect(b.capacityTiers[0]!.applied).toBe('t0');
  });

  it('off: 段を使わず従量（クレジットが当たる）。量と収まる段は出す', () => {
    const b = run([use('req', 3), use('out', 1)], {
      capacityTiers: { flat: 'off' },
    });
    expect(tierFee(b)).toBeUndefined();
    expect(line(b, 'req').amount).toBe(3);
    expect(b.capacityTiers[0]).toMatchObject({ applied: null, fitting: 't0' });
    expect(b.totals.USD).toBe(0);
  });

  it('最上段を超える量は、fit なら従量', () => {
    const b = run([use('req', 5000)]);
    expect(b.capacityTiers[0]).toMatchObject({ applied: null, fitting: null });
    expect(line(b, 'req').amount).toBe(5000);
  });

  it('無い段の id は入力の誤り', () => {
    expect(() =>
      run([use('req', 1)], { capacityTiers: { flat: 'x' } }),
    ).toThrow(PricingInputError);
  });
});

describe('地域の単価（regionBy。D-120）', () => {
  it('viewer は読者の地域、それ以外は契約の地域の単価を引く', () => {
    const at = (region: string, viewerRegion: string) =>
      run([use('req', 10), use('origin', 10)], {
        capacityTiers: { flat: 'off' },
        region,
        viewerRegion,
      });
    const a = at('near', 'far');
    expect(line(a, 'req').amount).toBe(20);
    expect(line(a, 'origin').amount).toBe(10);
    const b = at('far', 'near');
    expect(line(b, 'req').amount).toBe(10);
    expect(line(b, 'origin').amount).toBe(30);
  });
});

describe('容量の段のスキーマ（D-120）', () => {
  const parse = (patch: object) =>
    PriceBookSchema.safeParse({
      ...FICTIONAL_CLOUD,
      plans: [
        {
          id: 'x',
          service: 'x',
          name: 'x',
          meters: [
            {
              id: 'req',
              resource: 'requests',
              unit: 'request',
              pricing: { model: 'flat', per: 1, unitPrice: 1 },
            },
          ],
          capacityTiers: [
            {
              id: 'flat',
              label: '段',
              dimensions: [
                {
                  id: 'requests',
                  label: 'r',
                  unit: 'request',
                  meterIds: ['req'],
                },
              ],
              tiers: [
                { id: 'a', label: 'a', fee: 0, capacity: { requests: 10 } },
                { id: 'b', label: 'b', fee: 5, capacity: { requests: 20 } },
              ],
              premise: '段',
              ...patch,
            },
          ],
        },
      ],
    }).success;

  it('次元ごとの容量・小さい順・対象のメーターがあること・単位の一致を検査する', () => {
    expect(parse({})).toBe(true);
    expect(
      parse({
        tiers: [
          { id: 'a', label: 'a', fee: 5, capacity: { requests: 10 } },
          { id: 'b', label: 'b', fee: 0, capacity: { requests: 20 } },
        ],
      }),
    ).toBe(false);
    expect(
      parse({
        dimensions: [
          { id: 'requests', label: 'r', unit: 'request', meterIds: ['nope'] },
        ],
      }),
    ).toBe(false);
    expect(
      parse({
        dimensions: [
          { id: 'requests', label: 'r', unit: 'gb', meterIds: ['req'] },
        ],
      }),
    ).toBe(false);
    expect(
      parse({
        tiers: [{ id: 'a', label: 'a', fee: 0, capacity: { other: 10 } }],
      }),
    ).toBe(false);
  });
});
