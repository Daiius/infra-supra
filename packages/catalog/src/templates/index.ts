// アプリのテンプレート（prd/README のスコープ・企画書 §4.2）。値はすべてテンプレートの既定値（template-default）で、
// 実測ではない。コストに効く値は判断ポイント（prd/01 §8）として選択肢にする（D-11）。
import type { WorkloadInput } from 'estimator';
import type { AstroShape, SpaShape } from '../frameworks/index.ts';

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
        rendering: 'isr',
        share: 0.6,
        pages: 2_000,
        revalidateSeconds: 300,
        processing: page,
        cachedServeCpuMs: 2,
      },
      {
        id: 'personal',
        rendering: 'ssr',
        share: 0.4,
        pages: 1,
        processing: page,
      },
    ],
    perPage: { apiCalls: 1, assets: 10, images: 5 },
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
      browserReuse: 0.5,
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
 * - ビルドし直しの回数は内容の更新（記事の投稿・編集。シナリオの値・D-70）と同じ。コメントはアイランドが API で読むのでビルドしない。
 * - 1 回のビルドの時間: 1 分（依存の取得・デプロイ）+ 静的なページ 1,000 あたり 0.5 分（記事 2,000 ページで 2 分）。
 */
export const ARTICLE_COMMUNITY_ASTRO: AstroShape = {
  assetsFactor: 0.3,
  minutesPerBuild: { base: 1, perThousandPages: 0.5 },
};
