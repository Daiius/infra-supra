// 満足度と開発の手間（prd/07 §9・D-18）。純粋関数だけを置く。
// 段階の境目・重み・成長の係数はシナリオのデータ（prd/07 §10.1）。関数はシナリオの値を引数で受け、既定は記事コミュニティ。
// ここの値（段階の境目・重み・ポイント・率）はすべてゲーム上の仮定で、実在の値ではない。
import type { PlatformPremise } from 'estimator';
import type { SatisfactionRules } from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';

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

/** 満足度のルール（記事コミュニティのシナリオの値。prd/07 §9.1〜9.3）。 */
export const SATISFACTION = {
  ...ARTICLE_COMMUNITY.satisfaction,
  /** 純成長率 = 獲得 × 評判 − 解約 × (1 − 評判)。可用性が悪い月は獲得 0。 */
  growth: ARTICLE_COMMUNITY.growth,
  /** 話題の月の後に残る倍率 = 1 + extra × 評判 / reference。 */
  buzz: ARTICLE_COMMUNITY.buzz,
};

/** 開発の手間のルール（ゲーム上の仮定。prd/07 §9.4）。行動の手間はシナリオによらない共通のルール。 */
export const EFFORT = {
  /** 月の総量と自前運用（VPS）の維持はシナリオの値（ここは記事コミュニティの既定）。 */
  perMonth: ARTICLE_COMMUNITY.effort.perMonth,
  selfHostedUpkeep: ARTICLE_COMMUNITY.effort.selfHostedUpkeep,
  /** 設定の変更の手間。 */
  setting: { format: 1, variants: 1, isr: 0 },
  /** ISR の再検証を時間からオンデマンドに切り替える実装（更新のたびに revalidatePath を呼ぶ。D-49。仮定）。 */
  onDemandSwitch: 2,
  optimize: 4,
  /** SSR の最適化 1 段で減る CPU と下限。 */
  optimizeStepMs: 5,
  minSsrCpuMs: 5,
  /** 機能ポイントがこれだけ増えるごとに SSR の CPU が 1 ms 重くなる（上限あり）。 */
  featurePointsPerSsrMs: 10,
  maxSsrDriftMs: 5,
  plan: 0,
  /**
   * さくらの VPS の上位プランへの変更（スケールアップ）: 停止して変更し、ディスクの拡張は利用者の作業（D-27）。
   * 一度きりの手間。停止は計画的で短いので「止まった月」には数えない。
   */
  scaleUp: 2,
  /** さくらの VPS のストレージ変更オプション（スケールアップから申し込む。停止とディスクの拡張。D-30）。 */
  storageOption: 2,
  /**
   * 部品の差し替え（D-24・prd/07 §11.3）。ISR のキャッシュ・画像は翌月から。DB はデータの移行があるので
   * 乗り換えと同じく進行中の状態を持ち、手間を入れ終えた翌月に切り替える（期間中は新旧の両方の DB の費用）。
   */
  component: {
    isrCache: 2,
    images: 2,
    realtime: 4,
    frontCdn: 2,
    ogp: 2,
    // API の応答のキャッシュ（D-37）。ISR のキャッシュ・前段の CDN と同じ大きさ
    apiCache: 2,
  },
  dbSwap: { perMonth: 6, months: 1 },
  /** 乗り換え: 月あたりの手間と、必要な月数（VPS が絡むと長い）。 */
  migrationPerMonth: 6,
  /** recontract: 同じ事業者の下位プランへ契約し直してデータを移す（さくらの VPS 4GB → 2GB。D-27）。 */
  migrationMonths: { serverless: 2, selfHosted: 3, recontract: 2 },
} as const;

/** 速さの「重さ」の数（0〜3）。 */
export function speedHeaviness(
  input: {
    ssrCpuMs: number;
    imageKB: number;
    variants: number;
    premises: readonly PlatformPremise[];
    /** SPA の初回表示（シェル → JS → API の順に待つ）。重さを 1 つ数える（ゲーム上の仮定・prd/10 F-05）。 */
    firstLoadHeavy?: boolean;
  },
  sat: SatisfactionRules = SATISFACTION,
): number {
  const s = sat.speed;
  const near = input.premises.some(
    (p) => p.effect === 'throttle' && !p.hit && (p.ratio ?? 0) >= s.nearRatio,
  );
  return (
    (input.ssrCpuMs >= s.heavySsrCpuMs ? 1 : 0) +
    (input.imageKB >= s.heavyImageKB || input.variants <= 1 ? 1 : 0) +
    (near ? 1 : 0) +
    (input.firstLoadHeavy ? 1 : 0)
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
  /** ISR のキャッシュを使わない（毎回 SSR なので記事は常に新しい。D-24）。 */
  uncached?: boolean;
  /** 書き込みが他の拠点にすぐ反映されない DB（KV を DB の代わり）。鮮度を 1 段下げる（仮定・D-24）。 */
  eventuallyConsistent?: boolean;
  /** 即時反映（オンデマンド ISR）の要件を満たさない。さらに 1 段下げる（仮定・D-32）。 */
  onDemandUnmet?: boolean;
  /** SPA の初回表示（速さの重さを 1 つ数える。仮定・prd/10 F-05）。 */
  firstLoadHeavy?: boolean;
  /** 画質の判定に使う大きさ（省略は imageKB。画像の形式では画質を下げない。D-47・D-58）。 */
  qualityImageKB?: number;
  /** 画質を 1 段下げる（記事のデザインの刷新を断った・粗い画像が多い。仮定・D-47）。 */
  qualityDown?: boolean;
};

const STAGE_DOWN: Record<Stage, Stage> = {
  good: 'fair',
  fair: 'bad',
  bad: 'bad',
};

export function judgeStages(
  i: JudgeInput,
  sat: SatisfactionRules = SATISFACTION,
): Stages {
  const throttled = i.premises.some((p) => p.hit && p.effect === 'throttle');
  const heavy = speedHeaviness(i, sat);
  const q = sat.quality;
  const f = sat.freshness;
  const ft = sat.feature;
  const featureRatio = i.featurePoints / (ft.expectedPerMonth * i.month);
  return {
    availability: i.blocked ? 'bad' : i.degraded ? 'fair' : 'good',
    speed:
      throttled ||
      heavy >= 3 ||
      i.imageKB >= (sat.speed.veryHeavyImageKB ?? Infinity)
        ? 'bad'
        : heavy >= 1
          ? 'fair'
          : 'good',
    feature:
      featureRatio >= ft.good
        ? 'good'
        : featureRatio >= ft.fair
          ? 'fair'
          : 'bad',
    freshness: ((): Stage => {
      const base: Stage = i.uncached
        ? 'good'
        : i.revalidateSec <= f.good
          ? 'good'
          : i.revalidateSec <= f.fair
            ? 'fair'
            : 'bad';
      const a = i.eventuallyConsistent ? STAGE_DOWN[base] : base;
      return i.onDemandUnmet ? STAGE_DOWN[a] : a;
    })(),
    quality: ((): Stage => {
      const kb = i.qualityImageKB ?? i.imageKB;
      const base: Stage = kb >= q.good ? 'good' : kb >= q.fair ? 'fair' : 'bad';
      return i.qualityDown ? STAGE_DOWN[base] : base;
    })(),
  };
}

/** 満足度 S（0〜1）= Σ 重み × 段階の数値。 */
export function satisfactionScore(
  stages: Stages,
  weights: Record<Element, number> = SATISFACTION.weights,
): number {
  return ELEMENTS.reduce(
    (sum, e) => sum + weights[e] * STAGE_VALUE[stages[e]],
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
  g: { acquisition: number; churn: number } = SATISFACTION.growth,
): { acquisition: number; churn: number; net: number } {
  const acquisition = availabilityBad ? 0 : g.acquisition * rep;
  const churn = g.churn * (1 - rep);
  return { acquisition, churn, net: acquisition - churn };
}

/** 話題の月の後に基準の PV に掛かる倍率。 */
export function buzzLasting(
  rep: number,
  b: { extra: number; reference: number } = SATISFACTION.buzz,
): number {
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
  /** 機能の追加の作業（提案への対応。機能開発に数える。D-29）。 */
  featureWork: number;
  /** 提案の機能の加点（作業の月に足す。総量の外）。 */
  featureBonus: number;
  migration: number;
  actions: number;
  /** その月の機能開発 = 余り + 機能の追加の作業 + 加点。 */
  feature: number;
};

/**
 * 月の手間の配分（prd/07 §9.4）。維持 → 割り込み → 乗り換え → 行動の順に取り、余りが機能開発。繰り越さない。
 * 乗り換えは残りがあるだけ進める（足りなければ延びる）。行動は事前に残りの範囲で選ばせる前提で、足りなければ削る。
 */
export function allocateEffort(input: {
  upkeep: number;
  interrupt?: number;
  /** 機能の追加の作業（提案への対応）と、その加点（作業が削られたら同じ割合で減る）。 */
  featureWork?: number;
  featureBonus?: number;
  /** 乗り換えに今月入れたい量（0 なら乗り換え中でない）。 */
  migrationWanted: number;
  actions: number;
  /** 月の総量（チームが増えると増える）。 */
  perMonth?: number;
}): EffortBreakdown {
  const total = input.perMonth ?? EFFORT.perMonth;
  let left = total;
  const take = (want: number) => {
    const got = Math.max(0, Math.min(want, left));
    left -= got;
    return got;
  };
  const upkeep = take(input.upkeep);
  const interrupt = take(input.interrupt ?? 0);
  const wanted = input.featureWork ?? 0;
  const featureWork = take(wanted);
  const featureBonus =
    wanted > 0 ? ((input.featureBonus ?? 0) * featureWork) / wanted : 0;
  const migration = take(input.migrationWanted);
  const actions = take(input.actions);
  return {
    total,
    upkeep,
    interrupt,
    featureWork,
    featureBonus,
    migration,
    actions,
    feature: left + featureWork + featureBonus,
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
