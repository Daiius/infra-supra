// 満足度と開発の手間の純粋関数（prd/07 §9）。値はゲーム上の仮定なので、境目と代表的な月の値を確かめる。
import type { PlatformPremise } from 'estimator';
import { describe, expect, it } from 'vitest';
import {
  allocateEffort,
  buzzLasting,
  EFFORT,
  effectiveSsrCpuMs,
  ELEMENTS,
  growthFromReputation,
  judgeStages,
  reputation,
  SATISFACTION,
  satisfactionScore,
  speedHeaviness,
  type JudgeInput,
} from './rules.ts';

const throttle = (ratio: number): PlatformPremise => ({
  id: 'host:cpu:vps',
  text: 'CPU',
  kind: 'threshold',
  effect: 'throttle',
  nodeIds: [],
  ratio,
  hit: ratio > 1,
});

const base: JudgeInput = {
  blocked: false,
  degraded: false,
  ssrCpuMs: 15,
  imageKB: 150,
  variants: 3,
  revalidateSec: 300,
  featurePoints: 10,
  month: 1,
  premises: [],
};

describe('満足度の段階', () => {
  it('試作の既定は速さが普通（重さ 2）で、S = 0.9', () => {
    expect(speedHeaviness(base)).toBe(2);
    const st = judgeStages(base);
    expect(st).toEqual({
      availability: 'good',
      speed: 'fair',
      feature: 'good',
      freshness: 'good',
      quality: 'good',
    });
    expect(satisfactionScore(st)).toBeCloseTo(0.9);
  });

  it('代表的な月の S（prd/07 §9.2 の表）', () => {
    const s = (i: Partial<JudgeInput>) =>
      satisfactionScore(judgeStages({ ...base, ...i }));
    expect(s({ premises: [throttle(1.2)] })).toBeCloseTo(0.8);
    expect(s({ degraded: true })).toBeCloseTo(0.7);
    expect(s({ blocked: true })).toBeCloseTo(0.5);
  });

  it('重さ: SSR・画像・前提に近い の 3 つで「悪い」', () => {
    expect(speedHeaviness({ ...base, premises: [throttle(0.8)] })).toBe(3);
    expect(judgeStages({ ...base, premises: [throttle(0.8)] }).speed).toBe(
      'bad',
    );
    expect(judgeStages({ ...base, ssrCpuMs: 10, imageKB: 100 }).speed).toBe(
      'good',
    );
    // サイズ違い 1 種は、小さい画像でも重い
    expect(
      speedHeaviness({ ...base, ssrCpuMs: 10, imageKB: 70, variants: 1 }),
    ).toBe(1);
  });

  it('画質・鮮度・機能の境目', () => {
    expect(judgeStages({ ...base, imageKB: 100 }).quality).toBe('fair');
    expect(judgeStages({ ...base, imageKB: 70 }).quality).toBe('bad');
    expect(judgeStages({ ...base, revalidateSec: 3600 }).freshness).toBe(
      'fair',
    );
    expect(judgeStages({ ...base, revalidateSec: 21600 }).freshness).toBe(
      'bad',
    );
    // 期待は 8 / 月: VPS（7 / 月）は普通、4 / 月は悪い
    expect(judgeStages({ ...base, featurePoints: 7 }).feature).toBe('fair');
    expect(judgeStages({ ...base, featurePoints: 4, month: 1 }).feature).toBe(
      'bad',
    );
  });

  it('S は 0〜1、重みの合計は 1', () => {
    const sum = ELEMENTS.reduce((a, e) => a + SATISFACTION.weights[e], 0);
    expect(sum).toBeCloseTo(1);
    const worst = judgeStages({
      ...base,
      blocked: true,
      premises: [throttle(2)],
      imageKB: 50,
      revalidateSec: 86400,
      featurePoints: 0,
    });
    expect(satisfactionScore(worst)).toBe(0);
  });
});

describe('評判と成長', () => {
  it('評判は前月との平均。1 か月目は今月の値', () => {
    expect(reputation(0.5)).toBe(0.5);
    expect(reputation(0.5, 0.9)).toBeCloseTo(0.7);
  });

  it('S = 0.9 で 12%（GD-3 の規模の見直し。prd/07 §10.6）。止まった月は負', () => {
    expect(growthFromReputation(0.9, false).net).toBeCloseTo(0.12);
    expect(growthFromReputation(0.8, false).net).toBeCloseTo(0.09);
    expect(growthFromReputation(0.5, true).net).toBeCloseTo(-0.075);
    expect(growthFromReputation(0.7, true).net).toBeLessThan(0);
  });

  it('話題の月の後の倍率は、評判 0.9 で 1.3（GD-3）', () => {
    expect(buzzLasting(0.9)).toBeCloseTo(1.3);
    expect(buzzLasting(0.5)).toBeLessThan(1.2);
  });
});

describe('開発の手間', () => {
  it('維持 → 乗り換え → 行動の順に取り、余りが機能開発', () => {
    expect(
      allocateEffort({ upkeep: 3, migrationWanted: 6, actions: 4 }),
    ).toEqual({
      total: 10,
      upkeep: 3,
      interrupt: 0,
      featureWork: 0,
      featureBonus: 0,
      migration: 6,
      actions: 1,
      feature: 0,
    });
    expect(
      allocateEffort({ upkeep: 0, migrationWanted: 0, actions: 0 }).feature,
    ).toBe(EFFORT.perMonth);
  });

  it('機能の追加の作業は機能開発に数え、加点も足す（D-29）', () => {
    const e = allocateEffort({
      upkeep: 0,
      migrationWanted: 0,
      actions: 0,
      featureWork: 4,
      featureBonus: 6,
    });
    expect(e.featureWork).toBe(4);
    expect(e.feature).toBe(6 + 4 + 6);
    // 作業が削られたら、加点も同じ割合で減る
    const short = allocateEffort({
      upkeep: 3,
      interrupt: 5,
      migrationWanted: 0,
      actions: 0,
      featureWork: 4,
      featureBonus: 6,
    });
    expect(short.featureWork).toBe(2);
    expect(short.featureBonus).toBe(3);
  });

  it('必須分が足りなければ乗り換えの進みが減る', () => {
    const e = allocateEffort({
      upkeep: 3,
      interrupt: 5,
      migrationWanted: 6,
      actions: 0,
    });
    expect(e.migration).toBe(2);
    expect(e.feature).toBe(0);
  });

  it('機能開発で SSR が重くなり、最適化で戻る（下限あり）', () => {
    expect(effectiveSsrCpuMs(15, 0, 0)).toBe(15);
    expect(effectiveSsrCpuMs(15, 0, 39)).toBe(18);
    expect(effectiveSsrCpuMs(15, 0, 1000)).toBe(20);
    expect(effectiveSsrCpuMs(15, 1, 30)).toBe(13);
    expect(effectiveSsrCpuMs(15, 5, 0)).toBe(EFFORT.minSsrCpuMs);
  });
});
