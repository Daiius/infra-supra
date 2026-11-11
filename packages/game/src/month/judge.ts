// playMonth の満足度の段: 構成と設定から満足度の段階・理由を判定し（prd/07 §9.1〜9.3）、評判から PV の伸びを決める。
import {
  apiCacheActive,
  apiPlacedElsewhere,
  astroPageCacheChoice,
  type Choices,
  componentsOf,
  DEFAULT_CHOICES,
  imagesBehavior,
  type Platform,
  termName,
} from 'catalog';
import type { PlatformPremise } from 'estimator';
import {
  COLD_START,
  growthFromReputation,
  judgeStages,
  reputation,
  satisfactionScore,
  speedHeaviness,
  type Stages,
} from '../rules.ts';
import { imageRedesignQuality } from '../events.ts';
import {
  FRONT_CDN_DELAY_FACTOR,
  htmlCachedAtFront,
  onDemandBlocker,
} from '../requirements.ts';
import { commentsInPage, commentsOf } from '../routes/comments.ts';
import { articleFamily, articleShellPerPage } from '../routes/strategy.ts';
import type { Scenario } from '../scenario.ts';
import {
  deliveredImageKB,
  fixedImageFormat,
  IMAGE_FORMAT_KB,
  isOnDemand,
  pageWeightKB,
  pageWeightLabel,
  type Settings,
} from '../settings.ts';
import { nameThen } from '../format.ts';
import type { GameState, MonthReport } from '../state.ts';
import { coldStartViewShare } from '../workload.ts';
import type { MonthEstimate } from './bill.ts';
import {
  EMAIL_UNDELIVERED_REASON,
  stageReasons,
  undeliveredShare,
} from './satisfaction.ts';

export type Reasons = ReturnType<typeof stageReasons>;

export type Judged = {
  stages: Stages;
  reasons: Reasons;
  /** 今の構成の部品（既定の選択に重ねたもの）。 */
  comps: Choices;
  /** 画像の部品の振る舞い（在庫の数え方にも使う）。 */
  imgs: ReturnType<typeof imagesBehavior>;
  notes: string[];
};

/** 満足度の段階と理由を判定する（部品・描き方・設定・当たった前提・障害から）。 */
export function judgeMonth(
  sc: Scenario,
  state: GameState,
  c: {
    month: number;
    platform: Platform;
    r: MonthEstimate;
    ssrCpuMs: number;
    featurePoints: number;
    blocking: PlatformPremise[];
    /** 当たって送れなくなったメールの送信の前提（D-117）。省略は無し。 */
    undelivered?: PlatformPremise[];
    throttling: PlatformPremise[];
    adjusted: PlatformPremise[];
    incident: boolean;
  },
): Judged {
  const { month, r, ssrCpuMs, featurePoints, blocking, throttling, adjusted } =
    c;
  const undelivered = c.undelivered ?? [];
  const platformNow = c.platform;
  const incident = c.incident;
  const stackIndexNow = state.stackIndex;
  const notes: string[] = [];
  const sat = sc.satisfaction;
  // 部品で変わる判定の入力（D-24）: 最適化しない画像は原本の大きさ・キャッシュしないと記事は常に新しい・
  // KV を DB の代わりにすると書き込みがすぐ見えない
  const comps = { ...DEFAULT_CHOICES[platformNow], ...state.components };
  // 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品として見る。D-52）
  const imgs = imagesBehavior(platformNow, comps.images);
  const viewed: Settings = {
    ...state.settings,
    imageKB: deliveredImageKB(
      sc,
      state.settings,
      imgs,
      fixedImageFormat(platformNow, state.framework, comps.images)?.format,
    ),
    // 最適化しない・一律で縮めて置くは、サイズ違いを作らず 1 種を配る（D-47）
    ...(imgs === 'resize' || imgs === 'none' ? { variants: 1 } : {}),
  };
  // 画質: 最適化しないは原本、それ以外は JPEG と同じ見た目（形式では下げない。D-58）。記事のデザインの刷新を断った月・
  // 受けたあと粗い画像（一律で縮めた原本の無い画像）が多い月は 1 段下げる（D-47）
  // 画像の形式は同じ見た目の画質で小さくするので、画質は下げない（D-58）。JPEG の大きさで判定する
  const qualityImageKB =
    imgs === 'none' ? viewed.imageKB : IMAGE_FORMAT_KB.jpeg;
  const redesign = imageRedesignQuality(state, sc, month, imgs);
  // SPA は ISR を持たず、ページの中身を毎回 API で読む（記事は常に新しい。prd/10）。
  // API の応答をキャッシュすると、記事はキャッシュの期間だけ古く見える（ISR の間隔と同じ判定。D-37）
  // 記事のページの描き方（D-107）: 枠 + API（S5）なら SPA と同じ判定、静的（S1）なら静的書き出しと同じ判定、毎回描く（S4）ならキャッシュなし。
  // 記事のページの無いシナリオ（受託）はフレームワークで決める（今までどおり）
  const fam = articleFamily(state);
  const spaFramework = state.framework === 'vite-spa';
  const spa = fam !== undefined ? fam === 'api' : spaFramework;
  const astro = state.framework === 'astro';
  // Next.js の静的書き出し（D-80）: 記事は静的なページ（鮮度はビルドの間隔）、マイページの中身は SPA と同じく API
  const nextExport = state.framework === 'nextjs-export';
  const rebuilds = fam !== undefined ? fam === 'static' : nextExport;
  const ssrArticle = fam === 'ssr';
  // Astro の記事は閲覧のときに描いて事業者の置き場にキャッシュする（D-103）。キャッシュしない形は無く、鮮度は Next.js の ISR と同じ
  // （オンデマンドで消す・期限で取り直す）。置き場は事業者で決まるので、ISR のキャッシュの部品の選択は見ない
  const cacheComps: Choices = astro
    ? { ...comps, isrCache: astroPageCacheChoice(platformNow) }
    : comps;
  const uncached = spa
    ? !apiCacheActive(platformNow, state.components, state.framework)
    : ssrArticle || (!rebuilds && cacheComps.isrCache === 'none');
  // SPA の API の CPU（速さの「SSR の重さ」の代わりに使う。SSR の CPU × dataCpuFactor）。初回表示の重さと速さの CPU は
  // フレームワークの性質のまま（Next.js・Astro のページを S5 にしても、静的書き出しのマイページと同じく SSR の値で見る。D-80・D-107）
  const firstLoad =
    spaFramework && (sc.frameworks?.spa?.firstLoadHeavy ?? false);
  // Astro の初回表示の軽さ（JS はアイランドの分だけ。速さの重さを 1 つ減らす。ゲーム上の仮定・D-68）
  const firstLoadLight =
    astro && (sc.frameworks?.astro?.firstLoadLight ?? false);
  // コンテナの冷えた起動（Cloud Run の最小インスタンス 0。D-88）
  const coldShare = coldStartViewShare(r);
  const coldStart = coldShare >= COLD_START.heavyShare;
  // 静的書き出しのマイページは、サーバーの描画が無い代わりにブラウザが HTML → JS → API の順に待つ。速さ・初回表示は
  // Next.js と同じ扱い（SSR の CPU の値をそのまま重さに使う。ゲーム上の仮定・D-80）
  const serverCpuMs = spaFramework
    ? ssrCpuMs * (sc.frameworks?.spa?.shape.dataCpuFactor ?? 1)
    : ssrCpuMs;
  // API を他の事業者に置いている間は、構成の DB の選択は使われない（DB は API の事業者の部品。OCL-5A7916E6）
  // ISR のページを前段の CDN でもキャッシュし、時間で再検証するなら、CDN は s-maxage（= 間隔）まで写しを返すので、
  // 更新は最大で間隔の約 2 倍遅れて見える（記事・ページに含めたコメントとも。D-91）。オンデマンドでは、再検証と一緒に
  // CDN のキャッシュを消せる部品（さくらの VPS の Cloudflare は Free の purge の API）なら遅れず、消せない部品
  // （AWS の自前の CloudFront）は古いページが残る（D-31 と同じく 1 段下げ、さらに即時反映を満たさない）
  const frontHtml =
    !spa && !rebuilds && !ssrArticle && htmlCachedAtFront(cacheComps);
  const frontDelayed = frontHtml && !isOnDemand(viewed);
  const frontUnpurged =
    frontHtml &&
    isOnDemand(viewed) &&
    componentsOf(platformNow, 'frontCdn').find((o) => o.id === comps.frontCdn)
      ?.onDemandIsr?.ok === false;
  const eventuallyConsistent =
    (comps.db === 'kv' && !apiPlacedElsewhere(comps)) || frontUnpurged;
  // 記事をビルドし直す形（静的書き出し）は、更新が載るまで間隔にビルドの時間を足した分だけ遅れる（オンデマンドでもビルドの時間は待つ。D-104）
  const buildDelaySec = rebuilds
    ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
    : 0;
  const judgedDelaySec =
    (frontDelayed
      ? viewed.revalidateSec * FRONT_CDN_DELAY_FACTOR
      : viewed.revalidateSec) + buildDelaySec;
  // 新しい記事は、ビルドが終わるまでページが無い。投稿した人が開けるまでの許容を超えたら、コミュニティの要件を満たさない（D-104）。
  // 記事ごとの枠（S5。D-109）も枠をビルドで書き出すので、中身は API で常に新しくても、新しい記事は枠のビルドが終わるまで開けない
  const shellBuildSec =
    spa && articleShellPerPage(state)
      ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
      : 0;
  const newPostLimit = sat.freshness.newPostVisibleSec;
  const newPostDelayed =
    newPostLimit !== undefined &&
    ((buildDelaySec > 0 && judgedDelaySec > newPostLimit) ||
      shellBuildSec > newPostLimit);
  // 即時反映（オンデマンド ISR）の要件を満たさない構成（D-32）。再検証の設定をオンデマンドにしたときも、
  // 対応しない部品があると再検証が届かず古いページが出る（同じ判定・同じ理由の文。D-49）
  const onDemandSetting = !spa && isOnDemand(state.settings);
  const onDemand =
    state.requirements.includes('on-demand-isr') || onDemandSetting
      ? onDemandBlocker(stackIndexNow, state.components, state.framework, fam)
      : undefined;
  // コメントを記事のページに含め、時間で再検証・ビルドするなら、コメントは間隔の分だけ遅れて見える（D-85）。
  // オンデマンド（コメントのたびに作り直す）・キャッシュしない（毎回 SSR）なら遅れない。ビルドし直す形はオンデマンドでもビルドの時間は遅れる（D-104）
  const commentsDelayed =
    sc.comments !== undefined &&
    commentsInPage(
      commentsOf(sc, state.routeParts),
      state.framework,
      sc,
      state.routes,
    ) &&
    !uncached &&
    (!isOnDemand(viewed) || buildDelaySec > 0);
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs: serverCpuMs,
      firstLoadHeavy: firstLoad,
      firstLoadLight,
      coldStart,
      imageKB: viewed.imageKB,
      variants: viewed.variants,
      revalidateSec: judgedDelaySec,
      qualityImageKB,
      qualityDown: redesign !== undefined,
      featurePoints,
      month,
      premises: r.premises,
      uncached,
      eventuallyConsistent,
      onDemandUnmet: onDemand !== undefined,
      newPostDelayed,
      ...(commentsDelayed
        ? {
            commentFreshness: {
              delaySec: judgedDelaySec,
              ...sc.comments!.freshness,
            },
          }
        : {}),
      speedDown: adjusted.length > 0,
      emailUndeliveredShare: undeliveredShare(undelivered),
    },
    sat,
  );
  if (undelivered.length)
    notes.push(
      `${EMAIL_UNDELIVERED_REASON}（${undelivered[0]!.text}）。サイトは動いています`,
    );
  if (adjusted.length)
    notes.push(
      'CDN の定額のプランの込みを超え続け、配信の性能が調整されました（請求は増えません。ゲーム上の仮定）',
    );
  const reasons = stageReasons(sc, stages, {
    blocking,
    undelivered,
    throttling,
    adjusted,
    incident,
    switching: state.switching,
    ssrCpuMs: serverCpuMs,
    spa,
    spaFramework,
    apiOnly: nextExport,
    rebuilds,
    astro,
    settings: viewed,
    heaviness: speedHeaviness(
      {
        ...viewed,
        ssrCpuMs: serverCpuMs,
        premises: r.premises,
        firstLoadHeavy: firstLoad,
        firstLoadLight,
        coldStart,
      },
      sat,
    ),
    coldShare: coldStart ? coldShare : undefined,
    featurePoints,
    month,
    imagesUnoptimized: imgs === 'none',
    pageWeight: pageWeightLabel(
      pageWeightKB(
        sc,
        state.settings,
        state.mods,
        imgs,
        fixedImageFormat(platformNow, state.framework, comps.images)?.format,
        state.framework,
      ),
    ),
    qualityReason: redesign,
    eventuallyConsistent,
    frontDelayed,
    uncached,
    buildDelaySec,
    newPostDelayed,
    shellBuilds: shellBuildSec > 0,
    // 遅れがコメントの「良い」の境目を超えたときだけ理由に出す
    commentsDelayed:
      commentsDelayed && judgedDelaySec > sc.comments!.freshness.good,
    onDemandReason: onDemand
      ? state.requirements.includes('on-demand-isr')
        ? `即時反映の要件を満たしていません（${onDemand.label}。${onDemand.reason}）`
        : `${nameThen(termName(state.framework, 'onDemand', '更新で消す再検証'))}が届きません（${onDemand.label}。${onDemand.reason}）`
      : undefined,
  });
  return { stages, reasons, comps, imgs, notes };
}

export type Growth = {
  score: number;
  rep: number;
  acquisition: number;
  churn: number;
  /** 速さが「悪い」月の PV の伸びの減り（0 なら減らない）。 */
  slowPenalty: number;
  /** 話題の月でないときの PV の伸び（評判 + 出来事の上乗せ − 速さの減り）。 */
  net: number;
  /** 速さの減りを足した理由。 */
  reasons: Reasons;
};

/** 満足度の点と評判、そこからの PV の伸び（出来事の上乗せ・速さが悪い月の減りを含む）。 */
export function growthOf(
  sc: Scenario,
  state: GameState,
  c: {
    prev: MonthReport | undefined;
    stages: Stages;
    reasons: Reasons;
  },
): Growth {
  const { prev, stages } = c;
  const score = satisfactionScore(stages, sc.satisfaction.weights);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad', sc.growth);
  const bonus = state.growthBonus.reduce(
    (a, b) => a + (b.months > 0 ? b.add : 0),
    0,
  );
  // 速さが「悪い」月は、離脱と検索からの流入の減りで PV の伸びが下がる（ゲーム上の仮定・D-47）
  const slowPenalty = stages.speed === 'bad' ? (sc.growth.slowPenalty ?? 0) : 0;
  const reasons =
    slowPenalty > 0 && c.reasons.speed
      ? {
          ...c.reasons,
          speed: `${c.reasons.speed}。速さが悪く PV の伸びが約 ${Math.round(slowPenalty * 100)}% 下がりました`,
        }
      : c.reasons;
  const net = g.net + bonus - slowPenalty;
  return {
    score,
    rep,
    acquisition: g.acquisition,
    churn: g.churn,
    slowPenalty,
    net,
    reasons,
  };
}
