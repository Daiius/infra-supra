// 届いた提案への返事（受ける / 断る）と、受けたときの説明・止まりうる上限の見込み（D-202・D-203）。
// 行動の欄の提案の行と、出来事のダイアログの提案のページで同じ部品を使い、返事は同じ下書き（useMonthDraft）に入れる。
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

/** 提案の印（出来事の印と同じ。D-126）。 */
export const PROPOSAL_BADGE = {
  label: '◆ 提案',
  cls: 'badge-primary',
} as const;

const fmtPoints = (n: number) => String(Number(n.toFixed(1)));

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
        ※ 今月選んでいる行動を当てた、今の規模（基準の PV）での見込みです。PV
        が伸びれば早まります
      </li>
    </ul>
  );
}

/**
 * 提案 1 つへの返事。where: 行動の欄（見出しつき）か、出来事のダイアログ（見出しは出来事の通知にあるので省き、
 * 手間の残りを添える）。
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
  const answer = d.answers[id];
  // この提案への返事を除いた、今月選んでいる行動を当てた見込み（D-203）
  const key = JSON.stringify(d.actions);
  // 行動は毎回作り直すので、中身（JSON）で比べる
  const limits = useMemo(
    () => acceptPreview(state, id, JSON.parse(key) as Action[]),
    [state, id, key],
  );
  const name = `${where}-proposal-${id}`;
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
          <span>受けるか断るかを選びます（選ばなければ断ります）</span>
          <span className="badge badge-sm font-normal" data-dialog-effort>
            来月の手間の残り {fmtPoints(d.left)} / {fmtPoints(d.total)}
          </span>
        </div>
      )}
      <div
        className="flex flex-wrap gap-4"
        role="radiogroup"
        aria-label={`${def.title}への返事`}
      >
        <label
          className={`flex items-center gap-2 ${acceptOk || answer ? 'cursor-pointer' : 'opacity-50'}`}
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
          {!acceptOk && !answer && (
            <span className="text-xs" data-accept-blocked>
              （{acceptWhy}）
            </span>
          )}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={name}
            className="radio radio-sm"
            // 選ぶまではどちらにも印を付けない（未決が見えるように。選ばずに進むと確認を挟む。D-140）
            checked={answer === false}
            onChange={() => d.answer(id, false)}
          />
          断る（{summary.declineLoss ?? '何も変わりません'}）
        </label>
      </div>
      {summary.gains.length > 0 && (
        <div className="mt-1 text-xs">受けると: {summary.gains.join('・')}</div>
      )}
      {summary.costs.length > 0 && (
        <div className="mt-0.5 text-xs opacity-70">
          伴うこと: {summary.costs.join('・')}
        </div>
      )}
      <AcceptLimits limits={limits} />
    </div>
  );
}
