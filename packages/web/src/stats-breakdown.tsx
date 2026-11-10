// 結果の画面の、構成・フレームワークごとの分布（ST-11・D-175）。完走のダイアログには置かない（ダイアログを複雑にしない）。
// - 絞り込みのチップ（全部 / 同じインフラ / 同じフレームワーク / 同じ組み合わせ）で、4 軸の分布（同じシード / 全シード）を切り替える。
// - 比較の図: 1 つの軸について、構成ごと（切り替えでフレームワークごと）の小さなヒストグラム（共通の区切り）と中央値の印・自分の値の縦の線。
// 絞り込みは見るためだけ。「★ 上位」の印と花火の段（D-163・D-168）は全部の構成の分布のまま。選んだチップ・軸・分け方は
// localStorage（STATS_BREAKDOWN_KEY）に覚える。VITE_STATS_ENABLED が無ければ取りに行かない（開発の VITE_STATS_MOCK は架空の値）。
import { FRAMEWORKS, RESULT_AXES, STACKS, type ResultAxisId } from 'game';
import { useEffect, useMemo, useState } from 'react';
import { GroupHistogramChart } from './charts.tsx';
import {
  DEFAULT_BREAKDOWN_PREFS,
  groupRowsOf,
  MIN_RANKED_COUNT,
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
  type GroupsView,
  type StatsQuery,
} from './stats-client.ts';

export const AXIS_FORMAT: Record<ResultAxisId, (n: number) => string> = {
  cash: usd,
  satisfaction: (n) => n.toFixed(2),
  featurePoints: (n) => String(Number(n.toFixed(1))),
  totalCost: usd,
};

export const AXIS_MARK: Record<ResultAxisId, string> = {
  cash: '①',
  satisfaction: '②',
  featurePoints: '③',
  totalCost: '④',
};

/** 構成の名前（STACKS の id → 名前。知らない id はそのまま）。 */
export const stackLabel = (id: string) =>
  STACKS.find((s) => s.id === id)?.name ?? id;
export const frameworkLabel = (id: string) =>
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

/** 選んだ絞り込み・比較の図の軸と分け方（結果の画面と統計の画面で同じ記録を使う。D-197）。 */
export function useBreakdownPrefs() {
  const [prefs, setPrefs] = useState<StatsBreakdownPrefs>(loadPrefs);
  const update = (p: Partial<StatsBreakdownPrefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      storePrefs(next);
      return next;
    });
  return [prefs, update] as const;
}

/** 小さな選択のチップ（1 つだけ選ぶ）。 */
export function Chips<T extends string>({
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
export function filterName(
  filter: StatsFilter,
  q: { stackId: string; framework: string },
): string {
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
  const [prefs, update] = useBreakdownPrefs();
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
          scenarioId={query.scenarioId}
          seed={query.seed}
          value={query.axes[prefs.axis]}
          mine={query}
          by={prefs.by}
          axis={prefs.axis}
          onChange={update}
        />
      )}
    </>
  );
}

/**
 * 構成ごと（フレームワークごと）の分布の比較の図（全シード）。結果の画面と統計の画面（D-197）で共用する。
 * value・mine が無ければ（統計の画面でまだ完走していない）自分の線と「（あなた）」の行を出さない。
 */
export function GroupCompare({
  scenarioId,
  seed,
  value,
  mine,
  by,
  axis,
  onChange,
}: {
  scenarioId: string;
  /** 架空の値の乱数の元（サーバーの口には付けない。全シード）。 */
  seed: number;
  /** 選んだ軸の自分の値。 */
  value?: number;
  /** 自分のプレイの構成・フレームワーク（その行を強調する）。 */
  mine?: { stackId: string; framework: string } | undefined;
  by: GroupBy;
  axis: ResultAxisId;
  onChange: (p: Partial<StatsBreakdownPrefs>) => void;
}) {
  const keys = useMemo(() => groupKeys(by), [by]);
  const reqKey = `${by}:${axis}:${scenarioId}:${seed}:${value ?? ''}`;
  const [res, setRes] = useState<{
    key: string;
    data: GroupsView | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadGroups({
      scenarioId,
      seed,
      axis,
      by,
      ...(value !== undefined ? { value } : {}),
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
  const mineKey = mine ? (by === 'stack' ? mine.stackId : mine.framework) : '';
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
        ごとに分けて（集計にまだ無い{byName}
        の行は出しません）、同じ区切りのヒストグラムを並べます。棒の高さは行ごとの一番高い棒をそろえた高さで、件数の違う行どうしでも形を比べられます（件数は右の数で見てください）。棒の下の短い印は中央値
        {value !== undefined ? '、縦の線はあなたの値' : ''}です。 件数に ※
        の付いた行はまだ {MIN_RANKED_COUNT} 件未満なので、形は参考程度です。
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
        {value !== undefined && `あなたの値は ${format(value)} です。`}
      </p>
      {rows && rows.length === 0 ? (
        <p className="text-xs opacity-70" data-group-status="empty">
          {`まだ${byName}ごとに数えられる完走がありません。`}
        </p>
      ) : rows ? (
        <div
          className={cur ? undefined : 'opacity-60 transition-opacity'}
          aria-busy={cur ? undefined : true}
        >
          <GroupHistogramChart
            rows={rows}
            binEdges={data!.binEdges}
            {...(value !== undefined ? { value } : {})}
            format={format}
            label={`${byName}ごとの${def.label}の分布（ヒストグラムと中央値）`}
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
                    <td className="text-right" data-group-table-count>
                      {r.count}
                      {r.few && ' ※'}
                    </td>
                    <td className="text-right">{format(r.stats.p25)}</td>
                    <td className="text-right">{format(r.stats.median)}</td>
                    <td className="text-right">{format(r.stats.p75)}</td>
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
