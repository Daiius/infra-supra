// コンセプト確認用スパイクの料金データ（使い捨て。catalog の本番データではない）。
// 値はすべて 2026-10-31 に公式ページから取得したもの。出典は各項目の src。USD。
// 取得時点で各ページに矛盾・未記載があった項目は note に書いた（spike の README の所見を参照）。

export const RETRIEVED_AT = '2026-10-31';

export const SRC = {
  cfWorkersPricing:
    'https://developers.cloudflare.com/workers/platform/pricing/',
  cfWorkersLimits: 'https://developers.cloudflare.com/workers/platform/limits/',
  cfD1Pricing: 'https://developers.cloudflare.com/d1/platform/pricing/',
  cfD1Limits: 'https://developers.cloudflare.com/d1/platform/limits/',
  cfR2Pricing: 'https://developers.cloudflare.com/r2/pricing/',
  vercelPricing: 'https://vercel.com/pricing',
  vercelPro: 'https://vercel.com/docs/plans/pro-plan',
  vercelHobby: 'https://vercel.com/docs/plans/hobby',
  vercelFunctions: 'https://vercel.com/docs/functions/usage-and-pricing',
  vercelImages: 'https://vercel.com/docs/image-optimization/limits-and-pricing',
  vercelIsr:
    'https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing',
  cfKvPricing: 'https://developers.cloudflare.com/kv/platform/pricing/',
  cfKvLimits: 'https://developers.cloudflare.com/kv/platform/limits/',
  cfImagesPricing: 'https://developers.cloudflare.com/images/pricing/',
  supabasePricing: 'https://supabase.com/pricing',
  supabaseCompute: 'https://supabase.com/docs/guides/platform/compute-and-disk',
  supabaseEgress:
    'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
  supabaseBilling:
    'https://supabase.com/docs/guides/platform/billing-on-supabase',
  sakuraVpsSpec: 'https://vps.sakura.ad.jp/specification/',
  sakuraVpsFlow: 'https://vps.sakura.ad.jp/flow/',
} as const;

export const cloudflare = {
  workersFree: {
    requestsPerDay: 100_000, // 超過で Error 1027（課金されず止まる）。UTC 0 時にリセット。src: cfWorkersLimits
    cpuMsPerRequestLimit: 10, // 超過で Error 1102。src: cfWorkersLimits
  },
  workersPaid: {
    baseFee: 5, // アカウントあたり月 $5 の最低請求。Workers・Pages Functions・KV・DO などを含む。src: cfWorkersPricing
    requestsIncluded: 10_000_000,
    requestsPerMillion: 0.3,
    cpuMsIncluded: 30_000_000,
    cpuPerMillionMs: 0.02,
    // 静的アセットへのリクエストは無料・無制限。src: cfWorkersPricing
  },
  d1Free: {
    rowsReadPerDay: 5_000_000, // 超過でクエリがエラー（課金されず止まる）。src: cfD1Pricing
    rowsWrittenPerDay: 100_000,
    maxDbGB: 0.5, // src: cfD1Limits
  },
  d1Paid: {
    rowsReadIncluded: 25_000_000_000,
    rowsReadPerMillion: 0.001,
    rowsWrittenIncluded: 50_000_000,
    rowsWrittenPerMillion: 1.0,
    storageIncludedGB: 5,
    storagePerGB: 0.75,
    maxDbGB: 10, // 引き上げ不可。src: cfD1Limits
  },
  r2: {
    storageFreeGB: 10,
    storagePerGB: 0.015,
    classAFree: 1_000_000,
    classAPerMillion: 4.5,
    classBFree: 10_000_000,
    classBPerMillion: 0.36,
    // egress は無料。src: cfR2Pricing
  },
  kvFree: {
    readsPerDay: 100_000, // 超過でその種類の操作がエラー。UTC 0 時にリセット。src: cfKvPricing
    writesPerDay: 1_000,
  },
  kvPaid: {
    // Workers Paid の $5 に含まれる。src: cfKvPricing
    readsIncluded: 10_000_000,
    readsPerMillion: 0.5,
    writesIncluded: 1_000_000,
    writesPerMillion: 5.0,
    // 同じキーへの書き込みは 1 回/秒まで（Free・Paid とも）。src: cfKvLimits
  },
  images: {
    // 一意な変換（元画像 × パラメータ。format と quality は区別しない）を暦月で数える。src: cfImagesPricing
    freeUniqueTransforms: 5_000, // Free は超過で 9422 エラー（課金されない）
    paidPerThousand: 0.5,
  },
} as const;

export const vercel = {
  hobby: {
    // 超過時は概ね「30 日待つ」（課金されず止まる）。商用利用は不可。src: vercelHobby
    commercialUse: false,
    cdnRequests: 1_000_000,
    fdtGB: 100,
    fotGB: 10,
    invocations: 1_000_000,
    activeCpuHours: 4,
    memoryGBHours: 360,
    imageTransforms: 5_000,
    imageCacheReads: 300_000,
    imageCacheWrites: 100_000,
    isrReads: 1_000_000,
    isrWrites: 200_000,
  },
  pro: {
    baseFee: 20, // 1 席込み。src: vercelPro
    usageCredit: 20, // 「最初の 1 単位から」インフラの従量に当たる。月末で失効。src: vercelPro
    // 以下は pricing ページの「starting at」。CDN 系・ISR・画像は地域差あり（地域別の表は未取得）。
    cdnRequestsIncluded: 10_000_000, // ⚠ Pro の文書は Flat Rate CDN を説明しており、pricing ページと食い違う
    cdnRequestsPerMillion: 2,
    fdtIncludedGB: 1_000, // ⚠ 同上
    fdtPerGB: 0.15,
    fotPerGB: 0.06, // Pro の込み分は未記載
    invocationsPerMillion: 0.6, // ⚠ functions の表では N/A、本文では $0.60/1M
    activeCpuPerHour: 0.128, // iad1。地域で 0.128〜0.221。src: vercelFunctions
    memoryPerGBHour: 0.0106, // iad1。地域で 0.0106〜0.0183
    imageTransformsPerThousand: 0.05,
    imageCacheReadsPerMillion: 0.4,
    imageCacheWritesPerMillion: 4.0,
    isrReadsPerMillion: 0.4, // 8 KB 単位
    isrWritesPerMillion: 4.0,
  },
} as const;

export const supabase = {
  free: {
    projects: 2, // 有効な無料プロジェクトは 2 つまで。1 週間使われないと一時停止。src: supabaseBilling
    dbGB: 0.5,
    egressGB: 5,
    // 超過時は制限（一時停止・読み取り専用・402 のいずれか。どれが当たるかは未記載）
  },
  pro: {
    baseFee: 25, // 組織あたり。src: supabasePricing
    computeCredit: 10, // Compute にだけ当たる。src: supabaseCompute
    egressIncludedGB: 250, // 組織全体。src: supabaseEgress
    egressPerGB: 0.09,
    diskIncludedGB: 8, // プロジェクトあたり
    diskPerGB: 0.125,
    // 時間課金（端数は 1 時間に切り上げ）。支出上限の対象外。src: supabaseCompute
    compute: {
      micro: { perHour: 0.01344, ramGB: 1, directConn: 60, poolerConn: 200 },
      small: { perHour: 0.0206, ramGB: 2, directConn: 90, poolerConn: 400 },
      medium: { perHour: 0.0822, ramGB: 4, directConn: 120, poolerConn: 600 },
    },
  },
} as const;

// さくらの VPS は 1 プランに固定（ユーザーの指示・2026-10-31）。上位プランは後から足す。
export const sakuraVps = {
  plan: '2GB（東京）',
  monthlyJPY: 1_958, // 税込。初期費用なし。src: sakuraVpsSpec
  vcpu: 3,
  ramGB: 2,
  ssdGB: 100,
  lineMbps: 100, // 共有回線。データ転送量は「無制限」。src: sakuraVpsSpec
  sla: false, // 2GB は SLA 非対応（4GB 以上が対応）。src: sakuraVpsSpec
  minimumMonths: 3, // 最低利用期間。src: sakuraVpsSpec
  firstInvoiceMonths: 2, // 前払いで初回に 2 か月分。src: sakuraVpsFlow
} as const;
