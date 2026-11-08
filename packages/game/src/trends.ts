// 推移と見込み（prd/07 §5・GD-1）。毎月記録した前提の使用率から、表示用の推移と「このペースだと N か月後に超える」を出す。
// 見込みはプレイヤーが見ている推移だけで計算し、ゲームの内部（成長率・台本）は覗かない（G-05）。
// 表示用でゲームの状態には入らないが、計算は四則演算だけにしておく（prd/02 §3。除いた月をはさむ比を 1 か月あたりに直す累乗根だけは例外で、D-42 と同じ）。
import type { GameState, MonthReport } from './state.ts';

/**
 * 一時的に流量が増えた月（話題・前兆・Bot。プレイヤーにも見えている出来事。prd/07 §10.7）。
 * 所持金の見込み（D-42）と前提の推移の見込み（G-05）は、この月を基準にも比にも使わない。
 */
export function isTrafficSpike(
  r: Pick<MonthReport, 'buzz' | 'trafficNote'>,
): boolean {
  return r.buzz || r.trafficNote !== undefined;
}

/** 1 か月分の前提の記録（量の境目があるものだけ）。 */
export type PremiseSnapshot = {
  id: string;
  text: string;
  effect: string;
  ratio: number;
  hit: boolean;
  accumulates: boolean;
  /**
   * その前提に効く部品の値（「images:r2-variants」。month/report.ts の premiseParts）。
   * 前の月と変わったら、推移はそこで区切る（差し替えの前後で使い方が違うので、続いた系列として見込まない）。
   */
  parts?: string;
};

export type PremiseTrend = {
  id: string;
  text: string;
  effect: string;
  accumulates: boolean;
  /** 月ごとの使用率（その月に前提が無ければ null）。添字 0 が 1 か月目。 */
  ratios: (number | null)[];
  /** 部品を差し替えて区切った月の添字（前の月にも記録があり、効く部品の値が変わった月）。 */
  breaks: number[];
  /** 最後の区間の始まりの添字（記録の途切れか部品の差し替えの後）。見込みと出すかどうかの判定はここからの記録で行う。 */
  segmentStart: number;
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
  /** 最後の区間のうち、一時的に流量が増えた月として見込みの計算から除いた月の添字（線には描く）。 */
  excluded: number[];
};

/** 見込みに使う直近の点の数（最大 3 か月分。比・増分はその間の 2 つ）。 */
const TREND_WINDOW = 3;

/** 直近の推移からの外挿。流量は月ごとの倍率の平均、ためていく量は月ごとの増分の平均（直近 3 か月まで）。 */
export function extrapolate(
  series: number[],
  accumulates: boolean,
  steps: number,
): number[] {
  return extrapolateAt(
    series.map((v, i) => ({ i, v })),
    accumulates,
    series.length - 1,
    steps,
  );
}

/**
 * 月の添字つきの点（除いた月は飛んでいる）からの外挿。最後の点を基準に、直近 3 点の倍率・増分で伸ばし、
 * from の次の月から steps か月分を返す。飛んだ月をはさむ倍率・増分は 1 か月あたりに直す（D-42 と同じ）。
 */
function extrapolateAt(
  points: { i: number; v: number }[],
  accumulates: boolean,
  from: number,
  steps: number,
): number[] {
  const recent = points.slice(-TREND_WINDOW);
  if (recent.length < 2) return [];
  const base = recent[recent.length - 1]!;
  const out: number[] = [];
  if (accumulates) {
    let total = 0;
    for (let k = 1; k < recent.length; k++)
      total +=
        (recent[k]!.v - recent[k - 1]!.v) / (recent[k]!.i - recent[k - 1]!.i);
    const step = total / (recent.length - 1);
    for (let k = 1; k <= steps; k++)
      out.push(base.v + step * (from - base.i + k));
  } else {
    let total = 0;
    let n = 0;
    for (let k = 1; k < recent.length; k++) {
      const a = recent[k - 1]!;
      const b = recent[k]!;
      if (a.v > 0) {
        const gap = b.i - a.i;
        total += gap === 1 ? b.v / a.v : Math.pow(b.v / a.v, 1 / gap);
        n++;
      }
    }
    if (n === 0) return [];
    const factor = total / n;
    let v = base.v;
    for (let m = base.i + 1; m <= from; m++) v *= factor;
    for (let k = 1; k <= steps; k++) {
      v *= factor;
      out.push(v);
    }
  }
  return out;
}

/**
 * from の月（添字）から見て、このペースだと何か月後に境目を超えるか。usable は見込みに使う点
 * （最後の区間から一時的に流量が増えた月を除いたもの）、latest は from の月の実際の使用率。
 */
function monthsUntilExceed(
  usable: { i: number; v: number }[],
  latest: number,
  accumulates: boolean,
  from: number,
  remaining: number,
): number | null {
  if (latest > 1) return null;
  const base = usable[usable.length - 1];
  const ahead = extrapolateAt(usable, accumulates, from, remaining);
  if (!base || ahead.length === 0) return null;
  // 伸びていない（from の月の見込みの値から増えない。基準が from の月なら実際の値と比べる）
  const atFrom =
    base.i === from
      ? base.v
      : extrapolateAt(usable, accumulates, from - 1, 1)[0]!;
  if (ahead[0]! <= atFrom) return null;
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
    /**
     * 月ごとの「一時的に流量が増えた月か」（添字 0 が 1 か月目。`isTrafficSpike`）。その月は見込みの基準にも比にも使わない。
     * 除いた後に点が 2 つ未満なら見込みを出さない。
     */
    spikes?: readonly boolean[];
  } = {},
): PremiseTrend[] {
  const spikes = options.spikes ?? [];
  const now = months.length;
  const remaining = Math.max(0, totalMonths - now);
  const ids = new Map<string, PremiseSnapshot>();
  for (const m of months) for (const p of m) ids.set(p.id, p);

  const trends: PremiseTrend[] = [];
  for (const [id, meta] of ids) {
    const found = months.map((m) => m.find((p) => p.id === id));
    const ratios = found.map((p) => p?.ratio ?? null);
    const latest = ratios[now - 1];
    if (latest === null || latest === undefined) continue;
    const breaks = found.flatMap((p, i) =>
      p && found[i - 1] && found[i - 1]!.parts !== p.parts ? [i] : [],
    );
    // 見込みは最後の区間（直近の連続した記録のうち、部品の差し替えの後）だけで計算する（構成を乗り換えると途切れる）
    let segmentStart = now - 1;
    while (
      segmentStart > 0 &&
      ratios[segmentStart - 1] !== null &&
      !breaks.includes(segmentStart)
    )
      segmentStart--;
    // 一時的に流量が増えた月（話題・前兆・Bot）は、線には描くが見込みの基準にも比にも使わない（D-42 と同じ）
    const usable: { i: number; v: number }[] = [];
    const excluded: number[] = [];
    for (let i = segmentStart; i < now; i++)
      if (spikes[i]) excluded.push(i);
      else usable.push({ i, v: ratios[i]! });
    const skip =
      options.skipProjection !== undefined || spikes[now - 1] === true;
    const monthsUntil = skip
      ? null
      : monthsUntilExceed(usable, latest, meta.accumulates, now - 1, remaining);
    // 見込みの線は、境目を越える最初の月で止める（その先まで伸ばすと縦軸が広がり、実際の推移が潰れる）
    const ahead =
      latest > 1 || skip
        ? []
        : extrapolateAt(usable, meta.accumulates, now - 1, remaining).map(
            (ratio, k) => ({ month: now + k + 1, ratio }),
          );
    const cross = ahead.findIndex((p) => p.ratio > 1);
    const projection = cross < 0 ? ahead : ahead.slice(0, cross + 1);
    // 前の月の見込み（前の月の時点の記録だけで、同じく除いて計算する）
    const prevLatest = now - 2 >= segmentStart ? ratios[now - 2]! : undefined;
    const prevUntil =
      prevLatest === undefined
        ? null
        : monthsUntilExceed(
            usable.filter((p) => p.i < now - 1),
            prevLatest,
            meta.accumulates,
            now - 2,
            totalMonths - (now - 1),
          );
    const hitNow = latest > 1;
    const wasBelow = (prevLatest ?? 0) <= 1;
    trends.push({
      id,
      text: meta.text,
      effect: meta.effect,
      accumulates: meta.accumulates,
      ratios,
      breaks,
      segmentStart,
      latest,
      hitNow,
      monthsUntil,
      projection: projection.length
        ? [{ month: now, ratio: latest }, ...projection]
        : [],
      earlierThanProjected:
        hitNow &&
        wasBelow &&
        prevLatest !== undefined &&
        (prevUntil === null || prevUntil > 1),
      ...(options.skipProjection !== undefined
        ? { projectionNote: options.skipProjection }
        : {}),
      excluded,
    });
  }
  return trends;
}

/**
 * 推移のグラフに出す前提を選ぶ（多すぎると読めない。上位 limit 件）。
 * 順: 今当たっている止まる前提 → 見込みで超える（早い順）→ 今当たっている課金の前提 → 境目に近い順。
 * 最後の区間（記録の途切れ・部品の差し替えの後）で一度も 50% に届かず、超える見込みもない前提は出さない。
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
        t.ratios.slice(t.segmentStart).some((r) => (r ?? 0) >= 0.5),
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
// 比べた方式と結果は prd/07 §5 と D-42（線形は月の利益の伸びを入れず、伸びている構成で「届かなそう」と誤って出た）。

/** 月の利益の前月比に使う数（直近の比の中央値）と、比のクランプ（外れ値に引っ張られにくくする）。 */
const CASH_GROWTH = { ratios: 3, min: 0.8, max: 1.2 } as const;
/** 伸びを入れられないとき（月の利益が 0 以下）に平均する直近の月数。 */
const CASH_LINEAR_WINDOW = 3;

export type CashProjection = {
  /** growth: 月の利益を前月比で伸ばした / linear: 月の利益が 0 以下なので、直近の平均で線形に伸ばした。 */
  method: 'growth' | 'linear';
  /** 来月の月の利益の見込み。 */
  nextProfit: number;
  /** 月の利益の前月比（クランプ後。linear は 1）。 */
  growth: number;
  /** 一時的に流量が増えた月（話題・前兆・Bot）として除いた月の数。 */
  skipped: number;
  /** 最終月の見込みの所持金（最終月まで済んでいれば実際の値）。 */
  final: number;
  /** 見込みの線（今の月から最終月まで。済んでいれば空）。 */
  projection: { month: number; value: number }[];
};

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
}

/**
 * 所持金の見込み（ゲーム上の目安）。月の利益（所持金の実際の差分。乗り換え中の並行費・一度だけの手数料も含む）を、
 * 直近の月の利益の前月比（直近 3 つの比の中央値を 0.8〜1.2 に収める）で残りの月も伸ばして足す（幾何級数）。
 * 一時的に流量が増えた月（話題・前兆・Bot。プレイヤーにも見えている出来事）は、基準にも比にも使わない。
 * 基準の月の利益が 0 以下なら伸びを入れず、直近 3 か月の平均で線形に伸ばす。
 * 予告済みの出来事・改定は織り込まない。まだ 1 か月も進んでいなければ undefined。
 */
export function cashProjectionOf(
  state: Pick<GameState, 'history' | 'scenario'>,
): CashProjection | undefined {
  const h = state.history;
  if (!h.length) return undefined;
  const { months, startCash } = state.scenario;
  const cash = [startCash, ...h.map((r) => r.cash)];
  const now = h.length;
  const profit = (i: number) => cash[i + 1]! - cash[i]!; // i は 0 始まり（i + 1 か月目）
  const usable = h
    .map((r, i) => ({ i, skip: isTrafficSpike(r) }))
    .filter((x) => !x.skip)
    .map((x) => x.i);
  const base = usable[usable.length - 1];
  let method: CashProjection['method'] = 'growth';
  let growth = 1;
  let next: number;
  if (base !== undefined && profit(base) > 0) {
    const tail = usable.slice(-(CASH_GROWTH.ratios + 1));
    const ratios: number[] = [];
    for (let k = 1; k < tail.length; k++) {
      const a = profit(tail[k - 1]!);
      const b = profit(tail[k]!);
      // 飛んだ月をはさむ比は 1 か月あたりに直す
      if (a > 0 && b > 0)
        ratios.push(Math.pow(b / a, 1 / (tail[k]! - tail[k - 1]!)));
    }
    if (ratios.length)
      growth = Math.min(
        CASH_GROWTH.max,
        Math.max(CASH_GROWTH.min, median(ratios)),
      );
    // 基準の月から来月までの分を伸ばす
    next = profit(base) * Math.pow(growth, now - base);
  } else {
    method = 'linear';
    const w = Math.min(CASH_LINEAR_WINDOW, now);
    next = (cash[now]! - cash[now - w]!) / w;
  }
  const rest = Math.max(0, months - now);
  const projection: CashProjection['projection'] = [];
  let value = cash[now]!;
  let q = next;
  if (rest) projection.push({ month: now, value });
  for (let m = now + 1; m <= months; m++) {
    value += q;
    q *= growth;
    projection.push({ month: m, value });
  }
  return {
    method,
    nextProfit: next,
    growth,
    skipped: now - usable.length,
    final: value,
    projection,
  };
}
