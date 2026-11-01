// 始める画面の 1 か月目の費用の見込み（D-72）。全組み合わせとの一致は combo-sweep.test.ts。
import { describe, expect, it } from 'vitest';
import { ARTICLE_COMMUNITY, setupMonthOneEstimate } from './index.ts';

const CF_PAID = 1;
const sc = ARTICLE_COMMUNITY;

describe('1 か月目の費用の見込み（D-72）', () => {
  it('CF Paid × Next.js × 既定の部品では尽きない', () => {
    const e = setupMonthOneEstimate(sc, CF_PAID, 'nextjs', {});
    expect(e.startCash).toBe(sc.startCash);
    expect(e.costUsd).toBeGreaterThan(0);
    expect(e.revenueUsd).toBeGreaterThan(0);
    expect(e.short).toBe(false);
  });

  it('主な費用は金額の大きい順で 3 件まで', () => {
    const e = setupMonthOneEstimate(sc, CF_PAID, 'nextjs', {});
    expect(e.topLines.length).toBeLessThanOrEqual(3);
    const v = e.topLines.map((l) => l.usd);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(v.every((x) => x > 0)).toBe(true);
  });
});
