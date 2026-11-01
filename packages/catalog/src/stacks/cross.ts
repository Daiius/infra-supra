// 事業者をまたぐ構成（prd/11 §2・D-52）。部品は自分の事業者（platform）を持ち、差せる土台の事業者（hosts）と
// 接続の形（link）を持つ。差せる組は CROSS_PAIRS の表で許したものだけ（AX-08。公式の文書で現実にできると確かめた組）。
// 表に無い組は部品の選択肢に出さない。今の組は「Vercel・AWS の画像だけ Cloudflare（R2 + 変換）」の 2 つ。
// 既存の Cloudflare + Hyperdrive（Supabase）・さくらの VPS + 前段の CDN（Cloudflare）は、土台の事業者の部品として
// 先に入っていたもの（D-24 X-6・D-31）で、この表の外にある（アカウントの数は accountsOf で同じく数える）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import type { FrameworkId } from '../frameworks/index.ts';
import type { Choices, ComponentOption, Platform, SlotId } from './index.ts';

/** 土台と別の事業者の部品の接続の形。 */
export type CrossLink = {
  /** http: 公開の URL（画像の配信・変換）。binding・tcp・proxy-binding は段 2 以降（prd/11 §2.2）。 */
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
    hosts: ['vercel', 'aws'],
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
    hosts: ['vercel', 'aws'],
    link: { via: 'http', as: 'resize' },
    label: 'Cloudflare: 投稿のときに一律で縮めて R2 に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloudflare の R2 に置き、原本は残さない。' +
      '画像のドメイン（Cloudflare のゾーン）から配るので、画像の転送は土台（Vercel・AWS）の転送の料金にならない（R2 の転送は無料）。' +
      '変換のサービスは使わない。サイズ違いが無いので、スマホにも同じ大きさを配る。Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [...VERCEL_TO_CF_IMAGES_REFS],
  },
];

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
 * - AWS（S3 + CloudFront + Lambda の SPA）: S3（s3）を外す（CloudFront はシェルと API に残る）。投稿は Lambda が受けて R2 に書き、
 *   その転送を東京 → インターネットの転送（月 100 GB 無料の後 $0.114/GB）で数える（Lambda の料金ページ: リージョンの外との
 *   データの出入りは EC2 のデータ転送の料金）。
 * R2 は書き込みの受信に課金しない（料金表に項目が無い）。
 */
function hostImageShape(
  host: Platform,
  arch: ArchitectureInput,
): { remove: string[]; write: string[]; out?: ArchNodeIn } | undefined {
  if (host === 'vercel') return { remove: ['image', 'blob'], write: ['fn'] };
  if (host !== 'aws') return undefined;
  if (arch.id === 'aws-amplify')
    return { remove: ['image', 'cf', 's3'], write: ['ssr'] };
  return {
    remove: ['s3'],
    write: ['apigw', 'lambda', 'aws-out'],
    out: {
      // 転送を数えるだけのノード（cdn の種類でヒットなし。課金は転送だけ）
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
