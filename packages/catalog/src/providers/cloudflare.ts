// Cloudflare（Workers・D1・KV・R2・Images）。2026-10-31 に公式ページから取得（spikes/concept-2026-10-31）。USD・税抜。
// Durable Objects・Hyperdrive・KV の書き込みの制限と整合性・D1 の 1 行・Workers のメモリ・SLA は GD-4 で足した（2026-10-31 に原文で確認。
// prd/research/2026-10-31-gd4-data.md）。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

type PlanInput = PriceBookInput['plans'][number];
type LimitInput = NonNullable<PlanInput['limits']>[number];
type SlaInput = NonNullable<PlanInput['uptimeSla']>;

/** Workers のアカウントのプラン（Free・Paid）で共通の事実。ノードが facts で挙げたときだけ前提に出る。 */
const WORKERS_FACTS = [
  {
    id: 'kv-propagation',
    premise:
      'KV の書き込みは、他の拠点で見えるまで 60 秒以上かかることがある（同じ拠点でもすぐ見える保証はない）',
    sourceIds: ['kvHowItWorks'],
  },
  {
    id: 'd1-row-size',
    premise: 'D1 の 1 行（文字列・BLOB）は 2 MB まで',
    sourceIds: ['d1Limits'],
  },
  {
    id: 'workers-memory',
    premise: 'Workers のメモリは 1 isolate あたり 128 MB まで',
    sourceIds: ['workersLimits'],
  },
  {
    id: 'workers-cache',
    premise:
      'vinext の workersCacheCdnAdapter は ISR のページを Workers Cache（ctx.cache）から返し、revalidateTag・revalidatePath でタグをパージする。Cache API の中身はキャッシュした拠点の外へは複製されない',
    interpretation: {
      adopted:
        'パージで即時反映の要件を満たせるとみなす（パージが全拠点へ伝わる時間は、読んだページに記載なし）',
      rejected: [
        {
          reading: '拠点ごとに古い版が残る',
          reason: 'README はタグでエッジをパージすると書いている',
        },
      ],
    },
    sourceIds: ['vinextReadme', 'cacheApi'],
  },
];

/** KV の同じキーへの書き込み（Free・Paid 共通）。超えた書き込みは 429 で失敗する。 */
const KV_SAME_KEY: LimitInput = {
  id: 'kv-same-key-writes',
  measure: 'writes-per-second-per-key',
  value: 1,
  unit: 'count',
  scope: 'node',
  onExceed: 'block',
  premise:
    'KV の同じキーへの書き込みは 1 秒 1 回まで（超えた書き込みは 429 のエラー）',
  sourceIds: ['kvLimits', 'kvWrite'],
};

/** Workers・R2・Images などセルフサービスのプランの SLA（Cloudflare の稼働率の SLA は Business・Enterprise の契約）。 */
const NO_SELF_SERVE_SLA: SlaInput = {
  status: 'not-stated',
  premise:
    'Cloudflare の開発者向けプラン（Workers など）の料金・制限のページに稼働率の SLA の記載なし（100% の SLA は Business・Enterprise のプラン、Workers の 99.99% は Enterprise の契約）',
  sourceIds: ['workersPricing', 'plans', 'businessSla', 'workersSla'],
};

export const cloudflare: PriceBookInput = {
  schemaVersion: 1,
  provider: 'cloudflare',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    workersPricing: src(
      'https://developers.cloudflare.com/workers/platform/pricing/',
    ),
    workersLimits: src(
      'https://developers.cloudflare.com/workers/platform/limits/',
    ),
    d1Pricing: src('https://developers.cloudflare.com/d1/platform/pricing/'),
    d1Limits: src('https://developers.cloudflare.com/d1/platform/limits/'),
    members: src(
      'https://developers.cloudflare.com/fundamentals/setup/manage-members/',
    ),
    kvPricing: src('https://developers.cloudflare.com/kv/platform/pricing/'),
    r2Pricing: src('https://developers.cloudflare.com/r2/pricing/'),
    imagesPricing: src('https://developers.cloudflare.com/images/pricing/'),
    kvLimits: src('https://developers.cloudflare.com/kv/platform/limits/'),
    kvWrite: src(
      'https://developers.cloudflare.com/kv/api/write-key-value-pairs/',
    ),
    kvHowItWorks: src(
      'https://developers.cloudflare.com/kv/concepts/how-kv-works/',
    ),
    doPricing: src(
      'https://developers.cloudflare.com/durable-objects/platform/pricing/',
    ),
    hyperdrivePricing: src(
      'https://developers.cloudflare.com/hyperdrive/platform/pricing/',
    ),
    hyperdriveLimits: src(
      'https://developers.cloudflare.com/hyperdrive/platform/limits/',
    ),
    plans: src('https://www.cloudflare.com/plans/'),
    businessSla: src('https://www.cloudflare.com/business-sla/'),
    workersSla: src(
      'https://www.cloudflare.com/workers-service-level-agreement/',
    ),
    // 前段の CDN（さくらの VPS の前に置く。2026-11-01 に原文で確認。D-31）
    defaultCache: {
      url: 'https://developers.cloudflare.com/cache/concepts/default-cache-behavior/',
      retrievedAt: '2026-11-01',
    },
    cdnTerms: {
      url: 'https://www.cloudflare.com/service-specific-terms-application-services/',
      retrievedAt: '2026-11-01',
    },
    // オンデマンド ISR（2026-11-01 に原文で確認。D-32）
    cacheApi: {
      url: 'https://developers.cloudflare.com/workers/runtime-apis/cache/',
      retrievedAt: '2026-11-01',
    },
    r2Consistency: {
      url: 'https://developers.cloudflare.com/r2/reference/consistency/',
      retrievedAt: '2026-11-01',
    },
    vinextReadme: {
      url: 'https://github.com/cloudflare/vinext',
      retrievedAt: '2026-11-01',
    },
    // Next.js の CDN の扱い（Cloudflare の文書ではないが、前段の CDN の前提として一緒に持つ）
    nextjsCdn: {
      url: 'https://nextjs.org/docs/app/guides/cdn-caching',
      retrievedAt: '2026-11-01',
    },
  },
  allowancePools: [
    // Workers Free（日次・UTC 0 時にリセット。超過は止まる）
    {
      id: 'free-requests',
      quantity: 100_000,
      unit: 'request',
      period: 'day',
      scope: 'account',
      sourceIds: ['workersLimits'],
    },
    {
      id: 'free-d1-rows-read',
      quantity: 5_000_000,
      unit: 'row',
      period: 'day',
      scope: 'account',
      sourceIds: ['d1Pricing'],
    },
    {
      id: 'free-d1-rows-written',
      quantity: 100_000,
      unit: 'row',
      period: 'day',
      scope: 'account',
      sourceIds: ['d1Pricing'],
    },
    {
      id: 'free-kv-reads',
      quantity: 100_000,
      unit: 'operation',
      period: 'day',
      scope: 'account',
      sourceIds: ['kvPricing'],
    },
    {
      id: 'free-kv-writes',
      quantity: 1_000,
      unit: 'operation',
      period: 'day',
      scope: 'account',
      sourceIds: ['kvPricing'],
    },
    // Workers Paid（月次。Workers・Pages Functions で共有）
    {
      id: 'paid-requests',
      quantity: 10_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'Workers Paid は月 1,000 万リクエストまで込み（Pages Functions とも共有）',
      sourceIds: ['workersPricing'],
    },
    {
      id: 'paid-cpu-ms',
      quantity: 30_000_000,
      unit: 'ms',
      period: 'month',
      scope: 'account',
      sourceIds: ['workersPricing'],
    },
    {
      id: 'paid-d1-rows-read',
      quantity: 25_000_000_000,
      unit: 'row',
      period: 'month',
      scope: 'account',
      sourceIds: ['d1Pricing'],
    },
    {
      id: 'paid-d1-rows-written',
      quantity: 50_000_000,
      unit: 'row',
      period: 'month',
      scope: 'account',
      sourceIds: ['d1Pricing'],
    },
    {
      id: 'paid-d1-storage',
      quantity: 5,
      unit: 'gb-month',
      period: 'month',
      scope: 'account',
      premise: 'D1（Workers Paid）は保存量 5 GB まで込み、以降 $0.75/GB 月',
      sourceIds: ['d1Pricing'],
    },
    {
      id: 'paid-kv-reads',
      quantity: 10_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['kvPricing'],
    },
    {
      id: 'paid-kv-writes',
      quantity: 1_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      premise: 'KV の書き込みは月 100 万回まで込み、以降 $5/100 万回',
      sourceIds: ['kvPricing'],
    },
    // R2（Workers のプランによらない）
    {
      id: 'r2-storage',
      quantity: 10,
      unit: 'gb-month',
      period: 'month',
      scope: 'account',
      premise: 'R2 は保存量 10 GB まで込み、以降 $0.015/GB 月',
      sourceIds: ['r2Pricing'],
    },
    {
      id: 'r2-class-a',
      quantity: 1_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['r2Pricing'],
    },
    {
      id: 'r2-class-b',
      quantity: 10_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['r2Pricing'],
    },
    // Durable Objects（SQLite のストレージ。Free は日次・UTC 0 時にリセットで、超えるとその種類の操作が失敗する）
    {
      id: 'do-free-requests',
      quantity: 100_000,
      unit: 'request',
      period: 'day',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-free-duration',
      quantity: 13_000,
      unit: 'gb-second',
      period: 'day',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-free-rows-read',
      quantity: 5_000_000,
      unit: 'row',
      period: 'day',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-free-rows-written',
      quantity: 100_000,
      unit: 'row',
      period: 'day',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-paid-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'Durable Objects（Workers Paid）は月 100 万リクエストまで込み、以降 $0.15/100 万（WebSocket の受信メッセージは 20 件で 1 リクエスト）',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-paid-duration',
      quantity: 400_000,
      unit: 'gb-second',
      period: 'month',
      scope: 'account',
      premise:
        'Durable Objects（Workers Paid）の実行時間は月 40 万 GB-s まで込み、以降 $12.50/100 万 GB-s（休止中は課金しない）',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-paid-rows-read',
      quantity: 25_000_000_000,
      unit: 'row',
      period: 'month',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    {
      id: 'do-paid-rows-written',
      quantity: 50_000_000,
      unit: 'row',
      period: 'month',
      scope: 'account',
      sourceIds: ['doPricing'],
    },
    // Hyperdrive（Free は日次・UTC 0 時にリセット。Paid は無制限）
    {
      id: 'hyperdrive-free-queries',
      quantity: 100_000,
      unit: 'count',
      period: 'day',
      scope: 'account',
      sourceIds: ['hyperdrivePricing'],
    },
    // Images（一意な変換を暦月で数える）
    {
      id: 'images-transformations',
      quantity: 5_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      premise:
        'Images は月 5,000 の一意な変換まで込み（画像の種類 × サイズ違い）',
      sourceIds: ['imagesPricing'],
    },
  ],
  plans: [
    {
      id: 'workers-free',
      service: 'workers',
      name: 'Workers Free',
      sourceIds: ['workersPricing'],
      members: {
        pricing: 'not-stated',
        premise:
          'Cloudflare のアカウントのメンバーの料金は、メンバーの管理と Workers の料金のページに記載なし（Workers Paid の最低料金はアカウントあたり）',
        sourceIds: ['members', 'workersPricing'],
      },
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'free-requests',
          onExceed: 'block',
          premise:
            'Workers Free は 1 日 10 万リクエストまで（超えると UTC 0 時まで Error 1027）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['workersLimits'],
        },
        {
          id: 'cpu-ms',
          resource: 'cpu-ms',
          unit: 'ms',
          rounding: 'not-stated',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['workersPricing'],
        },
        {
          id: 'd1-rows-read',
          resource: 'rows-read',
          unit: 'row',
          allowancePool: 'free-d1-rows-read',
          onExceed: 'block',
          premise:
            'D1 Free は 1 日 500 万行の読み取りまで（超えるとクエリがエラー）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['d1Pricing'],
        },
        {
          id: 'd1-rows-written',
          resource: 'rows-written',
          unit: 'row',
          allowancePool: 'free-d1-rows-written',
          onExceed: 'block',
          premise: 'D1 Free は 1 日 10 万行の書き込みまで',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['d1Pricing'],
        },
        {
          id: 'kv-reads',
          resource: 'kv-reads',
          unit: 'operation',
          allowancePool: 'free-kv-reads',
          onExceed: 'block',
          premise: 'KV Free は 1 日 10 万回の読み取りまで',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['kvPricing'],
        },
        {
          id: 'kv-writes',
          resource: 'kv-writes',
          unit: 'operation',
          allowancePool: 'free-kv-writes',
          onExceed: 'block',
          premise:
            'KV Free は 1 日 1,000 回の書き込みまで（ISR の再生成のたびに書く）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['kvPricing'],
        },
      ],
      limits: [
        {
          id: 'cpu-ms-per-request',
          measure: 'cpu-ms-per-request',
          value: 10,
          unit: 'ms',
          scope: 'request',
          onExceed: 'block',
          premise:
            'Workers Free は 1 リクエストあたり CPU 10 ms まで（超えると Error 1102）',
          sourceIds: ['workersLimits'],
        },
        {
          id: 'd1-db-size',
          measure: 'storage-gb',
          value: 0.5,
          unit: 'gb',
          scope: 'node',
          onExceed: 'block',
          premise: 'D1 Free はデータベースあたり 500 MB まで',
          sourceIds: ['d1Limits'],
        },
        KV_SAME_KEY,
      ],
      facts: WORKERS_FACTS,
      uptimeSla: NO_SELF_SERVE_SLA,
    },
    {
      id: 'workers-paid',
      service: 'workers',
      name: 'Workers Paid',
      baseFee: { amount: 5, per: 'month', scope: 'account' },
      sourceIds: ['workersPricing'],
      members: {
        pricing: 'not-stated',
        premise:
          'Cloudflare のアカウントのメンバーの料金は、メンバーの管理と Workers の料金のページに記載なし（Workers Paid の最低料金はアカウントあたり）',
        sourceIds: ['members', 'workersPricing'],
      },
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'paid-requests',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.3 },
          sourceIds: ['workersPricing'],
        },
        {
          id: 'cpu-ms',
          resource: 'cpu-ms',
          unit: 'ms',
          allowancePool: 'paid-cpu-ms',
          rounding: 'not-stated',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.02 },
          sourceIds: ['workersPricing'],
        },
        {
          id: 'd1-rows-read',
          resource: 'rows-read',
          unit: 'row',
          allowancePool: 'paid-d1-rows-read',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.001 },
          sourceIds: ['d1Pricing'],
        },
        {
          id: 'd1-rows-written',
          resource: 'rows-written',
          unit: 'row',
          allowancePool: 'paid-d1-rows-written',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 1 },
          sourceIds: ['d1Pricing'],
        },
        {
          id: 'd1-storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'paid-d1-storage',
          pricing: { model: 'flat', per: 1, unitPrice: 0.75 },
          sourceIds: ['d1Pricing'],
        },
        {
          id: 'kv-reads',
          resource: 'kv-reads',
          unit: 'operation',
          allowancePool: 'paid-kv-reads',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.5 },
          sourceIds: ['kvPricing'],
        },
        {
          id: 'kv-writes',
          resource: 'kv-writes',
          unit: 'operation',
          allowancePool: 'paid-kv-writes',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 5 },
          sourceIds: ['kvPricing'],
        },
      ],
      limits: [
        {
          id: 'd1-db-size',
          measure: 'storage-gb',
          value: 10,
          unit: 'gb',
          scope: 'node',
          onExceed: 'block',
          premise: 'D1 はデータベースあたり 10 GB まで（引き上げ不可）',
          sourceIds: ['d1Limits'],
        },
        KV_SAME_KEY,
      ],
      facts: WORKERS_FACTS,
      uptimeSla: NO_SELF_SERVE_SLA,
    },
    {
      id: 'r2-standard',
      service: 'r2',
      name: 'R2 Standard',
      sourceIds: ['r2Pricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      facts: [
        {
          id: 'strong-consistency',
          premise:
            'R2 は読み書き・削除・一覧が全世界で強い整合（書いた直後から全世界で見える）',
          sourceIds: ['r2Consistency'],
        },
      ],
      meters: [
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'r2-storage',
          rounding: { granularity: 1, scope: 'period' },
          pricing: { model: 'flat', per: 1, unitPrice: 0.015 },
          sourceIds: ['r2Pricing'],
        },
        {
          id: 'class-a',
          resource: 'object-writes',
          unit: 'operation',
          allowancePool: 'r2-class-a',
          // "Cloudflare rounds up your usage to the next billing unit."（r2/pricing。100 万件単位）
          rounding: { granularity: 1_000_000, scope: 'period' },
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 4.5 },
          sourceIds: ['r2Pricing'],
        },
        {
          id: 'class-b',
          resource: 'object-reads',
          unit: 'operation',
          allowancePool: 'r2-class-b',
          // "Cloudflare rounds up your usage to the next billing unit."（r2/pricing。100 万件単位）
          rounding: { granularity: 1_000_000, scope: 'period' },
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.36 },
          sourceIds: ['r2Pricing'],
        },
        {
          id: 'egress',
          resource: 'egress-gb',
          unit: 'gb',
          premise: 'R2 は転送量（egress）に課金しない',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['r2Pricing'],
        },
      ],
    },
    {
      id: 'images-free',
      service: 'images',
      name: 'Images Free',
      sourceIds: ['imagesPricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      meters: [
        {
          id: 'transformations',
          resource: 'image-transformations',
          unit: 'count',
          allowancePool: 'images-transformations',
          onExceed: 'block',
          premise:
            'Images Free は月 5,000 の一意な変換まで（超えると新しい変換が 9422 エラー）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['imagesPricing'],
        },
      ],
    },
    {
      id: 'images-paid',
      service: 'images',
      name: 'Images Paid',
      sourceIds: ['imagesPricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      notes: ['Images Paid の基本料は取得したページに記載がなかった'],
      meters: [
        {
          id: 'transformations',
          resource: 'image-transformations',
          unit: 'count',
          allowancePool: 'images-transformations',
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.5 },
          sourceIds: ['imagesPricing'],
        },
      ],
    },
    {
      // 前段の CDN（Free プラン）。従量のメーターは持たない（このモデルでは課金なし）
      id: 'cdn-free',
      service: 'cdn',
      name: 'CDN（Free）',
      sourceIds: ['plans', 'defaultCache'],
      uptimeSla: {
        status: 'none',
        premise:
          'Cloudflare の Free プランに稼働率の SLA は無い（100% の SLA は Business・Contract）',
        sourceIds: ['plans'],
      },
      meters: [],
      facts: [
        {
          id: 'html-not-cached',
          premise:
            'Cloudflare の CDN は既定では HTML と JSON をキャッシュしない（拡張子で判定する）',
          sourceIds: ['defaultCache'],
        },
        {
          id: 'pictures-terms',
          premise:
            'Cloudflare の CDN（Free・Pro・Business）はウェブページとサイトのためのもので、動画や、不釣り合いな割合の画像などの大きなファイルを配るには Images などの有料サービスを使う（規約）',
          sourceIds: ['cdnTerms'],
        },
        {
          id: 'next-on-demand',
          premise:
            'Next.js のオンデマンドの再検証（revalidatePath・revalidateTag）は CDN には届かず、CDN は s-maxage が切れるまで古いページを返す（CDN のパージを一緒に呼ぶ必要がある）',
          sourceIds: ['nextjsCdn'],
        },
      ],
    },
    {
      id: 'durable-objects-free',
      service: 'durable-objects',
      name: 'Durable Objects（Workers Free・SQLite）',
      sourceIds: ['doPricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'do-free-requests',
          onExceed: 'block',
          premise:
            'Durable Objects（Workers Free）は 1 日 10 万リクエストまで（WebSocket の受信メッセージは 20 件で 1 リクエスト。超えると失敗）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'duration',
          resource: 'gb-seconds',
          unit: 'gb-second',
          allowancePool: 'do-free-duration',
          onExceed: 'block',
          premise:
            'Durable Objects（Workers Free）の実行時間は 1 日 13,000 GB-s まで（休止中は数えない）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'rows-read',
          resource: 'rows-read',
          unit: 'row',
          allowancePool: 'do-free-rows-read',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'rows-written',
          resource: 'rows-written',
          unit: 'row',
          allowancePool: 'do-free-rows-written',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['doPricing'],
        },
      ],
    },
    {
      id: 'durable-objects-paid',
      service: 'durable-objects',
      name: 'Durable Objects（Workers Paid・SQLite）',
      sourceIds: ['doPricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      notes: [
        'Workers Paid の最低料金 $5/月の中で使う（Durable Objects 単独の基本料はない）',
      ],
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'do-paid-requests',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.15 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'duration',
          resource: 'gb-seconds',
          unit: 'gb-second',
          allowancePool: 'do-paid-duration',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 12.5 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'rows-read',
          resource: 'rows-read',
          unit: 'row',
          allowancePool: 'do-paid-rows-read',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.001 },
          sourceIds: ['doPricing'],
        },
        {
          id: 'rows-written',
          resource: 'rows-written',
          unit: 'row',
          allowancePool: 'do-paid-rows-written',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 1 },
          sourceIds: ['doPricing'],
        },
      ],
    },
    {
      id: 'hyperdrive-free',
      service: 'hyperdrive',
      name: 'Hyperdrive（Workers Free）',
      sourceIds: ['hyperdrivePricing'],
      uptimeSla: NO_SELF_SERVE_SLA,
      meters: [
        {
          id: 'queries',
          resource: 'queries',
          unit: 'count',
          allowancePool: 'hyperdrive-free-queries',
          onExceed: 'block',
          premise:
            'Hyperdrive（Workers Free）は 1 日 10 万クエリまで（キャッシュから返したものも数える。超えるとエラー）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['hyperdrivePricing'],
        },
      ],
    },
    {
      id: 'hyperdrive-paid',
      service: 'hyperdrive',
      name: 'Hyperdrive（Workers Paid）',
      sourceIds: ['hyperdrivePricing', 'hyperdriveLimits'],
      uptimeSla: NO_SELF_SERVE_SLA,
      meters: [
        {
          id: 'queries',
          resource: 'queries',
          unit: 'count',
          premise:
            'Hyperdrive は Workers Paid ではクエリ無制限・追加料金なし（接続先の DB の料金は別）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['hyperdrivePricing'],
        },
      ],
      notes: [
        '接続先の DB への接続は 1 設定あたり約 100（Free は約 20）。クエリは 60 秒まで（hyperdriveLimits）',
      ],
    },
  ],
  scheduledChanges: [
    {
      effectiveFrom: '2026-11-04',
      description: 'D1 のクエリ結果の上限 50 MB が施行',
      kind: 'limit',
      notModeledReason:
        '制限の変更で、料金は変わらない。クエリ結果の大きさはこのモデルの計算に入っていない',
      sourceIds: ['d1Limits'],
    },
    {
      effectiveFrom: '2026-12-01',
      description: 'Workers Logs が Cloudflare Observability の料金体系へ移行',
      kind: 'pricing',
      notModeledReason:
        '改定後の料金は未取得のため、このゲームの計算には反映していない（Workers Logs はこのモデルの構成にも入っていない）',
      sourceIds: ['workersPricing'],
    },
  ],
  notes: [
    'Workers の静的アセットへのリクエストは無料・無制限（Workers を起動しないリクエスト）',
    'D1 の読み取り行は返した行ではなく走査した行で数える（インデックスで桁が変わる）',
  ],
};
