import {
  cashProjectionOf,
  isTrafficSpike,
  premiseTrends,
  projectionNote,
  selectTrends,
  type GameState,
  type MonthReport,
  type Scenario,
} from 'game';
import { compact, LineChart, Sparkline, useNarrowScreen } from '../charts.tsx';
import { Info } from '../info.tsx';
import { usd } from '../commitment-meta.ts';
import { hitLabel, hitTone } from '../premise-view.ts';
import { CountUp } from '../motion.tsx';
import { pct, STATUS } from './shared.ts';
import { eventBadge, HIT_BADGE, BLOCKED_LABEL } from './events.tsx';

export function History({
  history,
  rewindable,
  onRewind,
}: {
  history: MonthReport[];
  /** 戻れる月の数（1〜rewindable か月目。D-128）。 */
  rewindable: number;
  onRewind: (month: number) => void;
}) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        {/* 月ごとの行が積み重なって長くなるので、既定で畳む（D-187）。見出しに月数を出す */}
        <details className="collapse collapse-arrow" data-history>
          <summary className="collapse-title flex flex-wrap items-baseline gap-x-2 px-0 pe-10">
            <h2 className="card-title">これまでの運営</h2>
            <span className="text-sm opacity-70" data-history-months>
              （{history.length} か月）
            </span>
          </summary>
          <div className="collapse-content overflow-x-auto px-0">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>月</th>
                  <th>構成</th>
                  <th className="text-right">PV</th>
                  <th className="text-right">収益</th>
                  <th className="text-right">費用</th>
                  <th className="text-right">所持金</th>
                  <th className="text-right">満足度</th>
                  <th className="text-right">機能開発</th>
                  <th>状態</th>
                  <th>イベント</th>
                  <th>アクション</th>
                  <th>
                    <span className="sr-only">戻る</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{r.stackName}</td>
                    <td className="text-right">
                      {Math.round(r.pv).toLocaleString()}
                    </td>
                    <td className="text-right">{usd(r.revenue)}</td>
                    <td className="text-right">{usd(r.infraCost)}</td>
                    <td className="text-right">{usd(r.cash)}</td>
                    <td className="text-right">
                      {r.satisfaction.score.toFixed(2)}
                    </td>
                    <td className="text-right">{r.effort.feature}</td>
                    <td>
                      <span
                        className={`badge badge-sm ${STATUS[r.status].cls}`}
                      >
                        {STATUS[r.status].label}
                      </span>
                      {r.policyWarning && (
                        <span className="badge badge-sm badge-error ml-1">
                          規約違反の指摘
                        </span>
                      )}
                    </td>
                    <td className="text-xs">
                      {r.events
                        .map(
                          (e) =>
                            `${eventBadge(e).label}${e.botBlocked ? `（${BLOCKED_LABEL}）` : ''}: ${e.title}`,
                        )
                        .join('・')}
                    </td>
                    <td className="text-xs">{r.action ?? ''}</td>
                    <td>
                      {r.month <= rewindable && (
                        <button
                          className="btn btn-ghost btn-xs whitespace-nowrap"
                          aria-label={`${r.month} か月目に戻る`}
                          onClick={() => onRewind(r.month)}
                        >
                          この月に戻る
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

/** 推移と見込み（prd/07 §5・GD-1）。毎月の画面の上に常に出し、続いている感じを見せる。 */
export function Trends({
  history,
  scenario,
  ended,
  previous,
  onClearPrevious,
}: {
  history: MonthReport[];
  scenario: Scenario;
  /** 終わったら見込みを出さない（途中のゲームオーバーで残りの月を伸ばさない）。 */
  ended: boolean;
  /** 前の試行（D-128）。所持金・PV・費用・満足度の線に破線で重ねる。 */
  previous: GameState | null;
  onClearPrevious: () => void;
}) {
  const narrow = useNarrowScreen();
  const prevHistory = previous?.history;
  const prevOf = (get: (r: MonthReport) => number) =>
    prevHistory ? { previous: prevHistory.map(get) } : {};
  const last = history[history.length - 1]!;
  // 所持金の見込み（目安。直近 3 か月の月の利益の平均で線形に伸ばす。D-42）
  const cashProj = ended ? undefined : cashProjectionOf({ history, scenario });
  // 所持金の目標の目安（シナリオの goal.cash。表示だけで合否にしない。D-167）。
  // 後で集計の分布（完走した人の 12 か月目の所持金の上位 90% の線など）から出す余地を残す（prd/15 §2.1）
  const cashGuide = scenario.goal.cash;
  const prev = history[history.length - 2];
  const cost = (r: MonthReport) => r.infraCost;
  const trends = selectTrends(
    premiseTrends(
      history.map((m) => m.snapshots),
      scenario.months,
      {
        ...(projectionNote(last)
          ? { skipProjection: projectionNote(last)! }
          : {}),
        spikes: history.map(isTrafficSpike),
      },
    ),
  );
  const tiles = [
    {
      label: 'PV',
      value: last.pv,
      format: (n: number) => compact(Math.round(n)),
      series: history.map((r) => r.pv),
      delta: prev ? last.pv / prev.pv - 1 : null,
    },
    {
      label: '収益（月）',
      value: last.revenue,
      format: usd,
      series: history.map((r) => r.revenue),
      delta: prev ? last.revenue / prev.revenue - 1 : null,
    },
    {
      label: '費用（月）',
      value: cost(last),
      format: usd,
      series: history.map(cost),
      delta: prev ? cost(last) / cost(prev) - 1 : null,
    },
    {
      label: '所持金',
      value: last.cash,
      format: usd,
      series: history.map((r) => r.cash),
      delta: null,
    },
    {
      label: '機能開発（月）',
      value: last.effort.feature,
      // 提案の作業と加点を含む（D-29）。総量を超えうるので「/ 総量」でなく内訳を添える
      format: (n: number) => {
        const p = last.effort.featureWork + last.effort.featureBonus;
        return p > 0
          ? `${Math.round(n)}（うち開発依頼 ${Math.round(p)}）`
          : `${Math.round(n)} / ${last.effort.total}`;
      },
      series: history.map((r) => r.effort.feature),
      delta: null,
    },
  ];
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-3 sm:gap-4">
        <h2 className="card-title">これまでの推移</h2>
        {/* 狭い画面は 1 行に名前・値・前月比・小さな推移を並べた細い行を積む（D-186） */}
        <div
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-3 md:grid-cols-5"
          data-trend-tiles
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-2 rounded-box bg-base-200 px-3 py-1.5 sm:block sm:p-3"
              data-trend-tile
            >
              <div className="w-20 shrink-0 text-xs opacity-70 sm:w-auto">
                {t.label}
              </div>
              <div className="min-w-0 flex-1 text-base font-semibold tabular-nums sm:text-xl">
                {/* 月が進むと前の月の値から数え上げる（D-25） */}
                <CountUp value={t.value} format={t.format} />
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:flex-wrap sm:items-end sm:justify-between sm:gap-0">
                <span className="text-xs whitespace-nowrap opacity-70">
                  {t.delta === null || !Number.isFinite(t.delta) ? (
                    ''
                  ) : (
                    <>
                      <span className="max-sm:hidden">前月比 </span>
                      {pct(t.delta)}
                    </>
                  )}
                </span>
                <Sparkline
                  values={t.series}
                  months={scenario.months}
                  {...(narrow ? { width: 64, height: 20 } : {})}
                />
              </div>
            </div>
          ))}
        </div>
        {cashProj && cashProj.projection.length > 0 && (
          <p className="text-sm" data-cash-projection>
            <span className="whitespace-nowrap">所持金はこのペースだと</span>{' '}
            <wbr />
            <span className="whitespace-nowrap">
              {`${scenario.months} か月目に約 ${usd(Math.round(cashProj.final))}`}
            </span>
            の見込みです{' '}
            <Info label="所持金の見込みの出し方">
              {cashProj.method === 'growth'
                ? `月の利益（収益 − 費用。乗り換え中の並行の費用・一度だけの手数料も含む、所持金の実際の増減）を、直近の月の利益の前月比（直近 3 つの比の中央値を 0.8〜1.2 倍に収めた値。今は ${cashProj.growth.toFixed(2)} 倍）で残りの月も伸ばして足したゲーム上の目安。来月の月の利益は約 ${usd(Math.round(cashProj.nextProfit))}。`
                : `月の利益（収益 − 費用。所持金の実際の増減）が 0 以下なので、伸びを入れず直近 3 か月の平均（約 ${usd(Math.round(cashProj.nextProfit))}）で残りの月を線形に伸ばしたゲーム上の目安。`}
              話題・前兆・Bot
              で一時的に流量が増えた月は、基準にも比にも使いません
              {cashProj.skipped > 0
                ? `（今回は ${cashProj.skipped} か月を除きました）`
                : ''}
              。予告済みのイベント・料金の改定は織り込みません
            </Info>
          </p>
        )}
        {!ended && (
          <p className="text-sm" data-cash-guide>
            {`目標の目安は ${scenario.months} か月目に所持金 ${usd(cashGuide)} です`}
            {cashProj && cashProj.projection.length > 0
              ? cashProj.final >= cashGuide
                ? `（見込みは目安を約 ${usd(Math.round(cashProj.final - cashGuide))} 上回ります）`
                : `（見込みでは目安まで約 ${usd(Math.round(cashGuide - cashProj.final))} です）`
              : ''}
            。届かなくても完走になり、合否はありません{' '}
            <Info label="目標の目安とは">
              {`シナリオが想定した ${scenario.months} か月目の所持金の目安です（ゲーム上の仮定）。下回っても途中で終わったり失敗になったりはしません。完走したら、4 つの軸で振り返ります。所持金のグラフの点線が目安の額です`}
            </Info>
          </p>
        )}
        {previous && (
          <div
            className="flex flex-wrap items-center gap-2 text-xs opacity-80"
            data-previous-trial
          >
            <span>
              {`グラフの灰色の点線は前の試行（${previous.history.length} か月目${previous.phase === 'playing' ? 'まで' : `で${previous.phase === 'completed' ? '完走' : '終了'}`}）`}
            </span>
            <button
              className="btn btn-ghost btn-xs opacity-70"
              onClick={onClearPrevious}
            >
              前の試行を消す
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
          <LineChart
            title="所持金"
            months={scenario.months}
            format={(v) => `$${compact(Math.round(v))}`}
            reference={{
              value: cashGuide,
              label: `目標の目安 $${compact(Math.round(cashGuide))}`,
              tone: 'neutral',
            }}
            series={[
              {
                id: 'cash',
                label: '所持金',
                color: 'var(--series-1)',
                // 負の値は軸の下に出ないよう 0 で切る（表示だけ。負になった月にゲームは終わる）
                values: history.map((r) => Math.max(0, r.cash)),
                ...prevOf((r) => Math.max(0, r.cash)),
                ...(cashProj && cashProj.projection.length > 1
                  ? {
                      projection: cashProj.projection.map((p) => ({
                        month: p.month,
                        value: Math.max(0, p.value),
                      })),
                    }
                  : {}),
              },
            ]}
          />
          <LineChart
            title="収益と費用（月）"
            months={scenario.months}
            format={(v) => `$${compact(Math.round(v))}`}
            series={[
              {
                id: 'revenue',
                label: '収益',
                color: 'var(--series-1)',
                values: history.map((r) => r.revenue),
              },
              {
                id: 'cost',
                label: '費用',
                color: 'var(--series-2)',
                values: history.map(cost),
                ...prevOf(cost),
              },
            ]}
          />
          <LineChart
            title="満足度と評判"
            months={scenario.months}
            format={(v) => v.toFixed(2)}
            yMax={1}
            series={[
              {
                id: 'score',
                label: '満足度',
                color: 'var(--series-1)',
                values: history.map((r) => r.satisfaction.score),
                ...prevOf((r) => r.satisfaction.score),
              },
              {
                id: 'reputation',
                label: '評判',
                color: 'var(--series-2)',
                values: history.map((r) => r.satisfaction.reputation),
              },
            ]}
          />
          <LineChart
            title="PV（月）"
            months={scenario.months}
            format={(v) => compact(Math.round(v))}
            series={[
              {
                id: 'pv',
                label: 'PV',
                color: 'var(--series-1)',
                values: history.map((r) => r.pv),
                ...prevOf((r) => r.pv),
              },
            ]}
          />
        </div>
        {trends.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              上限の使用率（境目 = 100%）
            </h3>
            <div className="grid gap-2 sm:gap-3 md:grid-cols-2">
              {trends.map((t) => (
                <TrendCard key={t.id} t={t} months={scenario.months} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendCard({
  t,
  months,
}: {
  t: ReturnType<typeof premiseTrends>[number];
  months: number;
}) {
  // 効き方で色を分ける（D-188。月の報告の上限の一覧・出来事と同じ）
  const blocked = t.hitNow && hitTone(t.effect) === 'error';
  const status = blocked
    ? { cls: HIT_BADGE.error, label: `✗ ${hitLabel(t.effect)}` }
    : t.hitNow
      ? { cls: HIT_BADGE.warning, label: `● ${hitLabel(t.effect)}` }
      : t.monthsUntil !== null
        ? {
            cls: 'badge-warning',
            label: `▲ ${t.monthsUntil} か月後に超える見込み`,
          }
        : t.latest >= 0.5
          ? { cls: 'badge-info', label: '◐ あと少し' }
          : { cls: 'badge-ghost', label: '○ まだ遠い' };
  const peak = Math.max(
    ...t.ratios.map((r) => r ?? 0),
    ...t.projection.map((p) => p.ratio),
  );
  return (
    <div className="rounded-box border border-base-300 p-2 sm:p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm ${status.cls}`}>{status.label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {(t.latest * 100).toFixed(0)}%
        </span>
        {t.earlierThanProjected && (
          <span className="badge badge-sm badge-outline">
            見込みより早く超えた
          </span>
        )}
      </div>
      <div className="mb-1 text-sm">{t.text}</div>
      {t.projectionNote && (
        <div className="mb-1 text-xs opacity-70">{t.projectionNote}</div>
      )}
      {!t.projectionNote && !t.hitNow && t.excluded.length > 0 && (
        <div className="mb-1 text-xs opacity-70">
          {`${t.excluded.map((i) => i + 1).join('・')} か月目は一時的に流量が増えた月なので、見込みの計算から除きました`}
        </div>
      )}
      {t.breaks.length > 0 && (
        <div className="mb-1 text-xs opacity-70">
          {`${t.breaks.map((i) => i + 1).join('・')} か月目に効く部品を替えたので、線（縦の破線）と見込みはそこで区切りました`}
        </div>
      )}
      <LineChart
        months={months}
        height={120}
        format={(v) => `${Math.round(v * 100)}%`}
        yMax={Math.min(Math.max(1.2, peak), 3)}
        reference={{ value: 1, label: '境目' }}
        series={[
          {
            id: t.id,
            label: '使用率',
            color: 'var(--series-1)',
            values: t.ratios,
            breaks: t.breaks,
            projection: t.projection.map((p) => ({
              month: p.month,
              value: p.ratio,
            })),
          },
        ]}
      />
      {Math.max(...t.ratios.map((r) => r ?? 0)) > 3 && (
        <div className="text-xs opacity-70">
          300% を超えた部分はグラフの上端で切っています（値は上の %）
        </div>
      )}
    </div>
  );
}
