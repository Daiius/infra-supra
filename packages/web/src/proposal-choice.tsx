// 届いた提案への返事（受ける / 断る）と、受けたときの説明・止まりうる上限の見込み（D-202・D-203）。
// 行動の欄の提案の行と、出来事のダイアログの提案のページで同じ部品を使い、返事は同じ下書き（useMonthDraft）に入れる。
import {
  ArrowRight,
  Hammer,
  Puzzle,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  acceptPreview,
  acceptSummary,
  eventDef,
  scenarioOf,
  type AcceptLimit,
  type Action,
  type GameState,
} from 'game';
import { Info } from './info.tsx';
import type { MonthDraft } from './month-draft.ts';
import { fmtPoints } from './format.ts';

/** 提案の印（出来事の印と同じ。D-126）。 */
export const PROPOSAL_BADGE = {
  label: '◆ 開発依頼',
  cls: 'badge-primary',
} as const;

/** 量の単位の表示（前提の unit）。 */
const UNIT_TEXT: Partial<Record<NonNullable<AcceptLimit['unit']>, string>> = {
  gb: 'GB',
};

/** 使用量の表示の桁（上限が 1 以上なら小数 1 桁、1 未満なら 2 桁。1 つの行の中でそろえる）。 */
const digitsOf = (limit: number) => (limit >= 1 ? 1 : 2);
/** 上限の表示（末尾の 0 は省く: 10 GB・0.5 GB）。 */
const limitText = (limit: number) =>
  Number(limit.toFixed(digitsOf(limit))).toLocaleString();

/**
 * 受けたときの止まりうる上限（D-203）。今 → 受けると の使用量と上限を常に出し、止まるなら赤、残りの月に届く見込みなら黄。
 * 色だけにせず、印と文で言う。数字は今選んでいる行動を当てた、今の規模（基準の PV）での見込み。
 */
export function AcceptLimits({ limits }: { limits: readonly AcceptLimit[] }) {
  if (limits.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs" data-accept-limits>
      {limits.map((x) => {
        const unit = x.unit ? (UNIT_TEXT[x.unit] ?? x.unit) : '';
        const u = unit ? ` ${unit}` : '';
        const rest = x.limit - x.after;
        const amount = (v: number) => v.toFixed(digitsOf(x.limit));
        return (
          <li
            key={x.id}
            data-accept-limit={x.id}
            data-accept-limit-tone={
              x.stops ? 'stop' : x.monthsUntil !== undefined ? 'soon' : 'ok'
            }
          >
            <div className="opacity-80">{x.text}</div>
            <div className="tabular-nums">
              今 {amount(x.before)}
              {u} → 受けると {amount(x.after)} / {limitText(x.limit)}
              {u}
              {rest >= 0
                ? `（残り ${amount(rest)}${u}）`
                : `（${amount(-rest)}${u} 超える）`}
            </div>
            {x.stops ? (
              <div className="flex flex-wrap items-center gap-1 font-semibold text-error-strong">
                <span className="badge badge-xs badge-error">✗ 止まる</span>
                受けると来月止まります
                {x.raisable
                  ? '（プランの変更などで上限を引き上げれば止まりません）'
                  : '（この上限はプランの変更では引き上げられません）'}
              </div>
            ) : (
              x.monthsUntil !== undefined && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="badge badge-xs badge-warning">
                    ● 止まる見込み
                  </span>
                  今の規模なら {x.monthsUntil} か月後に止まる見込みです
                </div>
              )
            )}
          </li>
        );
      })}
      <li className="opacity-70">
        ※ 今月選んでいるアクションを当てた、今の規模（基準の
        PV）での見込みです。PV が伸びれば早まります
      </li>
    </ul>
  );
}

/**
 * 提案 1 つへの返事。where: 行動の欄（見出しつき）か、出来事のダイアログ（見出しは出来事の通知にあるので省き、
 * 工数の残りを添える）。
 */
export function ProposalChoice({
  state,
  id,
  draft: d,
  where,
}: {
  state: GameState;
  id: string;
  draft: MonthDraft;
  where: 'actions' | 'dialog';
}) {
  const def = eventDef(scenarioOf(state), id)!;
  const acceptWhy = d.blocked(
    d.build({ answers: { ...d.answers, [id]: true } }),
  );
  const acceptOk = acceptWhy === null;
  const summary = acceptSummary(state, def);
  // 機能開発の加点は先頭の得（FeatureChain の頭で出すので、札には重ねない）
  const gains =
    summary.featureBonus > 0 ? summary.gains.slice(1) : summary.gains;
  const answer = d.answers[id];
  // この提案への返事を除いた、今月選んでいる行動を当てた見込み（D-203）
  const key = JSON.stringify(d.actions);
  // 行動は毎回作り直すので、中身（JSON）で比べる
  const limits = useMemo(
    () => acceptPreview(state, id, JSON.parse(key) as Action[]),
    [state, id, key],
  );
  const name = `${where}-proposal-${id}`;
  // 受けられて、受けても止まる・止まる見込みの上限が無ければ、受けるをおすすめにする（D-225）
  const recommended =
    acceptOk && !limits.some((x) => x.stops || x.monthsUntil !== undefined);
  return (
    // 提案から来た選択肢は、印（出来事と同じ ◆ 提案）と primary 系の枠・背景で通常の開発と見分ける（D-126）
    <div
      className="rounded-box border border-primary bg-primary/5 p-3"
      {...(where === 'actions'
        ? { 'data-proposal-choice': id }
        : { 'data-dialog-proposal-choice': id })}
    >
      {where === 'actions' ? (
        <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
          <span className={`badge badge-sm ${PROPOSAL_BADGE.cls}`}>
            {PROPOSAL_BADGE.label}
          </span>
          <span>
            {def.title} <Info title={def.title}>{def.text}</Info>
          </span>
        </div>
      ) : (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
          <span>受けるかを選びます</span>
          <span className="badge badge-sm font-normal" data-dialog-effort>
            来月の工数の残り {fmtPoints(d.left)} / {fmtPoints(d.total)}
          </span>
        </div>
      )}
      {/* 受ける・断るのそれぞれの下に、選んだときに起きることを出す。得は上向きの矢印、断ったときの損は下向きの矢印（D-225） */}
      <div
        className="space-y-2"
        role="radiogroup"
        aria-label={`${def.title}への返事`}
      >
        <div>
          <label
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold ${acceptOk || answer ? 'cursor-pointer' : 'opacity-50'}`}
          >
            <input
              type="radio"
              name={name}
              className="radio radio-sm"
              checked={answer === true}
              disabled={!acceptOk && !answer}
              onChange={() => d.answer(id, true)}
            />
            {def.accept!.label}
            {/* 受けると掛かる工数は札で。数え方の注記と、ほかに伴うこと（使用量・要件）は札の横の ⓘ（D-225） */}
            {summary.effort.map((x) => (
              <span
                key={x}
                className="badge h-auto min-h-5 badge-outline badge-sm py-0.5 font-normal"
                data-accept-effort
              >
                {x}
              </span>
            ))}
            {(summary.effortNote || summary.costs.length > 0) && (
              <Info label="受けたときに伴うこと">
                <ul className="list-disc space-y-1 pl-5" data-accept-costs>
                  {summary.effortNote && <li>{summary.effortNote}</li>}
                  {summary.costs.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Info>
            )}
            {recommended && (
              <span
                className="badge badge-sm badge-soft badge-success font-normal"
                data-accept-recommended
              >
                おすすめ
              </span>
            )}
            {!acceptOk && !answer && (
              <span className="text-xs font-normal" data-accept-blocked>
                （{acceptWhy}）
              </span>
            )}
          </label>
          <div className="mt-1 space-y-1 pl-7 text-xs" data-accept-gains>
            {summary.featureBonus > 0 && (
              <FeatureChain points={summary.featureBonus} />
            )}
            {gains.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {gains.map((g) => (
                  <li
                    key={g}
                    className="flex items-center gap-1 text-success-strong"
                  >
                    <TrendingUp aria-hidden className="size-3.5 shrink-0" />
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <label className="flex cursor-pointer items-center gap-2 font-semibold">
            <input
              type="radio"
              name={name}
              className="radio radio-sm"
              // 既定は受けない（選ばなくても印が付いている。受けるを選んだときだけ受ける。D-225）
              checked={answer !== true}
              onChange={() => d.answer(id, false)}
            />
            受けない
          </label>
          {summary.declineLoss && (
            <p
              className="mt-1 flex items-center gap-1 pl-7 text-xs text-error-strong"
              data-decline-loss
            >
              <TrendingDown aria-hidden className="size-3.5 shrink-0" />
              {summary.declineLoss}
            </p>
          )}
        </div>
      </div>
      <AcceptLimits limits={limits} />
    </div>
  );
}

/**
 * 機能開発の加点が満足度の「機能」を通して PV の伸びに効く流れ（遊び方の「機能開発 → 満足度の機能 → PV の伸び」の図と同じ印。D-225）。
 */
function FeatureChain({ points }: { points: number }) {
  const step = 'flex items-center gap-1 rounded-sm bg-base-100 px-1.5 py-0.5';
  return (
    <p
      className="flex flex-wrap items-center gap-1"
      aria-label={`機能開発の加点 +${points} → 満足度の「機能」 → PV の伸び`}
      data-feature-chain
    >
      <span className={`${step} text-success-strong`}>
        <Hammer aria-hidden className="size-3.5" />
        機能開発の加点 +{points}
      </span>
      <ArrowRight aria-hidden className="size-3 opacity-60" />
      <span className={step}>
        <Puzzle aria-hidden className="size-3.5 text-primary" />
        満足度の「機能」
      </span>
      <ArrowRight aria-hidden className="size-3 opacity-60" />
      {/* 行き着く先（PV の伸び）を太字にする（D-225） */}
      <span className={`${step} font-semibold text-success-strong`}>
        <TrendingUp aria-hidden className="size-3.5" />
        PV の伸び
      </span>
    </p>
  );
}
