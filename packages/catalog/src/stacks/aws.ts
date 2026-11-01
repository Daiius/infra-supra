// AWS の構成（prd/11 段 1・D-50）。Next.js は Amplify Hosting、Vite の SPA は S3 + CloudFront + Lambda（API Gateway の HTTP API）。
// 東京（ap-northeast-1）・常時無料だけ（AX-06）。料金は providers/aws.ts。
// index.ts とは型だけを共有し、値は読まない（index.ts がこのファイルを読み込んで登録するので、循環しても初期化の順に依らない）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import type { Choices, ComponentOption, StackDef } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

export const AWS_STACK_DEFS: readonly StackDef[] = [
  {
    id: 'aws-amplify',
    platform: 'aws',
    plan: 'pay-as-you-go',
    name: 'AWS（東京・従量課金）',
  },
];

/** 既定の選択（始める画面は未選択から始まるので、基準プレイと乗り換え先で使う）。画像は両方のフレームワークで選べる「投稿のときに縮める」。 */
export const AWS_DEFAULT_CHOICES: Choices = {
  isrCache: 'default',
  images: 'resize',
  db: 'dynamodb',
  frontCdn: 'none',
};

/** CloudFront・Amplify の CDN の画像のヒット率（仮定。Vercel の CDN と同じ値）。 */
const IMAGE_CDN_HIT_RATE = 0.9;
/** Amplify の SSR・Lambda のメモリ（GB。ゲーム上の仮定。Amplify の SSR のメモリは公式の記載が見当たらない）。 */
const COMPUTE_MEMORY_GB = 1;
/** Aurora Serverless v2 の最小の容量（ACU。0.5 が 0 以外の最小。負荷で伸びる分は数えない仮定）。 */
const AURORA_MIN_ACU = 0.5;
/** 0 ACU まで縮めるときの、止まるまでの接続の無い時間（秒。公式の最短の値）。 */
const AURORA_PAUSE_SECONDS = 300;
/** Aurora DSQL の DB に届く 1 件あたりの DPU（仮定。料金ページの例 10 万 DPU ≈ 70 万トランザクションから）。 */
const DSQL_DPU_PER_REQUEST = 0.14;
/** DynamoDB の 1 行（item）の大きさ（KB。仮定。書き込みの単位 1 KB に収まるとみる）。 */
const ITEM_KB = 1;

export const AWS_COMPONENTS: readonly ComponentOption[] = [
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: 'Amplify の ISR',
    note: 'ISR のページは Amplify の CDN が返し、期限が切れると SSR の計算で作り直す。オンデマンドの再検証（即時反映）には対応していない',
    premiseRefs: ['fact:aws:amplify-hosting:no-on-demand-isr'],
    onDemandIsr: { ok: false, fact: 'aws:amplify-hosting:no-on-demand-isr' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回 SSR の計算まで届く（リクエスト数と GB 時間で課金）。記事は常に新しい',
    premiseRefs: [],
    onDemandIsr: { ok: true, fact: 'aws:amplify-hosting:no-on-demand-isr' },
  },
  {
    id: 'default',
    slot: 'images',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: 'Amplify の画像の最適化',
    note: 'next/image の最適化を Amplify が行い、Amplify の CDN から配る（転送は $0.15/GB）。最適化の料金は料金表に専用の行が無く、料金未取得として出す',
    premiseRefs: ['fact:aws:amplify-hosting:transfer-not-cloudfront'],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'aws',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）を S3 から CloudFront で配る。CloudFront の常時無料（月 1 TB）を超えると転送に課金され、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: [
      'pool:aws:cloudfront:cloudfront-free-transfer',
      'pool:aws:cloudfront:cloudfront-free-requests',
    ],
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'aws',
    label: '投稿のときに一律で縮めて置く',
    note: '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて S3 に置き、CloudFront で配る。原本は残さない。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）',
    premiseRefs: [
      'pool:aws:cloudfront:cloudfront-free-transfer',
      'pool:aws:cloudfront:cloudfront-free-requests',
    ],
  },
  // Amplify の前に自前の CloudFront（D-31 の VPS の前段の CDN と同じ考え方。Next.js だけ。SPA は最初から CloudFront）
  {
    id: 'none',
    slot: 'frontCdn',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: 'なし',
    note: 'すべてを Amplify の CDN が返す（配信は Amplify の料金 $0.15/GB）',
    premiseRefs: ['fact:aws:amplify-hosting:transfer-not-cloudfront'],
  },
  {
    id: 'static',
    slot: 'frontCdn',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: '自前の CloudFront（静的と画像だけ）',
    note: '自前の CloudFront の後ろに Amplify を置き、静的なファイルと Amplify で最適化した画像を CloudFront が返す（CloudFront の単価・常時無料）。外れた分と HTML・API は Amplify の配信としても課金される（二重になる）とみなす。Amplify の利用者ガイドに手順は無い',
    premiseRefs: [
      'fact:aws:amplify-hosting:front-cloudfront',
      'pool:aws:cloudfront:cloudfront-free-transfer',
      'pool:aws:cloudfront:cloudfront-free-requests',
    ],
  },
  {
    id: 'html',
    slot: 'frontCdn',
    frameworks: ['nextjs'],
    platform: 'aws',
    label: '自前の CloudFront（ISR のページもキャッシュ）',
    note: 'ISR のページも s-maxage（ISR の間隔）で CloudFront が返す。オンデマンドの再検証は CloudFront に届かない（Amplify もオンデマンド ISR に非対応）。外れた分と SSR・API は Amplify の配信としても課金されるとみなす',
    onDemandIsr: { ok: false, fact: 'aws:amplify-hosting:front-cloudfront' },
    premiseRefs: [
      'fact:aws:amplify-hosting:front-cloudfront',
      'fact:aws:amplify-hosting:cache-control',
      'pool:aws:cloudfront:cloudfront-free-transfer',
      'pool:aws:cloudfront:cloudfront-free-requests',
    ],
  },
  {
    id: 'dynamodb',
    slot: 'db',
    platform: 'aws',
    label: 'DynamoDB（オンデマンド）',
    note: '読み書きの単位で課金し、時間課金のコンピュートが無い。保存は 25 GB 月まで無料。1 行の大きさは 1 KB 以下と仮定',
    premiseRefs: [
      'fact:aws:dynamodb-on-demand:request-units',
      'pool:aws:dynamodb-on-demand:dynamodb-free-storage',
    ],
  },
  {
    id: 'aurora',
    slot: 'db',
    platform: 'aws',
    label: 'Aurora Serverless v2（最小 0.5 ACU）',
    note: 'Aurora PostgreSQL の Serverless v2（I/O-Optimized。I/O に課金されない）。ACU の時間で課金し、最小の 0.5 ACU の分は常にかかる（負荷で伸びた分はこのモデルでは数えない）',
    premiseRefs: ['fact:aws:aurora-serverless-v2-io:io-optimized'],
  },
  {
    id: 'aurora-pause',
    slot: 'db',
    platform: 'aws',
    label: 'Aurora Serverless v2（0 ACU まで縮める）',
    note: '接続が 300 秒ないと止まり、止まっている間は ACU の料金がかからない。動いている割合は DB に届く件数から出す（ほぼ常に誰かが見ているサイトでは、ほとんど止まらない）。再開の待ち（約 15 秒）は速さに入れていない',
    premiseRefs: ['fact:aws:aurora-serverless-v2-io:auto-pause'],
  },
  {
    id: 'dsql',
    slot: 'db',
    platform: 'aws',
    label: 'Aurora DSQL',
    note: '処理の量（DPU）と保存で課金するサーバーレスの分散 SQL。月 10 万 DPU と 1 GB は無料。1 件あたりの DPU は公式に無く、料金ページの例から仮定している。PostgreSQL の一部の機能が無い',
    premiseRefs: [
      'fact:aws:aurora-dsql:dpu',
      'fact:aws:aurora-dsql:compat',
      'pool:aws:aurora-dsql:dsql-free-dpu',
    ],
  },
  {
    id: 'rds',
    slot: 'db',
    platform: 'aws',
    label: 'RDS for PostgreSQL（db.t4g.micro）',
    note: '定番の Postgres の最小のインスタンス（Single-AZ）。時間課金で、使われていなくても毎月かかる。アプリとの間の転送の料金は未確認で数えない',
    premiseRefs: [],
  },
  // SPA の部品（OGP の前処理はこの段では入れない。1 択）
  {
    id: 'none',
    slot: 'ogp',
    platform: 'aws',
    frameworks: ['vite-spa'],
    label: '前処理しない（全ページ同じカード）',
    note: 'シェルのメタタグは全ページ同じ。記事ごとのカードは出ない（ゲーム上の仮定: SNS の話題が伸びにくい）。AWS で前処理する形（Lambda@Edge など）はまだ入れていない',
    premiseRefs: [],
  },
  {
    id: 'none',
    slot: 'apiCache',
    platform: 'aws',
    frameworks: ['vite-spa'],
    label: 'なし',
    note: '記事の中身の API を毎回処理して DB を読む。記事は常に新しい',
    premiseRefs: [],
  },
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'aws',
    frameworks: ['vite-spa'],
    label: 'CloudFront のキャッシュ（s-maxage）',
    note: '記事の中身の API の応答を CloudFront が返し、API Gateway・Lambda・DB に届く件数が減る（CloudFront のリクエストと転送は残る）。拠点ごとに分かれてヒット率が下がる分は計算に入れていない',
    premiseRefs: [
      'pool:aws:cloudfront:cloudfront-free-requests',
      'pool:aws:lambda:lambda-free-requests',
    ],
  },
];

const bill = (planId: string, meters: Record<string, string>) => ({
  accountId: 'aws',
  provider: 'aws',
  planId,
  meters,
});

function dbNode(opt: string | undefined): ArchNodeIn {
  if (opt === 'aurora' || opt === 'aurora-pause') {
    const pause = opt === 'aurora-pause';
    return {
      id: pause ? 'aurora-pause' : 'aurora',
      label: pause
        ? 'Aurora Serverless v2（0 ACU まで縮める）'
        : 'Aurora Serverless v2（最小 0.5 ACU）',
      config: {
        kind: 'managed-db',
        capacityUnits: AURORA_MIN_ACU,
        ...(pause ? { pauseAfterIdleSeconds: AURORA_PAUSE_SECONDS } : {}),
      },
      facts: ['io-optimized', ...(pause ? ['auto-pause'] : [])],
      billing: bill('aurora-serverless-v2-io', {
        'instance-hours': 'acu',
        'storage-gb-month': 'storage',
      }),
    };
  }
  if (opt === 'dsql')
    return {
      id: 'dsql',
      label: 'Aurora DSQL',
      config: { kind: 'processing-db', unitsPerRequest: DSQL_DPU_PER_REQUEST },
      facts: ['dpu', 'compat'],
      billing: bill('aurora-dsql', {
        'processing-units': 'dpu',
        'storage-gb-month': 'storage',
      }),
    };
  return opt === 'rds'
    ? {
        id: 'rds',
        label: 'RDS for PostgreSQL（db.t4g.micro）',
        config: { kind: 'managed-db' },
        billing: bill('rds-postgres-t4g-micro', {
          'instance-hours': 'instance',
          'storage-gb-month': 'storage',
        }),
      }
    : {
        id: 'dynamodb',
        label: 'DynamoDB（オンデマンド）',
        config: {
          kind: 'request-db',
          readUnitKB: 4,
          writeUnitKB: 1,
          eventuallyConsistent: true,
          itemKB: ITEM_KB,
        },
        facts: ['request-units'],
        billing: bill('dynamodb-on-demand', {
          'read-request-units': 'read-request-units',
          'write-request-units': 'write-request-units',
          'storage-gb-month': 'storage',
        }),
      };
}

const s3: ArchNodeIn = {
  id: 's3',
  label: 'S3（画像の原本）',
  config: { kind: 'object-storage' },
  billing: bill('s3-standard', {
    'storage-gb-month': 'storage',
    'object-writes': 'put-requests',
    'object-reads': 'get-requests',
    'egress-gb': 'transfer-to-cloudfront',
  }),
};

const cloudfront = (
  hitRate: Partial<Record<RequestClass, number>>,
  ttlClasses: RequestClass[] = [],
): ArchNodeIn => ({
  id: 'cf',
  label: 'CloudFront',
  config: {
    kind: 'cdn',
    hitRate,
    ...(ttlClasses.length ? { ttlClasses } : {}),
  },
  facts: ['origin-fetch-free'],
  billing: bill('cloudfront', {
    requests: 'https-requests',
    'egress-gb': 'cloudfront-transfer-out',
    'origin-transfer-gb': 'origin-fetch',
  }),
});

/**
 * AWS の構成を部品の選択から組み立てる。spa は Vite の SPA（S3 + CloudFront + Lambda）、apiCache はその API の応答のキャッシュ。
 * standby は差し替えの途中の新しい部品（経路に載せず、常時かかる分だけ課金される）。
 */
export function composeAws(
  choices: Choices,
  standby: Choices,
  options: { spa: boolean; apiCache: string },
): ArchitectureInput {
  const db = dbNode(choices.db);
  const standbyDb =
    standby.db !== undefined && standby.db !== choices.db
      ? [dbNode(standby.db)]
      : [];
  return options.spa
    ? composeSpa(db, standbyDb, choices, options.apiCache)
    : composeAmplify(db, standbyDb, choices);
}

function composeAmplify(
  db: ArchNodeIn,
  standbyDb: ArchNodeIn[],
  choices: Choices,
): ArchitectureInput {
  const isr = choices.isrCache !== 'none';
  const optimize = choices.images === 'default';
  // 自前の CloudFront を Amplify の前に置く（static: 静的と画像だけ・html: ISR のページも）。
  // キャッシュは前段の 1 層で数え、Amplify の CDN は前段が持つクラスを素通しにする（二重に当てない）
  const front = choices.frontCdn === 'static' || choices.frontCdn === 'html';
  const frontIsr = isr && choices.frontCdn === 'html';
  const amplify = (meters: Record<string, string>) =>
    bill('amplify-hosting', meters);
  const frontNodes: ArchNodeIn[] = front
    ? [
        {
          id: 'front',
          label: '自前の CloudFront（Amplify の前段）',
          config: {
            kind: 'cdn',
            hitRate: {
              asset: 1,
              'document-static': 1,
              ...(optimize ? { 'image-read': IMAGE_CDN_HIT_RATE } : {}),
            },
            ...(frontIsr
              ? { ttlClasses: ['document-isr'] as RequestClass[] }
              : {}),
          },
          facts: ['origin-fetch-free'],
          billing: bill('cloudfront', {
            requests: 'https-requests',
            'egress-gb': 'cloudfront-transfer-out',
            'origin-transfer-gb': 'origin-fetch',
          }),
        },
      ]
    : [];
  const nodes: ArchNodeIn[] = [
    ...frontNodes,
    {
      id: 'cdn',
      label: 'Amplify の CDN',
      config: {
        kind: 'cdn',
        hitRate: front
          ? {}
          : {
              asset: 1,
              'document-static': 1,
              ...(optimize ? { 'image-read': IMAGE_CDN_HIT_RATE } : {}),
            },
        // ISR のページのヒット率は閲覧の密度 × 再検証の間隔から出す（D-37 と同じ式）
        ...(isr && !frontIsr
          ? { ttlClasses: ['document-isr'] as RequestClass[] }
          : {}),
      },
      facts: [
        'transfer-not-cloudfront',
        'cache-control',
        ...(front ? ['front-cloudfront'] : []),
      ],
      billing: amplify({ 'egress-gb': 'amplify-transfer-out' }),
    },
    {
      id: 'ssr',
      label: 'Amplify の SSR（Next.js）',
      config: { kind: 'function', memoryGB: COMPUTE_MEMORY_GB, concurrency: 1 },
      facts: ['next-versions', ...(isr ? ['no-on-demand-isr'] : [])],
      billing: amplify({
        invocations: 'ssr-requests',
        'memory-gb-hours': 'ssr-duration',
      }),
    },
    ...(optimize
      ? [
          {
            id: 'image',
            label: 'Amplify の画像の最適化',
            config: { kind: 'image-optimizer' },
            billing: amplify({ 'image-transformations': 'image-optimization' }),
          } as ArchNodeIn,
        ]
      : [cloudfront({ 'image-read': IMAGE_CDN_HIT_RATE })]),
    s3,
    db,
    ...standbyDb,
  ];
  // 前段があれば、Amplify の CDN を通る経路の先頭に前段を足す
  const edge = front ? ['front', 'cdn'] : ['cdn'];
  const routes: Partial<Record<RequestClass, string[]>> = {
    'document-static': edge,
    asset: edge,
    'document-ssr': [...edge, 'ssr', db.id],
    ...(isr
      ? {
          // CDN の miss は SSR の計算が返す（再生成は裏で別の実行として数える）
          'document-isr': [...edge, 'ssr'],
          'isr-revalidate': ['ssr', db.id],
        }
      : {}),
    api: [...edge, 'ssr', db.id],
    'image-read': optimize ? [...edge, 'image'] : ['cf', 's3'],
    'image-write': ['ssr', 's3'],
    ...(optimize ? { 'image-transform': ['image'] } : {}),
  };
  return {
    id: 'aws-amplify',
    name: 'AWS（Amplify Hosting）',
    nodes,
    routes,
  };
}

function composeSpa(
  db: ArchNodeIn,
  standbyDb: ArchNodeIn[],
  choices: Choices,
  apiCache: string,
): ArchitectureInput {
  const cached = apiCache === 'cdn';
  const nodes: ArchNodeIn[] = [
    // シェル・JS・CSS は S3 に置き、CloudFront がすべて返す（オリジンの取得は無料・件数は無視できる）
    cloudfront(
      { asset: 1, 'document-static': 1, 'image-read': IMAGE_CDN_HIT_RATE },
      cached ? ['api-content'] : [],
    ),
    {
      // 振る舞いは「リクエストを数えて次へ渡す」ので cdn の種類で表す（ヒットは無い）。課金はリクエストだけ
      id: 'apigw',
      label: 'API Gateway（HTTP API）',
      config: { kind: 'cdn', hitRate: {} },
      billing: bill('api-gateway-http', { requests: 'requests' }),
    },
    {
      id: 'lambda',
      label: 'Lambda（API）',
      config: { kind: 'function', memoryGB: COMPUTE_MEMORY_GB, concurrency: 1 },
      billing: bill('lambda', {
        invocations: 'requests',
        'memory-gb-hours': 'compute',
      }),
    },
    s3,
    db,
    ...standbyDb,
  ];
  const api = ['cf', 'apigw', 'lambda', db.id];
  return {
    id: 'aws-s3-cloudfront',
    name: 'AWS（S3 + CloudFront + Lambda）（Vite の SPA）',
    nodes,
    routes: {
      'document-static': ['cf'],
      asset: ['cf'],
      api,
      'api-content': api,
      'image-read': ['cf', 's3'],
      // 投稿のアップロードは API に直接送る（CloudFront の転送に数えない）
      'image-write': ['apigw', 'lambda', 's3'],
    },
  };
}
