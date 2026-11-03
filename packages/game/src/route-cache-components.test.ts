// 部品ごとにキャッシュ（Next.js 16 の Cache Components。D-111・prd/13 §5e）: Vercel × Next.js の既定・選べる組・Workload・
// 見取り図・途中の変更の手間・古い保存（版 3 まで）を今までの既定で同じ結果に再生すること。
import { describe, expect, it } from 'vitest';
import { CACHE_COMPONENTS } from 'catalog';
import {
  applyAction,
  applyActions,
  ARTICLE_COMMUNITY,
  checkAction,
  DEFAULT_START_DATE,
  newGame,
  newSave,
  pageWireframes,
  parseSave,
  playMonth,
  replaySave,
  resolvedRouteStrategies,
  routeAlternativeAction,
  routePlanOf,
  SCENARIOS,
  setupMonthOneEstimate,
  STACKS,
  withTurn,
  workloadFor,
  type Action,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
} from './index.ts';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const CF_PAID = stack('cloudflare-vinext-paid');
const VERCEL_PRO = stack('vercel-supabase-pro');
const VPS = stack('sakura-vps-2gb');
const GCP = stack('gcp-cloud-run');
const AMPLIFY = stack('aws-amplify');
const contract = Object.values(SCENARIOS).find((x) => x !== ARTICLE_COMMUNITY)!;

const start = (
  stackIndex: number,
  fw: FrameworkId = 'nextjs',
  routes?: RouteOverrides,
  components?: Record<string, string>,
  legacy?: boolean,
): GameState =>
  newGame(
    stackIndex,
    42,
    ARTICLE_COMMUNITY,
    DEFAULT_START_DATE,
    fw,
    components,
    undefined,
    undefined,
    undefined,
    routes,
    legacy,
  );
const strategies = (s: GameState) =>
  Object.fromEntries(routePlanOf(s).map((r) => [r.route, r.strategy]));
const route = (
  r: string,
  strategy: Extract<Action, { type: 'route' }>['strategy'],
): Action => ({ type: 'route', route: r, strategy });

describe('既定と選べる組（D-111）', () => {
  it('Vercel × Next.js の既定は部品ごとにキャッシュ（記事・個人向けとも）。VPS・Google Cloud は選べるが既定は今までのまま', () => {
    expect(strategies(start(VERCEL_PRO))).toEqual({
      article: 'cache-components',
      personal: 'cache-components',
    });
    for (const s of [VPS, GCP]) {
      expect(strategies(start(s)).personal).toBe('ssr');
      const alt = routePlanOf(start(s))
        .find((r) => r.route === 'personal')!
        .alternatives.find((a) => a.strategy === 'cache-components')!;
      expect(alt.available).toBe(true);
    }
    // vinext・Amplify は使えない（灰色の理由つき）
    for (const s of [CF_PAID, AMPLIFY]) {
      const alt = routePlanOf(start(s))
        .find((r) => r.route === 'personal')!
        .alternatives.find((a) => a.strategy === 'cache-components')!;
      expect(alt.available).toBe(false);
      expect(alt.reason).not.toBe('');
    }
    // 受託の業務の画面も Vercel × Next.js は部品ごとにキャッシュ
    const c = newGame(VERCEL_PRO, 42, contract, DEFAULT_START_DATE, 'nextjs');
    expect(strategies(c)).toEqual({ app: 'cache-components' });
  });

  it('ISR のキャッシュの部品が「キャッシュしない」なら毎回描く（今までの既定と同じ書き換え）', () => {
    expect(
      strategies(start(VERCEL_PRO, 'nextjs', undefined, { isrCache: 'none' })),
    ).toEqual({
      article: 'ssr',
      personal: 'ssr',
    });
  });

  it('Vercel で ISR を選ぶと選んだ描き方として残り、ISR が既定の VPS へ乗り換えると既定に溶ける', () => {
    let s = applyAction(start(VERCEL_PRO), route('article', 'cached-ttl'));
    expect(s.routes).toEqual({ article: 'cached-ttl' });
    s = playMonth(s);
    expect(strategies(s).article).toBe('cached-ttl');
    s = applyAction(s, { type: 'migrate', stackIndex: VPS });
    while (s.stackIndex !== VPS && s.phase === 'playing') s = playMonth(s);
    expect(s.routes).toBeUndefined();
    expect(strategies(s)).toEqual({ article: 'cached-ttl', personal: 'ssr' });
  });

  it('途中の変更の手間は 3（RS-08）', () => {
    expect(
      checkAction(start(VPS), route('personal', 'cache-components')),
    ).toMatchObject({
      ok: true,
      cost: 3,
    });
    expect(
      checkAction(start(VERCEL_PRO), route('personal', 'ssr')),
    ).toMatchObject({
      ok: true,
      cost: 3,
    });
  });
});

describe('数え方（D-111）', () => {
  const w = (stackIndex: number, routes?: RouteOverrides) =>
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
      framework: 'nextjs',
      ...(routes ? { routes } : {}),
    });

  it('記事は ISR と同じ数え方、個人向けは穴の分の CPU と問い合わせ（同じ応答の中の島）', () => {
    const cc = w(VERCEL_PRO);
    const isr = w(VERCEL_PRO, { article: 'cached-ttl', personal: 'ssr' });
    expect(cc.routes[0]).toEqual(isr.routes[0]);
    const p = cc.routes[1]!;
    const q = isr.routes[1]!;
    expect(p.rendering).toBe('ssr');
    expect(p.island).toEqual({ label: '動的な穴' });
    expect(p.processing.cpuMs).toBeCloseTo(15 * CACHE_COMPONENTS.dynamicShare);
    expect(p.processing.queries).toBeCloseTo(
      q.processing.queries * (1 - CACHE_COMPONENTS.cachedQueryShare),
    );
    // VPS で選んでも同じ数え方（1 つの Node のプロセスでキャッシュを全員で共有する）
    expect(w(VPS, { personal: 'cache-components' }).routes[1]).toEqual(p);
  });

  it('Vercel Pro × Next.js: 1 か月目の費用は毎回描くより安く、枠 + サーバーの島（S6）より安い（DB の問い合わせも減る）', () => {
    const m1 = (routes?: RouteOverrides) =>
      setupMonthOneEstimate(
        ARTICLE_COMMUNITY,
        VERCEL_PRO,
        'nextjs',
        {},
        undefined,
        undefined,
        routes,
      ).costUsd;
    const cc = m1();
    // D-121（記事の閲覧の偏りで ISR の再生成が減る）で、1 か月目はどちらも月のクレジットに収まり同じ額になった
    expect(cc).toBeLessThanOrEqual(
      m1({ article: 'cached-ttl', personal: 'ssr' }),
    );
    expect(cc).toBeLessThanOrEqual(
      m1({ article: 'cached-ttl', personal: 'server-island' }),
    );
  });
});

describe('見取り図（D-111）', () => {
  const resolved = (
    stackIndex: number,
    components: Record<string, string> = {},
  ) =>
    resolvedRouteStrategies(ARTICLE_COMMUNITY, {
      framework: 'nextjs',
      stackIndex,
      components,
    });
  const sources = (stackIndex: number, components?: Record<string, string>) =>
    pageWireframes(
      ARTICLE_COMMUNITY,
      'nextjs',
      undefined,
      undefined,
      resolved(stackIndex, components),
    );

  it('Vercel の既定は、人ごとに違う区画を動的な穴、ほかの HTML をキャッシュした部品にする', () => {
    const pages = sources(VERCEL_PRO);
    const personal = pages.find((p) => p.route === 'personal')!;
    const src = Object.fromEntries(
      personal.regions.map((r) => [r.id, r.source]),
    );
    for (const id of ['profile', 'notifications', 'mine'])
      expect(src[id]).toBe('cc-dynamic');
    expect(Object.values(src)).toContain('cc-cached');
    const article = pages.find((p) => p.route === 'article')!;
    expect(article.regions.some((r) => r.source === 'cc-cached')).toBe(true);
    expect(article.regions.some((r) => r.source === 'cc-dynamic')).toBe(false);
    // 実際の描き方を渡さない・VPS は今までの図
    for (const pages of [
      pageWireframes(ARTICLE_COMMUNITY, 'nextjs'),
      sources(VPS),
    ])
      expect(
        pages.flatMap((x) => x.regions).some((r) => r.source === 'cc-cached'),
      ).toBe(false);
  });

  it('ISR のキャッシュが「キャッシュしない」なら、表・計算と同じく毎回描くで描く（OCL-CD192A98）', () => {
    const r = resolved(VERCEL_PRO, { isrCache: 'none' });
    expect(r).toEqual({ article: 'ssr', personal: 'ssr' });
    const regions = sources(VERCEL_PRO, { isrCache: 'none' }).flatMap(
      (x) => x.regions,
    );
    expect(
      regions.some(
        (x) => x.source === 'cc-cached' || x.source === 'cc-dynamic',
      ),
    ).toBe(false);
    // 記事の HTML の区画も毎回描く
    const article = sources(VERCEL_PRO, { isrCache: 'none' }).find(
      (p) => p.route === 'article',
    )!;
    expect(article.regions.some((x) => x.source === 'ssr')).toBe(true);
    expect(article.regions.some((x) => x.source === 'isr')).toBe(false);
  });
});

describe('タグで消せない構成（D-111・OCL-FC4A03B7）', () => {
  const ON_DEMAND = 0;
  const gcpOnDemand = () =>
    newGame(
      GCP,
      42,
      ARTICLE_COMMUNITY,
      DEFAULT_START_DATE,
      'nextjs',
      undefined,
      ON_DEMAND,
    );

  it('Google Cloud でオンデマンドなら、記事の部品ごとにキャッシュを選ぶと期限（5 分）に戻す', () => {
    const s = gcpOnDemand();
    expect(s.settings.revalidateSec).toBe(ON_DEMAND);
    const row = routePlanOf(s).find((r) => r.route === 'article')!;
    const alt = row.alternatives.find(
      (a) => a.strategy === 'cache-components',
    )!;
    expect(alt.available).toBe(true);
    expect(alt.value).toBe(300);
    expect(alt.reason).toContain('タグで消せない');
    const action = routeAlternativeAction(s, row, alt);
    const t = applyAction(s, action);
    expect(t.settings.revalidateSec).toBe(300);
    // Vercel（消せる）では値を替えない
    const v = newGame(
      VERCEL_PRO,
      42,
      ARTICLE_COMMUNITY,
      DEFAULT_START_DATE,
      'nextjs',
      undefined,
      ON_DEMAND,
      undefined,
      undefined,
      { article: 'cached-ttl' },
    );
    const valt = routePlanOf(v)
      .find((r) => r.route === 'article')!
      .alternatives.find((a) => a.strategy === 'cache-components')!;
    expect(valt.value).toBeUndefined();
  });

  it('部品ごとにキャッシュの記事を Google Cloud でオンデマンドにはできない（行動）', () => {
    const s = applyAction(
      newGame(
        GCP,
        42,
        ARTICLE_COMMUNITY,
        DEFAULT_START_DATE,
        'nextjs',
        undefined,
        undefined,
        undefined,
        undefined,
        { article: 'cache-components' },
      ),
      { type: 'set', key: 'isr', value: ON_DEMAND },
    );
    expect(
      checkAction(
        newGame(
          GCP,
          42,
          ARTICLE_COMMUNITY,
          DEFAULT_START_DATE,
          'nextjs',
          undefined,
          undefined,
          undefined,
          undefined,
          { article: 'cache-components' },
        ),
        { type: 'set', key: 'isr', value: ON_DEMAND },
      ),
    ).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(s.settings.revalidateSec).not.toBe(ON_DEMAND);
  });

  it('始める画面などで組み合わさっても、計算はタグを数えず保険の期限で作り直す（表と同じ判定）', () => {
    const w = (stackIndex: number) =>
      workloadFor(ARTICLE_COMMUNITY, {
        pv: 100_000,
        settings: {
          revalidateSec: ON_DEMAND,
          imageKB: 150,
          variants: 3,
          ssrOptimizations: 0,
        },
        ssrCpuMs: 15,
        mods: {},
        stock: null,
        platform: STACKS[stackIndex]!.provider,
        components: {},
        framework: 'nextjs',
        routes: { article: 'cache-components' },
      }).routes[0]!;
    const gcp = w(GCP);
    expect(gcp.onDemandUpdatesPerMonth).toBeUndefined();
    expect(gcp.revalidateSeconds).toBe(86_400);
    // Vercel はタグで消せるのでオンデマンドのまま
    expect(w(VERCEL_PRO).onDemandUpdatesPerMonth).toBeDefined();
  });
});

describe('古い保存（版 3 まで）は今までの既定で同じ結果に再生する（D-111）', () => {
  const turns: Action[][] = [[], [route('article', 'static-build')], [], []];

  it('Vercel × Next.js の版 3 の保存: 今までの既定（ISR・毎回描く）で再生し、保存し直しても変わらない', () => {
    const v3 = {
      version: 3,
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VERCEL_PRO,
      framework: 'nextjs',
      seed: 7,
      startDate: DEFAULT_START_DATE,
      turns,
    };
    const parsed = parseSave(v3)!;
    expect(parsed.version).toBe(4);
    expect(parsed.legacyRouteDefaults).toBe(true);
    const s = replaySave(parsed);
    expect(s.legacyRouteDefaults).toBe(true);
    expect(strategies(s)).toEqual({ article: 'static-build', personal: 'ssr' });
    // 版 3 のころの遊び（今までの既定）と同じ状態
    let played = playMonth(
      newGame(
        VERCEL_PRO,
        7,
        ARTICLE_COMMUNITY,
        DEFAULT_START_DATE,
        'nextjs',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    );
    for (const t of turns) played = playMonth(applyActions(played, t));
    expect(s).toEqual(played);
    // 新しい既定で始めたゲームとは費用が違う（既定が変わったことの確かめ）
    const fresh = replaySave(parseSave({ ...v3, version: 4 })!);
    expect(fresh.cash).not.toBe(s.cash);
    // 保存し直しても印が残る
    const again = parseSave(JSON.parse(JSON.stringify(withTurn(parsed, []))))!;
    expect(again.legacyRouteDefaults).toBe(true);
  });

  it('版 3 の保存で途中から Vercel へ乗り換えても、乗り換え先の既定は今までのまま', () => {
    const v3 = {
      version: 3,
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VPS,
      framework: 'nextjs',
      seed: 3,
      startDate: DEFAULT_START_DATE,
      turns: [[{ type: 'migrate', stackIndex: VERCEL_PRO }], [], [], []],
    };
    const s = replaySave(parseSave(v3)!);
    expect(s.stackIndex).toBe(VERCEL_PRO);
    expect(strategies(s)).toEqual({ article: 'cached-ttl', personal: 'ssr' });
    const fresh = replaySave(parseSave({ ...v3, version: 4 })!);
    expect(strategies(fresh)).toEqual({
      article: 'cache-components',
      personal: 'cache-components',
    });
  });

  it('新しい保存には印が無い', () => {
    const save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VERCEL_PRO,
      framework: 'nextjs',
      seed: 1,
      startDate: DEFAULT_START_DATE,
    });
    expect(
      parseSave(JSON.parse(JSON.stringify(save)))!.legacyRouteDefaults,
    ).toBeUndefined();
  });
});
