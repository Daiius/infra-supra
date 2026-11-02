// Bunny（bunny.net。転送の安い従量の CDN・Storage・Optimizer）。2026-11-02 に公式ページから取得（D-98・prd/11 §23）。USD・税抜。
// 事業者をまたぐ部品だけを出す（画像の配信・前段の CDN）。CDN は Standard network（119 拠点）だけを持つ。
// Volume network（10 拠点・最初の 500 TB は $0.005/GB）は、日本の閲覧がその単価で数えられるかを確かめられないので入れていない。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

/** Bunny の facts（構成のノードが facts で挙げたときだけ前提として出す）。 */
const FACTS = [
  {
    id: 'asia-rate',
    premise:
      'Bunny CDN（Standard network）の転送は配った拠点の地域ごとの単価: Europe & North America $0.01/GB・Asia & Oceania $0.03/GB・South America $0.045/GB・Middle East & Africa $0.06/GB（段の割引は無い）。要求（リクエスト）の課金は無い（「No Request Fees」）',
    interpretation: {
      adopted:
        '日本の閲覧者は東京などアジアの拠点から配られるとみて、Asia & Oceania の $0.03/GB で数える（アジアの拠点の一覧に Tokyo がある）',
      rejected: [
        {
          reading: 'Europe & North America の $0.01/GB で数える',
          reason:
            '閲覧者は日本にいて、東京の拠点はアジアの地域のページに載る。料金ページは日本がどの地域かを書いていないので、高めの側の読みを取る',
        },
        {
          reading: 'Volume network の $0.005/GB で数える',
          reason:
            'Volume network は 10 拠点で、アジアの拠点の一覧に「Tokyo (Volume)」はあるが、日本の閲覧がその単価で配られるかは料金ページに書かれていない（未確認）',
        },
      ],
    },
    sourceIds: ['cdnPricing', 'asia'],
  },
  {
    id: 'monthly-minimum',
    premise:
      'Bunny は月の最低額が $1（「$1 monthly minimum」）。使った額が $1 に満たない月も $1 を払う',
    interpretation: {
      adopted:
        '基本料 $1 と、同じ額のクレジットが従量に当たる形で数える（請求 = max($1, 従量)）。Optimizer の月額は別のプランの明細なので最低額に当てず、従量が $1 未満の月は最大 $1 高めに出る',
      rejected: [
        {
          reading: '最小の課金量（minimumQuantity。D-85）で表す',
          reason:
            '最小の課金量はメーターごとの量の最小で、アカウント全体の額の最低額とは形が違う',
        },
      ],
    },
    sourceIds: ['pricing', 'cdnPricing', 'storagePricing'],
  },
  {
    id: 'pull-zone-origin',
    premise:
      'Bunny CDN の Pull Zone は自分のサーバー（オリジン）につなぎ、キャッシュに無ければ拠点がオリジンから取って、キャッシュして返す（「If not cached, the edge fetches from your origin, caches the response, and delivers it」）',
    sourceIds: ['cdnDocs'],
  },
  {
    id: 'storage-origin',
    premise:
      'Bunny Storage の Storage Zone は Pull Zone のオリジンにでき（Origin Type を Bunny Storage Zone に）、アップロードは HTTP API の PUT（storage.bunnycdn.com）。Standard（HDD）は地域を選べ（東京もある）、Storage から CDN への転送・API の要求・API の転送は無料（「Free traffic to Bunny CDN」「No API fees」「Free API egress」）',
    sourceIds: ['storagePricing', 'storageQuickstart'],
  },
  {
    id: 'dynamic-images',
    premise:
      'Bunny Optimizer を Pull Zone で有効にし、Dynamic Image API を有効にすると、URL の引数（?width=500・?quality=75&format=webp）で画像を変換でき、変換の結果は拠点でキャッシュされる',
    sourceIds: ['dynamicImages'],
  },
  {
    id: 'optimizer-flat',
    premise:
      'Bunny Optimizer はサイトごとに月 $9.50 で、要求・最適化・変換は無制限（「Unlimited transformations FREE」「Fixed monthly price, regardless of your traffic and scale」）。CDN の転送は別に払う',
    sourceIds: ['optimizerPricing'],
  },
  {
    id: 'no-next-loader',
    premise:
      'Next.js の next/image のローダーの公式の例（Akamai・CloudFront・Cloudinary・Cloudflare など）に Bunny は無い。loaderFile で ?width= の URL を返す関数を自分で書く',
    sourceIds: ['nextImages'],
  },
];

const UPTIME = {
  status: 'offered' as const,
  percent: 99.99,
  premise:
    'Bunny の SLA は稼働率 99.99%。下回った月は月の利用に応じたクレジット（10〜59 分の停止で 12 時間分 … 7 時間以上で 240 時間分）。利用規約は CDN の目標を 99.995% と書くが、補償の対象は SLA のページの 99.99%',
  sourceIds: ['sla', 'tos'],
};
const MEMBERS = {
  pricing: 'not-stated' as const,
  premise: 'Bunny のチームのメンバーの料金は、料金ページに書かれていない',
  sourceIds: ['pricing'],
};

export const bunny: PriceBookInput = {
  schemaVersion: 1,
  provider: 'bunny',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://bunny.net/pricing/'),
    cdnPricing: src('https://bunny.net/pricing/cdn/'),
    asia: src('https://bunny.net/cdn/content-delivery-asia/'),
    storagePricing: src('https://bunny.net/pricing/storage/'),
    optimizerPricing: src('https://bunny.net/pricing/optimizer/'),
    cdnDocs: src('https://bunny.net/docs/cdn.md'),
    storageQuickstart: src('https://bunny.net/docs/storage/quickstart.md'),
    dynamicImages: src(
      'https://bunny.net/docs/optimizer/dynamic-images/overview.md',
    ),
    sla: src('https://bunny.net/sla/'),
    tos: src('https://bunny.net/tos/'),
    nextImages: src(
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
    ),
  },
  allowancePools: [],
  plans: [
    {
      id: 'standard',
      service: 'cdn',
      name: 'CDN（Standard network）+ Storage（Standard）',
      baseFee: {
        label: '月の最低額（Bunny: $1 monthly minimum）',
        amount: 1,
        per: 'month',
        scope: 'account',
      },
      credits: [
        {
          id: 'minimum',
          label: '最低額に含む従量（Bunny: $1 monthly minimum）',
          amount: 1,
          appliesTo: 'all-usage',
          interpretation: FACTS[1]!.interpretation,
          sourceIds: ['pricing', 'cdnPricing', 'storagePricing'],
        },
      ],
      sourceIds: ['pricing', 'cdnPricing', 'storagePricing'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      facts: FACTS,
      notes: [
        '14 日の無料の試用（カードの登録なし）。支払いは前払いで返金しない（利用規約）',
        '月の転送の上限を決めて、超える請求を止められる（Overcharge Protection）',
      ],
      meters: [
        {
          id: 'bandwidth',
          label: 'CDN の転送（Bunny CDN: Standard network・Asia & Oceania）',
          resource: 'egress-gb',
          unit: 'gb',
          premise:
            'Bunny CDN の転送は Asia & Oceania で $0.03/GB（日本の閲覧をこの単価で数える解釈）。要求の課金は無い',
          interpretation: FACTS[0]!.interpretation,
          pricing: { model: 'flat', per: 1, unitPrice: 0.03 },
          sourceIds: ['cdnPricing', 'asia'],
        },
        {
          id: 'storage',
          label: '画像の保存（Bunny Storage: Standard・1 地域）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          premise:
            'Bunny Storage の Standard（HDD）は 1 地域 $0.01/GB（2 地域で $0.02、3 地域で $0.025）。ここでは東京の 1 地域とみる',
          pricing: { model: 'flat', per: 1, unitPrice: 0.01 },
          sourceIds: ['storagePricing'],
        },
      ],
    },
    {
      id: 'optimizer',
      service: 'image-optimization',
      name: 'Optimizer',
      baseFee: {
        label: '基本料（Bunny Optimizer: per website）',
        amount: 9.5,
        per: 'month',
        scope: 'node',
      },
      sourceIds: ['optimizerPricing'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      facts: FACTS,
      notes: ['時間ごとの課金で、月の約束は無い（使った時間の分だけ）'],
      meters: [
        {
          id: 'transformations',
          label: '画像の変換（Bunny Optimizer: transformations）',
          resource: 'image-transformations',
          unit: 'count',
          premise:
            'Bunny Optimizer の変換は無制限で、月額に込み（「Unlimited transformations FREE」）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['optimizerPricing'],
        },
      ],
    },
  ],
};
