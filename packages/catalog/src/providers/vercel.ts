// Vercel（Hobby・Pro）。2026-10-31 に公式ページから取得（spikes/concept-2026-10-31）。USD・税抜。
// Pro の込み分とクレジットの関係は 2026-11-01 に読み直し、文書に揃えた（D-10・D-48）。採った解釈を interpretation に残す。
// 2026-11-04: 新しい Pro の既定の Flat Rate CDN（容量の段）と、読者の地域（東京 hnd1）の CDN の単価を足した（D-120）。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

// 2026-11-01 に読み直した（D-48）。Pro の文書・料金の文書・CDN の文書・Flat Rate CDN の文書（いずれも 2026-09 更新）が
// 「Pro は込み分の代わりに月のクレジット」で揃い、pricing ページの「10M / 1TB included」だけが古い表記として残っている。
const PRO_INTERPRETATION = {
  adopted:
    '資源ごとの込み分はなく、$20 のクレジットがすべての従量に最初の 1 単位から当たる。使い切ったら従量で請求される。CDN Requests・Fast Data Transfer・Blob Data Transfer は、新しい Pro の既定の Flat Rate CDN では段の定額に込み（D-120）、On-demand CDN を選べば従量（クレジットが当たる）',
  rejected: [
    {
      reading:
        'pricing ページの込み分（CDN Requests 月 1,000 万・Fast Data Transfer 月 1 TB）が残り、$20 のクレジットはそれ以外の従量と超過分に当たる',
      reason:
        'Pro の文書に「The monthly credit applies to all managed infrastructure billable resources from the first unit you use」、料金の文書に「Pro teams get a monthly usage credit instead」とあり、CDN の表の Pro の込み分は「Flat Rate CDN」（申し込み制の定額の段）になっている。2025-09-09 の changelog「Included Pro usage is now credit-based」で込み分をクレジットに置き換えた。pricing ページの込み分の表記は置き換え前のものが残っていると読む',
    },
  ],
};

// 画像の最適化の地域（D-120）。料金の文書は地域で単価が変わるとだけ書き、どの地域で決まるかは書かない
const IMAGES_REGION_INTERPRETATION = {
  adopted:
    '読者の地域（変換した画像を配る CDN の地域）の単価で数える（高いほう。hnd1 は iad1 の約 1.3 倍）',
  rejected: [
    {
      reading: '関数の地域（既定の iad1）の単価で数える',
      reason:
        '画像の最適化の文書は「For detailed pricing information for each region, review Regional Pricing」とだけ書き、地域の決め方は書かない。見積は高いほうに倒す',
    },
  ],
};

/** メーターの表示名（D-75。公式の名称を括弧に残す）。Hobby・Pro で同じ。 */
const LABELS = {
  'build-cpu-minutes': 'ビルドの時間（Vercel: Build CPU minutes）',
  'cdn-requests': 'CDN のリクエスト（Vercel: CDN Requests）',
  'fast-data-transfer': 'CDN の転送（Vercel: Fast Data Transfer）',
  'fast-origin-transfer':
    '関数から CDN への転送（Vercel: Fast Origin Transfer）',
  invocations: '関数の呼び出し（Vercel: Function Invocations）',
  'active-cpu': '関数の実行時間（Vercel: Active CPU）',
  'provisioned-memory': '関数のメモリ（Vercel: Provisioned Memory）',
  'image-transformations': '画像の変換（Vercel: Image Transformations）',
  'image-cache-reads': '画像キャッシュの読み取り（Vercel: Image Cache Reads）',
  'image-cache-writes':
    '画像キャッシュの書き込み（Vercel: Image Cache Writes）',
  'isr-reads': 'ISR の読み取り（Vercel: ISR Reads）',
  'isr-writes': 'ISR の書き込み（Vercel: ISR Writes）',
  'blob-storage': 'ファイルの保存量（Vercel Blob: storage）',
  'blob-simple-operations':
    'ファイルの読み取り（Vercel Blob: Simple Operations）',
  'blob-advanced-operations':
    'ファイルのアップロード（Vercel Blob: Advanced Operations）',
  'blob-data-transfer': 'ファイルの転送（Vercel Blob: Blob Data Transfer）',
} as const;

export const vercel: PriceBookInput = {
  schemaVersion: 1,
  provider: 'vercel',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://vercel.com/pricing'),
    // Pro のクレジットと込み分の扱い（2026-11-01 に読み直した。D-48）。pro-plan は 2026-09-15 更新、他は 2026-09-14 更新
    pro: {
      url: 'https://vercel.com/docs/plans/pro-plan',
      retrievedAt: '2026-11-01',
    },
    pricingDocs: {
      url: 'https://vercel.com/docs/pricing',
      retrievedAt: '2026-11-01',
    },
    // 関数が外（AWS の DB）から受け取る通信の項目が無いことの確認（2026-11-03。D-114 段 2）
    pricingDocsInbound: {
      url: 'https://vercel.com/docs/pricing',
      retrievedAt: '2026-11-03',
    },
    // ビルドの料金・マシン・1 日のデプロイの上限（Astro の静的出力のビルドし直し。D-68）
    builds: {
      url: 'https://vercel.com/docs/builds/managing-builds',
      retrievedAt: '2026-11-02',
    },
    buildsPricing: {
      url: 'https://vercel.com/docs/pricing',
      retrievedAt: '2026-11-02',
    },
    limits: {
      url: 'https://vercel.com/docs/limits',
      retrievedAt: '2026-11-02',
    },
    // ログ・Observability（2026-11-02 取得。D-92）
    runtimeLogs: {
      url: 'https://vercel.com/docs/logs/runtime',
      retrievedAt: '2026-11-02',
    },
    observabilityPricing: {
      url: 'https://vercel.com/docs/observability/limits-and-pricing',
      retrievedAt: '2026-11-02',
    },
    observabilityUsage: {
      url: 'https://vercel.com/docs/pricing/observability',
      retrievedAt: '2026-11-02',
    },
    cdnUsage: {
      url: 'https://vercel.com/docs/manage-cdn-usage',
      retrievedAt: '2026-11-01',
    },
    // CDN の単価は「the region where requests originate」で決まる（2026-09-14 更新・2026-11-04 取得。D-120）
    cdnUsageRegion: {
      url: 'https://vercel.com/docs/manage-cdn-usage',
      retrievedAt: '2026-11-04',
    },
    // Flat Rate CDN の段・対象の資源・翌月から上の段・対象外の使い方（2026-09-14 更新・2026-11-04 に読み直した。D-120）
    flatRateCdn: {
      url: 'https://vercel.com/docs/pricing/flat-rate-cdn',
      retrievedAt: '2026-11-04',
    },
    // 新しい Pro のチームは Flat Rate CDN が既定で有効（2026-09-08・2026-11-04 取得。D-120）
    flatRateChangelog: {
      url: 'https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams',
      retrievedAt: '2026-11-04',
    },
    // Pro に込みの最下段（2026-09-15 更新・2026-11-04 取得。D-120）
    proFlatRate: {
      url: 'https://vercel.com/docs/plans/pro-plan',
      retrievedAt: '2026-11-04',
    },
    // 関数の既定の地域は新しいプロジェクトで iad1（2026-08-11 更新・2026-11-04 取得。D-120）
    functionRegion: {
      url: 'https://vercel.com/docs/functions/configuring-functions/region',
      retrievedAt: '2026-11-04',
    },
    // ISR の読み書きは関数の地域の単価（2026-08-11 更新・2026-11-04 取得。D-120）
    isrRegion: {
      url: 'https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing',
      retrievedAt: '2026-11-04',
    },
    // 画像の最適化の単価は地域で変わる（地域の決め方の記載なし。2026-08-11 更新・2026-11-04 取得。D-120）
    imagesRegion: {
      url: 'https://vercel.com/docs/image-optimization/limits-and-pricing',
      retrievedAt: '2026-11-04',
    },
    creditChangelog: {
      url: 'https://vercel.com/changelog/included-pro-usage-is-now-credit-based',
      retrievedAt: '2026-11-01',
    },
    hobby: {
      url: 'https://vercel.com/docs/plans/hobby',
      retrievedAt: '2026-11-01',
    },
    functions: src('https://vercel.com/docs/functions/usage-and-pricing'),
    images: src(
      'https://vercel.com/docs/image-optimization/limits-and-pricing',
    ),
    isr: src(
      'https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing',
    ),
    sla: src('https://vercel.com/legal/sla'),
    isrDocs: {
      url: 'https://vercel.com/docs/incremental-static-regeneration',
      retrievedAt: '2026-11-01',
    },
    // Astro の記事を Vercel の ISR でキャッシュする形（2026-11-03 に原文で確認。D-103）
    astroVercel: {
      url: 'https://docs.astro.build/en/guides/integrations-guide/vercel/',
      retrievedAt: '2026-11-03',
    },
    // API の応答のキャッシュ（Vite の SPA の部品。2026-09-14 更新・2026-11-01 取得。D-37）
    cdnCache: {
      url: 'https://vercel.com/docs/caching/cdn-cache',
      retrievedAt: '2026-11-01',
    },
    // Vercel Blob（画像の原本の置き場。2026-09-23 更新・2026-11-01 取得。D-46）
    blob: {
      url: 'https://vercel.com/docs/vercel-blob/usage-and-pricing',
      retrievedAt: '2026-11-01',
    },
    // 地域ごとの単価（2026-09-14 更新・2026-11-01 取得）。既定は iad1、東京（hnd1）は地域料金として持つ
    regionIad1: {
      url: 'https://vercel.com/docs/pricing/regional-pricing/iad1',
      retrievedAt: '2026-11-01',
    },
    regionHnd1: {
      url: 'https://vercel.com/docs/pricing/regional-pricing/hnd1',
      retrievedAt: '2026-11-01',
    },
    // CDN・FOT・ISR・画像の地域の単価（2026-09-14 更新・2026-11-04 に読み直した。D-120）
    regionIad1Cdn: {
      url: 'https://vercel.com/docs/pricing/regional-pricing/iad1',
      retrievedAt: '2026-11-04',
    },
    regionHnd1Cdn: {
      url: 'https://vercel.com/docs/pricing/regional-pricing/hnd1',
      retrievedAt: '2026-11-04',
    },
  },
  allowancePools: [
    {
      id: 'hobby-cdn-requests',
      quantity: 1_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-fdt',
      quantity: 100,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-fot',
      quantity: 10,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-invocations',
      quantity: 1_000_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-active-cpu',
      quantity: 4,
      unit: 'cpu-hour',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-memory',
      quantity: 360,
      unit: 'gb-hour',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-image-transformations',
      quantity: 5_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-image-cache-reads',
      quantity: 300_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-image-cache-writes',
      quantity: 100_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['images'],
    },
    {
      id: 'hobby-isr-reads',
      quantity: 1_000_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    {
      id: 'hobby-isr-writes',
      quantity: 200_000,
      unit: 'operation',
      period: 'month',
      scope: 'account',
      sourceIds: ['pricing'],
    },
    // Vercel Blob の Hobby の込み分（Hobby の込み分はプロジェクトのすべてのサービスで共有）。超えると 30 日使えない
    ...(
      [
        ['hobby-blob-storage', 1, 'gb-month'],
        ['hobby-blob-simple-operations', 10_000, 'operation'],
        ['hobby-blob-advanced-operations', 2_000, 'operation'],
        ['hobby-blob-data-transfer', 10, 'gb'],
      ] as const
    ).map(([id, quantity, unit]) => ({
      id,
      quantity,
      unit,
      period: 'month' as const,
      scope: 'account' as const,
      sourceIds: ['blob'],
    })),
  ],
  plans: [
    {
      id: 'hobby',
      service: 'platform',
      name: 'Hobby',
      sourceIds: ['hobby', 'pricing'],
      facts: [
        {
          // Next.js のサーバーから別の事業者の API を呼ぶ形（F-14・D-67。2026-11-02 に原文で確認）
          id: 'function-outbound',
          premise:
            'Vercel の料金の文書の課金の項目（CDN・Functions など）に、関数から外の API への通信の転送は無い（Static IPs の Private Data Transfer を除く）。このゲームでは数えない',
          sourceIds: ['pricingDocs'],
        },
        {
          id: 'function-inbound',
          premise:
            'Vercel の料金の文書の課金の項目（CDN・Functions など）に、関数が外（DB など）から受け取る通信の転送は無い（未確認・数えない）',
          sourceIds: ['pricingDocsInbound'],
        },
        {
          id: 'builds-hobby',
          premise:
            'Hobby のビルドは Basic のマシン（2 vCPU）で込み。1 日に作れるデプロイは 100 まで（このモデルでは 1 日の上限を判定していない）',
          sourceIds: ['builds', 'buildsPricing', 'limits'],
        },
        {
          id: 'isr-purge',
          premise:
            'Vercel の ISR は全プランで使え、再検証すると全リージョンのキャッシュが 300ms 以内に更新される',
          sourceIds: ['isrDocs'],
        },
        {
          id: 'astro-isr',
          premise:
            '@astrojs/vercel の isr を有効にすると、リクエストのたびに描くページを最初の閲覧の後に（Vercel の ISR として）キャッシュする。期限は expiration、取り直しは bypassToken を x-prerender-revalidate のヘッダーに付けたリクエスト。exclude に挙げたページは毎回描く。Vercel の ISR の文書は Astro を対応するフレームワークに挙げる',
          sourceIds: ['astroVercel', 'isrDocs'],
        },
        {
          id: 'cdn-cache-functions',
          premise:
            'Vercel Functions の応答は Cache-Control の s-maxage で CDN にキャッシュされる（全プラン）。条件は GET・HEAD・Authorization なし・Set-Cookie なしなど。キャッシュはリージョンごとに分かれ、めったに読まれない応答は期間の前に追い出されることがある',
          interpretation: {
            adopted:
              'ヒットは CDN が返し、関数を起動しない（CDN Requests と Fast Data Transfer は数え、Invocations・Active CPU・Fast Origin Transfer は miss だけ）',
            rejected: [
              {
                reading: 'ヒットでも関数が起動する',
                reason:
                  '文書は CDN のキャッシュを「オリジンの負荷を減らす」ものとして説明している',
              },
            ],
          },
          sourceIds: ['cdnCache'],
        },
      ],
      uptimeSla: {
        status: 'not-stated',
        premise:
          'Vercel Hobby・Pro は料金のページに稼働率の SLA の記載なし（99.99% の SLA は Enterprise）',
        sourceIds: ['pricing', 'sla'],
      },
      eligibility: [
        {
          id: 'personal-non-commercial',
          requirement: 'non-commercial',
          premise: 'Vercel Hobby は個人・非商用のみ',
          sourceIds: ['hobby'],
        },
      ],
      meters: [
        ...[
          [
            'cdn-requests',
            'requests',
            'request',
            'hobby-cdn-requests',
            'Hobby は CDN Requests 月 100 万まで（超えると 30 日待つ）',
          ],
          [
            'fast-data-transfer',
            'egress-gb',
            'gb',
            'hobby-fdt',
            'Hobby は Fast Data Transfer 月 100 GB まで',
          ],
          [
            'fast-origin-transfer',
            'origin-transfer-gb',
            'gb',
            'hobby-fot',
            'Hobby は Fast Origin Transfer 月 10 GB まで',
          ],
          [
            'invocations',
            'invocations',
            'count',
            'hobby-invocations',
            'Hobby は関数の実行 月 100 万回まで',
          ],
          [
            'active-cpu',
            'cpu-ms',
            'cpu-hour',
            'hobby-active-cpu',
            'Hobby は Active CPU 月 4 時間まで',
          ],
          [
            'provisioned-memory',
            'memory-gb-hours',
            'gb-hour',
            'hobby-memory',
            'Hobby はメモリ 月 360 GB 時まで',
          ],
          [
            'image-transformations',
            'image-transformations',
            'count',
            'hobby-image-transformations',
            'Hobby は画像の変換 月 5,000 回まで（超えると 402）',
          ],
          [
            'image-cache-reads',
            'image-cache-reads',
            'operation',
            'hobby-image-cache-reads',
            'Hobby は画像キャッシュの読み取り 月 30 万単位まで',
          ],
          [
            'image-cache-writes',
            'image-cache-writes',
            'operation',
            'hobby-image-cache-writes',
            'Hobby は画像キャッシュの書き込み 月 10 万単位まで',
          ],
          [
            'isr-reads',
            'isr-reads',
            'operation',
            'hobby-isr-reads',
            'Hobby は ISR の読み取り 月 100 万単位まで',
          ],
          [
            'isr-writes',
            'isr-writes',
            'operation',
            'hobby-isr-writes',
            'Hobby は ISR の書き込み 月 20 万単位まで',
          ],
        ].map(([id, resource, unit, pool, premise]) => ({
          id: id!,
          label: LABELS[id as keyof typeof LABELS],
          resource: resource as never,
          unit: unit as never,
          allowancePool: pool!,
          onExceed: 'block' as const,
          premise: premise!,
          pricing: { model: 'flat' as const, per: 1, unitPrice: 0 },
          sourceIds: ['pricing', 'hobby'],
        })),
        // Vercel Blob（D-46）。込み分を超えると 30 日使えない（追加の請求はない）
        ...(
          [
            [
              'blob-storage',
              'storage-gb-month',
              'gb-month',
              'hobby-blob-storage',
              'Hobby の Vercel Blob は保存量 月 1 GB まで（超えると 30 日使えない）',
            ],
            [
              'blob-simple-operations',
              'object-reads',
              'operation',
              'hobby-blob-simple-operations',
              'Hobby の Vercel Blob は Simple Operations（キャッシュの miss の読み取り）月 1 万回まで',
            ],
            [
              'blob-advanced-operations',
              'object-writes',
              'operation',
              'hobby-blob-advanced-operations',
              'Hobby の Vercel Blob は Advanced Operations（アップロードなど）月 2,000 回まで',
            ],
            [
              'blob-data-transfer',
              'egress-gb',
              'gb',
              'hobby-blob-data-transfer',
              'Hobby の Vercel Blob は Blob Data Transfer 月 10 GB まで',
            ],
          ] as const
        ).map(([id, resource, unit, pool, premise]) => ({
          id,
          label: LABELS[id],
          resource,
          unit,
          allowancePool: pool,
          onExceed: 'block' as const,
          premise,
          pricing: { model: 'flat' as const, per: 1, unitPrice: 0 },
          sourceIds: ['blob'],
        })),
      ],
    },
    {
      id: 'pro',
      service: 'platform',
      name: 'Pro',
      baseFee: {
        label: '基本料（Vercel Pro: 1 席ごと）',
        amount: 20,
        per: 'month',
        scope: 'account',
        perSeat: true,
      },
      sourceIds: ['pro', 'pricing'],
      facts: [
        {
          // Next.js のサーバーから別の事業者の API を呼ぶ形（F-14・D-67。2026-11-02 に原文で確認）
          id: 'function-outbound',
          premise:
            'Vercel の料金の文書の課金の項目（CDN・Functions など）に、関数から外の API への通信の転送は無い（Static IPs の Private Data Transfer を除く）。このゲームでは数えない',
          sourceIds: ['pricingDocs'],
        },
        {
          id: 'function-inbound',
          premise:
            'Vercel の料金の文書の課金の項目（CDN・Functions など）に、関数が外（DB など）から受け取る通信の転送は無い（未確認・数えない）',
          sourceIds: ['pricingDocsInbound'],
        },
        {
          id: 'isr-purge',
          premise:
            'Vercel の ISR は全プランで使え、再検証すると全リージョンのキャッシュが 300ms 以内に更新される',
          sourceIds: ['isrDocs'],
        },
        {
          id: 'astro-isr',
          premise:
            '@astrojs/vercel の isr を有効にすると、リクエストのたびに描くページを最初の閲覧の後に（Vercel の ISR として）キャッシュする。期限は expiration、取り直しは bypassToken を x-prerender-revalidate のヘッダーに付けたリクエスト。exclude に挙げたページは毎回描く。Vercel の ISR の文書は Astro を対応するフレームワークに挙げる',
          sourceIds: ['astroVercel', 'isrDocs'],
        },
        {
          id: 'cdn-cache-functions',
          premise:
            'Vercel Functions の応答は Cache-Control の s-maxage で CDN にキャッシュされる（全プラン）。条件は GET・HEAD・Authorization なし・Set-Cookie なしなど。キャッシュはリージョンごとに分かれ、めったに読まれない応答は期間の前に追い出されることがある',
          interpretation: {
            adopted:
              'ヒットは CDN が返し、関数を起動しない（CDN Requests と Fast Data Transfer は数え、Invocations・Active CPU・Fast Origin Transfer は miss だけ）',
            rejected: [
              {
                reading: 'ヒットでも関数が起動する',
                reason:
                  '文書は CDN のキャッシュを「オリジンの負荷を減らす」ものとして説明している',
              },
            ],
          },
          sourceIds: ['cdnCache'],
        },
      ],
      uptimeSla: {
        status: 'not-stated',
        premise:
          'Vercel Hobby・Pro は料金のページに稼働率の SLA の記載なし（99.99% の SLA は Enterprise）',
        sourceIds: ['pricing', 'sla'],
      },
      members: {
        pricing: 'per-seat',
        premise:
          'Vercel Pro は基本料 $20 に配備できる席（Owner・Member）1 つが含まれ、足す席は 1 つ $20 / 月。閲覧だけの席（Viewer Pro）は無料で数に制限なし（このモデルの席は管理画面で配備する人の数）',
        sourceIds: ['pro', 'pricing'],
      },
      credits: [
        {
          id: 'usage-credit',
          label: '月の利用クレジット（Vercel Pro: monthly usage credit）',
          amount: 20,
          appliesTo: 'all-usage',
          premise:
            'Vercel Pro は月 $20 のクレジットがすべての従量に最初から当たり、使い切ると使った分だけ請求される（席の基本料・Flat Rate CDN の段の月額には当てない。余りは繰り越さない）',
          interpretation: PRO_INTERPRETATION,
          sourceIds: ['pro', 'pricingDocs', 'creditChangelog'],
        },
      ],
      // Flat Rate CDN（新しい Pro の既定。D-120）。On-demand CDN は構成の部品（CDN の料金）で選ぶ（契約の capacityTiers: off）
      capacityTiers: [
        {
          id: 'flat-rate-cdn',
          label: '定額の CDN（Vercel: Flat Rate CDN）',
          dimensions: [
            {
              id: 'requests',
              label: 'CDN のリクエスト',
              unit: 'request',
              meterIds: ['cdn-requests'],
            },
            {
              id: 'transfer',
              label: 'CDN の転送',
              unit: 'gb',
              meterIds: ['fast-data-transfer', 'blob-data-transfer'],
            },
          ],
          tiers: [
            {
              id: 'included',
              label: 'Pro に込みの段（100 万リクエスト・1 TB）',
              fee: 0,
              capacity: { requests: 1_000_000, transfer: 1_000 },
            },
            {
              id: 'tier-20',
              label: '$20 の段（1,000 万リクエスト・50 TB）',
              fee: 20,
              capacity: { requests: 10_000_000, transfer: 50_000 },
            },
            {
              id: 'tier-100',
              label: '$100 の段（5,000 万リクエスト・50 TB）',
              fee: 100,
              capacity: { requests: 50_000_000, transfer: 50_000 },
            },
            {
              id: 'tier-300',
              label: '$300 の段（1 億 5,000 万リクエスト・50 TB）',
              fee: 300,
              capacity: { requests: 150_000_000, transfer: 50_000 },
            },
          ],
          premise:
            'Vercel Pro は既定で Flat Rate CDN（CDN Requests・Fast Data Transfer・Blob Data Transfer を段の定額で払う。Fast Origin Transfer は従量のまま）。Pro に込みの段は月 100 万リクエスト・1 TB で、上は $20（1,000 万・50 TB）・$100（5,000 万）・$300（1 億 5,000 万）。月の量が段の容量を超えてもその月の請求は増えず、翌月から上の段になる（最上段を超えると従量）',
          outOfScope: {
            measure: 'media-transfer-share',
            dimension: 'transfer',
            above: 0.5,
            premise:
              'Flat Rate CDN は、メディアやファイルの配信が転送の大半を占める使い方を対象外とする。Vercel の判断で Flex CDN へ移す・別のプランを求める・制限することがある（このモデルは段の定額のまま数える）',
          },
          interpretation: {
            adopted:
              '段の月額に月のクレジットは当てない（基本料と同じ固定の支払いとして数える）。1 TB は 1,000 GB。翌月の段は今月の量が収まる最小の段とする（上がるのは公式の記述どおり、量が減った月に下げるのは利用者が段を選び直すとみなす）',
            rejected: [
              {
                reading: '段の月額にも $20 のクレジットが当たる',
                reason:
                  'クレジットは「managed infrastructure billable resources」の従量に当たると書かれ、段の月額（Billing で選ぶ定額）に当たるかは記載が無い。当てないほうが高く、見積は高いほうに倒す',
              },
            ],
          },
          sourceIds: [
            'flatRateCdn',
            'flatRateChangelog',
            'proFlatRate',
            'pricingDocs',
          ],
        },
      ],
      notes: [
        'Pro の従量は既定で上限なし。予算で一時停止できるが、数分の遅れがある（spend management）',
      ],
      meters: [
        {
          id: 'build-cpu-minutes',
          label: LABELS['build-cpu-minutes'],
          resource: 'build-minutes',
          unit: 'minute',
          premise:
            'Vercel Pro のビルドは CPU minute（ビルドの時間を分に切り上げ × マシンの vCPU の数）あたり $0.0035。新しい Pro の既定は Elastic（4〜30 vCPU）で、このモデルは最小の 4 vCPU とみなす（Basic の 2 vCPU を選べば半分）',
          interpretation: {
            adopted:
              'Elastic が 4 vCPU（Standard 相当）を割り当てるとみなし、1 分のビルドを 4 CPU minute と数える。月のクレジットはビルドにも当たる（ビルドの料金は Managed Infrastructure の節にある）',
            rejected: [
              {
                reading: 'Basic（2 vCPU・$0.007 / 分）で数える',
                reason:
                  '新しい Pro のアカウントの既定は Elastic（「New Pro and Enterprise accounts use Elastic machines by default」）',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.0035 },
          sourceIds: ['builds', 'buildsPricing'],
        },
        {
          id: 'cdn-requests',
          label: LABELS['cdn-requests'],
          aliases: ['edge-requests'],
          resource: 'requests',
          unit: 'request',
          interpretation: PRO_INTERPRETATION,
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 2 },
          // CDN の単価は読者の地域（「the region where requests originate」。D-120）
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000_000, unitPrice: 2.6 },
            },
          ],
          sourceIds: [
            'pricing',
            'cdnUsage',
            'cdnUsageRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'fast-data-transfer',
          label: LABELS['fast-data-transfer'],
          resource: 'egress-gb',
          unit: 'gb',
          interpretation: PRO_INTERPRETATION,
          pricing: { model: 'flat', per: 1, unitPrice: 0.15 },
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.16 },
            },
          ],
          sourceIds: [
            'pricing',
            'cdnUsage',
            'cdnUsageRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'fast-origin-transfer',
          label: LABELS['fast-origin-transfer'],
          resource: 'origin-transfer-gb',
          unit: 'gb',
          // Flat Rate CDN の対象外（Pro の込みは「Usage-based」）。地域は読者の地域とみなす（D-120）
          interpretation: {
            adopted:
              '読者の地域（リクエストが入った CDN の地域）の単価で数える。Fast Origin Transfer は CDN の料金の 3 つの資源の 1 つで、CDN の文書は「pricing varies by the region where requests originate」と書く',
            rejected: [
              {
                reading: '関数の地域（既定の iad1・$0.06/GB）の単価で数える',
                reason:
                  'Fast Origin Transfer の地域の決め方は書かれていない（「priced regionally」だけ）。CDN の料金の資源としての書き方に合わせ、高いほう（hnd1 は $0.27/GB）で見積もる',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.06 },
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.27 },
            },
          ],
          sourceIds: [
            'pricing',
            'cdnUsageRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'invocations',
          label: LABELS['invocations'],
          resource: 'invocations',
          unit: 'count',
          interpretation: {
            adopted: '$0.60/100 万回（functions の本文の例）',
            rejected: [
              {
                reading: '従量の課金なし（functions の表の N/A）',
                reason:
                  '本文に「Vercel bills Pro invocations on demand」とある',
              },
            ],
          },
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.6 },
          sourceIds: ['functions', 'pricing'],
        },
        {
          id: 'active-cpu',
          label: LABELS['active-cpu'],
          resource: 'cpu-ms',
          unit: 'cpu-hour',
          rounding: 'not-stated',
          premise: 'Vercel の Active CPU は I/O 待ちの間は課金しない',
          pricing: { model: 'flat', per: 1, unitPrice: 0.128 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.202 },
            },
            {
              region: 'kix1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.202 },
            },
          ],
          sourceIds: ['functions', 'functionRegion'],
        },
        {
          id: 'provisioned-memory',
          label: LABELS['provisioned-memory'],
          resource: 'memory-gb-hours',
          unit: 'gb-hour',
          rounding: 'not-stated',
          premise:
            'Vercel のメモリはインスタンスの生存時間で課金される（I/O 待ちも含む）',
          pricing: { model: 'flat', per: 1, unitPrice: 0.0106 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.0167 },
            },
            {
              region: 'kix1',
              pricing: { model: 'flat', per: 1, unitPrice: 0.0167 },
            },
          ],
          sourceIds: ['functions', 'functionRegion'],
        },
        {
          id: 'image-transformations',
          label: LABELS['image-transformations'],
          resource: 'image-transformations',
          unit: 'count',
          interpretation: IMAGES_REGION_INTERPRETATION,
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.05 },
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000, unitPrice: 0.0661 },
            },
          ],
          sourceIds: [
            'images',
            'imagesRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'image-cache-reads',
          label: LABELS['image-cache-reads'],
          resource: 'image-cache-reads',
          unit: 'operation',
          interpretation: IMAGES_REGION_INTERPRETATION,
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.4 },
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.52 },
            },
          ],
          sourceIds: [
            'images',
            'imagesRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'image-cache-writes',
          label: LABELS['image-cache-writes'],
          resource: 'image-cache-writes',
          unit: 'operation',
          interpretation: IMAGES_REGION_INTERPRETATION,
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 4 },
          regionBy: 'viewer',
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000_000, unitPrice: 5.2 },
            },
          ],
          sourceIds: [
            'images',
            'imagesRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'isr-reads',
          label: LABELS['isr-reads'],
          resource: 'isr-reads',
          unit: 'operation',
          // ISR の読み書きは関数の地域の単価（既定の iad1。D-120）
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.4 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000_000, unitPrice: 0.52 },
            },
          ],
          sourceIds: [
            'pricing',
            'isr',
            'isrRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        {
          id: 'isr-writes',
          label: LABELS['isr-writes'],
          resource: 'isr-writes',
          unit: 'operation',
          // ISR の読み書きは関数の地域の単価（既定の iad1。D-120）
          pricing: { model: 'flat', per: 1_000_000, unitPrice: 4 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat', per: 1_000_000, unitPrice: 5.2 },
            },
          ],
          sourceIds: [
            'pricing',
            'isr',
            'isrRegion',
            'regionIad1Cdn',
            'regionHnd1Cdn',
          ],
        },
        // Vercel Blob（D-46）。既定は iad1、hnd1 は地域料金。Simple Operations はキャッシュの miss の読み取りだけ
        ...(
          [
            ['blob-storage', 'storage-gb-month', 'gb-month', 1, 0.023, 0.025],
            [
              'blob-simple-operations',
              'object-reads',
              'operation',
              1_000_000,
              0.4,
              0.37,
            ],
            [
              'blob-advanced-operations',
              'object-writes',
              'operation',
              1_000_000,
              5,
              4.7,
            ],
            ['blob-data-transfer', 'egress-gb', 'gb', 1, 0.05, 0.053],
          ] as const
        ).map(([id, resource, unit, per, iad1, hnd1]) => ({
          id,
          label: LABELS[id],
          resource,
          unit,
          // Blob Data Transfer は CDN から読者への配信（Flat Rate CDN の対象・読者の地域）。保存と操作はストアの地域（D-120）
          ...(id === 'blob-data-transfer'
            ? { regionBy: 'viewer' as const }
            : {}),
          pricing: { model: 'flat' as const, per, unitPrice: iad1 },
          regional: [
            {
              region: 'hnd1',
              pricing: { model: 'flat' as const, per, unitPrice: hnd1 },
            },
          ],
          sourceIds: ['blob', 'regionIad1', 'regionHnd1'],
        })),
      ],
    },
  ],
  notes: [
    'Pro の CDN（CDN Requests・Fast Data Transfer・Blob Data Transfer）は、新しい Pro の既定の Flat Rate CDN（容量の段の定額）で計算する。On-demand CDN（従量）は構成の部品で選ぶ（D-120。D-48 の「扱わない」を改めた）',
    'Flat Rate CDN の段の容量を超えた日・月も、その月は請求されない（spike protection。公平な利用の範囲で）。最上段（1 億 5,000 万リクエスト・50 TB）を超えると翌月から従量',
    'CDN（Requests・FDT・Blob Data Transfer）・Fast Origin Transfer・画像の最適化は読者の地域の単価（構成の既定は東京 hnd1）、Active CPU・メモリ・ISR・Blob の保存と操作は関数の地域の単価（新しいプロジェクトの既定は iad1）。単価は地域の料金のページ（iad1・hnd1）から取った（D-120）',
    'Active CPU・メモリの既定の単価は iad1（最安の地域）。hnd1・kix1 は地域料金として持つ',
    '関数のログ（Runtime Logs）は課金されない。保持は Hobby 1 時間・Pro 1 日（D-92。2026-11-02 確認）',
    'Observability Plus（保持 30 日など）は 100 万 event $1.20 で、2026-04-03 以降に作った・上げた Pro のチームでは既定で有効（外せる）。1 件の要求で 1 つ以上の event ができるとあるが数え方が書かれていないので、数えない（外した前提。料金未取得。D-92）',
  ],
};
