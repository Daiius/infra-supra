// Netlify（クレジット制の Free・Personal・Pro）。2026-11-02 に公式ページから取得（D-71・prd/11 §14）。USD・税抜（料金のページに税の記載なし）。
// 2025-09-04 以降の新しいアカウントはクレジット制（旧来の Starter・Pro は既存のアカウントだけ）。
// クレジットは資源ごとの単価（デプロイ 1 回・GB 時間・GB・1 万リクエスト）で減り、使い切るとサイトが止まる。
// 追加のクレジット（自動の補充）は Personal 500 クレジット $5・Pro 1,500 クレジット $10 で、既定は無効。
// このデータは「クレジット 1 単位の金額」でメーターを金額にし、月のクレジットを金額のクレジットとして当てる（解釈は CREDIT_INTERPRETATION）。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

/** クレジットの消費の単価（how-credits-work の表）。 */
const CREDITS = {
  deploy: 15, // 本番へのデプロイ 1 回
  computeGbHour: 10, // 関数の GB 時間
  bandwidthGb: 20, // 転送 1 GB
  requestsPer10k: 2, // 1 万リクエスト
} as const;

/**
 * クレジット 1 単位の金額（USD）。Personal は自動の補充 500 クレジット $5、Pro は 1,500 クレジット $10。
 * Free は追加で買えないので、金額は使用率の判定のための換算（Personal の単価）で、請求はされない。
 */
const CREDIT_USD = { free: 5 / 500, personal: 5 / 500, pro: 10 / 1_500 };
const INCLUDED = { free: 300, personal: 1_000, pro: 3_000 };

const CREDIT_INTERPRETATION = {
  adopted:
    'クレジットを補充の単価で金額に直し、月のクレジットをすべての従量に最初の 1 単位から当てる金額のクレジットとして持つ。Personal・Pro は自動の補充を有効にして運営する前提（使い切ると補充の単価で請求が増える）。補充は 500・1,500 クレジットの束で買い、束の余りは繰り越すので、長い目では使った分 × 単価になるとみる',
  rejected: [
    {
      reading: '自動の補充は既定で無効なので、Personal・Pro も使い切ると止まる',
      reason:
        '既定は無効だが Team Owner が有効にできる（how-credits-work）。商用で運営するサイトが毎月止まる設定のまま続けるとは読まない。Free は補充が無く、止まる',
    },
  ],
};

/** 料金のページ・クレジットの文書の meter をプランごとに作る。 */
const meters = (usd: number) => [
  {
    id: 'web-requests',
    label: 'Web のリクエスト（Netlify: web requests）',
    resource: 'requests' as const,
    unit: 'request' as const,
    pricing: {
      model: 'flat' as const,
      per: 10_000,
      unitPrice: CREDITS.requestsPer10k * usd,
    },
    sourceIds: ['credits'],
  },
  {
    id: 'bandwidth',
    label: '転送（Netlify: bandwidth）',
    resource: 'egress-gb' as const,
    unit: 'gb' as const,
    pricing: {
      model: 'flat' as const,
      per: 1,
      unitPrice: CREDITS.bandwidthGb * usd,
    },
    sourceIds: ['credits'],
  },
  {
    id: 'compute',
    label: '関数の実行（Netlify: compute）',
    resource: 'memory-gb-hours' as const,
    unit: 'gb-hour' as const,
    rounding: 'not-stated' as const,
    pricing: {
      model: 'flat' as const,
      per: 1,
      unitPrice: CREDITS.computeGbHour * usd,
    },
    sourceIds: ['credits', 'functionsBilling'],
  },
  {
    id: 'production-deploys',
    label: '本番のデプロイ（Netlify: production deploys）',
    resource: 'deploys' as const,
    unit: 'count' as const,
    pricing: {
      model: 'flat' as const,
      per: 1,
      unitPrice: CREDITS.deploy * usd,
    },
    sourceIds: ['credits'],
  },
  {
    id: 'blobs-storage',
    label: 'ファイルの保存量（Netlify Blobs: storage）',
    resource: 'storage-gb-month' as const,
    unit: 'gb-month' as const,
    pricing: {
      model: 'unpriced' as const,
      note: 'Netlify Blobs は月のクレジットから使うと Netlify の比較の記事にあるが、GB・操作あたりの単価は公開されていない（Blobs の文書・クレジットの表・料金のページにも記載なし。2026-11-02 に再確認）',
    },
    sourceIds: ['blobs', 'blobsVsVercel'],
  },
];

/** 全プランに共通の事実（構成のノードが facts で挙げたときだけ前提に出す。D-24）。 */
const FACTS = [
  {
    id: 'credits-paused',
    premise:
      'Netlify のクレジットを使い切ると、チームのすべてのサイトが止まり「Site not available」になる（自動の補充を有効にしていなければ）',
    sourceIds: ['credits'],
  },
  {
    id: 'next-runtime',
    premise:
      'Netlify の Next.js は OpenNext のアダプターで設定なしに動き、ISR は時間・オンデマンド（パス・タグ）の再検証とも完全に対応する。SSR・ISR・Route Handler・Server Actions は Netlify Functions、ミドルウェアは Edge Functions で動く',
    sourceIds: ['nextjs'],
  },
  {
    id: 'cdn-cache-functions',
    premise:
      'Netlify Functions の応答は既定でキャッシュされず、Netlify-CDN-Cache-Control などの見出しでキャッシュする。タグで数秒のうちに全体から消せる（同じタグは 5 秒に 2 回まで）',
    interpretation: {
      adopted:
        'キャッシュのヒットは関数を起動しない（リクエストと転送は数え、GB 時間は miss だけ）',
      rejected: [
        {
          reading: 'ヒットでも関数が起動する',
          reason:
            '文書は durable の指定を「関数をもう一度起動せずに他の拠点が使い回す」と説明し、新しいキャッシュが無いときに拠点が関数を起動すると書いている',
        },
      ],
    },
    sourceIds: ['caching'],
  },
  {
    id: 'image-cdn',
    premise:
      'Netlify Image CDN は閲覧のときに変換して拠点にキャッシュする。next/image と Astro の <Image /> がそのまま使う。クレジットの表に変換の項目は無く、画像の配信は転送量（Bandwidth）に数える',
    interpretation: {
      adopted:
        '変換そのものはクレジットを使わず、配信のリクエストと転送だけを数える',
      rejected: [
        {
          reading: '変換に別の料金があり、未取得として残す',
          reason:
            'クレジットの文書は課金の項目の一覧（デプロイ・計算・AI・フォーム・転送・リクエスト）を持ち、画像は転送の内訳「Image serving」としてだけ出てくる',
        },
      ],
    },
    sourceIds: ['credits', 'imageCdn'],
  },
  {
    id: 'blobs',
    premise:
      'Netlify Blobs は自分のサイト（関数・Edge Functions）からだけ読み書きでき、1 つのリージョンに置いて拠点でキャッシュする。料金の単価は公開されていない',
    sourceIds: ['blobs', 'blobsVsVercel'],
  },
  {
    id: 'edge-functions',
    premise:
      'Netlify の Edge Functions はリクエスト（Web requests）として数える。1 リクエストの CPU は 50 ms まで',
    sourceIds: ['credits', 'edgeLimits'],
  },
  {
    id: 'function-outbound',
    premise:
      'Netlify の転送量（Bandwidth）は「サイトがインターネットへ送るデータ」。関数から外の API への問い合わせを含むかは書かれていない',
    interpretation: {
      adopted:
        '関数が外の API・保存先へ送るデータ（問い合わせ・画像のアップロード）も、インターネットへ送るデータとして転送量に数える（受け取る応答は数えない）',
      rejected: [
        {
          reading: '関数から外への通信は数えない',
          reason:
            '文書の定義は送る先を限らない「sends out to the internet」で、除くとは書いていない（数える方を採る）',
        },
      ],
    },
    sourceIds: ['credits'],
  },
  {
    id: 'function-region',
    premise:
      'Netlify Functions の既定のリージョンは米国東部（cmh）。リージョンを替えられるのは Pro と Enterprise（地域で単価は変わらない）',
    sourceIds: ['functionsConfig', 'functionsOptional'],
  },
  {
    id: 'function-limits',
    premise:
      'Netlify Functions の同期の実行は 60 秒まで（替えられない）。メモリは既定 1 GB で、増やせるのはクレジット制の Pro と Enterprise だけ',
    sourceIds: ['functionsConfig'],
  },
  {
    id: 'deploys',
    premise:
      'Netlify は本番へのデプロイ 1 回ごとに 15 クレジットを使う（ビルドの時間は数えない。プレビュー・ブランチのデプロイは 0）',
    sourceIds: ['credits'],
  },
];

/** Free・Personal のメンバー（個人向け。プランの文書の表でメンバーは N/A）。 */
const PERSONAL_MEMBERS = {
  pricing: 'not-stated' as const,
  premise:
    'Netlify Free・Personal は個人向けで、プランの表のチームのメンバーは N/A（メンバーの料金は書かれていない。人を足すなら Pro）',
  sourceIds: ['plans', 'pricing'],
};

const UPTIME = {
  status: 'not-stated' as const,
  premise:
    'Netlify の Free・Personal・Pro は料金のページに稼働率の SLA の記載なし（99.99% の SLA は Enterprise）',
  sourceIds: ['pricing'],
};

export const netlify: PriceBookInput = {
  schemaVersion: 1,
  provider: 'netlify',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://www.netlify.com/pricing/'),
    // 契約の本体（PDF。2025-10 版。§5.4 税・§6 Free Usage Tier）
    agreement: src(
      'https://www.netlify.com/legal/self-serve-subscription-agreement/',
    ),
    // クレジットの単価・使い切ったとき・自動の補充（2026-08-12 更新）
    credits: src(
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/',
    ),
    plans: src(
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/',
    ),
    legacy: src(
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-legacy-plans/legacy-pricing-plans/',
    ),
    // 関数の GB 時間（2026-09-15 更新）
    functionsBilling: src(
      'https://docs.netlify.com/build/functions/usage-and-billing/',
    ),
    functionsConfig: src(
      'https://docs.netlify.com/build/functions/configuration/',
    ),
    functionsOptional: src(
      'https://docs.netlify.com/build/functions/optional-configuration/',
    ),
    edgeLimits: src('https://docs.netlify.com/build/edge-functions/limits/'),
    // 関数の応答のキャッシュ・タグでの無効化（2026-10-10 更新）
    caching: src('https://docs.netlify.com/build/caching/caching-overview/'),
    imageCdn: src('https://docs.netlify.com/build/image-cdn/overview/'),
    // Netlify Blobs（2026-10-16 更新。料金の記載なし）
    blobs: src(
      'https://docs.netlify.com/build/data-and-storage/netlify-blobs/',
    ),
    blobsVsVercel: src(
      'https://www.netlify.com/knowledge-base/netlify-blobs-vs-vercel-blob/',
    ),
    nextjs: src('https://docs.netlify.com/frameworks/next-js/overview/'),
    astro: src(
      'https://docs.netlify.com/build/frameworks/framework-setup-guides/astro/',
    ),
  },
  allowancePools: [],
  plans: [
    {
      id: 'free',
      service: 'platform',
      name: 'Free',
      sourceIds: ['pricing', 'credits', 'agreement'],
      facts: FACTS,
      uptimeSla: UPTIME,
      members: PERSONAL_MEMBERS,
      credits: [
        {
          id: 'monthly-credits',
          label: '月のクレジット（Netlify: monthly credits）',
          amount: INCLUDED.free * CREDIT_USD.free,
          appliesTo: 'all-usage',
          onExhausted: 'block',
          premise:
            'Netlify Free は月 300 クレジット（リクエスト・転送・関数の GB 時間・デプロイで減る）。使い切るとすべてのサイトが止まり、追加で買えない',
          interpretation: {
            adopted:
              '金額はクレジットを Personal の補充の単価（1 クレジット $0.01）で直した使用率の判定のためのもので、請求はされない',
            rejected: [
              {
                reading: 'Free にも従量の請求がある',
                reason: '文書に「You’ll never be charged for the Free plan」',
              },
            ],
          },
          sourceIds: ['credits', 'pricing'],
        },
      ],
      notes: [
        'Free は補充が無く、使い切ると次の月まで止まる（hard limit）',
        '商用利用の可否: 契約（Self-Serve Subscription Agreement 2025-10 §6）の Free Usage Tier の条項に商用利用を禁じる記載は無い（2026-11-02 に PDF の本文で確認。旧来の Free の告知（2024）も商用のプロジェクトを置けると書いていた）。ただし同じ条項は、Free のサイトを予告なく止め・消せる・SLA は無いと書いている',
      ],
      meters: meters(CREDIT_USD.free),
    },
    {
      id: 'personal',
      service: 'platform',
      name: 'Personal',
      baseFee: {
        label: '基本料（Netlify Personal）',
        amount: 9,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['pricing', 'credits'],
      facts: FACTS,
      uptimeSla: UPTIME,
      members: PERSONAL_MEMBERS,
      credits: [
        {
          id: 'monthly-credits',
          label: '月のクレジット（Netlify: monthly credits）',
          amount: INCLUDED.personal * CREDIT_USD.personal,
          appliesTo: 'all-usage',
          premise:
            'Netlify Personal は月 1,000 クレジット。使い切ると自動の補充（500 クレジット $5）で請求が増える（既定は無効で、無効なら止まる）',
          interpretation: CREDIT_INTERPRETATION,
          sourceIds: ['credits', 'pricing'],
        },
      ],
      notes: ['自動の補充の束（500 クレジット）の余りは繰り越す'],
      meters: meters(CREDIT_USD.personal),
    },
    {
      id: 'pro',
      service: 'platform',
      name: 'Pro',
      baseFee: {
        label: '基本料（Netlify Pro）',
        amount: 20,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['pricing', 'credits', 'plans'],
      facts: FACTS,
      uptimeSla: UPTIME,
      members: {
        pricing: 'included',
        premise:
          'Netlify Pro は月 $20 でメンバーの数に制限なし（席の料金なし）',
        sourceIds: ['pricing', 'plans'],
      },
      credits: [
        {
          id: 'monthly-credits',
          label: '月のクレジット（Netlify: monthly credits）',
          amount: INCLUDED.pro * CREDIT_USD.pro,
          appliesTo: 'all-usage',
          premise:
            'Netlify Pro は月 3,000 クレジット。使い切ると自動の補充（1,500 クレジット $10）で請求が増える（既定は無効で、無効なら止まる）',
          interpretation: CREDIT_INTERPRETATION,
          sourceIds: ['credits', 'pricing'],
        },
      ],
      notes: [
        '月 5,000〜20,000 クレジットの Pro は余りを 1 か月繰り越せる（その段の価格はプランの文書が料金のページを指し、料金のページにも載っていない。扱わない）',
        '同時に走るビルドは 3（追加は 1 つ $40 / 月。扱わない）',
      ],
      meters: meters(CREDIT_USD.pro),
    },
  ],
  notes: [
    '2025-09-04 以降に作ったアカウントはクレジット制（旧来の Starter・Pro は既存のアカウントだけで、扱わない）',
    'メーターの金額はクレジットを補充の単価で直したもの（Personal 1 クレジット $0.01・Pro $0.00667）。Free は使用率の判定のための換算',
    'フォームの送信はクレジット制のすべてのプランで無料。AI の推論（1 USD あたり 180 クレジット）は扱わない',
  ],
};
