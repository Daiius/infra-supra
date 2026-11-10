// 描き方の対応表（フレームワーク × 事業者。D-106・prd/13 §3）。新しい事実は書かず、今の catalog のデータ（DeployTarget の
// 出典・Astro の記事のキャッシュの置き場 pageCache・Next.js の ISR のキャッシュの部品の onDemandIsr）から組み立てる。
// 出典の無い「できる」は basis: 'assumption'（ゲーム上の仮定）、確かめていないものは 'unverified'（画面に出さない。RS-04）。
import { componentsOf, type Platform, slotLabel } from '../stacks/index.ts';
import {
  deployTarget,
  FRAMEWORKS,
  type DeployTarget,
  type FrameworkId,
  termName,
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
  aws: '。Amplify が静的なページを処理（compute）を通さずに配るとみなすのはゲーム上の仮定です（公式の文書は Next.js 15 までの「SSG に対応」までで、配り方・課金の記載は無い）',
  gcp: '。静的なページを Hosting の CDN が返し Cloud Run を呼ばないとみなすのはゲーム上の仮定です（公式の文書は CDN に載った応答は Cloud Run に届かないと書くが、キャッシュの外れ・期限切れは Cloud Run を呼ぶ）',
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
  'HTML は枠にして、中身をブラウザが API で取ります（どのフレームワークでも作れる一般的な形。API の置き場は部品で選ぶ）',
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
  '人ごとの部分の CPU はページ全体の SSR の 4 割とみなします（ゲーム上の仮定）';

/** S6 を全員に同じページに使う数え方はまだ無い（記事の動く部品はコメントの描き方・アイランドで数える。段 4）。 */
const ISLAND_PUBLIC = no(
  'このゲームでは、枠 + 人ごとの部分をサーバーで描く形は人ごとに違うページだけに使います（記事の動く部品はブラウザが API で取る形で数える。段 4）',
);

/** Astro の Server Islands（D-108）。Cloudflare・Node（VPS）・Netlify はアダプターの頁に明記、Vercel・Cloud Run は仮。 */
function astroIsland(d: DeployTarget): StrategySupport {
  const how =
    '`server:defer` の部分（Server Island）を、枠とは別の GET のリクエストでサーバーが描きます。枠は人ごとに違わないので 1 日の期限でキャッシュし、その部分は人ごとに違うのでキャッシュしません（props が 2,048 バイトを超えると POST になり、どのみちキャッシュされない）。' +
    ISLAND_COUNT;
  switch (d.platform) {
    case 'cloudflare':
      return yes(
        `${how}。@astrojs/cloudflare の頁が server islands を含めて配れると書いています`,
        [ASTRO_ISLANDS, astroAdapter('cloudflare')],
      );
    case 'sakura':
      return yes(
        `${how}。@astrojs/node の頁が server islands に対応と書いています`,
        [ASTRO_ISLANDS, astroAdapter('node')],
      );
    case 'netlify':
      return yes(
        `${how}。@astrojs/netlify の頁が server islands の skew protection を設定すると書いています`,
        [ASTRO_ISLANDS, astroAdapter('netlify')],
      );
    case 'vercel':
      return {
        ...yes(
          `${how}。@astrojs/vercel の頁は機能の一つとして触れるだけで、Server Islands の頁の「どのホストでも動く」から使えるとみなします（ゲーム上の仮定）`,
          [ASTRO_ISLANDS, astroAdapter('vercel')],
        ),
        basis: 'assumption',
      };
    case 'gcp':
      return {
        ...yes(
          `${how}。Cloud Run の Node のアダプターは VPS と同じとみなします（Cloud Run の頁は取得していない。ゲーム上の仮定）`,
          [ASTRO_ISLANDS, astroAdapter('node')],
        ),
        basis: 'assumption',
      };
    default:
      return unverified(
        'Astro の Server Islands をこの事業者で確かめていません',
      );
  }
}

/** Next.js の PPR（16 の cacheComponents。D-108）。Vercel・Node の standalone・Cloud Run は ✓、vinext・Amplify は ✗。 */
function nextIsland(d: DeployTarget): StrategySupport {
  const how =
    'Partial Prerendering（Next.js 16 の cacheComponents の既定）。静的な枠を先に流し、人ごとに違う部分を同じ応答の中で続けて描きます。枠を CDN から配るかはアダプターしだいなので、閲覧ごとに処理を通して人ごとの部分だけ描くとみなします（origin だけの形）。' +
    ISLAND_COUNT;
  switch (d.platform) {
    case 'vercel':
    case 'sakura':
    case 'gcp':
      return yes(
        `${how}。next start（Node）が PPR・Cache Components を扱います（Node のランタイムが要る）`,
        NEXT_PPR,
      );
    case 'cloudflare':
      return no(
        'vinext は cacheComponents の挙動がまだ不完全です（README: partial shells・resume behavior が Next.js と合わない）',
        VINEXT_PRERENDER.slice(0, 1),
      );
    case 'aws':
      return no(
        'Amplify は Next.js 15 までです（PPR を既定にした cacheComponents は 16）',
        [AMPLIFY_NEXT],
      );
    default:
      return unverified('Next.js の PPR をこの事業者で確かめていません');
  }
}

/** 部品ごとにキャッシュ（Cache Components）を確かめた公式の文書（2026-11-03 取得。prd/13 §9・D-111）。 */
const NEXT_CACHE_COMPONENTS: Source[] = [
  {
    url: 'https://nextjs.org/docs/app/api-reference/directives/use-cache',
    retrievedAt: '2026-11-03',
  },
  {
    url: 'https://nextjs.org/docs/app/getting-started/caching',
    retrievedAt: '2026-11-03',
  },
  {
    url: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers',
    retrievedAt: '2026-11-03',
  },
];
const VERCEL_PPR: Source = {
  url: 'https://vercel.com/docs/partial-prerendering',
  retrievedAt: '2026-11-03',
};
const NEXT_SELF_HOSTING: Source = {
  url: 'https://nextjs.org/docs/app/guides/self-hosting',
  retrievedAt: '2026-11-03',
};

/** 部品ごとにキャッシュの数え方の要約（D-111・ゲーム上の仮定）。 */
const CACHE_COMPONENTS_COUNT =
  '人ごとに違うページは、閲覧ごとに描く部分の CPU をページ全体の SSR の 4 割、DB の問い合わせを全員に同じ部品の分（3 分の 1）を除いた残りとみなします。全員に同じページは ISR と同じ数え方です（期限かタグかは再検証の設定。ゲーム上の仮定）';

/**
 * 部品ごとにキャッシュ（Next.js 16 の Cache Components。D-111）。Vercel は枠を全体の ISR のキャッシュと地域の CDN に置き、
 * 穴を関数で描く（Vercel の PPR の文書）。自前の Node（VPS・Cloud Run）は next start が扱い、'use cache' の既定は各プロセスの
 * メモリ（インスタンスの間で共有しない。共有するには cacheHandlers で Redis などを足す＝このゲームでは扱わない）。vinext・Amplify は ✗。
 */
function nextCacheComponents(d: DeployTarget): StrategySupport {
  switch (d.platform) {
    case 'vercel':
      return yes(
        `Vercel は静的な枠（キャッシュした部品を含む）を全体の ISR のキャッシュに置いて地域の CDN から返し、人ごとに違う部分を関数で描いて同じ応答で流します（閲覧ごとに関数を呼ぶ）。タグ（revalidateTag・updateTag）で枠を作り直します。${CACHE_COMPONENTS_COUNT}`,
        [...NEXT_CACHE_COMPONENTS, VERCEL_PPR],
      );
    case 'sakura':
      return yes(
        `next start（1 つの Node のプロセス）が枠をディスクに、'use cache' をメモリに持ちます（1 台なのでキャッシュは全員で共有される）。${CACHE_COMPONENTS_COUNT}`,
        [...NEXT_CACHE_COMPONENTS, NEXT_SELF_HOSTING],
      );
    case 'gcp':
      return yes(
        `Cloud Run の next start が扱います。'use cache' の既定はインスタンスごとのメモリで共有されず、タグで消してもほかのインスタンスには届きません（共有の cacheHandlers は扱わない）。全員に同じページをタグで消す形は Hosting の CDN が消せないのと同じく使えません（期限で取り直す）。${CACHE_COMPONENTS_COUNT}`,
        [...NEXT_CACHE_COMPONENTS, NEXT_SELF_HOSTING],
      );
    case 'cloudflare':
      return no(
        "vinext は cacheComponents の挙動がまだ不完全です（README: 'use cache' は一部だけ・cache profiles・tags・partial shells が Next.js と合わない）",
        VINEXT_PRERENDER.slice(0, 1),
      );
    case 'aws':
      return no('Amplify は Next.js 15 までです（Cache Components は 16）', [
        AMPLIFY_NEXT,
      ]);
    default:
      return unverified(
        'Next.js の Cache Components をこの事業者で確かめていません',
      );
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
      `${termName('nextjs', 'onDemand', '更新で消す再検証')}（revalidatePath・revalidateTag）で、投稿・編集のときにそのページを取り直します`,
      d.sources,
    );
  if (ok.length === 0)
    return no(
      `ISR のキャッシュ（${ng.map((o) => o.label).join('・')}）を投稿・編集で消して全体に届ける手段がありません`,
      d.sources,
    );
  return {
    ...yes(
      `部品「${slotLabel('isrCache', 'nextjs')}」で決まります（消せる: ${ok.map((o) => o.label).join('・')}／消せない: ${ng.map((o) => o.label).join('・')}）`,
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
            'vinext は開発中です（README）。prerender: true と staticAssetsAdapter() で記事のページをビルドのときに事前描画し、Worker が静的アセット（ASSETS の binding）から返します（閲覧ごとに Worker のリクエストに数え、CPU はキャッシュから返すのと同じとみなす。ゲーム上の仮定）。新しい記事はビルドし直すまで開けません',
            VINEXT_PRERENDER,
          )
        : yes(
            'generateStaticParams で記事のページをビルドのときに静的な HTML にし、dynamicParams = false で一覧に無いページは 404 にします（新しい記事はビルドし直すまで開けない）。ビルドの時間の数え方は静的書き出しと同じとみなします' +
              (STATIC_NO_COMPUTE_ASSUMED[d.platform] ?? ''),
            [NEXT_STATIC_PARAMS],
          ),
    'cached-ttl': yes(
      `ISR（revalidate の期限）です。キャッシュの置き場は部品「${slotLabel('isrCache', 'nextjs')}」です`,
      d.sources,
    ),
    'cached-purge': nextPurge(d),
    ssr: yes(
      'Server Components を閲覧のたびに描きます（動的な描画）',
      d.sources,
    ),
    'shell-api': SHELL_API_ANY,
    'server-island': nextIsland(d),
    'cache-components': nextCacheComponents(d),
  };
}

function astroRow(d: DeployTarget): Record<RouteStrategyId, StrategySupport> {
  const c = d.pageCache;
  return {
    'static-build': yes(
      'prerender でビルドのときに HTML にします（ページごとに選べる）',
      FRAMEWORKS.astro.sources,
    ),
    'cached-ttl': c
      ? yes(`${c.label} に期限付きでキャッシュします`, d.sources)
      : no('記事をキャッシュする置き場がありません', d.sources),
    'cached-purge':
      c && c.onDemand
        ? yes(`${c.label}。${c.reason}`, d.sources)
        : no(
            c ? c.reason : '記事をキャッシュする置き場がありません',
            d.sources,
          ),
    ssr: yes(
      'アダプターが閲覧のたびに描きます（on-demand rendering）',
      d.sources,
    ),
    'shell-api': SHELL_API_ANY,
    'server-island': astroIsland(d),
    'cache-components': no(
      `Cache Components は Next.js 16 の機能です（Astro には無い。Astro で近いのは ${termName('astro', 'server-island', '枠 + 人ごとの部分をサーバーで描く形')}）`,
      FRAMEWORKS.astro.sources,
    ),
  };
}

function nextExportRow(
  d: DeployTarget,
): Record<RouteStrategyId, StrategySupport> {
  const noServer = no(
    '静的書き出しにはサーバーがありません（ISR・SSR は使えない）',
    FRAMEWORKS['nextjs-export'].sources,
  );
  return {
    'static-build': yes(
      "output: 'export' でルートごとの HTML をビルドのときに作ります",
      d.sources,
    ),
    'cached-ttl': noServer,
    'cached-purge': noServer,
    ssr: noServer,
    'shell-api': yes(
      'ビルドした HTML の上で Client Component が API で中身を取ります',
      FRAMEWORKS['nextjs-export'].sources,
    ),
    'server-island': noServer,
    'cache-components': noServer,
  };
}

function spaRow(d: DeployTarget): Record<RouteStrategyId, StrategySupport> {
  const noHtml = no(
    '1 つのシェルとブラウザの JS で描きます。ページごとの HTML を作りません（サーバーで描く・ビルドで描くなら別のフレームワーク）',
    FRAMEWORKS['vite-spa'].sources,
  );
  return {
    'static-build': noHtml,
    'cached-ttl': noHtml,
    'cached-purge': noHtml,
    ssr: noHtml,
    'shell-api': yes(
      'シェルを静的に配り、中身はブラウザが API で取ります',
      d.sources,
    ),
    'server-island': noHtml,
    'cache-components': noHtml,
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
      d?.note ?? 'このフレームワークをこの事業者に載せる形がありません',
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
 * 既定を部品ごとにキャッシュ（Cache Components）にする組（D-111・C-14/C-16）。Vercel × Next.js だけ。使えない組（vinext・Amplify）と、
 * 選べるが既定にしない組（VPS・Cloud Run）は今までの ISR・毎回描くのまま。
 */
export function cacheComponentsByDefault(
  framework: FrameworkId,
  platform: Platform,
): boolean {
  return framework === 'nextjs' && platform === 'vercel';
}

/** 既定の決め方の選択。legacy: 部品ごとにキャッシュを既定にする前（保存の版 3 まで）の既定で読む（D-111）。 */
export type DefaultStrategyOptions = { legacy?: boolean };

/**
 * フレームワークの既定の描き方をその事業者で使える形に落とす（D-106）。Astro の記事は消せない置き場（Google Cloud の
 * Hosting の CDN）では期限で取り直す（D-103 の実装。下書きの RS-03 は S1 に落とす案だったが、main の実装に合わせた）。
 * Vercel × Next.js は部品ごとにキャッシュ（D-111。legacy なら今までの既定）。
 */
export function defaultStrategy(
  framework: FrameworkId,
  platform: Platform,
  audience: RouteAudience,
  options: DefaultStrategyOptions = {},
): RouteStrategyId {
  if (!options.legacy && cacheComponentsByDefault(framework, platform))
    return 'cache-components';
  const s = FRAMEWORK_PRESETS[framework][audience];
  if (
    s === 'cached-purge' &&
    strategySupport(framework, platform, audience, s).support === 'no'
  )
    return 'cached-ttl';
  return s;
}
