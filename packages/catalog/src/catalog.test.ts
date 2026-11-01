// catalog のデータの検証（prd/05 §4）。実在の料金の金額はテストに書かない（料金改定で壊れるため。prd/05 §1）。
import { describe, expect, it } from 'vitest';
import {
  ArchitectureSchema,
  estimate,
  priceUsage,
  PriceBookSchema,
} from 'estimator';
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

describe('R2 の操作は 100 万件単位で切り上げる（r2/pricing: "Cloudflare rounds up your usage to the next billing unit."）', () => {
  // 金額は書かず、課金対象の量（billableQuantity）だけを見る
  const billable = (meterId: string, quantity: number) =>
    priceUsage({
      books: loadPriceBooks(),
      subscriptions: [
        {
          accountId: 'a',
          provider: 'cloudflare',
          planId: 'r2-standard',
          nodeIds: ['r2'],
        },
      ],
      usage: [
        {
          accountId: 'a',
          nodeId: 'r2',
          provider: 'cloudflare',
          planId: 'r2-standard',
          meterId,
          quantity,
        },
      ],
    }).lines.find((l) => l.priceRef.meterId === meterId)!.billableQuantity;

  it.each([
    ['class-a', 1_000_000],
    ['class-b', 10_000_000],
  ])('%s: 無料枠を 1 件超えると 100 万件分', (meterId, free) => {
    expect(billable(meterId, free)).toBe(0);
    expect(billable(meterId, free + 1)).toBe(1_000_000);
    expect(billable(meterId, free + 1_000_001)).toBe(2_000_000);
  });
});

describe('メンバー（席）の料金（D-20 V-6）', () => {
  it('MVP の構成が使う課金先のプランは、メンバーの料金の扱いを持つ（Vercel Hobby は個人のみなので除く）', () => {
    const books = loadPriceBooks();
    for (const stack of MVP_STACKS) {
      for (const n of stack.nodes) {
        if (
          !n.billing ||
          (n.billing.provider === 'vercel' && n.billing.planId === 'hobby')
        )
          continue;
        const book = books.find((b) => b.provider === n.billing!.provider)!;
        const plan = book.plans.find((p) => p.id === n.billing!.planId)!;
        // R2・Images は Workers のアカウントのプランに含める（メンバーはアカウント単位）
        if (plan.service === 'r2' || plan.service === 'images') continue;
        expect(plan.members, `${book.provider} ${plan.id}`).toBeDefined();
      }
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

describe('プラットフォームの前提（金額ではなく、当たったかどうかだけを見る）', () => {
  const books = loadPriceBooks();
  const premises = (stack: (typeof MVP_STACKS)[number], pv: number) =>
    estimate({ workload: articleCommunity(pv), architecture: stack, books })
      .premises;
  const [cfFree, cfPaid, hobby, pro, vps] = MVP_STACKS as [
    (typeof MVP_STACKS)[number],
    (typeof MVP_STACKS)[number],
    (typeof MVP_STACKS)[number],
    (typeof MVP_STACKS)[number],
    (typeof MVP_STACKS)[number],
  ];

  it('Cloudflare Free は量によらず CPU の上限に当たる（SSR が 15 ms）', () => {
    const p = premises(cfFree, 10_000).find((x) =>
      x.id.includes('cpu-ms-per-request'),
    )!;
    expect(p.hit).toBe(true);
    expect(p.effect).toBe('block');
  });

  it('Cloudflare Paid では CPU の上限の前提は出ない（Paid の上限は別）', () => {
    expect(
      premises(cfPaid, 10_000).some((x) => x.id.includes('cpu-ms-per-request')),
    ).toBe(false);
  });

  it('Vercel Hobby は商用のシナリオで利用資格に当たる', () => {
    expect(
      premises(hobby, 10_000).some((x) => x.effect === 'policy' && x.hit),
    ).toBe(true);
  });

  it('Vercel Pro は込み分を持たず、月のクレジットの使用率を前提に出す（D-48）', () => {
    const r = estimate({
      workload: articleCommunity(10_000),
      architecture: pro,
      books,
    });
    // CDN Requests・Fast Data Transfer も最初の 1 単位から課金し、クレジットが当たる
    const cdn = r.bill.lines.find(
      (l) => l.kind === 'usage' && l.priceRef.meterId === 'cdn-requests',
    )!;
    expect(cdn.allowanceApplied ?? 0).toBe(0);
    expect(cdn.amount).toBeGreaterThan(0);
    expect(r.premises.some((x) => x.id.startsWith('pool:vercel:pro:'))).toBe(
      false,
    );
    const p = r.premises.find(
      (x) => x.id === 'credit:vercel:pro:usage-credit',
    )!;
    expect(p).toMatchObject({ kind: 'threshold', effect: 'cost' });
    expect(p.ratio).toBeGreaterThan(0);
  });

  it('VPS は 100 万 PV では何にも当たらず、固定費だけ', () => {
    const r = estimate({
      workload: articleCommunity(1_000_000),
      architecture: vps,
      books,
    });
    expect(r.premises.filter((x) => x.hit)).toEqual([]);
    expect(r.bill.lines.filter((l) => l.amount)).toHaveLength(1);
  });

  it('止まる前提が先、次に近い順に並ぶ', () => {
    const ps = premises(cfFree, 1_000_000);
    const firstNotHit = ps.findIndex((x) => !x.hit);
    expect(ps.slice(0, firstNotHit).every((x) => x.hit)).toBe(true);
  });
});

describe('稼働率の SLA（D-24）', () => {
  it('MVP の構成が使う課金先のプランは、SLA の扱いを持つ', () => {
    const books = loadPriceBooks();
    for (const stack of MVP_STACKS) {
      for (const n of stack.nodes) {
        if (!n.billing) continue;
        const plan = books
          .find((b) => b.provider === n.billing!.provider)!
          .plans.find((p) => p.id === n.billing!.planId)!;
        expect(
          plan.uptimeSla,
          `${n.billing.provider} ${plan.id}`,
        ).toBeDefined();
      }
    }
  });

  it('セルフサービスのプランで SLA があるのはさくらの VPS 4GB だけ', () => {
    const offered = loadPriceBooks().flatMap((b) =>
      b.plans
        .filter((p) => p.uptimeSla?.status === 'offered')
        .map((p) => `${b.provider}/${p.id}`),
    );
    expect(offered).toEqual(['sakura-vps/4gb-tokyo']);
  });
});
