// 描き方の対応表（フレームワーク × 事業者。D-106・prd/13 §3）。新しい事実は書かず、今の catalog のデータ（DeployTarget の
// 出典・Astro の記事のキャッシュの置き場 pageCache・Next.js の ISR のキャッシュの部品の onDemandIsr）から組み立てる。
// 出典の無い「できる」は basis: 'assumption'（ゲーム上の仮定）、確かめていないものは 'unverified'（画面に出さない。RS-04）。
import { componentsOf, type Platform } from '../stacks/index.ts';
import {
  deployTarget,
  FRAMEWORKS,
  type DeployTarget,
  type FrameworkId,
} from './index.ts';
import {
  FRAMEWORK_PRESETS,
  ROUTE_STRATEGIES,
  ROUTE_STRATEGY_ORDER,
  type RouteAudience,
  type RouteStrategyId,
} from './route-strategies.ts';

type Source = { url: string; retrievedAt: string };

/** Next.js の generateStaticParams（ビルドのときの静的な生成・dynamicParams = false。2026-10-01 更新・2026-11-03 取得。D-107）。 */
const NEXT_STATIC_PARAMS: Source = {
  url: 'https://nextjs.org/docs/app/api-reference/functions/generate-static-params',
  retrievedAt: '2026-11-03',
};

/** vinext の README（prerender: true + staticAssetsAdapter()）と caching の文書（2026-11-03 取得。RS-15・D-107 の補足）。 */
const VINEXT_PRERENDER: Source[] = [
  { url: 'https://github.com/cloudflare/vinext', retrievedAt: '2026-11-03' },
  {
    url: 'https://github.com/cloudflare/vinext/blob/main/docs/caching.mdx',
    retrievedAt: '2026-11-03',
  },
];

/**
 * Next.js の S1 の静的なページを、事業者の CDN が処理（compute）を通さずに返すとみなす事業者の注（RS-18 の補足）。
 * 公式の文書は「静的なページ・SSG に対応」までで、compute を呼ばない・課金しないとは書いていない（2026-11-03 の調べ）。
 */
const STATIC_NO_COMPUTE_ASSUMED: Partial<Record<Platform, string>> = {
  aws: '。Amplify が静的なページを処理（compute）を通さずに配るとみなすのはゲーム上の仮定（公式の文書は Next.js 15 までの「SSG に対応」までで、配り方・課金の記載は無い）',
  gcp: '。静的なページを Hosting の CDN が返し Cloud Run を呼ばないとみなすのはゲーム上の仮定（公式の文書は CDN に載った応答は Cloud Run に届かないと書くが、キャッシュの外れ・期限切れは Cloud Run を呼ぶ）',
};

/**
 * 描き方がその事業者で使えるか。
 * - yes: 使える。
 * - depends: 部品で決まる（Next.js の ISR のキャッシュ。今の部品での判定はゲームの側が持つ onDemandBlocker）。
 * - no: 公式の手段が無い・フレームワークに無い（理由を灰色で出す）。
 * - unverified: 確かめていない（出さない。RS-04）。
 */
export type StrategySupportLevel = 'yes' | 'depends' | 'no' | 'unverified';

export type StrategySupport = {
  support: StrategySupportLevel;
  /** 理由・条件（画面の ⓘ・灰色の行の理由）。 */
  note: string;
  /** 出典がある（source）か、ゲーム上の仮定（assumption）か。 */
  basis: 'source' | 'assumption';
  sources: Source[];
};

const yes = (note: string, sources: Source[]): StrategySupport => ({
  support: 'yes',
  note,
  basis: sources.length > 0 ? 'source' : 'assumption',
  sources,
});
const no = (note: string, sources: Source[] = []): StrategySupport => ({
  support: 'no',
  note,
  basis: sources.length > 0 ? 'source' : 'assumption',
  sources,
});
const unverified = (note: string): StrategySupport => ({
  support: 'unverified',
  note,
  basis: 'assumption',
  sources: [],
});

/** S5 はどのフレームワークでも作れる（一般的な作り方。API の置き場は D-65・D-69）。ゲーム上の仮定。 */
const SHELL_API_ANY = yes(
  'HTML は枠にして、中身をブラウザが API で取る（どのフレームワークでも作れる一般的な形。API の置き場は部品で選ぶ）',
  [],
);
/** S6 の対応を確かめた公式の文書（2026-11-03 取得。prd/13 §8・D-108）。 */
const ASTRO_ISLANDS: Source = {
  url: 'https://docs.astro.build/en/guides/server-islands/',
  retrievedAt: '2026-11-03',
};
const astroAdapter = (name: string): Source => ({
  url: `https://docs.astro.build/en/guides/integrations-guide/${name}/`,
  retrievedAt: '2026-11-03',
});
const NEXT_PPR: Source[] = [
  {
    url: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents',
    retrievedAt: '2026-11-03',
  },
  {
    url: 'https://nextjs.org/docs/app/guides/deploying-to-platforms',
    retrievedAt: '2026-11-03',
  },
  {
    url: 'https://nextjs.org/docs/app/guides/self-hosting',
    retrievedAt: '2026-11-03',
  },
];
const AMPLIFY_NEXT: Source = {
  url: 'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html',
  retrievedAt: '2026-11-03',
};

/** S6 の数え方の要約（どの組でも同じ。D-108・ゲーム上の仮定）。 */
const ISLAND_COUNT =
  '島の CPU はページ全体の SSR の 4 割とみなす（ゲーム上の仮定）';

/** S6 を全員に同じページに使う数え方はまだ無い（記事の動く部品はコメントの描き方・アイランドで数える。段 4）。 */
const ISLAND_PUBLIC = no(
  'このゲームでは、枠 + サーバーの島は人ごとに違うページだけに使う（記事の動く部品はブラウザが API で取る形で数える。段 4）',
);

/** Astro の Server Islands（D-108）。Cloudflare・Node（VPS）・Netlify はアダプターの頁に明記、Vercel・Cloud Run は仮。 */
function astroIsland(d: DeployTarget): StrategySupport {
  const how =
    '`server:defer` の島を、枠とは別の GET のリクエストでサーバーが描く。枠は人ごとに違わないので 1 日の期限でキャッシュし、島は人ごとに違うのでキャッシュしない（props が 2,048 バイトを超えると POST になり、どのみちキャッシュされない）。' +
    ISLAND_COUNT;
  switch (d.platform) {
    case 'cloudflare':
      return yes(
        `${how}。@astrojs/cloudflare の頁が server islands を含めて配れると書く`,
        [ASTRO_ISLANDS, astroAdapter('cloudflare')],
      );
    case 'sakura':
      return yes(`${how}。@astrojs/node の頁が server islands に対応と書く`, [
        ASTRO_ISLANDS,
        astroAdapter('node'),
      ]);
    case 'netlify':
      return yes(
        `${how}。@astrojs/netlify の頁が server islands の skew protection を設定すると書く`,
        [ASTRO_ISLANDS, astroAdapter('netlify')],
      );
    case 'vercel':
      return {
        ...yes(
          `${how}。@astrojs/vercel の頁は機能の一つとして触れるだけで、Server Islands の頁の「どのホストでも動く」から使えるとみなす（ゲーム上の仮定）`,
          [ASTRO_ISLANDS, astroAdapter('vercel')],
        ),
        basis: 'assumption',
      };
    case 'gcp':
      return {
        ...yes(
          `${how}。Cloud Run の Node のアダプターは VPS と同じとみなす（Cloud Run の頁は取得していない。ゲーム上の仮定）`,
          [ASTRO_ISLANDS, astroAdapter('node')],
        ),
        basis: 'assumption',
      };
    default:
      return unverified('Astro の Server Islands をこの事業者で確かめていない');
  }
}

/** Next.js の PPR（16 の cacheComponents。D-108）。Vercel・Node の standalone・Cloud Run は ✓、vinext・Amplify は ✗。 */
function nextIsland(d: DeployTarget): StrategySupport {
  const how =
    'Partial Prerendering（Next.js 16 の cacheComponents の既定）。静的な枠を先に流し、人ごとに違う部分を同じ応答の中で続けて描く。枠を CDN から配るかはアダプターしだいなので、閲覧ごとに処理を通して島の分だけ描くとみなす（origin だけの形）。' +
    ISLAND_COUNT;
  switch (d.platform) {
    case 'vercel':
    case 'sakura':
    case 'gcp':
      return yes(
        `${how}。next start（Node）が PPR・Cache Components を扱う（Node のランタイムが要る）`,
        NEXT_PPR,
      );
    case 'cloudflare':
      return no(
        'vinext は cacheComponents の挙動がまだ不完全（README: partial shells・resume behavior が Next.js と合わない）',
        VINEXT_PRERENDER.slice(0, 1),
      );
    case 'aws':
      return no(
        'Amplify は Next.js 15 まで（PPR を既定にした cacheComponents は 16）',
        [AMPLIFY_NEXT],
      );
    default:
      return unverified('Next.js の PPR をこの事業者で確かめていない');
  }
}

/** Next.js の S3: ISR のキャッシュの部品の onDemandIsr から（消せる部品・消せない部品）。 */
function nextPurge(d: DeployTarget): StrategySupport {
  const opts = componentsOf(d.platform, 'isrCache', 'nextjs').filter(
    (o) => o.id !== 'none' && o.onDemandIsr !== undefined,
  );
  const ok = opts.filter((o) => o.onDemandIsr!.ok);
  const ng = opts.filter((o) => !o.onDemandIsr!.ok);
  if (opts.length === 0 || ng.length === 0)
    return yes(
      'オンデマンドの再検証（revalidatePath・revalidateTag）で、投稿・編集のときにそのページを取り直す',
      d.sources,
    );
  if (ok.length === 0)
    return no(
      `ISR のキャッシュ（${ng.map((o) => o.label).join('・')}）を投稿・編集で消して全体に届ける手段が無い`,
      d.sources,
    );
  return {
    ...yes(
      `ISR のキャッシュの部品で決まる（消せる: ${ok.map((o) => o.label).join('・')}／消せない: ${ng.map((o) => o.label).join('・')}）`,
      d.sources,
    ),
    support: 'depends',
  };
}

function nextjsRow(d: DeployTarget): Record<RouteStrategyId, StrategySupport> {
  return {
    'static-build':
      d.platform === 'cloudflare'
        ? yes(
            'vinext は開発中（README）。prerender: true と staticAssetsAdapter() で記事のページをビルドのときに事前描画し、Worker が静的アセット（ASSETS の binding）から返す（閲覧ごとに Worker のリクエストに数え、CPU はキャッシュから返すのと同じとみなす。ゲーム上の仮定）。新しい記事はビルドし直すまで開けない',
            VINEXT_PRERENDER,
          )
        : yes(
            'generateStaticParams で記事のページをビルドのときに静的な HTML にし、dynamicParams = false で一覧に無いページは 404 にする（新しい記事はビルドし直すまで開けない）。ビルドの時間の数え方は静的書き出しと同じとみなす' +
              (STATIC_NO_COMPUTE_ASSUMED[d.platform] ?? ''),
            [NEXT_STATIC_PARAMS],
          ),
    'cached-ttl': yes(
      'ISR（revalidate の期限）。キャッシュの置き場は ISR のキャッシュの部品',
      d.sources,
    ),
    'cached-purge': nextPurge(d),
    ssr: yes('Server Components を閲覧のたびに描く（動的な描画）', d.sources),
    'shell-api': SHELL_API_ANY,
    'server-island': nextIsland(d),
  };
}

function astroRow(d: DeployTarget): Record<RouteStrategyId, StrategySupport> {
  const c = d.pageCache;
  return {
    'static-build': yes(
      'prerender でビルドのときに HTML にする（ページごとに選べる）',
      FRAMEWORKS.astro.sources,
    ),
    'cached-ttl': c
      ? yes(`${c.label} に期限付きでキャッシュする`, d.sources)
      : no('記事をキャッシュする置き場が無い', d.sources),
    'cached-purge':
      c && c.onDemand
        ? yes(`${c.label}。${c.reason}`, d.sources)
        : no(c ? c.reason : '記事をキャッシュする置き場が無い', d.sources),
    ssr: yes('アダプターが閲覧のたびに描く（on-demand rendering）', d.sources),
    'shell-api': SHELL_API_ANY,
    'server-island': astroIsland(d),
  };
}

function nextExportRow(
  d: DeployTarget,
): Record<RouteStrategyId, StrategySupport> {
  const noServer = no(
    '静的書き出しにはサーバーが無い（ISR・SSR は使えない）',
    FRAMEWORKS['nextjs-export'].sources,
  );
  return {
    'static-build': yes(
      "output: 'export' でルートごとの HTML をビルドのときに作る",
      d.sources,
    ),
    'cached-ttl': noServer,
    'cached-purge': noServer,
    ssr: noServer,
    'shell-api': yes(
      'ビルドした HTML の上で Client Component が API で中身を取る',
      FRAMEWORKS['nextjs-export'].sources,
    ),
    'server-island': noServer,
  };
}

function spaRow(d: DeployTarget): Record<RouteStrategyId, StrategySupport> {
  const noHtml = no(
    '1 つのシェルとブラウザの JS で描く。ページごとの HTML を作らない（サーバーで描く・ビルドで描くなら別のフレームワーク）',
    FRAMEWORKS['vite-spa'].sources,
  );
  return {
    'static-build': noHtml,
    'cached-ttl': noHtml,
    'cached-purge': noHtml,
    ssr: noHtml,
    'shell-api': yes(
      'シェルを静的に配り、中身はブラウザが API で取る',
      d.sources,
    ),
    'server-island': noHtml,
  };
}

/**
 * フレームワーク × 事業者の描き方の対応表（ルートの見る人を問わない、事業者とフレームワークで決まる分）。
 * 載せられない組（DeployTarget が無い・unsupported）はすべて no。
 */
export function capabilityRow(
  framework: FrameworkId,
  platform: Platform,
): Record<RouteStrategyId, StrategySupport> {
  const d = deployTarget(framework, platform);
  if (!d || d.support === 'unsupported') {
    const x = no(
      d?.note ?? 'このフレームワークをこの事業者に載せる形が無い',
      d?.sources ?? [],
    );
    return Object.fromEntries(
      ROUTE_STRATEGY_ORDER.map((s) => [s, x]),
    ) as Record<RouteStrategyId, StrategySupport>;
  }
  switch (framework) {
    case 'nextjs':
      return nextjsRow(d);
    case 'astro':
      return astroRow(d);
    case 'nextjs-export':
      return nextExportRow(d);
    case 'vite-spa':
      return spaRow(d);
  }
}

/**
 * ルートの見る人まで入れた対応（個人化のページに使い回す描き方は使えない。理由は描き方の why.personal）。
 */
export function strategySupport(
  framework: FrameworkId,
  platform: Platform,
  audience: RouteAudience,
  strategy: RouteStrategyId,
): StrategySupport {
  const def = ROUTE_STRATEGIES[strategy];
  if (audience === 'personal' && !def.personalOk) return no(def.why.personal);
  const row = capabilityRow(framework, platform)[strategy];
  // 全員に同じページの S6 は数え方が無い（D-108）。載せられない組・確かめていない組はその理由のまま
  if (
    audience === 'public' &&
    strategy === 'server-island' &&
    row.support !== 'no' &&
    row.support !== 'unverified'
  )
    return ISLAND_PUBLIC;
  return row;
}

/**
 * フレームワークの既定の描き方をその事業者で使える形に落とす（D-106）。Astro の記事は消せない置き場（Google Cloud の
 * Hosting の CDN）では期限で取り直す（D-103 の実装。下書きの RS-03 は S1 に落とす案だったが、main の実装に合わせた）。
 */
export function defaultStrategy(
  framework: FrameworkId,
  platform: Platform,
  audience: RouteAudience,
): RouteStrategyId {
  const s = FRAMEWORK_PRESETS[framework][audience];
  if (
    s === 'cached-purge' &&
    strategySupport(framework, platform, audience, s).support === 'no'
  )
    return 'cached-ttl';
  return s;
}
