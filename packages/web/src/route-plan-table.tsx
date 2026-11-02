// ページごとの描き方の表（D-106・D-107）。始める画面・見積モード・フレームワークのカードで共有する。
// 行は game の routePlanRows（workloadFor が当てる描き方と同じ）。onSelect を渡すと、ほかの描き方をボタンで選べる。
// status を渡すと、行ごとに要件の判定（鮮度・SNS のカード・1 リクエストの CPU の制限）とほかの描き方の 1 か月目の差を出す。
// 色は見取り図の作られ方の色を流用し、必ず文字を添える。
import type {
  RegionSource,
  RouteAlternative,
  RoutePlanRow,
  RouteRowStatus,
  RouteStrategyId,
} from 'game';
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

export function Swatch({ strategy }: { strategy: RouteStrategyId }) {
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
const signedUsd = (n: number) =>
  `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const MARK = { good: '✓', fair: '△', bad: '✗' } as const;

/** 行の要件の判定（鮮度・SNS のカード・CPU の制限）。文は ⓘ に畳む。 */
function RowStatus({ s }: { s: RouteRowStatus }) {
  const items: { key: string; mark: string; label: string; text?: string }[] =
    [];
  if (s.freshness)
    items.push({
      key: 'freshness',
      mark: MARK[s.freshness.stage],
      label: '鮮度',
      text: s.freshness.text,
    });
  if (s.ogp)
    items.push({
      key: 'ogp',
      mark: s.ogp.ok ? '✓' : '✗',
      label: 'SNS のカード',
      text: s.ogp.text,
    });
  items.push({
    key: 'cpu',
    mark: s.cpu.ok ? '✓' : '✗',
    label: '1 リクエストの CPU',
    ...(s.cpu.text ? { text: s.cpu.text } : {}),
  });
  return (
    <ul
      aria-label="要件の判定"
      className="mt-1 flex flex-wrap gap-x-2 text-[11px]"
    >
      {items.map((i) => (
        <li
          key={i.key}
          data-check={i.key}
          data-ok={i.mark === '✓'}
          className={
            i.mark === '✗' ? 'text-error' : i.mark === '△' ? 'text-warning' : ''
          }
        >
          {i.mark} {i.label}
          {i.text && <Info label={`${i.label}の判定`}>{i.text}</Info>}
        </li>
      ))}
    </ul>
  );
}

/**
 * ページ → 描き方 → なぜ → この構成でほかに選べる描き方（使えないものは灰色と理由の ⓘ）。
 * caption: 表の下の注記（どこで決まっているか）。
 */
export function RoutePlanTable({
  rows,
  caption,
  onSelect,
  status,
  disabledReason,
}: {
  rows: RoutePlanRow[];
  caption?: string;
  /** ほかの描き方を選ぶ（渡さなければ読むだけ）。 */
  onSelect?: (row: RoutePlanRow, alt: RouteAlternative) => void;
  /** 行ごとの要件の判定と 1 か月目の差。 */
  status?: RouteRowStatus[];
  /** 選べない理由（ゲームの途中で手間が足りないなど）。描き方ごと。 */
  disabledReason?: (
    row: RoutePlanRow,
    alt: RouteAlternative,
  ) => string | null | undefined;
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
            {rows.map((r) => {
              const st = status?.find((s) => s.route === r.route);
              return (
                <tr key={r.route} data-route={r.route} className="align-top">
                  <th className="font-medium whitespace-nowrap">
                    {r.label}
                    <span className="block text-[11px] font-normal opacity-60">
                      {r.audience === 'public' ? '全員に同じ' : '人ごとに違う'}
                      ・{pct(r.share)}
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
                    {st && <RowStatus s={st} />}
                  </td>
                  <td className="min-w-48 text-xs opacity-80">{r.why}</td>
                  <td className="min-w-48">
                    <ul className="flex flex-wrap gap-1">
                      {r.alternatives.map((a) => {
                        const why = a.available
                          ? disabledReason?.(r, a)
                          : undefined;
                        const delta = st?.deltas[a.strategy];
                        const pick = onSelect && a.available && !why;
                        const body = (
                          <>
                            <span className="opacity-60">{a.code}</span>
                            {a.label}
                            {delta && (
                              <span
                                className="tabular-nums opacity-70"
                                title="1 か月目の費用の差（目安）"
                              >
                                {signedUsd(delta.costUsd)}
                                {delta.blocking !== 0 &&
                                  `・止まる前提 ${delta.blocking > 0 ? '+' : '−'}${Math.abs(delta.blocking)}`}
                              </span>
                            )}
                          </>
                        );
                        return (
                          <li
                            key={a.strategy}
                            data-alternative={a.strategy}
                            data-available={a.available}
                            className={`inline-flex items-center gap-1 rounded border border-base-300 text-[11px] ${
                              a.available
                                ? ''
                                : 'bg-base-200 px-1 py-0.5 opacity-50'
                            }`}
                          >
                            {pick ? (
                              <button
                                type="button"
                                className="btn h-auto min-h-0 gap-1 px-1 py-0.5 text-[11px] font-normal btn-ghost btn-xs"
                                onClick={() => onSelect(r, a)}
                                aria-label={`${r.label}を ${a.code} ${a.label}にする`}
                              >
                                {body}
                              </button>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 ${a.available ? 'px-1 py-0.5' : ''}`}
                              >
                                {body}
                              </span>
                            )}
                            {!a.available && (
                              <span className="sr-only">（使えない）</span>
                            )}
                            {why && (
                              <span className="pr-1 opacity-60">（{why}）</span>
                            )}
                            <Info
                              label={`${a.label}${a.available ? '' : 'が使えない理由'}`}
                            >
                              {a.reason}
                              {a.basis === 'assumption' && '（ゲーム上の仮定）'}
                            </Info>
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {caption && <p className="text-xs opacity-60">{caption}</p>}
    </div>
  );
}

/** 既定の描き方の短い列（フレームワークのカードに出す。D-107）。 */
export function RoutePresetChips({ rows }: { rows: RoutePlanRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul
      aria-label="既定のページの描き方"
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
    >
      {rows.map((r) => (
        <li
          key={r.route}
          data-route={r.route}
          data-strategy={r.strategy}
          className="inline-flex items-start gap-1"
        >
          <Swatch strategy={r.strategy} />
          <span>
            {r.label}: <span className="opacity-60">{r.code}</span>{' '}
            {r.strategyLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 表の下の注記（始める画面・見積モードで同じ文）。 */
export const ROUTE_PLAN_NOTE =
  '描き方はフレームワークの既定から、ページごとに選び直せる（人ごとに違うページは使い回す描き方を選べない）。期限・オンデマンドは設定（再検証・記事のキャッシュ）で決まる。費用の差は 1 か月目の基準の規模での目安。確かめていない描き方（vinext の事前描画・Server Islands・PPR）は出していない。';
