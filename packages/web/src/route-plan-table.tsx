// ページごとの描き方の表（D-106・読むだけ）。始める画面のフレームワークのカードと見積モードで共有する。
// 行は game の routePlanRows（workloadFor が当てる描き方と同じ）。色は見取り図の作られ方の色を流用し、必ず文字を添える。
import type { RegionSource, RoutePlanRow, RouteStrategyId } from 'game';
import { Info } from './info.tsx';
import { SOURCE_CLASS, SOURCE_STYLE } from './page-wireframes.tsx';

/** 描き方 → 見取り図の作られ方（色だけに使う）。 */
const STRATEGY_SOURCE: Record<RouteStrategyId, RegionSource> = {
  'static-build': 'build',
  'cached-ttl': 'isr',
  'cached-purge': 'cached',
  ssr: 'ssr',
  'shell-api': 'api',
  'server-island': 'island',
};

function Swatch({ strategy }: { strategy: RouteStrategyId }) {
  const s = STRATEGY_SOURCE[strategy];
  return (
    <span
      aria-hidden
      className={`mt-0.5 inline-block h-3 w-4 shrink-0 rounded-sm border ${SOURCE_CLASS[s]}`}
      style={SOURCE_STYLE[s]}
    />
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * ページ → 描き方 → なぜ → この構成でほかに選べる描き方（使えないものは灰色と理由の ⓘ）。
 * caption: 表の下の注記（どこで決まっているか）。
 */
export function RoutePlanTable({
  rows,
  caption,
}: {
  rows: RoutePlanRow[];
  caption?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0 space-y-1">
      <div className="overflow-x-auto">
        <table className="table table-xs" aria-label="ページごとの描き方">
          <thead>
            <tr>
              <th>ページ</th>
              <th>描き方</th>
              <th>なぜ</th>
              <th>ほかの描き方（この構成で）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.route} data-route={r.route} className="align-top">
                <th className="font-medium whitespace-nowrap">
                  {r.label}
                  <span className="block text-[11px] font-normal opacity-60">
                    {r.audience === 'public' ? '全員に同じ' : '人ごとに違う'}・
                    {pct(r.share)}
                  </span>
                </th>
                <td className="min-w-40" data-strategy={r.strategy}>
                  <span className="flex items-start gap-1.5">
                    <Swatch strategy={r.strategy} />
                    <span>
                      <span className="opacity-60">{r.code}</span>{' '}
                      {r.strategyLabel}
                    </span>
                  </span>
                  {r.detail.length > 0 && (
                    <ul className="mt-0.5 text-[11px] opacity-70">
                      {r.detail.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                  {r.overriddenBy && (
                    <span className="mt-0.5 block text-[11px] text-warning">
                      既定から変わっている: {r.overriddenBy}
                    </span>
                  )}
                </td>
                <td className="min-w-48 text-xs opacity-80">{r.why}</td>
                <td className="min-w-48">
                  <ul className="flex flex-wrap gap-1">
                    {r.alternatives.map((a) => (
                      <li
                        key={a.strategy}
                        data-alternative={a.strategy}
                        data-available={a.available}
                        className={`inline-flex items-center gap-1 rounded border border-base-300 px-1 py-0.5 text-[11px] ${
                          a.available ? '' : 'bg-base-200 opacity-50'
                        }`}
                      >
                        <span className="opacity-60">{a.code}</span>
                        {a.label}
                        {!a.available && (
                          <span className="sr-only">（使えない）</span>
                        )}
                        <Info
                          label={`${a.label}${a.available ? '' : 'が使えない理由'}`}
                        >
                          {a.reason}
                          {a.basis === 'assumption' && '（ゲーム上の仮定）'}
                        </Info>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <p className="text-xs opacity-60">{caption}</p>}
    </div>
  );
}

/** 表の下の注記（始める画面・見積モードで同じ文）。 */
export const ROUTE_PLAN_NOTE =
  '描き方は今、フレームワークの既定と、設定（再検証・記事のキャッシュ・コメントの描き方）と部品（ISR のキャッシュ・API の応答のキャッシュ）で決まる。ページごとに描き方を直す機能は準備中。確かめていない描き方（vinext の事前描画・Server Islands・PPR）は出していない。';
