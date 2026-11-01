// 推移と見込み（prd/07 §5・GD-1）。毎月記録した前提の使用率から、表示用の推移と「このペースだと N か月後に超える」を出す。
// 見込みはプレイヤーが見ている推移だけで計算し、ゲームの内部（成長率・台本）は覗かない（G-05）。
// 表示用でゲームの状態には入らないが、計算は四則演算だけにしておく（prd/02 §3）。
import type { GameState } from './index.ts';

/** 1 か月分の前提の記録（量の境目があるものだけ）。 */
export type PremiseSnapshot = {
  id: string;
  text: string;
  effect: string;
  ratio: number;
  hit: boolean;
  accumulates: boolean;
};

export type PremiseTrend = {
  id: string;
  text: string;
  effect: string;
  accumulates: boolean;
  /** 月ごとの使用率（その月に前提が無ければ null）。添字 0 が 1 か月目。 */
  ratios: (number | null)[];
  latest: number;
  hitNow: boolean;
  /** 見込み: このペースで残りの期間内に超える月（何か月後か）。超えない・下がっている・すでに超えているなら null。 */
  monthsUntil: number | null;
  /** 見込みの線（直近の月から最終月まで。表示用）。 */
  projection: { month: number; ratio: number }[];
  /** 前の月の見込みより早く超えた（見込みが外れた）。 */
  earlierThanProjected: boolean;
  /** 見込みを出さなかった理由（話題になった月など）。 */
  projectionNote?: string;
};

/** 直近の推移からの外挿。流量は月ごとの倍率の平均、ためていく量は月ごとの増分の平均（直近 3 か月まで）。 */
export function extrapolate(
  series: number[],
  accumulates: boolean,
  steps: number,
): number[] {
  const recent = series.slice(-3);
  if (recent.length < 2) return [];
  const last = recent[recent.length - 1]!;
  const out: number[] = [];
  if (accumulates) {
    let total = 0;
    for (let i = 1; i < recent.length; i++)
      total += recent[i]! - recent[i - 1]!;
    const step = total / (recent.length - 1);
    for (let k = 1; k <= steps; k++) out.push(last + step * k);
  } else {
    let total = 0;
    let n = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1]! > 0) {
        total += recent[i]! / recent[i - 1]!;
        n++;
      }
    }
    if (n === 0) return [];
    const factor = total / n;
    let v = last;
    for (let k = 1; k <= steps; k++) {
      v *= factor;
      out.push(v);
    }
  }
  return out;
}

function monthsUntilExceed(
  series: number[],
  accumulates: boolean,
  remaining: number,
): number | null {
  const last = series[series.length - 1];
  if (last === undefined || last > 1) return null;
  const ahead = extrapolate(series, accumulates, remaining);
  if (ahead.length === 0 || ahead[0]! <= last) return null; // 伸びていない
  const idx = ahead.findIndex((v) => v > 1);
  return idx < 0 ? null : idx + 1;
}

/**
 * 月ごとの前提の記録から推移と見込みを作る。
 * @param months 1 か月目から今月までの記録
 * @param totalMonths シナリオの月数（見込みはこの月まで）
 */
export function premiseTrends(
  months: PremiseSnapshot[][],
  totalMonths: number,
  options: {
    /**
     * 今月は見込みを出さない理由。プレイヤーにも見えている出来事（話題になった月など）で伸びが一時的なとき、
     * その伸びで外挿すると誤解を招くため（ゲームの内部を覗くことにはならない）。
     */
    skipProjection?: string;
  } = {},
): PremiseTrend[] {
  const now = months.length;
  const remaining = Math.max(0, totalMonths - now);
  const ids = new Map<string, PremiseSnapshot>();
  for (const m of months) for (const p of m) ids.set(p.id, p);

  const trends: PremiseTrend[] = [];
  for (const [id, meta] of ids) {
    const ratios = months.map((m) => m.find((p) => p.id === id)?.ratio ?? null);
    const latest = ratios[now - 1];
    if (latest === null || latest === undefined) continue;
    // 見込みは直近の連続した記録だけで計算する（構成を乗り換えると途切れる）
    const contiguous: number[] = [];
    for (let i = now - 1; i >= 0 && ratios[i] !== null; i--)
      contiguous.unshift(ratios[i]!);
    const skip = options.skipProjection !== undefined;
    const monthsUntil = skip
      ? null
      : monthsUntilExceed(contiguous, meta.accumulates, remaining);
    // 見込みの線は、境目を越える最初の月で止める（その先まで伸ばすと縦軸が広がり、実際の推移が潰れる）
    const ahead =
      latest > 1 || skip
        ? []
        : extrapolate(contiguous, meta.accumulates, remaining).map(
            (ratio, k) => ({ month: now + k + 1, ratio }),
          );
    const cross = ahead.findIndex((p) => p.ratio > 1);
    const projection = cross < 0 ? ahead : ahead.slice(0, cross + 1);
    const prev = contiguous.slice(0, -1);
    const prevUntil =
      prev.length >= 2
        ? monthsUntilExceed(prev, meta.accumulates, totalMonths - (now - 1))
        : null;
    const hitNow = latest > 1;
    const wasBelow = (prev[prev.length - 1] ?? 0) <= 1;
    trends.push({
      id,
      text: meta.text,
      effect: meta.effect,
      accumulates: meta.accumulates,
      ratios,
      latest,
      hitNow,
      monthsUntil,
      projection: projection.length
        ? [{ month: now, ratio: latest }, ...projection]
        : [],
      earlierThanProjected:
        hitNow &&
        wasBelow &&
        prev.length > 0 &&
        (prevUntil === null || prevUntil > 1),
      ...(skip ? { projectionNote: options.skipProjection! } : {}),
    });
  }
  return trends;
}

/**
 * 推移のグラフに出す前提を選ぶ（多すぎると読めない。上位 limit 件）。
 * 順: 今当たっている止まる前提 → 見込みで超える（早い順）→ 今当たっている課金の前提 → 境目に近い順。
 * 一度も 50% に届かず、超える見込みもない前提は出さない。
 */
export function selectTrends(
  trends: PremiseTrend[],
  limit = 4,
): PremiseTrend[] {
  const rank = (t: PremiseTrend) =>
    t.hitNow && t.effect !== 'cost'
      ? 0
      : t.monthsUntil !== null
        ? 1
        : t.hitNow
          ? 2
          : 3;
  return trends
    .filter(
      (t) =>
        t.hitNow ||
        t.monthsUntil !== null ||
        t.ratios.some((r) => (r ?? 0) >= 0.5),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.monthsUntil ?? 99) - (b.monthsUntil ?? 99) ||
        b.latest - a.latest,
    )
    .slice(0, limit);
}

// ---- 所持金の見込み（目標に対する目安。D-42）----

/** 見込みに使う直近の月数（それより短ければある分だけ）。 */
export const CASH_PROJECTION_WINDOW = 3;

export type CashProjection = {
  /** 直近の月の利益（所持金の差分）の平均。見込みの傾き。 */
  perMonth: number;
  /** 平均に使った月数（1〜CASH_PROJECTION_WINDOW）。 */
  window: number;
  /** 最終月の見込みの所持金（最終月まで済んでいれば実際の値）。 */
  final: number;
  goal: number;
  /** 目標に対する割合（final / goal）。 */
  ratio: number;
  onTrack: boolean;
  /** 見込みの線（今の月から最終月まで。済んでいれば空）。 */
  projection: { month: number; value: number }[];
};

/**
 * 所持金の見込み（ゲーム上の目安）: 直近 3 か月（足りなければある分）の月の利益の平均で、残りの月を線形に伸ばす。
 * 月の利益は所持金の実際の差分（乗り換え中の並行費・一度だけの手数料も含む）。予告済みの出来事・改定・成長は織り込まない。
 * まだ 1 か月も進んでいなければ undefined。
 */
export function cashProjectionOf(
  state: Pick<GameState, 'history' | 'scenario'>,
): CashProjection | undefined {
  const h = state.history;
  if (!h.length) return undefined;
  const { months, goal, startCash } = state.scenario;
  const cash = [startCash, ...h.map((r) => r.cash)];
  const now = h.length;
  const window = Math.min(CASH_PROJECTION_WINDOW, now);
  const perMonth = (cash[now]! - cash[now - window]!) / window;
  const rest = Math.max(0, months - now);
  const projection = rest
    ? Array.from({ length: rest + 1 }, (_, i) => ({
        month: now + i,
        value: cash[now]! + perMonth * i,
      }))
    : [];
  const final = cash[now]! + perMonth * rest;
  return {
    perMonth,
    window,
    final,
    goal: goal.cash,
    ratio: goal.cash > 0 ? final / goal.cash : 1,
    onTrack: final >= goal.cash,
    projection,
  };
}
