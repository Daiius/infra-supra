import clsx from 'clsx';
import {
  isPolicyViolation,
  premisePlanLabel,
  ELEMENT_LABEL,
  ELEMENTS,
  STAGE_LABEL,
  type MonthReport,
  type Scenario,
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
import { roundInt } from '../format.ts';
import { pct, STATUS, STAGE_CLS } from './shared.ts';
import { EventCard, eventBadge, BlockedBadge, TIER_LABEL } from './events.tsx';
import { EffortBreakdownView } from './effort.tsx';

export function MonthCard({
  report: r,
  scenario: sc,
  onShowEvents,
}: {
  report: MonthReport;
  scenario: Scenario;
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
        </h2>
        {r.componentSummary && (
          <div className="text-xs opacity-70">部品 {r.componentSummary}</div>
        )}
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
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-bold">
              満足度 {s.score.toFixed(2)}
              <span className="ml-2 text-sm font-normal opacity-70">
                評判（前月との平均）{s.reputation.toFixed(2)}
              </span>
            </h3>
            {/* 狭い画面は要素を横に並べて折り返す（D-189）。sm 以上は 1 要素 1 行のまま */}
            <ul
              className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:block sm:space-y-1"
              data-satisfaction-elements
            >
              {ELEMENTS.map((e) => (
                <li
                  key={e}
                  className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-2"
                  data-satisfaction-element={e}
                >
                  <span className="whitespace-nowrap sm:w-14">
                    {ELEMENT_LABEL[e]}
                  </span>
                  <span className={`badge badge-sm ${STAGE_CLS[s.stages[e]]}`}>
                    {STAGE_LABEL[s.stages[e]]}
                  </span>
                  {s.reasons[e] && (
                    <span className="text-xs opacity-70">{s.reasons[e]}</span>
                  )}
                </li>
              ))}
            </ul>
            {r.botPV > 0 && (
              <div className="mt-2 text-sm opacity-80">
                PV {compact(Math.round(r.pv))} のうち Bot{' '}
                {compact(Math.round(r.botPV))}（収益にならない）
              </div>
            )}
            <div className="mt-2 text-sm opacity-80">
              {r.buzz
                ? `話題の後に残る伸び ${pct(s.growth)}`
                : `口コミ ${pct(s.acquisition)}・解約 ${pct(-s.churn)} → 来月の伸び ${pct(s.growth)}`}
            </div>
          </div>
          <EffortBreakdownView report={r} scenario={sc} />
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
      <span>{credit ? creditUseText(p, usd) : p.text}</span>
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
