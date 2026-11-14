// ページごとの描き方の表（D-106・D-107）。始める画面・見積モード・フレームワークのカードで共有する。
// 行は game の routePlanRows（workloadFor が当てる描き方と同じ）。onSelect を渡すと、描き方の一覧（選んでいるものも含む）からボタンで選べる。
// status を渡すと、行ごとに要件の判定（反映スピード・SNS のカード・1 リクエストの CPU の制限）とほかの描き方の 1 か月目の差を出す。
// 色は見取り図の作られ方の色を流用し、必ず文字を添える。描き方の番号（S1〜S6）は画面に出さず、名前だけにする（D-112）。
// 始める画面ではフレームワークのカードのページごとにチップ（RouteChips）で選び、表は「詳しく比べる」のダイアログに出す（D-112）。
import type { ReactNode } from 'react';
import clsx from 'clsx';
import type {
  RegionSource,
  RouteAlternative,
  RoutePartKey,
  RoutePartRow,
  RoutePlanRow,
  RouteRowStatus,
  RouteStrategyId,
} from 'game';
import { ROUTE_STRATEGIES, ROUTE_STRATEGY_ORDER } from 'catalog';
import { Info } from './info.tsx';
import { SOURCE_CLASS, SOURCE_STYLE } from './page-wireframes.tsx';
import { signedText } from './format.ts';

/** 描き方 → 見取り図の作られ方（色だけに使う）。 */
const STRATEGY_SOURCE: Record<RouteStrategyId, RegionSource> = {
  'static-build': 'build',
  'cached-ttl': 'isr',
  'cached-purge': 'cached',
  ssr: 'ssr',
  'shell-api': 'api',
  'server-island': 'server-island',
  'cache-components': 'cc-cached',
};

export function Swatch({
  strategy,
  className = 'mt-0.5',
}: {
  strategy: RouteStrategyId;
  className?: string;
}) {
  const s = STRATEGY_SOURCE[strategy];
  return (
    <span
      aria-hidden
      className={`${className} inline-block h-3 w-4 shrink-0 rounded-sm border ${SOURCE_CLASS[s]}`}
      style={SOURCE_STYLE[s]}
    />
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedUsd = (n: number) =>
  signedText(n, (a) => `$${Math.round(a).toLocaleString('en-US')}`);

const MARK = { good: '✓', fair: '△', bad: '✗' } as const;

/** 描き方の列に並べる一覧（選んでいるもの + ほかの描き方を ROUTE_STRATEGY_ORDER の順に）。 */
type Choice =
  | { kind: 'selected'; strategy: RouteStrategyId }
  | { kind: 'other'; strategy: RouteStrategyId; alt: RouteAlternative };
function choicesOf(r: RoutePlanRow): Choice[] {
  const all: Choice[] = [
    { kind: 'selected', strategy: r.strategy },
    ...r.alternatives.map((alt): Choice => ({
      kind: 'other',
      strategy: alt.strategy,
      alt,
    })),
  ];
  const rank = (s: RouteStrategyId) => ROUTE_STRATEGY_ORDER.indexOf(s);
  return all.sort((x, y) => rank(x.strategy) - rank(y.strategy));
}

/** 選んでいる描き方のチップの中身（差は出さない）。 */
function SelectedBody({ r }: { r: RoutePlanRow }) {
  return (
    <>
      <span aria-hidden>✓</span>
      {r.strategyLabel}
      <span className="badge badge-primary badge-xs">選択中</span>
    </>
  );
}

/** 行の要件の判定の項目（反映スピード・SNS のカード・1 リクエストの CPU）。 */
function statusItems(s: RouteRowStatus) {
  const items: { key: string; mark: string; label: string; text?: string }[] =
    [];
  if (s.freshness)
    items.push({
      key: 'freshness',
      mark: MARK[s.freshness.stage],
      label: '反映スピード',
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
  return items;
}

/**
 * 行の要件の判定（反映スピード・SNS のカード・CPU の制限）。文は ⓘ に畳む。
 * badges: フレームワークのカードのページの欄に出す小さい札（D-112）。表の中は文字の列。
 */
export function RowStatus({
  s,
  variant = 'inline',
  issuesOnly = false,
}: {
  s: RouteRowStatus;
  variant?: 'inline' | 'badges';
  /**
   * 問題のある判定（△・✗）だけを、ⓘ なしで出す（フレームワークのカード。満たしている判定と判定の文はカードの ⓘ の RowExplain。D-219）。
   */
  issuesOnly?: boolean;
}) {
  const all = statusItems(s);
  const items = issuesOnly ? all.filter((i) => i.mark !== '✓') : all;
  if (items.length === 0) return null;
  const badges = variant === 'badges';
  const tone = (mark: string) =>
    badges
      ? mark === '✗'
        ? 'badge-error'
        : mark === '△'
          ? 'badge-warning'
          : 'badge-success'
      : mark === '✗'
        ? 'text-error-strong'
        : mark === '△'
          ? 'text-warning'
          : '';
  const list = (
    <ul
      aria-label="要件の判定"
      className={
        badges
          ? 'flex flex-wrap gap-1'
          : 'mt-1 flex flex-wrap gap-x-2 text-[11px]'
      }
    >
      {items.map((i) => (
        <li
          key={i.key}
          data-check={i.key}
          data-ok={i.mark === '✓'}
          className={
            badges
              ? `badge h-6 gap-0.5 badge-outline badge-sm pr-0 whitespace-nowrap ${i.text && !issuesOnly ? '' : 'pr-2'} ${tone(i.mark)}`
              : tone(i.mark)
          }
        >
          {i.mark} {i.label}
          {i.text && !issuesOnly && (
            <Info label={`${i.label}の判定`}>{i.text}</Info>
          )}
        </li>
      ))}
    </ul>
  );
  // カードには問題のある判定だけが出るので、何の札か分かるように見出しを付ける（D-220）
  if (!issuesOnly) return list;
  return (
    <div className="flex flex-wrap items-center gap-1" data-status-issues>
      <span className="text-xs font-semibold">注意が必要な制限:</span>
      {list}
      {/* 札ごとの判定の文は 1 つの ⓘ にまとめる（D-220） */}
      {items.some((i) => i.text) && (
        <span className="flex items-center text-xs opacity-80">
          それぞれの説明
          <Info label="注意が必要な制限の説明">
            <ul className="space-y-2">
              {/* カードの札と同じ色の札で頭を出し、どの札の説明か見分けられるようにする */}
              {items.map((i) => (
                <li key={i.key} className="space-y-0.5">
                  <span
                    className={`badge h-6 badge-outline badge-sm whitespace-nowrap ${tone(i.mark)}`}
                  >
                    {i.mark} {i.label}
                  </span>
                  {i.text && <p>{i.text}</p>}
                </li>
              ))}
            </ul>
          </Info>
        </span>
      )}
    </div>
  );
}

/**
 * ページ → 描き方 → なぜ → この構成の描き方の一覧（ROUTE_STRATEGY_ORDER の順。選んでいるものは枠で強調し、使えないものは灰色と理由の ⓘ）。
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
  /** ページの部品（記事のページのコメント欄。D-109）を選ぶ（渡さなければ今の選択を文字で出す）。 */
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
              <th>描き方（この構成で選べるもの）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = status?.find((s) => s.route === r.route);
              return (
                <tr key={r.route} data-route={r.route} className="align-top">
                  <th className="font-medium whitespace-nowrap">
                    {r.label}
                    <span className="block text-[11px] font-normal opacity-70">
                      {r.audience === 'public' ? '全員に同じ' : '人ごとに違う'}
                      ・{pct(r.share)}
                    </span>
                  </th>
                  <td className="min-w-40" data-strategy={r.strategy}>
                    <span className="flex items-start gap-1.5">
                      <Swatch strategy={r.strategy} />
                      <span
                        {...(r.strategyTermNote
                          ? { title: r.strategyTermNote }
                          : {})}
                      >
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
                        {r.overriddenBy}
                      </span>
                    )}
                    {st && <RowStatus s={st} />}
                  </td>
                  <td className="min-w-48 text-xs opacity-80">{r.why}</td>
                  <td className="min-w-48">
                    <ul
                      role="group"
                      aria-label={`${r.label}の描き方`}
                      className="flex flex-wrap gap-1"
                    >
                      {choicesOf(r).map((c) => {
                        if (c.kind === 'selected')
                          return (
                            <li
                              key={c.strategy}
                              data-alternative={c.strategy}
                              data-available="true"
                              data-selected="true"
                              className="inline-flex items-center gap-1 rounded border border-primary bg-primary/10 text-[11px] ring-1 ring-primary"
                            >
                              {onSelect ? (
                                <button
                                  type="button"
                                  aria-pressed="true"
                                  className="btn h-auto min-h-0 cursor-default gap-1 px-1 py-0.5 text-[11px] font-normal btn-ghost btn-xs"
                                  aria-label={`${r.label}は ${r.strategyLabel}（選択中）`}
                                >
                                  <SelectedBody r={r} />
                                </button>
                              ) : (
                                <span
                                  aria-current="true"
                                  className="inline-flex items-center gap-1 px-1 py-0.5"
                                >
                                  <SelectedBody r={r} />
                                </span>
                              )}
                            </li>
                          );
                        const a = c.alt;
                        const why = a.available
                          ? disabledReason?.(r, a)
                          : undefined;
                        const delta = st?.deltas[a.strategy];
                        const pick = onSelect && a.available && !why;
                        const body = (
                          <>
                            {a.label}
                            {delta && (
                              <span
                                className="tabular-nums opacity-70"
                                title="1 か月目の費用の差（目安）"
                              >
                                {signedUsd(delta.costUsd)}
                                {delta.blocking !== 0 &&
                                  `・止まる上限に達する数 ${delta.blocking > 0 ? '+' : '−'}${Math.abs(delta.blocking)}`}
                              </span>
                            )}
                          </>
                        );
                        return (
                          <li
                            key={a.strategy}
                            data-alternative={a.strategy}
                            data-available={a.available}
                            data-selected="false"
                            className={clsx(
                              'inline-flex items-center gap-1 rounded border border-base-300 text-[11px]',
                              !a.available &&
                                'bg-base-200 px-1 py-0.5 opacity-50',
                            )}
                          >
                            {pick ? (
                              <button
                                type="button"
                                aria-pressed="false"
                                className="btn h-auto min-h-0 gap-1 px-1 py-0.5 text-[11px] font-normal btn-ghost btn-xs"
                                onClick={() => onSelect(r, a)}
                                aria-label={`${r.label}を ${a.label}にする`}
                              >
                                {body}
                              </button>
                            ) : (
                              <span
                                className={clsx(
                                  'inline-flex items-center gap-1',
                                  a.available && 'px-1 py-0.5',
                                )}
                              >
                                {body}
                              </span>
                            )}
                            {!a.available && (
                              <span className="sr-only">（使えない）</span>
                            )}
                            {why && (
                              <span className="pr-1 opacity-70">（{why}）</span>
                            )}
                            <Info
                              label={`${a.label}${a.available ? '' : 'が使えない理由'}`}
                            >
                              {a.termNote && <>{a.termNote}。</>}
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
      {caption && <p className="text-xs opacity-70">{caption}</p>}
    </div>
  );
}

/**
 * ページの描き方のチップ（フレームワークのカードのページの欄。D-112）。表の描き方の列と同じ並び（ROUTE_STRATEGY_ORDER）で、
 * 選んでいるものは塗りと内側の枠で強調し、使えないものは灰色と理由の ⓘ。長い説明はチップの ⓘ、費用の差は「詳しく比べる」の表に出す。
 * どのチップも同じ高さ（h-7・1 行・長い名前は省略して aria-label と title に全文）。枠は inset の ring で、選んでも箱の大きさは変わらない。
 * onSelect を渡さなければ、選んでいる描き方のチップだけを読むだけで出す（選んでいないフレームワークのカード）。
 * describe: 選んでいるチップの ⓘ の先頭に描き方そのものの説明（long）を足す（フレームワークの既定と違う描き方で、本文に
 * フレームワークの説明の行を出さないとき。D-125）。
 */
export function RouteChips({
  row: r,
  onSelect,
  disabledReason,
  describe = false,
  info = true,
}: {
  row: RoutePlanRow;
  describe?: boolean;
  /** チップごとの ⓘ を出すか（フレームワークのカードはカードの ⓘ の RowExplain にまとめるので出さない。D-219）。 */
  info?: boolean;
  onSelect?: ((row: RoutePlanRow, alt: RouteAlternative) => void) | undefined;
  disabledReason?:
    | ((row: RoutePlanRow, alt: RouteAlternative) => string | null | undefined)
    | undefined;
}) {
  const box =
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-field text-xs';
  const choices = onSelect
    ? choicesOf(r)
    : choicesOf(r).filter((c) => c.kind === 'selected');
  return (
    <ul
      role="group"
      aria-label={`${r.label}の描き方`}
      className="flex flex-wrap gap-1"
    >
      {choices.map((c) => {
        if (c.kind === 'selected') {
          const body = (
            <>
              <Swatch strategy={r.strategy} className="" />
              <span className="truncate" title={r.strategyLabel}>
                {r.strategyLabel}
              </span>
              <span className="badge h-4 shrink-0 badge-xs px-1 badge-primary">
                {onSelect ? '選択中' : '既定'}
              </span>
            </>
          );
          return (
            <li
              key={c.strategy}
              data-alternative={c.strategy}
              data-available="true"
              data-selected="true"
              className={`${box} bg-primary/10 ${info ? 'pr-0.5' : 'pr-2'} pl-2 font-medium ring-2 ring-primary ring-inset`}
            >
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed="true"
                  className="inline-flex h-full min-w-0 cursor-default items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label={`${r.label}は ${r.strategyLabel}（選択中）`}
                >
                  {body}
                </button>
              ) : (
                <span
                  aria-current="true"
                  className="inline-flex h-full min-w-0 items-center gap-1"
                >
                  {body}
                </span>
              )}
              {info && (
                <Info label={`${r.strategyLabel}の説明`}>
                  <SelectedExplain row={r} describe={describe} />
                </Info>
              )}
            </li>
          );
        }
        const a = c.alt;
        const why = a.available ? disabledReason?.(r, a) : undefined;
        const pick = onSelect && a.available && !why;
        // カード（info={false}）では選べない描き方にも ⓘ を付けず、ページの欄の下の「選べない選択肢について」にまとめる（D-220）
        const showInfo = info;
        return (
          <li
            key={a.strategy}
            data-alternative={a.strategy}
            data-available={a.available}
            data-selected="false"
            className={`${box} ${showInfo ? 'pr-0.5' : 'pr-2'} pl-2 ring-1 ring-base-300 ring-inset ${
              pick ? 'bg-base-100 hover:bg-base-200' : 'bg-base-200 opacity-50'
            }`}
          >
            {pick ? (
              <button
                type="button"
                aria-pressed="false"
                className="inline-flex h-full min-w-0 cursor-pointer items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => onSelect(r, a)}
                aria-label={`${r.label}を ${a.label}にする`}
              >
                <Swatch strategy={a.strategy} className="" />
                <span className="truncate" title={a.label}>
                  {a.label}
                </span>
              </button>
            ) : (
              <span className="inline-flex h-full min-w-0 items-center gap-1">
                <Swatch strategy={a.strategy} className="" />
                <span
                  className="truncate"
                  title={why ? `${a.label}（${why}）` : a.label}
                >
                  {a.label}
                </span>
                <span className="sr-only">
                  {a.available ? `（${why}）` : '（使えない）'}
                </span>
              </span>
            )}
            {showInfo && (
              <Info
                label={`${a.label}${a.available ? (why ? 'が選べない理由' : 'の説明') : 'が使えない理由'}`}
              >
                {why && <p className="font-semibold">{why}</p>}
                {a.termNote && <p>{a.termNote}</p>}
                <p>
                  {a.reason}
                  {a.basis === 'assumption' && '（ゲーム上の仮定）'}
                </p>
              </Info>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 行の選べない描き方と理由（使えない描き方は使えない理由）。カードの「選べない選択肢について」に使う。 */
export function unavailableOf(
  r: RoutePlanRow,
): { label: string; why: string }[] {
  return choicesOf(r).flatMap((c) =>
    c.kind === 'selected' || c.alt.available
      ? []
      : [
          {
            label: c.alt.label,
            why: `${c.alt.reason}${c.alt.basis === 'assumption' ? '（ゲーム上の仮定）' : ''}`,
          },
        ],
  );
}

/**
 * 選べない選択肢の理由を、1 つの ⓘ にまとめる（フレームワークのカードのページの欄の下。チップごとに ⓘ を並べない。D-220）。
 * 描き方そのものの説明は入れず、選べない理由だけを出す。無ければ何も出さない。
 */
export function UnavailableInfo({
  items,
}: {
  items: { label: string; why: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <p className="flex items-center gap-1 text-xs opacity-80" data-unavailable>
      選べない選択肢について
      <Info label="選べない選択肢について">
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.label}>
              <span className="font-semibold">{i.label}</span>: {i.why}
            </li>
          ))}
        </ul>
      </Info>
    </p>
  );
}

/** 選んでいる描き方の説明（チップの ⓘ とカードの ⓘ の RowExplain で共用）。 */
function SelectedExplain({
  row: r,
  describe,
}: {
  row: RoutePlanRow;
  describe: boolean;
}) {
  return (
    <>
      {r.strategyTermNote && <p>{r.strategyTermNote}</p>}
      {describe && <p>{ROUTE_STRATEGIES[r.strategy].long}</p>}
      <p>{r.why}</p>
      {r.detail.length > 0 && (
        <ul className="list-disc pl-5">
          {r.detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * フレームワークのカードの ⓘ の「詳しい説明」（D-219）。描き方ごとに畳み、ページをまたいで共通にする（D-220）:
 * 折りたたみの中は、描き方そのものの説明（呼び名の補足・長い説明）と、ページごとの扱い（選択中ならなぜ・値・extra、
 * 選べるならその描き方での注記、使えないなら理由）。要件の判定の文はカードの「それぞれの説明」に出すので、ここには出さない。
 * 並びは ROUTE_STRATEGY_ORDER で、どれかのページで選んでいる描き方を開く前から目立たせる。
 */
export function StrategyExplain({
  rows,
  extraOf,
}: {
  rows: RoutePlanRow[];
  /** ページの選んでいる描き方の中に添えるもの（ページの札・フレームワークの説明の行・設定の説明）。 */
  extraOf?: (route: string) => ReactNode;
}) {
  type Entry = {
    route: string;
    page: string;
    kind: 'selected' | 'available' | 'unavailable';
    row: RoutePlanRow;
    alt?: RouteAlternative;
  };
  const byStrategy = new Map<
    string,
    { label: string; termNote?: string; entries: Entry[] }
  >();
  const add = (
    s: string,
    label: string,
    termNote: string | undefined,
    e: Entry,
  ) => {
    const x = byStrategy.get(s) ?? {
      label,
      ...(termNote ? { termNote } : {}),
      entries: [],
    };
    x.entries.push(e);
    byStrategy.set(s, x);
  };
  for (const r of rows)
    for (const c of choicesOf(r)) {
      if (c.kind === 'selected')
        add(r.strategy, r.strategyLabel, r.strategyTermNote, {
          route: r.route,
          page: r.label,
          kind: 'selected',
          row: r,
        });
      else
        add(c.alt.strategy, c.alt.label, c.alt.termNote, {
          route: r.route,
          page: r.label,
          kind: c.alt.available ? 'available' : 'unavailable',
          row: r,
          alt: c.alt,
        });
    }
  const fold = 'collapse collapse-arrow rounded-box border border-base-300';
  const title =
    'collapse-title flex min-h-0 flex-wrap items-center gap-1.5 py-2 pr-8 pl-3 text-sm font-medium';
  return (
    <div className="space-y-1.5" data-strategy-explains>
      {ROUTE_STRATEGY_ORDER.filter((s) => byStrategy.has(s)).map((s) => {
        const x = byStrategy.get(s)!;
        const selectedIn = x.entries.filter((e) => e.kind === 'selected');
        return (
          <details
            key={s}
            className={clsx(fold, selectedIn.length > 0 && 'bg-primary/5')}
            data-strategy-explain={s}
            data-selected-in={selectedIn.map((e) => e.route).join(' ')}
          >
            <summary className={title}>
              <Swatch strategy={s as RoutePlanRow['strategy']} className="" />
              {x.label}
              {selectedIn.map((e) => (
                <span
                  key={e.route}
                  className="badge h-4 badge-xs px-1 badge-primary"
                >
                  {e.page}で選択中
                </span>
              ))}
            </summary>
            <div className="collapse-content space-y-2 px-3 text-sm">
              {x.termNote && <p>{x.termNote}。</p>}
              <p>{ROUTE_STRATEGIES[s as RoutePlanRow['strategy']].long}</p>
              <ul className="space-y-2">
                {x.entries.map((e) => (
                  <li
                    key={e.route}
                    className="space-y-1"
                    data-page-entry={e.route}
                  >
                    <p className="font-semibold">
                      {e.page}:{' '}
                      {e.kind === 'selected'
                        ? '選択中'
                        : e.kind === 'available'
                          ? '選べる'
                          : '使えない'}
                    </p>
                    {e.kind === 'selected' ? (
                      <>
                        <p>{e.row.why}</p>
                        {e.row.detail.length > 0 && (
                          <ul className="list-disc pl-5">
                            {e.row.detail.map((d) => (
                              <li key={d}>{d}</li>
                            ))}
                          </ul>
                        )}
                        {extraOf?.(e.route)}
                      </>
                    ) : (
                      <p>
                        {e.alt!.reason}
                        {e.alt!.basis === 'assumption' && '（ゲーム上の仮定）'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** 表の下の注記（始める画面・見積モードで同じ文）。 */
export const ROUTE_PLAN_NOTE =
  '描き方はフレームワークの既定から、ページごとに選び直せます（人ごとに違うページは使い回す描き方を選べません）。期限か、投稿・編集のときに消すかは、カードの記事のページの行の設定（再検証・記事のキャッシュ）で決まります。費用の差は 1 か月目の基準の規模での目安です。公式の文書で確かめていない組み合わせは出していません。';
