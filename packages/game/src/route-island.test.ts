// 枠 + サーバーの島（描き方 S6・段 5。D-108・prd/13 §8）: 選べる組・Workload の数え方・構成・費用・途中の行動・保存・見取り図。
import { describe, expect, it } from 'vitest';
import { composeStack, SERVER_ISLAND, STACK_DEFS } from 'catalog';
import { resolveWorkload } from 'estimator';
import {
  applyAction,
  ARTICLE_COMMUNITY,
  checkAction,
  DEFAULT_START_DATE,
  newGame,
  newSave,
  pageWireframes,
  parseSave,
  playMonth,
  replaySave,
  routePlanOf,
  routePlanStatus,
  SCENARIOS,
  setupMonthOneEstimate,
  STACKS,
  staticBuildOf,
  withTurn,
  workloadFor,
  type Action,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
  type Scenario,
} from './index.ts';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const CF_FREE = stack('cloudflare-vinext-free');
const CF_PAID = stack('cloudflare-vinext-paid');
const VERCEL_PRO = stack('vercel-supabase-pro');
const VPS = stack('sakura-vps-2gb');
const contract = Object.values(SCENARIOS).find((x) => x !== ARTICLE_COMMUNITY)!;
const ISLAND: RouteOverrides = { personal: 'server-island' };

const start = (
  stackIndex: number,
  fw: FrameworkId,
  routes?: RouteOverrides,
  sc: Scenario = ARTICLE_COMMUNITY,
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
const strategies = (s: GameState) =>
  Object.fromEntries(routePlanOf(s).map((r) => [r.route, r.strategy]));
const route = (r: string, strategy: 'server-island' | 'ssr'): Action => ({
  type: 'route',
  route: r,
  strategy,
});

/** 1 か月目の基準の PV で組んだ Workload（route-plan.test.ts と同じ入力）。 */
const workload = (
  stackIndex: number,
  framework: FrameworkId,
  routes?: RouteOverrides,
) =>
  workloadFor(ARTICLE_COMMUNITY, {
    pv: 100_000,
    settings: {
      revalidateSec: 300,
      imageKB: 150,
      variants: 3,
      ssrOptimizations: 0,
    },
    ssrCpuMs: 15,
    mods: {},
    stock: null,
    platform: STACKS[stackIndex]!.provider,
    components: {},
    framework,
    routes,
  });

describe('選べる組（D-108）', () => {
  it('Astro は Cloudflare・Vercel・VPS・Google Cloud、Next.js の PPR は Vercel・VPS・Google Cloud で、人ごとに違うページだけ', () => {
    for (const s of [CF_FREE, VERCEL_PRO, VPS, stack('gcp-cloud-run')])
      expect(strategies(start(s, 'astro', ISLAND)).personal).toBe(
        'server-island',
      );
    for (const s of [VERCEL_PRO, VPS, stack('gcp-cloud-run')])
      expect(strategies(start(s, 'nextjs', ISLAND)).personal).toBe(
        'server-island',
      );
    // vinext（cacheComponents が未完成）・Amplify（Next.js 15 まで）は既定に戻る
    for (const s of [CF_PAID, stack('aws-amplify')])
      expect(start(s, 'nextjs', ISLAND).routes).toBeUndefined();
    // 記事（全員に同じ）には使わない
    expect(
      start(VERCEL_PRO, 'astro', { article: 'server-island' }).routes,
    ).toBeUndefined();
    // 受託の業務の画面（人ごと）でも選べる
    expect(
      strategies(start(VPS, 'nextjs', { app: 'server-island' }, contract)).app,
    ).toBe('server-island');
  });

  it('表の行: なぜ・ほかの描き方の注（出典か仮定か）', () => {
    const rows = routePlanOf(start(VERCEL_PRO, 'astro', ISLAND));
    const p = rows.find((r) => r.route === 'personal')!;
    expect(p.code).toBe('S6');
    expect(p.why).toContain('島');
    expect(p.overriddenBy).toContain('選んだ描き方');
    // Vercel の Astro の S6 は仮（Vercel のアダプターの頁は機能の一つとして触れるだけ）
    const cf = routePlanOf(start(CF_PAID, 'astro'))
      .find((r) => r.route === 'personal')!
      .alternatives.find((a) => a.strategy === 'server-island')!;
    expect(cf).toMatchObject({ available: true, basis: 'source' });
    const vercel = routePlanOf(start(VERCEL_PRO, 'astro'))
      .find((r) => r.route === 'personal')!
      .alternatives.find((a) => a.strategy === 'server-island')!;
    expect(vercel).toMatchObject({ available: true, basis: 'assumption' });
  });
});

describe('Workload と構成（D-108）', () => {
  it('Astro: 個人向けのページは 1 日の期限でキャッシュする枠 + 閲覧ごとの島のリクエスト（SSR の 4 割）', () => {
    const w = workload(CF_PAID, 'astro', ISLAND);
    const p = w.routes.find((r) => r.id === 'personal')!;
    expect(p.rendering).toBe('isr');
    expect(p.revalidateSeconds).toBe(SERVER_ISLAND.shellRevalidateSeconds);
    expect(p.island?.request?.cpuMs).toBeCloseTo(15 * 0.4);
    expect(p.processing.cpuMs).toBeCloseTo(15 * 0.6);
    // 記事はそのまま（オンデマンドの設定に引きずられない）
    expect(w.routes.find((r) => r.id === 'article')).toEqual(
      workload(CF_PAID, 'astro').routes.find((r) => r.id === 'article'),
    );
    const r = resolveWorkload(w);
    const views = 100_000 * p.share;
    // 島のリクエストは閲覧ごと（document-ssr）・枠は ISR の経路の閲覧
    expect(r.classes['document-ssr'].count).toBeCloseTo(views, 6);
    expect(r.sources['document-ssr']!.every((s) => s.island === true)).toBe(
      true,
    );
    expect(
      r.sources['document-isr']!.find((s) => s.routeId === 'personal')!.count,
    ).toBeCloseTo(views, 6);
  });

  it('Next.js の PPR: 毎回描く（ssr）のまま CPU を島の分に（閲覧ごとに処理を通す。枠を CDN から配ることは仮定しない）', () => {
    // Vercel × Next.js の既定は部品ごとにキャッシュ（D-111）なので、比べる前は毎回描くを選ぶ
    const before = workload(VERCEL_PRO, 'nextjs', { personal: 'ssr' })
      .routes[1]!;
    const after = workload(VERCEL_PRO, 'nextjs', ISLAND).routes[1]!;
    expect(after.rendering).toBe('ssr');
    expect(after.island).toEqual({});
    expect(after.processing.cpuMs).toBeCloseTo(
      before.processing.cpuMs * SERVER_ISLAND.islandShare,
    );
    expect(after.processing.ioWaitMs).toBe(before.processing.ioWaitMs);
  });

  it('Astro × Cloudflare で記事をキャッシュしなくても、S6 の枠のために Workers Cache を前に置く', () => {
    const routes: RouteOverrides = {
      article: 'static-build',
      personal: 'server-island',
    };
    const routing = staticBuildOf(ARTICLE_COMMUNITY, CF_PAID, 'astro', routes);
    expect(routing).toEqual({ staticBuild: true });
    const arch = composeStack(
      STACK_DEFS[CF_PAID]!,
      {},
      {
        framework: 'astro',
        ...routing,
      },
    );
    expect(arch.nodes.find((n) => n.id === 'worker')!.label).toContain(
      'Workers Cache',
    );
  });
});

describe('費用と制限（D-108）', () => {
  const m1 = (s: number, fw: FrameworkId, routes?: RouteOverrides) =>
    setupMonthOneEstimate(
      ARTICLE_COMMUNITY,
      s,
      fw,
      {},
      undefined,
      undefined,
      routes,
    );

  it('CF Free × Astro: 個人向けの SSR 15 ms は無くなるが、枠の描き直し（2 + 9 = 11 ms）が 10 ms を超える。島（6 ms）は当たらない', () => {
    const cpu = (routes?: RouteOverrides) =>
      m1(CF_FREE, 'astro', routes).blocking.find((b) =>
        b.id.includes('cpu-ms-per-request'),
      )!;
    expect(cpu().detail).toContain('個人向けのページ（SSR・CPU 15 ms）');
    const after = cpu(ISLAND);
    expect(after.detail).toContain(
      '個人向けのページ（島の枠の閲覧と描き直し・CPU 11 ms）',
    );
    expect(after.detail).not.toContain('サーバーの島');
    expect(after.routes).toContain('personal');
  });

  it('Vercel Pro × Next.js の PPR: 個人向けの CPU が減る分だけ安い（I/O 待ちは同じ）', () => {
    expect(m1(VERCEL_PRO, 'nextjs', ISLAND).costUsd).toBeLessThan(
      m1(VERCEL_PRO, 'nextjs', { personal: 'ssr' }).costUsd,
    );
  });

  it('表の行の CPU の判定は、そのページの当たったリクエストで出す（CF Free の S6 は枠）', () => {
    const st = routePlanStatus(ARTICLE_COMMUNITY, {
      framework: 'astro',
      stackIndex: CF_FREE,
      components: {},
      routes: ISLAND,
    });
    const p = st.find((r) => r.route === 'personal')!;
    expect(p.cpu.ok).toBe(false);
    expect(p.cpu.text).toContain('島の枠');
    // 人ごとに違うページには SNS のカードの判定を出さない
    expect(p.ogp).toBeUndefined();
  });
});

describe('途中の行動・保存（D-108）', () => {
  it('S4 → S6 の手間は 3（RS-08）で、翌月から効く。使えない組は理由つきで弾く', () => {
    const s = start(VERCEL_PRO, 'astro');
    expect(checkAction(s, route('personal', 'server-island'))).toMatchObject({
      ok: true,
      cost: 3,
    });
    const t = applyAction(s, route('personal', 'server-island'));
    expect(t.routes).toEqual(ISLAND);
    expect(strategies(playMonth(t)).personal).toBe('server-island');
    // S6 → S4 も 3
    expect(checkAction(playMonth(t), route('personal', 'ssr'))).toMatchObject({
      ok: true,
      cost: 3,
    });
    const vinext = checkAction(
      start(CF_PAID, 'nextjs'),
      route('personal', 'server-island'),
    );
    expect(vinext.ok).toBe(false);
  });

  it('S6 で始めた保存と途中の行動を再生して、同じ状態に戻る', () => {
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VPS,
      framework: 'astro',
      seed: 7,
      startDate: DEFAULT_START_DATE,
      routes: ISLAND,
    });
    save = withTurn(save, []);
    save = withTurn(save, [route('personal', 'ssr')]);
    save = withTurn(save, [route('personal', 'server-island')]);
    const parsed = parseSave(JSON.parse(JSON.stringify(save)))!;
    const s = replaySave(parsed);
    expect(strategies(s).personal).toBe('server-island');
    expect(s).toEqual(replaySave(save));
  });
});

describe('見取り図（D-108）', () => {
  it('人ごとに違う区画は「サーバーの島」、ほかの HTML の区画は枠。札は島の分だけ描く', () => {
    for (const fw of ['astro', 'nextjs'] as const) {
      const page = pageWireframes(
        ARTICLE_COMMUNITY,
        fw,
        undefined,
        ISLAND,
      ).find((p) => p.route === 'personal')!;
      const src = Object.fromEntries(page.regions.map((r) => [r.id, r.source]));
      expect(src).toEqual({
        header: 'island-shell',
        profile: 'server-island',
        notifications: 'server-island',
        mine: 'server-island',
        editor: 'island-shell',
      });
      expect(page.badges[0]!.text).toContain('島の分だけ');
    }
    // 記事のページは変わらない
    expect(
      pageWireframes(ARTICLE_COMMUNITY, 'astro', undefined, ISLAND)[0],
    ).toEqual(pageWireframes(ARTICLE_COMMUNITY, 'astro')[0]);
    const app = pageWireframes(contract, 'nextjs', undefined, {
      app: 'server-island',
    })[0]!;
    expect(
      app.regions.filter((r) => r.source === 'server-island').map((r) => r.id),
    ).toEqual(['header', 'table']);
  });
});
