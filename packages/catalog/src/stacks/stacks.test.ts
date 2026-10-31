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
      ['db', 'images', 'isrCache', 'realtime'].sort(),
    );
  });
});
