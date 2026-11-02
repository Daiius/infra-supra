// ページごとの描き方のモデル（D-106・prd/13）: プリセット・対応表・applyRouteStrategies の性質。
// 今までの toSpa・toAstro・toNextExport と同じ Workload になることは、game の route-strategies-equivalence.test.ts が
// すべてのシナリオ × フレームワーク × 構成で確かめる。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY_ROUTES,
  ARTICLE_COMMUNITY_SPA,
  articleCommunity,
  BUSINESS_APP_ROUTES,
  businessApp,
} from '../templates/index.ts';
import { DEPLOY_TARGETS, type FrameworkId } from './index.ts';
import {
  capabilityRow,
  defaultStrategy,
  strategySupport,
} from './route-capability.ts';
import {
  applyRouteStrategies,
  FRAMEWORK_PRESETS,
  presetPlan,
  ROUTE_STRATEGIES,
  ROUTE_STRATEGY_ORDER,
  routeAudience,
} from './route-strategies.ts';

const FRAMEWORK_IDS = Object.keys(FRAMEWORK_PRESETS) as FrameworkId[];

describe('描き方のメニュー', () => {
  it('S1〜S6 が順に並び、個人化のページに使えるのは S4〜S6 だけ', () => {
    expect(ROUTE_STRATEGY_ORDER.map((s) => ROUTE_STRATEGIES[s].code)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
    ]);
    expect(
      ROUTE_STRATEGY_ORDER.filter((s) => ROUTE_STRATEGIES[s].personalOk),
    ).toEqual(['ssr', 'shell-api', 'server-island']);
  });

  it('テンプレートのルートの見る人: 記事は全員に同じ・個人向けと業務の画面は人ごと', () => {
    const a = articleCommunity(1000).routes;
    expect(a.map((r) => [r.id, routeAudience(r)])).toEqual([
      ['article', 'public'],
      ['personal', 'personal'],
    ]);
    expect(businessApp(1000).routes.map((r) => routeAudience(r))).toEqual([
      'personal',
    ]);
  });

  it('プリセット: Next.js は S2/S4・Astro は S3/S4・静的書き出しは S1/S5・SPA は S5/S5', () => {
    expect(FRAMEWORK_PRESETS).toEqual({
      nextjs: { public: 'cached-ttl', personal: 'ssr' },
      astro: { public: 'cached-purge', personal: 'ssr' },
      'nextjs-export': { public: 'static-build', personal: 'shell-api' },
      'vite-spa': { public: 'shell-api', personal: 'shell-api' },
    });
  });

  it('プリセットは、個人化のページに使い回す描き方を入れない', () => {
    for (const f of FRAMEWORK_IDS)
      expect(
        ROUTE_STRATEGIES[FRAMEWORK_PRESETS[f].personal].personalOk,
        f,
      ).toBe(true);
  });
});

describe('対応表（フレームワーク × 事業者）', () => {
  it('載せられる組では、既定の描き方（事業者で落とした後）がその事業者で使える', () => {
    for (const d of DEPLOY_TARGETS) {
      if (d.support === 'unsupported') continue;
      for (const a of ['public', 'personal'] as const) {
        const s = defaultStrategy(d.framework, d.platform, a);
        expect(
          strategySupport(d.framework, d.platform, a, s).support,
          `${d.framework} × ${d.platform} × ${a} → ${s}`,
        ).not.toBe('no');
      }
    }
  });

  it('Astro の記事は消せる置き場で S3、Google Cloud（Hosting の CDN）では S2（D-103）', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura', 'netlify'] as const)
      expect(defaultStrategy('astro', p, 'public')).toBe('cached-purge');
    expect(defaultStrategy('astro', 'gcp', 'public')).toBe('cached-ttl');
    expect(capabilityRow('astro', 'gcp')['cached-purge'].note).toContain(
      'Hosting',
    );
  });

  it('Next.js の S3 は ISR のキャッシュの部品で決まる（Cloudflare は KV で消せない）', () => {
    const cf = capabilityRow('nextjs', 'cloudflare')['cached-purge'];
    expect(cf.support).toBe('depends');
    expect(cf.note).toContain('KV');
    expect(capabilityRow('nextjs', 'vercel')['cached-purge'].support).toBe(
      'yes',
    );
    expect(capabilityRow('nextjs', 'gcp')['cached-purge'].support).toBe('no');
  });

  it('Next.js の S1 は generateStaticParams の公式の文書を出典にする（vinext 以外。D-107）', () => {
    const v = capabilityRow('nextjs', 'vercel')['static-build'];
    expect(v.support).toBe('yes');
    expect(v.basis).toBe('source');
    expect(v.sources[0]!.url).toContain('generate-static-params');
  });

  it('テンプレートのルートの性質（D-107・RS-17）がルートと 1 対 1 で、見る人が今までの読み方と同じ', () => {
    for (const [w, traits] of [
      [articleCommunity(1000), ARTICLE_COMMUNITY_ROUTES],
      [businessApp(1000), BUSINESS_APP_ROUTES],
    ] as const) {
      expect(Object.keys(traits).sort()).toEqual(
        w.routes.map((r) => r.id).sort(),
      );
      for (const r of w.routes)
        expect(routeAudience(r, traits)).toBe(routeAudience(r));
    }
    expect(ARTICLE_COMMUNITY_ROUTES.article!.needsOgp).toBe(true);
  });

  it('vinext の S1 と S6 は確かめるまで出さない（RS-15・段 5）', () => {
    expect(capabilityRow('nextjs', 'cloudflare')['static-build'].support).toBe(
      'unverified',
    );
    for (const f of ['nextjs', 'astro'] as const)
      expect(capabilityRow(f, 'vercel')['server-island'].support).toBe(
        'unverified',
      );
  });

  it('静的書き出しは S1・S5 だけ、SPA は S5 だけ', () => {
    const ok = (f: FrameworkId) =>
      ROUTE_STRATEGY_ORDER.filter(
        (s) => capabilityRow(f, 'cloudflare')[s].support === 'yes',
      );
    expect(ok('nextjs-export')).toEqual(['static-build', 'shell-api']);
    expect(ok('vite-spa')).toEqual(['shell-api']);
  });

  it('個人化のページには S1〜S3 を使えない（理由つき）', () => {
    const x = strategySupport('astro', 'vercel', 'personal', 'cached-purge');
    expect(x.support).toBe('no');
    expect(x.note).toContain('他の人に見え');
  });

  it('出典つきの「使える」には出典がある・どの行にも理由の文がある', () => {
    for (const d of DEPLOY_TARGETS)
      for (const s of ROUTE_STRATEGY_ORDER) {
        const x = capabilityRow(d.framework, d.platform)[s];
        expect(
          x.note.length,
          `${d.framework} × ${d.platform} × ${s}`,
        ).toBeGreaterThan(0);
        if (x.basis === 'source') expect(x.sources.length).toBeGreaterThan(0);
      }
  });
});

describe('applyRouteStrategies', () => {
  const w = articleCommunity(100_000);

  it('S2・S3・S4 のプリセット（Next.js・Astro）は Workload を変えない', () => {
    expect(applyRouteStrategies(w, presetPlan(w.routes, 'nextjs'))).toEqual(w);
    expect(applyRouteStrategies(w, presetPlan(w.routes, 'astro'))).toEqual(w);
  });

  it('記事を S4 にすると ISR のキャッシュの部品「キャッシュしない」と同じ書き換え', () => {
    const out = applyRouteStrategies(w, { article: { strategy: 'ssr' } });
    expect(out.routes[0]).toEqual({ ...w.routes[0], rendering: 'ssr' });
  });

  it('数え方の無い組（個人化のページを静的に・S6）は例外にする', () => {
    expect(() =>
      applyRouteStrategies(
        w,
        { personal: { strategy: 'static-build' } },
        {
          minutesPerBuild: { base: 1, perThousandPages: 0.5 },
          build: { updatesPerMonth: 1 },
        },
      ),
    ).toThrow();
    expect(() =>
      applyRouteStrategies(w, { article: { strategy: 'server-island' } }),
    ).toThrow();
    expect(() =>
      applyRouteStrategies(w, { article: { strategy: 'shell-api' } }),
    ).toThrow();
  });

  it('S5 の API の応答のキャッシュは、全員に同じ中身（ISR だった）ルートの期限だけを引き継ぐ', () => {
    const out = applyRouteStrategies(
      w,
      presetPlan(w.routes, 'vite-spa', { cacheContent: true }),
      { spa: ARTICLE_COMMUNITY_SPA },
    );
    const [article, personal] = out.routes;
    expect(article).toMatchObject({ rendering: 'spa', cacheSeconds: 300 });
    expect(personal!.rendering).toBe('spa');
    expect(personal).not.toHaveProperty('cacheSeconds');
  });
});
