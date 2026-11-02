// 長期の利用の確約（リザーブドインスタンス・Savings Plans・確約利用割引・年払い。D-97・prd/07 §11.12・prd/03 §11）。
// 料金データ（catalog の plans[].commitments）と月の明細から、確約の割引と支払いの行を作る。純粋関数だけ。
import {
  HOURS_PER_MONTH,
  type Commitment,
  type CommitmentPayment,
  type Currency,
  type LineItem,
  type PriceBook,
} from 'estimator';

export type CommitmentPaymentId = CommitmentPayment['payment'];

export const PAYMENT_LABEL: Record<CommitmentPaymentId, string> = {
  'no-upfront': '前払いなし',
  'all-upfront': '全額前払い',
};

/** 料金データの確約（provider:planId:id で引く）。 */
export type CommitmentDef = {
  key: string;
  provider: string;
  planId: string;
  currency: Currency;
  commitment: Commitment;
  /** instance: オンデマンドの 1 時間の額（対象のメーターの単価）。prepay: 基本料の月額。 */
  onDemandMonthly?: number;
};

export function commitmentDefs(books: readonly PriceBook[]): CommitmentDef[] {
  return books.flatMap((b) =>
    b.plans.flatMap((p) =>
      p.commitments.map((c): CommitmentDef => {
        const meter = p.meters.find((m) => m.id === c.meterIds[0]);
        const onDemandMonthly =
          c.kind === 'instance' && meter?.pricing.model === 'flat'
            ? (meter.pricing.unitPrice / meter.pricing.per) * HOURS_PER_MONTH
            : c.kind === 'prepay' && p.baseFee?.per === 'month'
              ? p.baseFee.amount
              : undefined;
        return {
          key: `${b.provider}:${p.id}:${c.id}`,
          provider: b.provider,
          planId: p.id,
          currency: b.currency,
          commitment: c,
          ...(onDemandMonthly !== undefined ? { onDemandMonthly } : {}),
        };
      }),
    ),
  );
}

/**
 * 今月の明細のうち、確約の対象になる額（オンデマンドの額。無料枠を引いた後の明細の額）。対象の使用が無い確約は入れない。
 * instance・spend は対象のメーターの従量の行、prepay は同じプランの基本料の行。
 */
export function commitmentEligible(
  lines: readonly LineItem[],
  defs: readonly CommitmentDef[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) {
    let sum = 0;
    for (const l of lines) {
      if (l.priceRef.provider !== d.provider || l.priceRef.planId !== d.planId)
        continue;
      const hit =
        d.commitment.kind === 'prepay'
          ? l.kind === 'base-fee'
          : l.kind === 'usage' &&
            d.commitment.meterIds.includes(l.priceRef.meterId ?? '');
      if (hit) sum += l.amount ?? 0;
    }
    if (sum > 0) out[d.key] = sum;
  }
  return out;
}

/** 結んだ確約。金額は料金データの通貨（さくらは円）。 */
export type ActiveCommitment = {
  key: string;
  label: string;
  currency: Currency;
  payment: CommitmentPaymentId;
  /** 効く最初と最後の月（1 年 = 12 か月。ゲームの終わりを越えてもよい）。 */
  startMonth: number;
  endMonth: number;
  /** 確約で覆う月のオンデマンドの額（これを超えた分はオンデマンドのまま）。 */
  covers: number;
  /** 毎月払う額（前払いなし）。 */
  monthly: number;
  /** 始めの月に一度だけ払う額（全額前払い。ゲームの中で効く月数の分。D-97）。 */
  upfront: number;
  /** ゲームの中で効く月数（12 か月か、結んだときのゲームの残りの月数）。 */
  months?: number;
};

/**
 * 確約の条件。spend は確約の額を使う側が決める（ここでは渡された月の対象の額 = 先月の使用の水準で結ぶ）。
 * 結べない（支払いの形が無い・spend の額が 0）なら null。
 */
export function commitmentTerms(
  def: CommitmentDef,
  payment: CommitmentPaymentId,
  spendPerMonth?: number,
): Pick<ActiveCommitment, 'covers' | 'monthly' | 'upfront'> | null {
  const p = def.commitment.payments.find((x) => x.payment === payment);
  if (!p) return null;
  const months = def.commitment.termMonths;
  switch (def.commitment.kind) {
    case 'instance': {
      if (def.onDemandMonthly === undefined) return null;
      return payment === 'no-upfront'
        ? {
            covers: def.onDemandMonthly,
            monthly: p.hourly! * HOURS_PER_MONTH,
            upfront: 0,
          }
        : { covers: def.onDemandMonthly, monthly: 0, upfront: p.upfront! };
    }
    case 'spend': {
      if (!spendPerMonth || spendPerMonth <= 0) return null;
      const paid = spendPerMonth * (1 - p.discount!);
      return payment === 'no-upfront'
        ? { covers: spendPerMonth, monthly: paid, upfront: 0 }
        : { covers: spendPerMonth, monthly: 0, upfront: paid * months };
    }
    case 'prepay':
      if (def.onDemandMonthly === undefined) return null;
      return { covers: def.onDemandMonthly, monthly: 0, upfront: p.upfront! };
  }
}

/** 1 年の確約で、ゲームの外も含めた 1 年の割引の率（オンデマンドの 12 か月分に対して）。 */
export function commitmentDiscount(
  t: Pick<ActiveCommitment, 'covers' | 'monthly' | 'upfront'>,
): number {
  const year = t.covers * 12;
  return year > 0 ? 1 - (t.monthly * 12 + t.upfront) / year : 0;
}

export const isActive = (c: ActiveCommitment, month: number) =>
  c.startMonth <= month && month <= c.endMonth;

export type CommitmentLine = {
  key: string;
  label: string;
  amount: number;
  currency: Currency;
};

/**
 * 月の確約の行: 確約で覆った分の割引（負の額。対象の使用と確約の額の小さいほう）・毎月の支払い・始めの月の前払い。
 * 対象を使わなくなっても支払いは残る（取り消せない。D-97）。
 */
export function commitmentLines(
  active: readonly ActiveCommitment[],
  eligible: Readonly<Record<string, number>>,
  month: number,
): CommitmentLine[] {
  const out: CommitmentLine[] = [];
  for (const c of active) {
    if (!isActive(c, month)) continue;
    const base = { key: c.key, currency: c.currency };
    const covered = Math.min(eligible[c.key] ?? 0, c.covers);
    if (month === c.startMonth && c.upfront > 0)
      out.push({
        ...base,
        label: `${c.label}（全額前払い・${c.months ?? 12} か月分）`,
        amount: c.upfront,
      });
    if (c.monthly > 0)
      out.push({
        ...base,
        label: `${c.label}（前払いなし・毎月）`,
        amount: c.monthly,
      });
    if (covered > 0)
      out.push({
        ...base,
        label: `${c.label}で割り引いた分`,
        amount: -covered,
      });
  }
  return out;
}
