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
  perPageShellFramework,
  presetPlan,
  ROUTE_STRATEGIES,
  ROUTE_STRATEGY_ORDER,
  routeAudience,
  SERVER_ISLAND,
  serverIslandDelivery,
  CACHE_COMPONENTS,
} from './route-strategies.ts';
import { strategyTitle } from './terms.ts';

const FRAMEWORK_IDS = Object.keys(FRAMEWORK_PRESETS) as FrameworkId[];

describe('描き方のメニュー', () => {
  it('S1〜S6 と部品ごとにキャッシュ（番号を出さない）が順に並び、個人化のページに使えるのは S4〜S6 と部品ごとにキャッシュ', () => {
    expect(ROUTE_STRATEGY_ORDER.map((s) => ROUTE_STRATEGIES[s].code)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      '',
    ]);
    expect(
      ROUTE_STRATEGY_ORDER.filter((s) => ROUTE_STRATEGIES[s].personalOk),
    ).toEqual(['ssr', 'shell-api', 'server-island', 'cache-components']);
    expect(strategyTitle('cache-components')).toBe(
      '部品ごとにキャッシュ（Cache Components）',
    );
    // 番号（S1〜S6）は画面に出さない（D-112）
    expect(strategyTitle('ssr')).toBe('毎回描く（キャッシュしない）');
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

  it('vinext の S1 は README を出典に出し、開発中の注を添える（RS-15・D-107 の補足）', () => {
    const v = capabilityRow('nextjs', 'cloudflare')['static-build'];
    expect(v.support).toBe('yes');
    expect(v.basis).toBe('source');
    expect(v.sources.map((x) => x.url)).toContain(
      'https://github.com/cloudflare/vinext',
    );
    expect(v.note).toContain('vinext は開発中です（README）');
    expect(v.note).toContain('Worker のリクエストに数え');
  });

  it('Amplify・Google Cloud の Next.js の S1 は、静的なページに処理を通さないことをゲーム上の仮定と書く', () => {
    for (const p of ['aws', 'gcp'] as const)
      expect(capabilityRow('nextjs', p)['static-build'].note).toContain(
        'ゲーム上の仮定',
      );
    expect(
      capabilityRow('nextjs', 'vercel')['static-build'].note,
    ).not.toContain('ゲーム上の仮定');
  });

  it('S6 の対応（prd/13 §8・D-108）: Astro は CF・VPS・Netlify が出典・Vercel と Cloud Run は仮、Next.js の PPR は Vercel・VPS・Cloud Run', () => {
    const at = (f: FrameworkId, p: Parameters<typeof capabilityRow>[1]) =>
      capabilityRow(f, p)['server-island'];
    for (const p of ['cloudflare', 'sakura', 'netlify'] as const) {
      expect(at('astro', p).support, p).toBe('yes');
      expect(at('astro', p).basis, p).toBe('source');
      expect(at('astro', p).sources.map((s) => s.url)).toContain(
        'https://docs.astro.build/en/guides/server-islands/',
      );
    }
    for (const p of ['vercel', 'gcp'] as const) {
      expect(at('astro', p).support, p).toBe('yes');
      expect(at('astro', p).basis, p).toBe('assumption');
      expect(at('astro', p).note).toContain('ゲーム上の仮定');
    }
    for (const p of ['vercel', 'sakura', 'gcp'] as const) {
      expect(at('nextjs', p).support, p).toBe('yes');
      expect(at('nextjs', p).basis, p).toBe('source');
      expect(at('nextjs', p).note).toContain('cacheComponents');
    }
    // vinext は cacheComponents が未完成・Amplify は Next.js 15 まで
    expect(at('nextjs', 'cloudflare').support).toBe('no');
    expect(at('nextjs', 'cloudflare').note).toContain('vinext');
    expect(at('nextjs', 'aws').support).toBe('no');
    expect(at('nextjs', 'aws').note).toContain('15');
    // 一次情報を取っていない組は出さない
    expect(at('nextjs', 'netlify').support).toBe('unverified');
    expect(at('nextjs', 'aws-opennext').support).toBe('unverified');
    // サーバーの無いフレームワークは使えない
    for (const f of ['nextjs-export', 'vite-spa'] as const)
      expect(at(f, 'vercel').support).toBe('no');
  });

  it('S6 は人ごとに違うページだけ（全員に同じページは数え方が無いので灰色。D-108）', () => {
    expect(
      strategySupport('astro', 'cloudflare', 'personal', 'server-island')
        .support,
    ).toBe('yes');
    const pub = strategySupport(
      'astro',
      'cloudflare',
      'public',
      'server-island',
    );
    expect(pub.support).toBe('no');
    expect(pub.note).toContain('人ごとに違うページだけ');
    // 使えない組の理由はそのまま
    expect(
      strategySupport('nextjs', 'cloudflare', 'public', 'server-island').note,
    ).toContain('vinext');
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
      applyRouteStrategies(
        w,
        { article: { strategy: 'server-island' } },
        { island: 'request' },
      ),
    ).toThrow();
    // 島の届け方が無いと数えられない
    expect(() =>
      applyRouteStrategies(w, { personal: { strategy: 'server-island' } }),
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

  it('ページの部品が呼ぶ API（記事の apiCalls。D-109）は、どの描き方に書き換えても記事のルートに残る', () => {
    expect(w.routes[0]!.apiCalls).toBe(1);
    const ctx = {
      spa: ARTICLE_COMMUNITY_SPA,
      minutesPerBuild: { base: 1, perThousandPages: 0.5 },
      build: { updatesPerMonth: 10 },
    };
    for (const strategy of [
      'static-build',
      'cached-ttl',
      'ssr',
      'shell-api',
    ] as const)
      expect(
        applyRouteStrategies(w, { article: { strategy } }, ctx).routes[0]!
          .apiCalls,
      ).toBe(1);
  });

  it('記事ごとの枠（S5 の shellPerPage。D-109）: 枠を閲覧のたびに読み、記事のページの数だけビルドする（S1 と同じ式）', () => {
    const ctx = {
      spa: ARTICLE_COMMUNITY_SPA,
      minutesPerBuild: { base: 1, perThousandPages: 0.5 },
      build: { updatesPerMonth: 10 },
    };
    const out = applyRouteStrategies(
      w,
      { article: { strategy: 'shell-api', shellPerPage: true } },
      ctx,
    );
    expect(out.routes[0]).toMatchObject({
      rendering: 'spa',
      shellPerView: true,
      shellKB: ARTICLE_COMMUNITY_SPA.shellKB,
    });
    const s1 = applyRouteStrategies(
      w,
      { article: { strategy: 'static-build' } },
      ctx,
    );
    expect(out.build).toEqual(s1.build);
    // 入口だけの S5 はビルドしない
    const single = applyRouteStrategies(
      w,
      { article: { strategy: 'shell-api' } },
      ctx,
    );
    expect(single.build).toBeUndefined();
    expect(single.routes[0]).not.toHaveProperty('shellPerView');
    expect(perPageShellFramework('vite-spa')).toBe(false);
    for (const fw of ['nextjs', 'astro', 'nextjs-export'] as const)
      expect(perPageShellFramework(fw)).toBe(true);
  });

  it('S6（Astro）: 個人向けのページを、1 日の期限でキャッシュする枠と、閲覧ごとの島のリクエスト（SSR の 4 割の CPU）に分ける（D-108）', () => {
    const out = applyRouteStrategies(
      w,
      { personal: { strategy: 'server-island' } },
      { island: 'request' },
    );
    const before = w.routes[1]!;
    const shell = out.routes[1]!;
    expect(out.routes[0]).toEqual(w.routes[0]);
    expect(shell).toMatchObject({
      id: 'personal',
      label: before.label,
      rendering: 'isr',
      share: before.share,
      revalidateSeconds: SERVER_ISLAND.shellRevalidateSeconds,
      cachedServeCpuMs: SERVER_ISLAND.shellCachedServeCpuMs,
    });
    expect(shell.processing.queries).toBe(0);
    expect(shell.processing.cpuMs).toBeCloseTo(before.processing.cpuMs * 0.6);
    expect(shell.island!.request).toEqual({
      ...before.processing,
      cpuMs: before.processing.cpuMs * 0.4,
      responseKB: before.processing.responseKB * 0.4,
    });
    // 枠と島の CPU の合計は、ページ全体の SSR と同じ
    expect(shell.processing.cpuMs + shell.island!.request!.cpuMs).toBeCloseTo(
      before.processing.cpuMs,
    );
  });

  it('S6（Next.js の PPR）: 毎回描く（ssr）のまま、CPU を島の分にして島の印を付ける（D-108）', () => {
    const out = applyRouteStrategies(
      w,
      { personal: { strategy: 'server-island' } },
      { island: 'stream' },
    );
    const before = w.routes[1]!;
    expect(out.routes[1]).toEqual({
      ...before,
      processing: {
        ...before.processing,
        cpuMs: before.processing.cpuMs * SERVER_ISLAND.islandShare,
      },
      island: {},
    });
  });

  it('S6 の島の届け方: Astro は別のリクエスト・Next.js は同じ応答・静的書き出しと SPA は無い', () => {
    expect(serverIslandDelivery('astro')).toBe('request');
    expect(serverIslandDelivery('nextjs')).toBe('stream');
    expect(serverIslandDelivery('nextjs-export')).toBeUndefined();
    expect(serverIslandDelivery('vite-spa')).toBeUndefined();
  });
});

describe('部品ごとにキャッシュ（Cache Components。D-111）', () => {
  it('対応: Next.js × Vercel・VPS・Google Cloud は出典つきで使える、vinext・Amplify は使えない、Astro・静的書き出し・SPA には無い', () => {
    for (const p of ['vercel', 'sakura', 'gcp'] as const) {
      const x = capabilityRow('nextjs', p)['cache-components'];
      expect(x.support, p).toBe('yes');
      expect(x.basis, p).toBe('source');
      expect(
        x.sources.some((s) => s.url.includes('nextjs.org/docs')),
        p,
      ).toBe(true);
    }
    expect(
      capabilityRow('nextjs', 'cloudflare')['cache-components'].support,
    ).toBe('no');
    expect(capabilityRow('nextjs', 'aws')['cache-components'].support).toBe(
      'no',
    );
    for (const f of ['astro', 'nextjs-export', 'vite-spa'] as const)
      expect(capabilityRow(f, 'vercel')['cache-components'].support, f).toBe(
        'no',
      );
    // 全員に同じページ（記事）にも人ごとに違うページにも使える
    expect(
      strategySupport('nextjs', 'vercel', 'public', 'cache-components').support,
    ).toBe('yes');
    expect(
      strategySupport('nextjs', 'vercel', 'personal', 'cache-components')
        .support,
    ).toBe('yes');
  });

  it('既定: Vercel × Next.js だけ部品ごとにキャッシュ。legacy（保存の版 3 まで）は今までの既定', () => {
    expect(defaultStrategy('nextjs', 'vercel', 'public')).toBe(
      'cache-components',
    );
    expect(defaultStrategy('nextjs', 'vercel', 'personal')).toBe(
      'cache-components',
    );
    expect(
      defaultStrategy('nextjs', 'vercel', 'public', { legacy: true }),
    ).toBe('cached-ttl');
    expect(
      defaultStrategy('nextjs', 'vercel', 'personal', { legacy: true }),
    ).toBe('ssr');
    for (const p of ['sakura', 'gcp', 'cloudflare', 'aws'] as const) {
      expect(defaultStrategy('nextjs', p, 'public'), p).not.toBe(
        'cache-components',
      );
      expect(defaultStrategy('nextjs', p, 'personal'), p).toBe('ssr');
    }
    expect(defaultStrategy('astro', 'vercel', 'personal')).toBe('ssr');
  });

  it('Workload: 記事は ISR のまま、個人向けは ssr のまま CPU を穴の分・DB を全員に同じ部品の分を除いた残りにする', () => {
    const w = articleCommunity(10_000);
    const out = applyRouteStrategies(w, {
      article: { strategy: 'cache-components' },
      personal: { strategy: 'cache-components' },
    });
    expect(out.routes[0]).toEqual(w.routes[0]);
    const before = w.routes[1]!;
    const after = out.routes[1]!;
    expect(after.rendering).toBe('ssr');
    expect(after.island).toEqual({ label: CACHE_COMPONENTS.holeLabel });
    expect(after.processing.cpuMs).toBeCloseTo(
      before.processing.cpuMs * CACHE_COMPONENTS.dynamicShare,
    );
    expect(after.processing.queries).toBeCloseTo(
      before.processing.queries * (1 - CACHE_COMPONENTS.cachedQueryShare),
    );
    expect(after.processing.ioWaitMs).toBeCloseTo(
      before.processing.ioWaitMs * (1 - CACHE_COMPONENTS.cachedQueryShare),
    );
    expect(after.processing.responseKB).toBe(before.processing.responseKB);
  });
});
