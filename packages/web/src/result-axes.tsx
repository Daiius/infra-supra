// 振り返りの 4 軸（D-132・D-166）と、集計の分布の中での位置（段 3・D-161）か手元の履歴との比較（D-144）。完走のダイアログと結果の画面で共用する。
// 1 つの点数にはまとめず、軸ごとに並べる（prd/07 §7・prd/15 §2）。分布が無い・取れない・少ないときは手元の履歴との比較だけを出す（段 1 のまま）。
import type { ResultAxisId } from 'game';
import { useEffect, useState, type ReactNode } from 'react';
import { HistogramChart, HistogramSkeleton } from './charts.tsx';
import { Chips } from './chips.tsx';
import { Info } from './info.tsx';
import {
  MIN_RANKED_COUNT,
  rankBasisOf,
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

/** 軸の短い説明（値の意味。統計の画面でも使う。D-197）。 */
export const CAPTION: Record<ResultAxisId, string> = {
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

/**
 * 分布の 1 本（同じシード / 全シード）: 数値の要約をテキストで出し、その下にヒストグラム。集計に 1 件でもあれば描き、
 * MIN_RANKED_COUNT 件未満のうちは上位 % を出さず中央値を出す（D-198。注記は添えない。D-199）。
 */
function DistributionRow({
  kind,
  standing,
  axis,
  directed,
  value,
  hideMine,
}: {
  kind: 'seed' | 'all';
  /** 集計に 1 件も無ければ null。 */
  standing: Standing | null;
  axis: ResultAxisId;
  /** 向きを持たない軸（④ 費用の合計）は上位 % の代わりに中央値を出す（D-166）。 */
  directed: boolean;
  value: number;
  /** 切り替えの読み込み中で、前の分布の上に「あなた」の印を出さない（D-200）。 */
  hideMine: boolean;
}) {
  const name = kind === 'seed' ? '同じシード' : '全シード';
  const median = standing?.histogram.median;
  const summary = !standing
    ? ''
    : directed && standing.ranked
      ? `${standing.n} 件中 上位 ${standing.topPercent}%`
      : `${standing.n} 件${median != null ? `・${kind === 'seed' ? '同じシード' : '全体'}の中央値は ${FORMAT[axis](median)} です` : ''}`;
  return (
    <div
      data-dist={kind}
      data-top-percent={
        directed && standing?.ranked ? standing.topPercent : undefined
      }
    >
      <div className="text-xs" data-dist-summary>
        <span className="font-semibold">{name}</span>{' '}
        {standing ? (
          <span className="tabular-nums">
            {summary}
            {directed && standing.inTop && '（上位）'}
          </span>
        ) : (
          <span className="opacity-70">{name}の完走はまだ集計にありません</span>
        )}
      </div>
      {standing && !standing.ranked && directed && (
        <div className="text-xs opacity-70" data-dist-rank-note>
          上位 % は {MIN_RANKED_COUNT} 件から出します。
        </div>
      )}
      {standing && (
        <HistogramChart
          bins={standing.histogram.bins}
          value={value}
          hideMine={hideMine}
          label={`${name}の分布（${summary}）`}
        />
      )}
    </div>
  );
}

/** 見る分布（同じシード / 全シード）。4 軸まとめて 1 本だけ出す（D-204）。 */
export type DistScope = 'seed' | 'all';

/** 選んだ見る分布を覚えるキー（infra-supra: で始まるので、ローカルの記録の消去でも消える。D-204）。 */
export const DIST_SCOPE_KEY = 'infra-supra:dist-scope';

/** 既定は全シード（件数が多い方。D-204）。 */
export const DEFAULT_DIST_SCOPE: DistScope = 'all';

function loadScope(): DistScope {
  try {
    const v = localStorage.getItem(DIST_SCOPE_KEY);
    return v === 'seed' || v === 'all' ? v : DEFAULT_DIST_SCOPE;
  } catch {
    return DEFAULT_DIST_SCOPE;
  }
}

/** 同じ画面に出ている切り替え（完走のダイアログと結果の画面）を、片方で選んだらもう片方もそろえる。 */
const scopeListeners = new Set<(v: DistScope) => void>();

/** 見る分布の切り替え（完走のダイアログと結果の画面で同じ記録。見るためだけで、上位の判定は変えない。D-204）。 */
function useDistScope() {
  const [scope, setScope] = useState<DistScope>(loadScope);
  useEffect(() => {
    scopeListeners.add(setScope);
    return () => {
      scopeListeners.delete(setScope);
    };
  }, []);
  const update = (v: DistScope) => {
    for (const l of scopeListeners) l(v);
    try {
      localStorage.setItem(DIST_SCOPE_KEY, v);
    } catch {
      // 覚えられなくても画面は壊さない
    }
  };
  return [scope, update] as const;
}

/**
 * 一番上の注記（どちらと比べているか。prd/15 §3.1）。分布と比べるときは 1 行だけにし、数え方の詳しい説明は ⓘ に畳む
 * （完走のダイアログで最初に見える軸が 1 つだけになっていた。D-207）。
 */
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
    case 'ready':
      return [
        stats.view.mock ? '開発用の架空の分布です。' : '',
        filterName
          ? `${filterName}の完走の分布と比べています。`
          : '集計した完走のプレイの分布と比べています。',
      ].join('');
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

/** 分布との比べ方の詳しい説明（注記の横の ⓘ。D-207）。 */
function CompareInfo({
  view,
  filterName,
}: {
  view: DistributionView;
  filterName?: string | undefined;
}) {
  return (
    <Info label="分布との比べ方の説明">
      <ul className="list-disc space-y-1 pl-5" data-compare-detail>
        {view.mock && (
          <li>開発用の架空の分布です（遊んだ人の結果ではありません）。</li>
        )}
        <li>
          同じシードと全シードの 2 つの分布で、上位 {TOP_PERCENT}%
          以内に入った軸を「上位」に数えます（「★ 上位」の印と花火の段）。上位 %
          は {MIN_RANKED_COUNT} 件から出します。
        </li>
        <li>
          ④
          費用の合計は高い・低いで良し悪しを付けないので、上位を数えず、分布の中の位置だけを示します。
        </li>
        <li>
          「見る分布」の切り替え（全シード /
          同じシード）は見る分布を選ぶだけで、「上位」の数え方は変えません。
        </li>
        {filterName && (
          <li>
            {filterName}
            の絞り込みは見るためのものです。「★
            上位」の印と花火は全部の構成の分布で決めます。
          </li>
        )}
        <li>
          {view.included
            ? 'あなたのプレイも数に入っています。'
            : 'あなたのプレイを 1 件足して数えています。'}
        </li>
      </ul>
    </Info>
  );
}

export function ResultAxesPanel({
  comparisons,
  stats = { status: 'off' },
  outages,
  cashGuide,
  size = 'md',
  filter,
  hideMine = false,
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
  /** 絞り込みの読み込み中（前の分布を薄く残している間）で、「あなた」の印を出さない（D-200）。 */
  hideMine?: boolean;
  /** 注記と 4 軸の間に置くもの（絞り込みのチップ）。 */
  children?: ReactNode;
}) {
  const count = comparisons[0]?.count ?? 0;
  const dist: DistributionView | null =
    stats.status === 'ready' ? stats.view : null;
  const top = filter ? filter.top : dist;
  const [scope, setScope] = useDistScope();
  // 切り替えのチップに件数を添える（件数は軸によらない。集計に無ければ 0 件）
  const countOf = (k: DistScope) => {
    const a = dist?.axes[0];
    return (k === 'seed' ? a?.seed : a?.all)?.n ?? 0;
  };
  return (
    <section
      aria-label="4 つの軸の振り返り"
      data-result-axes
      data-stats={stats.status}
    >
      <p
        className="mb-2 text-xs"
        data-result-compare-note
        data-self={dist ? (dist.included ? 'included' : 'added') : undefined}
      >
        <span className="opacity-70">
          {compareNote(stats, count, filter?.name)}
        </span>
        {dist && <CompareInfo view={dist} filterName={filter?.name} />}
      </p>
      {children}
      {dist && (
        <div className="mb-2" data-dist-scope>
          <Chips<DistScope>
            label="見る分布"
            name="dist-scope"
            value={scope}
            onChange={setScope}
            options={(['all', 'seed'] as const).map((k) => ({
              value: k,
              label: `${k === 'all' ? '全シード' : '同じシード'}（${countOf(k)} 件）`,
            }))}
          />
        </div>
      )}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {comparisons.map((c, i) => {
          const f = FORMAT[c.id];
          const d: AxisStanding | undefined = dist?.axes.find(
            (a) => a.id === c.id,
          );
          // 「★ 上位」の印は全部の構成の分布で決める（絞り込みは見るためだけ。D-175）
          const t = top?.axes.find((a) => a.id === c.id);
          const basis = t ? rankBasisOf(t) : null;
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
                  {/* 見る分布は 4 軸まとめて 1 本（D-204）。「★ 上位」は上の rankBasisOf のまま */}
                  <DistributionRow
                    kind={scope}
                    standing={scope === 'seed' ? d.seed : d.all}
                    axis={c.id}
                    directed={c.directed}
                    value={c.value}
                    hideMine={hideMine}
                  />
                </div>
              )}
              {stats.status === 'loading' && (
                // 最初の読み込み: 分布が出たときと同じ高さ（見る分布の 1 本。D-204）のスケルトン。「あなた」の印は出さない（D-200）
                <div
                  className="mt-2 space-y-2"
                  aria-hidden
                  data-axis-distribution-skeleton
                >
                  <div>
                    <div className="flex h-4 items-center">
                      <span className="block h-2 w-2/3 rounded-full bg-base-content/10" />
                    </div>
                    <HistogramSkeleton mineSpace />
                  </div>
                </div>
              )}
              {!d && stats.status !== 'loading' && c.count > 0 && (
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
