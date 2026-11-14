// 満足度の段階の理由・SNS のカード・満足度の平均。
import type { Scenario } from '../scenario.ts';
import type { Element, Stages } from '../rules.ts';
import type { PlatformPremise } from 'estimator';
import {
  articleShellPerPage,
  publicRoute,
  routeFamily,
} from '../routes/strategy.ts';
import {
  ASTRO_ON_DEMAND,
  isOnDemand,
  NEXT_ON_DEMAND,
  optionLabel,
  type Settings,
} from '../settings.ts';
import type { GameState, MonthReport, RouteOverrides } from '../state.ts';

/**
 * 記事ごとの SNS のカードが出ないか（記事のページが枠 + API（S5）で、OGP の前処理なし。prd/10 F-05・D-107）。
 * OGP の前処理の部品は SPA だけにある。Next.js・Astro・静的書き出しの記事の S5 は記事ごとの枠（メタタグ入り）なのでカードは出る（D-109）。
 */
export function noSocialCards(
  state: Pick<
    GameState,
    'framework' | 'components' | 'scenario' | 'stackIndex'
  > & {
    routes?: RouteOverrides | undefined;
  },
): boolean {
  const r = publicRoute(state.scenario);
  if (!r)
    return (
      state.framework === 'vite-spa' && state.components.ogp !== 'prerender'
    );
  const needsOgp = state.scenario.routeTraits[r.id]?.needsOgp ?? true;
  return (
    needsOgp &&
    routeFamily(state, r.id) === 'api' &&
    !articleShellPerPage(state) &&
    state.components.ogp !== 'prerender'
  );
}

/** メールが届かない月の機能の理由と注記の書き出し（D-117）。 */
export const EMAIL_UNDELIVERED_REASON =
  'メールの送信の上限に達し、登録の確認・パスワードの再設定・通知のメールが届かない日がありました';

/** 理由の文に出す数（浮動小数の誤差を見せない。小数 1 桁まで）。 */
const num = (x: number) => Number(x.toFixed(1));

/**
 * 当たったメールの送信の前提から、判定の日に届かなかったメールの割合（上限を超えた分 = 1 − 上限 / 通数。最も大きいもの。D-117）。
 * 割合の分からない前提（ratio が無い）は全部届かないとみる。
 */
export function undeliveredShare(
  undelivered: readonly Pick<PlatformPremise, 'ratio'>[],
): number {
  return undelivered.reduce((a, p) => {
    const r = p.ratio;
    const share =
      r === undefined || !Number.isFinite(r) ? 1 : r > 1 ? 1 - 1 / r : 0;
    return Math.max(a, share);
  }, 0);
}

export function stageReasons(
  sc: Scenario,
  stages: Stages,
  c: {
    blocking: PlatformPremise[];
    /** 当たって送れなくなったメールの送信の前提（機能の理由に出す。D-117）。 */
    undelivered?: PlatformPremise[];
    throttling: PlatformPremise[];
    /** 定額のプランの込みを超えて性能が調整された前提（D-61）。 */
    adjusted: PlatformPremise[];
    incident: boolean;
    switching: boolean;
    ssrCpuMs: number;
    /** SPA（速さの理由を「API の CPU・初回表示」で書く）。 */
    spa: boolean;
    /** フレームワークが SPA か（速さの文。記事の描き方の spa と分ける。D-107）。 */
    spaFramework?: boolean;
    /** Next.js の静的書き出し（速さは Next.js と同じ扱いで、理由を「API を待つブラウザの描画」で書く。D-80）。 */
    apiOnly?: boolean;
    /** 記事をビルドし直す（Next.js の静的書き出し。反映スピードの理由を「ビルドの間隔」で書く。D-80）。 */
    rebuilds?: boolean;
    /** Astro（反映スピードの理由を「記事のキャッシュの期限」で書く。D-103）。 */
    astro?: boolean;
    settings: Settings;
    heaviness: number;
    featurePoints: number;
    month: number;
    imagesUnoptimized: boolean;
    /** 1 ページの通信量の表示（速さの理由に添える。D-47）。 */
    pageWeight: string;
    /** 画質を下げた理由（記事のデザインの刷新。D-47）。 */
    qualityReason?: string | undefined;
    eventuallyConsistent: boolean;
    /** HTML を前段の CDN でもキャッシュし、時間で再検証している（更新は最大で間隔の約 2 倍遅れる。D-91）。 */
    frontDelayed?: boolean;
    uncached: boolean;
    /** ビルドし直す形の 1 回のビルドの時間（秒。反映スピードの遅れに足す。D-104）。 */
    buildDelaySec?: number;
    /** 記事ごとの枠（S5）をビルドで書き出す（新しい記事の理由を「枠のビルド」で書く。D-109）。 */
    shellBuilds?: boolean;
    /** 新しい記事がビルドまで開けず、投稿した人の許容を超える（D-104）。 */
    newPostDelayed?: boolean;
    /** コメントを記事のページに含め、時間で再検証・ビルドしている（コメントが間隔の分だけ遅れて見える。D-85）。 */
    commentsDelayed?: boolean;
    onDemandReason?: string | undefined;
    /** コンテナの冷えた起動を待つ閲覧の割合（速さの重さに数えたときだけ。D-88）。 */
    coldShare?: number | undefined;
  },
): Partial<Record<Element, string>> {
  const out: Partial<Record<Element, string>> = {};
  if (stages.availability !== 'good')
    out.availability = c.blocking.length
      ? `止まった: ${c.blocking[0]!.text}`
      : c.incident
        ? '偶発的な障害（数時間）'
        : '乗り換えの切り替え';
  if (stages.speed !== 'good')
    out.speed = c.throttling.length
      ? `上限に達しました: ${c.throttling[0]!.text}`
      : (c.spaFramework ?? c.spa)
        ? `重さ ${c.heaviness}（SPA の初回表示・API ${num(c.ssrCpuMs)} ms・画像 ${num(c.settings.imageKB)} kB・${c.pageWeight}）`
        : c.apiOnly
          ? `重さ ${c.heaviness}（API を待つブラウザの描画 ${num(c.ssrCpuMs)} ms 相当・画像 ${num(c.settings.imageKB)} kB・${c.pageWeight}）`
          : `重さ ${c.heaviness}（SSR ${num(c.ssrCpuMs)} ms・画像 ${num(c.settings.imageKB)} kB・${c.pageWeight}）`;
  if (
    stages.speed !== 'good' &&
    c.coldShare !== undefined &&
    !c.throttling.length
  )
    out.speed = `${out.speed}・閲覧の ${Math.round(c.coldShare * 100)}% がコンテナの冷えた起動を待ちます（最小インスタンス 0）`;
  if (stages.quality !== 'good')
    out.quality = c.qualityReason ?? `画像 ${num(c.settings.imageKB)} kB`;
  if (stages.freshness !== 'good')
    out.freshness = [
      !c.uncached &&
        (c.spa || c.rebuilds || !isOnDemand(c.settings)) &&
        (c.spa
          ? `API のキャッシュの期間 ${optionLabel('apiCacheTtl', c.settings.revalidateSec)}`
          : c.rebuilds
            ? `ビルドの間隔 ${optionLabel('buildInterval', c.settings.revalidateSec)} + ビルドの時間 約 ${Math.round((c.buildDelaySec ?? 0) / 60)} 分`
            : c.astro
              ? `記事のキャッシュの期限 ${optionLabel('pageCache', c.settings.revalidateSec)}`
              : `ISR の間隔 ${optionLabel('isr', c.settings.revalidateSec)}`),
      c.eventuallyConsistent &&
        'KV を DB の代わりにしているか、HTML を前段の CDN でキャッシュしていて（キャッシュを消せない）、更新がすぐ見えません',
      c.frontDelayed &&
        `HTML を前段の CDN でもキャッシュしているので、更新は最大で間隔の約 2 倍遅れて見えます（${c.astro ? ASTRO_ON_DEMAND : NEXT_ON_DEMAND} でキャッシュを消せば遅れない）`,
      c.newPostDelayed &&
        (c.shellBuilds
          ? '新しく投稿された記事は、記事ごとの枠のビルドが終わるまでページが無く、投稿した人がすぐ開けません（コミュニティの要件を満たさない）'
          : '新しく投稿された記事はビルドが終わるまでページが無く、投稿した人がすぐ開けません（コミュニティの要件を満たさない）'),
      c.commentsDelayed &&
        'コメントを記事のページに含めているので、コメントも間隔の分だけ遅れて見えます',
      c.onDemandReason,
    ]
      .filter(Boolean)
      .join('・');
  if (stages.speed !== 'good' && c.adjusted.length)
    out.speed = `配信の性能が調整された: ${c.adjusted[0]!.text}・${out.speed}`;
  if (c.imagesUnoptimized && out.speed && !c.throttling.length)
    out.speed += '（画像を最適化していない）';
  if (stages.feature !== 'good') {
    const ft = sc.satisfaction.feature;
    const expected = ft.expectedPerMonth * c.month;
    const mail = c.undelivered?.[0];
    out.feature = [
      // メールが届かないだけで下がった月は、機能開発の行を出さない（D-117）
      (!mail || c.featurePoints / expected < ft.good) &&
        `機能開発 ${c.featurePoints} / 期待 ${expected}`,
      mail &&
        `${EMAIL_UNDELIVERED_REASON}（その日の約 ${Math.round(undeliveredShare(c.undelivered ?? []) * 100)}% が届きません。${mail.text}）`,
    ]
      .filter(Boolean)
      .join('・');
  }
  return out;
}

export function averageSatisfaction(history: readonly MonthReport[]): number {
  return history.length
    ? history.reduce((a, r) => a + r.satisfaction.score, 0) / history.length
    : 0;
}
