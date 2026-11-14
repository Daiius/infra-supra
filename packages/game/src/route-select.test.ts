// ページごとの描き方を選ぶ（D-107・段 3）: 始める画面の選択・途中の行動と手間・設定の意味・保存・構成・見取り図・要件の判定。
import { describe, expect, it } from 'vitest';
import { composeStack, STACK_DEFS } from 'catalog';
import {
  applyAction,
  applyActions,
  ARTICLE_COMMUNITY,
  checkAction,
  COMMENTS_IN_BROWSER,
  DEFAULT_START_DATE,
  frameworksOf,
  hiddenSettings,
  newGame,
  newSave,
  pageWireframes,
  parseSave,
  playMonth,
  replaySave,
  routeAlternativeAction,
  routePlanOf,
  routePlanStatus,
  SCENARIOS,
  setupMonthOneEstimate,
  setupCommentOptions,
  setupRevalidateOptions,
  STACKS,
  staticBuildOf,
  withTurn,
  type Action,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
} from './index.ts';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const CF_FREE = stack('cloudflare-vinext-free');
const CF_PAID = stack('cloudflare-vinext-paid');
const VERCEL_PRO = stack('vercel-supabase-pro');
const VPS = stack('sakura-vps-2gb');
const contract = Object.values(SCENARIOS).find((x) => x !== ARTICLE_COMMUNITY)!;

const start = (
  stackIndex: number,
  fw: FrameworkId,
  routes?: RouteOverrides,
  components?: Record<string, string>,
): GameState =>
  newGame(
    stackIndex,
    42,
    ARTICLE_COMMUNITY,
    DEFAULT_START_DATE,
    fw,
    components,
    // 記事の再検証は時間（5 分）で始める（描き方の S2 を確かめるため。既定はオンデマンドが選べればオンデマンド。D-125）
    300,
    undefined,
    undefined,
    routes,
  );
const strategies = (s: GameState) =>
  Object.fromEntries(routePlanOf(s).map((r) => [r.route, r.strategy]));
const route = (
  r: string,
  strategy: Extract<Action, { type: 'route' }>['strategy'],
  value?: number,
): Action => ({
  type: 'route',
  route: r,
  strategy,
  ...(value !== undefined ? { value } : {}),
});

describe('始める画面で選ぶ（D-107）', () => {
  it('選んだ描き方が表と Workload に出る（Vercel × Next.js の記事を S1・個人向けを S5）', () => {
    const s = start(VERCEL_PRO, 'nextjs', {
      article: 'static-build',
      personal: 'shell-api',
    });
    expect(strategies(s)).toEqual({
      article: 'static-build',
      personal: 'shell-api',
    });
    const r = playMonth(s).history[0]!;
    // S1 のビルドし直しは Vercel のビルドの CPU minute で数える
    expect(r.lines.map((l) => l.meterId)).toContain('build-cpu-minutes');
    // S1 では「ビルドの間隔」を出し、ISR の間隔は出さない
    expect(hiddenSettings(s)).toContain('isr');
    expect(hiddenSettings(s)).not.toContain('buildInterval');
  });

  it('CF Paid × Next.js（vinext）の記事を S1 に: Workers Builds のビルドを数え、記事のページは Worker を通す（RS-15 の解除）', () => {
    const s = start(CF_PAID, 'nextjs', { article: 'static-build' });
    expect(strategies(s).article).toBe('static-build');
    const routing = staticBuildOf(ARTICLE_COMMUNITY, CF_PAID, 'nextjs', {
      article: 'static-build',
    });
    const arch = composeStack(
      STACK_DEFS[CF_PAID]!,
      {},
      {
        framework: 'nextjs',
        ...routing,
      },
    );
    expect(arch.routes['document-static']).toEqual(['worker']);
    // ビルドは Workers Builds（月 6,000 分の込みの中なので 1 か月目の明細には出ない）
    expect(arch.nodes.find((n) => n.id === 'build')?.config.kind).toBe(
      'ci-build',
    );
    expect(playMonth(s).phase).toBe('playing');
  });

  it('使えない描き方は捨てる（個人向けのキャッシュ・vinext の S6）。vinext の S1・Astro の S6 は選べる（RS-15 の解除・D-108）', () => {
    expect(
      start(CF_PAID, 'nextjs', { article: 'static-build' }).routes,
    ).toEqual({ article: 'static-build' });
    expect(start(CF_PAID, 'astro', { personal: 'cached-ttl' }).routes).toBe(
      undefined,
    );
    expect(
      start(CF_PAID, 'astro', { personal: 'server-island' }).routes,
    ).toEqual({ personal: 'server-island' });
    expect(start(CF_PAID, 'nextjs', { personal: 'server-island' }).routes).toBe(
      undefined,
    );
    expect(start(CF_PAID, 'astro', { article: 'server-island' }).routes).toBe(
      undefined,
    );
    // フレームワークの既定と分け方が同じなら持たない
    expect(start(CF_PAID, 'nextjs', { article: 'cached-purge' }).routes).toBe(
      undefined,
    );
  });

  it('既定のまま始めると routes を持たない（今までの状態と同じ）', () => {
    for (const fw of frameworksOf(ARTICLE_COMMUNITY).allowed)
      expect(start(CF_PAID, fw)).not.toHaveProperty('routes');
  });

  it('記事を毎回描く・枠 + API にすると、再検証の設定は出さない（SPA 以外は API の応答のキャッシュも無い）', () => {
    const ssr = start(VERCEL_PRO, 'nextjs', { article: 'ssr' });
    for (const k of ['isr', 'buildInterval', 'pageCache', 'apiCacheTtl'])
      expect(hiddenSettings(ssr)).toContain(k);
    const api = start(VERCEL_PRO, 'astro', { article: 'shell-api' });
    expect(setupCommentOptions(ARTICLE_COMMUNITY, 'astro', api.routes)).toEqual(
      [],
    );
    expect(
      setupRevalidateOptions(ARTICLE_COMMUNITY, 'astro', api.routes),
    ).toEqual([]);
  });

  it('Astro × Cloudflare で記事をキャッシュしないなら、Workers Cache を前に置かない（静的アセットを Workers で数えない）', () => {
    const def = STACK_DEFS[CF_PAID]!;
    const routing = staticBuildOf(ARTICLE_COMMUNITY, CF_PAID, 'astro', {
      article: 'static-build',
    });
    expect(routing).toEqual({ staticBuild: true, pageCache: false });
    const arch = composeStack(def, {}, { framework: 'astro', ...routing });
    expect(arch.nodes.find((n) => n.id === 'assets')?.billing).toBeUndefined();
    expect(arch.nodes.some((n) => n.config.kind === 'ci-build')).toBe(true);
    const cached = composeStack(def, {}, { framework: 'astro' });
    expect(cached.nodes.find((n) => n.id === 'assets')?.billing).toBeDefined();
  });

  it('CF Free の Astro で記事を S1・個人向けを S5 にすると、1 リクエストの CPU の制限に当たらない（残るのは画像の変換）', () => {
    const blocking = (routes?: RouteOverrides) =>
      setupMonthOneEstimate(
        ARTICLE_COMMUNITY,
        CF_FREE,
        'astro',
        {},
        undefined,
        undefined,
        routes,
      ).blocking;
    const before = blocking();
    const cpu = before.find((b) => b.id.includes('cpu-ms-per-request'))!;
    expect(cpu.routes).toEqual(['article', 'personal']);
    const after = blocking({ article: 'static-build', personal: 'shell-api' });
    expect(after.some((b) => b.id.includes('cpu-ms-per-request'))).toBe(false);
  });
});

describe('途中で描き方を替える（D-107・RS-08）', () => {
  it('手間: 枠 + API へは 4・それ以外は 3。期限 ↔ オンデマンドは設定で替える', () => {
    // Vercel × Next.js の既定は部品ごとにキャッシュ（D-111）なので、ISR が既定の VPS で見る
    const s = start(VPS, 'nextjs');
    const cost = (a: Action) => {
      const r = checkAction(s, a);
      return r.ok ? r.cost : r.reason;
    };
    expect(cost(route('personal', 'shell-api'))).toBe(4);
    expect(cost(route('article', 'static-build'))).toBe(3);
    expect(cost(route('article', 'ssr'))).toBe(3);
    expect(cost(route('article', 'cached-purge'))).toBe('same');
    expect(cost(route('personal', 'cached-ttl'))).toBe('unavailable');
    expect(cost(route('nope', 'ssr'))).toBe('invalid');
    // 部品ごとにキャッシュへも、そこから ISR へも 3（RS-08・D-111）
    expect(cost(route('personal', 'cache-components'))).toBe(3);
    expect(
      checkAction(
        start(VERCEL_PRO, 'nextjs'),
        route('article', 'cached-purge'),
      ),
    ).toMatchObject({ ok: true, cost: 3 });
    // CF の Next.js（vinext）の S1 も同じ手間で選べる（RS-15 の解除）
    expect(
      checkAction(start(CF_PAID, 'nextjs'), route('article', 'static-build')),
    ).toMatchObject({ ok: true, cost: 3 });
  });

  it('表のほかの描き方から行動を作る（S2 → S3 は設定の変更・それ以外は描き方の変更）', () => {
    const s = start(VPS, 'nextjs');
    const row = routePlanOf(s).find((r) => r.route === 'article')!;
    const s3 = row.alternatives.find((a) => a.strategy === 'cached-purge')!;
    expect(routeAlternativeAction(s, row, s3)).toEqual({
      type: 'set',
      key: 'isr',
      value: 0,
    });
    const s1 = row.alternatives.find((a) => a.strategy === 'static-build')!;
    expect(routeAlternativeAction(s, row, s1)).toEqual(
      route('article', 'static-build'),
    );
  });

  it('翌月から効き、作り直しが済むと既定に戻る', () => {
    const s = applyAction(
      start(VERCEL_PRO, 'nextjs'),
      route('personal', 'shell-api'),
    );
    expect(s.routes).toEqual({ personal: 'shell-api' });
    const t = playMonth(s);
    expect(strategies(t).personal).toBe('shell-api');
    // 作り直しの最中は選べない
    const r = applyAction(t, { type: 'rewrite', framework: 'astro' });
    expect(checkAction(r, route('article', 'ssr')).ok).toBe(false);
    let u = playMonth(r);
    while (u.rewrite && u.phase === 'playing') u = playMonth(u);
    expect(u.framework).toBe('astro');
    expect(u.routes).toBeUndefined();
  });

  it('Vercel の Next.js の S1 は CF（vinext）へ乗り換えても S1 のまま（RS-15 の解除）', () => {
    let s = applyAction(
      start(VERCEL_PRO, 'nextjs'),
      route('article', 'static-build'),
    );
    s = applyAction(playMonth(s), { type: 'migrate', stackIndex: CF_PAID });
    while (s.stackIndex !== CF_PAID && s.phase === 'playing') s = playMonth(s);
    expect(s.routes).toEqual({ article: 'static-build' });
    expect(strategies(s).article).toBe('static-build');
  });
});

describe('保存（SAVE_VERSION 2 から・D-107）', () => {
  it('始めた描き方と途中の行動を保存して、同じ状態に戻る', () => {
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VPS,
      framework: 'nextjs',
      seed: 5,
      startDate: DEFAULT_START_DATE,
      routes: { personal: 'shell-api' },
    });
    expect(save.version).toBe(4);
    save = withTurn(save, [route('article', 'ssr')]);
    const parsed = parseSave(JSON.parse(JSON.stringify(save)))!;
    const s = replaySave(parsed);
    expect(strategies(s)).toEqual({ article: 'ssr', personal: 'shell-api' });
    expect(s).toEqual(replaySave(save));
  });

  it('Astro の記事を S1 にした保存の「ビルドの間隔」の行動は読み替えず、ふだんの遊びと再生が同じ（OCL-AC6E1C9E）', () => {
    const turns: Action[][] = [
      [{ type: 'set', key: 'buildInterval', value: 3600 }],
      [],
    ];
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VERCEL_PRO,
      framework: 'astro',
      seed: 9,
      startDate: DEFAULT_START_DATE,
      routes: { article: 'static-build' },
    });
    // ふだんの遊び（画面と同じ順: 月を進め、行動を当てる）
    let played = playMonth(
      newGame(
        VERCEL_PRO,
        9,
        ARTICLE_COMMUNITY,
        DEFAULT_START_DATE,
        'astro',
        undefined,
        undefined,
        undefined,
        undefined,
        { article: 'static-build' },
      ),
    );
    for (const t of turns) {
      for (const a of t) expect(checkAction(played, a).ok).toBe(true);
      played = playMonth(applyActions(played, t));
      save = withTurn(save, t);
    }
    expect(played.settings.revalidateSec).toBe(3600);
    expect(replaySave(parseSave(JSON.parse(JSON.stringify(save)))!)).toEqual(
      played,
    );
  });

  it('版 1 の保存は描き方を既定として読む（描き方を選べる前と同じ結果）', () => {
    const v1 = {
      version: 1,
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: CF_PAID,
      framework: 'astro',
      seed: 7,
      startDate: DEFAULT_START_DATE,
      turns: [[{ type: 'set', key: 'buildInterval', value: 21600 }], []],
    };
    const s = replaySave(parseSave(v1)!);
    expect(s.routes).toBeUndefined();
    // D-103 の読み替え（Astro の buildInterval → pageCache）も効く
    expect(s.settings.revalidateSec).toBe(21600);
    expect(parseSave({ ...v1, version: 5 })).toBeNull();
    expect(
      parseSave({ ...v1, version: 2, routes: { article: 'x' } }),
    ).toBeNull();
  });
});

describe('見取り図と要件の判定（D-107）', () => {
  it('選んだ描き方のページは、その描き方を既定に持つフレームワークの図を借りる', () => {
    const src = (fw: FrameworkId, routes?: RouteOverrides) =>
      Object.fromEntries(
        pageWireframes(ARTICLE_COMMUNITY, fw, COMMENTS_IN_BROWSER, routes).map(
          (p) => [p.route, [...new Set(p.regions.map((r) => r.source))].sort()],
        ),
      );
    // Next.js の個人向けを S5 → 静的書き出しの個人向けと同じ（静的な枠 + API）
    expect(src('nextjs', { personal: 'shell-api' }).personal).toEqual(
      src('nextjs-export').personal,
    );
    // 記事を毎回描く（借りる先が無い）→ 本体の区画が閲覧ごとに SSR に
    expect(src('nextjs', { article: 'ssr' }).article).toContain('ssr');
    expect(src('nextjs', { article: 'ssr' }).article).not.toContain('isr');
  });

  it('行ごとに反映スピード・SNS のカード・CPU の制限・ほかの描き方の 1 か月目の差を出す', () => {
    const st = routePlanStatus(ARTICLE_COMMUNITY, {
      framework: 'astro',
      stackIndex: CF_FREE,
      components: {},
    });
    const article = st.find((r) => r.route === 'article')!;
    const personal = st.find((r) => r.route === 'personal')!;
    expect(article.freshness?.stage).toBe('good');
    expect(article.ogp?.ok).toBe(true);
    expect(article.cpu.ok).toBe(false);
    expect(article.cpu.text).toContain('10 ms');
    expect(personal.freshness).toBeUndefined();
    expect(personal.cpu.ok).toBe(false);
    // 個人向けを S5 にすると、当たる前提が減る（記事の再生成は残る）
    expect(personal.deltas['shell-api']).toBeDefined();
    expect(personal.deltas['ssr']).toBeUndefined();
    // Next.js の記事を S5 にすると記事ごとの枠（メタタグ入り）になり、SNS のカードは出る。新しい記事は枠のビルドまで開けない（D-109）
    const api = routePlanStatus(ARTICLE_COMMUNITY, {
      framework: 'nextjs',
      stackIndex: VERCEL_PRO,
      components: {},
      routes: { article: 'shell-api' },
    });
    const a = api.find((r) => r.route === 'article')!;
    expect(a.ogp?.ok).toBe(true);
    expect(a.freshness?.stage).toBe('fair');
    expect(a.freshness?.text).toContain('枠のビルド');
    // SPA の記事（1 つのシェル）は SNS のカードが出ない（前処理の部品が要る）
    const spa = routePlanStatus(ARTICLE_COMMUNITY, {
      framework: 'vite-spa',
      stackIndex: VERCEL_PRO,
      components: {},
    });
    expect(spa.find((r) => r.route === 'article')!.ogp?.ok).toBe(false);
  });

  it('受託は業務の画面 1 行（S4 ↔ S5）', () => {
    const s = newGame(CF_PAID, 1, contract, DEFAULT_START_DATE, 'nextjs');
    const rows = routePlanOf(s);
    expect(rows.map((r) => r.route)).toEqual(['app']);
    expect(
      rows[0]!.alternatives.filter((a) => a.available).map((a) => a.strategy),
    ).toEqual(['shell-api']);
  });
});
