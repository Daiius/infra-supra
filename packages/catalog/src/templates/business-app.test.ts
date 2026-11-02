// 業務の Web アプリのテンプレート（prd/09 §4・D-33）。実在の料金の金額はテストに書かない（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload } from 'estimator';
import { loadPriceBooks, MVP_STACKS } from '../index.ts';
import { BUSINESS_HOURLY_PROFILE, businessApp } from './business-app.ts';
import { ARTICLE_HOURLY_PROFILE, articleCommunity } from './index.ts';

const books = loadPriceBooks();

describe('業務の Web アプリ', () => {
  it('ページはすべて SSR で、添付ファイルは配信も変換もしない', () => {
    const w = resolveWorkload(businessApp(300_000));
    expect(w.monthlyPageViews).toBe(300_000);
    expect(w.classes['document-ssr'].count).toBe(300_000);
    expect(w.classes['document-isr'].count).toBe(0);
    expect(w.classes['image-read'].count).toBe(0);
    expect(w.classes['image-transform'].count).toBe(0);
    expect(w.classes['image-write'].count).toBeGreaterThan(0);
  });

  it('どの構成でも見積もれ、Vercel Hobby では非商用の前提に当たる', () => {
    for (const architecture of MVP_STACKS) {
      const r = estimate({
        workload: businessApp(300_000),
        architecture,
        books,
      });
      const policy = r.premises.some((p) => p.hit && p.effect === 'policy');
      expect(policy).toBe(architecture.id === 'vercel-supabase-hobby');
    }
  });
});

describe('1 日の時間帯の形（D-89。ゲーム上の仮定）', () => {
  const cases = [articleCommunity(300_000), businessApp(300_000)];

  it('24 個の重みで、平日の最も多い時間 / 平均は peakHourFactor を超えない（容量の判定と二重に数えない）', () => {
    for (const input of cases) {
      const t = input.traffic;
      const p = t.hourlyProfile!;
      expect(p).toHaveLength(24);
      const mean = p.reduce((a, v) => a + v, 0) / 24;
      const r = t.weekdayToWeekend;
      const implied = (((7 * r) / (5 * r + 2)) * Math.max(...p)) / mean;
      expect(implied).toBeGreaterThan(1.5);
      expect(implied).toBeLessThanOrEqual(t.peakHourFactor);
    }
  });

  it('記事は夜に最も多く深夜は少ない、業務は業務時間に集中し深夜は 0', () => {
    const a = ARTICLE_HOURLY_PROFILE;
    expect(a.indexOf(Math.max(...a))).toBeGreaterThanOrEqual(20);
    expect(Math.max(...a.slice(2, 6))).toBeLessThan(Math.max(...a) / 5);
    const b = BUSINESS_HOURLY_PROFILE;
    const sum = b.reduce((x, v) => x + v, 0);
    const office = b.slice(8, 18).reduce((x, v) => x + v, 0);
    expect(office / sum).toBeGreaterThan(0.8);
    expect(b.slice(0, 6).every((v) => v === 0)).toBe(true);
  });
});
