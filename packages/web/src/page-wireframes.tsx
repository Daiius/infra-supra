// 始める画面のページの見取り図（D-102）。区画と作られ方はシナリオのデータ（ScenarioText.wireframes）から読み、
// 選んだフレームワークと設定「コメントの描き方」（D-82）で game の pageWireframes が解く。画面はフレームワークを知らない。
import {
  FRAMEWORKS,
  pageWireframes,
  REGION_SOURCES,
  type FrameworkId,
  type RegionSource,
  type Scenario,
} from 'game';
import type { CSSProperties } from 'react';

/** 作られ方ごとの見た目（補助。必ず札の文字を添える）。 */
const SOURCE_CLASS: Record<RegionSource, string> = {
  build: 'border-success bg-success/15',
  isr: 'border-info bg-info/15',
  ssr: 'border-warning bg-warning/15',
  api: 'border-dashed border-secondary bg-secondary/10',
  island: 'border-dashed border-secondary bg-secondary/10',
  shell: 'border-base-content/40 bg-base-200',
  image: 'border-dotted border-accent bg-accent/10',
};

/** 閲覧ごとにサーバーが描く区画は斜線も重ねる（色に頼らない手がかり）。 */
const SOURCE_STYLE: Partial<Record<RegionSource, CSSProperties>> = {
  ssr: {
    backgroundImage:
      'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--color-warning) 30%, transparent) 6px 8px)',
  },
};

const HEIGHT = { sm: 'min-h-9', md: 'min-h-14', lg: 'min-h-20' } as const;

const ORDER = Object.keys(REGION_SOURCES) as RegionSource[];

export function PageWireframes({
  scenario,
  framework,
  comments,
}: {
  scenario: Scenario;
  framework: FrameworkId;
  /** 始める画面で選べるときだけ渡す（省略はブラウザで読み込む）。 */
  comments?: number | undefined;
}) {
  const pages = pageWireframes(scenario, framework, comments);
  if (pages.length === 0) return null;
  const used = new Set(pages.flatMap((p) => p.regions.map((r) => r.source)));
  const fw = FRAMEWORKS[framework].label;
  return (
    <section aria-label="ページの見取り図" className="space-y-2">
      <h3 className="mt-2 font-bold">ページの見取り図（{fw}）</h3>
      <p className="text-xs opacity-70">
        選んだフレームワークで、ページのどの部分をどう作るか。フレームワークや設定「コメントの描き方」を変えると、札が変わる（図はゲーム上の仮定）。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {pages.map((p) => (
          <figure key={p.route} className="w-full space-y-1 sm:w-64">
            <figcaption className="text-sm font-semibold">{p.label}</figcaption>
            <ul
              aria-label={`${p.label}の見取り図`}
              className="grid grid-cols-2 gap-1 rounded-box border border-base-300 bg-base-100 p-1.5"
            >
              {p.regions.map((r) => (
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
                  <span className="mt-0.5 inline-block rounded bg-base-100/85 px-1 text-[10px] leading-tight">
                    {REGION_SOURCES[r.source].short}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        ))}
      </div>
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
    </section>
  );
}
