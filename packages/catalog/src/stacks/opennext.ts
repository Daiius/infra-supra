// AWS の 2 つ目の構成: OpenNext で Next.js を Lambda + CloudFront + S3 + DynamoDB + SQS に載せる（prd/11 §13・D-63）。
// AX-02 で Amplify を選んだときの対案。インフラは自分で組む（SST など）ので、ゲームでは維持の手間がかかる（仮定）。
// 料金は AWS のもの（providers/aws.ts）を再利用する。Amplify の構成（stacks/aws.ts）の id と経路は変えない。
// 事業者（Platform）は 'aws-opennext' として分ける（部品の選択肢が Amplify と違い、Amplify との行き来はプラン変更でなく乗り換えになるため）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  AWS_COMPONENTS,
  bill,
  cloudfront,
  composeSpa,
  COMPUTE_MEMORY_GB,
  dbNode,
  IMAGE_CDN_HIT_RATE,
  s3,
} from './aws.ts';
import type { Choices, ComponentOption, StackDef } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

export const OPENNEXT_STACK_DEFS: readonly StackDef[] = [
  {
    id: 'aws-opennext',
    platform: 'aws-opennext',
    plan: 'pay-as-you-go',
    name: 'AWS（OpenNext・自分で組む）',
    assembled: true,
  },
];

export const OPENNEXT_DEFAULT_CHOICES: Choices = {
  isrCache: 'default',
  images: 'resize',
  db: 'dynamodb',
  cdnPlan: 'payg',
};

/** 画像の最適化の関数の 1 回の変換の時間（ms。仮定。VPS のホストで変換する時間 imageTransformCpuMs と同じ値）。 */
const IMAGE_TRANSFORM_MS = 150;
/** SQS のメッセージ 1 件を何リクエストと数えるか（送信・受信・削除。仮定）。 */
const SQS_REQUESTS_PER_MESSAGE = 3;

/** Amplify の構成と同じ部品（DB・CDN の料金のプラン・最適化しない / 縮める画像・SPA の部品）を、この事業者の部品として使う。 */
const SHARED = AWS_COMPONENTS.filter(
  (c) =>
    c.slot === 'db' ||
    c.slot === 'cdnPlan' ||
    c.slot === 'ogp' ||
    c.slot === 'apiCache' ||
    (c.slot === 'images' && c.id !== 'default'),
).map((c): ComponentOption => ({
  ...c,
  platform: 'aws-opennext',
  // Amplify の前段に使うときの注記は、この構成には当たらない
  note: c.note.replace('。Amplify の前段に使う構成は公式に未確認', ''),
}));

export const OPENNEXT_COMPONENTS: readonly ComponentOption[] = [
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'aws-opennext',
    label: 'S3 + DynamoDB のタグ + SQS の再検証',
    note: 'ISR のページは CloudFront が返し、外れると関数が S3 のキャッシュと DynamoDB のタグを読む。期限が来たページは SQS の待ち行列から関数が作り直す。オンデマンドの再検証にも対応する（CloudFront の無効化は別に要る）',
    premiseRefs: [
      'fact:aws:lambda:opennext-isr',
      'pool:aws:sqs-fifo:sqs-free-requests',
    ],
    onDemandIsr: { ok: true, fact: 'aws:lambda:opennext-isr' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'aws-opennext',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回 Lambda まで届く（リクエストと GB 秒で課金）。記事は常に新しい',
    premiseRefs: ['pool:aws:lambda:lambda-free-compute'],
    onDemandIsr: { ok: true, fact: 'aws:lambda:opennext-isr' },
  },
  {
    id: 'default',
    slot: 'images',
    frameworks: ['nextjs'],
    platform: 'aws-opennext',
    label: 'OpenNext の画像の最適化（Lambda）',
    note: '/_next/image を画像の最適化の Lambda が受け、S3 の原本から変換する。CloudFront の外れた分だけ変換が走る（1 回 150 ms・1 GB と仮定）',
    premiseRefs: [
      'pool:aws:lambda:lambda-free-compute',
      'pool:aws:cloudfront:cloudfront-free-transfer',
    ],
  },
  ...SHARED,
];

/** OpenNext の構成を部品の選択から組み立てる。SPA では OpenNext を使わず、AWS の SPA と同じ形（S3 + CloudFront + Lambda）。 */
export function composeOpenNext(
  choices: Choices,
  standby: Choices,
  options: { spa: boolean; apiCache: string },
): ArchitectureInput {
  const db = dbNode(choices.db);
  const standbyDb =
    standby.db !== undefined && standby.db !== choices.db
      ? [dbNode(standby.db)]
      : [];
  if (options.spa) {
    const spa = composeSpa(db, standbyDb, choices, options.apiCache);
    return { ...spa, id: 'aws-opennext-spa' };
  }
  const isr = choices.isrCache !== 'none';
  const optimize = choices.images === 'default';
  const lambda = (meters: Record<string, string>) => bill('lambda', meters);
  const lambdaMeters = {
    invocations: 'requests',
    'memory-gb-hours': 'compute',
  };
  const nodes: ArchNodeIn[] = [
    // 1 つの CloudFront がすべてを受ける（静的は S3・動的は関数 URL の Lambda へ）。ISR のページは s-maxage の期間でキャッシュ
    cloudfront(
      choices,
      {
        asset: 1,
        'document-static': 1,
        'image-read': IMAGE_CDN_HIT_RATE,
      },
      isr ? ['document-isr'] : [],
    ),
    {
      id: 'server',
      label: 'Lambda（OpenNext のサーバーの関数）',
      config: {
        kind: 'function',
        memoryGB: COMPUTE_MEMORY_GB,
        concurrency: 1,
      },
      facts: [
        'opennext-versions',
        'function-url',
        ...(isr ? ['opennext-isr'] : []),
      ],
      billing: lambda(lambdaMeters),
    },
    ...(optimize
      ? [
          {
            id: 'image-fn',
            label: 'Lambda（OpenNext の画像の最適化）',
            config: {
              kind: 'function',
              memoryGB: COMPUTE_MEMORY_GB,
              concurrency: 1,
              // CloudFront の外れた分ごとに変換する。一意な変換の数（image-transform）は別に数えない
              classCpuMs: {
                'image-read': IMAGE_TRANSFORM_MS,
                'image-transform': 0,
              },
              backgroundClasses: ['image-transform'],
            },
            billing: lambda(lambdaMeters),
          } as ArchNodeIn,
        ]
      : []),
    s3,
    ...(isr
      ? [
          {
            id: 's3-cache',
            label: 'S3（ISR のキャッシュ）',
            config: { kind: 'object-storage', storesImages: false },
            billing: bill('s3-standard', {
              'object-writes': 'put-requests',
              'object-reads': 'get-requests',
            }),
          } as ArchNodeIn,
          {
            // タグの表: 閲覧で読み、再生成で書く（1 回 1 単位と仮定）
            id: 'tags',
            label: 'DynamoDB（タグのキャッシュ）',
            config: { kind: 'kv', mode: 'cache' },
            billing: bill('dynamodb-on-demand', {
              'kv-reads': 'read-request-units',
              'kv-writes': 'write-request-units',
            }),
          } as ArchNodeIn,
          {
            id: 'queue',
            label: 'SQS（再検証の待ち行列・FIFO）',
            config: {
              kind: 'cdn',
              hitRate: {},
              requestsPerItem: SQS_REQUESTS_PER_MESSAGE,
            },
            billing: bill('sqs-fifo', { requests: 'requests' }),
          } as ArchNodeIn,
        ]
      : []),
    db,
    ...standbyDb,
  ];
  const routes: Partial<Record<RequestClass, string[]>> = {
    'document-static': ['cf'],
    asset: ['cf'],
    'document-ssr': ['cf', 'server', db.id],
    ...(isr
      ? {
          'document-isr': ['cf', 'server', 's3-cache', 'tags'],
          // 期限の来たページは SQS に積まれ、再検証の関数が HEAD でサーバーの関数を呼んで作り直す（別の実行）
          'isr-revalidate': ['queue', 'server', db.id, 's3-cache', 'tags'],
        }
      : {}),
    api: ['cf', 'server', db.id],
    // 画像の最適化の関数は外れた分ごとに S3 から原本を読む（GET。OCL-A575F009）
    'image-read': optimize ? ['cf', 'image-fn', 's3'] : ['cf', 's3'],
    'image-write': ['server', 's3'],
    ...(optimize ? { 'image-transform': ['image-fn'] } : {}),
  };
  return { id: 'aws-opennext', name: 'AWS（OpenNext）', nodes, routes };
}
