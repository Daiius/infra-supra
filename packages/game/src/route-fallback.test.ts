// 構成・フレームワークを替える前に、既定に戻るページの描き方を見せる（D-107 の補足）。
// 予測（routeFallbacks）が、乗り換え・プラン変更・作り直しの後に実際に起きることと一致するかを、
// 始める画面で選べる構成 × フレームワーク × 選んだ描き方の組の全部で確かめる。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  ARTICLE_COMMUNITY,
  checkAction,
  defaultRevalidateSec,
  DEFAULT_START_DATE,
  frameworksOf,
  isPlanChange,
  newGame,
  playMonth,
  rewriteRouteFallbacks,
  rewriteRouteNotice,
  rewriteText,
  routePlanOf,
  SCENARIOS,
  setupRevalidateOptions,
  setupRouteFallbacks,
  setupRouteNotice,
  stackChangeRouteFallbacks,
  stackChangeRouteNotice,
  stackOffered,
  STACKS,
  strategyFamily,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
  type Scenario,
  type SetupRouteState,
} from './index.ts';
import type { RouteStrategyId } from 'catalog';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const CF_PAID = stack('cloudflare-vinext-paid');
const VERCEL_PRO = stack('vercel-supabase-pro');
const ARTICLE = ARTICLE_COMMUNITY;

const CANDIDATES: (RouteStrategyId | undefined)[] = [
  undefined,
  'static-build',
  'cached-ttl',
  'ssr',
  'shell-api',
];

/** ルートごとに描き方を選んだ組の全部（選ばないを含む）。 */
function overrideSets(sc: Scenario): RouteOverrides[] {
  let out: RouteOverrides[] = [{}];
  for (const r of sc.template(1).routes)
    out = out.flatMap((o) =>
      CANDIDATES.map((c) => (c === undefined ? o : { ...o, [r.id]: c })),
    );
  return out;
}

const start = (
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
  routes?: RouteOverrides,
) =>
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

const planOf = (s: GameState) =>
  Object.fromEntries(routePlanOf(s).map((r) => [r.route, r.strategy]));

/** 替える前後の状態から、実際に既定に戻ったページ（選んだ描き方が消え、分け方が変わった）。 */
function actualFallbacks(before: GameState, after: GameState) {
  const a = planOf(before);
  const b = planOf(after);
  return Object.keys(before.routes ?? {})
    .filter(
      (r) =>
        after.routes?.[r] === undefined &&
        strategyFamily(a[r]!) !== strategyFamily(b[r]!),
    )
    .map((route) => ({ route, from: a[route], to: b[route] }));
}

const brief = (xs: { route: string; from: string; to: string }[]) =>
  xs.map(({ route, from, to }) => ({ route, from, to }));

/** 始め方の組（選んだ描き方がそのまま残る始め方だけ。同じ状態になる組は 1 つにまとめる）。 */
function starts(sc: Scenario, fw: FrameworkId): GameState[] {
  const seen = new Set<string>();
  const out: GameState[] = [];
  for (const s of STACKS.filter((x) => stackOffered(x.index, fw)))
    for (const o of overrideSets(sc)) {
      const g = start(sc, s.index, fw, o);
      const key = `${s.index}:${JSON.stringify(g.routes ?? {})}`;
      if (seen.has(key) || g.routes === undefined) continue;
      seen.add(key);
      out.push(g);
    }
  return out;
}

describe('乗り換え・プラン変更で既定に戻る描き方の予測（D-107 の補足）', () => {
  for (const sc of Object.values(SCENARIOS))
    for (const fw of frameworksOf(sc).allowed)
      it(`${sc.id} × ${fw}: 予測が乗り換えの後と一致する`, () => {
        let found = 0;
        for (const s0 of starts(sc, fw))
          for (const dst of STACKS.filter(
            (x) => x.index !== s0.stackIndex && stackOffered(x.index, fw),
          )) {
            const plan = isPlanChange(s0.stackIndex, dst.index);
            const action = {
              type: plan ? ('plan' as const) : ('migrate' as const),
              stackIndex: dst.index,
            };
            if (!checkAction(s0, action).ok) continue;
            const predicted = stackChangeRouteFallbacks(s0, dst.index);
            // 乗り換えは手間を入れ終えた月の翌月に切り替わる（済んだ状態から 1 か月進める）
            const s1 = plan
              ? playMonth(applyAction(s0, action))
              : playMonth({
                  ...s0,
                  migration: {
                    from: s0.stackIndex,
                    to: dst.index,
                    required: 1,
                    done: 1,
                  },
                });
            expect(s1.stackIndex).toBe(dst.index);
            expect(brief(predicted)).toEqual(actualFallbacks(s0, s1));
            // プラン変更は事業者が同じなので戻らない
            if (plan) expect(predicted).toEqual([]);
            found += predicted.length;
          }
        // vinext の S1 を出した（RS-15 の解除）ので、今のデータでは乗り換えで戻る組は無い。予測と実際が一致することだけを見る
        expect(found).toBeGreaterThanOrEqual(0);
      });

  it('Vercel の Next.js の記事 S1 → CF（vinext）は S1 のまま（vinext の S1 を出した。RS-15 の解除）', () => {
    const s0 = start(ARTICLE, VERCEL_PRO, 'nextjs', {
      article: 'static-build',
      personal: 'shell-api',
    });
    expect(stackChangeRouteNotice(s0, CF_PAID)).toBeNull();
    expect(stackChangeRouteFallbacks(s0, CF_PAID)).toEqual([]);
  });

  it('乗り換え・プラン変更の手間は描き方を選んでいても変わらない', () => {
    for (const fw of frameworksOf(ARTICLE).allowed)
      for (const s0 of starts(ARTICLE, fw)) {
        const plain = start(ARTICLE, s0.stackIndex, fw);
        for (const dst of STACKS.filter((x) => x.index !== s0.stackIndex)) {
          const action = {
            type: isPlanChange(s0.stackIndex, dst.index)
              ? ('plan' as const)
              : ('migrate' as const),
            stackIndex: dst.index,
          };
          expect(checkAction(s0, action)).toEqual(checkAction(plain, action));
        }
        for (const to of frameworksOf(ARTICLE).allowed) {
          expect(checkAction(s0, { type: 'rewrite', framework: to })).toEqual(
            checkAction(plain, { type: 'rewrite', framework: to }),
          );
          if (to !== fw)
            expect(rewriteText(s0, to).meta).toEqual(
              rewriteText(plain, to).meta,
            );
        }
      }
  });
});

describe('作り直しで既定に戻る描き方の予測（D-107 の補足）', () => {
  for (const sc of Object.values(SCENARIOS))
    for (const fw of frameworksOf(sc).allowed)
      it(`${sc.id} × ${fw}: 予測が作り直しの後と一致する`, () => {
        for (const s0 of starts(sc, fw))
          for (const to of frameworksOf(sc).allowed) {
            if (to === fw) continue;
            if (!checkAction(s0, { type: 'rewrite', framework: to }).ok)
              continue;
            const predicted = rewriteRouteFallbacks(s0, to);
            const s1 = playMonth({
              ...s0,
              rewrite: { from: fw, to, required: 1, done: 1 },
            });
            expect(s1.framework).toBe(to);
            expect(s1.routes).toBeUndefined();
            expect(brief(predicted)).toEqual(actualFallbacks(s0, s1));
          }
      });

  it('作り直しは使える描き方も既定に戻す。新しいフレームワークの既定と同じなら出さない', () => {
    const s0 = start(ARTICLE, VERCEL_PRO, 'nextjs', {
      article: 'static-build',
      personal: 'shell-api',
    });
    expect(rewriteRouteNotice(s0, 'astro')).toBe(
      '作り直すと、記事のページは「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（時間で取り直す）」（既定）・個人向けのページは「枠 + ブラウザが API で取る」→「毎回描く」（既定）に戻ります: 済んだ翌月から、描き方は新しいフレームワークの既定で始まります（選び直すには手間がかかります）',
    );
    // 静的書き出しの既定は記事 S1・個人向け S5 で、選んだものと同じ
    expect(rewriteRouteNotice(s0, 'nextjs-export')).toBeNull();
    // 描き方を選んでいなければ出さない
    expect(
      rewriteRouteNotice(start(ARTICLE, VERCEL_PRO, 'nextjs'), 'astro'),
    ).toBeNull();
  });
});

describe('始める画面のカードの注意（D-107 の補足）', () => {
  const cur = {
    stackIndex: VERCEL_PRO,
    framework: 'nextjs' as const,
    components: {},
    revalidateSec: 300,
    comments: 0,
    routes: { article: 'static-build', personal: 'shell-api' } as const,
  };

  it('構成を替えても、その構成で選べる描き方は戻らない（vinext の S1 も選べる。RS-15 の解除）', () => {
    expect(setupRouteNotice(ARTICLE, cur, { stackIndex: CF_PAID })).toBeNull();
    expect(
      setupRouteNotice(ARTICLE, cur, { stackIndex: stack('sakura-vps-2gb') }),
    ).toBeNull();
  });

  it('フレームワークを替えると、選んだ描き方は既定に戻る', () => {
    expect(setupRouteNotice(ARTICLE, cur, { framework: 'astro' })).toBe(
      'このフレームワークにすると、記事のページは「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（更新で消す）」（既定）・個人向けのページは「枠 + ブラウザが API で取る」→「毎回描く」（既定）に戻ります: フレームワークを替えると、描き方はそのフレームワークの既定から選び直しになります',
    );
    expect(
      setupRouteNotice(
        ARTICLE,
        { ...cur, routes: undefined },
        {
          framework: 'astro',
        },
      ),
    ).toBeNull();
  });

  // 始める画面の動き（App.tsx の Briefing と同じ規則）: フレームワークを替えると描き方は既定、
  // 選んだ再検証は替えた先で選べれば残し、それ以外は既定
  const revalidateOn = (
    st: number,
    fw: FrameworkId,
    routes: RouteOverrides | undefined,
    chosen: number | undefined,
  ) =>
    chosen !== undefined &&
    setupRevalidateOptions(ARTICLE, fw, routes).some((o) => o.value === chosen)
      ? chosen
      : defaultRevalidateSec(fw, st, ARTICLE, routes);
  const setupStart = (
    st: number,
    fw: FrameworkId,
    routes: RouteOverrides | undefined,
    chosen: number | undefined,
  ) =>
    newGame(
      st,
      42,
      ARTICLE,
      DEFAULT_START_DATE,
      fw,
      {},
      revalidateOn(st, fw, routes, chosen),
      undefined,
      undefined,
      routes,
    );

  it('選んだ再検証が替えた先でも選べれば残る（Vercel の Next.js の記事 S1・ビルドの間隔 5 分 → Astro は S2。OCL-0ABECA36）', () => {
    const chosen = { ...cur, revalidateChosen: 300 };
    expect(setupRouteNotice(ARTICLE, chosen, { framework: 'astro' })).toMatch(
      /^このフレームワークにすると、記事のページは「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（時間で取り直す）」（既定）/,
    );
    const after = setupStart(VERCEL_PRO, 'astro', undefined, 300);
    expect(planOf(after).article).toBe('cached-ttl');
  });

  it('予測が始める画面で替えた後と一致する（選べる構成 × フレームワーク × 描き方 × 選んだ再検証）', () => {
    let found = 0;
    for (const fw of frameworksOf(ARTICLE).allowed)
      for (const g of starts(ARTICLE, fw)) {
        const st = g.stackIndex;
        const routes = g.routes;
        const chosens = [
          undefined,
          ...setupRevalidateOptions(ARTICLE, fw, routes).map((o) => o.value),
        ];
        const nexts: { framework?: FrameworkId; stackIndex?: number }[] = [
          ...frameworksOf(ARTICLE)
            .allowed.filter((f) => f !== fw && stackOffered(st, f))
            .map((f) => ({ framework: f })),
          ...STACKS.filter(
            (x) => x.index !== st && stackOffered(x.index, fw),
          ).map((x) => ({ stackIndex: x.index })),
        ];
        for (const chosen of chosens) {
          const before = setupStart(st, fw, routes, chosen);
          const state: SetupRouteState = {
            stackIndex: st,
            framework: fw,
            components: {},
            revalidateSec: before.settings.revalidateSec,
            revalidateChosen: chosen,
            routes,
          };
          for (const next of nexts) {
            const fw2 = next.framework ?? fw;
            const st2 = next.stackIndex ?? st;
            const after = setupStart(
              st2,
              fw2,
              fw2 === fw ? routes : undefined,
              chosen,
            );
            const predicted = setupRouteFallbacks(ARTICLE, state, next);
            expect(brief(predicted)).toEqual(actualFallbacks(before, after));
            found += predicted.length;
          }
        }
      }
    expect(found).toBeGreaterThan(0);
  });
});
