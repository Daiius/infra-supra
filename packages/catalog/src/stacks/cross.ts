// 事業者をまたぐ構成（prd/11 §2・D-52）。部品は自分の事業者（platform）を持ち、差せる土台の事業者（hosts）と
// 接続の形（link）を持つ。差せる組は CROSS_PAIRS の表で許したものだけ（AX-08。公式の文書で現実にできると確かめた組）。
// 表に無い組は部品の選択肢に出さない。今の組は「Vercel の画像だけ Cloudflare（R2 + 変換）」の 1 つ。
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
    hosts: ['vercel'],
    link: { via: 'http', as: 'images' },
    label: 'Cloudflare: R2 に置き、閲覧のときに Images で変換',
    note:
      '画像の原本を Cloudflare の R2 に置き、画像のドメイン（Cloudflare のゾーン）の URL で変換して配る。Vercel の CDN を通らないので、' +
      '画像の転送は Vercel の Fast Data Transfer にならない（R2 の転送は無料）。一意な変換（種類 × サイズ違い）を月ごとに数える。' +
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
    hosts: ['vercel'],
    link: { via: 'http', as: 'resize' },
    label: 'Cloudflare: 投稿のときに一律で縮めて R2 に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloudflare の R2 に置き、原本は残さない。' +
      '画像のドメイン（Cloudflare のゾーン）から配るので、画像の転送は Vercel の Fast Data Transfer にならない（R2 の転送は無料）。' +
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
 * 土台の構成に、他の事業者の部品を差す（composeStack から呼ぶ）。今は Vercel の画像のスロットだけ。
 * 画像の配信・保存・変換を Vercel の CDN・Vercel Blob・画像の最適化から、Cloudflare の R2・画像のドメインのキャッシュ・Images に移す。
 * 投稿（image-write）は今と同じく Vercel の関数が受けて R2 に書く（Class A）。関数から外への通信の Vercel の課金は
 * 公式の文書に記載が見当たらない（未確認）ので数えない。R2 は書き込みの受信に課金しない（料金表に項目が無い）。
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
  if (!opt || host !== 'vercel') return arch;
  const transform = opt.link!.as === 'images';
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  // Vercel Hobby（個人・非商用）は Images Free（月 5,000 の一意な変換まで・超えると 9422）、それ以外は Images Paid（仮定）
  const imagesPlan = plan === 'hobby' ? 'images-free' : 'images-paid';
  const nodes: ArchNodeIn[] = [
    ...arch.nodes.filter((n) => n.id !== 'image' && n.id !== 'blob'),
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
    'image-write': ['fn', 'cf-r2'],
  };
  if (transform) routes['image-transform'] = ['cf-images'];
  else delete routes['image-transform'];
  return { ...arch, nodes, routes };
}
