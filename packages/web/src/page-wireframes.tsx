// ページの見取り図（D-102）。区画と作られ方はシナリオのデータ（ScenarioText.wireframes）から読み、
// 選んだフレームワークと記事のページの部品「コメント欄」（D-82・D-109）で game の pageWireframes が解く。ここはフレームワークを知らない。
// 区画は daisyUI の skeleton を使わない（読み込み中の印で、光る動きと塗りが作られ方の色を消すため）。札は badge。
import {
  REGION_SOURCES,
  type PageBadge,
  type pageWireframes,
  type RegionSource,
} from 'game';
import type { CSSProperties } from 'react';

export type ResolvedPage = ReturnType<typeof pageWireframes>[number];

/** 作られ方ごとの見た目（補助。必ず札の文字を添える）。 */
export const SOURCE_CLASS: Record<RegionSource, string> = {
  build: 'border-success bg-success/15',
  isr: 'border-info bg-info/15',
  cached: 'border-info bg-info/15',
  ssr: 'border-warning bg-warning/15',
  api: 'border-dashed border-secondary bg-secondary/10',
  island: 'border-dashed border-secondary bg-secondary/10',
  // 枠 + サーバーの島（S6。D-108）: 枠はキャッシュの色、島は閲覧ごとに描く色（斜線つき）を破線で
  'island-shell': 'border-info bg-info/10',
  'server-island': 'border-dashed border-warning bg-warning/15',
  // 部品ごとにキャッシュ（D-111）: キャッシュした部品はキャッシュの色、動的な穴は閲覧ごとに描く色（斜線つき）を点線で
  'cc-cached': 'border-info bg-info/20',
  'cc-dynamic': 'border-dotted border-warning bg-warning/15',
  shell: 'border-base-content/40 bg-base-200',
  image: 'border-dotted border-accent bg-accent/10',
};

/** 閲覧ごとにサーバーが描く区画は斜線も重ねる（色に頼らない手がかり）。 */
const PER_VIEW_STRIPES: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--color-warning) 30%, transparent) 6px 8px)',
};
export const SOURCE_STYLE: Partial<Record<RegionSource, CSSProperties>> = {
  ssr: PER_VIEW_STRIPES,
  'server-island': PER_VIEW_STRIPES,
  'cc-dynamic': PER_VIEW_STRIPES,
};

const HEIGHT = { sm: 'min-h-9', md: 'min-h-14', lg: 'min-h-20' } as const;

const ORDER = Object.keys(REGION_SOURCES) as RegionSource[];

const BADGE_CLASS: Record<PageBadge['kind'], string> = {
  freshness: 'badge-info badge-outline',
  ogp: 'badge-neutral badge-outline',
  cpu: 'badge-warning',
  api: 'badge-secondary badge-outline',
};

/** ページ 1 枚の見取り図（区画の並び。区画ごとに作られ方の札）。 */
export function PageWireframe({ page }: { page: ResolvedPage }) {
  return (
    <ul
      aria-label={`${page.label}の見取り図`}
      className="grid w-full grid-cols-2 gap-1 rounded-box border border-base-300 bg-base-100 p-1.5 lg:w-64 lg:shrink-0"
    >
      {page.regions.map((r) => (
        <li
          key={r.id}
          data-region={r.id}
          data-source={r.source}
          className={`${r.width === 'half' ? 'col-span-1' : 'col-span-2'} ${HEIGHT[r.height ?? 'sm']} rounded border p-1 ${SOURCE_CLASS[r.source]}`}
          style={SOURCE_STYLE[r.source]}
        >
          <span className="block text-[11px] leading-tight font-medium">
            {r.label}
          </span>
          <span className="sr-only">: </span>
          <span className="badge mt-0.5 h-auto badge-xs bg-base-100/85 py-0.5 text-[10px] leading-tight whitespace-normal">
            {REGION_SOURCES[r.source].short}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** ページの短い札（鮮度・SNS のカード・CPU の注意・API の増え方）。 */
export function PageBadges({ badges }: { badges: PageBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <ul aria-label="ページの札" className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <li
          key={b.text}
          className={`badge h-auto badge-sm py-0.5 whitespace-normal ${BADGE_CLASS[b.kind]}`}
        >
          {b.text}
        </li>
      ))}
    </ul>
  );
}

/** 見取り図に出ている作られ方だけの凡例。 */
export function WireframeLegend({ pages }: { pages: ResolvedPage[] }) {
  const used = new Set(pages.flatMap((p) => p.regions.map((r) => r.source)));
  return (
    <ul aria-label="見取り図の凡例" className="space-y-0.5 text-xs">
      {ORDER.filter((s) => used.has(s)).map((s) => (
        <li key={s} className="flex items-start gap-1.5">
          <span
            aria-hidden
            className={`mt-0.5 inline-block h-3 w-4 shrink-0 rounded-sm border ${SOURCE_CLASS[s]}`}
            style={SOURCE_STYLE[s]}
          />
          <span>
            <span className="font-semibold">{REGION_SOURCES[s].short}</span>:{' '}
            <span className="opacity-80">{REGION_SOURCES[s].long}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
