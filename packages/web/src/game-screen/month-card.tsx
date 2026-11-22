import clsx from 'clsx';
import {
  Eye,
  Gauge,
  Megaphone,
  MessagesSquare,
  CircleDot,
  CircleGauge,
  OctagonX,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserMinus,
  Image as ImageIcon,
  Puzzle,
  Target,
  Timer,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  isPolicyViolation,
  premisePlanLabel,
  ELEMENT_LABEL,
  elementsOf,
  STAGE_LABEL,
  type Element,
  type MonthReport,
  type Stage,
} from 'game';
import type { PlatformPremise } from 'estimator';
import { compact } from '../charts.tsx';
import { Info } from '../info.tsx';
import { usd } from '../commitment-meta.ts';
import { CreditBar } from '../credit-bar.tsx';
import {
  creditUseText,
  hitLabel,
  isCreditUse,
  isStopping,
  premiseCostOf,
  premiseIcon,
  premiseName,
} from '../premise-view.ts';
import { isZeroText, roundInt } from '../format.ts';
import { pct, STATUS, STAGE_CLS } from './shared.ts';
import { EventCard, eventBadge, BlockedBadge, TIER_LABEL } from './events.tsx';
import { hasWorkProgress, WorkProgressView } from './effort.tsx';

/** 満足度の要素の印（名前と並べて札に出す。名前だけより一目で見分けやすい）。 */
const ELEMENT_ICON: Record<Element, LucideIcon> = {
  availability: ShieldCheck,
  speed: Gauge,
  feature: Puzzle,
  freshness: RefreshCw,
  quality: ImageIcon,
  // 解析の要素（解析のあるシナリオだけ。D-238）
  analysisSpeed: Timer,
  analysisAccuracy: Target,
};

const STAGE_PANEL: Record<Stage, string> = {
  good: 'border-base-300',
  fair: 'border-warning/60 bg-warning/5',
  bad: 'border-error/40 bg-error/5',
};

const STAGE_TEXT: Record<Stage, string> = {
  good: '',
  fair: 'text-warning',
  bad: 'text-error-strong',
};

/** 満足度の札（アイコン・名前・段階を段階の色で）。 */
function ElementBadge({
  element: e,
  stage,
  className = '',
}: {
  element: Element;
  stage: Stage;
  className?: string;
}) {
  const Icon = ELEMENT_ICON[e];
  return (
    <span
      className={`badge gap-1 whitespace-nowrap ${STAGE_CLS[stage]} ${className}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {ELEMENT_LABEL[e]}
      <span className="font-semibold">{STAGE_LABEL[stage]}</span>
    </span>
  );
}

/** 「改善できる項目について」の ⓘ。理由のある要素が無ければ出さない。 */
function ImproveInfo({
  stages,
  reasons,
}: {
  stages: MonthReport['satisfaction']['stages'];
  reasons: MonthReport['satisfaction']['reasons'];
}) {
  const items = elementsOf(stages).filter((e) => reasons[e]);
  if (items.length === 0) return null;
  const worst: Stage = items.some((e) => stages[e] === 'bad') ? 'bad' : 'fair';
  const WorstIcon = worst === 'bad' ? OctagonX : TriangleAlert;
  return (
    <p
      className={`mt-1.5 flex items-center gap-1 text-sm font-semibold ${STAGE_TEXT[worst]}`}
      data-improve-info
    >
      <WorstIcon aria-hidden className="size-4 shrink-0" />
      改善できる項目について:
      <Info label="改善できる項目について" title="改善できる項目について">
        {/* 項目ごとに、段階の色の枠の中に本体と同じ札と理由（「良い」でない要素だけ） */}
        <ul className="space-y-2">
          {items.map((e) => {
            const stage = stages[e]!;
            const Icon = stage === 'bad' ? OctagonX : TriangleAlert;
            return (
              <li
                key={e}
                className={`flex items-start gap-2 rounded-box border p-2 ${STAGE_PANEL[stage]}`}
              >
                <Icon
                  aria-hidden
                  className={`mt-0.5 size-5 shrink-0 ${STAGE_TEXT[stage]}`}
                />
                <div className="min-w-0 space-y-1">
                  <ElementBadge element={e} stage={stage} />
                  <p className="text-sm">{reasons[e]}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Info>
    </p>
  );
}

/** 伸びの内訳の札。正なら緑の右肩上がり、負なら赤の右肩下がり、0 なら灰色。 */
function GrowthChip({
  Icon,
  label,
  value,
  strong = false,
  lead,
}: {
  /** 札の前に添える印（「→」。折り返しても札と離れない）。 */
  lead?: string;
  Icon: LucideIcon;
  label: string;
  value: number;
  strong?: boolean;
}) {
  const text = pct(value);
  const sign = isZeroText(text) ? 0 : Math.sign(value);
  const Trend = sign > 0 ? TrendingUp : sign < 0 ? TrendingDown : null;
  const tone =
    sign > 0
      ? 'border-success/50 bg-success/5'
      : sign < 0
        ? 'border-error/40 bg-error/5'
        : 'border-base-300';
  const arrow = sign > 0 ? 'text-success' : 'text-error-strong';
  const chip = (
    <span
      className={`flex items-center gap-1 rounded-box border px-2 py-0.5 ${tone} ${strong ? 'font-semibold' : ''}`}
    >
      <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
      {label}
      <span className="tabular-nums">{text}</span>
      {Trend && <Trend aria-hidden className={`size-4 shrink-0 ${arrow}`} />}
    </span>
  );
  return (
    <li className="flex items-center gap-1.5">
      {lead && (
        <span aria-hidden className="opacity-60">
          {lead}
        </span>
      )}
      {chip}
    </li>
  );
}

export function MonthCard({
  report: r,
  onShowEvents,
}: {
  report: MonthReport;
  /** 遊んでいる間だけ渡す。出来事は見出しの一覧に詰め、ダイアログで再表示する（D-23・D-126）。 */
  onShowEvents?: (() => void) | undefined;
}) {
  const s = r.satisfaction;
  // 規約違反を一番上に、札の種類ごとにまとめるのは PremiseList
  const premises = r.premises;
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body">
        <h2 className="card-title flex-wrap">
          {r.month} か月目{' '}
          <span className="font-normal opacity-70">{r.stackName}</span>
          <span className={`badge ${STATUS[r.status].cls}`}>
            {STATUS[r.status].label}
          </span>
          {/* 部品の一覧は長いので、構成の名前の横の ⓘ に畳む（prd/16） */}
          {r.componentSummary && (
            <Info label="部品の一覧" title={r.stackName}>
              <p>部品: {r.componentSummary}</p>
            </Info>
          )}
        </h2>
        {r.contractRevenue > 0 && (
          <div className="text-xs opacity-70">
            契約の収益 {usd(r.contractRevenue)}（収益に含む）
          </div>
        )}
        {onShowEvents
          ? r.events.length > 0 && (
              <div className="rounded-box border border-base-300 p-3">
                {/* 印の列の幅を一番長い印にそろえ、題の頭を縦にそろえる（subgrid）。題が折り返してもどの行か分かるよう、行の間に区切り線（D-224） */}
                <ul
                  className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 divide-y divide-base-content/10"
                  data-event-list
                >
                  {r.events.map((e) => (
                    <li
                      key={`${e.id}:${e.phase}`}
                      className="col-span-2 grid grid-cols-subgrid items-center py-1.5 text-sm first:pt-0 last:pb-0"
                    >
                      <span
                        className={`badge badge-sm w-full justify-start ${eventBadge(e).cls}`}
                      >
                        {eventBadge(e).label}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <BlockedBadge event={e} />
                        {e.tier === 'rare' && (
                          <span className="badge badge-sm badge-outline badge-error">
                            {TIER_LABEL[e.tier]}
                          </span>
                        )}
                        <span>{e.title}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-sm btn-outline mt-2"
                  onClick={onShowEvents}
                >
                  イベントを 1 件ずつ見る（{r.events.length} 件）
                </button>
              </div>
            )
          : r.events.map((e) => (
              <EventCard
                key={`${e.id}:${e.phase}`}
                event={e}
                premises={r.premises}
              />
            ))}
        {r.notes.map((n) => (
          <div
            key={n}
            className={`alert ${r.policyWarning && n.includes('規約') ? 'alert-error' : 'alert-warning'} py-2`}
          >
            {n}
          </div>
        ))}
        {/* 進行中の作業（乗り換えなど）があるときだけ右の列に置く。無ければ満足度を 1 列で */}
        <div
          className={clsx('grid gap-4', hasWorkProgress(r) && 'md:grid-cols-2')}
        >
          <div>
            <h3 className="mb-1 font-bold">
              満足度 {s.score.toFixed(2)}
              <span className="ml-2 text-sm font-normal opacity-70">
                評判（前月との平均）{s.reputation.toFixed(2)}
              </span>
            </h3>
            {/* 要素はアイコン・名前・段階を段階の色の札 1 つにまとめ、どの幅でも折り返して横に詰め、行を埋めるように伸ばす（D-189・D-222 の補足）。
                理由は札の下に、理由のある要素だけ 1 行ずつ */}
            <ul
              className="flex flex-wrap gap-1.5 text-sm"
              data-satisfaction-elements
            >
              {elementsOf(s.stages).map((e) => (
                <li key={e} className="flex grow" data-satisfaction-element={e}>
                  <ElementBadge
                    element={e}
                    stage={s.stages[e]!}
                    className="grow"
                  />
                </li>
              ))}
            </ul>
            {/* 理由（「良い」でない要素だけに付く）は 1 行の ⓘ に畳む。文字は札のうち一番重い段階の色、中は札と同じ色の札と理由（prd/16） */}
            <ImproveInfo stages={s.stages} reasons={s.reasons} />
            {r.botPV > 0 && (
              <div className="mt-2 text-sm opacity-80">
                PV {compact(Math.round(r.pv))} のうち Bot{' '}
                {compact(Math.round(r.botPV))}（収益にならない）
              </div>
            )}
            {/* 伸びの内訳は、遊び方・始める画面と同じ緑の右肩上がり・赤の右肩下がりの札で（色と矢印の向きの両方で見分ける。D-216） */}
            <ul
              className="mt-2 flex flex-wrap items-center gap-1.5 text-sm"
              data-growth-line
            >
              {r.buzz ? (
                <GrowthChip
                  Icon={Megaphone}
                  label="話題の後に残る伸び"
                  value={s.growth}
                />
              ) : (
                <>
                  <GrowthChip
                    Icon={MessagesSquare}
                    label="口コミ"
                    value={s.acquisition}
                  />
                  <GrowthChip Icon={UserMinus} label="解約" value={-s.churn} />
                  <GrowthChip
                    Icon={Eye}
                    label="来月の伸び"
                    value={s.growth}
                    strong
                    lead="→"
                  />
                </>
              )}
            </ul>
          </div>
          <WorkProgressView report={r} />
        </div>
        {r.premises.length > 0 && (
          <div>
            {/* 本体は札の見出しと、名前・使用率のグラフだけ。文の全文・内訳・仮定は見出しの ⓘ にまとめる（D-222 の補足・prd/16） */}
            <h3 className="mb-1 flex items-center gap-1 font-bold">
              プラットフォームの上限・制限
              <Info
                label="上限・制限の説明"
                title="プラットフォームの上限・制限"
              >
                <p className="mb-2 text-sm opacity-80">
                  棒は使用量です。目盛りは一覧の中で共通で、100%
                  の位置がそろいます。100%
                  を超えたときは、薄い青が込みの分（100%
                  まで）、黄・赤の分が超えた分です。
                </p>
                <PremiseList premises={premises} lines={r.lines} full />
              </Info>
            </h3>
            <PremiseList premises={premises} lines={r.lines} />
          </div>
        )}
        <details className="collapse collapse-arrow bg-base-200">
          <summary className="collapse-title text-sm">
            料金の明細
            {r.parallelInfraCost > 0
              ? `（乗り換え先の ${usd(r.parallelInfraCost)} を含む）`
              : ''}
            {r.unpricedLines
              ? `（料金未取得 ${r.unpricedLines} 件。費用は下限）`
              : ''}
          </summary>
          <div className="collapse-content">
            <table className="table table-sm">
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.label}</td>
                    <td className="text-right font-mono">
                      {l.currency === 'JPY'
                        ? `${roundInt(l.amount).toLocaleString()} 円`
                        : usd(l.amount)}
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

/**
 * 使用率の棒（D-222 の補足）。目盛りは一覧の中で共通（scale = 一覧のいちばん大きい使用率。1 未満なら 1）で、100% の位置は全部の行でそろう。
 * 100% までは 1 本（札と同じ色）。超えたら込みの分（安全な薄い青）と超えた分（札と同じ色）を daisyUI の join でくっつけて塗り分け、
 * 超えた量の違いを長さで比べられるようにする。
 */
function UsageBar({
  ratio,
  tone,
  scale,
}: {
  ratio: number;
  tone: string;
  scale: number;
}) {
  const at = (r: number) => `${(Math.min(r, scale) / scale) * 100}%`;
  return (
    <span className="flex w-full">
      {ratio <= 1 ? (
        <progress
          className={clsx('progress', tone)}
          style={{ width: at(1) }}
          value={ratio}
          max={1}
        />
      ) : (
        <span className="join w-full" data-usage-over>
          <progress
            className="progress join-item progress-info opacity-45"
            style={{ width: at(1) }}
            value={1}
            max={1}
          />
          <progress
            className={clsx(
              'progress join-item border-l border-base-100',
              tone,
            )}
            style={{
              width: `${((Math.min(ratio, scale) - 1) / scale) * 100}%`,
            }}
            value={1}
            max={1}
          />
        </span>
      )}
    </span>
  );
}

type Tone = 'error' | 'warning' | 'info' | 'neutral';

/** 前提の札の文言と色（D-188）。止まる・プランの変更が要る・規約は赤、遅くなる・課金・調整は黄、あと少し・クレジットの消費は青。 */
function premiseMeta(p: PlatformPremise): {
  label: string;
  tone: Tone;
  rank: number;
} {
  if (isPolicyViolation(p))
    return { label: '規約違反', tone: 'error', rank: 0 };
  if (p.kind === 'fact')
    return p.hit
      ? { label: '違反', tone: 'error', rank: 1 }
      : { label: '事実', tone: 'neutral', rank: 5 };
  // 込みのクレジットの消費は異常ではない（超えた分は従量で請求）。超過の印にせず消費として見せる
  if (isCreditUse(p))
    return { label: '付属クレジットの消費', tone: 'info', rank: 4 };
  if (isStopping(p))
    return { label: hitLabel(p.effect), tone: 'error', rank: 1 };
  if (p.hit) return { label: hitLabel(p.effect), tone: 'warning', rank: 2 };
  return { label: 'あと少し', tone: 'info', rank: 3 };
}

/** まとめの面（黄・赤は段階の色の薄い面と枠で目立たせる。問題でない青・灰は面なし。「改善できる項目について」と同じ作り）。 */
const TONE_PANEL: Record<Tone, string> = {
  error: 'rounded-box border border-error/40 bg-error/5 px-2 py-1.5',
  warning: 'rounded-box border border-warning/60 bg-warning/5 px-2 py-1.5',
  info: 'px-2',
  neutral: 'px-2',
};

/**
 * まとめの見出しの文字（パネルの題なので行の名前（text-sm）より 1 段大きい）。色は daisyUI のその色の面に置く文字の色（-content。
 * 薄い黄・赤の面の上で濃い茶・濃い赤になり読める）。面の無い青・灰は普通の文字。
 */
const TONE_HEAD: Record<Tone, string> = {
  error: 'text-error-content',
  warning: 'text-warning-content',
  info: 'text-sm opacity-80',
  neutral: 'text-sm opacity-80',
};

/** まとめの見出しの印（札の代わり。文字は普通の色にし、印だけ段階の色）。 */
const TONE_MARK: Record<Tone, LucideIcon> = {
  error: OctagonX,
  warning: TriangleAlert,
  info: CircleGauge,
  neutral: CircleDot,
};
const TONE_ICON: Record<Tone, string> = {
  error: 'text-error-strong',
  warning: 'text-warning',
  info: 'text-info-strong',
  neutral: 'opacity-60',
};
const TONE_BAR: Record<Tone, string> = {
  error: 'progress-error',
  warning: 'progress-warning',
  info: 'progress-info',
  neutral: '',
};

/** 札の文言ごとにまとめる（重い順。規約違反が一番上。まとめの中は estimator の並び順のまま）。 */
function groupPremises(premises: readonly PlatformPremise[]) {
  const groups: {
    label: string;
    tone: Tone;
    rank: number;
    items: PlatformPremise[];
  }[] = [];
  for (const p of premises) {
    const m = premiseMeta(p);
    const g = groups.find((x) => x.label === m.label);
    if (g) g.items.push(p);
    else groups.push({ ...m, items: [p] });
  }
  return groups.sort((a, b) => a.rank - b.rank);
}

type ReportLine = MonthReport['lines'][number];

/**
 * 上限・制限の一覧。札は種類ごとの見出しにまとめ、行は 2 段（1 段目: 印と名前。省略しない。2 段目: 使用率の棒・%・超えた分の費用）（D-222 の補足）。
 * 棒の幅と左端は全部の行でそろえ、100% の位置がそろう。full（ⓘ の中）は行ごとに全文・内訳・仮定を添える。
 */
function PremiseList({
  premises,
  lines,
  full = false,
}: {
  premises: readonly PlatformPremise[];
  lines: readonly ReportLine[];
  full?: boolean;
}) {
  // 棒の共通の目盛り（いちばん大きい使用率。込みのクレジットと規約違反は数えない）
  const scale = Math.max(
    1,
    ...premises
      .filter((p) => !isCreditUse(p) && !isPolicyViolation(p))
      .map((p) => p.ratio ?? 0),
  );
  return (
    <div className="space-y-2" data-premise-list>
      {groupPremises(premises).map((g) => (
        <section
          key={g.label}
          className={clsx('space-y-1', TONE_PANEL[g.tone])}
          aria-label={g.label}
          data-premise-group={g.label}
        >
          <h4
            className={clsx(
              'flex items-center gap-1 font-semibold',
              TONE_HEAD[g.tone],
            )}
            data-premise-heading
          >
            {(() => {
              const Mark = TONE_MARK[g.tone];
              return (
                <Mark
                  aria-hidden
                  className={`size-4 shrink-0 ${TONE_ICON[g.tone]}`}
                />
              );
            })()}
            {g.label}
          </h4>
          {/* 行の区切り線: どの行にも上と左の線を引き、外周に出る線（1 列目の左・1 段目の上）は overflow-hidden で隠す。
              縦に並ぶときは行の間の横線、横に並ぶときは列の間の縦線になる（列の数に依らない） */}
          <div className="overflow-hidden">
            <ul
              className={clsx(
                '-mt-px -ml-3 grid',
                !full && 'sm:-ml-5 sm:grid-cols-2 lg:grid-cols-3',
              )}
            >
              {g.items.map((p) => (
                <PremiseRow
                  key={p.id}
                  p={p}
                  tone={g.tone}
                  full={full}
                  scale={scale}
                  cost={premiseCostOf(p, lines)}
                />
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

/** 上限・制限の対象の印と短い名前（どちらも普通の色。段階の色はまとめの見出しの印と棒）。 */
function PremiseName({ p }: { p: PlatformPremise }) {
  const Icon = premiseIcon(p);
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
      <Icon aria-hidden className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0">{premiseName(p)}</span>
    </span>
  );
}

/** 上限・制限の 1 行（1 段目: 名前、2 段目: 棒・%・費用）。規約違反は棒の代わりに原因のプランを出す。 */
function PremiseRow({
  p,
  tone,
  full,
  scale,
  cost,
}: {
  p: PlatformPremise;
  tone: Tone;
  full: boolean;
  /** 棒の共通の目盛り。 */
  scale: number;
  /** 超えた分の費用（結べたときだけ）。 */
  cost?: string | undefined;
}) {
  const policy = isPolicyViolation(p);
  const plan = policy ? premisePlanLabel(p) : undefined;
  const credit = isCreditUse(p);
  return (
    <li
      className={clsx(
        'space-y-0.5 border-t border-l border-base-content/10 py-1.5 pr-1 pl-3',
        // 横に並ぶときは区切りの縦線との間を広げる（ⓘ の中は 1 列のまま）
        !full && 'sm:pr-4 sm:pl-5',
      )}
      {...(policy ? { 'data-policy-violation': '' } : {})}
    >
      <PremiseName p={p} />
      {/* 2 段目は名前の文字の頭（印の右）にそろえる。棒はマスの幅いっぱいで、% と費用の欄は幅を決めておく（どの行も棒が同じ幅になり、100% の位置がそろう） */}
      <div className="flex items-center gap-x-2 pl-5 text-xs">
        {policy ? (
          // 規約違反（Vercel Hobby の非商用など）は原因のプランの名前を目立たせる（どの選択が原因か分かるように）
          plan && (
            <span
              className="text-sm font-bold text-error-strong"
              data-policy-cause
            >
              原因: {plan}
            </span>
          )
        ) : p.ratio !== undefined ? (
          <>
            <span className="min-w-0 flex-1 opacity-70">
              {credit ? (
                <CreditBar
                  ratio={p.ratio}
                  label={`${p.text} ${(p.ratio * 100).toFixed(0)}%`}
                  className="w-full"
                />
              ) : (
                <UsageBar ratio={p.ratio} tone={TONE_BAR[tone]} scale={scale} />
              )}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums opacity-70">
              {(p.ratio * 100).toFixed(0)}%
            </span>
            <span
              className="w-16 shrink-0 text-right font-semibold tabular-nums"
              {...(cost ? { 'data-premise-cost': '' } : {})}
            >
              {cost}
            </span>
          </>
        ) : null}
      </div>
      {full && (
        <div className="mb-1.5 space-y-0.5 pl-5 text-sm">
          <p>{credit ? creditUseText(p, usd) : p.text}</p>
          {p.detail && <p className="text-xs opacity-80">{p.detail}</p>}
          {/* 判定に置いた仮定（話題・Bot の日の集中など。D-60） */}
          {p.assumption && (
            <p className="text-xs opacity-80">仮定: {p.assumption}</p>
          )}
        </div>
      )}
    </li>
  );
}
