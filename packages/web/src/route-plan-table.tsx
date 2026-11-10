// ページごとの描き方の表（D-106・D-107）。始める画面・見積モード・フレームワークのカードで共有する。
// 行は game の routePlanRows（workloadFor が当てる描き方と同じ）。onSelect を渡すと、描き方の一覧（選んでいるものも含む）からボタンで選べる。
// status を渡すと、行ごとに要件の判定（鮮度・SNS のカード・1 リクエストの CPU の制限）とほかの描き方の 1 か月目の差を出す。
// 色は見取り図の作られ方の色を流用し、必ず文字を添える。描き方の番号（S1〜S6）は画面に出さず、名前だけにする（D-112）。
// 始める画面ではフレームワークのカードのページごとにチップ（RouteChips）で選び、表は「詳しく比べる」のダイアログに出す（D-112）。
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

/**
 * 行の要件の判定（鮮度・SNS のカード・CPU の制限）。文は ⓘ に畳む。
 * badges: フレームワークのカードのページの欄に出す小さい札（D-112）。表の中は文字の列。
 */
export function RowStatus({
  s,
  variant = 'inline',
}: {
  s: RouteRowStatus;
  variant?: 'inline' | 'badges';
}) {
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
  const badges = variant === 'badges';
  const tone = (mark: string) =>
    badges
      ? mark === '✗'
        ? 'badge-error'
        : mark === '△'
          ? 'badge-warning'
          : 'badge-success'
      : mark === '✗'
        ? 'text-error'
        : mark === '△'
          ? 'text-warning'
          : '';
  return (
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
              ? `badge h-6 gap-0.5 badge-outline badge-sm pr-0 whitespace-nowrap ${i.text ? '' : 'pr-2'} ${tone(i.mark)}`
              : tone(i.mark)
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
 * 行のページの部品（記事のページのコメント欄。D-109）。onChange を渡すとラジオで選べ、渡さなければ今の選択を文字で出す。
 */
export function RowParts({
  row,
  onChange,
  disabledReason,
  namePrefix = 'part',
}: {
  row: RoutePlanRow;
  /** ラジオの name の頭（同じ画面に表とカードの両方が出るときに組を分ける）。 */
  namePrefix?: string;
  onChange?: (row: RoutePlanRow, part: RoutePartKey, value: number) => void;
  disabledReason?: (
    row: RoutePlanRow,
    part: RoutePartKey,
    value: number,
  ) => string | null | undefined;
}) {
  if (row.parts.length === 0) return null;
  const label = (p: RoutePartRow) =>
    p.options.find((o) => o.value === p.value)?.label ?? '';
  return (
    <ul aria-label="ページの部品" className="mt-1 space-y-0.5 text-[11px]">
      {row.parts.map((p) => (
        <li key={p.part} data-part={p.part} data-value={p.value}>
          {onChange ? (
            <fieldset className="flex flex-wrap items-center gap-x-2">
              <legend className="contents">
                <span className="opacity-70">└ {p.label}:</span>
              </legend>
              {p.options.map((o) => {
                const why =
                  o.value === p.value
                    ? undefined
                    : disabledReason?.(row, p.part, o.value);
                return (
                  <label
                    key={o.value}
                    className={`inline-flex items-center gap-1 ${why ? 'opacity-50' : 'cursor-pointer'}`}
                    title={why ?? o.flavor}
                  >
                    <input
                      type="radio"
                      className="radio radio-xs"
                      name={`${namePrefix}-${row.route}-${p.part}`}
                      checked={o.value === p.value}
                      disabled={Boolean(why)}
                      onChange={() => onChange(row, p.part, o.value)}
                    />
                    {o.label}
                    {why && <span className="opacity-70">（{why}）</span>}
                  </label>
                );
              })}
              <Info label={`${p.label}の説明`}>{p.note}</Info>
            </fieldset>
          ) : (
            <span className="opacity-70">
              {p.label}: {label(p)}
              <Info label={`${p.label}の説明`}>{p.note}</Info>
            </span>
          )}
        </li>
      ))}
    </ul>
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
  onPart,
  partDisabledReason,
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
  onPart?: (row: RoutePlanRow, part: RoutePartKey, value: number) => void;
  /** 部品の選択肢を選べない理由（ゲームの途中で手間が足りないなど）。 */
  partDisabledReason?: (
    row: RoutePlanRow,
    part: RoutePartKey,
    value: number,
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
                        既定から変わっている: {r.overriddenBy}
                      </span>
                    )}
                    <RowParts
                      row={r}
                      {...(onPart ? { onChange: onPart } : {})}
                      {...(partDisabledReason
                        ? { disabledReason: partDisabledReason }
                        : {})}
                    />
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
                            className={`inline-flex items-center gap-1 rounded border border-base-300 text-[11px] ${
                              a.available
                                ? ''
                                : 'bg-base-200 px-1 py-0.5 opacity-50'
                            }`}
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
                                className={`inline-flex items-center gap-1 ${a.available ? 'px-1 py-0.5' : ''}`}
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
}: {
  row: RoutePlanRow;
  describe?: boolean;
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
              className={`${box} bg-primary/10 pr-0.5 pl-2 font-medium ring-2 ring-primary ring-inset`}
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
              <Info label={`${r.strategyLabel}の説明`}>
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
              </Info>
            </li>
          );
        }
        const a = c.alt;
        const why = a.available ? disabledReason?.(r, a) : undefined;
        const pick = onSelect && a.available && !why;
        return (
          <li
            key={a.strategy}
            data-alternative={a.strategy}
            data-available={a.available}
            data-selected="false"
            className={`${box} pr-0.5 pl-2 ring-1 ring-base-300 ring-inset ${
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
            <Info
              label={`${a.label}${a.available ? 'の説明' : 'が使えない理由'}`}
            >
              {why && <p className="font-semibold">{why}</p>}
              {a.termNote && <p>{a.termNote}</p>}
              <p>
                {a.reason}
                {a.basis === 'assumption' && '（ゲーム上の仮定）'}
              </p>
            </Info>
          </li>
        );
      })}
    </ul>
  );
}

/** 表の下の注記（始める画面・見積モードで同じ文）。 */
export const ROUTE_PLAN_NOTE =
  '描き方はフレームワークの既定から、ページごとに選び直せます（人ごとに違うページは使い回す描き方を選べません）。期限か、投稿・編集のときに消すかは、カードの記事のページの行の設定（再検証・記事のキャッシュ）で決まります。費用の差は 1 か月目の基準の規模での目安です。公式の文書で確かめていない組み合わせは出していません。';
