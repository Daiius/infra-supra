// ページの描き方（D-106〜D-109）: 描き方の系統・公開のページ・記事の描き方・選べる描き方と、上書きの検証。
import {
  apiCacheActive,
  type Choices,
  DEFAULT_CHOICES,
  defaultStrategy,
  FRAMEWORK_PRESETS,
  type FrameworkId,
  perPageShellFramework,
  type Platform,
  ROUTE_STRATEGIES,
  routeAudience,
  type RouteAudience,
  type RoutePlan,
  type RouteStrategyId,
  strategySupport,
} from 'catalog';
import type { Scenario } from '../scenario.ts';
import type { WorkloadInput } from 'estimator';
import { EFFORT } from '../rules.ts';
import { isOnDemand, type Settings } from '../settings.ts';
import { STACKS } from '../stacks.ts';
import type { RouteOverrides, StrategyFamily } from '../state.ts';

export function strategyFamily(s: RouteStrategyId): StrategyFamily {
  switch (s) {
    case 'static-build':
      return 'static';
    case 'cached-ttl':
    case 'cached-purge':
      return 'cached';
    case 'ssr':
      return 'ssr';
    case 'shell-api':
      return 'api';
    case 'server-island':
      return 'island';
  }
}

/** シナリオのルートの見る人（テンプレートのルートの性質。D-107）。 */
export function routeAudienceOf(
  sc: Pick<Scenario, 'routeTraits'>,
  r: { id: string; rendering: WorkloadInput['routes'][number]['rendering'] },
): RouteAudience {
  return routeAudience(r, sc.routeTraits);
}

/** 全員に同じ中身のルート（記事のページ）。無いシナリオ（受託）は undefined。 */
export function publicRoute(sc: Pick<Scenario, 'template' | 'routeTraits'>) {
  return sc.template(1).routes.find((r) => routeAudienceOf(sc, r) === 'public');
}

/** 全員に同じ中身のルート（記事のページ）の id。無いシナリオ（受託）は undefined。 */
export function publicRouteId(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
): string | undefined {
  return publicRoute(sc)?.id;
}

/** ルートの今の描き方の分け方（選んだ描き方があればそれ、無ければフレームワークの既定）。 */
export function routeFamily(
  state: {
    scenario: Pick<Scenario, 'template' | 'routeTraits'>;
    framework: FrameworkId;
    routes?: RouteOverrides | undefined;
  },
  routeId: string,
): StrategyFamily | undefined {
  const r = state.scenario.template(1).routes.find((x) => x.id === routeId);
  if (!r) return undefined;
  const chosen = state.routes?.[routeId];
  return strategyFamily(
    chosen ??
      FRAMEWORK_PRESETS[state.framework][routeAudienceOf(state.scenario, r)],
  );
}

/**
 * 記事のページ（全員に同じ中身）の描き方の分け方。設定の意味（再検証・ビルドの間隔・API のキャッシュの期間）・
 * 鮮度の判定・SNS のカード・コメントの描き方がこれで決まる（D-107）。記事のページが無いシナリオは undefined
 * （フレームワークで決める今までの判定のまま）。
 */
export function articleFamily(state: {
  scenario: Pick<Scenario, 'template' | 'routeTraits'>;
  framework: FrameworkId;
  routes?: RouteOverrides | undefined;
}): StrategyFamily | undefined {
  const r = publicRoute(state.scenario);
  return r ? routeFamily(state, r.id) : undefined;
}

/**
 * ルートごとの描き方（D-106・段 2）。今はプレイヤーが直接選ばず、フレームワークの既定（catalog の FRAMEWORK_PRESETS を
 * 事業者の対応表で落としたもの）と、今の設定・部品から決まる:
 * - 全員に同じ中身のルートがキャッシュの描き方なら、再検証・記事のキャッシュが「オンデマンド」で S3、時間で S2。
 *   Next.js で ISR のキャッシュの部品が「キャッシュしない」なら S4（applyComponentsToWorkload の書き換えと同じ）。
 * - S5 は、SPA の API の応答のキャッシュが効くとき（D-37）だけ、全員に同じ中身の API の応答をキャッシュする。
 * workloadFor はこれを applyRouteStrategies に当てる（今までの toSpa・toAstro・toNextExport と同じ Workload。等価のテストで確かめる）。
 */
export function routeChoices(
  sc: Pick<Scenario, 'routeTraits'>,
  routes: WorkloadInput['routes'],
  p: {
    framework: FrameworkId;
    platform: Platform;
    settings: Pick<Settings, 'revalidateSec'>;
    components: Choices;
    /** 選んだ描き方（D-107）。この事業者・フレームワークで使えないものは既定に戻す。 */
    routes?: RouteOverrides | undefined;
  },
): RoutePlan {
  const c = { ...DEFAULT_CHOICES[p.platform], ...p.components };
  const cacheContent = apiCacheActive(p.platform, p.components, p.framework);
  return Object.fromEntries(
    routes.map((r) => {
      const audience = routeAudience(r, sc.routeTraits);
      const chosen = p.routes?.[r.id];
      let strategy =
        chosen !== undefined &&
        strategySelectable(p.framework, p.platform, audience, chosen)
          ? chosen
          : defaultStrategy(p.framework, p.platform, audience);
      if (strategy === 'cached-ttl' || strategy === 'cached-purge')
        strategy =
          p.framework === 'nextjs' && c.isrCache === 'none'
            ? 'ssr'
            : isOnDemand(p.settings)
              ? 'cached-purge'
              : 'cached-ttl';
      // 全員に同じ中身のページの S5 は、ページごとの枠を書き出せるフレームワークなら記事ごとの枠にする（D-109）
      const perPage =
        strategy === 'shell-api' &&
        audience === 'public' &&
        shellPerPage(p.framework, p.platform);
      return [
        r.id,
        {
          strategy,
          // 個人化した中身の応答はキャッシュしない（D-37）
          ...(strategy === 'shell-api' && cacheContent && audience === 'public'
            ? { cacheContent: true }
            : {}),
          ...(perPage ? { shellPerPage: true } : {}),
        },
      ];
    }),
  );
}

/** 記事ごとの枠（S5）の説明（表の選択肢の文。D-109）。 */
export const SHELL_PER_PAGE_NOTE =
  'このフレームワークでは記事ごとの枠（メタタグ入り）をビルドで書き出し、SNS のカードは枠に入る。新しい記事は枠のビルドが終わるまで開けない';

/** 記事ごとの枠（S5）の「なぜ」（D-109）。 */
export const SHELL_PER_PAGE_WHY =
  '記事ごとの枠（タイトル・メタタグ）をビルドで書き出し、本文はブラウザが API で取る。サーバーは HTML を描かず、SNS のカードは枠に入る。新しい記事・編集のたびに枠をビルドし直し、新しい記事はビルドが終わるまで開けない';

/**
 * 全員に同じ中身のページ（記事）の S5 を、記事ごとの枠にするか（D-109・ゲーム上の読み 1 つ。D-10）。ページごとの HTML を書き出せる
 * フレームワーク（Next.js・Astro・静的書き出し）で、その事業者で S1（静的に書き出す）を選べるときは、記事ごとに書き出す枠
 * （メタタグ入り。SNS のカードが出る）+ ブラウザが API で中身を取る形が標準の作り方とみなす。枠は S1 と同じくビルドで作り、
 * 新しい記事・編集のたびにビルドし直す（新しい記事はビルドまで開けない。D-104）。Vite の SPA は 1 つのシェルのまま。
 */
export function shellPerPage(
  framework: FrameworkId,
  platform: Platform,
): boolean {
  return (
    perPageShellFramework(framework) &&
    strategySelectable(framework, platform, 'public', 'static-build')
  );
}

/** ゲームの状態・始める画面の選択で、記事のページが記事ごとの枠（S5）か（D-109）。 */
export function articleShellPerPage(state: {
  scenario: Pick<Scenario, 'template' | 'routeTraits'>;
  framework: FrameworkId;
  stackIndex: number;
  routes?: RouteOverrides | undefined;
}): boolean {
  return (
    articleFamily(state) === 'api' &&
    shellPerPage(state.framework, STACKS[state.stackIndex]!.provider)
  );
}

/**
 * 描き方をその事業者・フレームワーク・見る人で選べるか（D-107）。対応表で使える（部品で決まるものを含む）・数え方がある。
 * 確かめていない描き方（Next.js × Netlify・OpenNext の S6）は選べない（RS-04・RS-18）。S6 は人ごとに違うページだけ（D-108）。
 */
export function strategySelectable(
  framework: FrameworkId,
  platform: Platform,
  audience: RouteAudience,
  strategy: RouteStrategyId,
): boolean {
  const x = strategySupport(framework, platform, audience, strategy);
  return (
    ROUTE_STRATEGIES[strategy].modeled &&
    (x.support === 'yes' || x.support === 'depends')
  );
}

/**
 * 選んだ描き方を足した選択（D-107）。フレームワークの既定と分け方が同じなら持たない（S2 と S3 は設定で替える）。
 */
export function withRouteChoice(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  framework: FrameworkId,
  routes: RouteOverrides | undefined,
  routeId: string,
  strategy: RouteStrategyId,
): RouteOverrides {
  const r = sc.template(1).routes.find((x) => x.id === routeId);
  const out: Partial<Record<string, RouteStrategyId>> = { ...routes };
  if (!r) return out;
  const preset = FRAMEWORK_PRESETS[framework][routeAudienceOf(sc, r)];
  if (strategyFamily(preset) === strategyFamily(strategy)) delete out[routeId];
  else
    out[routeId] =
      strategyFamily(strategy) === 'cached' ? 'cached-ttl' : strategy;
  return out;
}

/**
 * 選んだ描き方のうち、その事業者・フレームワークで選べるものだけを残す（乗り換え・作り直しの後。D-107）。
 */
export function validRouteOverrides(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  stackIndex: number,
  framework: FrameworkId,
  routes: RouteOverrides | undefined,
): RouteOverrides {
  const platform = STACKS[stackIndex]!.provider;
  let out: RouteOverrides = {};
  for (const r of sc.template(1).routes) {
    const want = routes?.[r.id];
    if (
      want !== undefined &&
      strategySelectable(framework, platform, routeAudienceOf(sc, r), want)
    )
      out = withRouteChoice(sc, framework, out, r.id, want);
  }
  return out;
}

/** 今の描き方から別の描き方へ替える手間（ゲーム上の仮定・RS-08・D-107）。S2 ↔ S3 は設定（onDemandSwitch）で替える。 */
export function routeChangeEffort(
  from: RouteStrategyId,
  to: RouteStrategyId,
): number {
  const f = strategyFamily(from);
  const t = strategyFamily(to);
  if (f === t) return 0;
  // ページを枠と API に分ける（Client Component・アイランドと API を書く）。SSR の最適化と同じ大きさ
  if (t === 'api') return EFFORT.route.toApi;
  // キャッシュのヘッダ・消す処理・prerender（generateStaticParams）の切り替え。
  // サーバーの島（S6）も 3: 人ごとに違う部品に server:defer（Astro）・Suspense（Next.js の PPR）を付け、API は書かない（D-108）
  return EFFORT.route.other;
}
