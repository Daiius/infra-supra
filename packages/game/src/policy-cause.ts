// 規約違反の原因のプラン（画面で強調する。表示用で、計算には使わない）。
import type { PlatformPremise } from 'estimator';
import { accountLabel } from './accounts.ts';
import { books } from './core.ts';
import type { GameState } from './state.ts';

/** 前提の事業者・プランの画面の名前（「Vercel Hobby」）。料金データに無いプランは ID。事業者が無ければ null。 */
export function premisePlanLabel(p: PlatformPremise): string | null {
  if (!p.provider) return null;
  const plan = p.planId
    ? books
        .find((b) => b.provider === p.provider)
        ?.plans.find((x) => x.id === p.planId)
    : undefined;
  return [accountLabel(p.provider), plan?.name ?? p.planId]
    .filter(Boolean)
    .join(' ');
}

/** 規約違反（利用資格を満たさない前提。effect: policy）に当たっているか。 */
export const isPolicyViolation = (p: PlatformPremise) =>
  p.hit && p.effect === 'policy';

export type PolicyCause = {
  /** 原因のプラン・部品の名前（「Vercel Hobby」）。 */
  label: string | null;
  /** 規約の条件（「Vercel Hobby は個人・非商用のみ」）。 */
  text: string;
  /** 停止につながった指摘の月。 */
  warnedMonth: number | null;
};

/**
 * 規約違反で終わったときの原因（停止につながった最後の指摘の月の前提。hints の ③ と同じ月）。規約違反で終わっていなければ null。
 */
export function policyCauseOf(state: GameState): PolicyCause | null {
  if (state.end?.reason !== 'policy') return null;
  const warned = state.history.findLast((r) => r.policyWarning);
  const p = (warned ?? state.history.at(-1))?.premises.find(isPolicyViolation);
  if (!p) return null;
  return {
    label: premisePlanLabel(p),
    text: p.text,
    warnedMonth: warned?.month ?? null,
  };
}
