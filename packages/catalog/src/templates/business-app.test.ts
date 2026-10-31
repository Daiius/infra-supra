// 業務の Web アプリのテンプレート（prd/09 §4・D-33）。実在の料金の金額はテストに書かない（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload } from 'estimator';
import { loadPriceBooks, MVP_STACKS } from '../index.ts';
import { businessApp } from './business-app.ts';

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
