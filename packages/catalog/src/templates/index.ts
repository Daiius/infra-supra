// アプリのテンプレート（prd/README のスコープ・企画書 §4.2）。値はすべてテンプレートの既定値（template-default）で、
// 実測ではない。コストに効く値は判断ポイント（prd/01 §8）として選択肢にする（D-11）。
import type { WorkloadInput } from 'estimator';

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
  };
}

export { businessApp } from './business-app.ts';
