// アプリのテンプレート（prd/README のスコープ・企画書 §4.2）。値はすべてテンプレートの既定値（template-default）で、
// 実測ではない。コストに効く値は判断ポイント（prd/01 §8）として選択肢にする（D-11）。
import type { WorkloadInput } from 'estimator';
import type { AstroShape, RouteTraits, SpaShape } from '../frameworks/index.ts';

/**
 * 記事のコミュニティの 1 日の時間帯の形（0 時〜23 時の重み。D-89）。ゲーム上の仮定（出典なし）: 朝の通勤・昼休みに小さな山、
 * 夜（20〜22 時）に最も多く、深夜 2〜5 時は少ない。平日の最も多い時間は平均の約 2.2 倍で、peakHourFactor（2.5。短い山も含む）を超えない。
 */
export const ARTICLE_HOURLY_PROFILE: readonly number[] = [
  4, 2.5, 1.5, 1, 0.8, 1, 2, 3.5, 4, 4, 4, 4.5, 6, 5, 4.5, 4.5, 5, 5.5, 6, 7,
  8.5, 9.5, 9, 6.5,
];

/**
 * 記事 + コメントのコミュニティ（Next.js 製を想定）。スパイク（spikes/concept-2026-10-31）と同じ仮定。
 * 記事ページは ISR（60%）、個人化されたページは SSR（40%）。
 * @param monthlyPageViews 月間 PV（MAU からの導出を上書きする）
 */
/**
 * 記事コミュニティのページの性質（D-107・RS-17。値はシナリオの満足度の freshness と同じ意味の文。ゲーム上の仮定）。
 */
export const ARTICLE_COMMUNITY_ROUTES: Readonly<Record<string, RouteTraits>> = {
  article: {
    audience: 'public',
    needsOgp: true,
    freshness:
      '投稿・編集が 5 分以内に見えると良いです（1 時間以内なら普通）。新しい記事は投稿した人がすぐ開けます',
    parts: ['コメント欄', 'いいね', 'ログインの表示'],
  },
  personal: {
    audience: 'personal',
    needsOgp: false,
    freshness: '自分の書き込みがすぐ見えます',
    parts: ['記事の投稿・編集', '通知'],
  },
};

/**
 * 記事のページの画像（D-121。ゲーム上の仮定・出典なし）。D-83 までは 1 PV に 5 枚・全部同じ大きさ（サイズ違いを混ぜた平均）・
 * ブラウザでの再利用 0.5 で、個人向けのページにも同じ枚数を数えていた。見取り図の区画に合わせて分けた:
 * - 本文の画像: 記事 1 本に 5 枚（見取り図の「本文の画像（5 枚）」）。大きさは画像の形式で決まる 1 枚（本文の幅のサイズ違い。
 *   JPEG 150 KB・WebP 105 KB。D-58）。個人向けのページ（プロフィール・通知・自分の記事の一覧）には載せない。
 * - 関連記事のサムネイル: 記事のページの下に 4 枚（関連記事 2・人気の記事 2）。サイズ違いの「サムネイル」（D-83 の 3 種の 1 つ）で、
 *   幅が本文の約 1/4・面積が約 1/16 だが、小さい画像は圧縮が効きにくいので本文の 1 枚の 0.1 倍とする。
 *   サイズ違いを作らない（1 種・一律で縮める・原本のまま）と、本文と同じファイルを配る。
 */
export const ARTICLE_BODY_IMAGES = 5;
export const ARTICLE_THUMBNAILS = 4;
export const ARTICLE_THUMBNAIL_SIZE_RATIO = 0.1;
/**
 * ブラウザのキャッシュから出す割合（D-121。ゲーム上の仮定・出典なし）。シナリオの仮定から次のように置く:
 * - 本文の画像: 同じ人が同じ記事を開き直す割合（戻る・コメントの返信を見に来る）。記事の閲覧の 5 回に 1 回とみなし 0.2。
 * - サムネイル: 人気の記事の 2 枚はどの記事のページにも同じものが並び、1 人が月に開く記事のページ（10 PV × 記事 0.6 = 約 6）の
 *   最初の 1 回だけ取りに行く（1 − 1/6 ≈ 0.83）。関連記事の 2 枚は記事ごとに違い、本文と同じ 0.2。平均して 0.5。
 */
export const ARTICLE_IMAGE_REUSE = { body: 0.2, thumbnails: 0.5 } as const;
/** 記事の閲覧の偏り（Zipf の指数 s。順位 k の記事の閲覧 ∝ k^(−s)。ゲーム上の仮定・出典なし。D-121）。 */
export const ARTICLE_ZIPF_EXPONENT = 1;

export function articleCommunity(monthlyPageViews: number): WorkloadInput {
  const page = {
    cpuMs: 15,
    ioWaitMs: 65,
    queries: 3,
    rowsReadPerQuery: 20,
    responseKB: 60,
  };
  return {
    commercial: true,
    traffic: {
      // MAU は画像のアップロード件数の導出に使う（PV は上書き）。1 MAU あたり月 10 PV 程度を想定
      mau: monthlyPageViews / 10,
      dauPerMau: 0.2,
      sessionsPerDau: 1,
      pagesPerSession: 2,
      weekdayToWeekend: 1.3,
      peakHourFactor: 2.5,
      hourlyProfile: [...ARTICLE_HOURLY_PROFILE],
      monthlyPageViewsOverride: monthlyPageViews,
    },
    routes: [
      {
        id: 'article',
        label: '記事のページ',
        rendering: 'isr',
        share: 0.6,
        pages: 2_000,
        revalidateSeconds: 300,
        processing: page,
        cachedServeCpuMs: 2,
        // 記事のページの部品（コメント欄・いいね）がブラウザから呼ぶ API: 閲覧 1 回に 1 回（読み込みと投稿。perPage.apiCalls と
        // 同じ値を記事のルートに付けた。記事のページをどう描いても同じで、コメントを HTML に含めると読み込みの分が無くなる。D-109・RS-02）
        apiCalls: 1,
        // 記事の閲覧は人気の記事に偏る（Zipf・指数 1。ゲーム上の仮定・出典なし。D-121）。ISR・記事のキャッシュのヒット率に効く
        zipfExponent: ARTICLE_ZIPF_EXPONENT,
        // 記事のページに載る画像（見取り図の「本文の画像」「関連記事のサムネイル」。D-121）
        images: ARTICLE_BODY_IMAGES,
        thumbnails: ARTICLE_THUMBNAILS,
      },
      {
        id: 'personal',
        label: '個人向けのページ',
        rendering: 'ssr',
        share: 0.4,
        pages: 1,
        processing: page,
      },
    ],
    // 画像は記事のページだけに載る（ルートの images・thumbnails）。個人向けのページ（プロフィール・通知・自分の記事の一覧）には載せない（D-121）
    perPage: { apiCalls: 1, assets: 10, images: 0, thumbnails: 0 },
    api: {
      cpuMs: 5,
      ioWaitMs: 35,
      queries: 1,
      rowsReadPerQuery: 10,
      responseKB: 5,
      writesPerCall: 0.1,
      rowsWrittenPerWrite: 3,
    },
    assets: { sizeKB: 40, browserReuse: 0.7 },
    images: {
      sizeKB: 150,
      browserReuse: ARTICLE_IMAGE_REUSE.body,
      thumbnails: {
        sizeKB: 150 * ARTICLE_THUMBNAIL_SIZE_RATIO,
        browserReuse: ARTICLE_IMAGE_REUSE.thumbnails,
      },
      distinct: 5_000,
      variants: 3,
      storedGB: 20,
      uploadsPerMau: 0.01,
    },
    db: { sizeGB: 0.3, responseKBPerQuery: 2 },
    // メール（D-95。ゲーム上の仮定・出典なし）: 登録の確認・パスワードの再設定などを利用者の 2%（月）、
    // コメント・返信の通知を書き込み 10 回に 1 通（書き込みにはいいね・下書きも含み、通知を受ける設定の人だけに送る）
    email: { perMau: 0.02, perWrite: 0.1 },
  };
}

export {
  BUSINESS_APP_ROUTES,
  businessApp,
  BUSINESS_APP_ASTRO,
  BUSINESS_APP_SPA,
} from './business-app.ts';

/**
 * 記事コミュニティを Vite の SPA で作ったときの形（prd/10。template-default・実測ではない）。
 * シェル 5 KB、記事・個人化の中身を返す API は HTML を描かない分 SSR の半分の CPU・応答 10 KB と仮定。
 * ⚠ dataCpuFactor で Cloudflare Free の 1 リクエスト CPU 10 ms に当たるかが決まる（SSR 15 ms × 0.5 = 7.5 ms。prd/10 B-5）。
 */
export const ARTICLE_COMMUNITY_SPA: SpaShape = {
  shellKB: 5,
  dataCpuFactor: 0.5,
  dataResponseKB: 10,
};

/**
 * 記事コミュニティを Astro で作ったときの形（D-68。template-default・実測ではない）。
 * - JS・CSS: 動きのある部品（コメント欄・いいね・ログインの表示）だけがアイランドで、ページあたりのファイル数は Next.js の 0.3 倍。
 * - 記事は閲覧のときに描いてキャッシュし、投稿・編集で消す（D-103）ので、記事のためのビルドし直しは無い。
 * - 1 回のビルドの時間: 1 分（依存の取得・デプロイ）+ 静的なページ 1,000 あたり 0.5 分（記事 2,000 ページで 2 分）。
 *   今は Next.js の静的書き出しのビルドの時間に使う（D-80）。
 */
export const ARTICLE_COMMUNITY_ASTRO: AstroShape = {
  assetsFactor: 0.3,
  minutesPerBuild: { base: 1, perThousandPages: 0.5 },
};
