// 統計の画面（ヘッダーの 3 つ目のタブ「統計」・?mode=stats。D-197）。集計した完走のプレイ（全シード）の 4 軸の分布と、構成ごとの比較の図。
// - 部品は結果の画面のもの（HistogramChart・stats-breakdown.tsx の Chips・GroupCompare・絞り込みの記録）を使い回す。
// - distribution の口はシードが必須なので、手元の最新の完走のシード（無ければ 0）を付けて取り、全シードの側だけを使う（loadAllSeeds）。
// - このブラウザの結果の履歴から、選んだシナリオの最新の完走の 4 軸を「▼ あなた」として重ねる（無ければ印を出さない）。
// - 出さないもの: 上位 % と「★ 上位」の印・花火（結果の画面のもの）・完走率・途中終了の数・構成の人気（prd/15 §6・§7）。
// VITE_STATS_ENABLED（開発は VITE_STATS_MOCK）が無ければ App.tsx がこの画面を開かない。
import { RESULT_AXES, SCENARIOS, type ResultAxisId } from 'game';
import { useEffect, useState } from 'react';
import { HistogramChart } from './charts.tsx';
import {
  filterParams,
  MIN_DISTRIBUTION_COUNT,
  STATS_FILTER_LABEL,
  STATS_FILTERS,
  type StatsFilter,
} from './distribution.ts';
import { CAPTION } from './result-axes.tsx';
import type { ResultEntry } from './results-history.ts';
import {
  AXIS_FORMAT,
  AXIS_MARK,
  Chips,
  filterName,
  GroupCompare,
  useBreakdownPrefs,
} from './stats-breakdown.tsx';
import { loadAllSeeds, type AllSeedsView } from './stats-client.ts';
import type { Histogram } from 'stats';

const SCENARIO_IDS = Object.keys(SCENARIOS);

/** 選んだシナリオの最新の完走（履歴は新しい順）。途中終了は 4 軸を出さないので重ねない。 */
export const latestCompleted = (
  entries: readonly ResultEntry[],
  scenarioId: string,
): ResultEntry | undefined =>
  entries.find(
    (e) => e.scenarioId === scenarioId && e.end.reason === 'completed',
  );

/** 最初に開くシナリオ: 最後に完走したシナリオ（無ければ登録順の最初）。 */
const initialScenario = (entries: readonly ResultEntry[]): string => {
  const last = entries.find(
    (e) => e.end.reason === 'completed' && SCENARIO_IDS.includes(e.scenarioId),
  );
  return last?.scenarioId ?? SCENARIO_IDS[0]!;
};

export function StatsMode({ results }: { results: readonly ResultEntry[] }) {
  const [scenarioId, setScenarioId] = useState(() => initialScenario(results));
  const own = latestCompleted(results, scenarioId);
  // 絞り込みのチップは自分の最新の完走の構成・フレームワークで絞る（結果の画面と同じ。それを覚える前の記録では出さない）
  const mine =
    own?.stackId !== undefined && own.framework !== undefined
      ? { stackId: own.stackId, framework: own.framework }
      : undefined;
  const [prefs, update] = useBreakdownPrefs();
  const filter: StatsFilter = mine ? prefs.filter : 'all';
  const seed = own?.seed ?? 0;
  const key = `${scenarioId}:${filter}:${mine?.stackId ?? ''}:${mine?.framework ?? ''}:${seed}`;
  const [res, setRes] = useState<{
    key: string;
    view: AllSeedsView | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAllSeeds({
      scenarioId,
      seed,
      ...(mine ? filterParams(filter, mine) : {}),
      ...(own ? { center: own.axes } : {}),
      filter,
    }).then((view) => {
      if (alive) setRes({ key, view });
    });
    return () => {
      alive = false;
    };
    // 取り直すのはシナリオ・絞り込み・自分の最新の完走（key）が変わったときだけ
  }, [key]);
  const cur = res?.key === key ? res : null;
  const status: 'loading' | 'failed' | 'ready' = !cur
    ? 'loading'
    : cur.view
      ? 'ready'
      : 'failed';
  // 読み込み中は前の表示（別のシナリオ・絞り込み）を薄くして残す（形が跳ねないように）。初回は読み込み中の文だけ
  const view = cur ? cur.view : (res?.view ?? null);
  const total = view?.axes.cash.count ?? 0;
  const scenario = SCENARIOS[scenarioId]!;
  return (
    <section
      className="card bg-base-100 shadow"
      aria-labelledby="stats-title"
      data-stats-mode
      data-stats-status={status}
    >
      <div className="card-body min-w-0 gap-3 px-3 py-4 sm:p-6">
        <h2 id="stats-title" className="card-title text-base sm:text-lg">
          遊んだ人の結果の分布
        </h2>
        <p className="text-sm opacity-80">
          集計した完走のプレイ（全シード）の 4
          つの軸の分布と、構成ごとの比較です。集計に届いた結果だけを数えます。
        </p>
        <Chips
          name="scenario"
          label="シナリオ"
          value={scenarioId}
          onChange={setScenarioId}
          options={SCENARIO_IDS.map((id) => ({
            value: id,
            label: SCENARIOS[id]!.name,
          }))}
        />
        <OwnNote own={own} />
        {mine && (
          <Chips
            name="filter"
            label="分布の絞り込み"
            value={filter}
            onChange={(v) => update({ filter: v })}
            options={STATS_FILTERS.map((f) => ({
              value: f,
              label: STATS_FILTER_LABEL[f],
              ...(f !== 'all' ? { title: filterName(f, mine) } : {}),
            }))}
          />
        )}
        <StatusNote
          status={status}
          total={total}
          mock={view?.mock === true}
          filter={mine && filter !== 'all' ? filterName(filter, mine) : ''}
        />
        {view && (
          <div
            className={
              status === 'loading' ? 'opacity-60 transition-opacity' : undefined
            }
            aria-busy={status === 'loading' || undefined}
          >
            <h3 className="sr-only">{scenario.name}の 4 つの軸の分布</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RESULT_AXES.map((a) => (
                <AxisCard
                  key={a.id}
                  id={a.id}
                  label={a.label}
                  histogram={view.axes[a.id]}
                  {...(own ? { value: own.axes[a.id] } : {})}
                />
              ))}
            </ul>
          </div>
        )}
        {view && total > 0 && (
          <GroupCompare
            scenarioId={scenarioId}
            seed={seed}
            {...(own ? { value: own.axes[prefs.axis] } : {})}
            mine={mine}
            by={prefs.by}
            axis={prefs.axis}
            onChange={update}
          />
        )}
      </div>
    </section>
  );
}

/** どの結果を「▼ あなた」として重ねているか（無ければ控えめな案内）。 */
function OwnNote({ own }: { own: ResultEntry | undefined }) {
  if (!own)
    return (
      <p className="text-xs opacity-70" data-stats-own="none">
        このシナリオを完走すると、ここにあなたの位置が出ます。
      </p>
    );
  return (
    <p className="text-xs" data-stats-own="latest">
      <span className="font-semibold">▼ あなた</span>
      <span className="opacity-80">
        : このブラウザの最新の完走（{own.finishedAt}・{own.setup}・シード{' '}
        {own.seed}）を重ねています。
      </span>
    </p>
  );
}

function StatusNote({
  status,
  total,
  mock,
  filter,
}: {
  status: 'loading' | 'failed' | 'ready';
  total: number;
  mock: boolean;
  /** 絞り込みの名前（全部なら空）。 */
  filter: string;
}) {
  let text: string;
  if (status === 'loading') text = '集計の分布を読み込んでいます。';
  else if (status === 'failed')
    text = '集計の分布を読み込めませんでした。時間をおいて開き直してください。';
  else if (total === 0)
    text = filter
      ? `${filter}の完走はまだ集計にありません。`
      : 'まだ集計された完走がありません。';
  else if (total < MIN_DISTRIBUTION_COUNT)
    text = `${filter ? `${filter}の` : ''}集計された完走はまだ ${total} 件です。${MIN_DISTRIBUTION_COUNT} 件から分布を出します。`;
  else text = `${filter ? `${filter}の` : ''}完走 ${total} 件の分布です。`;
  return (
    <p
      className="text-xs opacity-70"
      role={status === 'failed' ? 'alert' : undefined}
      data-stats-note={
        status === 'ready'
          ? total === 0
            ? 'empty'
            : total < MIN_DISTRIBUTION_COUNT
              ? 'few'
              : 'ready'
          : status
      }
    >
      {mock && '開発用の架空の分布です（遊んだ人の結果ではありません）。'}
      {text}
    </p>
  );
}

/** 1 つの軸の全シードの分布（件数・中央値のテキスト・ヒストグラム・数値の表）。 */
function AxisCard({
  id,
  label,
  histogram,
  value,
}: {
  id: ResultAxisId;
  label: string;
  histogram: Histogram;
  value?: number;
}) {
  const f = AXIS_FORMAT[id];
  const enough = histogram.count >= MIN_DISTRIBUTION_COUNT;
  const median = histogram.median;
  const summary = `${histogram.count} 件${median != null ? `・中央値は ${f(median)} です` : ''}`;
  return (
    <li
      className="rounded-box border border-base-300 bg-base-100 p-3"
      data-axis={id}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold">
          {AXIS_MARK[id]} {label}
        </span>
        {value !== undefined && (
          <span className="text-xs tabular-nums" data-axis-own>
            あなた {f(value)}
          </span>
        )}
      </div>
      <div className="text-xs opacity-70">{CAPTION[id]}</div>
      {enough ? (
        <div className="mt-2" data-axis-distribution>
          <div className="text-xs tabular-nums" data-dist-summary>
            {summary}
          </div>
          <HistogramChart
            bins={histogram.bins}
            {...(value !== undefined ? { value } : {})}
            label={`全シードの${label}の分布（${summary}）`}
          />
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer">数値で見る</summary>
            <table className="table-xs table mt-1" data-axis-table>
              <thead>
                <tr>
                  <th>範囲</th>
                  <th className="text-right">件数</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {histogram.bins.map((b, i) => (
                  <tr key={i}>
                    <td>
                      {f(b.from)}〜{f(b.to)}
                    </td>
                    <td className="text-right">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-xs opacity-70" data-axis-few>
          まだ {histogram.count} 件なので出しません（{MIN_DISTRIBUTION_COUNT}{' '}
          件から出します）
        </p>
      )}
    </li>
  );
}
