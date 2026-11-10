// 描き方の呼び名をフレームワークの公式の用語にする（D-193）: 表・見取り図・部品の名前が、選んだフレームワークで替わること。
// 呼び名の無いもの（Vite の SPA の人ごとの部分など）とフレームワークを選ぶ前は一般の言葉のまま。
import { ROUTE_STRATEGIES, slotLabel, strategyTitle } from 'catalog';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  pageWireframes,
  regionSourceLabel,
  routePlanRows,
  setupSlots,
  STACKS,
  type FrameworkId,
} from './index.ts';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const labels = (fw: FrameworkId, stackId: string) =>
  Object.fromEntries(
    routePlanRows(ARTICLE_COMMUNITY, {
      framework: fw,
      stackIndex: stack(stackId),
      settings: { revalidateSec: 300 },
      components: {},
    }).map((r) => [
      r.route,
      {
        label: r.strategyLabel,
        note: r.strategyTermNote,
        alts: Object.fromEntries(
          r.alternatives.map((a) => [a.strategy, a.label]),
        ),
      },
    ]),
  );

describe('描き方の表の名前（D-193）', () => {
  it('Next.js は Next.js の用語（ISR・Dynamic rendering・PPR・Prerendering など）', () => {
    const r = labels('nextjs', 'cloudflare-vinext-paid');
    expect(r.article!.label).toBe('ISR');
    expect(r.article!.note).toContain('Incremental Static Regeneration');
    expect(r.personal!.label).toBe('Dynamic rendering');
    expect(r.article!.alts['static-build']).toBe('Prerendering');
    expect(r.personal!.alts['shell-api']).toBe('Client-side data fetching');
    const v = labels('nextjs', 'vercel-supabase-pro');
    expect(v.personal!.alts['server-island']).toBe(
      'Partial Prerendering（PPR）',
    );
    expect(v.personal!.label).toBe('Cache Components');
  });

  it('Astro は Astro の用語（Route caching・On-demand rendering・Server islands など）', () => {
    const r = labels('astro', 'vercel-supabase-pro');
    expect(r.article!.label).toBe('Route caching（maxAge）'); // 再検証 5 分（期限）
    expect(r.personal!.label).toBe('On-demand rendering');
    expect(r.personal!.alts['server-island']).toBe('Server islands');
    expect(r.personal!.alts['shell-api']).toBe('Client Islands');
    expect(r.article!.alts['static-build']).toBe('prerender');
  });

  it('Next.js の静的書き出しは Static Export、Vite の SPA は SPA。呼び名の無いものは一般の言葉', () => {
    const e = labels('nextjs-export', 'cloudflare-vinext-paid');
    expect(e.article!.label).toBe('Static Export');
    expect(e.personal!.label).toBe('Client-side data fetching');
    const s = labels('vite-spa', 'cloudflare-vinext-paid');
    expect(s.personal!.label).toBe('SPA');
    // Vite の SPA に Server islands のような呼び名は無い
    expect(strategyTitle('server-island', 'vite-spa')).toBe(
      ROUTE_STRATEGIES['server-island'].label,
    );
  });

  it('フレームワークを選ぶ前（渡さない）は一般の言葉', () => {
    for (const id of Object.keys(
      ROUTE_STRATEGIES,
    ) as (keyof typeof ROUTE_STRATEGIES)[])
      expect(strategyTitle(id)).toBe(ROUTE_STRATEGIES[id].label);
    expect(slotLabel('isrCache')).toBe('ページのキャッシュ（ISR）');
  });
});

describe('部品・見取り図の名前（D-193）', () => {
  it('ページのキャッシュの部品は Next.js では「ISR のキャッシュ」', () => {
    const slot = setupSlots(
      ARTICLE_COMMUNITY,
      stack('cloudflare-vinext-paid'),
      'nextjs',
    ).find((x) => x.slot === 'isrCache');
    expect(slot?.label).toBe('ISR のキャッシュ');
    expect(slotLabel('isrCache', 'astro')).toBe('ページのキャッシュ（ISR）');
  });

  it('見取り図の札はフレームワークの呼び名。Vite の SPA の API で取る区画は一般の言葉', () => {
    const astro = pageWireframes(ARTICLE_COMMUNITY, 'astro', undefined, {
      personal: 'server-island',
    });
    const regions = astro.flatMap((p) => p.regions);
    const island = regions.find((r) => r.source === 'server-island');
    expect(island?.sourceLabel).toBe('Server islands');
    expect(regionSourceLabel('island-shell', 'nextjs').label).toBe(
      'Static Shell',
    );
    expect(regionSourceLabel('server-island', 'nextjs').label).toBe(
      '人ごとの部分（閲覧ごとにサーバーで描く）',
    );
    expect(regionSourceLabel('shell', 'vite-spa').label).toBe('SPA');
    expect(regionSourceLabel('api', 'vite-spa').label).toBe(
      'ブラウザが API で取る',
    );
    expect(regionSourceLabel('ssr', undefined).label).toBe('閲覧ごとに SSR');
  });
});
