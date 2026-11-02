// 構成・フレームワークを替える前に、既定に戻るページの描き方を見せる（D-107 の補足）。
// 予測（routeFallbacks）が、乗り換え・プラン変更・作り直しの後に実際に起きることと一致するかを、
// 始める画面で選べる構成 × フレームワーク × 選んだ描き方の組の全部で確かめる。
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });
import {
  applyAction,
  ARTICLE_COMMUNITY,
  checkAction,
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
        // 記事の Next.js は、Vercel などの S1 が CF（vinext）で戻る組がある
        if (sc === ARTICLE && fw === 'nextjs') expect(found).toBeGreaterThan(0);
      });

  it('戻る組がある（Vercel の Next.js の記事 S1 → CF は vinext で確かめていない）', () => {
    const s0 = start(ARTICLE, VERCEL_PRO, 'nextjs', {
      article: 'static-build',
      personal: 'shell-api',
    });
    expect(stackChangeRouteNotice(s0, CF_PAID)).toBe(
      '乗り換えると、記事のページは S1 → S2（既定）に戻る: vinext のビルドのときの事前描画（静的な HTML）は確かめていない（RS-15）',
    );
    // 選べるもの（個人向けの S5）は残る
    expect(stackChangeRouteFallbacks(s0, CF_PAID).map((f) => f.route)).toEqual([
      'article',
    ]);
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
      '作り直すと、記事のページは S1 → S2（既定）・個人向けのページは S5 → S4（既定）に戻る: 済んだ翌月から、描き方は新しいフレームワークの既定で始まる（選び直すには手間がかかる）',
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

  it('構成を替えると、その構成で選べない描き方だけが戻る', () => {
    expect(setupRouteNotice(ARTICLE, cur, { stackIndex: CF_PAID })).toBe(
      'この構成にすると、記事のページは S1 → S2（既定）に戻る: vinext のビルドのときの事前描画（静的な HTML）は確かめていない（RS-15）',
    );
    expect(
      setupRouteNotice(ARTICLE, cur, { stackIndex: stack('sakura-vps-2gb') }),
    ).toBeNull();
  });

  it('フレームワークを替えると、選んだ描き方は既定に戻る', () => {
    expect(setupRouteNotice(ARTICLE, cur, { framework: 'astro' })).toBe(
      'このフレームワークにすると、記事のページは S1 → S3（既定）・個人向けのページは S5 → S4（既定）に戻る: フレームワークを替えると、描き方はそのフレームワークの既定から選び直しになる',
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
});
