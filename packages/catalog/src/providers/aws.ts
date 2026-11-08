// AWS（東京 ap-northeast-1・USD・税抜）。2026-11-01 に取得（prd/11 §1.5・D-50）。
// 単価の一次情報は AWS Price List API（公式の機械可読の料金表）。料金ページは東京の値を表で出さないため。
// 無料枠は常時無料だけ（AX-06: 既存のアカウントを想定。新規の 1 回きりのクレジット・旧来の 12 か月の無料枠は入れない）。
// 確かめられなかった料金は unpriced（料金未取得）で持ち、推測の値は入れない。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-01';
/** ログ（CloudWatch Logs）を確かめた日（D-92）。 */
const LOGS_R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });
/** DB のバックアップ・PITR を確かめた日（D-93）。 */
const BACKUP_R = '2026-11-02';
const backupSrc = (url: string) => ({ url, retrievedAt: BACKUP_R });
/** 確約の割引（リザーブドインスタンス・Savings Plans）を確かめた日（D-97）。 */
const COMMIT_R = '2026-11-02';
const commitSrc = (url: string) => ({ url, retrievedAt: COMMIT_R });
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
      'AWS のアカウントのメンバー（ユーザー）の料金は、読んだ料金表に書かれていません（記載なし）',
    sourceIds: ['freeTier'],
  },
  uptimeSla: {
    status: 'not-stated' as const,
    premise:
      'AWS の稼働率の SLA はサービスごとのページにあり、まだ取得していません（このゲームでは SLA の要件を満たせない扱い）',
    sourceIds: ['freeTier'],
  },
};

/** CloudFront の定額のプランの共通の注記と事実（D-61・2026-11-01 取得）。 */
const FLAT_NOTES = [
  'WAF・DDoS の保護・Route 53・TLS 証明書・CloudFront Functions・ログの取り込みが込み。Lambda@Edge は従量',
  'S3 Standard の保存のクレジット（Free 5 GB・Pro 50 GB・Business 1 TB・Premium 5 TB）は数えていません（費用は高めの側）',
  '1 プランは 1 distribution です。Free は 1 アカウントで 3 つまでです。このモデルは CloudFront を 1 つの distribution にまとめます',
  '東京での違いの記述は見当たりません（未確認）',
];
const FLAT_FACTS = [
  {
    id: 'flat-overage',
    premise:
      'CloudFront の定額のプランは込みの量を超えても追加の請求はありません。ただし超えた状態が 2〜3 か月以上続くと、より少ない・遠いサーバーから配るなど性能が調整されることがあります（最初の月の 3 倍までの急増は影響しない）',
    sourceIds: ['cloudfrontFlatDocs'],
  },
  {
    id: 'flat-no-discount',
    premise:
      'CloudFront の定額のプランは他の割引・オファー（従量の常時無料など）と併用できません',
    sourceIds: ['cloudfrontFlat'],
  },
  {
    id: 'flat-amplify-origin',
    premise:
      '定額のプランの CloudFront のオリジンとして公式に挙がっているのは S3・ALB・API Gateway などです。Amplify をオリジンにする構成は公式に未確認です',
    sourceIds: ['cloudfrontFlatDocs'],
  },
];

/**
 * 定額のプランのキャッシュの無効化（D-66）。機能の表に「Fast cache invalidations」が全段で挙がり、プランが覆う費用に
 * 「Your CloudFront distribution」とある。無効化を別に請求するとは書かれていないので込み（$0）と読む。
 */
const FLAT_INVALIDATION: PriceBookInput['plans'][number]['meters'][number] = {
  id: 'invalidation-paths',
  label: 'キャッシュの無効化（CloudFront: invalidation paths）',
  resource: 'invalidation-paths',
  unit: 'count',
  interpretation: {
    adopted:
      '定額のプランでは無効化も込み（$0）とみなします。機能の表に全段で「Fast cache invalidations」があり、プランが覆う費用に「Your CloudFront distribution」とあります',
    rejected: [
      {
        reading: '従量と同じく月 1,000 パスを超えた分は 1 パス $0.005',
        reason:
          '定額のプランの文書・料金ページに無効化の料金の記述が無く、超過の請求は無いと書かれています',
      },
    ],
  },
  pricing: { model: 'flat', per: 1, unitPrice: 0 },
  sourceIds: ['cloudfrontFlatDocs'],
};

/**
 * CloudWatch Logs の取り込み（東京・Standard。D-92）。Lambda・Amplify の SSR は既定でログを CloudWatch Logs に送り、ロググループの保持は
 * 既定で無期限。保存（$0.033 / GB 月・圧縮後）は数えない: 取り込みの $0.76 / GB に比べて、無期限のまま 12 か月ためても圧縮（AWS の
 * 計算機の仮定は 15%）で 1 か月の取り込みの 1 割に届かないため、保持の部品は作らず前提の文だけにする。
 */
const CLOUDWATCH_LOGS_INTERPRETATION = {
  adopted:
    '取り込み（$0.76 / GB）だけを数え、保存（$0.033 / GB 月）は数えません。保持は既定で無期限ですが、保存は圧縮後の量で、12 か月ためても取り込みの 1 割に届きません（高めに見ても小さい）',
  rejected: [
    {
      reading: '保持の設定（1 か月 / 無期限）を部品の選択肢にする',
      reason:
        '効きが小さく、部品を増やすほどの差になりません（無期限で 12 か月目に取り込みの約 8%）',
    },
  ],
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
    amplifyCaching: src(
      'https://docs.aws.amazon.com/amplify/latest/userguide/caching.html',
    ),
    amplifyCacheControl: src(
      'https://docs.aws.amazon.com/amplify/latest/userguide/Using-headers-to-control-cache-duration.html',
    ),
    amplifySpec: src(
      'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html',
    ),
    amplifyNext: src(
      'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html',
    ),
    lambdaPrices: priceList('AWSLambda'),
    lambdaPricing: src('https://aws.amazon.com/lambda/pricing/'),
    lambdaUrls: src(
      'https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html',
    ),
    opennextAws: src('https://opennext.js.org/aws'),
    opennextArch: src(
      'https://opennext.js.org/aws/inner_workings/architecture',
    ),
    opennextServer: src(
      'https://opennext.js.org/aws/inner_workings/components/server/node',
    ),
    opennextCaching: src('https://opennext.js.org/aws/inner_workings/caching'),
    opennextCdnInvalidation: src(
      'https://opennext.js.org/aws/config/overrides/automatic_cdn_invalidation',
    ),
    opennextWarming: src(
      'https://opennext.js.org/aws/v2/inner_workings/warming',
    ),
    sstNextjs: src('https://sst.dev/docs/component/aws/nextjs/'),
    opennextImage: src(
      'https://opennext.js.org/aws/inner_workings/components/image_optimization',
    ),
    apiGatewayPrices: priceList('AmazonApiGateway'),
    apiGatewayPricing: src('https://aws.amazon.com/api-gateway/pricing/'),
    cloudfrontPrices: src(
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json',
    ),
    cloudfrontFlat: src('https://aws.amazon.com/cloudfront/pricing/'),
    cloudfrontFlatDocs: src(
      'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html',
    ),
    // 定額 Premium（2026-11-03 取得。D-110）
    cloudfrontFlatPremium: {
      url: 'https://aws.amazon.com/cloudfront/pricing/',
      retrievedAt: '2026-11-03',
    },
    cloudfrontFlatPremiumDocs: {
      url: 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html',
      retrievedAt: '2026-11-03',
    },
    cloudfrontFlatBlog: src(
      'https://aws.amazon.com/blogs/networking-and-content-delivery/introducing-flat-rate-pricing-plans-with-no-overages',
    ),
    cloudfrontFree: src(
      'https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/',
    ),
    cloudfrontInvalidation: src(
      'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PayingForInvalidation.html',
    ),
    s3Prices: priceList('AmazonS3'),
    dataTransferPrices: priceList('AWSDataTransfer'),
    dynamodbPrices: priceList('AmazonDynamoDB'),
    dynamodbUnits: src(
      'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/read-write-operations.html',
    ),
    rdsPrices: priceList('AmazonRDS'),
    // 確約の割引（2026-11-02 取得。D-97）。版（publicationDate）: AmazonRDS 2026-10-29・AWSComputeSavingsPlan 2026-10-29
    rdsReservedPrices: { ...priceList('AmazonRDS'), retrievedAt: COMMIT_R },
    rdsReserved: commitSrc(
      'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithReservedDBInstances.html',
    ),
    savingsPlanPrices: commitSrc(
      'https://pricing.us-east-1.amazonaws.com/savingsPlan/v1.0/aws/AWSComputeSavingsPlan/current/ap-northeast-1/index.json',
    ),
    savingsPlans: commitSrc(
      'https://docs.aws.amazon.com/savingsplans/latest/userguide/what-is-savings-plans.html',
    ),
    savingsPlansApplying: commitSrc(
      'https://docs.aws.amazon.com/savingsplans/latest/userguide/sp-applying.html',
    ),
    // DB のバックアップ・PITR（2026-11-02 取得。D-93）。版（publicationDate）: AmazonRDS 2026-10-29・AmazonDynamoDB 2026-09-11
    rdsBackupPrices: { ...priceList('AmazonRDS'), retrievedAt: BACKUP_R },
    dynamodbBackupPrices: {
      ...priceList('AmazonDynamoDB'),
      retrievedAt: BACKUP_R,
    },
    rdsBackups: backupSrc(
      'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html',
    ),
    rdsBackupRetention: backupSrc(
      'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html',
    ),
    auroraBackupStorage: backupSrc(
      'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-storage-backup.html',
    ),
    auroraBackups: backupSrc(
      'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Backups.html',
    ),
    dynamodbPitr: backupSrc(
      'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html',
    ),
    dsqlBackup: backupSrc(
      'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/backup-aurora-dsql.html',
    ),
    // gp3 の割り当ての範囲（2026-11-02 取得）
    rdsStorage: {
      url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html',
      retrievedAt: '2026-11-02',
    },
    // 版（publicationDate）: AWSQueueService 2026-09-11
    sqsPrices: priceList('AWSQueueService'),
    sqsPricing: src('https://aws.amazon.com/sqs/pricing/'),
    auroraPricing: src('https://aws.amazon.com/rds/aurora/pricing/'),
    auroraAutoPause: src(
      'https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html',
    ),
    // 版（publicationDate）: AuroraDSQL 2026-09-11
    dsqlPrices: priceList('AuroraDSQL'),
    dsqlPricing: src('https://aws.amazon.com/rds/aurora/dsql/pricing/'),
    dsqlCompat: src(
      'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html',
    ),
    // CloudWatch Logs（2026-11-02 取得。D-92）。版（publicationDate）: AmazonCloudWatch 2026-10-07
    cloudwatchPrices: { ...priceList('AmazonCloudWatch'), retrievedAt: LOGS_R },
    cloudwatchPricing: {
      url: 'https://aws.amazon.com/cloudwatch/pricing/',
      retrievedAt: LOGS_R,
    },
    lambdaLogs: {
      url: 'https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html',
      retrievedAt: LOGS_R,
    },
    lambdaLogsTiered: {
      url: 'https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-cloudwatch-tiered-pricing-additional-destinations-aws-lambda-logs',
      retrievedAt: LOGS_R,
    },
    amplifySsrLogs: {
      url: 'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html',
      retrievedAt: LOGS_R,
    },
    cloudwatchRetention: {
      url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html',
      retrievedAt: LOGS_R,
    },
    apiGatewayLogs: {
      url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html',
      retrievedAt: LOGS_R,
    },
    rdsFree: src('https://aws.amazon.com/rds/free/'),
    freeTier: src('https://aws.amazon.com/free/'),
    // Amazon SES（2026-11-02 取得。D-95。2026-11-03 にプランの体系を再確認。D-110）。Price List API の AmazonSES の版 2026-10-27
    sesPrices: {
      url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/ap-northeast-1/index.json',
      retrievedAt: '2026-11-03',
    },
    sesPricing: {
      url: 'https://aws.amazon.com/ses/pricing/',
      retrievedAt: '2026-11-03',
    },
    // Route 53（2026-11-02 取得。D-96）
    route53Pricing: {
      url: 'https://aws.amazon.com/route53/pricing/',
      retrievedAt: '2026-11-02',
    },
    // データ転送の常時無料（2026-11-01 に原文で確認。D-52）
    ec2DataTransfer: src('https://aws.amazon.com/ec2/pricing/on-demand/'),
    // DB（DynamoDB・Aurora）から別の事業者（Vercel の関数）への応答の転送（2026-11-03 に原文で確認。D-114 段 2）。
    // DynamoDB・Aurora の料金ページに外への転送の単価の表は無く、AWS 共通の Data Transfer Out（AWSDataTransfer の版 2026-09-16）の適用と読む
    dynamodbTransfer: {
      url: 'https://aws.amazon.com/dynamodb/pricing/on-demand/',
      retrievedAt: '2026-11-03',
    },
    auroraTransfer: {
      url: 'https://aws.amazon.com/rds/aurora/pricing/',
      retrievedAt: '2026-11-03',
    },
    dataTransferPricesDb: {
      url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
      retrievedAt: '2026-11-03',
    },
    // Vercel の関数の地域（既定は iad1）と Marketplace のストレージ（2026-11-03 取得。D-114 段 2。同じリージョンの扱いが未確認であることの根拠）
    vercelRegions: {
      url: 'https://vercel.com/docs/regions',
      retrievedAt: '2026-11-03',
    },
    vercelMarketplaceStorage: {
      url: 'https://vercel.com/docs/marketplace-storage',
      retrievedAt: '2026-11-03',
    },
    ec2DataTransferDb: {
      url: 'https://aws.amazon.com/ec2/pricing/on-demand/',
      retrievedAt: '2026-11-03',
    },
    // AWS の外の事業者（Cloudflare の Worker・Hyperdrive）から AWS の DB を使う形（2026-11-04 取得。D-114 段 2b）
    rdsTransfer: {
      url: 'https://aws.amazon.com/rds/postgresql/pricing/',
      retrievedAt: '2026-11-04',
    },
    dynamodbApi: {
      url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.LowLevelAPI.html',
      retrievedAt: '2026-11-04',
    },
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
      id: 'cloudfront-free-invalidations',
      quantity: 1_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront（従量の料金）のキャッシュの無効化は月 1,000 パスまで無料（アカウントのすべての distribution の合計）。以降は 1 パス $0.005 です。ワイルドカード（/images/*）は 1 パスと数えます',
      sourceIds: ['cloudfrontInvalidation', 'cloudfrontPrices'],
    },
    {
      id: 'sqs-free-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise: 'SQS は月 100 万リクエストまで無料（全リージョンの合計）',
      sourceIds: ['sqsPrices', 'sqsPricing'],
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
    {
      id: 'dsql-free-dpu',
      quantity: 100_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      premise: 'Aurora DSQL は月 10 万 DPU まで無料（常時無料）',
      sourceIds: ['dsqlPrices', 'dsqlPricing', 'rdsFree'],
    },
    {
      id: 'dsql-free-storage',
      quantity: 1,
      unit: 'gb-month',
      period: 'month',
      scope: 'account',
      premise: 'Aurora DSQL は保存 1 GB 月まで無料（常時無料）',
      sourceIds: ['dsqlPrices', 'dsqlPricing', 'rdsFree'],
    },
    // CloudFront の定額のプラン（D-61）。1 プラン = 1 distribution。このモデルは AWS の構成の CloudFront を 1 つの distribution にまとめる
    {
      id: 'flat-free-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Free（月 $0）はリクエストが月 100 万 まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-free-transfer',
      quantity: 100,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Free（月 $0）は転送が月 100 GB まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-pro-requests',
      quantity: 10_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Pro（月 $15）はリクエストが月 1,000 万 まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-pro-transfer',
      quantity: 51_200,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Pro（月 $15）は転送が月 50 TB まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-business-requests',
      quantity: 125_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Business（月 $200）はリクエストが月 1 億 2,500 万 まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-business-transfer',
      quantity: 51_200,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Business（月 $200）は転送が月 50 TB まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs'],
    },
    {
      id: 'flat-premium-requests',
      quantity: 500_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Premium（月 $1,000）はリクエストが月 5 億 まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlatPremium', 'cloudfrontFlatPremiumDocs'],
    },
    {
      id: 'flat-premium-transfer',
      quantity: 51_200,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudFront の定額 Premium（月 $1,000）は転送が月 50 TB まで込みです。超えても請求は増えませんが、超えた状態が続くと配信の性能が調整されることがあります',
      sourceIds: ['cloudfrontFlatPremium', 'cloudfrontFlatPremiumDocs'],
    },
    {
      id: 'cloudwatch-free-logs',
      quantity: 5,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'CloudWatch Logs は月 5 GB まで常時無料（取り込み・保存・Logs Insights の走査の合計。このモデルは取り込みだけに当てます）',
      sourceIds: ['cloudwatchPricing', 'cloudwatchPrices'],
    },
    // インターネットへの転送の常時無料（全サービス・全リージョンの合計。CloudFront の 1 TB とは別）。
    // 他の事業者（Cloudflare R2）へ書き込む転送に使う（D-52）
    {
      id: 'internet-free-transfer',
      quantity: 100,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'AWS からインターネットへの転送は月 100 GB まで無料（全サービス・全リージョンの合計）',
      sourceIds: ['ec2DataTransfer'],
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
        'ビルドの時間（$0.01 / 分・標準）と CDN に置いたファイルの保存（$0.023/GB 月）はこのモデルでは数えません',
        'Amplify Hosting の無料枠（ビルド 1,000 分・配信 15 GB・SSR 50 万リクエスト・100 GB 時間など）は「Free for 12 months」の旧来の無料枠なので入れません（AX-06）',
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
            'Amplify Hosting は Next.js の更新で消す ISR（On-demand。即時反映）・ストリーミング・Edge のミドルウェアに対応していません',
          sourceIds: ['amplifyNext'],
        },
        {
          id: 'cache-control',
          premise:
            'Amplify の CDN（Amplify が管理する CloudFront）は SSR の応答の Cache-Control（s-maxage）に従います。既定では SSR の応答をキャッシュせず（0 秒）、静的なファイルは 1 年です',
          sourceIds: ['amplifyCaching', 'amplifyCacheControl'],
        },
        {
          id: 'front-cloudfront',
          premise:
            'Amplify の前に自前の CloudFront を置く手順は Amplify の利用者ガイドにありません（AWS の Prescriptive Guidance のパターンと re:Post の回答が根拠）。Amplify は CloudFront の「AWS のオリジンからの取得は無料」の例に挙がっていません',
          interpretation: {
            adopted:
              '自前の CloudFront の外れた分（Amplify への取得）は Amplify の配信（$0.15/GB served）として課金されるとみなします（高めの側の読み）',
            rejected: [
              {
                reading: 'AWS のオリジンとして Amplify からの取得も無料',
                reason:
                  'CloudFront の料金ページの無料の例は S3・EC2・ELB などで、Amplify は挙がっていません',
              },
            ],
          },
          sourceIds: ['cloudfrontFree', 'amplifyPricing'],
        },
        {
          // Next.js のサーバーから別の事業者の API を呼ぶ形（F-14・D-67。2026-11-02 に原文で確認）
          id: 'ssr-outbound',
          premise:
            'Amplify Hosting の料金ページの課金の項目（ビルド・保存・配信の転送・SSR のリクエストと時間）に、SSR から外の API への通信の転送はありません（配信の転送は閲覧者へ配った量）。このゲームでは数えません（未確認）',
          sourceIds: ['amplifyPricing'],
        },
        {
          id: 'transfer-not-cloudfront',
          premise:
            'Amplify Hosting の配信は自前の料金（$0.15/GB）で数え、CloudFront の常時無料（月 1 TB）はここには当てていません（Amplify の料金表は別の行。推測）',
          sourceIds: ['amplifyPricing', 'cloudfrontFree'],
        },
      ],
      meters: [
        {
          id: 'amplify-transfer-out',
          label: '配信の転送（Amplify Hosting: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          premise: 'Amplify Hosting の配信の転送は $0.15/GB（無料の量なし）',
          pricing: { model: 'flat', per: 1, unitPrice: 0.15 },
          sourceIds: ['amplifyPrices', 'amplifyPricing'],
        },
        {
          id: 'ssr-requests',
          label: 'SSR のリクエスト（Amplify Hosting: SSR requests）',
          resource: 'invocations',
          unit: 'request',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.3 },
          sourceIds: ['amplifyPrices'],
        },
        {
          id: 'ssr-duration',
          label: 'SSR の実行時間（Amplify Hosting: SSR duration）',
          resource: 'memory-gb-hours',
          unit: 'gb-hour',
          pricing: { model: 'flat', per: 1, unitPrice: 0.2 },
          sourceIds: ['amplifyPrices'],
        },
        {
          id: 'image-optimization',
          label: '画像の変換（Amplify Hosting: image optimization）',
          resource: 'image-transformations',
          unit: 'count',
          pricing: {
            model: 'unpriced',
            note: '画像の最適化は Compute とは別の仕組み（デプロイの仕様の ImageOptimization）で、料金表に専用の行が無く、Compute の料金に含まれるかも書かれていません（2026-11-01 確認）',
          },
          sourceIds: ['amplifyPrices', 'amplifyPricing', 'amplifySpec'],
        },
        {
          id: 'logs',
          label: 'ログの取り込み（CloudWatch Logs: SSR のログ）',
          resource: 'log-gb',
          unit: 'gb',
          allowancePool: 'cloudwatch-free-logs',
          premise:
            'Amplify は SSR の実行の情報を自分のアカウントの CloudWatch Logs に送ります（自動で作るサービスロールに権限が入っている）。取り込みは $0.76 / GB です（東京・Standard）。保持は既定で無期限です',
          interpretation: CLOUDWATCH_LOGS_INTERPRETATION,
          pricing: { model: 'flat', per: 1, unitPrice: 0.76 },
          sourceIds: [
            'cloudwatchPrices',
            'amplifySsrLogs',
            'cloudwatchRetention',
          ],
        },
      ],
    },
    {
      id: 'lambda',
      service: 'lambda',
      ...common,
      name: 'Lambda（x86）',
      sourceIds: ['lambdaPrices', 'lambdaPricing'],
      facts: [
        {
          id: 'opennext-isr',
          premise:
            'OpenNext（AWS）の ISR は、キャッシュを S3、タグを DynamoDB に置き、時間の再検証は SQS（FIFO）の待ち行列から作り直します。更新で消す再検証（revalidatePath・revalidateTag）にも対応しますが、CloudFront のキャッシュは別に無効化が要ります（自動の無効化は既定で無効です。有効にすると再検証したページごとにページとそのデータのルートの 2 パスを無効化します。無効化は月 1,000 パスまで無料・以降 1 パス $0.005 です）',
          sourceIds: [
            'opennextServer',
            'opennextCaching',
            'opennextCdnInvalidation',
            'cloudfrontInvalidation',
          ],
        },
        {
          id: 'opennext-versions',
          premise:
            'OpenNext の AWS 向け（V3）は Next.js 15 の機能に対応することを目指しています。インフラは作りません（SST などで自分で組み、保守も自分で行う）',
          sourceIds: ['opennextAws', 'opennextArch'],
        },
        {
          id: 'function-url',
          premise:
            'Lambda の関数 URL に専用の料金の行は無く、Lambda のリクエストと実行時間だけで数えています（追加の料金が無いとは明記されていない）',
          sourceIds: ['lambdaPrices', 'lambdaUrls'],
        },
      ],
      commitments: [
        {
          id: 'compute-savings-plan',
          label: 'Compute Savings Plans（Lambda: duration・1 年）',
          kind: 'spend',
          termMonths: 12,
          meterIds: ['compute'],
          // 東京の x86 の duration の Savings Plans の単価（Price List: APN1-Lambda-GB-Second）と、オンデマンド $0.0000166667 の比
          payments: [
            // 1 年・前払いなし $0.000015 / GB 秒 → 1 − 0.000015 / 0.0000166667 = 10.0%
            { payment: 'no-upfront', discount: 0.1 },
            // 1 年・全額前払い $0.0000142 / GB 秒 → 1 − 0.0000142 / 0.0000166667 = 14.8%
            { payment: 'all-upfront', discount: 0.148 },
          ],
          premise:
            'Compute Savings Plans は 1 時間あたりの額を 1 年（または 3 年）確約し、確約の額までの Lambda の実行時間（duration）を割り引きます（東京の x86: 前払いなし $0.000015・全額前払い $0.0000142 / GB 秒。オンデマンド $0.0000166667）。リクエストの料金は割り引きません（$0.20 / 100 万のまま）。確約を超えた分はオンデマンドの単価、使わなかった確約も払います（その時間の確約は持ち越せない）',
          interpretation: {
            adopted:
              '確約の額は月の平均の使用（無料枠を引いた後のオンデマンドの額）で比べ、時間ごとの使用の揺れ（ピークの時間帯は確約を超え、夜は余る）は数えません',
            rejected: [
              {
                reading: '時間帯ごとの使用に確約を当てる',
                reason:
                  '明細の金額は月の合計だけで、時間帯ごとの内訳を持ちません。月の平均で当てると、時間ごとの余りの分だけ割引を大きく見ます（残した点）',
              },
            ],
          },
          sourceIds: [
            'savingsPlanPrices',
            'savingsPlans',
            'savingsPlansApplying',
          ],
        },
      ],
      meters: [
        {
          id: 'requests',
          label: '関数の呼び出し（Lambda: requests）',
          resource: 'invocations',
          unit: 'request',
          allowancePool: 'lambda-free-requests',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.2 },
          sourceIds: ['lambdaPrices'],
        },
        {
          id: 'compute',
          label: '関数の実行時間（Lambda: duration）',
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
        {
          id: 'logs',
          label: 'ログの取り込み（CloudWatch Logs: Lambda のログ）',
          resource: 'log-gb',
          unit: 'gb',
          allowancePool: 'cloudwatch-free-logs',
          premise:
            'Lambda は既定で実行ごとのログ（START・END・REPORT の行とアプリの出力）を CloudWatch Logs に送り、取り込みは $0.76 / GB です（東京・Lambda のログは量の段階つき。10 TB まで同じ単価）。ロググループの保持は既定で無期限です',
          interpretation: CLOUDWATCH_LOGS_INTERPRETATION,
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 10_240, unitPrice: 0.76 },
              { upTo: 30_720, unitPrice: 0.38 },
              { upTo: 51_200, unitPrice: 0.152 },
              { upTo: null, unitPrice: 0.076 },
            ],
          },
          sourceIds: [
            'cloudwatchPrices',
            'lambdaLogs',
            'lambdaLogsTiered',
            'cloudwatchRetention',
          ],
        },
      ],
    },
    {
      id: 'api-gateway-http',
      service: 'api-gateway',
      ...common,
      name: 'API Gateway（HTTP API）',
      sourceIds: ['apiGatewayPrices', 'apiGatewayPricing', 'apiGatewayLogs'],
      notes: [
        'HTTP API は 512 KB ごとに 1 リクエストとして数えます（料金ページの例 2 が 4.5 MB のペイロードを 512 KB で割っている）',
        'HTTP API のアクセスログは既定で無効（ステージごとに CloudWatch Logs のロググループを指定して有効にする）ので、ログの取り込みは数えません（D-92）',
      ],
      meters: [
        {
          id: 'requests',
          label: 'API のリクエスト（API Gateway: HTTP API requests）',
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
        '定額のプラン（Free・Pro・Business）はプランに含まれる分を超えたときの挙動が未確認なので扱いません（AX-07）',
        '転送・リクエストの単価は日本のサーバーの値（閲覧者が日本にいる前提）',
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
          label: 'CDN のリクエスト（CloudFront: HTTPS requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'cloudfront-free-requests',
          pricing: { model: 'flat', per: 10_000, unitPrice: 0.012 },
          sourceIds: ['cloudfrontPrices'],
        },
        {
          id: 'cloudfront-transfer-out',
          label: 'CDN の転送（CloudFront: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'cloudfront-free-transfer',
          interpretation: {
            adopted:
              '1 TB は 1,024 GB とみなします（料金表の段が 10 TB = 10,240 GB で区切られているのに合わせる）',
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
          label:
            'CDN からオリジンへの転送（CloudFront: data transfer to origin）',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFree'],
        },
        {
          id: 'invalidation-paths',
          label: 'キャッシュの無効化（CloudFront: invalidation paths）',
          resource: 'invalidation-paths',
          unit: 'count',
          allowancePool: 'cloudfront-free-invalidations',
          pricing: { model: 'flat', per: 1, unitPrice: 0.005 },
          sourceIds: ['cloudfrontInvalidation', 'cloudfrontPrices'],
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
          label: 'ファイルの保存量（S3 Standard: storage）',
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
          label: 'ファイルの書き込み（S3: PUT requests）',
          resource: 'object-writes',
          unit: 'operation',
          pricing: { model: 'flat', per: 1000, unitPrice: 0.0047 },
          sourceIds: ['s3Prices'],
        },
        {
          id: 'get-requests',
          label: 'ファイルの読み取り（S3: GET requests）',
          resource: 'object-reads',
          unit: 'operation',
          pricing: { model: 'flat', per: 10_000, unitPrice: 0.0037 },
          sourceIds: ['s3Prices'],
        },
        {
          id: 'transfer-to-cloudfront',
          label: 'S3 から CDN への転送（S3: data transfer to CloudFront）',
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
      name: 'DynamoDB（リクエスト課金・標準）',
      sourceIds: ['dynamodbPrices', 'dynamodbUnits'],
      facts: [
        {
          id: 'request-units',
          premise:
            'DynamoDB の読み取りは 4 KB ごとに 1 単位（結果整合なら半分）、書き込みは 1 KB ごとに 1 単位で課金されます（RDB ではないので、複雑な検索や集計はアプリの側で工夫が要る）',
          sourceIds: ['dynamodbUnits'],
        },
      ],
      meters: [
        {
          id: 'read-request-units',
          label: 'DB の読み取り（DynamoDB: read request units）',
          resource: 'read-request-units',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.1425 },
          sourceIds: ['dynamodbPrices'],
        },
        {
          id: 'write-request-units',
          label: 'DB の書き込み（DynamoDB: write request units）',
          resource: 'write-request-units',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.715 },
          sourceIds: ['dynamodbPrices'],
        },
        {
          id: 'storage',
          label: 'DB の保存量（DynamoDB: storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'dynamodb-free-storage',
          pricing: { model: 'flat', per: 1, unitPrice: 0.285 },
          sourceIds: ['dynamodbPrices'],
        },
        {
          id: 'pitr',
          label: 'PITR（DynamoDB: continuous backups）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          premise:
            'DynamoDB の PITR（任意の時点への復元）は既定で無効です。有効にすると、復元の期間（1〜35 日。既定 35 日）によらず、テーブルの大きさ（GB 月）に $0.228 で課金します（東京）',
          pricing: { model: 'flat', per: 1, unitPrice: 0.228 },
          sourceIds: ['dynamodbBackupPrices', 'dynamodbPitr'],
        },
      ],
    },
    {
      id: 'rds-postgres-t4g-micro',
      service: 'rds',
      ...common,
      name: 'RDS for PostgreSQL（db.t4g.micro・Single-AZ）',
      sourceIds: ['rdsPrices', 'rdsStorage'],
      commitments: [
        {
          id: 'reserved-instance',
          label: 'リザーブドインスタンス（RDS: db.t4g.micro・1 年）',
          kind: 'instance',
          termMonths: 12,
          meterIds: ['instance'],
          payments: [
            { payment: 'no-upfront', hourly: 0.0197 },
            { payment: 'all-upfront', upfront: 161 },
          ],
          premise:
            'RDS のリザーブドインスタンス（db.t4g.micro・PostgreSQL・Single-AZ・東京・1 年）は、前払いなしで 1 時間 $0.0197（オンデマンド $0.025）、全額前払いで $161 です（期間中の時間の料金なし）。同じ種類のインスタンスの時間の料金だけを割り引き、ストレージ・バックアップには効きません。取り消せず、使わなくても期間中は課金されます',
          sourceIds: ['rdsReservedPrices', 'rdsReserved'],
        },
      ],
      notes: [
        'ストレージ（gp3）は割り当てた容量で課金され、PostgreSQL の gp3 は 20 GiB からです（RDS の利用者ガイド）。このモデルは DB の大きさで近似し、20 GiB に満たない DB は 20 GiB で数えます（最小の課金量。D-85）。20 GiB を超えた分は割り当てを DB の大きさに合わせて増やすとみなします',
        'アプリ（Amplify・Lambda）と RDS の間の転送の料金は未確認なので数えません',
      ],
      meters: [
        {
          id: 'instance',
          label: 'DB のサーバーの稼働（RDS: instance hours）',
          resource: 'instance-hours',
          unit: 'hour',
          premise:
            'RDS のインスタンスは時間課金で、使われていなくても動いている間は課金されます',
          pricing: { model: 'flat', per: 1, unitPrice: 0.025 },
          sourceIds: ['rdsPrices'],
        },
        {
          id: 'storage',
          label: 'DB のディスク（RDS: storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          // PostgreSQL の gp3 の割り当ては 20 GiB から（CHAP_Storage・2026-11-02 取得。D-84・D-85）
          minimumQuantity: 20,
          premise:
            'RDS for PostgreSQL の gp3 は 20 GiB から割り当てるので、DB が小さくても 20 GiB 分の保存が課金されます',
          pricing: { model: 'flat', per: 1, unitPrice: 0.138 },
          sourceIds: ['rdsPrices', 'rdsStorage'],
        },
        {
          id: 'backup',
          label: 'バックアップの保存（RDS: backup storage）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          premise:
            'RDS の自動バックアップは、リージョンの割り当てた DB の容量の合計と同じ量まで無料で、超えた分が $0.095 / GB 月です（東京）。最初のスナップショットは DB 全体、以降は差分で、保持の期間（0〜35 日。コンソールの既定 7 日・API の既定 1 日）の任意の時点に戻せます',
          interpretation: {
            adopted:
              'コンソールで作った既定の 7 日とみます。無料の分（割り当て = max(DB の大きさ, 20 GiB)）を引いた量だけをこのメーターに渡します',
            rejected: [
              {
                reading: 'API・CLI の既定の 1 日とみる',
                reason:
                  '自分で 1 台を立てるならコンソールで作ることが多いとみました（1 日でも無料の分に収まり、費用は同じ 0）',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.095 },
          sourceIds: ['rdsBackupPrices', 'rdsBackups', 'rdsBackupRetention'],
        },
      ],
    },
    {
      ...common,
      id: 'aurora-serverless-v2-io',
      service: 'aurora',
      name: 'Aurora PostgreSQL Serverless v2（I/O-Optimized）',
      sourceIds: ['rdsPrices', 'auroraPricing'],
      notes: [
        'I/O-Optimized を選んだのは、読み書きの I/O に課金されず、1 件あたりの I/O の数という確かめられない量に依らないためです（標準は I/O が $0.24 / 100 万）',
        'ACU は負荷に応じて伸縮しますが、このモデルは最小の容量で動くとみなします（伸びた分は数えない）',
      ],
      facts: [
        {
          id: 'io-optimized',
          premise:
            'Aurora I/O-Optimized は読み書きの I/O に課金されません（インスタンスと保存だけ）。I/O の費用が全体の 25% を超えるなら I/O-Optimized が得とされます',
          sourceIds: ['auroraPricing'],
        },
        {
          id: 'auto-pause',
          premise:
            'Aurora Serverless v2 は最小の容量を 0 ACU にすると、ユーザーの接続が指定の時間（最短 300 秒）無いときに止まり、止まっている間はインスタンスの料金がかかりません。再開はふつう約 15 秒です（24 時間を超えて止まると 30 秒以上）。RDS Proxy を付けると止まりません',
          sourceIds: ['auroraAutoPause'],
        },
      ],
      meters: [
        {
          id: 'acu',
          label: 'DB の処理能力（Aurora Serverless v2: ACU hours）',
          resource: 'instance-hours',
          unit: 'hour',
          premise:
            'Aurora Serverless v2 は ACU の時間で課金され、動いている間は使われていなくても最小の容量の分がかかります',
          pricing: { model: 'flat', per: 1, unitPrice: 0.2 },
          sourceIds: ['rdsPrices'],
        },
        {
          id: 'storage',
          label: 'DB の保存量（Aurora: storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: { model: 'flat', per: 1, unitPrice: 0.27 },
          sourceIds: ['rdsPrices'],
        },
        {
          id: 'backup',
          label: 'バックアップの保存（Aurora: backup storage）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          premise:
            'Aurora の自動バックアップは常に有効（止められない）で、保持の既定は 1 日です（1〜35 日）。保持 1 日なら課金されず、延ばすとクラスターの大きさまでは無料、超えた分が $0.023 / GB 月です（東京）。保持の期間の任意の時点に戻せます',
          pricing: { model: 'flat', per: 1, unitPrice: 0.023 },
          sourceIds: [
            'rdsBackupPrices',
            'auroraBackupStorage',
            'auroraBackups',
          ],
        },
      ],
    },
    {
      ...common,
      id: 'aurora-dsql',
      service: 'aurora-dsql',
      name: 'Aurora DSQL',
      sourceIds: ['dsqlPrices', 'dsqlPricing', 'dsqlBackup'],
      notes: [
        'DPU は SQL の処理（ComputeDPU）と保存の読み書き（ReadDPU・WriteDPU）の量です。1 件あたりの DPU は公式に書かれていません',
        'バックアップは AWS Backup の全体のバックアップ（$0.12 / GB 月）として文書にあり、任意の時点への復元（PITR）の記載は見当たりません（2026-11-02 確認。PITR の要件は満たさないとみて、バックアップの部品は作りません。D-93）',
      ],
      facts: [
        {
          id: 'dpu',
          premise:
            'Aurora DSQL は処理の量（DPU）と保存で課金され、使われていなければ費用は保存だけです。1 件あたりの DPU は公式に書かれておらず、料金ページの例（10 万 DPU ≈ TPC-C 由来の 70 万トランザクション）から 1 件 0.14 DPU と仮定しています',
          sourceIds: ['dsqlPricing'],
        },
        {
          id: 'compat',
          premise:
            'Aurora DSQL は PostgreSQL 互換ですが、一時テーブル・トリガー・PL/pgSQL が無く、1 つのトランザクションで変更できる行は 3,000 までです。分離レベルは Repeatable Read に固定で、競合すると再試行が要ります（楽観的な並行制御）。接続は 1 時間で切れます',
          sourceIds: ['dsqlCompat'],
        },
      ],
      meters: [
        {
          id: 'dpu',
          label: 'DB の処理量（Aurora DSQL: DPU）',
          resource: 'processing-units',
          unit: 'count',
          allowancePool: 'dsql-free-dpu',
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 10 },
          sourceIds: ['dsqlPrices'],
        },
        {
          id: 'storage',
          label: 'DB の保存量（Aurora DSQL: storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'dsql-free-storage',
          pricing: { model: 'flat', per: 1, unitPrice: 0.4 },
          sourceIds: ['dsqlPrices'],
        },
      ],
    },
    {
      ...common,
      id: 'cloudfront-flat-free',
      service: 'cloudfront',
      name: 'CloudFront 定額 Free',
      baseFee: {
        label: '定額料金（CloudFront flat-rate: Free）',
        amount: 0,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs', 'cloudfrontFlatBlog'],
      notes: FLAT_NOTES,
      facts: FLAT_FACTS,
      meters: [
        {
          id: 'https-requests',
          label: 'CDN のリクエスト（CloudFront: HTTPS requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'flat-free-requests',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'cloudfront-transfer-out',
          label: 'CDN の転送（CloudFront: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'flat-free-transfer',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'origin-fetch',
          label:
            'CDN からオリジンへの転送（CloudFront: data transfer to origin）',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        FLAT_INVALIDATION,
      ],
    },
    {
      ...common,
      id: 'cloudfront-flat-pro',
      service: 'cloudfront',
      name: 'CloudFront 定額 Pro',
      baseFee: {
        label: '定額料金（CloudFront flat-rate: Pro）',
        amount: 15,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs', 'cloudfrontFlatBlog'],
      notes: FLAT_NOTES,
      facts: FLAT_FACTS,
      meters: [
        {
          id: 'https-requests',
          label: 'CDN のリクエスト（CloudFront: HTTPS requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'flat-pro-requests',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'cloudfront-transfer-out',
          label: 'CDN の転送（CloudFront: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'flat-pro-transfer',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'origin-fetch',
          label:
            'CDN からオリジンへの転送（CloudFront: data transfer to origin）',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        FLAT_INVALIDATION,
      ],
    },
    {
      ...common,
      id: 'cloudfront-flat-business',
      service: 'cloudfront',
      name: 'CloudFront 定額 Business',
      baseFee: {
        label: '定額料金（CloudFront flat-rate: Business）',
        amount: 200,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['cloudfrontFlat', 'cloudfrontFlatDocs', 'cloudfrontFlatBlog'],
      notes: FLAT_NOTES,
      facts: FLAT_FACTS,
      meters: [
        {
          id: 'https-requests',
          label: 'CDN のリクエスト（CloudFront: HTTPS requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'flat-business-requests',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'cloudfront-transfer-out',
          label: 'CDN の転送（CloudFront: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'flat-business-transfer',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        {
          id: 'origin-fetch',
          label:
            'CDN からオリジンへの転送（CloudFront: data transfer to origin）',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatDocs'],
        },
        FLAT_INVALIDATION,
      ],
    },
    {
      ...common,
      id: 'cloudfront-flat-premium',
      service: 'cloudfront',
      name: 'CloudFront 定額 Premium',
      baseFee: {
        label: '定額料金（CloudFront flat-rate: Premium）',
        amount: 1000,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['cloudfrontFlatPremium', 'cloudfrontFlatPremiumDocs'],
      notes: [
        ...FLAT_NOTES,
        '込みの量は既定の段（50 TB・5 億リクエスト・月 $1,000）で持ちます。Premium だけは段を上げられます（75 TB・7.5 億 $1,450 〜 600 TB・60 億 $10,000）が、ここでは持ちません。60 億・600 TB を超える Custom は公開の価格が無いので扱いません（D-110）',
      ],
      facts: FLAT_FACTS,
      meters: [
        {
          id: 'https-requests',
          label: 'CDN のリクエスト（CloudFront: HTTPS requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'flat-premium-requests',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatPremiumDocs'],
        },
        {
          id: 'cloudfront-transfer-out',
          label: 'CDN の転送（CloudFront: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'flat-premium-transfer',
          onExceed: 'adjust',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatPremiumDocs'],
        },
        {
          id: 'origin-fetch',
          label:
            'CDN からオリジンへの転送（CloudFront: data transfer to origin）',
          resource: 'origin-transfer-gb',
          unit: 'gb',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['cloudfrontFlatPremiumDocs'],
        },
        FLAT_INVALIDATION,
      ],
    },
    {
      ...common,
      id: 'sqs-fifo',
      service: 'sqs',
      name: 'SQS（FIFO）',
      sourceIds: ['sqsPrices', 'sqsPricing'],
      notes: [
        'すべての操作が 1 リクエスト（64 KB ごと）。OpenNext の再検証の待ち行列はメッセージ 1 件を送信・受信・削除の 3 リクエストと数えます（仮定）',
      ],
      meters: [
        {
          id: 'requests',
          label: 'キューのリクエスト（SQS: FIFO requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'sqs-free-requests',
          pricing: {
            model: 'tiered',
            per: 1_000_000,
            tiers: [
              { upTo: 100_000_000_000, unitPrice: 0.5 },
              { upTo: 200_000_000_000, unitPrice: 0.46 },
              { upTo: null, unitPrice: 0.42 },
            ],
          },
          sourceIds: ['sqsPrices'],
        },
      ],
    },
    // Amazon SES（アプリのメールの送信。D-95・prd/11 §20）
    {
      id: 'ses',
      service: 'ses',
      ...common,
      name: 'Amazon SES（東京）',
      sourceIds: ['sesPrices', 'sesPricing'],
      notes: [
        '添付ファイルは送ったデータ 1 GB $0.12 が別にかかります（通知のメールは添付なしとみなし、数えない）',
        'SES の常時無料の通数はありません（Price List API の無料の行はメールボックスのシミュレーターだけ）。新しいアカウントの Free Tier のクレジットは数えません（AX-06）',
        '2026-07-21 から、新しいアカウント（と 2025-06-01 から送信の無いアカウント）は Essentials のプラン（1,000 通 $0.16）で始まります。プランを選ばずに Essentials になったアカウントは、最初の à la carte への切り替えがすぐ効きます。このモデルは切り替えた後の à la carte で数えます（D-110）',
        'Pro（1,000 通 $0.22 + 月 $105）・Enterprise（$0.23 + 月 $500）は到達率の管理・専用 IP などが込みのプランです。通知のメールには要らないので扱いません',
      ],
      meters: [
        {
          id: 'outbound',
          label: 'メールの送信（Amazon SES: outbound email）',
          resource: 'emails',
          unit: 'count',
          premise:
            'Amazon SES の送信は à la carte で受け取る人 1 人ごとに 1,000 通 $0.10 です（東京も同じ）。月の通数による割引・無料の分はありません',
          interpretation: {
            adopted:
              'à la carte（1,000 通 $0.10・月額なし）で数えます。料金ページに「You can upgrade or switch to à-la-carte pricing at any time」とあり、既定で Essentials になったアカウントの最初の切り替えはすぐ効きます。通知のメールは Essentials の込みの機能（到達率の分析・Mail Manager）を使いません',
            rejected: [
              {
                reading:
                  '新しいアカウントの既定の Essentials（1,000 通 $0.16。1,000 万通を超えた分は $0.14）で数える',
                reason:
                  '既定のプランは誰でもいつでも à la carte に替えられ、替えても失うものが通知のメールではありません。切り替えないのは安い選択を見落とした状態で、費用を合わせる理由になりません',
              },
            ],
          },
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.1 },
          sourceIds: ['sesPrices', 'sesPricing'],
        },
      ],
    },
    // Amazon Route 53（構成の DNS。D-96・prd/11 §21）。グローバルのサービスで、リージョンの差は無い
    {
      id: 'route53',
      service: 'route53',
      ...common,
      name: 'Amazon Route 53（パブリックのホストゾーン）',
      sourceIds: ['route53Pricing'],
      baseFee: {
        label: 'DNS のゾーン（Route 53: hosted zone）',
        amount: 0.5,
        per: 'month',
        scope: 'node',
      },
      facts: [
        {
          id: 'alias-free',
          premise:
            'Route 53 のエイリアスのレコード（CloudFront の distribution・ELB・S3 のウェブサイトのエンドポイントなどを指す）への問い合わせは無料です。このモデルはサイトの名前をエイリアスで CloudFront に向けるとみて、問い合わせを数えません',
          sourceIds: ['route53Pricing'],
        },
      ],
      meters: [
        {
          id: 'queries',
          label: 'DNS の問い合わせ（Route 53: standard queries）',
          resource: 'dns-queries',
          unit: 'count',
          premise:
            'Route 53 の標準の問い合わせは 100 万件 $0.40（月 10 億件まで）、それを超えた分は 100 万件 $0.20',
          pricing: {
            model: 'tiered',
            per: 1_000_000,
            tiers: [
              { upTo: 1_000_000_000, unitPrice: 0.4 },
              { upTo: null, unitPrice: 0.2 },
            ],
          },
          sourceIds: ['route53Pricing'],
        },
      ],
    },
    {
      // 東京からインターネットへの転送（D-52）。Lambda の関数から外（他の事業者の R2）へ送るデータ。
      // Lambda の料金ページ: 関数の外のリージョンとのデータの出入りは EC2 のデータ転送の料金
      id: 'data-transfer-out',
      service: 'data-transfer',
      ...common,
      name: 'データ転送（東京 → インターネット）',
      sourceIds: ['dataTransferPrices', 'lambdaPricing', 'ec2DataTransfer'],
      facts: [
        {
          id: 'lambda-out',
          premise:
            'Lambda の関数がリージョンの外（他の事業者など）とやり取りするデータは、EC2 のデータ転送の料金で課金されます（東京 → インターネットは月 100 GB の無料の後 $0.114/GB から）',
          sourceIds: ['lambdaPricing', 'dataTransferPrices'],
        },
        {
          // SPA の API を AWS に置き、静的は他の事業者から配る形（D-65。2026-11-02 に原文で確認）
          id: 'api-gateway-out',
          premise:
            'API Gateway の HTTP API は、受けた呼び出しと送り出したデータの量で課金されます（「Pay only for the API calls you receive and the amount of data transferred out」）。外へのデータ転送は EC2 のデータ転送の料金です（東京 → インターネットは月 100 GB の無料の後 $0.114/GB から）',
          sourceIds: ['apiGatewayPricing', 'dataTransferPrices'],
        },
        {
          // Vercel の関数から DynamoDB を使う形（D-114 段 2）。2026-11-03 に原文で確認
          id: 'dynamodb-out',
          premise:
            'DynamoDB は受信に課金しません（「DynamoDB does not charge for inbound data transfer」）。外への転送は料金ページに単価の直接の記載が無く、' +
            'AWS 共通の Data Transfer Out（東京 → インターネット $0.114/GB から・全サービス・全リージョン合わせて月 100 GB は無料）の適用と読みました（EC2 の料金ページの 100 GB 無料の適用サービスに DynamoDB が入っている）。' +
            '別の事業者の関数（Vercel）へ返す応答（問い合わせの数 × 応答の大きさ）をこれで数えます。' +
            'Vercel の公式文書は関数の地域を AWS の地域名で示しますが、関数が AWS のどのアカウントで動き、同じリージョンの DB との通信が AWS の「同じリージョン内の AWS サービス間は $0」に当たるかは公式に記載がありません（未確認）。' +
            '同じリージョン（hnd1 と ap-northeast-1）に置けば安くなる可能性があります。Vercel の関数の既定の地域は iad1 です',
          sourceIds: [
            'dynamodbTransfer',
            'dataTransferPricesDb',
            'ec2DataTransferDb',
            'vercelRegions',
            'vercelMarketplaceStorage',
          ],
        },
        {
          // Vercel の関数から Aurora を使う形（D-114 段 2）。2026-11-03 に原文で確認
          id: 'aurora-out',
          premise:
            'Aurora の料金ページは転送を「in」と「out」で数えると書いていますが、インターネットへの単価の表はありません。AWS 共通の Data Transfer Out' +
            '（東京 → インターネット $0.114/GB から・全サービス・全リージョン合わせて月 100 GB は無料。Aurora の料金ページにも記載）の適用と読みました。' +
            '受信の課金は料金ページに記載がありません（未確認・数えない）。別の事業者の関数（Vercel）へ返す応答（問い合わせの数 × 応答の大きさ）をこれで数えます。' +
            'Vercel の公式文書は関数の地域を AWS の地域名で示しますが、関数が AWS のどのアカウントで動き、同じリージョンの DB との通信が AWS の「同じリージョン内の AWS サービス間は $0」に当たるかは公式に記載がありません（未確認）。' +
            '同じリージョン（hnd1 と ap-northeast-1）に置けば安くなる可能性があります。Vercel の関数の既定の地域は iad1 です',
          sourceIds: [
            'auroraTransfer',
            'dataTransferPricesDb',
            'vercelRegions',
            'vercelMarketplaceStorage',
          ],
        },
        {
          // AWS の外の事業者（Cloudflare）から DynamoDB・Aurora・RDS を使う形（D-114 段 2b）。2026-11-04 に原文で確認
          id: 'db-out-internet',
          premise:
            'AWS の外の事業者（Cloudflare の Worker・Hyperdrive）へ DB（DynamoDB・Aurora・RDS）が返す応答は、インターネットへの転送（Data Transfer Out。東京 → インターネット $0.114/GB から・全サービス・全リージョン合わせて月 100 GB は無料）で数えます。' +
            'DynamoDB は受信に課金しません。Aurora・RDS for PostgreSQL の料金ページは転送を「in」と「out」で数えると書いていますが、インターネットへの単価の表は取れず（RDS は畳まれた表で、取得した文に無い）、AWS 共通の単価の適用と読みました。受信の課金は記載がありません（未確認・数えない）。' +
            'DynamoDB の API は署名した HTTP(S) の POST で、AWS の外からも呼べます',
          sourceIds: [
            'dynamodbTransfer',
            'auroraTransfer',
            'rdsTransfer',
            'dynamodbApi',
            'dataTransferPricesDb',
          ],
        },
      ],
      meters: [
        {
          id: 'internet-out',
          label: 'インターネットへの転送（AWS: data transfer out to internet）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'internet-free-transfer',
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 10_240, unitPrice: 0.114 },
              { upTo: 51_200, unitPrice: 0.089 },
              { upTo: 153_600, unitPrice: 0.086 },
              { upTo: null, unitPrice: 0.084 },
            ],
          },
          sourceIds: ['dataTransferPrices'],
        },
      ],
    },
  ],
};
