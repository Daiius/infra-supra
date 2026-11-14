// ページの見取り図（D-102）。区画と作られ方はシナリオのデータ（ScenarioText.wireframes）から読み、
// 選んだフレームワークと記事のページの部品「コメント欄」（D-82・D-109）で game の pageWireframes が解く。ここはフレームワークを知らない。
// 区画は daisyUI の skeleton を使わない（読み込み中の印で、光る動きと塗りが作られ方の色を消すため）。札は badge。
import clsx from 'clsx';
import {
  REGION_NEEDS,
  REGION_SOURCES,
  type OffscreenElement,
  type PageBadge,
  type pageWireframes,
  type RegionNeed,
  type RegionSource,
  type scenarioWireframes,
} from 'game';
import type { CSSProperties } from 'react';
import { Info } from './info.tsx';
import { KIND_TONE, RegionSkeleton } from './region-skeleton.tsx';

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
          className={`${r.width === 'half' ? 'col-span-1' : 'col-span-2'} ${HEIGHT[r.height ?? 'sm']} flex min-w-0 flex-col gap-0.5 rounded border p-1 ${SOURCE_CLASS[r.source]}`}
          style={SOURCE_STYLE[r.source]}
        >
          {/* 区画の名前と作られ方の札を上の行に並べる（狭い区画では札が次の行へ折り返す。シナリオの見取り図と同じ並べ方） */}
          <span className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
            <span className="block text-[11px] leading-tight font-medium">
              {r.label}
            </span>
            <span className="sr-only">: </span>
            <span
              className="badge h-auto badge-xs bg-base-100/85 py-0.5 text-[10px] leading-tight whitespace-normal"
              {...(r.sourceNote ? { title: r.sourceNote } : {})}
            >
              {r.sourceLabel}
            </span>
          </span>
          {/* 中身の形（シナリオの見取り図と同じスケルトン。始める画面ではシナリオの見取り図をダイアログに畳んだので、ここで見せる） */}
          {/* 地の色が作られ方を表すので、中身の形は色を抜いて薄く描く（画像・人の色が地の色と混ざってにごらないように） */}
          <span className="block opacity-70 grayscale">
            <RegionSkeleton kind={r.kind ?? 'body'} />
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
  // 札はフレームワークの呼び名（D-193）。同じ作られ方の区画は同じ札なので、最初の区画のものを使う
  const labelOf = new Map(
    pages
      .flatMap((p) => p.regions)
      .reverse()
      .map((r) => [r.source, r.sourceLabel] as const),
  );
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
            <span className="font-semibold">
              {labelOf.get(s) ?? REGION_SOURCES[s].short}
            </span>
            : <span className="opacity-80">{REGION_SOURCES[s].long}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export type ScenarioPage = ReturnType<typeof scenarioWireframes>[number];

const NEED_ORDER = Object.keys(REGION_NEEDS) as RegionNeed[];

/**
 * 区画の要件の札（白っぽい地・細い枠・灰色の字。D-113）。作られ方・描き方の色（success・info・warning・secondary・accent の枠と淡い塗り、
 * 選んだものの primary）と見分けられるよう、有彩色を使わず base 系の色だけで描く。
 * 凡例は ⓘ に畳んだので、札そのものに長い説明を持たせる（hover の title と、読み上げ用の sr-only。凡例の中では重ねない）。
 */
function NeedTag({
  need,
  describe = true,
}: {
  need: RegionNeed;
  describe?: boolean;
}) {
  return (
    <span
      title={describe ? REGION_NEEDS[need].long : undefined}
      className="inline-block rounded-full border border-base-content/25 bg-base-100/90 px-1 text-[10px] leading-tight whitespace-nowrap text-base-content/75"
    >
      {REGION_NEEDS[need].short}
      {describe && (
        <span className="sr-only">（{REGION_NEEDS[need].long}）</span>
      )}
    </span>
  );
}

/** ページの見る人の短い札（全員に同じ中身 / 人ごとに違う中身）。ページ名の横に出す。 */
const audienceText = (p: ScenarioPage) =>
  p.audience === 'public' ? '全員に同じ中身' : '人ごとに違う中身';

/**
 * シナリオの説明のページの見取り図（D-113）。フレームワークに依らず、区画が何で、何が要るかを札で出す（作られ方は出さない）。
 * 選択のカードの見取り図（はっきりした地と実線の枠が作られ方の色）と見分けるため、区画は破線の枠と、種類（RegionKind）の系統ごとの
 * より淡い地（KIND_TONE。テーマの色でない Tailwind の色）で描く。中は種類ごとのスケルトン（本物のページに近い見た目。飾りなので aria-hidden）（D-113 の追記）。
 * 区画の名前と要件の札は区画の上の行に並べる（札が中身に重ならないように）。
 * ページはブラウザの窓の形の小さい図（広い画面で 320px 幅）で、広い画面では横に並べる。呼ぶ側で灰色の帯に載せ、窓を白く浮かせる。
 * 札の凡例・ページの性質・注記は、縦の量を減らすため見出しの横の ⓘ（ScenarioWireframesInfo）に畳む。
 * ページ名の横には見る人の札だけを残す（D-113 の補足・2026-11-05）。
 */
export function ScenarioWireframes({
  pages,
  captionOf,
  offscreen = [],
}: {
  pages: ScenarioPage[];
  /** ページの説明の行（シナリオのページの一覧の文。D-101）。 */
  captionOf?: (p: ScenarioPage) => string | undefined;
  /** ページの外の要素（メールなど。見取り図の下に 1 行で出す。D-117）。 */
  offscreen?: OffscreenElement[];
}) {
  if (pages.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className={clsx('grid gap-3', pages.length > 1 && 'md:grid-cols-2')}>
        {pages.map((p) => {
          const caption = captionOf?.(p);
          return (
            <section
              key={p.route}
              aria-label={`${p.label}（シナリオ）`}
              data-scenario-page={p.route}
              className="min-w-0 space-y-1.5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h4 className="text-base font-bold">{p.label}</h4>
                <span
                  data-audience={p.audience}
                  className="badge badge-ghost badge-sm"
                >
                  {audienceText(p)}
                </span>
              </div>
              {caption && <p className="text-xs opacity-80">{caption}</p>}
              <div className="w-full overflow-hidden rounded-lg border border-base-content/30 bg-base-100 shadow-md sm:w-80">
                {/* ブラウザの窓の上の帯（飾り） */}
                <div
                  aria-hidden
                  className="flex items-center gap-1 border-b border-base-content/25 bg-base-300/60 px-2 py-0.5"
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
                  className="grid grid-cols-2 gap-0.5 p-1"
                >
                  {p.regions.map((r) => (
                    <li
                      key={r.id}
                      data-region={r.id}
                      title={`${r.label}: ${r.needs.map((n) => REGION_NEEDS[n].short).join('・')}`}
                      className={`${r.width === 'half' ? 'col-span-1' : 'col-span-2'} flex min-w-0 flex-col gap-0.5 rounded border border-dashed px-1.5 pt-0.5 pb-1 ${KIND_TONE[r.kind ?? 'body']}`}
                    >
                      {/* 区画の名前と要件の札を上の行に並べる（狭い区画では札が次の行へ折り返す） */}
                      <span className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
                        <span className="block text-[10px] leading-tight font-medium opacity-70">
                          {r.label}
                        </span>
                        <span className="sr-only">: </span>
                        <span className="flex flex-wrap justify-end gap-0.5">
                          {r.needs.map((n, i) => (
                            <span key={n}>
                              {i > 0 && <span className="sr-only">・</span>}
                              <NeedTag need={n} />
                            </span>
                          ))}
                        </span>
                      </span>
                      <RegionSkeleton kind={r.kind ?? 'body'} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
      {offscreen.map((e) => (
        <OffscreenLine key={e.label} element={e} />
      ))}
    </div>
  );
}

/**
 * 見取り図の見出しの横の ⓘ（D-113 の補足・2026-11-05）。要件の札の凡例・ページごとの性質（RS-17）・注記を畳む。
 * 呼ぶ側が見出しの横に置く（見出しは呼ぶ側の帯が持つ）。
 */
export function ScenarioWireframesInfo({ pages }: { pages: ScenarioPage[] }) {
  if (pages.length === 0) return null;
  const used = new Set(pages.flatMap((p) => p.regions.flatMap((r) => r.needs)));
  return (
    <Info label="ページの見取り図の説明">
      <div className="space-y-3">
        <p className="font-semibold">区画の札</p>
        <ul aria-label="要件の札の凡例" className="space-y-1">
          {NEED_ORDER.filter((n) => used.has(n)).map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <span className="shrink-0">
                <NeedTag need={n} describe={false} />
              </span>
              <span className="opacity-80">{REGION_NEEDS[n].long}</span>
            </li>
          ))}
        </ul>
        {pages.map((p) => (
          <div key={p.route}>
            <p className="font-semibold">{p.label}</p>
            <ul
              aria-label={`${p.label}の性質`}
              className="list-disc pl-5 opacity-80"
            >
              <li>
                {audienceText(p)}・
                {p.needsOgp ? 'SNS のカードが要る' : 'SNS のカードは要らない'}
              </li>
              {p.freshness && <li>鮮度: {p.freshness}</li>}
              {p.parts.length > 0 && (
                <li>動きのある部品: {p.parts.join('・')}</li>
              )}
            </ul>
          </div>
        ))}
        <p className="opacity-70">
          見取り図はゲーム上の仮定です。作り方（ビルド・キャッシュ・閲覧ごとに描く・ブラウザが取る）は、②
          でフレームワークと描き方を選ぶと出ます。
        </p>
      </div>
    </Info>
  );
}

/** 封筒のアイコン（飾り）。 */
function EnvelopeIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-base-content/60"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
    >
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}

/**
 * ページの外の要素の 1 行（D-117。今はメールだけ）。ページの区画ではないので、ブラウザの窓の外に置き、要件の札・作られ方の色・
 * 区画の淡い地は使わない（base 系の色と破線の枠だけ）。描き方の選択（②）とは関係しない。
 * 縦の量を減らすため、題と送るものを 1 行に詰め（狭い画面では省略し title に全文）、何が効くか（note）は ⓘ に畳む（D-117 の補足・2026-11-05）。
 */
function OffscreenLine({ element: e }: { element: OffscreenElement }) {
  const summary = e.items.join('・');
  return (
    <section
      aria-label={e.label}
      data-offscreen={e.kind}
      className="flex w-full max-w-xl items-center gap-1.5 rounded-lg border border-dashed border-base-content/30 bg-base-100 px-2 py-0.5 text-xs"
    >
      {e.kind === 'email' && <EnvelopeIcon />}
      <p className="min-w-0 flex-1 truncate" title={`${e.label}: ${summary}`}>
        <span className="font-bold">{e.label}</span>: {summary}
      </p>
      <Info label={`${e.label}の説明`}>
        <div className="space-y-1">
          <p className="font-semibold">{e.label}</p>
          <ul className="list-disc pl-5">
            {e.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {e.note && <p className="opacity-80">{e.note}</p>}
        </div>
      </Info>
    </section>
  );
}
