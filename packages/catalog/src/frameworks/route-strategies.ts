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
  /** 今のモデルで Workload に当てられるか（S6 は段 5。それまでは表に出すだけ）。 */
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
        '枠は使い回し、人ごとに違う部分だけをサーバーが描く（描く量が減る）',
    },
    modeled: false,
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
 * テンプレートのルートの見る人。テンプレートの決まり（ISR・静的のルート = 全員に同じ中身の記事、SSR のルート = 個人化。
 * toSpa・toAstro が前から使ってきた読み方）で決める。性質をテンプレートのデータに書くのは段 3（prd/13 RS-17）。
 */
export function routeAudience(r: {
  rendering: WorkloadInput['routes'][number]['rendering'];
}): RouteAudience {
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

/** 1 つのルートの描き方の選択。cacheContent: S5 で、全員に同じ中身の API の応答をキャッシュする（期間はルートの再検証の間隔。D-37）。 */
export type RouteChoice = { strategy: RouteStrategyId; cacheContent?: boolean };

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

/** 描き方を Workload に当てるときに要る形（テンプレートの既定値。S1 のビルド・S5 の API）。 */
export type RouteStrategyContext = {
  /** S5（枠 + API）の形。 */
  spa?: SpaShape;
  /** S1（静的）の 1 回のビルドの時間の式。 */
  minutesPerBuild?: AstroShape['minutesPerBuild'];
  /** S1 のビルドを起こす内容の更新（間隔の省略は更新のたび）。 */
  build?: { updatesPerMonth: number; intervalSeconds?: number };
};

type Route = WorkloadInput['routes'][number];

/**
 * ルートごとの描き方を Workload に当てる（D-106）。テンプレートのルート（isr = 全員に同じ中身・ssr = 個人化）から書き換える。
 * - S1: isr → static。静的なページがあればビルド（updatesPerMonth・間隔・時間）を足す。
 * - S2・S3: isr のまま（数え方は ISR と同じ。期限かオンデマンドかはルートの値で、呼ぶ側が先に付ける。RS-05）。
 * - S4: ssr のまま。isr なら ssr に（ISR のキャッシュの部品「なし」と同じ書き換え）。
 * - S5: isr・ssr → spa（中身はデータの API。CPU は SSR の dataCpuFactor 倍）。静的・spa のルートはそのまま。
 * まだ数え方の無い組（個人化のルートをキャッシュ・静的にする、S6）は例外にする（段 3・段 5）。
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
        return {
          id: r.id,
          ...(r.label !== undefined ? { label: r.label } : {}),
          rendering: 'spa' as const,
          share: r.share,
          pages: r.pages,
          shellKB: shape.shellKB,
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
      case 'server-island':
        throw unsupported();
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
