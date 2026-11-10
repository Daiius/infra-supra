// フレームワークごとの描き方の呼び名（D-193・prd/06 §8）。画面に出す描き方・区画・部品・設定の名前を、選んだフレームワークの
// 公式の文書の用語で出す（一般の言葉を併記しない）。呼び名の無いもの・フレームワークを選ぶ前は一般の言葉（ROUTE_STRATEGIES の label など）。
// 分かりにくい名前には短い説明（note）を付け、画面は ⓘ か title に出す。呼び名は出典の文書の見出し・用語のとおりに書く（取得日つき）。
import type { FrameworkId } from './index.ts';
import type { RouteStrategyId } from './route-strategies.ts';
import { ROUTE_STRATEGIES } from './route-strategies.ts';

/** 呼び名を持たせる所。描き方（RouteStrategyId）と、描き方に付く言葉。 */
export type FrameworkTermKey =
  | RouteStrategyId
  /** 投稿・編集のときにページのキャッシュを消す設定のチップ（再検証・記事のキャッシュ）。 */
  | 'onDemand'
  /** ページのキャッシュの部品（スロット isrCache・構成図の isr-store）。 */
  | 'pageCacheStore'
  /** 枠 + 人ごとの部分をサーバーで描く形の、人ごとの部分（見取り図の区画・構成図の凡例）。 */
  | 'islandRegion'
  /** 同じ形の、使い回す枠（見取り図の区画）。 */
  | 'shellRegion'
  /** 閲覧のときに描いてキャッシュする区画（期限と消すのを区別しない。見取り図の区画）。 */
  | 'cachedRegion';

export type FrameworkTerm = {
  /** 画面の名前（フレームワークの公式の文書の用語）。 */
  name: string;
  /** 知らない人向けの短い説明（ⓘ・title）。 */
  note?: string;
  /** 出典（公式の文書）と取得日。 */
  source: { url: string; retrievedAt: string };
};

/** 呼び名を確かめた日（D-193）。 */
const T = '2026-11-10';
const at = (url: string) => ({ url, retrievedAt: T });
const NEXT_GLOSSARY = at('https://nextjs.org/docs/app/glossary');
const NEXT_ISR = at(
  'https://nextjs.org/docs/app/guides/incremental-static-regeneration',
);
const NEXT_EXPORT = at('https://nextjs.org/docs/app/guides/static-exports');
const NEXT_SPA = at(
  'https://nextjs.org/docs/app/guides/single-page-applications',
);
const ASTRO_ON_DEMAND = at(
  'https://docs.astro.build/en/guides/on-demand-rendering/',
);
const ASTRO_CACHING = at('https://docs.astro.build/en/guides/caching/');
const ASTRO_ISLANDS = at('https://docs.astro.build/en/concepts/islands/');
const VITE_APP_TYPE = at('https://vite.dev/config/shared-options');

const NEXT_CLIENT_FETCH: FrameworkTerm = {
  name: 'Client-side data fetching',
  note: 'HTML は先に作った枠で、中身は Client Component がブラウザで API から取って描きます',
  source: NEXT_SPA,
};

/**
 * フレームワークごとの呼び名。載せていないもの（Vite の SPA の人ごとの部分など）は一般の言葉のまま。
 * - Next.js: 用語集の見出し（Prerendering・Dynamic rendering・Incremental Static Regeneration (ISR)・Partial Prerendering (PPR)・
 *   Cache Components・Static Shell）と ISR の文書の見出し（On-demand revalidation）。用語集に「SSG」「SSR」の見出しは無い。
 * - Astro: On-demand rendering・prerender（`export const prerender`）・Route caching（maxAge・cache.invalidate）・Client Islands・Server islands。
 * - Vite: `appType: 'spa'`（「Single Page Application (SPA)」）。
 */
export const FRAMEWORK_TERMS: Readonly<
  Record<FrameworkId, Partial<Record<FrameworkTermKey, FrameworkTerm>>>
> = {
  nextjs: {
    'static-build': {
      name: 'Prerendering',
      note: 'ビルドのときに HTML を作ります（generateStaticParams・dynamicParams = false）。更新はビルドし直しです',
      source: NEXT_GLOSSARY,
    },
    'cached-ttl': {
      name: 'ISR',
      note: 'Incremental Static Regeneration。最初の閲覧で描いた HTML をキャッシュし、revalidate の期限が来たら裏で作り直します',
      source: NEXT_GLOSSARY,
    },
    'cached-purge': {
      name: 'On-demand revalidation',
      note: 'ISR のキャッシュを、投稿・編集のときに revalidatePath・revalidateTag で消して作り直します',
      source: NEXT_ISR,
    },
    ssr: {
      name: 'Dynamic rendering',
      note: 'リクエストのたびにサーバーで描きます（キャッシュしない）',
      source: NEXT_GLOSSARY,
    },
    'shell-api': NEXT_CLIENT_FETCH,
    'server-island': {
      name: 'Partial Prerendering（PPR）',
      note: '先に作った枠（Static Shell）をすぐ返し、人ごとの部分だけを閲覧ごとにサーバーで描いて同じ応答で流します',
      source: NEXT_GLOSSARY,
    },
    'cache-components': {
      name: 'Cache Components',
      note: "'use cache' の部品を枠に入れて使い回し、人ごとの部分だけを閲覧ごとに描きます（Next.js 16）",
      source: NEXT_GLOSSARY,
    },
    onDemand: {
      name: 'On-demand revalidation',
      note: '投稿・編集のときに revalidatePath・revalidateTag でページのキャッシュを消します',
      source: NEXT_ISR,
    },
    pageCacheStore: {
      name: 'ISR のキャッシュ',
      note: 'ISR で描いた HTML の置き場（cacheHandler）です',
      source: NEXT_ISR,
    },
    shellRegion: {
      name: 'Static Shell',
      note: '先に作って使い回す枠の HTML です',
      source: NEXT_GLOSSARY,
    },
  },
  'nextjs-export': {
    'static-build': {
      name: 'Static Export',
      note: "output: 'export' で、ビルドのときにページごとの HTML を作ります。更新はビルドし直しです",
      source: NEXT_EXPORT,
    },
    'shell-api': NEXT_CLIENT_FETCH,
  },
  astro: {
    'static-build': {
      name: 'prerender',
      note: 'ビルドのときに HTML を作ります（export const prerender = true）。更新はビルドし直しです',
      source: ASTRO_ON_DEMAND,
    },
    'cached-ttl': {
      name: 'Route caching（maxAge）',
      note: '閲覧のときに描いたページをキャッシュし、maxAge の期限が来たら取り直します',
      source: ASTRO_CACHING,
    },
    'cached-purge': {
      name: 'Route caching（invalidate）',
      note: '閲覧のときに描いたページをキャッシュし、投稿・編集のときに cache.invalidate で消します',
      source: ASTRO_CACHING,
    },
    ssr: {
      name: 'On-demand rendering',
      note: 'リクエストのたびにサーバーで描きます（SSR。キャッシュしない）',
      source: ASTRO_ON_DEMAND,
    },
    'shell-api': {
      name: 'Client Islands',
      note: 'HTML は先に作った枠で、中身はブラウザで動く部品（アイランド）が API から取って描きます',
      source: ASTRO_ISLANDS,
    },
    'server-island': {
      name: 'Server islands',
      note: '枠は使い回し、人ごとの部分だけを閲覧ごとに別のリクエストでサーバーが描きます',
      source: ASTRO_ISLANDS,
    },
    onDemand: {
      name: 'cache.invalidate',
      note: '投稿・編集のときに、そのページのキャッシュを cache.invalidate で消します（Route caching）',
      source: ASTRO_CACHING,
    },
    cachedRegion: {
      name: 'Route caching',
      note: '閲覧のときに描いたページをキャッシュし、投稿・編集のとき（cache.invalidate）か期限（maxAge）で取り直します',
      source: ASTRO_CACHING,
    },
    islandRegion: {
      name: 'Server islands',
      note: '人ごとの部分を、閲覧ごとに別のリクエストでサーバーが描きます',
      source: ASTRO_ISLANDS,
    },
  },
  'vite-spa': {
    'shell-api': {
      name: 'SPA',
      note: 'Single Page Application。1 つの静的な index.html とブラウザの JS で描き、中身は API で取ります',
      source: VITE_APP_TYPE,
    },
  },
};

/** フレームワークでの呼び名（無ければ undefined。フレームワークを選ぶ前も undefined）。 */
export function frameworkTerm(
  framework: FrameworkId | undefined,
  key: FrameworkTermKey,
): FrameworkTerm | undefined {
  return framework === undefined ? undefined : FRAMEWORK_TERMS[framework][key];
}

/** 呼び名があればそれ、無ければ一般の言葉。 */
export function termName(
  framework: FrameworkId | undefined,
  key: FrameworkTermKey,
  general: string,
): string {
  return frameworkTerm(framework, key)?.name ?? general;
}

/**
 * 画面に出す描き方の名前。S1〜S6 の番号（`code`）は分かりにくいので画面には出さず、名前だけにする（D-112）。
 * フレームワークを渡すと、そのフレームワークでの呼び名にする（D-193。無ければ一般の言葉）。
 */
export function strategyTitle(
  id: RouteStrategyId,
  framework?: FrameworkId,
): string {
  return termName(framework, id, ROUTE_STRATEGIES[id].label);
}

/** 描き方の呼び名の短い説明（ⓘ・title。呼び名が無ければ undefined）。 */
export function strategyTermNote(
  id: RouteStrategyId,
  framework: FrameworkId | undefined,
): string | undefined {
  return frameworkTerm(framework, id)?.note;
}
