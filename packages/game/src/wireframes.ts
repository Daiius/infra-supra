// ページの見取り図（描き方ごとの領域の出どころ）。
import type {
  PageBadge,
  RegionSource,
  Scenario,
  WireframeRegion,
} from './scenario.ts';
import {
  defaultStrategy,
  FRAMEWORK_PRESETS,
  type FrameworkId,
  perPageShellFramework,
  type Platform,
  type RouteStrategyId,
} from 'catalog';
import { frameworksOf } from './core.ts';
import { commentsInPage } from './routes/comments.ts';
import { routeAudienceOf, strategyFamily } from './routes/strategy.ts';
import { COMMENTS_IN_BROWSER } from './settings.ts';
import type { RouteOverrides } from './state.ts';

/** サーバーが HTML の一部として作る区画の作られ方（S6 では枠になる。D-108）。 */
const HTML_SOURCES: readonly RegionSource[] = ['build', 'isr', 'cached', 'ssr'];

/** 描き方を替えた区画の作られ方（借りる図が無いとき。HTML の本体の区画だけを替え、API・アイランド・画像はそのまま）。 */
function retagSource(src: RegionSource, s: RouteStrategyId): RegionSource {
  if (src !== 'build' && src !== 'isr' && src !== 'cached' && src !== 'ssr')
    return src;
  switch (strategyFamily(s)) {
    case 'static':
      return 'build';
    case 'cached':
      return s === 'cached-purge' ? 'cached' : 'isr';
    case 'ssr':
      return 'ssr';
    case 'api':
      return 'api';
    default:
      return src;
  }
}

/** 見取り図の区画に、選んだフレームワークでの作られ方を付けたもの（D-102）。 */
export type ResolvedRegion = WireframeRegion & { source: RegionSource };

/**
 * 始める画面のページの見取り図（D-102）。シナリオの wireframes を、選んだフレームワークとコメントの描き方（D-82）で解く。
 * ページの名前はテンプレートのルートの label。comments は始める画面で選べるときだけ渡す（省略はブラウザで読み込む）。
 */
export function pageWireframes(
  sc: Scenario,
  framework: FrameworkId,
  comments?: number,
  /** 選んだページごとの描き方（D-107）。既定と違うページは、その描き方を既定に持つフレームワークの図を借りる。 */
  routes?: RouteOverrides,
  /**
   * 構成の事業者（D-111）。渡すと、事業者で決まる既定（Vercel × Next.js の部品ごとにキャッシュ）も図に出す。
   * 省略はフレームワークの既定（事業者を見ない今までの図）。
   */
  platform?: Platform,
): {
  route: string;
  label: string;
  regions: ResolvedRegion[];
  badges: PageBadge[];
}[] {
  const tpl = sc.template(1).routes;
  const inPage = commentsInPage(
    comments ?? COMMENTS_IN_BROWSER,
    framework,
    sc,
    routes,
  );
  return (sc.text?.wireframes ?? []).map((w) => {
    const r = tpl.find((x) => x.id === w.route);
    const audience = r ? routeAudienceOf(sc, r) : 'public';
    const byPlatform =
      platform !== undefined
        ? defaultStrategy(framework, platform, audience)
        : undefined;
    const chosen =
      routes?.[w.route] ??
      (byPlatform === 'cache-components' ? byPlatform : undefined);
    // 図を借りるフレームワーク: 選んだ描き方を既定に持つもの（記事の S1 は静的書き出し・個人向けの S5 は静的書き出しなど）
    const donor =
      chosen === undefined
        ? framework
        : // SPA の図（1 つのシェル）より、ページごとの HTML を持つフレームワークの図を先に借りる
          ([...frameworksOf(sc).allowed]
            .sort((a, b) => Number(a === 'vite-spa') - Number(b === 'vite-spa'))
            .find(
              (f) =>
                strategyFamily(FRAMEWORK_PRESETS[f][audience]) ===
                strategyFamily(chosen),
            ) ?? framework);
    // 借りる先が無い（記事を毎回描く S4 など）は、作られ方を描き方で置き換える
    const own = w.byFramework[donor];
    // 記事ごとの枠（全員に同じ中身のページの S5。D-109）は、枠（ビルド）と API の中身に分けた図
    const perPage =
      chosen !== undefined &&
      audience === 'public' &&
      strategyFamily(chosen) === 'api' &&
      perPageShellFramework(framework)
        ? w.shellPerPage
        : undefined;
    const base = perPage
      ? perPage.sources
      : chosen !== undefined && donor === framework
        ? Object.fromEntries(
            Object.entries(own).map(([id, src]) => [
              id,
              retagSource(src, chosen),
            ]),
          )
        : own;
    const sources = {
      ...base,
      ...(inPage ? w.commentsInPage?.[donor] : undefined),
    };
    // 枠 + サーバーの島（S6。D-108）: 人ごとに違う区画は島、ほかの HTML の区画は枠（API・画像の区画はそのまま）
    const islands =
      chosen !== undefined && strategyFamily(chosen) === 'island'
        ? new Set(w.islandRegions ?? [])
        : undefined;
    // 部品ごとにキャッシュ（D-111）: 人ごとに違うページの人ごとに違う区画は動的な穴、ほかの HTML の区画はキャッシュした部品
    const components =
      chosen !== undefined && strategyFamily(chosen) === 'components';
    const holes = components
      ? new Set(audience === 'personal' ? (w.islandRegions ?? []) : [])
      : undefined;
    const sourceOf = (id: string): RegionSource => {
      const src = sources[id] ?? 'ssr';
      if (holes) {
        if (holes.has(id)) return 'cc-dynamic';
        return HTML_SOURCES.includes(src) ? 'cc-cached' : src;
      }
      if (!islands) return src;
      if (islands.has(id)) return 'server-island';
      return HTML_SOURCES.includes(src) ? 'island-shell' : src;
    };
    return {
      route: w.route,
      label: r?.label ?? w.route,
      regions: w.regions.map((r) => ({
        ...r,
        source: sourceOf(r.id),
      })),
      badges: components
        ? audience === 'personal'
          ? [
              {
                kind: 'cpu' as const,
                text: 'CPU: 人ごとに違う部分だけ閲覧ごとに描く（全員に同じ部品はキャッシュした枠に入る）',
              },
            ]
          : [
              {
                kind: 'freshness' as const,
                text: '鮮度: 期限（cacheLife）かタグ（投稿・編集で updateTag）で作り直す',
              },
              { kind: 'ogp' as const, text: 'SNS のカード: HTML に入る' },
            ]
        : islands
          ? [
              {
                kind: 'cpu' as const,
                text:
                  framework === 'astro'
                    ? 'CPU: 島の分だけ閲覧ごとに描く（島は別のリクエスト・枠はキャッシュ）'
                    : 'CPU: 島の分だけ閲覧ごとに描く（同じ応答の中で続けて流す）',
              },
            ]
          : (perPage?.badges ?? w.badges?.[donor] ?? []),
    };
  });
}
