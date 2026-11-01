// AWS（東京 ap-northeast-1・USD・税抜）。2026-11-01 に取得（prd/11 §1.5・D-50）。
// 単価の一次情報は AWS Price List API（公式の機械可読の料金表）。料金ページは東京の値を表で出さないため。
// 無料枠は常時無料だけ（AX-06: 既存のアカウントを想定。新規の 1 回きりのクレジット・旧来の 12 か月の無料枠は入れない）。
// 確かめられなかった料金は unpriced（料金未取得）で持ち、推測の値は入れない。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-01';
const src = (url: string) => ({ url, retrievedAt: R });
/** Price List API の東京の料金表（版の日付はコメントに残す）。 */
const priceList = (offer: string) =>
  src(
    `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${offer}/current/ap-northeast-1/index.json`,
  );

/** どのプランにも同じ文（AWS はサービスごとのプランに分けて持つ。D-20 V-6・D-24）。 */
const common = {
  members: {
    pricing: 'not-stated' as const,
    premise:
      'AWS のアカウントのメンバー（ユーザー）の料金は、読んだ料金表に書かれていない（記載なし）',
    sourceIds: ['freeTier'],
  },
  uptimeSla: {
    status: 'not-stated' as const,
    premise:
      'AWS の稼働率の SLA はサービスごとのページにあり、まだ取得していない（このゲームでは SLA の要件を満たせない扱い）',
    sourceIds: ['freeTier'],
  },
};

export const aws: PriceBookInput = {
  schemaVersion: 1,
  provider: 'aws',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    // 版（publicationDate）: AWSAmplify 2026-09-11・AWSLambda 2026-10-30・AmazonApiGateway 2026-10-13・
    // AmazonCloudFront 2026-10-19（全体の index）・AmazonS3 2026-10-15・AmazonDynamoDB 2026-09-11・
    // AmazonRDS 2026-10-29・AWSDataTransfer 2026-09-16
    amplifyPrices: priceList('AWSAmplify'),
    amplifyPricing: src('https://aws.amazon.com/amplify/pricing/'),
    amplifyNext: src(
      'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html',
    ),
    lambdaPrices: priceList('AWSLambda'),
    lambdaPricing: src('https://aws.amazon.com/lambda/pricing/'),
    apiGatewayPrices: priceList('AmazonApiGateway'),
    cloudfrontPrices: src(
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json',
    ),
    cloudfrontFree: src(
      'https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/',
    ),
    s3Prices: priceList('AmazonS3'),
    dataTransferPrices: priceList('AWSDataTransfer'),
    dynamodbPrices: priceList('AmazonDynamoDB'),
    dynamodbUnits: src(
      'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html',
    ),
    rdsPrices: priceList('AmazonRDS'),
    freeTier: src('https://aws.amazon.com/free/'),
  },
  allowancePools: [
    {
      id: 'lambda-free-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise: 'Lambda は月 100 万リクエストまで常時無料',
      sourceIds: ['lambdaPricing', 'freeTier'],
    },
    {
      id: 'lambda-free-compute',
      quantity: 400_000,
      unit: 'gb-second',
      period: 'month',
      scope: 'account',
      premise: 'Lambda は月 40 万 GB 秒まで常時無料',
      sourceIds: ['lambdaPricing', 'freeTier'],
    },
    {
      id: 'cloudfront-free-transfer',
      quantity: 1024,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront（従量の料金）はインターネットへの転送が月 1 TB まで常時無料',
      sourceIds: ['cloudfrontFree'],
    },
    {
      id: 'cloudfront-free-requests',
      quantity: 10_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront（従量の料金）は HTTP・HTTPS のリクエストが月 1,000 万まで常時無料',
      sourceIds: ['cloudfrontFree'],
    },
    {
      id: 'dynamodb-free-storage',
      quantity: 25,
      unit: 'gb-month',
      period: 'month',
      scope: 'account',
      premise: 'DynamoDB の保存は 25 GB 月まで無料（東京の料金表の最初の段）',
      sourceIds: ['dynamodbPrices'],
    },
  ],
  plans: [
    {
      id: 'amplify-hosting',
      service: 'amplify',
      ...common,
      name: 'Amplify Hosting',
      sourceIds: ['amplifyPrices', 'amplifyPricing'],
      notes: [
        'ビルドの時間（$0.01 / 分・標準）と CDN に置いたファイルの保存（$0.023/GB 月）はこのモデルでは数えない',
        'Amplify Hosting の無料枠（ビルド 1,000 分・配信 15 GB・SSR 50 万リクエスト・100 GB 時間など）は「Free for 12 months」の旧来の無料枠なので入れない（AX-06）',
      ],
      facts: [
        {
          id: 'next-versions',
          premise:
            'Amplify Hosting が SSR を扱う Next.js は 12〜15（16 の機能は使わない前提）',
          sourceIds: ['amplifyNext'],
        },
        {
          id: 'no-on-demand-isr',
          premise:
            'Amplify Hosting は Next.js のオンデマンド ISR（即時反映）・ストリーミング・Edge のミドルウェアに対応していない',
          sourceIds: ['amplifyNext'],
        },
        {
          id: 'transfer-not-cloudfront',
          premise:
            'Amplify Hosting の配信は自前の料金（$0.15/GB）で数え、CloudFront の常時無料（月 1 TB）はここには当てていない（Amplify の料金表は別の行。推測）',
          sourceIds: ['amplifyPricing', 'cloudfrontFree'],
        },
      ],
      meters: [
        {
          id: 'data-transfer-out',
          resource: 'egress-gb',
          unit: 'gb',
          premise: 'Amplify Hosting の配信の転送は $0.15/GB（無料の量なし）',
          pricing: { model: 'flat', per: 1, unitPrice: 0.15 },
          sourceIds: ['amplifyPrices', 'amplifyPricing'],
        },
        {
          id: 'ssr-requests',
          resource: 'invocations',
          unit: 'request',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.3 },
          sourceIds: ['amplifyPrices'],
        },
        {
          id: 'ssr-duration',
          resource: 'memory-gb-hours',
          unit: 'gb-hour',
          pricing: { model: 'flat', per: 1, unitPrice: 0.2 },
          sourceIds: ['amplifyPrices'],
        },
        {
          id: 'image-optimization',
          resource: 'image-transformations',
          unit: 'count',
          pricing: {
            model: 'unpriced',
            note: '画像の最適化に専用の行が料金表に無い（SSR の計算に含まれるかは未確認）',
          },
          sourceIds: ['amplifyPrices', 'amplifyNext'],
        },
      ],
    },
    {
      id: 'lambda',
      service: 'lambda',
      ...common,
      name: 'Lambda（x86）',
      sourceIds: ['lambdaPrices', 'lambdaPricing'],
      meters: [
        {
          id: 'requests',
          resource: 'invocations',
          unit: 'request',
          allowancePool: 'lambda-free-requests',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.2 },
          sourceIds: ['lambdaPrices'],
        },
        {
          id: 'compute',
          resource: 'memory-gb-hours',
          unit: 'gb-second',
          allowancePool: 'lambda-free-compute',
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 6_000_000_000, unitPrice: 0.0000166667 },
              { upTo: 15_000_000_000, unitPrice: 0.000015 },
              { upTo: null, unitPrice: 0.0000133334 },
            ],
          },
          sourceIds: ['lambdaPrices'],
        },
      ],
    },
    {
      id: 'api-gateway-http',
      service: 'api-gateway',
      ...common,
      name: 'API Gateway（HTTP API）',
      sourceIds: ['apiGatewayPrices'],
      meters: [
        {
          id: 'requests',
          resource: 'requests',
          unit: 'request',
          pricing: {
            model: 'tiered',
            per: 1_000_000,
            tiers: [
              { upTo: 300_000_000, unitPrice: 1.29 },
              { upTo: null, unitPrice: 1.18 },
            ],
          },
          sourceIds: ['apiGatewayPrices'],
        },
      ],
    },
    {
      id: 'cloudfront',
      service: 'cloudfront',
      ...common,
      name: 'CloudFront（従量の料金・日本）',
      sourceIds: ['cloudfrontPrices', 'cloudfrontFree'],
      notes: [
        '定額のプラン（Free・Pro・Business）は込み分を超えたときの挙動が未確認なので扱わない（AX-07）',
        '転送・リクエストの単価は日本の拠点の値（閲覧者が日本にいる前提）',
      ],
      facts: [
        {
          id: 'origin-fetch-free',
          premise:
            'CloudFront が AWS のオリジン（S3 など）から取得する転送は無料',
          sourceIds: ['cloudfrontFree'],
        },
      ],
      meters: [
        {
          id: 'https-requests',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'cloudfront-free-requests',
          pricing: { model: 'flat', per: 10_000, unitPrice: 0.012 },
          sourceIds: ['cloudfrontPrices'],
        },
        {
          id: 'data-transfer-out',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'cloudfront-free-transfer',
          interpretation: {
            adopted:
              '1 TB は 1,024 GB とみなす（料金表の段が 10 TB = 10,240 GB で区切られているのに合わせる）',
            rejected: [
              {
                reading: '1 TB = 1,000 GB',
                reason: '同じ料金表の段の境目が 2 進の数え方',
              },
            ],
          },
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 10_240, unitPrice: 0.114 },
              { upTo: 51_200, unitPrice: 0.089 },
              { upTo: 153_600, unitPrice: 0.086 },
              { upTo: 512_000, unitPrice: 0.084 },
              { upTo: 1_048_576, unitPrice: 0.08 },
              { upTo: 5_242_880, unitPrice: 0.07 },
              { upTo: null, unitPrice: 0.06 },
            ],
          },
          sourceIds: ['cloudfrontPrices'],
        },
        {
          id: 'origin-fetch',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFree'],
        },
      ],
    },
    {
      id: 's3-standard',
      service: 's3',
      ...common,
      name: 'S3 標準',
      sourceIds: ['s3Prices'],
      meters: [
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 51_200, unitPrice: 0.025 },
              { upTo: 512_000, unitPrice: 0.024 },
              { upTo: null, unitPrice: 0.023 },
            ],
          },
          sourceIds: ['s3Prices'],
        },
        {
          id: 'put-requests',
          resource: 'object-writes',
          unit: 'operation',
          pricing: { model: 'flat', per: 1000, unitPrice: 0.0047 },
          sourceIds: ['s3Prices'],
        },
        {
          id: 'get-requests',
          resource: 'object-reads',
          unit: 'operation',
          pricing: { model: 'flat', per: 10_000, unitPrice: 0.0037 },
          sourceIds: ['s3Prices'],
        },
        {
          id: 'transfer-to-cloudfront',
          resource: 'egress-gb',
          unit: 'gb',
          premise: '東京の S3 から CloudFront への転送は $0',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['dataTransferPrices'],
        },
      ],
    },
    {
      id: 'dynamodb-on-demand',
      service: 'dynamodb',
      ...common,
      name: 'DynamoDB（オンデマンド・標準）',
      sourceIds: ['dynamodbPrices', 'dynamodbUnits'],
      facts: [
        {
          id: 'request-units',
          premise:
            'DynamoDB の読み取りは 4 KB ごとに 1 単位（結果整合なら半分）、書き込みは 1 KB ごとに 1 単位で課金される（RDB ではないので、複雑な検索や集計はアプリの側で工夫が要る）',
          sourceIds: ['dynamodbUnits'],
        },
      ],
      meters: [
        {
          id: 'read-request-units',
          resource: 'read-request-units',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.1425 },
          sourceIds: ['dynamodbPrices'],
        },
        {
          id: 'write-request-units',
          resource: 'write-request-units',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.715 },
          sourceIds: ['dynamodbPrices'],
        },
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'dynamodb-free-storage',
          pricing: { model: 'flat', per: 1, unitPrice: 0.285 },
          sourceIds: ['dynamodbPrices'],
        },
      ],
    },
    {
      id: 'rds-postgres-t4g-micro',
      service: 'rds',
      ...common,
      name: 'RDS for PostgreSQL（db.t4g.micro・Single-AZ）',
      sourceIds: ['rdsPrices'],
      notes: [
        'ストレージ（gp3）は割り当てた容量で課金される。このモデルは DB の大きさで近似する（最小の割り当て容量は未確認）',
        'アプリ（Amplify・Lambda）と RDS の間の転送の料金は未確認なので数えない',
      ],
      meters: [
        {
          id: 'instance',
          resource: 'instance-hours',
          unit: 'hour',
          premise:
            'RDS のインスタンスは時間課金で、使われていなくても動いている間は課金される',
          pricing: { model: 'flat', per: 1, unitPrice: 0.025 },
          sourceIds: ['rdsPrices'],
        },
        {
          id: 'storage',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: { model: 'flat', per: 1, unitPrice: 0.138 },
          sourceIds: ['rdsPrices'],
        },
      ],
    },
  ],
};
