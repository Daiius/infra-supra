// 記事の S5 の記事ごとの枠（段 4・D-109・prd/13 §5d）: ページごとの HTML を書き出せるフレームワーク（Next.js・Astro・静的書き出し）では、
// 記事ごとの枠（メタタグ入り）をビルドで書き出し、中身はブラウザが API で取る。SPA は 1 つのシェルのまま。
import { describe, expect, it } from 'vitest';
import { composeStack, STACK_DEFS } from 'catalog';
import { resolveWorkload } from 'estimator';
import {
  ARTICLE_COMMUNITY,
  articleShellPerPage,
  DEFAULT_START_DATE,
  newGame,
  pageWireframes,
  playMonth,
  routeChoices,
  routePlanOf,
  setupCommentOptions,
  STACKS,
  staticBuildOf,
  workloadFor,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
} from './index.ts';

const sc = ARTICLE_COMMUNITY;
const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const CF_PAID = stack('cloudflare-vinext-paid');
const VERCEL_PRO = stack('vercel-supabase-pro');
const S5: RouteOverrides = { article: 'shell-api' };

const start = (
  stackIndex: number,
  fw: FrameworkId,
  routes?: RouteOverrides,
): GameState =>
  newGame(
    stackIndex,
    42,
    sc,
    DEFAULT_START_DATE,
    fw,
    undefined,
    undefined,
    undefined,
    undefined,
    routes,
  );

const workload = (st: GameState) =>
  workloadFor(sc, {
    pv: st.basePV,
    settings: st.settings,
    ssrCpuMs: 15,
    mods: {},
    stock: null,
    platform: STACKS[st.stackIndex]!.provider,
    components: st.components,
    framework: st.framework,
    routes: st.routes,
  });

describe('記事の S5 の記事ごとの枠（D-109）', () => {
  it('Next.js・Astro・静的書き出しの記事の S5 は記事ごとの枠、SPA は 1 つのシェル。個人向けのページは入口だけのまま', () => {
    for (const fw of ['nextjs', 'astro', 'nextjs-export'] as const) {
      const plan = routeChoices(sc, sc.template(1).routes, {
        framework: fw,
        platform: 'cloudflare',
        settings: { revalidateSec: 300 },
        components: {},
        routes: { article: 'shell-api', personal: 'shell-api' },
      });
      expect(plan.article).toEqual({
        strategy: 'shell-api',
        shellPerPage: true,
      });
      expect(plan.personal!.shellPerPage).toBeUndefined();
    }
    const spa = routeChoices(sc, sc.template(1).routes, {
      framework: 'vite-spa',
      platform: 'cloudflare',
      settings: { revalidateSec: 300 },
      components: {},
    });
    expect(spa.article!.shellPerPage).toBeUndefined();
  });

  it('枠は閲覧のたびに読み、記事の投稿・編集のたびにビルドする（間隔でまとめない）。中身とコメント欄で API は記事の閲覧に 2 回', () => {
    const st = start(CF_PAID, 'astro', S5);
    const w = workload(st);
    const article = w.routes.find((r) => r.id === 'article')!;
    expect(article).toMatchObject({
      rendering: 'spa',
      shellPerView: true,
      apiCalls: 1,
    });
    expect(w.build).toMatchObject({ updatesPerMonth: expect.any(Number) });
    expect(w.build!.intervalSeconds).toBeUndefined();
    const r = resolveWorkload(w);
    const views = st.basePV * article.share;
    // 枠: 記事の閲覧すべて（入口だけでない）+ 個人向けのページは入口だけ（Astro の既定は S4 なので 0）
    expect(r.classes['document-static'].count).toBeCloseTo(views, 6);
    // API: 記事の中身（views）+ コメント欄（views）+ 個人向けのページの部品（PV × 0.4）
    expect(r.classes.api.count).toBeCloseTo(
      views * 2 + st.basePV * (1 - article.share),
      6,
    );
    expect(r.builds.count).toBeGreaterThan(0);
  });

  it('構成にビルドのノードを足す。vinext では枠を Worker が ASSETS から返す（S1 と同じ）', () => {
    for (const fw of ['nextjs', 'astro'] as const) {
      const opts = staticBuildOf(sc, CF_PAID, fw, S5);
      expect(opts.staticBuild).toBe(true);
      const arch = composeStack(
        STACK_DEFS[CF_PAID]!,
        {},
        { framework: fw, ...opts },
      );
      expect(arch.nodes.some((n) => n.config.kind === 'ci-build')).toBe(true);
    }
    const next = composeStack(
      STACK_DEFS[CF_PAID]!,
      {},
      { framework: 'nextjs', ...staticBuildOf(sc, CF_PAID, 'nextjs', S5) },
    );
    expect(next.routes['document-static']).toEqual(['worker']);
    // SPA の S5 は既定のまま（ビルドのノードは足さない）
    expect(staticBuildOf(sc, CF_PAID, 'vite-spa', {})).toEqual({});
  });

  it('SNS のカードは枠に入る。新しい記事は枠のビルドまで開けないので鮮度は 1 段下がる（中身は API で常に新しい）', () => {
    const st = start(VERCEL_PRO, 'nextjs', S5);
    expect(articleShellPerPage(st)).toBe(true);
    const h = playMonth(st).history[0]!;
    expect(h.satisfaction.stages.freshness).toBe('fair');
    expect(h.satisfaction.reasons.freshness).toContain(
      '記事ごとの枠のビルドが終わるまで',
    );
    const row = routePlanOf(st).find((r) => r.route === 'article')!;
    expect(row.detail.join()).toContain('記事ごとに書き出す');
    expect(row.why).toContain('SNS のカードは枠に入る');
    // コメント欄は含められない（枠に中身が無い）
    expect(row.parts).toEqual([]);
    expect(setupCommentOptions(sc, 'nextjs', S5)).toEqual([]);
    // ほかの描き方の S5 の文にも出す
    const def = routePlanOf(start(VERCEL_PRO, 'nextjs')).find(
      (r) => r.route === 'article',
    )!;
    expect(
      def.alternatives.find((a) => a.strategy === 'shell-api')!.reason,
    ).toContain('記事ごとの枠');
  });

  it('見取り図はタイトル・ヘッダーを枠（ビルド）、本文を API にし、札を記事ごとの枠にする。SPA は 1 つのシェルの図のまま', () => {
    const a = pageWireframes(sc, 'astro', undefined, S5).find(
      (p) => p.route === 'article',
    )!;
    const src = Object.fromEntries(a.regions.map((r) => [r.id, r.source]));
    expect(src).toMatchObject({ title: 'build', body: 'api', header: 'build' });
    expect(a.badges.map((b) => b.text).join()).toContain('記事ごとの枠');
    const spa = pageWireframes(sc, 'vite-spa').find(
      (p) => p.route === 'article',
    )!;
    expect(spa.regions.find((r) => r.id === 'header')!.source).toBe('shell');
  });

  it('既定の描き方には記事ごとの枠は無い（どのフレームワークの既定も変わらない）', () => {
    for (const fw of ['nextjs', 'astro', 'nextjs-export', 'vite-spa'] as const)
      expect(articleShellPerPage(start(CF_PAID, fw))).toBe(false);
  });
});
