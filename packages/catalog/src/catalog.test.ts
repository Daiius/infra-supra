// catalog のデータの検証（prd/05 §4）。実在の料金の金額はテストに書かない（料金改定で壊れるため。prd/05 §1）。
import { describe, expect, it } from 'vitest';
import {
  ArchitectureSchema,
  estimate,
  priceUsage,
  PriceBookSchema,
} from 'estimator';
import {
  applyComponentsToWorkload,
  composeStack,
  loadPriceBooks,
  MVP_STACKS,
  RAW_PRICE_BOOKS,
  STACK_DEFS,
  articleCommunity,
  JAPAN_TAX,
  japanTaxOf,
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

describe('表示名（D-75）', () => {
  it('すべてのメーター・基本料・クレジット・一度だけの手数料が label を持つ', () => {
    const missing = loadPriceBooks().flatMap((b) =>
      b.plans.flatMap((p) => {
        const at = `${b.provider}/${p.id}`;
        return [
          ...p.meters.filter((m) => !m.label).map((m) => `${at}/${m.id}`),
          ...(p.baseFee && !p.baseFee.label ? [`${at} 基本料`] : []),
          ...p.credits.filter((c) => !c.label).map((c) => `${at}/${c.id}`),
          ...p.addons.filter((a) => !a.label).map((a) => `${at}/${a.id}`),
        ];
      }),
    );
    expect(missing).toEqual([]);
  });

  it('label は公式の名称を括弧で残す（「日本語の説明（公式の名称）」）', () => {
    for (const b of loadPriceBooks())
      for (const p of b.plans)
        for (const l of [
          ...p.meters.map((m) => m.label),
          p.baseFee?.label,
          ...p.credits.map((c) => c.label),
          ...p.addons.map((a) => a.label),
        ])
          if (l !== undefined) expect(l).toMatch(/^[^（]+（.+）$/);
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

  it.each(
    MVP_STACKS.map((s, i) => [s.id, s, STACK_DEFS[i]!.platform] as const),
  )(
    '%s: テンプレートで見積が完走し、全クラスに経路がある',
    (_, stack, platform) => {
      // 既定の部品が Workload を変えるもの（AWS の既定の画像は投稿のときに縮める）を当ててから
      const r = estimate({
        workload: applyComponentsToWorkload(
          articleCommunity(1_000_000),
          platform,
        ),
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

  it('Vercel Pro は込み分を持たず、月のクレジットの使用率を前提に出す（D-48。CDN の料金を On-demand にしたとき。D-120）', () => {
    const r = estimate({
      workload: articleCommunity(10_000),
      architecture: composeStack('vercel-supabase-pro', {
        cdnPlan: 'on-demand',
      }),
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

  it('Vercel Pro の既定は Flat Rate CDN: CDN の 3 項目は段の定額に込み、量が収まる段の使用率を前提に出す（D-120）', () => {
    const at = (pv: number) =>
      estimate({ workload: articleCommunity(pv), architecture: pro, books });
    const small = at(10_000);
    const covered = small.bill.lines.filter(
      (l) =>
        l.kind === 'usage' &&
        ['cdn-requests', 'fast-data-transfer', 'blob-data-transfer'].includes(
          l.priceRef.meterId!,
        ),
    );
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.every((l) => l.amount === 0 && l.capacityTier)).toBe(true);
    // 小さい量は Pro に込みの段（月額 0）。Fast Origin Transfer は対象外（従量）
    const fee = small.bill.lines.find(
      (l) => l.kind === 'base-fee' && l.capacityTier,
    )!;
    expect(fee).toMatchObject({
      amount: 0,
      capacityTier: { set: 'flat-rate-cdn', tier: 'included' },
    });
    expect(
      small.bill.lines.find(
        (l) => l.priceRef.meterId === 'fast-origin-transfer',
      )!.amount,
    ).toBeGreaterThan(0);
    const p = small.premises.find(
      (x) => x.id === 'capacity:vercel:pro:flat-rate-cdn',
    )!;
    expect(p).toMatchObject({ kind: 'threshold', effect: 'cost', hit: false });
    // 量が増えると上の段（見積は今月の量が収まる段）
    const big = at(1_300_000);
    expect(big.bill.capacityTiers[0]).toMatchObject({
      applied: big.bill.capacityTiers[0]!.fitting,
    });
    expect(big.bill.capacityTiers[0]!.applied).not.toBe('included');
    // 記事コミュニティは画像の配信が転送の大半なので、対象外になりうる前提（事実）を出す。費用は段のまま
    const media = big.premises.find(
      (x) => x.id === 'capacity:vercel:pro:flat-rate-cdn:media',
    )!;
    expect(media).toMatchObject({ kind: 'fact', effect: 'info' });
    expect(media.detail).toMatch(/^画像の配信が転送の \d+%/);
    // 画像を最適化しない（原本を Blob から配る）と、Blob Data Transfer も段に込み
    const blob = estimate({
      workload: applyComponentsToWorkload(articleCommunity(100_000), 'vercel', {
        images: 'none',
      }),
      architecture: composeStack('vercel-supabase-pro', { images: 'none' }),
      books,
    }).bill.lines.find((l) => l.priceRef.meterId === 'blob-data-transfer')!;
    expect(blob).toMatchObject({ amount: 0 });
    expect(blob.quantity).toBeGreaterThan(0);
  });

  it('Vercel Pro の CDN の単価は読者の地域（東京 hnd1）、関数は iad1（D-120）', () => {
    const arch = composeStack('vercel-supabase-pro', { cdnPlan: 'on-demand' });
    expect(arch.accounts).toEqual([
      {
        id: 'vercel',
        region: 'iad1',
        viewerRegion: 'hnd1',
        capacityTiers: { 'flat-rate-cdn': 'off' },
      },
    ]);
    const vercel = books.find((b) => b.provider === 'vercel')!;
    const proPlan = vercel.plans.find((p) => p.id === 'pro')!;
    const by = (id: string) =>
      proPlan.meters.find((m) => m.id === id)!.regionBy;
    for (const id of [
      'cdn-requests',
      'fast-data-transfer',
      'fast-origin-transfer',
      'blob-data-transfer',
      'image-transformations',
    ])
      expect(by(id)).toBe('viewer');
    for (const id of [
      'active-cpu',
      'provisioned-memory',
      'isr-reads',
      'blob-storage',
    ])
      expect(by(id)).toBe('account');
    // 地域の単価を当てると、On-demand の CDN の明細は既定（iad1）の単価より高い
    const r = estimate({
      workload: articleCommunity(100_000),
      architecture: arch,
      books,
    });
    const iad = estimate({
      workload: articleCommunity(100_000),
      architecture: { ...arch, accounts: [{ id: 'vercel' }] },
      books,
    });
    const amount = (x: typeof r, id: string) =>
      x.bill.lines.find((l) => l.priceRef.meterId === id)!.amount!;
    expect(amount(r, 'cdn-requests')).toBeGreaterThan(
      amount(iad, 'cdn-requests'),
    );
    expect(amount(r, 'active-cpu')).toBe(amount(iad, 'active-cpu'));
  });

  it('VPS は 100 万 PV では何にも当たらず、固定費だけ', () => {
    const r = estimate({
      workload: articleCommunity(1_000_000),
      architecture: vps,
      books,
    });
    expect(r.premises.filter((x) => x.hit)).toEqual([]);
    // VPS の固定費と、メールの送信（D-95）の既定の Amazon SES の従量、ドメインの登録（D-96。VPS の DNS は無料）
    expect(r.bill.lines.filter((l) => l.amount)).toHaveLength(3);
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

  // Bunny（D-98）は部品だけの事業者で、セルフサービスのまま SLA（99.99%）がある
  it('セルフサービスのプランで SLA があるのはさくらの VPS 4GB と Bunny だけ', () => {
    const offered = loadPriceBooks().flatMap((b) =>
      b.plans
        .filter((p) => p.uptimeSla?.status === 'offered')
        .map((p) => `${b.provider}/${p.id}`),
    );
    expect(offered).toEqual([
      'sakura-vps/4gb-tokyo',
      'bunny/standard',
      'bunny/optimizer',
    ]);
  });
});

describe('日本から契約するときの消費税（D-76）', () => {
  it('全事業者に扱いがあり、料金データの taxIncluded と食い違わない', () => {
    const books = loadPriceBooks();
    for (const b of books) {
      const t = japanTaxOf(b.provider);
      expect(t, b.provider).toBeDefined();
      // 税込の価格なのは taxIncluded の事業者だけ（足すのは税抜の事業者だけ）
      expect(t!.status === 'included', b.provider).toBe(b.taxIncluded);
      expect(t!.sources.length, b.provider).toBeGreaterThan(0);
    }
    expect(JAPAN_TAX.map((t) => t.provider).sort()).toEqual(
      books.map((b) => b.provider).sort(),
    );
  });
});

describe('確約（D-97）', () => {
  const all = loadPriceBooks().flatMap((b) =>
    b.plans.flatMap((p) =>
      p.commitments.map((c) => ({
        key: `${b.provider}:${p.id}:${c.id}`,
        p,
        c,
      })),
    ),
  );

  it('確かめた確約だけを持つ（RDS の予約・Lambda の Savings Plans・Cloud Run の CUD・さくらの年額。Cloud SQL の共有の vCPU は対象外）', () => {
    expect(all.map((x) => x.key).sort()).toEqual([
      'aws:lambda:compute-savings-plan',
      'aws:rds-postgres-t4g-micro:reserved-instance',
      'gcp:cloud-run:flexible-cud',
      'sakura-vps:2gb-tokyo:annual',
      'sakura-vps:4gb-tokyo:annual',
    ]);
  });

  it('どの形も 1 年のオンデマンドより安く、全額前払いは前払いなしより安い', () => {
    for (const { p, c } of all) {
      expect(c.termMonths).toBe(12);
      const nu = c.payments.find((x) => x.payment === 'no-upfront');
      const au = c.payments.find((x) => x.payment === 'all-upfront');
      if (c.kind === 'spend') {
        for (const x of c.payments) {
          expect(x.discount).toBeGreaterThan(0);
          expect(x.discount).toBeLessThan(1);
        }
        if (nu && au) expect(au.discount!).toBeGreaterThan(nu.discount!);
        continue;
      }
      if (c.kind === 'prepay') {
        expect(au!.upfront!).toBeLessThan(12 * p.baseFee!.amount);
        continue;
      }
      const m = p.meters.find((x) => x.id === c.meterIds[0])!;
      const hourly =
        m.pricing.model === 'flat' ? m.pricing.unitPrice / m.pricing.per : 0;
      expect(hourly).toBeGreaterThan(0);
      expect(nu!.hourly!).toBeLessThan(hourly);
      expect(au!.upfront!).toBeLessThan(nu!.hourly! * 730 * 12);
    }
  });
});
