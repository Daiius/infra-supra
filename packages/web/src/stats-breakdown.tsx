// 結果の画面の、構成・フレームワークごとの分布（ST-11・D-175）。完走のダイアログには置かない（ダイアログを複雑にしない）。
// - 絞り込みのチップ（全部 / 同じインフラ / 同じフレームワーク / 同じ組み合わせ）で、4 軸の分布（同じシード / 全シード）を切り替える。
// - 比較の図: 1 つの軸について、構成ごと（切り替えでフレームワークごと）の 25〜75% の帯と中央値・自分の値の縦の線。
// 絞り込みは見るためだけ。「★ 上位」の印と花火の段（D-163・D-168）は全部の構成の分布のまま。選んだチップ・軸・分け方は
// localStorage（STATS_BREAKDOWN_KEY）に覚える。VITE_STATS_ENABLED が無ければ取りに行かない（開発の VITE_STATS_MOCK は架空の値）。
import { FRAMEWORKS, RESULT_AXES, STACKS, type ResultAxisId } from 'game';
import { useEffect, useMemo, useState } from 'react';
import type { GroupStat } from 'stats';
import { GroupRangeChart } from './charts.tsx';
import {
  DEFAULT_BREAKDOWN_PREFS,
  groupRowsOf,
  MIN_DISTRIBUTION_COUNT,
  parseBreakdownPrefs,
  STATS_BREAKDOWN_KEY,
  STATS_FILTER_LABEL,
  STATS_FILTERS,
  type DistributionView,
  type GroupBy,
  type StatsBreakdownPrefs,
  type StatsFilter,
  type StatsView,
} from './distribution.ts';
import { usd } from './format.ts';
import { ResultAxesPanel } from './result-axes.tsx';
import type { AxisComparison } from './results-history.ts';
import {
  loadFilteredView,
  loadGroups,
  type StatsQuery,
} from './stats-client.ts';

const AXIS_FORMAT: Record<ResultAxisId, (n: number) => string> = {
  cash: usd,
  satisfaction: (n) => n.toFixed(2),
  featurePoints: (n) => String(Number(n.toFixed(1))),
  totalCost: usd,
};

const AXIS_MARK: Record<ResultAxisId, string> = {
  cash: '①',
  satisfaction: '②',
  featurePoints: '③',
  totalCost: '④',
};

/** 構成の名前（STACKS の id → 名前。知らない id はそのまま）。 */
const stackLabel = (id: string) => STACKS.find((s) => s.id === id)?.name ?? id;
const frameworkLabel = (id: string) =>
  (FRAMEWORKS as Record<string, { label: string } | undefined>)[id]?.label ??
  id;

/** 比較の図に出す行（隠した構成は出さない。D-100）。 */
export const groupKeys = (by: GroupBy) =>
  by === 'stack'
    ? STACKS.filter((s) => !s.hidden).map((s) => ({
        key: s.id,
        label: s.name,
      }))
    : Object.values(FRAMEWORKS).map((f) => ({ key: f.id, label: f.label }));

function loadPrefs(): StatsBreakdownPrefs {
  try {
    const raw = localStorage.getItem(STATS_BREAKDOWN_KEY);
    return parseBreakdownPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_BREAKDOWN_PREFS;
  }
}

function storePrefs(p: StatsBreakdownPrefs): void {
  try {
    localStorage.setItem(STATS_BREAKDOWN_KEY, JSON.stringify(p));
  } catch {
    // 覚えられなくても画面は壊さない
  }
}

/** 小さな選択のチップ（1 つだけ選ぶ）。 */
function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** data-chips の値（テストと見た目の確かめ用）。 */
  name: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-chips={name}
      className="flex min-w-0 flex-wrap gap-1"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            data-chip={o.value}
            title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              selected
                ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
                : 'cursor-pointer bg-base-100 ring-1 ring-base-300 ring-inset hover:bg-base-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 絞り込みの名前（注記に出す）。 */
function filterName(filter: StatsFilter, q: StatsQuery): string {
  switch (filter) {
    case 'all':
      return '';
    case 'stack':
      return `同じインフラ（${stackLabel(q.stackId)}）`;
    case 'framework':
      return `同じフレームワーク（${frameworkLabel(q.framework)}）`;
    case 'both':
      return `同じ組み合わせ（${stackLabel(q.stackId)}・${frameworkLabel(q.framework)}）`;
  }
}

/**
 * 結果の画面の 4 軸の振り返り（ResultAxesPanel）に、絞り込みのチップと比較の図を足したもの。
 * 全部の分布が出ているとき（ready）だけチップを出し、比較の図は全部の分布が取れたとき（ready・few）に出す。
 */
export function ResultStatsSection({
  comparisons,
  stats,
  outages,
  cashGuide,
  query,
}: {
  comparisons: readonly AxisComparison[];
  stats: StatsView;
  outages: number;
  cashGuide?: number;
  /** 自分のプレイの構成など（無ければチップと比較の図を出さない）。 */
  query: StatsQuery | null;
}) {
  const [prefs, setPrefs] = useState<StatsBreakdownPrefs>(loadPrefs);
  const update = (p: Partial<StatsBreakdownPrefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      storePrefs(next);
      return next;
    });
  const base = stats.status === 'ready' ? stats.view : null;
  const filter = base && query ? prefs.filter : 'all';
  // 絞った分布（チップを替えるたびに取る）。読み込み中は前の表示を薄くして残す
  const [filtered, setFiltered] = useState<{
    key: string;
    /** 注記に出す名前（読み込み中に前の表示を残すときも、その表示の名前を出す）。 */
    name: string;
    view: DistributionView | null;
  } | null>(null);
  const filterKey = query
    ? `${filter}:${query.scenarioId}:${query.seed}:${query.stackId}:${query.framework}`
    : '';
  useEffect(() => {
    if (!base || !query || filter === 'all') return;
    let alive = true;
    const name = filterName(filter, query);
    void loadFilteredView({ ...query, filter, included: base.included }).then(
      (view) => {
        if (alive) setFiltered({ key: filterKey, name, view });
      },
    );
    return () => {
      alive = false;
    };
    // 取り直すのは絞り込み（filterKey）と、全部の分布が取れたか・自分が入っているかが変わったときだけ
  }, [filterKey, base?.included, base !== null]);

  // 出す分布: 全部 → そのまま。絞り込み → 取れた絞った分布。読み込み中は前に出した絞った分布（無ければ全部）を薄くして残す。
  // 取れなければ全部の分布に戻して一言添える
  let shown: StatsView = stats;
  let loading = false;
  let failed = false;
  let shownFilter: { name: string; top: DistributionView | null } | null = null;
  if (base && filter !== 'all') {
    const cur = filtered?.key === filterKey ? filtered : null;
    loading = cur === null;
    failed = cur !== null && cur.view === null;
    const src = cur ?? (loading ? filtered : null);
    if (src?.view) {
      shown = { status: 'ready', view: src.view };
      shownFilter = { name: src.name, top: base };
    }
  }
  return (
    <>
      <div
        className={loading ? 'opacity-60 transition-opacity' : undefined}
        aria-busy={loading || undefined}
        data-stats-filter={filter}
      >
        <ResultAxesPanel
          comparisons={comparisons}
          stats={shown}
          outages={outages}
          {...(cashGuide !== undefined ? { cashGuide } : {})}
          {...(shownFilter ? { filter: shownFilter } : {})}
        >
          {base && query && (
            <div className="mb-2 space-y-1" data-stats-filter-chips>
              <Chips
                name="filter"
                label="分布の絞り込み"
                value={filter}
                onChange={(v) => update({ filter: v })}
                options={STATS_FILTERS.map((f) => ({
                  value: f,
                  label: STATS_FILTER_LABEL[f],
                  ...(f !== 'all' ? { title: filterName(f, query) } : {}),
                }))}
              />
              {failed && (
                <p className="text-xs opacity-70" data-stats-filter-failed>
                  絞った分布を読み込めなかったので、全部の分布を出しています。
                </p>
              )}
            </div>
          )}
        </ResultAxesPanel>
      </div>
      {query && (stats.status === 'ready' || stats.status === 'few') && (
        <GroupCompare
          query={query}
          by={prefs.by}
          axis={prefs.axis}
          onChange={update}
        />
      )}
    </>
  );
}

/** 構成ごと（フレームワークごと）の分布の比較の図（全シード）。 */
function GroupCompare({
  query,
  by,
  axis,
  onChange,
}: {
  query: StatsQuery;
  by: GroupBy;
  axis: ResultAxisId;
  onChange: (p: Partial<StatsBreakdownPrefs>) => void;
}) {
  const keys = useMemo(() => groupKeys(by), [by]);
  const value = query.axes[axis];
  const reqKey = `${by}:${axis}:${query.scenarioId}:${query.seed}`;
  const [res, setRes] = useState<{
    key: string;
    data: { groups: GroupStat[]; mock: boolean } | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadGroups({
      scenarioId: query.scenarioId,
      seed: query.seed,
      axis,
      by,
      value,
      keys: keys.map((k) => k.key),
    }).then((data) => {
      if (alive) setRes({ key: reqKey, data });
    });
    return () => {
      alive = false;
    };
    // 取り直すのは分け方・軸・プレイ（reqKey）が変わったときだけ
  }, [reqKey]);
  const cur = res?.key === reqKey ? res : null;
  // 読み込み中は前の図を薄くして残す（形が跳ねないように）
  const data = cur ? cur.data : (res?.data ?? null);
  const mineKey = by === 'stack' ? query.stackId : query.framework;
  const rows = data ? groupRowsOf(data.groups, keys, mineKey) : null;
  const def = RESULT_AXES.find((a) => a.id === axis)!;
  const format = AXIS_FORMAT[axis];
  const byName = by === 'stack' ? '構成' : 'フレームワーク';
  return (
    <section
      className="rounded-box border border-base-300 p-3"
      aria-labelledby="group-compare-title"
      data-group-compare
      data-axis={axis}
      data-by={by}
      data-directed={def.directed ? 'true' : 'false'}
    >
      <h3 id="group-compare-title" className="font-bold">
        {byName}ごとの分布
      </h3>
      <p className="mb-2 text-xs opacity-70">
        全シードの完走を{byName}
        ごとに分けて、真ん中の半分（25〜75%）を帯、中央値を縦の印で描きます。縦の線はあなたの値です。
        {MIN_DISTRIBUTION_COUNT} 件未満の行は帯を出しません。
        {data?.mock && '開発用の架空の値です（遊んだ人の結果ではありません）。'}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Chips
          name="axis"
          label="比べる軸"
          value={axis}
          onChange={(v) => onChange({ axis: v })}
          options={RESULT_AXES.map((a) => ({
            value: a.id,
            label: `${AXIS_MARK[a.id]} ${a.label}`,
          }))}
        />
        <Chips
          name="by"
          label="分け方"
          value={by}
          onChange={(v) => onChange({ by: v })}
          options={[
            { value: 'stack', label: '構成ごと' },
            { value: 'framework', label: 'フレームワークごと' },
          ]}
        />
      </div>
      <p className="mb-1 text-xs" data-group-direction>
        {def.directed
          ? `${def.label}は右ほど上位です。`
          : `${def.label}は高い・低いで良し悪しを付けません。`}
        あなたの値は {format(value)} です。
      </p>
      {rows ? (
        <div
          className={cur ? undefined : 'opacity-60 transition-opacity'}
          aria-busy={cur ? undefined : true}
        >
          <GroupRangeChart
            rows={rows}
            value={value}
            format={format}
            label={`${byName}ごとの${def.label}の分布（25〜75% と中央値）`}
            emptyText={(n) => `まだ ${n} 件です`}
          />
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">数値で見る</summary>
            <table className="table-xs table mt-1" data-group-table>
              <thead>
                <tr>
                  <th>{byName}</th>
                  <th className="text-right">件数</th>
                  <th className="text-right">25%</th>
                  <th className="text-right">中央値</th>
                  <th className="text-right">75%</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.label}
                      {r.mine && '（あなた）'}
                    </td>
                    <td className="text-right">{r.count}</td>
                    {r.stats ? (
                      <>
                        <td className="text-right">{format(r.stats.p25)}</td>
                        <td className="text-right">{format(r.stats.median)}</td>
                        <td className="text-right">{format(r.stats.p75)}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="text-right opacity-70">
                        まだ {r.count} 件です
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : (
        <p className="text-xs opacity-70" data-group-status>
          {cur
            ? `${byName}ごとの分布を読み込めませんでした。`
            : '読み込んでいます。'}
        </p>
      )}
    </section>
  );
}
