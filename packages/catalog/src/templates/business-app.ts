// アプリのテンプレート: 業務の Web アプリ（prd/09 §4・D-33）。値はすべてテンプレートの既定値（template-default）で、
// 実測ではない。フレームワークは決めない（prd/06・AGENTS.md: 見積対象を特定のスタックに寄せない）。
import type { WorkloadInput } from 'estimator';
import type { AstroShape, SpaShape } from '../frameworks/index.ts';

/**
 * 社内・取引先の利用者がログインして使う業務アプリ（申請・一覧・検索・登録）。
 * - ログインが要るので、ページはすべて SSR（ISR・静的なページを持たない）。
 * - 利用者は平日の日中に集中する（平日と休日の比・ピークの係数が大きい）。
 * - 1 ページあたりの API と書き込みが多い。画像は配らず、添付ファイルを「画像」の在庫で表す
 *   （配信は数えず、変換もしない。保存量と投稿の書き込みだけ。prd/09 B-2）。
 * @param monthlyPageViews 月間 PV（MAU からの導出を上書きする）
 */
export function businessApp(monthlyPageViews: number): WorkloadInput {
  return {
    commercial: true,
    traffic: {
      // 1 MAU あたり月 200 PV 程度（平日に毎日使う）を想定
      mau: monthlyPageViews / 200,
      dauPerMau: 0.7,
      sessionsPerDau: 2,
      pagesPerSession: 7,
      weekdayToWeekend: 8,
      peakHourFactor: 4,
      monthlyPageViewsOverride: monthlyPageViews,
    },
    routes: [
      {
        id: 'app',
        rendering: 'ssr',
        share: 1,
        pages: 1,
        processing: {
          cpuMs: 20,
          ioWaitMs: 80,
          queries: 5,
          rowsReadPerQuery: 30,
          responseKB: 40,
        },
      },
    ],
    perPage: { apiCalls: 3, assets: 8, images: 0 },
    api: {
      cpuMs: 6,
      ioWaitMs: 40,
      queries: 2,
      rowsReadPerQuery: 20,
      responseKB: 8,
      writesPerCall: 0.3,
      rowsWrittenPerWrite: 3,
    },
    assets: { sizeKB: 40, browserReuse: 0.9 },
    // 添付ファイル（申請書・見積書など）。配信は数えず（perPage.images 0）、変換もしない
    images: {
      sizeKB: 150,
      browserReuse: 0,
      distinct: 3_000,
      variants: 1,
      storedGB: 6,
      uploadsPerMau: 2,
      transformAt: 'none',
    },
    db: { sizeGB: 1, responseKBPerQuery: 2 },
  };
}

/**
 * 業務アプリを Vite の SPA で作ったときの形（prd/10。template-default・実測ではない）。
 * 画面の中身を返す API は HTML を描かない分 SSR の半分の CPU・応答 10 KB と仮定（SSR 20 ms × 0.5 = 10 ms。
 * ⚠ Cloudflare Free の 1 リクエスト CPU 10 ms の境目にちょうど乗る。prd/10 B-5）。
 */
export const BUSINESS_APP_SPA: SpaShape = {
  shellKB: 5,
  dataCpuFactor: 0.5,
  dataResponseKB: 10,
};

/**
 * 業務アプリを Astro で作ったときの形（D-68。template-default・実測ではない）。画面はすべてログインの要る SSR で、
 * 静的にビルドするページが無い（ビルドし直しは起きない）。表・フォームなど動きのある部品が画面の大半なので、
 * JS・CSS は Next.js と同じとみなす（assetsFactor 1）。
 */
export const BUSINESS_APP_ASTRO: AstroShape = {
  assetsFactor: 1,
  minutesPerBuild: { base: 1, perThousandPages: 0 },
};
