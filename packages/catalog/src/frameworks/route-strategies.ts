// ページ（ルート）ごとの描き方（D-106・prd/13）。描き方のメニュー S1〜S6 と、フレームワークごとの既定（プリセット）、
// それを Workload に当てる applyRouteStrategies。toSpa・toAstro・toNextExport はプリセットの呼び出しになった（出力は今までと同じ）。
// どの事業者で描き方が使えるか（対応表）は route-capability.ts（DeployTarget と部品のデータから組み立てる）。
import type { WorkloadInput } from 'estimator';
import type { AstroShape, FrameworkId, SpaShape } from './index.ts';

/** 描き方の id（設計の下書きの S1〜S6 の名前）。 */
export type RouteStrategyId =
  | 'static-build'
  | 'cached-ttl'
  | 'cached-purge'
  | 'ssr'
  | 'shell-api'
  | 'server-island';

/** ルートの見る人: 全員に同じ中身（public）か、人ごとに違う中身（personal）か。 */
export type RouteAudience = 'public' | 'personal';

export type RouteStrategyDef = {
  id: RouteStrategyId;
  /** 設計の番号（S1〜S6）。 */
  code: string;
  /** 画面の名前（短い）。 */
  label: string;
  /** 中身の説明。 */
  long: string;
  /** 人ごとに違う中身のページに使えるか（描いた HTML を使い回す描き方は使えない）。 */
  personalOk: boolean;
  /** その見る人のページで、この描き方が何の要件に応えるか（画面の「なぜ」の列）。 */
  why: Record<RouteAudience, string>;
  /** 今のモデルで Workload に当てられるか（S6 は段 5・D-108 で数え方を足した）。 */
  modeled: boolean;
};

export const ROUTE_STRATEGIES: Readonly<
  Record<RouteStrategyId, RouteStrategyDef>
> = {
  'static-build': {
    id: 'static-build',
    code: 'S1',
    label: '静的（ビルドし直し）',
    long: 'ビルドのときに HTML にして静的な配信から返す。更新はビルドし直し（間隔をまとめるか、更新のたび）',
    personalOk: false,
    why: {
      public:
        '全員に同じ中身なので、作った HTML を全員に配れる。サーバーで描かないので 1 リクエストの CPU の制限に当たらない。SNS のカードは HTML に入る',
      personal: '人ごとに違う中身は、ビルドのときに作れない',
    },
    modeled: true,
  },
  'cached-ttl': {
    id: 'cached-ttl',
    code: 'S2',
    label: 'サーバーで描いてキャッシュ（時間で取り直す）',
    long: '最初の閲覧でサーバーが描いてキャッシュし、期限が来たら取り直す（Next.js の ISR・Astro の route caching の期限）',
    personalOk: false,
    why: {
      public:
        '全員に同じ中身なので、描いた HTML を使い回せる。更新は期限の分だけ遅れて見える。SNS のカードは HTML に入る',
      personal:
        'キャッシュすると、人ごとに違う中身が他の人に見えてしまうので使えない',
    },
    modeled: true,
  },
  'cached-purge': {
    id: 'cached-purge',
    code: 'S3',
    label: 'サーバーで描いてキャッシュ（更新で消す）',
    long: '最初の閲覧でサーバーが描いてキャッシュし、投稿・編集のときにそのページのキャッシュを消す（オンデマンドの再検証・route caching の invalidate）',
    personalOk: false,
    why: {
      public:
        '全員に同じ中身なので、描いた HTML を使い回せる。投稿・編集で消すので、更新がすぐ見える。SNS のカードは HTML に入る',
      personal:
        'キャッシュすると、人ごとに違う中身が他の人に見えてしまうので使えない',
    },
    modeled: true,
  },
  ssr: {
    id: 'ssr',
    code: 'S4',
    label: '毎回描く',
    long: 'リクエストのたびにサーバーが描く（1 回ごとに CPU を使い、事業者の 1 リクエストの CPU の制限をすべての閲覧が受ける）',
    personalOk: true,
    why: {
      public:
        'いつも最新の中身を HTML で返す。ただし全員に同じ中身を閲覧のたびに描き直すので、CPU とリクエストが増える',
      personal:
        '人ごとに違う中身なので使い回せない。サーバーが毎回描き、HTML で返す（初回表示が軽い）',
    },
    modeled: true,
  },
  'shell-api': {
    id: 'shell-api',
    code: 'S5',
    label: '枠 + ブラウザが API で取る',
    long: 'HTML は静的な枠。中身はブラウザ（SPA・Client Component・アイランド）が API で取って描く。サーバーが受けるのはデータの API だけ',
    personalOk: true,
    why: {
      public:
        'サーバーは HTML を描かず、データの API だけを返す（API の応答はキャッシュできる）。HTML に中身が無いので、SNS のカードには前処理が要る',
      personal:
        '人ごとに違う中身をブラウザが API で取る。HTML を描かない分、1 回の CPU は軽い（初回表示は枠 → JS → API の順で重い）',
    },
    modeled: true,
  },
  'server-island': {
    id: 'server-island',
    code: 'S6',
    label: '枠 + サーバーの島',
    long: '枠は静的かキャッシュ。個人化した部分だけを別のリクエストでサーバーが描く（Astro の Server Islands・Next.js の PPR）',
    personalOk: true,
    why: {
      public:
        '全員に同じ部分は使い回し、動く部分だけをサーバーが描く。SNS のカードは HTML に入る',
      personal:
        '枠は使い回し、人ごとに違う部分（島）だけを閲覧ごとにサーバーが描く。1 リクエストの CPU は島の分だけで、枠の HTML（メタタグ）はそのまま返る',
    },
    modeled: true,
  },
};

/** 画面に並べる順（S1〜S6）。 */
export const ROUTE_STRATEGY_ORDER: readonly RouteStrategyId[] = [
  'static-build',
  'cached-ttl',
  'cached-purge',
  'ssr',
  'shell-api',
  'server-island',
];

/**
 * ページ（ルート）の性質（D-107・RS-17）。描き方の選択肢はルートの id でなくこの性質で絞る。テンプレートのデータに置く
 * （estimator の Workload には入れない）。
 */
export type RouteTraits = {
  /** 全員に同じ中身（public）か、人ごとに違う中身（personal）か。 */
  audience: RouteAudience;
  /** HTML に記事ごとのメタタグ（SNS のカード・検索）が要るか。 */
  needsOgp: boolean;
  /** 鮮度の要件（画面の文。判定の値はシナリオの満足度の freshness）。 */
  freshness: string;
  /** ページの中の動きのある部品（画面の文）。 */
  parts: string[];
};

/**
 * テンプレートのルートの見る人。テンプレートの決まり（ISR・静的のルート = 全員に同じ中身の記事、SSR のルート = 個人化。
 * toSpa・toAstro が前から使ってきた読み方）で決める。性質をテンプレートのデータに書くのは段 3（prd/13 RS-17）。
 */
export function routeAudience(
  r: {
    id?: string;
    rendering: WorkloadInput['routes'][number]['rendering'];
  },
  /** テンプレートのルートの性質（あればこちらを使う。D-107）。 */
  traits?: Readonly<Record<string, RouteTraits>>,
): RouteAudience {
  const t = r.id !== undefined ? traits?.[r.id] : undefined;
  if (t) return t.audience;
  return r.rendering === 'isr' || r.rendering === 'static'
    ? 'public'
    : 'personal';
}

/**
 * フレームワークごとの既定の描き方（見る人ごと。D-106）。Astro の記事は投稿・編集で消す（D-103）。消せない事業者では
 * 期限で取り直す（cached-ttl。route-capability.ts の defaultStrategy が対応表で落とす）。
 */
export const FRAMEWORK_PRESETS: Readonly<
  Record<FrameworkId, Record<RouteAudience, RouteStrategyId>>
> = {
  nextjs: { public: 'cached-ttl', personal: 'ssr' },
  astro: { public: 'cached-purge', personal: 'ssr' },
  'nextjs-export': { public: 'static-build', personal: 'shell-api' },
  'vite-spa': { public: 'shell-api', personal: 'shell-api' },
};

/**
 * 1 つのルートの描き方の選択。cacheContent: S5 で、全員に同じ中身の API の応答をキャッシュする（期間はルートの再検証の間隔。D-37）。
 * shellPerPage: S5 で、枠を記事ごとに静的に書き出す（ページごとの枠。D-109・perPageShell）。枠は S1 と同じくビルドで作り、
 * 閲覧のたびに読む。枠に記事ごとのメタタグが入る（SNS のカードが出る）。中身はブラウザが API で取る。
 */
export type RouteChoice = {
  strategy: RouteStrategyId;
  cacheContent?: boolean;
  shellPerPage?: boolean;
};

/** ルートの id → 描き方。載っていないルートはテンプレートのまま。 */
export type RoutePlan = Readonly<Record<string, RouteChoice>>;

/** フレームワークの既定の描き方をルートごとに並べたもの（事業者で落とす前）。 */
export function presetPlan(
  routes: WorkloadInput['routes'],
  framework: FrameworkId,
  options: { cacheContent?: boolean } = {},
): RoutePlan {
  return Object.fromEntries(
    routes.map((r) => {
      const audience = routeAudience(r);
      const strategy = FRAMEWORK_PRESETS[framework][audience];
      return [
        r.id,
        // 個人化した中身の応答はキャッシュしない（D-37）
        strategy === 'shell-api' &&
        options.cacheContent &&
        audience === 'public'
          ? { strategy, cacheContent: true }
          : { strategy },
      ];
    }),
  );
}

/**
 * S6（枠 + サーバーの島）の数え方の値（D-108・prd/13 §8。**ゲーム上の仮定**・出典なし）。
 * - islandShare: 島を描く CPU（と、Astro の島の応答の大きさ）の、ページ全体の SSR に対する割合。人ごとに違う部分（通知・一覧など）
 *   だけを描く。DB の問い合わせ・I/O 待ちはすべて島の側。フレームワークごとの描画の倍率は 1 のまま（RS-06）。
 * - 枠（Astro）: 島を除いた残り（1 − islandShare）を描き、人ごとに違わないので事業者の置き場にキャッシュする（S2 の経路）。
 *   枠はデプロイでしか変わらないので 1 日の期限で取り直す。キャッシュから返す CPU は記事のページの cachedServeCpuMs と同じ 2 ms。
 */
export const SERVER_ISLAND = {
  islandShare: 0.4,
  shellRevalidateSeconds: 86_400,
  shellCachedServeCpuMs: 2,
} as const;

/**
 * 島の届け方（D-108・prd/13 §8.2）。request: 枠とは別のリクエスト（Astro の Server Islands は島を GET で取る）。
 * stream: 枠と同じ応答の中（Next.js の PPR は静的な枠を先に流し、動的な部分を同じ応答で続けて流す）。
 * PPR の枠を CDN から配るのはアダプター・CDN の実装しだいなので仮定せず、閲覧ごとに処理を通して島の分だけ描く（origin だけの形）。
 * S6 の無いフレームワークは undefined。
 */
export function serverIslandDelivery(
  framework: FrameworkId,
): 'request' | 'stream' | undefined {
  return framework === 'astro'
    ? 'request'
    : framework === 'nextjs'
      ? 'stream'
      : undefined;
}

/**
 * 全員に同じ中身のページの S5 を、ページごとの枠（記事ごとに静的に書き出す枠 + ブラウザが API で中身を取る）にするフレームワークか
 * （D-109）。Next.js（generateStaticParams で書き出すページに、中身を取る Client Component を置く）・Astro（getStaticPaths で書き出す
 * ページに、中身を取るアイランドを置く）・Next.js の静的書き出し（output: 'export'）は、ページごとの HTML を書き出せる。
 * Vite の SPA は 1 つのシェル（index.html）だけなので入口だけの形のまま（SNS のカードは前処理の部品）。
 * 書き出しは S1 と同じ仕組みなので、その事業者で S1 を選べることも条件にする（呼ぶ側が対応表で確かめる）。
 */
export function perPageShellFramework(framework: FrameworkId): boolean {
  return framework !== 'vite-spa';
}

/** 描き方を Workload に当てるときに要る形（テンプレートの既定値。S1 のビルド・S5 の API・S6 の島の届け方）。 */
export type RouteStrategyContext = {
  /** S6（枠 + サーバーの島）の届け方（serverIslandDelivery）。 */
  island?: 'request' | 'stream';
  /** S5（枠 + API）の形。 */
  spa?: SpaShape;
  /** S1（静的）の 1 回のビルドの時間の式。 */
  minutesPerBuild?: AstroShape['minutesPerBuild'];
  /** S1 のビルドを起こす内容の更新（間隔の省略は更新のたび）。 */
  build?: { updatesPerMonth: number; intervalSeconds?: number };
};

type Route = WorkloadInput['routes'][number];

/** ルートの部品が呼ぶ API（apiCalls。D-109）を、書き換えた後のルートに引き継ぐ。 */
const parts = (r: Route) =>
  r.apiCalls !== undefined ? { apiCalls: r.apiCalls } : {};

/**
 * ルートごとの描き方を Workload に当てる（D-106）。テンプレートのルート（isr = 全員に同じ中身・ssr = 個人化）から書き換える。
 * - S1: isr → static。静的なページがあればビルド（updatesPerMonth・間隔・時間）を足す。
 * - S2・S3: isr のまま（数え方は ISR と同じ。期限かオンデマンドかはルートの値で、呼ぶ側が先に付ける。RS-05）。
 * - S4: ssr のまま。isr なら ssr に（ISR のキャッシュの部品「なし」と同じ書き換え）。
 * - S5: isr・ssr → spa（中身はデータの API。CPU は SSR の dataCpuFactor 倍）。静的・spa のルートはそのまま。
 *   ページごとの枠（shellPerPage。isr のルートだけ）は枠を閲覧のたびに読み（shellPerView）、S1 と同じくビルドを足す（D-109）。
 * - S6: ssr のルート（人ごとに違うページ）だけ（D-108）。Astro（request）は ssr → isr の枠（期限 1 日）+ 閲覧ごとの島のリクエスト
 *   （island.request）。Next.js の PPR（stream）は ssr のまま、CPU を島の分（islandShare 倍）にして island を付ける。
 * まだ数え方の無い組（個人化のルートをキャッシュ・静的にする、全員に同じページの S6）は例外にする。
 */
export function applyRouteStrategies(
  w: WorkloadInput,
  plan: RoutePlan,
  ctx: RouteStrategyContext = {},
): WorkloadInput {
  let staticPages = 0;
  const routes = w.routes.map((r): Route => {
    const choice = plan[r.id];
    if (!choice) return r;
    const unsupported = () =>
      new Error(
        `描き方 ${choice.strategy} をルート ${r.id}（${r.rendering}）に当てる数え方はまだ無い`,
      );
    switch (choice.strategy) {
      case 'static-build':
        if (r.rendering === 'static') return r;
        if (r.rendering !== 'isr') throw unsupported();
        staticPages += r.pages;
        return {
          id: r.id,
          ...(r.label !== undefined ? { label: r.label } : {}),
          rendering: 'static' as const,
          share: r.share,
          pages: r.pages,
          processing: r.processing,
          ...parts(r),
        };
      case 'cached-ttl':
      case 'cached-purge':
        if (r.rendering !== 'isr') throw unsupported();
        return r;
      case 'ssr':
        if (r.rendering === 'ssr') return r;
        if (r.rendering !== 'isr') throw unsupported();
        return { ...r, rendering: 'ssr' };
      case 'shell-api': {
        if (r.rendering === 'static' || r.rendering === 'spa') return r;
        const shape = ctx.spa;
        if (!shape) throw new Error('S5（枠 + API）には SPA の形（spa）が要る');
        if (choice.shellPerPage) {
          if (r.rendering !== 'isr') throw unsupported();
          staticPages += r.pages;
        }
        return {
          id: r.id,
          ...(r.label !== undefined ? { label: r.label } : {}),
          rendering: 'spa' as const,
          share: r.share,
          pages: r.pages,
          shellKB: shape.shellKB,
          ...parts(r),
          // ページごとの枠（D-109）: 記事ごとの枠を静的に書き出し、閲覧のたびに読む。枠はビルドで作る（S1 と同じビルド）
          ...(choice.shellPerPage ? { shellPerView: true } : {}),
          ...(choice.cacheContent &&
          r.rendering === 'isr' &&
          r.revalidateSeconds !== undefined
            ? { cacheSeconds: r.revalidateSeconds }
            : {}),
          processing: {
            ...r.processing,
            cpuMs: r.processing.cpuMs * shape.dataCpuFactor,
            responseKB: shape.dataResponseKB,
          },
        };
      }
      case 'server-island': {
        if (r.rendering !== 'ssr') throw unsupported();
        const delivery = ctx.island;
        if (!delivery)
          throw new Error('S6（サーバーの島）には島の届け方（island）が要る');
        const p = r.processing;
        const k = SERVER_ISLAND.islandShare;
        if (delivery === 'stream')
          return {
            ...r,
            processing: { ...p, cpuMs: p.cpuMs * k },
            island: {},
          };
        return {
          id: r.id,
          ...(r.label !== undefined ? { label: r.label } : {}),
          rendering: 'isr' as const,
          share: r.share,
          pages: r.pages,
          revalidateSeconds: SERVER_ISLAND.shellRevalidateSeconds,
          ...parts(r),
          cachedServeCpuMs: SERVER_ISLAND.shellCachedServeCpuMs,
          // 枠: 島を除いた残りを描く（DB は読まない）
          processing: {
            cpuMs: p.cpuMs * (1 - k),
            ioWaitMs: 0,
            queries: 0,
            rowsReadPerQuery: 0,
            responseKB: p.responseKB * (1 - k),
          },
          island: {
            request: {
              ...p,
              cpuMs: p.cpuMs * k,
              responseKB: p.responseKB * k,
            },
          },
        };
      }
    }
  });
  if (staticPages === 0) return { ...w, routes };
  const { minutesPerBuild, build } = ctx;
  if (!minutesPerBuild || !build)
    throw new Error(
      'S1（静的）にはビルドの時間（minutesPerBuild）と更新（build）が要る',
    );
  return {
    ...w,
    routes,
    build: {
      updatesPerMonth: build.updatesPerMonth,
      ...(build.intervalSeconds !== undefined
        ? { intervalSeconds: build.intervalSeconds }
        : {}),
      minutesPerBuild: buildMinutes(minutesPerBuild, staticPages),
    },
  };
}

/** 1 回のビルドの時間（分）= base + 静的なページ 1,000 あたり perThousandPages（ゲーム上の仮定。D-68）。 */
export function buildMinutes(
  m: AstroShape['minutesPerBuild'],
  staticPages: number,
): number {
  return m.base + (staticPages / 1000) * m.perThousandPages;
}
