// Supabase（Free・Pro）。2026-10-31 に公式ページから取得（spikes/concept-2026-10-31）。USD・税抜。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

export const supabase: PriceBookInput = {
  schemaVersion: 1,
  provider: 'supabase',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://supabase.com/pricing'),
    billing: src(
      'https://supabase.com/docs/guides/platform/billing-on-supabase',
    ),
    compute: src('https://supabase.com/docs/guides/platform/compute-and-disk'),
    egress: src(
      'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
    ),
  },
  allowancePools: [
    {
      id: 'free-egress',
      quantity: 5,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise: 'Supabase Free の egress は月 5 GB まで',
      sourceIds: ['egress'],
    },
    {
      id: 'pro-egress',
      quantity: 250,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'Supabase Pro の egress は月 250 GB まで込み（アプリへの DB の応答も数える想定）',
      sourceIds: ['egress'],
    },
    {
      id: 'pro-disk',
      quantity: 8,
      unit: 'gb-month',
      period: 'month',
      scope: 'node',
      premise: 'Supabase Pro はディスク 8 GB まで込み、以降 $0.125/GB 月',
      sourceIds: ['pricing'],
    },
  ],
  plans: [
    {
      id: 'free',
      service: 'database',
      name: 'Free',
      sourceIds: ['pricing', 'billing'],
      members: {
        pricing: 'included',
        premise:
          'Supabase はチームのメンバーが Free・Pro とも無制限（メンバーごとの料金なし）',
        sourceIds: ['pricing'],
      },
      notes: [
        '1 週間使われないとプロジェクトが一時停止する',
        '有効な無料プロジェクトは 2 つまで',
      ],
      meters: [
        {
          id: 'egress',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'free-egress',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['egress'],
        },
      ],
      limits: [
        {
          id: 'db-size',
          measure: 'storage-gb',
          value: 0.5,
          unit: 'gb',
          scope: 'node',
          onExceed: 'block',
          premise:
            'Supabase Free は DB 500 MB まで（1 週間使われないと一時停止）',
          sourceIds: ['pricing'],
        },
      ],
    },
    {
      id: 'pro-micro',
      service: 'database',
      name: 'Pro（Micro）',
      baseFee: { amount: 25, per: 'month', scope: 'account' },
      sourceIds: ['pricing', 'compute'],
      members: {
        pricing: 'included',
        premise:
          'Supabase はチームのメンバーが Free・Pro とも無制限（メンバーごとの料金なし）',
        sourceIds: ['pricing'],
      },
      credits: [
        {
          id: 'compute-credit',
          amount: 10,
          appliesTo: { meterIds: ['compute'] },
          sourceIds: ['compute'],
        },
      ],
      notes: [
        'Pro は支出上限が既定で有効。ただし Compute は上限の対象外',
        'Compute は 1 時間単位で切り上げ',
      ],
      meters: [
        {
          id: 'compute',
          resource: 'instance-hours',
          unit: 'hour',
          rounding: { granularity: 1, scope: 'period' },
          premise:
            'Supabase の Compute は時間課金で、使われていなくても動いている間は課金される',
          pricing: { model: 'flat', per: 1, unitPrice: 0.01344 },
          sourceIds: ['compute'],
        },
        {
          id: 'egress',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'pro-egress',
          pricing: { model: 'flat', per: 1, unitPrice: 0.09 },
          sourceIds: ['egress'],
        },
        {
          id: 'disk',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'pro-disk',
          pricing: { model: 'flat', per: 1, unitPrice: 0.125 },
          sourceIds: ['pricing'],
        },
      ],
      limits: [
        {
          id: 'pooler-connections',
          measure: 'peak-concurrency',
          value: 200,
          unit: 'count',
          scope: 'node',
          onExceed: 'block',
          premise:
            'Supabase Micro の pooler 接続は 200 まで（サーバーレスの同時実行がそのまま接続数になる）',
          sourceIds: ['compute'],
        },
      ],
    },
  ],
};
