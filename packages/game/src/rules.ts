// 満足度と開発の手間（prd/07 §9・D-18）。純粋関数だけを置く。
// ここの値（段階の境目・重み・ポイント・率）はすべてゲーム上の仮定で、実在の値ではない。
import type { PlatformPremise } from 'estimator';

export type Stage = 'good' | 'fair' | 'bad';
export const STAGE_VALUE: Record<Stage, number> = {
  good: 1,
  fair: 0.5,
  bad: 0,
};
export const STAGE_LABEL: Record<Stage, string> = {
  good: '良い',
  fair: '普通',
  bad: '悪い',
};

export const ELEMENTS = [
  'availability',
  'speed',
  'feature',
  'freshness',
  'quality',
] as const;
export type Element = (typeof ELEMENTS)[number];
export type Stages = Record<Element, Stage>;
export const ELEMENT_LABEL: Record<Element, string> = {
  availability: '可用性',
  speed: '速さ',
  feature: '機能',
  freshness: '鮮度',
  quality: '画質',
};

/** 満足度のルール（ゲーム上の仮定。記事コミュニティのシナリオ。prd/07 §9.1〜9.3）。 */
export const SATISFACTION = {
  /** 重み（合計 1）。 */
  weights: {
    availability: 0.4,
    speed: 0.2,
    feature: 0.2,
    freshness: 0.1,
    quality: 0.1,
  } satisfies Record<Element, number>,
  speed: {
    /** これ以上の SSR の CPU は「重い」。 */
    heavySsrCpuMs: 12,
    /** これ以上の画像は「重い」。 */
    heavyImageKB: 120,
    /** throttle の前提の使用率がこれ以上なら「前提に近い」。 */
    nearRatio: 0.7,
  },
  /** 画質: imageKB がこれ以上なら良い・普通。 */
  quality: { good: 150, fair: 100 },
  /** 鮮度: 再検証の間隔（秒）がこれ以下なら良い・普通。 */
  freshness: { good: 300, fair: 3600 },
  /** 機能: 累積の機能ポイント / (期待 × 経過月数) がこれ以上なら良い・普通。 */
  feature: { expectedPerMonth: 8, good: 1, fair: 0.6 },
  /** 純成長率 = 獲得 × 評判 − 解約 × (1 − 評判)。可用性が悪い月は獲得 0。 */
  growth: { acquisition: 0.5, churn: 0.5 },
  /** 話題の月の後に残る倍率 = 1 + extra × 評判 / reference。 */
  buzz: { extra: 0.8, reference: 0.9 },
} as const;

/** 開発の手間のルール（ゲーム上の仮定。prd/07 §9.4）。 */
export const EFFORT = {
  perMonth: 10,
  /** 自前運用（VPS）の維持。試作の作業費 $30/月 の置き換え。 */
  selfHostedUpkeep: 3,
  /** 設定の変更の手間。 */
  setting: { compress: 1, variants: 1, isr: 0 },
  optimize: 4,
  /** SSR の最適化 1 段で減る CPU と下限。 */
  optimizeStepMs: 5,
  minSsrCpuMs: 5,
  /** 機能ポイントがこれだけ増えるごとに SSR の CPU が 1 ms 重くなる（上限あり）。 */
  featurePointsPerSsrMs: 10,
  maxSsrDriftMs: 5,
  plan: 0,
  /** 乗り換え: 月あたりの手間と、必要な月数（VPS が絡むと長い）。 */
  migrationPerMonth: 6,
  migrationMonths: { serverless: 2, selfHosted: 3 },
} as const;

/** 速さの「重さ」の数（0〜3）。 */
export function speedHeaviness(input: {
  ssrCpuMs: number;
  imageKB: number;
  variants: number;
  premises: readonly PlatformPremise[];
}): number {
  const s = SATISFACTION.speed;
  const near = input.premises.some(
    (p) => p.effect === 'throttle' && !p.hit && (p.ratio ?? 0) >= s.nearRatio,
  );
  return (
    (input.ssrCpuMs >= s.heavySsrCpuMs ? 1 : 0) +
    (input.imageKB >= s.heavyImageKB || input.variants <= 1 ? 1 : 0) +
    (near ? 1 : 0)
  );
}

export type JudgeInput = {
  /** 止まる前提に当たった（block・upgrade-required。規約違反は別に扱う）。 */
  blocked: boolean;
  /** 偶発的な障害・乗り換えの切り替えの月。 */
  degraded: boolean;
  ssrCpuMs: number;
  imageKB: number;
  variants: number;
  revalidateSec: number;
  /** 今月までの累積の機能ポイント。 */
  featurePoints: number;
  month: number;
  premises: readonly PlatformPremise[];
};

export function judgeStages(i: JudgeInput): Stages {
  const throttled = i.premises.some((p) => p.hit && p.effect === 'throttle');
  const heavy = speedHeaviness(i);
  const q = SATISFACTION.quality;
  const f = SATISFACTION.freshness;
  const ft = SATISFACTION.feature;
  const featureRatio = i.featurePoints / (ft.expectedPerMonth * i.month);
  return {
    availability: i.blocked ? 'bad' : i.degraded ? 'fair' : 'good',
    speed: throttled || heavy >= 3 ? 'bad' : heavy >= 1 ? 'fair' : 'good',
    feature:
      featureRatio >= ft.good
        ? 'good'
        : featureRatio >= ft.fair
          ? 'fair'
          : 'bad',
    freshness:
      i.revalidateSec <= f.good
        ? 'good'
        : i.revalidateSec <= f.fair
          ? 'fair'
          : 'bad',
    quality:
      i.imageKB >= q.good ? 'good' : i.imageKB >= q.fair ? 'fair' : 'bad',
  };
}

/** 満足度 S（0〜1）= Σ 重み × 段階の数値。 */
export function satisfactionScore(stages: Stages): number {
  return ELEMENTS.reduce(
    (sum, e) => sum + SATISFACTION.weights[e] * STAGE_VALUE[stages[e]],
    0,
  );
}

/** 評判 = (今月 + 前月) / 2。1 か月目は今月の値（U-3）。 */
export function reputation(current: number, previous?: number): number {
  return previous === undefined ? current : (current + previous) / 2;
}

/** 純成長率の内訳。可用性が「悪い」月は獲得 0（見られないので口コミが止まる）。 */
export function growthFromReputation(
  rep: number,
  availabilityBad: boolean,
): { acquisition: number; churn: number; net: number } {
  const g = SATISFACTION.growth;
  const acquisition = availabilityBad ? 0 : g.acquisition * rep;
  const churn = g.churn * (1 - rep);
  return { acquisition, churn, net: acquisition - churn };
}

/** 話題の月の後に基準の PV に掛かる倍率。 */
export function buzzLasting(rep: number): number {
  const b = SATISFACTION.buzz;
  return 1 + (b.extra * rep) / b.reference;
}

/** 機能開発で重くなった分を含む SSR の CPU（ms）。 */
export function effectiveSsrCpuMs(
  baseMs: number,
  optimizations: number,
  featurePoints: number,
): number {
  const drift = Math.min(
    EFFORT.maxSsrDriftMs,
    Math.floor(featurePoints / EFFORT.featurePointsPerSsrMs),
  );
  return Math.max(
    EFFORT.minSsrCpuMs,
    baseMs + drift - EFFORT.optimizeStepMs * optimizations,
  );
}

export type EffortBreakdown = {
  total: number;
  upkeep: number;
  interrupt: number;
  migration: number;
  actions: number;
  feature: number;
};

/**
 * 月の手間の配分（prd/07 §9.4）。維持 → 割り込み → 乗り換え → 行動の順に取り、余りが機能開発。繰り越さない。
 * 乗り換えは残りがあるだけ進める（足りなければ延びる）。行動は事前に残りの範囲で選ばせる前提で、足りなければ削る。
 */
export function allocateEffort(input: {
  upkeep: number;
  interrupt?: number;
  /** 乗り換えに今月入れたい量（0 なら乗り換え中でない）。 */
  migrationWanted: number;
  actions: number;
}): EffortBreakdown {
  let left = EFFORT.perMonth;
  const take = (want: number) => {
    const got = Math.max(0, Math.min(want, left));
    left -= got;
    return got;
  };
  const upkeep = take(input.upkeep);
  const interrupt = take(input.interrupt ?? 0);
  const migration = take(input.migrationWanted);
  const actions = take(input.actions);
  return {
    total: EFFORT.perMonth,
    upkeep,
    interrupt,
    migration,
    actions,
    feature: left,
  };
}

export type PolicyOutcome = 'ok' | 'warned' | 'grace' | 'suspended';

/**
 * 規約違反（利用資格の前提）の扱い（D-19）。最初の月は指摘、翌月も違反したままならアカウント停止。
 * 指摘を受けてから乗り換えを始めていれば、乗り換えの期間中は猶予を満たしたとみなす（新旧を両方動かしている期間）。
 * プラン変更は翌月から効くので、指摘の月に変えれば翌月は違反しない。
 */
export function policyStep(input: {
  warnedMonth: number | null;
  violating: boolean;
  migrating: boolean;
  month: number;
}): { warnedMonth: number | null; outcome: PolicyOutcome } {
  if (!input.violating) return { warnedMonth: null, outcome: 'ok' };
  if (input.warnedMonth === null)
    return { warnedMonth: input.month, outcome: 'warned' };
  return {
    warnedMonth: input.warnedMonth,
    outcome: input.migrating ? 'grace' : 'suspended',
  };
}
