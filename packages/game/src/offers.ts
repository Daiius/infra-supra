// 確約の申し出（D-97・prd/07 §11.12）: 選べる確約・進行中の確約・前払いの引き継ぎ。
import {
  type ActiveCommitment,
  type CommitmentDef,
  commitmentDefs,
  type CommitmentPaymentId,
  commitmentTerms,
} from './commitments.ts';
import { MVP_STACKS } from 'catalog';
import { books, scenarioOf } from './core.ts';
import { usdOf } from './format.ts';
import type { GameState } from './state.ts';

// ---- 確約（D-97・prd/07 §11.12）----

/** 料金データの確約（1 年。RDS のリザーブドインスタンス・Lambda の Savings Plans・Cloud Run の CUD・さくらの VPS の年額）。 */
export const COMMITMENTS: readonly CommitmentDef[] = commitmentDefs(books);
export const commitmentDef = (key: string) =>
  COMMITMENTS.find((d) => d.key === key);

/** 結べる確約の 1 つの形（画面に出す。金額は料金データの通貨と、ドルに直した値）。 */
export type CommitmentOffer = {
  key: string;
  label: string;
  payment: CommitmentPaymentId;
  currency: string;
  covers: number;
  monthly: number;
  upfront: number;
  /** 1 年の割引の率（オンデマンドの 12 か月分に対して）。 */
  discount: number;
  /**
   * ゲームの中で効く月数（12 か月か、ゲームの残りの月数）。全額前払いの upfront はこの月数の分に割った額
   * （1 年の契約のうちゲームの後の月の分は、ゲームの後に使うとみて数えない。D-97）。
   */
  months: number;
  /** 1 年分の前払いの額（割る前。全額前払いのときだけ 0 より大きい）。 */
  upfrontYear: number;
  premise: string;
  usd: { covers: number; monthly: number; upfront: number };
};

export function offerOf(
  d: CommitmentDef,
  payment: CommitmentPaymentId,
  spend: number | undefined,
  monthsLeft: number,
): CommitmentOffer | null {
  const t = commitmentTerms(d, payment, spend);
  if (!t) return null;
  const year = t.covers * 12;
  const months = Math.min(d.commitment.termMonths, monthsLeft);
  const upfront = (t.upfront * months) / d.commitment.termMonths;
  return {
    key: d.key,
    label: d.commitment.label,
    payment,
    currency: d.currency,
    covers: t.covers,
    monthly: t.monthly,
    upfront,
    upfrontYear: t.upfront,
    discount: year > 0 ? 1 - (t.monthly * 12 + t.upfront) / year : 0,
    months,
    premise: d.commitment.premise,
    usd: {
      covers: usdOf(t.covers, d.currency),
      monthly: usdOf(t.monthly, d.currency),
      upfront: usdOf(upfront, d.currency),
    },
  };
}

export const offersFor = (
  defs: readonly CommitmentDef[],
  spendOf: (d: CommitmentDef) => number | undefined,
  monthsLeft: number,
) =>
  defs.flatMap((d) =>
    d.commitment.payments.flatMap(
      (p) => offerOf(d, p.payment, spendOf(d), monthsLeft) ?? [],
    ),
  );

/** 今の確約（終わっていないもの）。 */
export function activeCommitments(
  state: Pick<GameState, 'commitments' | 'history'>,
): ActiveCommitment[] {
  const next = state.history.length + 1;
  return (state.commitments ?? []).filter((c) => c.endMonth >= next);
}

/**
 * 来月から結べる確約（今月の明細に対象の使用があるもの）。時間あたりの額の確約は今月の対象の額（オンデマンド）で結ぶ。
 * すでに結んでいる確約も含む（選べるかは checkAction が決める）。
 */
export function commitmentOffers(state: GameState): CommitmentOffer[] {
  const eligible =
    state.history[state.history.length - 1]?.commitmentEligible ?? {};
  return offersFor(
    COMMITMENTS.filter((d) => (eligible[d.key] ?? 0) > 0),
    (d) => eligible[d.key],
    scenarioOf(state).months - state.history.length,
  );
}

export function newCommitment(
  offer: CommitmentOffer,
  startMonth: number,
): ActiveCommitment {
  return {
    key: offer.key,
    label: offer.label,
    currency: offer.currency as ActiveCommitment['currency'],
    payment: offer.payment,
    startMonth,
    endMonth: startMonth + 11,
    covers: offer.covers,
    monthly: offer.monthly,
    upfront: offer.upfront,
    months: offer.months,
  };
}

/** 構成の土台のプランの年払い（さくらの VPS。スケールアップで引き継ぐ。D-97）。 */
function prepayDefOf(stackIndex: number): CommitmentDef | undefined {
  const plans = new Set(
    MVP_STACKS[stackIndex]!.nodes.flatMap((n) =>
      n.billing ? [`${n.billing.provider}:${n.billing.planId}`] : [],
    ),
  );
  return COMMITMENTS.find(
    (d) =>
      d.commitment.kind === 'prepay' && plans.has(`${d.provider}:${d.planId}`),
  );
}

/**
 * 12 か月一括のままのスケールアップ（さくらの VPS 2GB → 4GB）: 上位のプランの 1 年分から今のプランの使っていない分を引いた額を払い、
 * 来月から上位のプランの 12 か月一括になる（公式は日割り。ここは月の単位。D-97）。年払いでなければそのまま。
 */
/** 来月の請求に乗る前払い（来月から始まる確約の前払いの合計。ドル）。所持金の検査で予約済みの額として引く（OCL-C32E39AF）。 */
export function pendingUpfrontUsd(
  state: Pick<GameState, 'commitments' | 'history'>,
  commitments = state.commitments ?? [],
): number {
  const next = state.history.length + 1;
  return commitments
    .filter((c) => c.startMonth === next && c.endMonth >= next)
    .reduce((a, c) => a + usdOf(c.upfront, c.currency), 0);
}

export function carryPrepay(
  state: GameState,
  from: number,
  to: number,
): ActiveCommitment[] | undefined {
  const fromDef = prepayDefOf(from);
  const toDef = prepayDefOf(to);
  const month = state.history.length;
  const cur = (state.commitments ?? []).find(
    (c) => c.key === fromDef?.key && c.endMonth > month,
  );
  if (!cur || !toDef) return undefined;
  const offer = offerOf(
    toDef,
    'all-upfront',
    undefined,
    scenarioOf(state).months - month,
  );
  if (!offer) return undefined;
  // 使っていない分（払った年額のうち、来月から先の分）。まだ始まっていない（前払いを払っていない）確約は
  // 置き換えるだけで、控除はしない（払っていない額を差し引かない。OCL-17D1B88E）
  const inGameEnd = cur.startMonth + (cur.months ?? 12) - 1;
  const paid = cur.startMonth <= month;
  const unused = paid
    ? (cur.upfront * Math.max(0, inGameEnd - month)) / (cur.months ?? 12)
    : 0;
  return [
    ...(state.commitments ?? []).map((c) =>
      c === cur ? { ...c, endMonth: month } : c,
    ),
    newCommitment(
      { ...offer, upfront: Math.max(0, offer.upfront - unused) },
      month + 1,
    ),
  ];
}
