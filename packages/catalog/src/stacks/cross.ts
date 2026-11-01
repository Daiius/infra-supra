// 事業者をまたぐ構成（prd/11 §2・D-52）。部品は自分の事業者（platform）を持ち、差せる土台の事業者（hosts）と
// 接続の形（link）を持つ。差せる組は CROSS_PAIRS の表で許したものだけ（AX-08。公式の文書で現実にできると確かめた組）。
// 表に無い組は部品の選択肢に出さない。今の組は「Vercel・AWS の画像だけ Cloudflare（R2 + 変換）」と、
// SPA の API の置き場（Vercel・AWS の静的 + Cloudflare Workers の API + D1／Cloudflare の静的 + AWS の API Gateway + Lambda + DynamoDB。D-65）。
// 既存の Cloudflare + Hyperdrive（Supabase）・さくらの VPS + 前段の CDN（Cloudflare）は、土台の事業者の部品として
// 先に入っていたもの（D-24 X-6・D-31）で、この表の外にある（アカウントの数は accountsOf で同じく数える）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  bill as awsBill,
  COMPUTE_MEMORY_GB,
  dbNode as awsDbNode,
} from './aws.ts';
import type { FrameworkId } from '../frameworks/index.ts';
import type { Choices, ComponentOption, Platform, SlotId } from './index.ts';

/** 土台と別の事業者の部品の接続の形。 */
export type CrossLink = {
  /**
   * http: 公開の URL（画像の配信・変換・ブラウザから呼ぶ API）。binding・tcp・proxy-binding は段 2 以降（prd/11 §2.2）。
   * API の置き場（D-65）も、ブラウザが別のサブドメインの API を HTTPS で呼ぶ形なので http。
   */
  via: 'http';
  /**
   * 部品の事業者の側で、振る舞いが同じ部品の id（Workload の変え方と、ゲームの画像の大きさ・サイズ違いの判定に使う）。
   * 例: 「Cloudflare: R2 に一律で縮めて置く」は Cloudflare の 'resize' と同じ振る舞い。
   */
  as: string;
};

/** 許した組（土台の事業者 × スロット × 部品の事業者）と、現実にできる根拠（公式の文書・2026-11-01 取得）。 */
export type CrossPair = {
  host: Platform;
  slot: SlotId;
  provider: Platform;
  /** 根拠の要約（出典は catalog の料金データの facts と同じ URL）。 */
  basis: string;
  sources: { url: string; retrievedAt: string }[];
};

export const CROSS_PAIRS: readonly CrossPair[] = [
  {
    host: 'vercel',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'R2 の公開バケットはカスタムドメイン（同じアカウントの Cloudflare のゾーン）で配れて、R2 の転送は無料。' +
      'URL での変換は変換を有効にしたゾーンで頼め、同じゾーンの元の画像は既定で受け付ける。' +
      'Next.js の next/image は Cloudflare の変換の URL を返すローダーに替えられる（公式の例）',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://developers.cloudflare.com/images/pricing/',
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  {
    host: 'aws',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（画像のドメインを Cloudflare のゾーンに置き、R2 から配る・URL で変換する）。' +
      'Lambda の関数がリージョンの外とやり取りするデータは EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      'Amplify の SSR から外への通信の課金は料金ページに記載が無い（未確認）',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/amplify/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  {
    host: 'aws-opennext',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'AWS（Amplify）と同じ（画像のドメインを Cloudflare のゾーンに置き、R2 から配る・URL で変換する）。' +
      '投稿は OpenNext のサーバーの関数（Lambda）が受けて R2 に書き、その転送は EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。D-63',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  // SPA の API の置き場（prd/10 §3・F-11・D-65。2026-11-02 に原文で確かめた）。ブラウザは静的なサイト（www）から
  // 別のサブドメイン（api）の API を呼ぶ（F-13: 同じサイトのサブドメインに置く前提）。DB は API と同じ事業者に置く
  {
    host: 'vercel',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、そのホスト名では Worker がオリジンになる。' +
      '別のホスト名のサイトから呼ぶ API は Worker が CORS のヘッダーを返す（公式の例）。D1 は Worker の binding から使う' +
      '（D1 の REST API は管理用の面で、Vercel から直接つなぐ形は出さない。AX-10）。' +
      'Vercel の外部への rewrite で同じドメインに見せる形は課金の記載が無い（prd/10 B-3）ので使わない',
    sources: [
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://developers.cloudflare.com/d1/best-practices/query-d1/',
      'https://developers.cloudflare.com/workers/platform/pricing/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  {
    host: 'aws',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（Worker をカスタムドメインに置き、CORS のヘッダーを返し、D1 を binding で使う）。' +
      'シェル・JS・CSS・画像は S3 + CloudFront に残る。投稿の画像は Worker が S3 に書く（S3 はインターネットからの受信に課金しない）',
    sources: [
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://aws.amazon.com/s3/pricing/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  {
    host: 'cloudflare',
    slot: 'api',
    provider: 'aws',
    basis:
      'シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。API は API Gateway の HTTP API（カスタムドメインを Cloudflare の DNS で向ける）+ Lambda + DynamoDB。' +
      'HTTP API は呼び出しと送り出したデータの量で課金され、外へのデータ転送は EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      '投稿の画像は Lambda が R2 に書く（同じく EC2 のデータ転送の料金）',
    sources: [
      'https://aws.amazon.com/api-gateway/pricing/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
];

const VERCEL_TO_CF_IMAGES_REFS = [
  'fact:cloudflare:r2-standard:custom-domain',
  'pool:cloudflare:r2-storage',
];

/** 他の事業者の部品（表で許した組だけ）。label は事業者の名前を前に付ける（prd/11 §3.1）。 */
export const CROSS_COMPONENTS: readonly ComponentOption[] = [
  {
    id: 'cf-images',
    slot: 'images',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'aws-opennext'],
    link: { via: 'http', as: 'images' },
    label: 'Cloudflare: R2 に置き、閲覧のときに Images で変換',
    note:
      '画像の原本を Cloudflare の R2 に置き、画像のドメイン（Cloudflare のゾーン）の URL で変換して配る。土台（Vercel・AWS）の CDN を通らないので、' +
      '画像の転送は土台の転送の料金にならない（R2 の転送は無料）。一意な変換（種類 × サイズ違い）を月ごとに数える。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      ...VERCEL_TO_CF_IMAGES_REFS,
      'fact:cloudflare:images-paid:transform-url',
      'fact:cloudflare:images-free:transform-url',
      'pool:cloudflare:images-transformations',
    ],
  },
  {
    id: 'cf-resize',
    slot: 'images',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'aws-opennext'],
    link: { via: 'http', as: 'resize' },
    label: 'Cloudflare: 投稿のときに一律で縮めて R2 に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloudflare の R2 に置き、原本は残さない。' +
      '画像のドメイン（Cloudflare のゾーン）から配るので、画像の転送は土台（Vercel・AWS）の転送の料金にならない（R2 の転送は無料）。' +
      '変換のサービスは使わない。サイズ違いが無いので、スマホにも同じ大きさを配る。Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [...VERCEL_TO_CF_IMAGES_REFS],
  },
  // SPA の API の置き場（D-65）。label・note の方針は画像と同じ（事業者の名前を前に付け、損は note で分かるようにする）
  {
    id: 'cf-workers',
    slot: 'api',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws'],
    frameworks: ['vite-spa'],
    link: { via: 'http', as: 'same' },
    label: 'Cloudflare: Workers に API を置き、DB は D1',
    note:
      'API を Cloudflare の Worker（api のサブドメイン）に置き、DB は D1 を binding で使う。静的なファイル（シェル・JS・CSS）と画像は今の事業者から配る。' +
      'ブラウザは別のサブドメインの API を呼ぶので、CORS のヘッダーと認証の Cookie の設定が要る。今の事業者の関数と DB は使わなくなる。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:cloudflare:workers-paid:custom-domain-origin',
      'fact:cloudflare:workers-paid:cors-headers',
      'fact:cloudflare:workers-paid:d1-binding',
      'pool:cloudflare:workers-paid:paid-requests',
      'limit:cloudflare:workers-free:cpu-ms-per-request',
    ],
  },
  {
    id: 'aws-lambda',
    slot: 'api',
    platform: 'aws',
    hosts: ['cloudflare'],
    frameworks: ['vite-spa'],
    link: { via: 'http', as: 'same' },
    label: 'AWS: API Gateway + Lambda に API を置き、DB は DynamoDB',
    note:
      'API を AWS の API Gateway（HTTP API・api のサブドメイン）+ Lambda に置き、DB は DynamoDB（オンデマンド）。静的なファイルと画像は Cloudflare から配る（静的アセットは Worker を起動しない）。' +
      'API の応答は CloudFront を通らずに AWS から外へ送るので、データ転送の料金（月 100 GB の無料の後）がかかる。' +
      'ブラウザは別のサブドメインの API を呼ぶので、CORS のヘッダーと認証の Cookie の設定が要る。AWS のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:aws:data-transfer-out:api-gateway-out',
      'pool:aws:lambda:lambda-free-requests',
      'fact:aws:dynamodb-on-demand:request-units',
      'fact:cloudflare:workers-paid:static-assets',
    ],
  },
];

/** API を他の事業者に置いているか（SPA の API の置き場・D-65。既定・省略は同じ事業者）。 */
export const apiPlacedElsewhere = (c: Choices): boolean =>
  c.api !== undefined && c.api !== 'same';

/** 部品を差せる土台の事業者（省略は自分の事業者だけ）。 */
export const hostsOf = (c: ComponentOption): readonly Platform[] =>
  c.hosts ?? [c.platform];

/** 部品の振る舞いの id（他の事業者の部品は、同じ振る舞いの部品の id。それ以外はそのまま）。 */
export function behaviorOf(
  options: readonly ComponentOption[],
  host: Platform,
  slot: SlotId,
  id: string | undefined,
): string | undefined {
  const o = options.find(
    (x) => x.slot === slot && x.id === id && hostsOf(x).includes(host),
  );
  return o?.link?.as ?? id;
}

/** 構成の課金のアカウント（ノードの billing.accountId の種類。出てきた順）。 */
export function accountsOf(arch: ArchitectureInput): string[] {
  return [
    ...new Set(
      arch.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
}

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** Cloudflare の画像のドメインのキャッシュのヒット率（仮定。Cloudflare の構成の R2 公開バケットと同じ値）。 */
const CF_IMAGE_HIT_RATE = 0.9;

/**
 * 土台ごとの、画像のノード（外すもの）と投稿の経路（R2 の手前まで）。土台の構成のノードの id に頼るので、
 * 土台の構成（index.ts・aws.ts）で画像のノードの id を変えたらここも直す（cross.test.ts が経路で確かめる）。
 * - Vercel: 画像の最適化（image）・Vercel Blob（blob）を外す。投稿は関数が受けて R2 に書く。関数から外への通信の Vercel の課金は
 *   公式の文書に記載が見当たらない（未確認）ので数えない。
 * - AWS（Amplify）: 画像の最適化（image）・画像だけの CloudFront（cf）・S3（s3）を外す。投稿は Amplify の SSR が受けて R2 に書く。
 *   Amplify の SSR から外への通信の課金は料金ページに記載が無い（未確認）ので数えない。
 * - AWS の OpenNext（Next.js）: 画像の最適化の関数（image-fn）・S3（s3）を外す。投稿はサーバーの関数が受けて R2 に書き、転送を数える（D-63）。
 * - AWS（S3 + CloudFront + Lambda の SPA。OpenNext の SPA も同じ）: S3（s3）を外す（CloudFront はシェルと API に残る）。投稿は Lambda が受けて R2 に書き、
 *   その転送を東京 → インターネットの転送（月 100 GB 無料の後 $0.114/GB）で数える（Lambda の料金ページ: リージョンの外との
 *   データの出入りは EC2 のデータ転送の料金）。
 * R2 は書き込みの受信に課金しない（料金表に項目が無い）。
 */
function hostImageShape(
  host: Platform,
  arch: ArchitectureInput,
): { remove: string[]; write: string[]; out?: ArchNodeIn } | undefined {
  if (host === 'vercel') return { remove: ['image', 'blob'], write: ['fn'] };
  if (host !== 'aws' && host !== 'aws-opennext') return undefined;
  if (arch.id === 'aws-amplify')
    return { remove: ['image', 'cf', 's3'], write: ['ssr'] };
  const out = awsOut();
  // OpenNext（Next.js）: 画像の最適化の関数（image-fn）・S3（s3）を外す。CloudFront（cf）はページ・静的に残る。
  // 投稿はサーバーの関数（Lambda）が受けて R2 に書き、その転送を東京 → インターネットで数える（D-63）
  if (arch.id === 'aws-opennext')
    return { remove: ['image-fn', 's3'], write: ['server', 'aws-out'], out };
  return { remove: ['s3'], write: ['apigw', 'lambda', 'aws-out'], out };
}

/** Lambda から外（R2）へ送る転送を数えるだけのノード（cdn の種類でヒットなし。課金は転送だけ）。 */
function awsOut(): ArchNodeIn {
  return {
    id: 'aws-out',
    label: 'AWS → インターネット（R2 への書き込み）',
    config: { kind: 'cdn', hitRate: {} },
    facts: ['lambda-out'],
    billing: {
      accountId: 'aws',
      provider: 'aws',
      planId: 'data-transfer-out',
      meters: { 'egress-gb': 'internet-out' },
    },
  };
}

/**
 * 土台の構成に、他の事業者の部品を差す（composeStack から呼ぶ）。今は Vercel・AWS の画像のスロットだけ。
 * 画像の配信・保存・変換を土台の CDN・置き場・画像の最適化から、Cloudflare の R2・画像のドメインのキャッシュ・Images に移す。
 */
export function applyCross(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  framework: FrameworkId | undefined,
): ArchitectureInput {
  const opt = CROSS_COMPONENTS.find(
    (c) =>
      c.slot === 'images' &&
      c.id === choices.images &&
      hostsOf(c).includes(host),
  );
  const shape = opt ? hostImageShape(host, arch) : undefined;
  if (!opt || !shape) return arch;
  const transform = opt.link!.as === 'images';
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  // Vercel Hobby（個人・非商用）は Images Free（月 5,000 の一意な変換まで・超えると 9422）、それ以外（Vercel Pro・AWS）は Images Paid（仮定）
  const imagesPlan = plan === 'hobby' ? 'images-free' : 'images-paid';
  const nodes: ArchNodeIn[] = [
    ...arch.nodes.filter((n) => !shape.remove.includes(n.id)),
    ...(shape.out ? [shape.out] : []),
    {
      id: 'cf-cache',
      label: 'Cloudflare（画像のドメインのキャッシュ）',
      config: { kind: 'cdn', hitRate: { 'image-read': CF_IMAGE_HIT_RATE } },
    },
    {
      id: 'cf-r2',
      label: 'Cloudflare R2（画像）',
      config: { kind: 'object-storage' },
      facts: ['custom-domain', 'egress-other-services'],
      billing: bill('r2-standard', {
        'storage-gb-month': 'storage',
        'object-writes': 'class-a',
        'object-reads': 'class-b',
        'egress-gb': 'egress',
      }),
    },
    ...(transform
      ? [
          {
            id: 'cf-images',
            label: 'Cloudflare Images（URL で変換）',
            config: { kind: 'image-optimizer' },
            facts: [
              'transform-url',
              'outside-images',
              ...(framework === 'vite-spa' ? [] : ['next-loader']),
            ],
            billing: bill(imagesPlan, {
              'image-transformations': 'transformations',
            }),
          } as ArchNodeIn,
        ]
      : []),
  ];
  const routes: Partial<Record<RequestClass, string[]>> = {
    ...arch.routes,
    'image-read': ['cf-cache', 'cf-r2'],
    'image-write': [...shape.write, 'cf-r2'],
  };
  if (transform) routes['image-transform'] = ['cf-images'];
  else delete routes['image-transform'];
  return { ...arch, nodes, routes };
}

// ---- SPA の API の置き場（D-65・prd/10 §3）----

/** API と一緒に他の事業者に移す（使わなくなれば外す）土台のノード。DB は API と同じ事業者に置く。 */
const HOST_API_NODES: Partial<Record<Platform, readonly string[]>> = {
  vercel: ['fn', 'db'],
  aws: [
    'apigw',
    'lambda',
    'aws-out',
    'dynamodb',
    'rds',
    'aurora',
    'aurora-pause',
    'dsql',
  ],
  cloudflare: ['worker', 'd1', 'kv-db', 'hyperdrive', 'supabase'],
};

/** Cloudflare の Worker（API）と D1。土台が Vercel Hobby なら Workers Free、それ以外は Workers Paid（仮定）。 */
function cfApiNodes(plan: string): ArchNodeIn[] {
  const workers = plan === 'hobby' ? 'workers-free' : 'workers-paid';
  const bill = (meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId: workers,
    meters,
  });
  return [
    {
      id: 'cf-worker',
      label: 'Cloudflare Worker（API）',
      config: { kind: 'function' },
      facts: ['custom-domain-origin', 'cors-headers', 'd1-binding'],
      billing: bill({ requests: 'requests', 'cpu-ms': 'cpu-ms' }),
    },
    {
      id: 'cf-d1',
      label: 'Cloudflare D1',
      config: { kind: 'sql-db' },
      billing: bill({
        'rows-read': 'd1-rows-read',
        'rows-written': 'd1-rows-written',
        ...(workers === 'workers-paid'
          ? { 'storage-gb-month': 'd1-storage' }
          : {}),
      }),
    },
  ];
}

/** AWS の API Gateway（HTTP API）+ Lambda + DynamoDB と、AWS から外へ送る転送（API の応答・R2 への書き込み）。 */
function awsApiNodes(): ArchNodeIn[] {
  return [
    {
      id: 'aws-out',
      label: 'AWS → インターネット（API の応答・R2 への書き込み）',
      config: { kind: 'cdn', hitRate: {} },
      facts: ['api-gateway-out', 'lambda-out'],
      billing: awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
    },
    {
      id: 'apigw',
      label: 'API Gateway（HTTP API）',
      // HTTP API は 512 KB ごとに 1 リクエスト（aws.ts の SPA と同じ）
      config: { kind: 'cdn', hitRate: {}, requestUnitKB: 512 },
      billing: awsBill('api-gateway-http', { requests: 'requests' }),
    },
    {
      id: 'lambda',
      label: 'Lambda（API）',
      config: { kind: 'function', memoryGB: COMPUTE_MEMORY_GB, concurrency: 1 },
      billing: awsBill('lambda', {
        invocations: 'requests',
        'memory-gb-hours': 'compute',
      }),
    },
    awsDbNode('dynamodb'),
  ];
}

/** 置き場ごとの、足すノードと経路。write は投稿の画像を書く手前まで（書き先は土台の経路の最後のノード）。 */
function placement(
  id: string,
  plan: string,
): { nodes: ArchNodeIn[]; api: string[]; write: string[] } | undefined {
  if (id === 'cf-workers')
    return {
      nodes: cfApiNodes(plan),
      api: ['cf-worker', 'cf-d1'],
      // Worker は R2 に binding で書き、S3 には HTTPS で書く（S3 はインターネットからの受信に課金しない）
      write: ['cf-worker'],
    };
  if (id === 'aws-lambda')
    return {
      nodes: awsApiNodes(),
      // 応答は API Gateway から外へ送る（CloudFront を通らない）ので、転送を数えるノードを前に置く
      api: ['aws-out', 'apigw', 'lambda', 'dynamodb'],
      write: ['apigw', 'lambda', 'aws-out'],
    };
  return undefined;
}

/**
 * SPA の API を他の事業者に置く（composeStack から、SPA の形にした後で呼ぶ。D-65）。
 * 記事の中身の API（api-content）ともともとの API（api）を、他の事業者の API と DB へ向ける。投稿の画像は API が受けて、
 * 今の置き場（R2・S3）に書く。Vercel Blob だけはアップロードを Vercel の関数に残す（Blob の書き込みの手順が
 * Vercel の関数を前提にしているため。仮定）。
 * 土台の関数・DB は、ほかの経路（OGP の前処理・リアルタイム・Blob のアップロード）が使っていなければ外す。
 * standby.api（差し替えの途中）が別の置き場なら、その置き場のノードを経路に載せずに足す（常時かかる分だけ課金される）。
 */
export function applyCrossApi(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  standby: Choices,
): ArchitectureInput {
  const current = choices.api ?? 'same';
  const next = standby.api;
  const cur = placement(current, plan);
  const nxt =
    next !== undefined && next !== current ? placement(next, plan) : undefined;
  if (!cur && !nxt) return arch;
  const routes: Partial<Record<RequestClass, string[]>> = { ...arch.routes };
  let nodes = [...arch.nodes];
  const addAll = (ns: ArchNodeIn[]) =>
    nodes.push(...ns.filter((n) => !nodes.some((x) => x.id === n.id)));
  if (cur) {
    routes.api = [...cur.api];
    routes['api-content'] = [...cur.api];
    const write = routes['image-write'];
    const target = write?.[write.length - 1];
    if (target && target !== 'blob')
      routes['image-write'] = [...cur.write, target];
    addAll(cur.nodes);
  }
  if (nxt) addAll(nxt.nodes);
  // 同じ事業者へ戻す途中は、土台の関数・DB を残す（新旧の両方を動かす）
  const keepHost = next === 'same' && current !== 'same';
  if (cur && !keepHost) {
    const used = new Set(Object.values(routes).flat());
    const placed = new Set(
      [...cur.nodes, ...(nxt?.nodes ?? [])].map((n) => n.id),
    );
    const drop = (HOST_API_NODES[host] ?? []).filter(
      (id) => !used.has(id) && !placed.has(id),
    );
    nodes = nodes.filter((n) => !drop.includes(n.id));
  }
  if (cur && host === 'cloudflare')
    nodes = nodes.map((n): ArchNodeIn => {
      // Worker が OGP の前処理・リアルタイムだけに残るときの名前
      if (n.id === 'worker')
        return { ...n, label: 'Worker（OGP の前処理・リアルタイム）' };
      // Worker の binding でなく、ゾーンの URL で変換する
      if (n.id === 'images')
        return {
          ...n,
          label: 'Images（URL で変換）',
          facts: [...(n.facts ?? []), 'transform-url'],
        };
      return n;
    });
  return { ...arch, nodes, routes };
}
