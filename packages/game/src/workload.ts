// Workload の組み立て（テンプレート + 設定 + 部品 + 描き方 + 一時的な増加）と、構成の入力（architectureFor・staticBuildOf）。
import type { Scenario, Stock, WorkloadMods } from './scenario.ts';
import {
  applyComponentsToWorkload,
  applyRouteStrategies,
  type Choices,
  composeStack,
  DEFAULT_CHOICES,
  type FrameworkId,
  type Platform,
  serverIslandDelivery,
  STACK_DEFS,
  withAstroAssets,
} from 'catalog';
import {
  apiCallsPerMonth,
  type ArchitectureInput,
  type EstimateResult,
  type WorkloadInput,
} from 'estimator';
import { commentsInPage, commentsOf } from './routes/comments.ts';
import {
  articleFamily,
  articleShellPerPage,
  routeChoices,
  strategyFamily,
  validRouteOverrides,
} from './routes/strategy.ts';
import {
  autoImageFormat,
  COMMENT_PAGES_PER_UPDATE,
  deliveredImageKB,
  imageFormatOf,
  isOnDemand,
  type Settings,
  usesNextImage,
} from './settings.ts';
import type { RouteOverrides, RouteParts, StrategyFamily } from './state.ts';

/** Workload を組み立てる入力（反実仮想の見積でも同じ関数を使う）。 */
export type WorkloadParts = {
  pv: number;
  settings: Settings;
  ssrCpuMs: number;
  mods: WorkloadMods;
  stock: Stock | null;
  platform: Platform;
  components: Choices;
  framework: FrameworkId;
  /** 選んだページごとの描き方（D-107。省略はフレームワークの既定）。 */
  routes?: RouteOverrides | undefined;
  /** ページの部品の選択（記事のページのコメント欄。D-109。省略はブラウザで読み込む）。 */
  routeParts?: RouteParts | undefined;
  /** その月のピークの係数の倍率（繁忙期。D-33）。省略は 1。 */
  peakFactor?: number;
  /** 短い期間に集中する上乗せの PV（話題・Bot。容量の判定だけに効く。D-44）。 */
  spikes?: Spike[];
};

/** 月のうち days 日に集中する上乗せの PV（id は出来事。反実仮想で外すときに使う）。 */
export type Spike = { id: string; extraPV: number; days: number };

const DAYS_PER_MONTH = 730 / 24;

/**
 * 集中する上乗せがあるときのピークの係数の倍率（D-44・prd/04 §5）。上乗せ分 E_i が D_i 日に集中し、その日の時間帯の形
 * （ピーク / 平均）はふだんと同じと仮定すると、ピークの時間帯の量は (N + Σ E_i × 30.4 / D_i) / 30.4 日 × ピーク係数
 * （N は集中しない分の PV）。月の PV で割った倍率を返す（課金は月の総量のまま）。
 */
export function spikePeakFactor(pv: number, spikes: readonly Spike[]): number {
  if (pv <= 0 || spikes.length === 0) return 1;
  const extra = spikes.reduce((a, s) => a + s.extraPV, 0);
  const steady = Math.max(0, pv - extra);
  const peakDay = spikes.reduce(
    (a, s) =>
      a + s.extraPV * (DAYS_PER_MONTH / Math.min(s.days, DAYS_PER_MONTH)),
    0,
  );
  return Math.max(1, (steady + peakDay) / pv);
}

/**
 * オンデマンドの再検証に併せて持つとみなす最大寿命（保険の時間の再検証・秒）。再検証の呼び出しの取りこぼし
 * （webhook の失敗・呼び忘れ・外部データの変化）に備えて、時間の再検証を併せて設定することが多い（1 時間〜1 日など）。
 * 選択肢にはせず、長い側の 1 日とみなす（ゲーム上の仮定。D-56）。
 */
export const ON_DEMAND_MAX_AGE_SEC = 86_400;

/**
 * オンデマンドの再検証で、1 回の内容の更新ごとに再検証を呼ぶページの数（その記事のページと、記事が並ぶ一覧）。
 * CDN のキャッシュの無効化の数に効く（OpenNext の CloudFront。再生成の回数には効かない）。ゲーム上の仮定（D-66）。
 */
export const ON_DEMAND_PAGES_PER_UPDATE = 2;

/**
 * 月の内容の更新の回数（記事のページを作り直す更新。API の書き込み × シナリオの pageUpdateShare。D-49・D-70）と、
 * 1 回の更新で再検証するページの数。オンデマンドの再検証の再生成・無効化（Astro のキャッシュを消す数も同じ）と、静的書き出しのビルドし直しの数のもと。
 * コメントを記事のページに含めると、コメントの投稿（comments.pageUpdateShare）も足し、そのページの数は記事だけ（D-82）。
 */
function pageUpdates(
  sc: Scenario,
  pv: number,
  w: WorkloadInput,
  inPage: boolean,
): { updates: number; pagesPerUpdate: number } {
  const writes = apiCallsPerMonth(w, pv) * w.api.writesPerCall;
  const articles = writes * sc.pageUpdateShare;
  const comments =
    inPage && sc.comments ? writes * sc.comments.pageUpdateShare : 0;
  const updates = articles + comments;
  return {
    updates,
    pagesPerUpdate:
      updates > 0
        ? (articles * ON_DEMAND_PAGES_PER_UPDATE +
            comments * COMMENT_PAGES_PER_UPDATE) /
          updates
        : ON_DEMAND_PAGES_PER_UPDATE,
  };
}

/**
 * コメントを記事のページに含めたときの API（D-82）: 記事のページ（ISR だったルート）を開いたときのコメントの取得
 * （API の読み込み）が無くなる。記事のページの部品の API（ルートの apiCalls。D-109・RS-02）の読み込みはコメントの取得とみなし
 * （ゲーム上の仮定）、残るのは書き込み（コメントの投稿など）の分だけ。書き込みの回数は変えない（呼び出しが減った分、
 * 1 回あたりの書き込みの割合を上げる。書き込みの割合は API 全体で 1 つなので、全体の書き込みが同じになるように直す）。
 */
function withoutCommentFetch(w: WorkloadInput): WorkloadInput {
  const wpc = w.api.writesPerCall;
  if (wpc >= 1) return w;
  const before = apiCallsPerMonth(w, 1);
  const routes = w.routes.map((r) =>
    r.rendering === 'isr'
      ? { ...r, apiCalls: (r.apiCalls ?? w.perPage.apiCalls) * wpc }
      : r,
  );
  const after = apiCallsPerMonth({ ...w, routes }, 1);
  if (after <= 0 || after >= before) return w;
  return {
    ...w,
    routes,
    api: { ...w.api, writesPerCall: (before * wpc) / after },
  };
}

export function workloadFor(sc: Scenario, p: WorkloadParts): WorkloadInput {
  const w = sc.template(Math.round(p.pv));
  const ssr = p.mods.ssrShare;
  w.routes = w.routes.map((r) => ({
    ...r,
    processing: { ...r.processing, cpuMs: p.ssrCpuMs },
    ...(r.rendering === 'isr'
      ? { revalidateSeconds: p.settings.revalidateSec }
      : {}),
    ...(ssr !== undefined
      ? { share: r.rendering === 'ssr' ? ssr : 1 - ssr }
      : {}),
    ...(p.stock && r.rendering === 'isr'
      ? { pages: p.stock.articlePages }
      : {}),
  }));
  const nextImage = autoImageFormat(
    p.platform,
    p.framework,
    { ...DEFAULT_CHOICES[p.platform], ...p.components }.images,
  );
  w.images = {
    ...w.images,
    sizeKB: deliveredImageKB(sc, p.settings, undefined, nextImage),
    variants: p.settings.variants,
    uploadsPerMau: w.images.uploadsPerMau * (p.mods.uploadsFactor ?? 1),
    ...(p.stock
      ? { storedGB: p.stock.imagesGB, distinct: Math.round(p.stock.images) }
      : {}),
  };
  if (p.mods.imagesPerPage !== undefined)
    w.perPage = { ...w.perPage, images: p.mods.imagesPerPage };
  if (p.mods.writesPerCall !== undefined)
    w.api = { ...w.api, writesPerCall: p.mods.writesPerCall };
  if (p.stock) w.db = { ...w.db, sizeGB: p.stock.dbGB };
  if (p.mods.realtime) w.realtime = p.mods.realtime;
  if (p.mods.apiCpuMs !== undefined)
    w.api = { ...w.api, cpuMs: p.mods.apiCpuMs };
  if (p.mods.apiResponseKB !== undefined)
    w.api = { ...w.api, responseKB: p.mods.apiResponseKB };
  // コメントを記事のページに含める（D-82）: コメントの投稿も記事のページを作り直す更新に数え、記事を開いたときのコメントの取得が無くなる
  const inPage = commentsInPage(
    commentsOf(sc, p.routeParts),
    p.framework,
    sc,
    p.routes,
  );
  const { updates, pagesPerUpdate } = pageUpdates(sc, p.pv, w, inPage);
  if (inPage) {
    const v = withoutCommentFetch(w);
    w.routes = v.routes;
    w.api = v.api;
  }
  // オンデマンドの再検証（D-49）: 再生成の回数は、時間でなく内容の更新の回数から出す
  if (isOnDemand(p.settings)) {
    w.routes = w.routes.map((r) => {
      if (r.rendering !== 'isr') return r;
      const { revalidateSeconds: _, ...rest } = r;
      return {
        ...rest,
        onDemandUpdatesPerMonth: updates,
        onDemandMaxAgeSeconds: ON_DEMAND_MAX_AGE_SEC,
        onDemandPagesPerUpdate: pagesPerUpdate,
      };
    });
  }
  // 話題・Bot の上乗せが短い期間に集中する月: その日の量はピークの時間帯（容量。D-44）と、日次の無料枠の判定（D-60）に効く
  const spikeDay = spikePeakFactor(p.pv, p.spikes ?? []);
  const peak = (p.peakFactor ?? 1) * spikeDay;
  if (peak !== 1)
    w.traffic = {
      ...w.traffic,
      peakHourFactor: w.traffic.peakHourFactor * peak,
    };
  if (spikeDay > 1) w.traffic = { ...w.traffic, peakDayFactor: spikeDay };
  // SPA は ISR・SSR のページを、シェル + データの API に書き換える（prd/10 F-01）。
  // API の応答をキャッシュするなら、記事（ISR だったルート）の中身の API に期間（ISR の間隔と同じ値）を付ける（D-37）
  const shape = sc.frameworks?.spa?.shape;
  // Astro の記事（ISR だったルート）は閲覧のときに描いてキャッシュし、投稿・編集で消す（D-103）。数え方は ISR と同じなので
  // ルートは isr のまま（期限・オンデマンドは上で付けた）。JS・CSS はアイランドの分だけ。
  // Next.js の静的書き出しのビルドを起こす更新は、オンデマンドの再検証と同じ数え方の内容の更新、間隔は revalidateSec（オンデマンドは更新のたび）
  const astro = sc.frameworks?.astro?.shape;
  const build = {
    updatesPerMonth: updates,
    ...(isOnDemand(p.settings)
      ? {}
      : { intervalSeconds: p.settings.revalidateSec }),
  };
  // Next.js の静的書き出し（D-80）: 記事は静的にビルドし直し（1 回のビルドの時間は Astro の形の式・仮定）、
  // マイページは SPA と同じく Client Component が API で中身を取る（API の CPU は SPA の dataCpuFactor 倍）
  // ページごとの描き方（D-106）: フレームワークの既定と今の設定・部品で決まる描き方を、ルートごとに当てる
  // （SPA の形・Astro の形の無いシナリオでは、そのフレームワークの書き換えをしない。今までと同じ）
  const plan = routeChoices(sc, w.routes, {
    framework: p.framework,
    platform: p.platform,
    settings: p.settings,
    components: p.components,
    routes: p.routes,
  });
  const uses = (f: StrategyFamily) =>
    Object.values(plan).some((c) => strategyFamily(c.strategy) === f);
  // S5 には SPA の形、S1 にはビルドの時間の式（Astro の形）が要る。無いシナリオではそのフレームワークの書き換えをしない（今までと同じ）
  // S6 の島の届け方（Astro は別のリクエスト・Next.js の PPR は同じ応答の中。D-108）
  const island = serverIslandDelivery(p.framework);
  // 記事ごとの枠（S5。D-109）も S1 と同じくビルドで作る。枠に載るのは記事のメタタグで、中身はブラウザが API で取るので、
  // 間隔でまとめず記事の投稿・編集のたびにビルドする（設定の revalidateSec は API の応答のキャッシュの期間の意味のまま）
  const shellPages = Object.values(plan).some((c) => c.shellPerPage);
  const ready =
    (!uses('api') || shape !== undefined) &&
    (!uses('static') || astro !== undefined) &&
    (!shellPages || astro !== undefined) &&
    (!uses('island') || island !== undefined) &&
    (p.framework !== 'astro' || astro !== undefined);
  const routed = ready
    ? applyRouteStrategies(w, plan, {
        ...(shape ? { spa: shape } : {}),
        ...(astro
          ? {
              minutesPerBuild: astro.minutesPerBuild,
              build: shellPages ? { updatesPerMonth: updates } : build,
            }
          : {}),
        ...(island ? { island } : {}),
      })
    : w;
  // Astro の JS・CSS はアイランドの分だけ（描き方でなくフレームワークの性質）
  const app =
    p.framework === 'astro' && astro ? withAstroAssets(routed, astro) : routed;
  // 部品が Workload の側を変えるもの（キャッシュしない・サイズ違いを作る時・最適化しない。D-24）。
  // Astro は ISR のキャッシュの部品を選ばない（置き場は事業者で決まる。D-103）ので、Next.js のときの「キャッシュしない」を引き継がない
  const out = applyComponentsToWorkload(
    app,
    p.platform,
    componentsForWorkload(p),
    {
      originalImageKB: sc.unoptimizedImageKB,
      resizedImageKB: deliveredImageKB(sc, p.settings, 'resize'),
    },
  );
  return withImageFormat(out, p);
}

/** Workload を変える部品の選択（Astro は ISR のキャッシュのスロットを使わない。D-103）。 */
function componentsForWorkload(p: WorkloadParts): Choices {
  if (p.framework !== 'astro') return p.components;
  const { isrCache: _, ...rest } = p.components;
  return rest;
}

/**
 * 画像の形式の損の側（D-58）。変換の件数（サイズ違いの数）で表す。値の倍率は出典の文から取ったゲーム上の近似。
 * - Vercel の next/image で AVIF: AVIF と WebP を形式ごとにキャッシュする（Next.js の文書）→ 変換を 2 倍に数える
 *   （ほぼすべてのブラウザが AVIF を受けるが、WebP の版も一度は作られると読む）。
 * - VPS のホストで変換して AVIF: 変換に約 50% 長くかかる（Next.js の文書）→ 変換の件数を 1.5 倍（CPU の重さとして）。
 * - 投稿のときにサイズ違いを作る（R2）で WebP・AVIF: JPEG のフォールバックも作って置く（MDN）→ 変換と保存を 2 倍
 *   （フォールバックの大きさは同じとみなす近似）。
 * - Cloudflare Images（閲覧のときに変換）は形式で変換の数が増えない（料金の文書: format は一意の判定から除く）。
 */
function withImageFormat(w: WorkloadInput, p: WorkloadParts): WorkloadInput {
  const format = imageFormatOf(p.settings.imageKB);
  if (format === 'jpeg') return w;
  const images = { ...DEFAULT_CHOICES[p.platform], ...p.components }.images;
  // OpenNext の画像の最適化（Lambda）・Cloud Run の next/image: CDN の外れた分ごとに変換するので、変換 1 回の時間を 1.5 倍にする
  // （OCL-ECDEF8A1・D-63・OCL-CDDD26AB）
  if (
    format === 'avif' &&
    (p.platform === 'aws-opennext' || p.platform === 'gcp') &&
    usesNextImage(p.platform, p.framework, images)
  )
    return { ...w, images: { ...w.images, transformWorkFactor: 1.5 } };
  const factor =
    images === 'r2-variants'
      ? 2
      : format === 'avif' && usesNextImage(p.platform, p.framework, images)
        ? p.platform === 'vercel'
          ? 2
          : 1.5
        : format === 'avif' && p.platform === 'sakura' && images === 'default'
          ? 1.5
          : 1;
  return factor === 1
    ? w
    : { ...w, images: { ...w.images, variants: w.images.variants * factor } };
}

/**
 * 冷えた起動を待つ閲覧の割合（D-88・OCL-554477DF・OCL-151B35E0）。コンテナに届いた要求のうち起動を待つ割合（coldStartShare）に、
 * 閲覧 1 件あたりコンテナに届く要求の数（1 を超えうる）を掛けて閲覧全体の割合に直し、掛けた後に 1 を上限にする。画像の投稿（image-write）は閲覧に
 * 関係しないので数えない。コンテナが複数あれば最大。
 */
export function coldStartViewShare(r: EstimateResult): number {
  const sim = r.simulation;
  const pv = sim.workload.monthlyPageViews;
  if (pv <= 0) return 0;
  return Math.max(
    0,
    ...sim.architecture.nodes.map((n) => {
      const u = sim.nodes[n.id]!;
      if (!u.coldStartShare) return 0;
      const nonView = sim.architecture.routes['image-write']?.includes(n.id)
        ? sim.workload.classes['image-write'].count
        : 0;
      const viewRequests = Math.max(0, (u.resources.requests ?? 0) - nonView);
      return Math.min(1, (u.coldStartShare * viewRequests) / pv);
    }),
  );
}

/** テンプレートの値から在庫の初期値を作る。 */
export function initialStock(sc: Scenario): Stock {
  const w = sc.template(sc.scale.startPV);
  return {
    dbGB: w.db.sizeGB,
    imagesGB: w.images.storedGB,
    images: w.images.distinct,
    articlePages: w.routes.find((r) => r.rendering === 'isr')?.pages ?? 0,
  };
}

export function architectureFor(
  stackIndex: number,
  seats: number,
  framework: FrameworkId,
  components: Choices = {},
  standby: Choices = {},
  storageOption = false,
  /** 選んだ描き方で構成が変わる分（S1 のビルドのノード・Astro の記事のキャッシュの有無。D-107）。 */
  routing: RoutingOptions = {},
): ArchitectureInput {
  const stack = composeStack(STACK_DEFS[stackIndex]!, components, {
    standby,
    storageOption,
    framework,
    ...routing,
  });
  if (seats <= 0) return stack;
  const ids = [
    ...new Set(
      stack.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
  return { ...stack, accounts: ids.map((id) => ({ id, seats: 1 + seats })) };
}

/**
 * 選んだ描き方に、静的にビルドし直すページ（S1。静的書き出しの既定の記事は composeStack が足す）があるか（D-107）。
 * 構成のビルドのノードを足すのに使う。
 */
export function staticBuildOf(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  stackIndex: number,
  framework: FrameworkId,
  routes: RouteOverrides | undefined,
): RoutingOptions {
  if (!routes) return {};
  const valid = validRouteOverrides(sc, stackIndex, framework, routes);
  // 記事ごとの枠（S5。D-109）も S1 と同じくビルドで書き出す
  const staticBuild =
    Object.values(valid).some(
      (x) => x !== undefined && strategyFamily(x) === 'static',
    ) ||
    articleShellPerPage({ scenario: sc, framework, stackIndex, routes: valid });
  // Astro で記事をキャッシュしない（S1・S4・S5）なら、Workers Cache を前に置かない。
  // S6 のページがあれば、その枠をキャッシュするので置く（D-108）
  const island = Object.values(valid).some(
    (x) => x !== undefined && strategyFamily(x) === 'island',
  );
  const noCache =
    framework === 'astro' &&
    !island &&
    articleFamily({ scenario: sc, framework, routes: valid }) !== 'cached';
  return {
    ...(staticBuild ? { staticBuild } : {}),
    ...(noCache ? { pageCache: false } : {}),
  };
}

/** 選んだ描き方で composeStack に渡す分（D-107）。 */
export type RoutingOptions = { staticBuild?: boolean; pageCache?: boolean };
