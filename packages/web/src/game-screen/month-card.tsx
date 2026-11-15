import clsx from 'clsx';
import {
  Eye,
  Gauge,
  Megaphone,
  MessagesSquare,
  OctagonX,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserMinus,
  Image as ImageIcon,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  isPolicyViolation,
  premisePlanLabel,
  ELEMENT_LABEL,
  ELEMENTS,
  STAGE_LABEL,
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
} from '../premise-view.ts';
import { isZeroText, roundInt } from '../format.ts';
import { pct, STATUS, STAGE_CLS } from './shared.ts';
import { EventCard, eventBadge, BlockedBadge, TIER_LABEL } from './events.tsx';
import { WorkProgressView } from './effort.tsx';

/** 満足度の要素の印（名前と並べて札に出す。名前だけより一目で見分けやすい）。 */
const ELEMENT_ICON: Record<(typeof ELEMENTS)[number], LucideIcon> = {
  availability: ShieldCheck,
  speed: Gauge,
  feature: Puzzle,
  freshness: RefreshCw,
  quality: ImageIcon,
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
  element: (typeof ELEMENTS)[number];
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
  const items = ELEMENTS.filter((e) => reasons[e]);
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
            const Icon = stages[e] === 'bad' ? OctagonX : TriangleAlert;
            return (
              <li
                key={e}
                className={`flex items-start gap-2 rounded-box border p-2 ${STAGE_PANEL[stages[e]]}`}
              >
                <Icon
                  aria-hidden
                  className={`mt-0.5 size-5 shrink-0 ${STAGE_TEXT[stages[e]]}`}
                />
                <div className="min-w-0 space-y-1">
                  <ElementBadge element={e} stage={stages[e]} />
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
                <ul className="space-y-1">
                  {r.events.map((e) => (
                    <li
                      key={`${e.id}:${e.phase}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className={`badge badge-sm ${eventBadge(e).cls}`}>
                        {eventBadge(e).label}
                      </span>
                      <BlockedBadge event={e} />
                      {e.tier === 'rare' && (
                        <span className="badge badge-sm badge-outline badge-error">
                          {TIER_LABEL[e.tier]}
                        </span>
                      )}
                      <span>{e.title}</span>
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
          className={clsx(
            'grid gap-4',
            (r.componentSwap || r.migration || r.rewrite) && 'md:grid-cols-2',
          )}
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
              {ELEMENTS.map((e) => (
                <li key={e} className="flex grow" data-satisfaction-element={e}>
                  <ElementBadge
                    element={e}
                    stage={s.stages[e]}
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
            <h3 className="mb-1 font-bold">プラットフォームの上限・制限</h3>
            <ul className="space-y-1">
              {/* 規約違反の行を一番上に（ほかは estimator の並び順のまま） */}
              {[
                ...r.premises.filter(isPolicyViolation),
                ...r.premises.filter((p) => !isPolicyViolation(p)),
              ].map((p) => (
                <PremiseRow key={p.id} p={p} />
              ))}
            </ul>
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

function PremiseRow({ p }: { p: PlatformPremise }) {
  // 規約違反（Vercel Hobby の非商用など）は原因のプランの名前を目立たせる（どの選択が原因か分かるように）
  if (isPolicyViolation(p)) {
    const plan = premisePlanLabel(p);
    return (
      <li
        className="flex flex-wrap items-center gap-2 rounded-box border border-error bg-error/10 px-2 py-1"
        data-policy-violation
      >
        <span className="badge badge-sm badge-error">規約違反</span>
        {plan && (
          <span className="font-bold text-error-strong" data-policy-cause>
            原因: {plan}
          </span>
        )}
        <span>{p.text}</span>
      </li>
    );
  }
  // 止まる・プランの変更が要るは赤、遅くなる・課金・調整は黄（D-188）
  const blocked = isStopping(p);
  // 込みのクレジットの消費は異常ではない（超えた分は従量で請求）。超過の印にせず消費として見せる
  const credit = isCreditUse(p);
  const badge =
    p.kind === 'fact'
      ? p.hit
        ? 'badge-error'
        : 'badge-ghost'
      : blocked
        ? 'badge-error'
        : credit
          ? 'badge-info'
          : p.hit
            ? 'badge-warning'
            : 'badge-info';
  const label =
    p.kind === 'fact'
      ? p.hit
        ? '違反'
        : '事実'
      : credit
        ? '付属クレジットの消費'
        : p.hit
          ? hitLabel(p.effect)
          : 'あと少し';
  const ratio = p.ratio === undefined ? null : Math.min(p.ratio, 1);
  return (
    <li className="flex flex-wrap items-center gap-2">
      {/* バッジ・使用率のグラフ・説明の順（バッジとグラフは横幅を取らないので同じ高さに並べる。2026-11-10・ユーザーの要望） */}
      <span className={`badge badge-sm ${badge}`}>{label}</span>
      {ratio !== null && (
        <span className="flex items-center gap-1 text-xs opacity-70">
          {credit ? (
            <CreditBar
              ratio={p.ratio!}
              label={`${p.text} ${(p.ratio! * 100).toFixed(0)}%`}
              className="w-20"
            />
          ) : (
            <progress
              className={clsx(
                'progress w-20',
                blocked
                  ? 'progress-error'
                  : p.hit
                    ? 'progress-warning'
                    : 'progress-info',
              )}
              value={ratio}
              max={1}
            />
          )}
          {(p.ratio! * 100).toFixed(0)}%
        </span>
      )}
      {/* 広い画面では札の右の残りの幅で折り返し、狭い画面では札の下の 1 行に回す */}
      <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        {credit ? creditUseText(p, usd) : p.text}
      </span>
      {p.detail && (
        <span className="basis-full text-xs opacity-80">{p.detail}</span>
      )}
      {/* 判定に置いた仮定（話題・Bot の日の集中など。D-60）は ⓘ に畳む */}
      {p.assumption && (
        <Info label="この判定の仮定">{`仮定: ${p.assumption}`}</Info>
      )}
    </li>
  );
}
