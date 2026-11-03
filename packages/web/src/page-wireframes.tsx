// ページの見取り図（D-102）。区画と作られ方はシナリオのデータ（ScenarioText.wireframes）から読み、
// 選んだフレームワークと記事のページの部品「コメント欄」（D-82・D-109）で game の pageWireframes が解く。ここはフレームワークを知らない。
// 区画は daisyUI の skeleton を使わない（読み込み中の印で、光る動きと塗りが作られ方の色を消すため）。札は badge。
import {
  REGION_NEEDS,
  REGION_SOURCES,
  type PageBadge,
  type pageWireframes,
  type RegionNeed,
  type RegionSource,
  type scenarioWireframes,
} from 'game';
import type { CSSProperties } from 'react';
import { RegionSkeleton } from './region-skeleton.tsx';

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

export type ScenarioPage = ReturnType<typeof scenarioWireframes>[number];

const NEED_ORDER = Object.keys(REGION_NEEDS) as RegionNeed[];

/** 区画の要件の札（中立の枠線。作られ方の札・色と見分けられるよう塗らない。D-113）。 */
function NeedTag({ need }: { need: RegionNeed }) {
  return (
    <span className="inline-block rounded-full border border-base-content/40 bg-base-100 px-1 text-[10px] leading-tight whitespace-nowrap">
      {REGION_NEEDS[need].short}
    </span>
  );
}

/**
 * シナリオの説明のページの見取り図（D-113）。フレームワークに依らず、区画が何で、何が要るかを札で出す（作られ方は出さない）。
 * 選択のカードの見取り図（作られ方の色）と見分けるため、区画は破線の枠と中立の灰色で描く。区画の中は種類（RegionKind）ごとの
 * 静的なスケルトン（本物のページに近い見た目。飾りなので aria-hidden）で、要件の札は右上に重ね、名前は小さい文字で添える（D-113 の追記）。
 * ページはブラウザの窓の形の小さい図（広い画面で 320px 幅）で、広い画面では横に並べる。
 */
export function ScenarioWireframes({
  pages,
  captionOf,
}: {
  pages: ScenarioPage[];
  /** ページの説明の行（シナリオのページの一覧の文。D-101）。 */
  captionOf?: (p: ScenarioPage) => string | undefined;
}) {
  if (pages.length === 0) return null;
  const used = new Set(pages.flatMap((p) => p.regions.flatMap((r) => r.needs)));
  return (
    <div className="space-y-2">
      <div className={`grid gap-3 ${pages.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {pages.map((p) => {
          const caption = captionOf?.(p);
          const traits = [
            p.audience === 'public' ? '全員に同じ中身' : '人ごとに違う中身',
            p.needsOgp ? 'SNS のカードが要る' : 'SNS のカードは要らない',
          ];
          return (
            <section
              key={p.route}
              aria-label={`${p.label}（シナリオ）`}
              data-scenario-page={p.route}
              className="space-y-1.5 rounded-box border border-dashed border-base-content/30 p-2"
            >
              <h4 className="text-sm font-semibold">{p.label}</h4>
              {caption && <p className="text-xs opacity-80">{caption}</p>}
              <div className="w-full overflow-hidden rounded-lg border border-base-content/20 bg-base-100 shadow-sm sm:w-80">
                {/* ブラウザの窓の上の帯（飾り） */}
                <div
                  aria-hidden
                  className="flex items-center gap-1 border-b border-base-content/10 bg-base-200 px-2 py-1"
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-base-content/25"
                    />
                  ))}
                  <span className="ml-1.5 h-2.5 flex-1 rounded-full bg-base-100" />
                </div>
                <ul
                  aria-label={`${p.label}の見取り図（要件）`}
                  className="grid grid-cols-2 gap-1 p-1.5"
                >
                  {p.regions.map((r) => (
                    <li
                      key={r.id}
                      data-region={r.id}
                      title={`${r.label}: ${r.needs.map((n) => REGION_NEEDS[n].short).join('・')}`}
                      className={`${r.width === 'half' ? 'col-span-1' : 'col-span-2'} relative flex flex-col justify-between gap-1 rounded border border-dashed border-base-content/20 px-1.5 pt-1.5 pb-0.5`}
                    >
                      <RegionSkeleton kind={r.kind ?? 'body'} />
                      <span className="block text-[9px] leading-tight opacity-60">
                        {r.label}
                      </span>
                      <span className="sr-only">: </span>
                      {/* 要件の札は区画の右上に重ねる */}
                      <span className="absolute top-0.5 right-0.5 flex max-w-[85%] flex-wrap justify-end gap-0.5">
                        {r.needs.map((n, i) => (
                          <span key={n}>
                            {i > 0 && <span className="sr-only">・</span>}
                            <NeedTag need={n} />
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <ul
                aria-label={`${p.label}の性質`}
                className="space-y-0.5 text-xs opacity-80"
              >
                <li>{traits.join('・')}</li>
                {p.freshness && <li>鮮度: {p.freshness}</li>}
                {p.parts.length > 0 && (
                  <li>動きのある部品: {p.parts.join('・')}</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      <ul
        aria-label="要件の札の凡例"
        className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
      >
        {NEED_ORDER.filter((n) => used.has(n)).map((n) => (
          <li key={n} className="flex items-center gap-1">
            <NeedTag need={n} />
            <span className="opacity-70">{REGION_NEEDS[n].long}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-60">
        見取り図はゲーム上の仮定。作り方（ビルド・キャッシュ・閲覧ごとに描く・ブラウザが取る）は、下の
        ② でフレームワークと描き方を選ぶと出る。
      </p>
    </div>
  );
}
