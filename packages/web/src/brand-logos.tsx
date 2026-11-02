// フレームワーク・事業者のロゴ（D-102）。識別のためだけに出す（ロゴは各社の商標）。図形のデータは simple-icons（CC0）だけから取り、
// 形は変えない。simple-icons に無いブランド（AWS・さくらインターネット）は自分で描かず、文字の頭文字のバッジにする。
// ロゴは aria-hidden で、名前は隣の文字で出す。黒一色のロゴ（Next.js・Vercel・Resend）は currentColor にして暗いテーマでも見えるようにする。
import type { ComponentProvider, FrameworkId, Platform } from 'catalog';
import {
  siAstro,
  siBunnydotnet,
  siCloudflare,
  siFirebase,
  siGooglecloud,
  siNeon,
  siNetlify,
  siNextdotjs,
  siResend,
  siSupabase,
  siVercel,
  siVite,
  type SimpleIcon,
} from 'simple-icons';

export type BrandId =
  | 'nextjs'
  | 'vite'
  | 'astro'
  | 'cloudflare'
  | 'vercel'
  | 'supabase'
  | 'sakura'
  | 'aws'
  | 'gcp'
  | 'firebase'
  | 'neon'
  | 'resend'
  | 'bunny'
  | 'netlify';

/** ブランドの名前と、simple-icons のアイコン（無いものは頭文字のバッジ）。 */
export const BRANDS: Readonly<
  Record<BrandId, { title: string; icon?: SimpleIcon; monogram?: string }>
> = {
  nextjs: { title: 'Next.js', icon: siNextdotjs },
  vite: { title: 'Vite', icon: siVite },
  astro: { title: 'Astro', icon: siAstro },
  cloudflare: { title: 'Cloudflare', icon: siCloudflare },
  vercel: { title: 'Vercel', icon: siVercel },
  supabase: { title: 'Supabase', icon: siSupabase },
  // simple-icons 16.36.0 に無い
  sakura: { title: 'さくらインターネット', monogram: 'さ' },
  aws: { title: 'AWS', monogram: 'AWS' },
  gcp: { title: 'Google Cloud', icon: siGooglecloud },
  firebase: { title: 'Firebase', icon: siFirebase },
  neon: { title: 'Neon', icon: siNeon },
  resend: { title: 'Resend', icon: siResend },
  bunny: { title: 'bunny.net', icon: siBunnydotnet },
  netlify: { title: 'Netlify', icon: siNetlify },
};

/** フレームワークのロゴ（静的書き出しは Next.js のロゴに「export」の小さい札）。 */
export const FRAMEWORK_BRAND: Readonly<
  Record<FrameworkId, { brand: BrandId; tag?: string }>
> = {
  nextjs: { brand: 'nextjs' },
  'nextjs-export': { brand: 'nextjs', tag: 'export' },
  'vite-spa': { brand: 'vite' },
  astro: { brand: 'astro' },
};

/** 構成の土台の事業者 → 構成に出てくる事業者（Vercel の構成は Supabase の DB と組む。Google Cloud は Firebase Hosting と組む）。 */
export const PLATFORM_BRANDS: Readonly<Record<Platform, BrandId[]>> = {
  cloudflare: ['cloudflare'],
  vercel: ['vercel', 'supabase'],
  sakura: ['sakura'],
  aws: ['aws'],
  'aws-opennext': ['aws'],
  netlify: ['netlify'],
  gcp: ['gcp', 'firebase'],
};

/** 部品の事業者 → ロゴ。 */
export const COMPONENT_BRAND: Readonly<Record<ComponentProvider, BrandId>> = {
  ...(Object.fromEntries(
    Object.entries(PLATFORM_BRANDS).map(([k, v]) => [k, v[0]!]),
  ) as Record<Platform, BrandId>),
  neon: 'neon',
  resend: 'resend',
  bunny: 'bunny',
};

/** ブランドの色（アクセントだけに使う。黒一色のものは undefined = 文字の色）。 */
export function brandColor(brand: BrandId): string | undefined {
  const hex = BRANDS[brand].icon?.hex;
  return hex && hex !== '000000' ? `#${hex}` : undefined;
}

/** ロゴ 1 つ（装飾。名前は隣に文字で出す）。 */
export function BrandMark({
  brand,
  size = 16,
  tag,
}: {
  brand: BrandId;
  size?: number;
  /** ロゴに添える小さい札（静的書き出しの「export」）。 */
  tag?: string | undefined;
}) {
  const b = BRANDS[brand];
  const mark = b.icon ? (
    <svg
      aria-hidden
      data-brand={brand}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="inline-block shrink-0"
      fill={brandColor(brand) ?? 'currentColor'}
    >
      <path d={b.icon.path} />
    </svg>
  ) : (
    <span
      aria-hidden
      data-brand={brand}
      data-fallback="monogram"
      className="badge badge-neutral badge-outline badge-xs shrink-0 px-1 font-semibold"
    >
      {b.monogram}
    </span>
  );
  if (!tag) return mark;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-0.5">
      {mark}
      <span className="badge badge-ghost badge-xs px-1">{tag}</span>
    </span>
  );
}

/** 構成の事業者のロゴを並べる。 */
export function PlatformMarks({ platform }: { platform: Platform }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-1">
      {PLATFORM_BRANDS[platform].map((b) => (
        <BrandMark key={b} brand={b} size={14} />
      ))}
    </span>
  );
}
