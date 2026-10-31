// catalog のデータの検証（prd/05 §4）。実在の料金の金額はテストに書かない（料金改定で壊れるため。prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate, PriceBookSchema } from 'estimator';
import {
  loadPriceBooks,
  MVP_STACKS,
  RAW_PRICE_BOOKS,
  articleCommunity,
} from './index.ts';

describe('料金データ', () => {
  it.each(RAW_PRICE_BOOKS.map((b) => [b.provider, b]))(
    '%s がスキーマを通る',
    (_, raw) => {
      const r = PriceBookSchema.safeParse(raw);
      expect(r.success ? [] : r.error.issues).toEqual([]);
    },
  );

  it('すべて official（架空の料金を含まない）で、取得日を持つ', () => {
    for (const b of loadPriceBooks()) {
      expect(b.status).toBe('official');
      expect(b.provider.startsWith('fictional-')).toBe(false);
      expect(b.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('構成', () => {
  const books = loadPriceBooks();

  it.each(MVP_STACKS.map((s) => [s.id, s]))(
    '%s: 課金先のプランとメーターが料金データにある',
    (_, stack) => {
      const a = ArchitectureSchema.parse(stack);
      for (const n of a.nodes) {
        if (!n.billing) continue;
        const plan = books
          .find((b) => b.provider === n.billing!.provider)
          ?.plans.find((p) => p.id === n.billing!.planId);
        expect(plan, `${n.id} のプラン`).toBeDefined();
        for (const meterId of Object.values(n.billing.meters)) {
          expect(
            plan!.meters.some((m) => m.id === meterId),
            `${n.id} のメーター ${meterId}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(MVP_STACKS.map((s) => [s.id, s]))(
    '%s: テンプレートで見積が完走し、全クラスに経路がある',
    (_, stack) => {
      const r = estimate({
        workload: articleCommunity(1_000_000),
        architecture: stack,
        books,
      });
      expect(r.simulation.unroutedClasses).toEqual([]);
      for (const total of Object.values(r.bill.totals))
        expect(Number.isFinite(total)).toBe(true);
    },
  );
});
