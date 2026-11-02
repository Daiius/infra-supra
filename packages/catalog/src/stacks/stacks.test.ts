// 構成の組み立て（D-24・prd/07 §11.2・§11.7）。金額は見ず、構成の形と経路だけを確かめる。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { articleCommunity } from '../templates/index.ts';
import { GD3_STACKS } from './__fixtures__/gd3-stacks.ts';
import {
  applyComponentsToWorkload,
  COMPONENTS,
  composeStack,
  DEFAULT_CHOICES,
  MVP_STACKS,
  STACK_DEFS,
  type Choices,
  type SlotId,
} from './index.ts';

const books = loadPriceBooks();

describe('既定の選択', () => {
  it('組み立てた構成は GD-3 までの完成品と同じ', () => {
    GD3_STACKS.forEach((s, i) => expect(MVP_STACKS[i]).toStrictEqual(s));
  });

  it('既定の部品はどれも部品の一覧にある', () => {
    for (const [platform, choices] of Object.entries(DEFAULT_CHOICES))
      for (const [slot, id] of Object.entries(choices))
        expect(
          COMPONENTS.some(
            (c) => c.platform === platform && c.slot === slot && c.id === id,
          ),
          `${platform} ${slot} ${id}`,
        ).toBe(true);
  });
});

describe('部品の組み合わせ', () => {
  // 事業者ごとに、スロットごとの部品を 1 つずつ差し替えた構成すべて
  const cases = STACK_DEFS.flatMap((d) =>
    COMPONENTS.filter((c) => c.platform === d.platform).map(
      (c) =>
        [
          `${d.id} ${c.slot}=${c.id}`,
          d,
          { [c.slot]: c.id } as Choices,
        ] as const,
    ),
  );

  it.each(cases)(
    '%s: 構成として正しく、全クラスに経路があり、課金先が料金データにある',
    (_, def, choices) => {
      const arch = ArchitectureSchema.parse(composeStack(def, choices));
      for (const n of arch.nodes) {
        if (!n.billing) continue;
        const plan = books
          .find((b) => b.provider === n.billing!.provider)
          ?.plans.find((p) => p.id === n.billing!.planId);
        expect(plan, `${n.id} のプラン`).toBeDefined();
        for (const m of Object.values(n.billing.meters))
          expect(plan!.meters.some((x) => x.id === m)).toBe(true);
      }
      const workload = applyComponentsToWorkload(
        articleCommunity(1_000_000),
        def.platform,
        choices,
        { originalImageKB: 400 },
      );
      const r = estimate({ workload, architecture: arch, books });
      expect(r.simulation.unroutedClasses).toEqual([]);
    },
  );

  const premisesOf = (id: string, choices: Choices, pv = 1_000_000) =>
    estimate({
      workload: applyComponentsToWorkload(
        articleCommunity(pv),
        'cloudflare',
        choices,
      ),
      architecture: composeStack(id, choices),
      books,
    });

  it('Cloudflare でキャッシュしないと、Worker のリクエストは変わらず、KV を使わなくなる', () => {
    const base = premisesOf('cloudflare-vinext-paid', {});
    const none = premisesOf('cloudflare-vinext-paid', { isrCache: 'none' });
    const w = (r: typeof base) => r.simulation.nodes.worker!.resources;
    expect(w(none).requests).toBeCloseTo(w(base).requests!, 6);
    expect(none.simulation.nodes.kv).toBeUndefined();
  });

  it('再検証の間隔が長いほど、キャッシュしないときの CPU の差が大きい（ページあたりの閲覧が少ないと ISR は効きにくい）', () => {
    const cpu = (revalidateSeconds: number, isrCache: string) => {
      const w = articleCommunity(1_000_000);
      w.routes = w.routes.map((r) =>
        r.rendering === 'isr' ? { ...r, revalidateSeconds } : r,
      );
      return estimate({
        workload: applyComponentsToWorkload(w, 'cloudflare', { isrCache }),
        architecture: composeStack('cloudflare-vinext-paid', { isrCache }),
        books,
      }).simulation.nodes.worker!.resources['cpu-ms']!;
    };
    expect(cpu(21_600, 'none') / cpu(21_600, 'kv')).toBeGreaterThan(
      cpu(300, 'none') / cpu(300, 'kv'),
    );
    expect(cpu(21_600, 'none')).toBeGreaterThan(cpu(21_600, 'kv'));
  });

  it('画像を D1 に置くと、テンプレートの画像の保存量だけで D1 の 10 GB に当たる', () => {
    const r = premisesOf('cloudflare-vinext-paid', { images: 'd1' });
    expect(r.premises.find((p) => p.id.includes(':d1-db-size:'))?.hit).toBe(
      true,
    );
    expect(r.premises.some((p) => p.id.endsWith(':d1-row-size'))).toBe(true);
  });

  it('KV を DB 代わりにすると、同じキーの書き込みの前提（仮定の印つき）と反映の遅れが出る', () => {
    const r = premisesOf('cloudflare-vinext-paid', { db: 'kv' });
    const key = r.premises.find((p) => p.id.includes(':kv-same-key-writes:'))!;
    expect(key.effect).toBe('throttle');
    expect(key.assumption).toBeDefined();
    expect(r.premises.some((p) => p.id.endsWith(':kv-propagation'))).toBe(true);
  });

  it('投稿のときにサイズ違いを作ると、一意な変換が減る', () => {
    const t = (images: string) =>
      premisesOf('cloudflare-vinext-paid', { images }).simulation.nodes.images!
        .resources['image-transformations']!;
    expect(t('r2-variants')).toBeLessThan(t('images'));
  });

  it('投稿のときに作ったサイズ違いは R2 に書き込む（変換 1 件 = 書き込み 1 件）', () => {
    const sim = (images: string) =>
      premisesOf('cloudflare-vinext-paid', { images }).simulation;
    const pre = sim('r2-variants');
    const base = sim('images');
    const writes = (s: typeof pre) => s.nodes.r2!.resources['object-writes']!;
    expect(writes(pre) - writes(base)).toBeCloseTo(
      pre.nodes.images!.resources['image-transformations']!,
      6,
    );
  });

  it('画像を D1 に置いたまま DB を D1 へ差し替える途中は、D1 にアプリの DB の保存量も載る', () => {
    const w = applyComponentsToWorkload(
      articleCommunity(1_000_000),
      'cloudflare',
      { images: 'd1', db: 'hyperdrive' },
    );
    const r = estimate({
      workload: w,
      architecture: composeStack(
        'cloudflare-vinext-paid',
        { images: 'd1', db: 'hyperdrive' },
        { standby: { db: 'd1' } },
      ),
      books,
    });
    const s = r.simulation.workload.storage;
    expect(r.simulation.nodes.d1!.resources['storage-gb-month']).toBeCloseTo(
      s.dbGB + s.imagesGB,
      9,
    );
  });

  it('投稿のときにサイズ違いを作ると、R2 にはサイズ違いの保存量も載る（閲覧時に変換するなら原本だけ）', () => {
    const sim = (images: string) =>
      premisesOf('cloudflare-vinext-paid', { images }).simulation;
    const pre = sim('r2-variants');
    const base = sim('images');
    const storage = (s: typeof pre) =>
      s.nodes.r2!.resources['storage-gb-month']!;
    const wi = pre.workload.input.images;
    expect(base.workload.storage.variantsGB).toBe(0);
    expect(pre.workload.storage.variantsGB).toBeCloseTo(
      (wi.distinct * wi.variants * wi.sizeKB) / 1_000_000,
      9,
    );
    expect(storage(pre) - storage(base)).toBeCloseTo(
      pre.workload.storage.variantsGB,
      9,
    );
  });

  it('画像だけを D1 に置き、DB は別の部品のとき、D1 の保存量は画像の分だけ', () => {
    const r = premisesOf('cloudflare-vinext-paid', {
      images: 'd1',
      db: 'hyperdrive',
    });
    expect(r.simulation.nodes.d1!.resources['storage-gb-month']).toBeCloseTo(
      r.simulation.workload.storage.imagesGB,
      9,
    );
  });

  it('差し替えの途中は、新しい DB のノードが経路に載らずに足される', () => {
    const a = ArchitectureSchema.parse(
      composeStack(
        'cloudflare-vinext-paid',
        {},
        { standby: { db: 'hyperdrive' } },
      ),
    );
    expect(a.nodes.map((n) => n.id)).toContain('supabase');
    expect(Object.values(a.routes).flat()).not.toContain('supabase');
  });

  it('スロットの名前は事業者に依存しない（将来の事業者をまたぐ構成のため・§11.6）', () => {
    const slots = new Set<SlotId>(COMPONENTS.map((c) => c.slot));
    expect([...slots].sort()).toEqual(
      [
        'api',
        'apiCache',
        'cdnInvalidation',
        'cdnPlan',
        'db',
        'dbBackup',
        'frontCdn',
        'images',
        'isrCache',
        'minInstances',
        'ogp',
        'realtime',
      ].sort(),
    );
  });
});

describe('実行ごとのログ（D-92）', () => {
  const LOGGED = new Set([
    'aws:lambda',
    'aws:amplify-hosting',
    'gcp:cloud-run',
    'cloudflare:workers-paid',
  ]);
  const frameworks = ['nextjs', 'vite-spa', 'astro', 'nextjs-export'] as const;

  it.each(
    STACK_DEFS.flatMap((d) => frameworks.map((f) => [d.id, f, d] as const)),
  )(
    '%s × %s: 課金のある事業者の関数・コンテナだけがログを数え、数えたログはメーターに載る',
    (_, framework, def) => {
      const arch = ArchitectureSchema.parse(
        composeStack(def, {}, { framework }),
      );
      for (const n of arch.nodes) {
        if (n.config.kind !== 'function' && n.config.kind !== 'container')
          continue;
        const key = n.billing && `${n.billing.provider}:${n.billing.planId}`;
        expect(!!n.config.logs, `${n.id}（${key}）`).toBe(
          !!key && LOGGED.has(key),
        );
      }
      const r = estimate({
        workload: articleCommunity(1_000_000),
        architecture: arch,
        books,
      });
      expect(r.unmetered.filter((u) => u.resource.startsWith('log-'))).toEqual(
        [],
      );
    },
  );

  it('無料の分（CloudWatch Logs 5 GB・Cloud Logging 50 GiB・Workers Logs 2,000 万件）を超えた分だけ課金する', () => {
    const logCost = (id: string, pv: number) => {
      const r = estimate({
        workload: articleCommunity(pv),
        architecture: composeStack(id),
        books,
      });
      const lines = r.bill.lines.filter((l) =>
        ['logs', 'workers-logs'].includes(l.priceRef.meterId ?? ''),
      );
      const sum = (k: 'log-gb' | 'log-events') =>
        Object.values(r.simulation.nodes).reduce(
          (a, n) => a + (n.resources[k] ?? 0),
          0,
        );
      return {
        gb: sum('log-gb'),
        events: sum('log-events'),
        amount: lines.reduce((a, l) => a + (l.amount ?? 0), 0),
      };
    };
    for (const pv of [1_000_000, 20_000_000]) {
      const aws = logCost('aws-opennext', pv);
      expect(aws.amount).toBeCloseTo(Math.max(0, aws.gb - 5) * 0.76, 6);
      const gcp = logCost('gcp-cloud-run', pv);
      expect(gcp.amount).toBeCloseTo(Math.max(0, gcp.gb - 50) * 0.5, 6);
      const cf = logCost('cloudflare-vinext-paid', pv);
      expect(cf.amount).toBeCloseTo(
        (Math.max(0, cf.events - 20_000_000) / 1_000_000) * 0.6,
        6,
      );
    }
    // 2,000 万 PV では AWS・Cloudflare は無料の分を超える
    expect(logCost('aws-opennext', 20_000_000).amount).toBeGreaterThan(0);
    expect(
      logCost('cloudflare-vinext-paid', 20_000_000).amount,
    ).toBeGreaterThan(0);
  });

  it('Workers Logs は 2026-12-01 の改定で Cloudflare Observability（取り込み 50 GB・保存 10 GB 月を超えた分）に替わる（D-94）', () => {
    const cf = books.find((b) => b.provider === 'cloudflare')!;
    const change = cf.scheduledChanges.find(
      (c) => c.effectiveFrom === '2026-12-01',
    )!;
    expect(change.revisedMeters.length).toBeGreaterThan(0);
    // 改定の後の料金データ（ゲームの applyRevisions と同じ差し替え）
    const revised = books.map((b) =>
      b !== cf
        ? b
        : {
            ...b,
            plans: b.plans.map((p) => ({
              ...p,
              meters: p.meters.map((m) => {
                const r = change.revisedMeters.find(
                  (x) => x.planId === p.id && x.meterId === m.id,
                );
                return r ? { ...m, pricing: r.pricing } : m;
              }),
            })),
          },
    );
    const meters = [
      'workers-logs',
      'observability-ingest',
      'observability-storage',
    ];
    const run = (bs: typeof books, pv: number) => {
      const r = estimate({
        workload: articleCommunity(pv),
        architecture: composeStack('cloudflare-vinext-paid'),
        books: bs,
      });
      const sum = (k: 'log-gb' | 'log-gb-month' | 'log-events') =>
        Object.values(r.simulation.nodes).reduce(
          (a, n) => a + (n.resources[k] ?? 0),
          0,
        );
      const amount = (id: string) =>
        r.bill.lines
          .filter((l) => l.priceRef.meterId === id)
          .reduce((a, l) => a + (l.amount ?? 0), 0);
      return {
        gb: sum('log-gb'),
        gbMonth: sum('log-gb-month'),
        events: sum('log-events'),
        amount: Object.fromEntries(meters.map((m) => [m, amount(m)])),
      };
    };
    for (const pv of [1_000_000, 20_000_000, 100_000_000]) {
      const before = run(books, pv);
      // 改定の前は件数だけ課金し、量と保存は $0
      expect(before.amount['observability-ingest']).toBe(0);
      expect(before.amount['observability-storage']).toBe(0);
      const after = run(revised, pv);
      expect(after.gbMonth).toBeCloseTo((after.gb * 7) / 30, 9);
      expect(after.amount['workers-logs']).toBe(0);
      expect(after.amount['observability-ingest']).toBeCloseTo(
        Math.max(0, after.gb - 50) * 0.25,
        6,
      );
      expect(after.amount['observability-storage']).toBeCloseTo(
        Math.max(0, after.gbMonth - 10) * 0.1,
        6,
      );
    }
    // 1 億 PV では込みの分を超える
    expect(
      run(revised, 100_000_000).amount['observability-ingest'],
    ).toBeGreaterThan(0);
  });
});
