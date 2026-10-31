// テスト用の架空の料金データ（prd/05 §1）。数値は手計算しやすい丸い値で、実在の料金ではない。
import type { PriceBookInput } from './schema.ts';

export const FICTIONAL_CLOUD: PriceBookInput = {
  schemaVersion: 1,
  provider: 'fictional-cloud',
  version: 'test-1',
  status: 'fictional',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: '2000-01-01',
  allowancePools: [
    {
      id: 'requests-pool',
      quantity: 1000,
      unit: 'request',
      period: 'month',
      scope: 'account',
    },
    {
      id: 'daily-requests',
      quantity: 100,
      unit: 'request',
      period: 'day',
      scope: 'account',
    },
  ],
  plans: [
    {
      id: 'basic',
      service: 'compute',
      name: 'Basic',
      baseFee: { amount: 10, per: 'month', scope: 'account' },
      meters: [
        {
          id: 'requests',
          aliases: ['edge-requests'],
          resource: 'requests',
          unit: 'request',
          allowancePool: 'requests-pool',
          pricing: { model: 'flat', per: 1000, unitPrice: 1 },
        },
        {
          id: 'functions-requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'requests-pool',
          pricing: { model: 'flat', per: 1000, unitPrice: 1 },
        },
        {
          id: 'cpu-ms',
          resource: 'cpu-ms',
          unit: 'ms',
          rounding: { granularity: 1, scope: 'event' },
          pricing: { model: 'flat', per: 1000, unitPrice: 1 },
        },
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          rounding: { granularity: 1, scope: 'period' },
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
        },
        {
          id: 'egress-tiered',
          resource: 'egress-gb',
          unit: 'gb',
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 999, unitPrice: 1 },
              { upTo: null, unitPrice: 0.9 },
            ],
          },
        },
        {
          id: 'egress-volume',
          resource: 'egress-gb',
          unit: 'gb',
          pricing: {
            model: 'volume',
            per: 1,
            tiers: [
              { upTo: 999, unitPrice: 1 },
              { upTo: null, unitPrice: 0.9 },
            ],
          },
        },
        {
          id: 'kv-reads',
          resource: 'kv-reads',
          unit: 'operation',
          pricing: { model: 'unpriced', note: 'テスト: 料金未取得' },
        },
        {
          id: 'not-stated',
          resource: 'rows-read',
          unit: 'row',
          rounding: 'not-stated',
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
        },
        {
          id: 'capped-transfer',
          resource: 'egress-gb',
          unit: 'gb',
          onExceed: 'bill',
          configurableOnExceed: ['bill', 'block'],
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
        },
      ],
      credits: [
        {
          id: 'requests-credit',
          amount: 5,
          appliesTo: { meterIds: ['requests'] },
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
          premise: 'Free は 1 日 100 リクエストまで（超えると止まる）',
          pricing: { model: 'flat', per: 1000, unitPrice: 0 },
        },
      ],
      eligibility: [
        {
          id: 'hobby-only',
          requirement: 'non-commercial',
          premise: 'Free は非商用のみ',
        },
      ],
    },
    {
      id: 'instance',
      service: 'vm',
      name: 'Instance',
      baseFee: { amount: 0.02, per: 'hour', monthlyCap: 10, scope: 'node' },
      meters: [],
    },
    {
      id: 'team',
      service: 'compute',
      name: 'Team',
      baseFee: { amount: 20, per: 'month', scope: 'account', perSeat: true },
      meters: [
        {
          id: 'usage',
          resource: 'requests',
          unit: 'request',
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
        },
      ],
      credits: [{ id: 'usage-credit', amount: 20, appliesTo: 'all-usage' }],
    },
  ],
};

export const FICTIONAL_YEN_VPS: PriceBookInput = {
  schemaVersion: 1,
  provider: 'fictional-yen-vps',
  version: 'test-1',
  status: 'fictional',
  currency: 'JPY',
  taxIncluded: true,
  retrievedAt: '2000-01-01',
  plans: [
    {
      id: 'small',
      service: 'vps',
      name: 'Small',
      baseFee: { amount: 1000, per: 'month', scope: 'node' },
      meters: [],
      notes: ['テスト: 最低利用期間などの支払いの条件は備考に残す'],
    },
  ],
};
