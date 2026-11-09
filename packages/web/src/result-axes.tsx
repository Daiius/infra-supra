// 振り返りの 4 軸（D-132・D-166）と、集計の分布の中での位置（段 3・D-161）か手元の履歴との比較（D-144）。完走のダイアログと結果の画面で共用する。
// 1 つの点数にはまとめず、軸ごとに並べる（prd/07 §7・prd/15 §2）。分布が無い・取れない・少ないときは手元の履歴との比較だけを出す（段 1 のまま）。
import type { ResultAxisId } from 'game';
import type { ReactNode } from 'react';
import { HistogramChart } from './charts.tsx';
import {
  MIN_DISTRIBUTION_COUNT,
  TOP_PERCENT,
  type AxisStanding,
  type DistributionView,
  type Standing,
  type StatsView,
} from './distribution.ts';
import { signedText, usd } from './format.ts';
import type { AxisComparison } from './results-history.ts';

const fmtPoints = (n: number) => String(Number(n.toFixed(1)));

/** 軸ごとの値の書式（差は絶対値の書式に符号を付ける）。 */
const FORMAT: Record<ResultAxisId, (n: number) => string> = {
  cash: usd,
  satisfaction: (n) => n.toFixed(2),
  featurePoints: fmtPoints,
  totalCost: usd,
};

/** 軸の短い説明（値の意味）。 */
const CAPTION: Record<ResultAxisId, string> = {
  cash: '最後の月の所持金',
  satisfaction: '毎月の満足度の平均',
  featurePoints: '機能開発に回せた手間の合計',
  totalCost:
    'プレイした月のインフラの費用の合計（高い・低いで良し悪しは付けません）',
};

/** 上位に入ったときの印（向きのある軸だけ）。 */
const topBadge = (p: number) => `★ 上位 ${p}%`;

/**
 * 所持金の目標の目安との差の文（D-167）。合否の言葉・色は使わない（D-131）。
 */
export function cashGuideText(cash: number, guide: number): string {
  const diff = cash - guide;
  if (Math.abs(diff) < 0.005) return `目標の目安 ${usd(guide)} と同じでした`;
  return diff > 0
    ? `目標の目安 ${usd(guide)} を ${usd(diff)} 上回りました`
    : `目標の目安 ${usd(guide)} まで ${usd(-diff)} でした`;
}

/** 分布の 1 本（同じシード / 全シード）: 数値の要約をテキストで出し、その下にヒストグラム。 */
function DistributionRow({
  kind,
  standing,
  count,
  axis,
  directed,
  value,
}: {
  kind: 'seed' | 'all';
  /** 件数が少なければ null。 */
  standing: Standing | null;
  /** 件数（自分を含む）。 */
  count: number;
  axis: ResultAxisId;
  /** 向きを持たない軸（④ 費用の合計）は上位 % の代わりに中央値を出す（D-166）。 */
  directed: boolean;
  value: number;
}) {
  const name = kind === 'seed' ? '同じシード' : '全シード';
  const median = standing?.histogram.median;
  const summary = !standing
    ? ''
    : directed
      ? `${standing.n} 件中 上位 ${standing.topPercent}%`
      : `${standing.n} 件${median != null ? `・${kind === 'seed' ? '同じシード' : '全体'}の中央値は ${FORMAT[axis](median)} です` : ''}`;
  return (
    <div
      data-dist={kind}
      data-top-percent={directed ? standing?.topPercent : undefined}
    >
      <div className="text-xs" data-dist-summary>
        <span className="font-semibold">{name}</span>{' '}
        {standing ? (
          <span className="tabular-nums">
            {summary}
            {directed && standing.inTop && '（上位）'}
          </span>
        ) : (
          <span className="opacity-70">
            まだ {count} 件なので出しません（{MIN_DISTRIBUTION_COUNT}{' '}
            件から出します）
          </span>
        )}
      </div>
      {standing && (
        <HistogramChart
          bins={standing.histogram.bins}
          value={value}
          label={`${name}の分布（${summary}）`}
        />
      )}
    </div>
  );
}

/** 一番上の注記（どちらと比べているか。prd/15 §3.1）。 */
function compareNote(
  stats: StatsView,
  localCount: number,
  filterName?: string,
): string {
  const local =
    localCount > 0
      ? `この端末に残した過去の完走（同じシナリオの ${localCount} 回）と比べています。`
      : 'この端末に、比べる過去の完走はまだありません。次に完走すると、自己ベスト・前回との差・順位を出します。';
  switch (stats.status) {
    case 'ready': {
      const v = stats.view;
      return [
        v.mock
          ? '開発用の架空の分布です（遊んだ人の結果ではありません）。'
          : '',
        filterName
          ? `${filterName}の完走のプレイの分布と比べています（見るための絞り込みです。「★ 上位」の印と花火は全部の構成の分布で決めます）。`
          : `集計した完走のプレイの分布と比べています。同じシードと全シードの 2 つで、上位 ${TOP_PERCENT}% 以内を「上位」に数えます（④ 費用の合計は上位を数えず、分布の中の位置だけを示します）。`,
        v.included
          ? 'あなたのプレイも数に入っています。'
          : 'あなたのプレイを 1 件足して数えています。',
      ].join('');
    }
    case 'loading':
      return `集計の分布を読み込んでいます。${local}`;
    case 'failed':
      return `集計の分布を読み込めなかったので、${local}`;
    case 'few':
      return `集計の完走がまだ ${stats.count} 件と少ないので、${local}`;
    case 'off':
      return local;
  }
}

export function ResultAxesPanel({
  comparisons,
  stats = { status: 'off' },
  outages,
  cashGuide,
  size = 'md',
  filter,
  children,
}: {
  comparisons: readonly AxisComparison[];
  /** 所持金の目標の目安（シナリオの goal.cash。表示だけで合否にしない。D-167）。 */
  cashGuide?: number;
  /** 集計の分布（段 3）。ready のときだけ分布を出す。 */
  stats?: StatsView;
  /** 止まった月の数（軸ではなく、振り返りとして下に出す）。 */
  outages: number;
  size?: 'md' | 'lg';
  /**
   * 絞った分布を出すとき（結果の画面の絞り込みのチップ。D-175）: name は注記に出す名前（例: 同じインフラ（…））、top は
   * 「★ 上位」の印を決める全部の構成の分布（見るためだけの絞り込みで、上位の判定は変えない）。
   */
  filter?: { name: string; top: DistributionView | null };
  /** 注記と 4 軸の間に置くもの（絞り込みのチップ）。 */
  children?: ReactNode;
}) {
  const count = comparisons[0]?.count ?? 0;
  const dist: DistributionView | null =
    stats.status === 'ready' ? stats.view : null;
  const top = filter ? filter.top : dist;
  return (
    <section
      aria-label="4 つの軸の振り返り"
      data-result-axes
      data-stats={stats.status}
    >
      <p className="mb-2 text-xs opacity-70" data-result-compare-note>
        {compareNote(stats, count, filter?.name)}
      </p>
      {children}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {comparisons.map((c, i) => {
          const f = FORMAT[c.id];
          const d: AxisStanding | undefined = dist?.axes.find(
            (a) => a.id === c.id,
          );
          // 「★ 上位」の印は全部の構成の分布で決める（絞り込みは見るためだけ。D-175）
          const t = top?.axes.find((a) => a.id === c.id);
          const basis = t ? (t.seed ?? t.all) : null;
          return (
            <li
              key={c.id}
              className="rounded-box border border-success/40 bg-base-100 p-3"
              data-axis={c.id}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">
                  {['①', '②', '③', '④'][i]} {c.label}
                </span>
                {t?.inTop && basis && (
                  <span className="badge badge-success badge-sm" data-axis-top>
                    {topBadge(basis.topPercent)}
                  </span>
                )}
                {c.newBest && (
                  <span
                    className={`badge badge-sm ${top ? 'badge-outline' : 'badge-success'}`}
                  >
                    ★ 自己ベスト更新
                  </span>
                )}
              </div>
              <div
                className={`tabular-nums ${size === 'lg' ? 'text-2xl font-bold' : 'text-xl font-semibold'}`}
              >
                {f(c.value)}
              </div>
              <div className="text-xs opacity-70">{CAPTION[c.id]}</div>
              {c.id === 'cash' && cashGuide !== undefined && (
                <div className="text-xs" data-cash-guide>
                  {cashGuideText(c.value, cashGuide)}
                </div>
              )}
              {d && (
                <div className="mt-2 space-y-2" data-axis-distribution>
                  <DistributionRow
                    kind="seed"
                    standing={d.seed}
                    count={d.seedCount}
                    axis={c.id}
                    directed={c.directed}
                    value={c.value}
                  />
                  <DistributionRow
                    kind="all"
                    standing={d.all}
                    count={d.allCount}
                    axis={c.id}
                    directed={c.directed}
                    value={c.value}
                  />
                </div>
              )}
              {!d && c.count > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {c.best !== undefined && (
                    <li>
                      {c.newBest ? 'これまでの自己ベスト' : '自己ベスト'}{' '}
                      <span className="tabular-nums">{f(c.best)}</span>
                    </li>
                  )}
                  {c.diffFromLast !== undefined && (
                    <li>
                      前回との差{' '}
                      <span className="tabular-nums">
                        {signedText(c.diffFromLast, f)}
                      </span>
                    </li>
                  )}
                  {c.rank !== undefined && (
                    <li>
                      過去 {c.count + 1} 回の中で {c.rank} 位
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm">
        止まった月 <span className="tabular-nums">{outages} 回</span>
        <span className="text-xs opacity-70">
          （振り返りとして出します。軸には入れません）
        </span>
      </p>
    </section>
  );
}
