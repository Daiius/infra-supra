// Vercel（Hobby・Pro）。2026-10-31 に公式ページから取得（spikes/concept-2026-10-31）。USD・税抜。
// Pro の込み分とクレジットの関係は文書が食い違うため、採用した解釈を interpretation に残す（D-10）。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

const PRO_INTERPRETATION = {
  adopted:
    'pricing ページの込み分（CDN Requests 月 1,000 万・Fast Data Transfer 月 1 TB）が残り、$20 のクレジットはそれ以外の従量と超過分に当たる',
  rejected: [
    {
      reading:
        '込み分はなく、すべての従量に最初の 1 単位からクレジットが当たる',
      reason:
        'pricing ページが資源ごとの込み分を明示している。Pro の文書の「from the first unit」は込み分のない資源の話と読めば両立する',
    },
  ],
};

export const vercel: PriceBookInput = {
  schemaVersion: 1,
  provider: 'vercel',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://vercel.com/pricing'),
    pro: src('https://vercel.com/docs/plans/pro-plan'),
    hobby: src('https://vercel.com/docs/plans/hobby'),
    functions: src('https://vercel.com/docs/functions/usage-and-pricing'),
    images: src(
      'https://vercel.com/docs/image-optimization/limits-and-pricing',
    ),
    isr: src(
      'https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing',
    ),
    sla: src('https://vercel.com/legal/sla'),
  },
  allowancePools: [
    {
      id: 'hobby-cdn-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-fdt',
      quantity: 100,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-fot',
      quantity: 10,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-invocations',
      quantity: 1_000_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-active-cpu',
      quantity: 4,
      unit: 'cpu-hour',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-memory',
      quantity: 360,
      unit: 'gb-hour',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-image-transformations',
      quantity: 5_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-image-cache-reads',
      quantity: 300_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-image-cache-writes',
      quantity: 100_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-isr-reads',
      quantity: 1_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-isr-writes',
      quantity: 200_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'pro-cdn-requests',
      quantity: 10_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'Vercel Pro は CDN Requests 月 1,000 万まで込み（静的アセット・画像も 1 件ずつ数える）',
      sourceIds: ['pricing'],
    },
    {
      id: 'pro-fdt',
      quantity: 1_000,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'Vercel Pro は Fast Data Transfer 月 1 TB まで込み、以降 $0.15/GB（Cloudflare は egress 無料）',
      sourceIds: ['pricing'],
    },
  ],
  plans: [
    {
      id: 'hobby',
      service: 'platform',
      name: 'Hobby',
      sourceIds: ['hobby', 'pricing'],
      uptimeSla: {
        status: 'not-stated',
        premise:
          'Vercel Hobby・Pro は料金のページに稼働率の SLA の記載なし（99.99% の SLA は Enterprise）',
        sourceIds: ['pricing', 'sla'],
      },
      eligibility: [
        {
          id: 'personal-non-commercial',
          requirement: 'non-commercial',
          premise: 'Vercel Hobby は個人・非商用のみ',
          sourceIds: ['hobby'],
        },
      ],
      meters: [
        [
          'cdn-requests',
          'requests',
          'request',
          'hobby-cdn-requests',
          'Hobby は CDN Requests 月 100 万まで（超えると 30 日待つ）',
        ],
        [
          'fast-data-transfer',
          'egress-gb',
          'gb',
          'hobby-fdt',
          'Hobby は Fast Data Transfer 月 100 GB まで',
        ],
        [
          'fast-origin-transfer',
          'origin-transfer-gb',
          'gb',
          'hobby-fot',
          'Hobby は Fast Origin Transfer 月 10 GB まで',
        ],
        [
          'invocations',
          'invocations',
          'count',
          'hobby-invocations',
          'Hobby は関数の実行 月 100 万回まで',
        ],
        [
          'active-cpu',
          'cpu-ms',
          'cpu-hour',
          'hobby-active-cpu',
          'Hobby は Active CPU 月 4 時間まで',
        ],
        [
          'provisioned-memory',
          'memory-gb-hours',
          'gb-hour',
          'hobby-memory',
          'Hobby はメモリ 月 360 GB 時まで',
        ],
        [
          'image-transformations',
          'image-transformations',
          'count',
          'hobby-image-transformations',
          'Hobby は画像の変換 月 5,000 回まで（超えると 402）',
        ],
        [
          'image-cache-reads',
          'image-cache-reads',
          'operation',
          'hobby-image-cache-reads',
          'Hobby は画像キャッシュの読み取り 月 30 万単位まで',
        ],
        [
          'image-cache-writes',
          'image-cache-writes',
          'operation',
          'hobby-image-cache-writes',
          'Hobby は画像キャッシュの書き込み 月 10 万単位まで',
        ],
        [
          'isr-reads',
          'isr-reads',
          'operation',
          'hobby-isr-reads',
          'Hobby は ISR の読み取り 月 100 万単位まで',
        ],
        [
          'isr-writes',
          'isr-writes',
          'operation',
          'hobby-isr-writes',
          'Hobby は ISR の書き込み 月 20 万単位まで',
        ],
      ].map(([id, resource, unit, pool, premise]) => ({
        id: id!,
        resource: resource as never,
        unit: unit as never,
        allowancePool: pool!,
        onExceed: 'block' as const,
        premise: premise!,
        pricing: { model: 'flat' as const, per: 1, unitPrice: 0 },
        sourceIds: ['pricing', 'hobby'],
      })),
    },
    {
      id: 'pro',
      service: 'platform',
      name: 'Pro',
      baseFee: { amount: 20, per: 'month', scope: 'account', perSeat: true },
      sourceIds: ['pro', 'pricing'],
      uptimeSla: {
        status: 'not-stated',
        premise:
          'Vercel Hobby・Pro は料金のページに稼働率の SLA の記載なし（99.99% の SLA は Enterprise）',
        sourceIds: ['pricing', 'sla'],
      },
      members: {
        pricing: 'per-seat',
        premise: 'Vercel Pro は基本料 $20 が席（メンバー）ごとにかかる',
        sourceIds: ['pro', 'pricing'],
      },
      credits: [
        {
          id: 'usage-credit',
          amount: 20,
          appliesTo: 'all-usage',
          interpretation: PRO_INTERPRETATION,
          sourceIds: ['pro'],
        },
      ],
      notes: [
        'Pro の従量は既定で上限なし。予算で一時停止できるが、数分の遅れがある（spend management）',
      ],
      meters: [
        {
          id: 'cdn-requests',
          aliases: ['edge-requests'],
          resource: 'requests',
          unit: 'request',
          allowancePool: 'pro-cdn-requests',
          interpretation: PRO_INTERPRETATION,
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 2 },
          sourceIds: ['pricing'],
        },
        {
          id: 'fast-data-transfer',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'pro-fdt',
          interpretation: PRO_INTERPRETATION,
          pricing: { model: 'flat', per: 1, unitPrice: 0.15 },
          sourceIds: ['pricing'],
        },
        {
          id: 'fast-origin-transfer',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0.06 },
          sourceIds: ['pricing'],
        },
        {
          id: 'invocations',
          resource: 'invocations',
          unit: 'count',
          interpretation: {
            adopted: '$0.60/100 万回（functions の本文の例）',
            rejected: [
              {
                reading: '従量の課金なし（functions の表の N/A）',
                reason:
                  '本文に「Vercel bills Pro invocations on demand」とある',
              },
            ],
          },
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.6 },
          sourceIds: ['functions', 'pricing'],
        },
        {
          id: 'active-cpu',
          resource: 'cpu-ms',
          unit: 'cpu-hour',
          rounding: 'not-stated',
          premise: 'Vercel の Active CPU は I/O 待ちの間は課金しない',
          pricing: { model: 'flat', per: 1, unitPrice: 0.128 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.202 },
            },
            {
              region: 'kix1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.202 },
            },
          ],
          sourceIds: ['functions'],
        },
        {
          id: 'provisioned-memory',
          resource: 'memory-gb-hours',
          unit: 'gb-hour',
          rounding: 'not-stated',
          premise:
            'Vercel のメモリはインスタンスの生存時間で課金される（I/O 待ちも含む）',
          pricing: { model: 'flat', per: 1, unitPrice: 0.0106 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.0167 },
            },
            {
              region: 'kix1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.0167 },
            },
          ],
          sourceIds: ['functions'],
        },
        {
          id: 'image-transformations',
          resource: 'image-transformations',
          unit: 'count',
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.05 },
          sourceIds: ['images'],
        },
        {
          id: 'image-cache-reads',
          resource: 'image-cache-reads',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.4 },
          sourceIds: ['images'],
        },
        {
          id: 'image-cache-writes',
          resource: 'image-cache-writes',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 4 },
          sourceIds: ['images'],
        },
        {
          id: 'isr-reads',
          resource: 'isr-reads',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.4 },
          sourceIds: ['pricing', 'isr'],
        },
        {
          id: 'isr-writes',
          resource: 'isr-writes',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 4 },
          sourceIds: ['pricing', 'isr'],
        },
      ],
    },
  ],
  notes: [
    'CDN・FDT・ISR・画像の単価は地域で変わる（地域別の表は未取得。pricing ページの「starting at」を使っている）',
    'Active CPU・メモリの既定の単価は iad1（最安の地域）。hnd1・kix1 は地域料金として持つ',
  ],
};
