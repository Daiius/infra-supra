// Netlify の構成（D-71・prd/11 §14）。Next.js（OpenNext のアダプター）・Vite の SPA・Astro（Netlify のアダプター）を載せ、
// DB は Netlify の外（既定は Supabase）。料金は providers/netlify.ts（クレジットを金額に直したメーター）。
// SPA と Astro の形はここで直接組む（index.ts の asSpa・asAstro は通さない。AWS と同じ）。ノードの id は Vercel の構成と同じ
// （cdn・fn・image・blob・db）にして、他の事業者の部品（cross.ts）の差し方を揃える。
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  browserCallsApi,
  rebuildsStaticPages,
  type FrameworkId,
} from '../frameworks/index.ts';
import type { Choices, ComponentOption, StackDef } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];
type NetlifyPlan = 'free' | 'personal' | 'pro';

export const NETLIFY_STACK_DEFS: readonly StackDef[] = [
  {
    id: 'netlify-supabase-free',
    platform: 'netlify',
    plan: 'free',
    name: 'Netlify Free + Supabase Free',
  },
  {
    id: 'netlify-supabase-personal',
    platform: 'netlify',
    plan: 'personal',
    name: 'Netlify Personal + Supabase Free',
  },
  {
    id: 'netlify-supabase-pro',
    platform: 'netlify',
    plan: 'pro',
    name: 'Netlify Pro + Supabase Pro',
  },
];

export const NETLIFY_DEFAULT_CHOICES: Choices = {
  isrCache: 'default',
  images: 'default',
  db: 'supabase',
};

/** Netlify の CDN の画像のヒット率（仮定。Vercel の CDN と同じ値）。 */
const IMAGE_CDN_HIT_RATE = 0.9;
/** 関数のメモリ（GB）。既定の 1,024 MB（Free・Personal は替えられない。D-71）。 */
const FUNCTION_MEMORY_GB = 1;

const CREDIT_REFS = ['credit:netlify:'];

const RESIZE_NOTE =
  '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて置き、原本は残さない。変換のサービスの費用はかからず、保存量も小さい。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）';

export const NETLIFY_COMPONENTS: readonly ComponentOption[] = [
  // DB（D-77）。既定は Supabase（構成の名前の DB）。Neon（従量の Postgres）は cross.ts の他の事業者の部品
  {
    id: 'supabase',
    slot: 'db',
    platform: 'netlify',
    label: 'Supabase（Postgres）',
    note: 'Free・Personal は Supabase Free、Pro は Supabase Pro（月の基本料つき・Micro のサーバーが常に動く）。関数から接続のプール（pooler）でつなぐ',
    premiseRefs: [
      'fact:supabase:pro-micro:compute',
      'limit:supabase:pro-micro:pooler-connections',
      'limit:supabase:free:db-size',
    ],
  },
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'netlify',
    label: 'ISR（Netlify の CDN のキャッシュ）',
    note: 'ISR のページは CDN が返し、期限が来たページは関数が作り直す。オンデマンドの再検証（パス・タグ）にも対応する（OpenNext のアダプター）',
    premiseRefs: ['fact:netlify:'],
    onDemandIsr: { ok: true, fact: 'netlify:pro:next-runtime' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'netlify',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回関数まで届き、関数の GB 時間（クレジット）が増える。記事は常に新しい',
    premiseRefs: CREDIT_REFS,
  },
  {
    id: 'default',
    slot: 'images',
    platform: 'netlify',
    label: 'Netlify Image CDN（閲覧のときに変換）',
    note: '閲覧のときに変換して拠点にキャッシュする。クレジットの表に変換の項目は無く、配信のリクエストと転送量（クレジット）だけを数える。原本は Netlify Blobs（料金は未公開）',
    premiseRefs: ['fact:netlify:pro:image-cdn', ...CREDIT_REFS],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'netlify',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）をそのまま配る。転送量（クレジット）が大きく増え、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: CREDIT_REFS,
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'netlify',
    label: '投稿のときに一律で縮めて置く',
    note: RESIZE_NOTE,
    premiseRefs: [],
  },
  // API の置き場の既定（同じ事業者）。他の事業者に置く部品は cross.ts の CROSS_COMPONENTS
  ...(
    [
      [
        'vite-spa',
        '同じサイトの Netlify Functions に API を置き、DB は Supabase。同じドメインなので CORS の設定は要らない',
      ],
      [
        'nextjs',
        'Next.js のサーバー（Netlify Functions）が同じ構成の Supabase を直接読む。API を別に立てない',
      ],
      [
        'astro',
        'Astro のサーバー（Netlify のアダプター・Netlify Functions）が同じ構成の Supabase を直接読む。API を別に立てない',
      ],
      [
        'nextjs-export',
        '同じサイトの Netlify Functions に API を置き、DB は Supabase。ブラウザ（Client Component）から呼ぶ。同じドメインなので CORS の設定は要らない',
      ],
    ] as const
  ).map(([framework, note]): ComponentOption => ({
    id: 'same',
    slot: 'api',
    platform: 'netlify',
    frameworks: [framework],
    label: '同じ事業者（同居）',
    note,
    premiseRefs: [],
  })),
  // SPA の SNS のカード（OGP）の前処理（prd/10 F-07）
  {
    id: 'none',
    slot: 'ogp',
    platform: 'netlify',
    frameworks: ['vite-spa'],
    label: '前処理しない（全ページ同じカード）',
    note: 'シェルのメタタグは全ページ同じ。記事ごとのカードは出ない（ゲーム上の仮定: SNS の話題が伸びにくい）',
    premiseRefs: [],
  },
  {
    id: 'prerender',
    slot: 'ogp',
    platform: 'netlify',
    frameworks: ['vite-spa'],
    label: 'OGP の前処理',
    note: 'シェルを CDN から返さず、関数が記事のメタタグを差し込んで返す。シェルの読み込みが関数の起動（GB 時間）になる',
    premiseRefs: CREDIT_REFS,
  },
  // SPA の API の応答のキャッシュ（D-37）
  {
    id: 'none',
    slot: 'apiCache',
    platform: 'netlify',
    frameworks: ['vite-spa'],
    label: 'なし',
    note: '記事の中身の API を毎回処理して DB を読む。記事は常に新しい',
    premiseRefs: [],
  },
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'netlify',
    frameworks: ['vite-spa'],
    label: 'CDN のキャッシュ（Netlify-CDN-Cache-Control）',
    note: '記事の中身の API の応答にキャッシュの見出しを付け、ヒットは CDN が返す（関数の GB 時間が減る。リクエストと転送量は残る）。タグで数秒のうちに消せる',
    premiseRefs: ['fact:netlify:pro:cdn-cache-functions', ...CREDIT_REFS],
  },
];

/**
 * Netlify に載せる（Next.js・SPA・Astro）。DB は Supabase（Free・Personal は Supabase Free、Pro は Supabase Pro）。
 * - CDN は Web requests と Bandwidth、関数は GB 時間（実行時間 × 1 GB）だけを数える（関数へのリクエストは CDN で数える）。
 * - 画像の原本は Netlify Blobs（料金は未公開。保存量を料金未取得の明細で残す）。最適化しない画像は CDN を通り、miss は
 *   Edge Function が Blobs から返す（Edge Functions はリクエストとして数える。仮定の作り）。
 * - Astro の静的なページの更新はビルドし直しで、本番へのデプロイ 1 回ごとにクレジットを使う。
 */
export function composeNetlify(
  plan: NetlifyPlan,
  choices: Choices,
  opts: {
    framework: FrameworkId;
    prerender: boolean;
    apiCache: string;
  },
): ArchitectureInput {
  const bill = (meters: Record<string, string>) => ({
    accountId: 'netlify',
    provider: 'netlify',
    planId: plan,
    meters,
  });
  // Next.js の静的書き出し（D-80）は SPA と同じ形（静的 + Functions の API）に、Astro と同じビルドし直しを足す
  const spa = browserCallsApi(opts.framework);
  const nextExport = opts.framework === 'nextjs-export';
  const astro = opts.framework === 'astro';
  const isr = !spa && !astro && choices.isrCache !== 'none';
  const optimize = choices.images !== 'none' && choices.images !== 'resize';
  const cachedApi = spa && opts.apiCache === 'cdn';
  const prerender = spa && opts.prerender;
  const ttl: RequestClass[] = [
    ...(isr ? (['document-isr'] as const) : []),
    ...(cachedApi ? (['api-content'] as const) : []),
  ];
  const nodes: ArchNodeIn[] = [
    {
      id: 'cdn',
      label: 'Netlify CDN',
      config: {
        kind: 'cdn',
        hitRate: {
          asset: 1,
          'document-static': prerender ? 0 : 1,
          'image-read': IMAGE_CDN_HIT_RATE,
        },
        // ISR のページと API の応答のヒット率は、閲覧の密度 × 期間から出す（D-37）
        ...(ttl.length ? { ttlClasses: ttl } : {}),
      },
      ...(cachedApi ? { facts: ['cdn-cache-functions'] } : {}),
      billing: bill({ requests: 'web-requests', 'egress-gb': 'bandwidth' }),
    },
    {
      id: 'fn',
      label: spa
        ? prerender
          ? 'Netlify Functions（API・OGP の前処理）'
          : 'Netlify Functions（API）'
        : astro
          ? 'Netlify Functions（Astro）'
          : 'Netlify Functions（Next.js）',
      config: {
        kind: 'function',
        memoryGB: FUNCTION_MEMORY_GB,
        concurrency: 1,
      },
      ...(spa || astro ? {} : { facts: ['next-runtime'] }),
      billing: bill({ 'memory-gb-hours': 'compute' }),
    },
    ...(optimize
      ? [
          {
            id: 'image',
            label: 'Netlify Image CDN',
            config: { kind: 'image-optimizer' },
            facts: ['image-cdn'],
            billing: bill({}),
          } as ArchNodeIn,
        ]
      : []),
    // 画像の投稿は関数へのリクエスト（Web requests）。CDN のノードに通すと投稿の大きさを転送量に数えてしまうので、
    // リクエストだけを数えるノードを前に置く（受け取るデータは転送に数えない。OCL-0FA096BD）
    {
      id: 'upload',
      label: 'Netlify（画像の投稿のリクエスト）',
      config: { kind: 'cdn', hitRate: {} },
      billing: bill({ requests: 'web-requests' }),
    },
    {
      id: 'blob',
      label: 'Netlify Blobs（画像の原本）',
      config: { kind: 'object-storage' },
      facts: ['blobs'],
      billing: bill({ 'storage-gb-month': 'blobs-storage' }),
    },
    {
      id: 'db',
      label: plan === 'pro' ? 'Supabase Pro（Micro）' : 'Supabase Free',
      config: { kind: 'managed-db' },
      billing: {
        accountId: 'supabase',
        provider: 'supabase',
        planId: plan === 'pro' ? 'pro-micro' : 'free',
        meters:
          plan === 'pro'
            ? {
                'instance-hours': 'compute',
                'egress-gb': 'egress',
                'storage-gb-month': 'disk',
              }
            : { 'egress-gb': 'egress' },
      },
    },
    ...(rebuildsStaticPages(opts.framework)
      ? [
          {
            id: 'build',
            label: 'Netlify のビルド（静的なページの本番デプロイ）',
            config: { kind: 'ci-build' },
            facts: ['deploys'],
            billing: bill({ deploys: 'production-deploys' }),
          } as ArchNodeIn,
        ]
      : []),
  ];
  const images: Partial<Record<RequestClass, string[]>> = {
    'image-read': optimize ? ['cdn', 'image'] : ['cdn', 'blob'],
    'image-write': ['upload', 'fn', 'blob'],
    ...(optimize ? { 'image-transform': ['image'] } : {}),
  };
  const routes: Partial<Record<RequestClass, string[]>> = spa
    ? {
        'document-static': prerender ? ['cdn', 'fn'] : ['cdn'],
        asset: ['cdn'],
        api: ['cdn', 'fn', 'db'],
        'api-content': ['cdn', 'fn', 'db'],
        ...images,
      }
    : {
        'document-static': ['cdn'],
        asset: ['cdn'],
        'document-ssr': ['cdn', 'fn', 'db'],
        ...(isr
          ? {
              // CDN の miss は関数が返す（期限切れの作り直しは関数が裏で行う）
              'document-isr': ['cdn', 'fn'],
              'isr-revalidate': ['fn', 'db'],
            }
          : {}),
        api: ['cdn', 'fn', 'db'],
        ...images,
      };
  const base = NETLIFY_STACK_DEFS.find((d) => d.plan === plan)!;
  return {
    id: base.id,
    name: nextExport
      ? `${base.name}（Next.js の静的書き出し）`
      : spa
        ? `${base.name}（Vite の SPA）`
        : astro
          ? `${base.name}（Astro）`
          : base.name,
    nodes,
    routes,
  };
}
