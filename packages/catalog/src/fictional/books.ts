// 架空の料金データ（prd/03 §1・§10・prd/05 §1）。実在のサービスの料金ではない。
// 料金計算の仕組みを実在の料金に頼らずに確かめるためのもので、本番の読み込み（loadPriceBooks）には入れない。
// 値は手計算しやすい切りの良い値（単価 1・10・100、無料枠 1,000 など）にし、実在の料金と取り違えないようにする。
// 出典はすべて架空（example.invalid は RFC 2606 の予約名で、実在しない）。
import type { PriceBookInput } from 'estimator';

const FICTIONAL_SOURCE = {
  fictional: {
    url: 'https://example.invalid/fictional-price-book',
    retrievedAt: '2000-01-01',
    excerpt: '架空の料金。実在のサービスの料金ではない（テスト用）',
  },
};
const S = ['fictional'];
const NOTE = '架空の料金（テスト用）。実在のサービスの料金ではない';

/**
 * エッジの関数型（USD・税抜）。月・日・ノード単位の無料枠、1 回ごとと期間の切り上げ、段階料金、
 * 料金未取得のメーター、席課金、all-usage のクレジット（使い切ったら超過を請求）。
 */
export const FICTIONAL_EDGE: PriceBookInput = {
  schemaVersion: 1,
  provider: 'fictional-edge',
  version: 'fictional-1',
  status: 'fictional',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: '2000-01-01',
  sources: FICTIONAL_SOURCE,
  allowancePools: [
    {
      id: 'requests-month',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      sourceIds: S,
    },
    {
      id: 'kv-writes-day',
      quantity: 1_000,
      unit: 'operation',
      period: 'day',
      scope: 'account',
      premise: '架空: Free は 1 日 1,000 書き込みまで（超えると止まる）',
      sourceIds: S,
    },
    {
      id: 'disk-node',
      quantity: 10,
      unit: 'gb-month',
      period: 'month',
      scope: 'node',
      sourceIds: S,
    },
  ],
  plans: [
    {
      id: 'free',
      service: 'functions',
      name: 'Free',
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'requests-month',
          onExceed: 'block',
          premise: '架空: Free は月 100 万リクエストまで（超えると止まる）',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0 },
          sourceIds: S,
        },
        {
          id: 'kv-writes',
          resource: 'kv-writes',
          unit: 'operation',
          allowancePool: 'kv-writes-day',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1_000, unitPrice: 0 },
          sourceIds: S,
        },
      ],
      eligibility: [
        {
          id: 'non-commercial',
          requirement: 'non-commercial',
          premise: '架空: Free は非商用のみ',
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
    {
      id: 'pro',
      service: 'functions',
      name: 'Pro',
      baseFee: {
        amount: 20,
        per: 'month',
        scope: 'account',
        perSeat: true,
      },
      members: {
        pricing: 'per-seat',
        premise: '架空: Pro は 1 席あたり月 $20',
        sourceIds: S,
      },
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'requests-month',
          // 100 万件あたり $1
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 1 },
          sourceIds: S,
        },
        {
          id: 'cpu-ms',
          resource: 'cpu-ms',
          unit: 'ms',
          // 1 回ごとに 10 ms 単位で切り上げ。1,000 ms あたり $0.01
          rounding: { granularity: 10, scope: 'event' },
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.01 },
          sourceIds: S,
        },
        {
          id: 'egress',
          resource: 'egress-gb',
          unit: 'gb',
          // 段ごとに別の単価: 〜1,000 GB は $0.1、〜10,000 GB は $0.05、それ以上は $0.01
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 1_000, unitPrice: 0.1 },
              { upTo: 10_000, unitPrice: 0.05 },
              { upTo: null, unitPrice: 0.01 },
            ],
          },
          sourceIds: S,
        },
        {
          id: 'disk',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'disk-node',
          // 期間の合計を 1 GB 月の単位で切り上げ。1 GB 月あたり $1
          rounding: { granularity: 1, scope: 'period' },
          pricing: { model: 'flat', per: 1, unitPrice: 1 },
          sourceIds: S,
        },
        {
          id: 'logs',
          resource: 'kv-reads',
          unit: 'operation',
          pricing: { model: 'unpriced', note: '架空: 料金未取得のメーター' },
        },
      ],
      credits: [
        {
          id: 'usage-credit',
          amount: 10,
          appliesTo: 'all-usage',
          onExhausted: 'bill',
          premise: '架空: 従量に月 $10 のクレジット（超えた分は請求）',
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
  ],
  notes: [NOTE],
};

/**
 * 円建てのホスティング（JPY・税込）。使い切ると止まるクレジット、定額のプラン（込み分を超えると調整）、
 * ノード単位の基本料と一度だけの手数料。
 */
export const FICTIONAL_YEN_HOST: PriceBookInput = {
  schemaVersion: 1,
  provider: 'fictional-yen-host',
  version: 'fictional-1',
  status: 'fictional',
  currency: 'JPY',
  taxIncluded: true,
  retrievedAt: '2000-01-01',
  sources: FICTIONAL_SOURCE,
  allowancePools: [
    {
      id: 'flat-transfer',
      quantity: 1_000,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise: '架空: 定額のプランは月 1,000 GB まで込み（超えると速度を調整）',
      sourceIds: S,
    },
  ],
  plans: [
    {
      id: 'starter',
      service: 'hosting',
      name: 'Starter',
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          // 1 万件あたり 10 円
          pricing: { model: 'flat', per: 10_000, unitPrice: 10 },
          sourceIds: S,
        },
        {
          id: 'transfer',
          resource: 'egress-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 10 },
          sourceIds: S,
        },
      ],
      credits: [
        {
          id: 'starter-credit',
          amount: 1_000,
          appliesTo: 'all-usage',
          onExhausted: 'block',
          premise: '架空: 月 1,000 円分のクレジットを使い切るとサイトが止まる',
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
    {
      id: 'flat',
      service: 'hosting',
      name: 'Flat',
      baseFee: { amount: 5_000, per: 'month', scope: 'account' },
      meters: [
        {
          id: 'transfer',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'flat-transfer',
          onExceed: 'adjust',
          premise: '架空: 込み分を超えても請求は増えないが、速度を調整されうる',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: S,
        },
      ],
      addons: [
        {
          id: 'setup',
          name: '初期設定',
          oneTimeFee: 10_000,
          premise: '架空: 申し込みのときに一度だけ 10,000 円',
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
    {
      id: 'vps',
      service: 'vps',
      name: 'VPS',
      baseFee: { amount: 1_000, per: 'month', scope: 'node' },
      meters: [],
      addons: [
        {
          id: 'disk-change',
          name: 'ディスクの変更',
          oneTimeFee: 2_000,
          premise: '架空: ディスクを変えると一度だけ 2,000 円',
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
  ],
  notes: [NOTE],
};

/**
 * DB 型（USD・税抜）。時間課金の基本料と月額上限、volume（到達した段の単価が全量にかかる）、丸めの記載なし。
 */
export const FICTIONAL_DB: PriceBookInput = {
  schemaVersion: 1,
  provider: 'fictional-db',
  version: 'fictional-1',
  status: 'fictional',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: '2000-01-01',
  sources: FICTIONAL_SOURCE,
  plans: [
    {
      id: 'instance',
      service: 'database',
      name: 'Instance',
      // 1 時間 $0.01 × 730 時間 = $7.3 は月額上限 $5 で止まる
      baseFee: {
        amount: 0.01,
        per: 'hour',
        monthlyCap: 5,
        scope: 'node',
      },
      meters: [
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: {
            model: 'volume',
            per: 1,
            tiers: [
              { upTo: 100, unitPrice: 1 },
              { upTo: null, unitPrice: 0.5 },
            ],
          },
          sourceIds: S,
        },
        {
          id: 'rows-read',
          resource: 'rows-read',
          unit: 'row',
          rounding: 'not-stated',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 1 },
          sourceIds: S,
        },
      ],
      sourceIds: S,
    },
  ],
  notes: [NOTE],
};
