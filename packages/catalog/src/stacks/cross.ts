// 事業者をまたぐ構成（prd/11 §2・D-52）。部品は自分の事業者（platform）を持ち、差せる土台の事業者（hosts）と
// 接続の形（link）を持つ。差せる組は CROSS_PAIRS の表で許したものだけ（AX-08。公式の文書で現実にできると確かめた組）。
// 表に無い組は部品の選択肢に出さない。今の組は「Vercel・AWS の画像だけ Cloudflare（R2 + 変換）」と、
// SPA の API の置き場（Vercel・AWS の静的 + Cloudflare Workers の API + D1／Cloudflare の静的 + AWS の API Gateway + Lambda + DynamoDB。D-65）、
// Next.js のサーバーから呼ぶ Cloudflare Workers の API + D1（Vercel・Amplify・OpenNext）と、Cloudflare の静的 + さくらの VPS の API（D-67）、
// Astro のサーバー（Vercel・VPS）から呼ぶ Cloudflare Workers の API + D1 と、Cloudflare の Astro + さくらの VPS の API（D-69）。
// 既存の Cloudflare + Hyperdrive（Supabase）・さくらの VPS + 前段の CDN（Cloudflare）は、土台の事業者の部品として
// 先に入っていたもの（D-24 X-6・D-31）で、この表の外にある（アカウントの数は accountsOf で同じく数える）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  bill as awsBill,
  COMPUTE_MEMORY_GB,
  dbNode as awsDbNode,
} from './aws.ts';
import { vpsNode } from './sakura.ts';
import type { FrameworkId } from '../frameworks/index.ts';
import type { Choices, ComponentOption, Platform, SlotId } from './index.ts';

/** 土台と別の事業者の部品の接続の形。 */
export type CrossLink = {
  /**
   * http: 公開の URL（画像の配信・変換・ブラウザから呼ぶ API）。binding・tcp・proxy-binding は段 2 以降（prd/11 §2.2）。
   * API の置き場（D-65）も、ブラウザが別のサブドメインの API を HTTPS で呼ぶ形なので http。
   */
  via: 'http';
  /**
   * 部品の事業者の側で、振る舞いが同じ部品の id（Workload の変え方と、ゲームの画像の大きさ・サイズ違いの判定に使う）。
   * 例: 「Cloudflare: R2 に一律で縮めて置く」は Cloudflare の 'resize' と同じ振る舞い。
   */
  as: string;
};

/** 許した組（土台の事業者 × スロット × 部品の事業者）と、現実にできる根拠（公式の文書・2026-11-01 取得）。 */
export type CrossPair = {
  host: Platform;
  slot: SlotId;
  provider: Platform;
  /** 根拠の要約（出典は catalog の料金データの facts と同じ URL）。 */
  basis: string;
  sources: { url: string; retrievedAt: string }[];
};

export const CROSS_PAIRS: readonly CrossPair[] = [
  {
    host: 'vercel',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'R2 の公開バケットはカスタムドメイン（同じアカウントの Cloudflare のゾーン）で配れて、R2 の転送は無料。' +
      'URL での変換は変換を有効にしたゾーンで頼め、同じゾーンの元の画像は既定で受け付ける。' +
      'Next.js の next/image は Cloudflare の変換の URL を返すローダーに替えられる（公式の例）',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://developers.cloudflare.com/images/pricing/',
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  {
    host: 'aws',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（画像のドメインを Cloudflare のゾーンに置き、R2 から配る・URL で変換する）。' +
      'Lambda の関数がリージョンの外とやり取りするデータは EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      'Amplify の SSR から外への通信の課金は料金ページに記載が無い（未確認）',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/amplify/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  {
    host: 'aws-opennext',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'AWS（Amplify）と同じ（画像のドメインを Cloudflare のゾーンに置き、R2 から配る・URL で変換する）。' +
      '投稿は OpenNext のサーバーの関数（Lambda）が受けて R2 に書き、その転送は EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。D-63',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://developers.cloudflare.com/images/transform-images/sources/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
    ].map((url) => ({ url, retrievedAt: '2026-11-01' })),
  },
  // SPA の API の置き場（prd/10 §3・F-11・D-65。2026-11-02 に原文で確かめた）。ブラウザは静的なサイト（www）から
  // 別のサブドメイン（api）の API を呼ぶ（F-13: 同じサイトのサブドメインに置く前提）。DB は API と同じ事業者に置く
  {
    host: 'vercel',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、そのホスト名では Worker がオリジンになる。' +
      '別のホスト名のサイトから呼ぶ API は Worker が CORS のヘッダーを返す（公式の例）。D1 は Worker の binding から使う' +
      '（D1 の REST API は管理用の面で、Vercel から直接つなぐ形は出さない。AX-10）。' +
      'Vercel の外部への rewrite で同じドメインに見せる形は課金の記載が無い（prd/10 B-3）ので使わない。' +
      'Next.js（D-67）: Server Components は fetch で外の API を呼べ、キャッシュしない fetch は応答まで描画を止める。' +
      'Vercel の料金の文書の課金の項目に、関数から外への通信の転送は無い（数えない）。' +
      'Astro（D-69）: @astrojs/vercel のサーバー（Vercel Functions）が描くページの fetch は実行時に走り、Worker の API を呼べる',
    sources: [
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://developers.cloudflare.com/d1/best-practices/query-d1/',
      'https://developers.cloudflare.com/workers/platform/pricing/',
      'https://nextjs.org/docs/app/getting-started/fetching-data',
      'https://vercel.com/docs/pricing',
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/vercel/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  {
    host: 'aws',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（Worker をカスタムドメインに置き、CORS のヘッダーを返し、D1 を binding で使う）。' +
      'シェル・JS・CSS・画像は S3 + CloudFront に残る。投稿の画像は Worker が S3 に書く（S3 はインターネットからの受信に課金しない）。' +
      'Next.js（Amplify・D-67）: SSR が fetch で Worker の API を呼ぶ。Amplify の料金ページに SSR から外への通信の記載が無い（未確認・数えない）',
    sources: [
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://aws.amazon.com/s3/pricing/',
      'https://nextjs.org/docs/app/getting-started/fetching-data',
      'https://aws.amazon.com/amplify/pricing/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  {
    host: 'cloudflare',
    slot: 'api',
    provider: 'aws',
    basis:
      'シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。API は API Gateway の HTTP API（カスタムドメインを Cloudflare の DNS で向ける）+ Lambda + DynamoDB。' +
      'HTTP API は呼び出しと送り出したデータの量で課金され、外へのデータ転送は EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      '投稿の画像は Lambda が R2 に書く（同じく EC2 のデータ転送の料金）',
    sources: [
      'https://aws.amazon.com/api-gateway/pricing/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  // Next.js の API を別の事業者に（F-14・D-67。2026-11-02 に原文で確かめた）。Next.js のサーバー（SSR・ISR の作り直し・
  // Route Handler）が DB を直接読まず、Worker の API を fetch で呼ぶ。Vercel・AWS（Amplify）の組は上の SPA と同じ行
  // （host × slot × provider）で、Next.js の根拠もここに書く
  {
    host: 'aws-opennext',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Next.js の Server Components は fetch で外の API を呼べ、キャッシュしない fetch は応答まで描画を止める（公式の文書）。' +
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、D1 は Worker の binding で使う。' +
      'OpenNext のサーバーの関数（Lambda）から外へ送るデータは EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      'Vercel の料金の文書の課金の項目に、関数から外への通信の転送は無い（数えない）。Amplify の料金ページにも SSR から外への通信の記載が無い（未確認・数えない）',
    sources: [
      'https://nextjs.org/docs/app/getting-started/fetching-data',
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://vercel.com/docs/pricing',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  // VPS の API + Cloudflare の静的（SPA・D-67）。api のサブドメインを Cloudflare の DNS で VPS に向ける（プロキシしない）
  {
    host: 'cloudflare',
    slot: 'api',
    provider: 'sakura',
    basis:
      'シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。API は さくらの VPS の Node と MySQL。' +
      'api のサブドメインは DNS だけのレコード（「does not route HTTP/HTTPS traffic through its network」）で VPS に直接向け、CDN を通さない。' +
      'さくらの VPS は転送量が無制限（回線は 100 Mbps の共有）。投稿の画像は VPS が R2 に書く（R2 は書き込みの受信に課金しない）。' +
      'Astro（D-69）: 記事は Workers の静的アセット、マイページは @astrojs/cloudflare の Worker が描き、その fetch（実行時に走る）が VPS の API を呼ぶ。' +
      'Worker から外への fetch（サブリクエスト）は課金されず転送の料金も無く、応答を待つ時間は CPU 時間に数えない',
    sources: [
      'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
      'https://developers.cloudflare.com/dns/proxy-status/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://vps.sakura.ad.jp/specification/',
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/cloudflare/',
      'https://developers.cloudflare.com/workers/platform/pricing/',
      'https://developers.cloudflare.com/workers/platform/limits/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  // Astro の VPS（@astrojs/node）から Cloudflare Workers の API + D1 を呼ぶ（D-69）。ページ・静的なファイル・画像は VPS に残る
  {
    host: 'sakura',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      '@astrojs/node（standalone）の Node がページ・API・静的なファイルを配り、リクエストのたびに描くページの fetch は実行時に走る。' +
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、D1 は Worker の binding で使う。' +
      'さくらの VPS は転送量が無制限なので、VPS から Worker への問い合わせに転送の料金はかからない。MySQL は VPS に置かない',
    sources: [
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/node/',
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://vps.sakura.ad.jp/specification/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  // Netlify（D-71・2026-11-02 に原文で確かめた）。関数から外へ送るデータは Netlify の転送量（クレジット）に数える（netlify の
  // function-outbound の解釈）。Workers の API・R2 の画像は Vercel と同じ形
  {
    host: 'netlify',
    slot: 'images',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（R2 の公開バケットを Cloudflare のゾーンのカスタムドメインで配り、URL で変換する。next/image はローダーを替えられる）。' +
      '投稿は Netlify Functions が受けて R2 に書き、送るデータは Netlify の転送量（Bandwidth は「サイトがインターネットへ送るデータ」）に数える',
    sources: [
      'https://developers.cloudflare.com/r2/buckets/public-buckets/',
      'https://developers.cloudflare.com/r2/pricing/',
      'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
  {
    host: 'netlify',
    slot: 'api',
    provider: 'cloudflare',
    basis:
      'Vercel と同じ（Worker をカスタムドメインに置き、CORS のヘッダーを返し、D1 を binding で使う）。' +
      'SPA: シェル・JS・CSS・画像は Netlify に残り、投稿の画像は Netlify Functions が Netlify Blobs に書く（Blobs は自分のサイトからだけ使える）。' +
      'Next.js: Netlify Functions のサーバーが fetch で Worker の API を呼ぶ。Astro: @astrojs/netlify の関数が描くページの fetch は実行時に走る。' +
      'サーバーから Worker へ送る問い合わせは Netlify の転送量に数える（受け取る応答は数えない）',
    sources: [
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://developers.cloudflare.com/d1/worker-api/',
      'https://nextjs.org/docs/app/getting-started/fetching-data',
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/netlify/',
      'https://docs.netlify.com/build/data-and-storage/netlify-blobs/',
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/',
    ].map((url) => ({ url, retrievedAt: '2026-11-02' })),
  },
];

const VERCEL_TO_CF_IMAGES_REFS = [
  'fact:cloudflare:r2-standard:custom-domain',
  'pool:cloudflare:r2-storage',
];

/** 他の事業者の部品（表で許した組だけ）。label は事業者の名前を前に付ける（prd/11 §3.1）。 */
export const CROSS_COMPONENTS: readonly ComponentOption[] = [
  {
    id: 'cf-images',
    slot: 'images',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'aws-opennext', 'netlify'],
    link: { via: 'http', as: 'images' },
    label: 'Cloudflare: R2 に置き、閲覧のときに Images で変換',
    note:
      '画像の原本を Cloudflare の R2 に置き、画像のドメイン（Cloudflare のゾーン）の URL で変換して配る。土台（Vercel・AWS・Netlify）の CDN を通らないので、' +
      '画像の転送は土台の転送の料金にならない（R2 の転送は無料）。一意な変換（種類 × サイズ違い）を月ごとに数える。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      ...VERCEL_TO_CF_IMAGES_REFS,
      'fact:cloudflare:images-paid:transform-url',
      'fact:cloudflare:images-free:transform-url',
      'pool:cloudflare:images-transformations',
    ],
  },
  {
    id: 'cf-resize',
    slot: 'images',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'aws-opennext', 'netlify'],
    link: { via: 'http', as: 'resize' },
    label: 'Cloudflare: 投稿のときに一律で縮めて R2 に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloudflare の R2 に置き、原本は残さない。' +
      '画像のドメイン（Cloudflare のゾーン）から配るので、画像の転送は土台（Vercel・AWS・Netlify）の転送の料金にならない（R2 の転送は無料）。' +
      '変換のサービスは使わない。サイズ違いが無いので、スマホにも同じ大きさを配る。Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [...VERCEL_TO_CF_IMAGES_REFS],
  },
  // SPA の API の置き場（D-65）。label・note の方針は画像と同じ（事業者の名前を前に付け、損は note で分かるようにする）
  {
    id: 'cf-workers',
    slot: 'api',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'netlify'],
    frameworks: ['vite-spa'],
    link: { via: 'http', as: 'same' },
    label: 'Cloudflare: Workers に API を置き、DB は D1',
    note:
      'API を Cloudflare の Worker（api のサブドメイン）に置き、DB は D1 を binding で使う。静的なファイル（シェル・JS・CSS）と画像は今の事業者から配る。' +
      'ブラウザは別のサブドメインの API を呼ぶので、CORS のヘッダーと認証の Cookie の設定が要る。今の事業者の関数と DB は使わなくなる。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:cloudflare:workers-paid:custom-domain-origin',
      'fact:cloudflare:workers-paid:cors-headers',
      'fact:cloudflare:workers-paid:d1-binding',
      'pool:cloudflare:workers-paid:paid-requests',
      'limit:cloudflare:workers-free:cpu-ms-per-request',
    ],
  },
  {
    id: 'aws-lambda',
    slot: 'api',
    platform: 'aws',
    hosts: ['cloudflare'],
    frameworks: ['vite-spa'],
    link: { via: 'http', as: 'same' },
    label: 'AWS: API Gateway + Lambda に API を置き、DB は DynamoDB',
    note:
      'API を AWS の API Gateway（HTTP API・api のサブドメイン）+ Lambda に置き、DB は DynamoDB（オンデマンド）。静的なファイルと画像は Cloudflare から配る（静的アセットは Worker を起動しない）。' +
      'API の応答は CloudFront を通らずに AWS から外へ送るので、データ転送の料金（月 100 GB の無料の後）がかかる。' +
      'ブラウザは別のサブドメインの API を呼ぶので、CORS のヘッダーと認証の Cookie の設定が要る。AWS のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:aws:data-transfer-out:api-gateway-out',
      'pool:aws:lambda:lambda-free-requests',
      'fact:aws:dynamodb-on-demand:request-units',
      'fact:cloudflare:workers-paid:static-assets',
    ],
  },
  // Next.js の API を別の事業者に（F-14・D-67）。ブラウザは今の事業者の Next.js だけを呼び、Next.js のサーバーが Worker を呼ぶ
  {
    id: 'cf-workers-server',
    slot: 'api',
    platform: 'cloudflare',
    hosts: ['vercel', 'aws', 'aws-opennext', 'netlify'],
    frameworks: ['nextjs'],
    link: { via: 'http', as: 'same' },
    label:
      'Cloudflare: Workers に API を置き、DB は D1（Next.js のサーバーから呼ぶ）',
    note:
      'API を Cloudflare の Worker（api のサブドメイン）に置き、DB は D1 を binding で使う。Next.js のサーバー（SSR・ISR の作り直し・Route Handler）は DB を直接読まず、' +
      'Worker の API を fetch で呼び、ページの描画は応答を待つ（往復の遅延は計算しない）。ブラウザは今の事業者の Next.js だけを呼ぶので CORS の設定は要らない（サーバーどうしの認証は要る）。' +
      'API を呼ぶたびに Worker のリクエストとして数える。今の事業者の DB は使わなくなる。' +
      'OpenNext の Lambda から送る問い合わせは AWS のデータ転送の料金、Netlify の関数から送る問い合わせは Netlify の転送量で数え、Vercel・Amplify は料金の文書に項目が無いので数えない。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [
      'fact:cloudflare:workers-paid:custom-domain-origin',
      'fact:cloudflare:workers-paid:server-fetch',
      'fact:cloudflare:workers-free:server-fetch',
      'fact:cloudflare:workers-paid:d1-binding',
      // サーバーから外への通信を数えない（Vercel・Amplify）／数える（OpenNext の Lambda）根拠
      'fact:vercel:hobby:function-outbound',
      'fact:vercel:pro:function-outbound',
      'fact:aws:amplify-hosting:ssr-outbound',
      'fact:aws:data-transfer-out:lambda-out',
      'fact:netlify:pro:function-outbound',
      'pool:cloudflare:workers-paid:paid-requests',
      'limit:cloudflare:workers-free:cpu-ms-per-request',
    ],
  },
  // Astro のサーバーから呼ぶ API（D-69）。Next.js の cf-workers-server と同じ形（ブラウザは今の事業者の Astro だけを呼ぶ）で、
  // 差せる土台が違う（Vercel と VPS。Astro は AWS に載せない）ので部品を分ける
  {
    id: 'cf-workers-astro',
    slot: 'api',
    platform: 'cloudflare',
    hosts: ['vercel', 'sakura', 'netlify'],
    frameworks: ['astro'],
    link: { via: 'http', as: 'same' },
    label:
      'Cloudflare: Workers に API を置き、DB は D1（Astro のサーバーから呼ぶ）',
    note:
      'API を Cloudflare の Worker（api のサブドメイン）に置き、DB は D1 を binding で使う。Astro のサーバー（マイページの SSR・エンドポイント）は DB を直接読まず、' +
      'Worker の API を fetch で呼び、ページの描画は応答を待つ（往復の遅延は計算しない）。記事は今までどおり静的にビルドして今の場所から配る。' +
      'ブラウザは今の事業者の Astro だけを呼ぶので CORS の設定は要らない（サーバーどうしの認証は要る）。API を呼ぶたびに Worker のリクエストとして数える。' +
      '今の DB（Supabase・VPS の MySQL）は使わなくなる。Vercel の関数・VPS から外への通信は数えない（Vercel は料金の文書に項目が無く、VPS は転送量が無制限）。Netlify の関数から送る問い合わせは Netlify の転送量で数える。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [
      'fact:cloudflare:workers-paid:custom-domain-origin',
      'fact:cloudflare:workers-paid:astro-server-fetch',
      'fact:cloudflare:workers-free:astro-server-fetch',
      'fact:cloudflare:workers-paid:d1-binding',
      'fact:vercel:hobby:function-outbound',
      'fact:vercel:pro:function-outbound',
      'fact:netlify:pro:function-outbound',
      'pool:cloudflare:workers-paid:paid-requests',
      'limit:cloudflare:workers-free:cpu-ms-per-request',
    ],
  },
  // VPS の API + Cloudflare の静的（SPA・D-67）。自前運用の維持の手間・障害は部品で VPS を使うときにも効く（game の selfHostedOf）。
  // プランは 2GB と 4GB（ディスクが 2 倍）。プランの間の移し替えも API と DB のデータの移行として扱う（仮定）
  ...(['2gb', '4gb'] as const).map((plan): ComponentOption => ({
    id: `sakura-vps-${plan}`,
    slot: 'api',
    platform: 'sakura',
    hosts: ['cloudflare'],
    // Astro（D-69）: 記事は静的アセット、マイページを描く Worker が VPS の API を呼ぶ
    frameworks: ['vite-spa', 'astro'],
    link: { via: 'http', as: 'same' },
    label: `さくらの VPS: ${plan.toUpperCase()} に API と MySQL を置く（自前運用）`,
    note:
      `API を さくらの VPS ${plan.toUpperCase()}（東京）の Node に置き、DB は同じ VPS の MySQL。api のサブドメインは Cloudflare の DNS で VPS に直接向ける（プロキシしない DNS だけのレコードで、CDN を通らない）。` +
      '静的なファイル（SPA のシェル・Astro の記事のページ）・JS・CSS と画像は Cloudflare から配る。Astro のマイページは Worker が描き、その中から VPS の API を呼ぶ。月額は固定で転送量は無制限だが、回線（100 Mbps の共有）・CPU・メモリ・ディスクに上限があり、話題の集中も API の分が VPS に届く。' +
      '自前運用の維持の手間と偶発的な障害（1 台構成）が加わる。ブラウザは別のサブドメインの API を呼ぶので、CORS のヘッダーと認証の Cookie の設定が要る。' +
      'さくらのアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'host:',
      'fact:cloudflare:workers-paid:static-assets',
      'fact:cloudflare:workers-paid:astro-server-fetch',
      'fact:cloudflare:workers-free:astro-server-fetch',
      'fact:cloudflare:workers-paid:worker-outbound',
      'fact:cloudflare:workers-free:worker-outbound',
    ],
  })),
];

/** API を他の事業者に置いているか（SPA の API の置き場・D-65。既定・省略は同じ事業者）。 */
export const apiPlacedElsewhere = (c: Choices): boolean =>
  c.api !== undefined && c.api !== 'same';

/** 部品を差せる土台の事業者（省略は自分の事業者だけ）。 */
export const hostsOf = (c: ComponentOption): readonly Platform[] =>
  c.hosts ?? [c.platform];

/** 部品の振る舞いの id（他の事業者の部品は、同じ振る舞いの部品の id。それ以外はそのまま）。 */
export function behaviorOf(
  options: readonly ComponentOption[],
  host: Platform,
  slot: SlotId,
  id: string | undefined,
): string | undefined {
  const o = options.find(
    (x) => x.slot === slot && x.id === id && hostsOf(x).includes(host),
  );
  return o?.link?.as ?? id;
}

/** 構成の課金のアカウント（ノードの billing.accountId の種類。出てきた順）。 */
export function accountsOf(arch: ArchitectureInput): string[] {
  return [
    ...new Set(
      arch.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
}

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** Cloudflare の画像のドメインのキャッシュのヒット率（仮定。Cloudflare の構成の R2 公開バケットと同じ値）。 */
const CF_IMAGE_HIT_RATE = 0.9;

/**
 * 土台ごとの、画像のノード（外すもの）と投稿の経路（R2 の手前まで）。土台の構成のノードの id に頼るので、
 * 土台の構成（index.ts・aws.ts）で画像のノードの id を変えたらここも直す（cross.test.ts が経路で確かめる）。
 * - Vercel: 画像の最適化（image）・Vercel Blob（blob）を外す。投稿は関数が受けて R2 に書く。関数から外への通信の Vercel の課金は
 *   公式の文書に記載が見当たらない（未確認）ので数えない。
 * - AWS（Amplify）: 画像の最適化（image）・画像だけの CloudFront（cf）・S3（s3）を外す。投稿は Amplify の SSR が受けて R2 に書く。
 *   Amplify の SSR から外への通信の課金は料金ページに記載が無い（未確認）ので数えない。
 * - AWS の OpenNext（Next.js）: 画像の最適化の関数（image-fn）・S3（s3）を外す。投稿はサーバーの関数が受けて R2 に書き、転送を数える（D-63）。
 * - AWS（S3 + CloudFront + Lambda の SPA。OpenNext の SPA も同じ）: S3（s3）を外す（CloudFront はシェルと API に残る）。投稿は Lambda が受けて R2 に書き、
 *   その転送を東京 → インターネットの転送（月 100 GB 無料の後 $0.114/GB）で数える（Lambda の料金ページ: リージョンの外との
 *   データの出入りは EC2 のデータ転送の料金）。
 * R2 は書き込みの受信に課金しない（料金表に項目が無い）。
 */
function hostImageShape(
  host: Platform,
  arch: ArchitectureInput,
): { remove: string[]; write: string[]; out?: ArchNodeIn } | undefined {
  if (host === 'vercel') return { remove: ['image', 'blob'], write: ['fn'] };
  // Netlify（D-71）: Image CDN（image）・Blobs（blob）を外す。投稿は関数が受けて（Web requests は upload で数える）R2 に書き、
  // 送るデータを Netlify の転送量で数える
  if (host === 'netlify') {
    const out = netlifyOut(arch, 'R2 への書き込み');
    return out
      ? { remove: ['image', 'blob'], write: ['upload', 'fn', out.id], out }
      : undefined;
  }
  if (host !== 'aws' && host !== 'aws-opennext') return undefined;
  if (arch.id === 'aws-amplify')
    return { remove: ['image', 'cf', 's3'], write: ['ssr'] };
  const out = awsOut();
  // OpenNext（Next.js）: 画像の最適化の関数（image-fn）・S3（s3）を外す。CloudFront（cf）はページ・静的に残る。
  // 投稿はサーバーの関数（Lambda）が受けて R2 に書き、その転送を東京 → インターネットで数える（D-63）
  if (arch.id === 'aws-opennext')
    return { remove: ['image-fn', 's3'], write: ['server', 'aws-out'], out };
  return { remove: ['s3'], write: ['apigw', 'lambda', 'aws-out'], out };
}

/**
 * Netlify の関数から外（R2・Worker の API）へ送るデータを、Netlify の転送量（Bandwidth）で数えるだけのノード（D-71）。
 * 課金先のプランは土台の関数（fn）と同じ。requestKB を渡すと 1 回の大きさをそれにする（問い合わせ）。
 */
function netlifyOut(
  arch: ArchitectureInput | { plan: string },
  what: string,
  requestKB?: number,
): ArchNodeIn | undefined {
  const planId =
    'plan' in arch
      ? arch.plan
      : arch.nodes.find((n) => n.id === 'fn')?.billing?.planId;
  if (!planId) return undefined;
  return {
    id: requestKB === undefined ? 'netlify-out' : 'netlify-out-api',
    label: `Netlify → インターネット（${what}）`,
    config: {
      kind: 'cdn',
      hitRate: {},
      ...(requestKB !== undefined ? { egressKBPerRequest: requestKB } : {}),
    },
    facts: ['function-outbound'],
    billing: {
      accountId: 'netlify',
      provider: 'netlify',
      planId,
      meters: { 'egress-gb': 'bandwidth' },
    },
  };
}

/** Lambda から外（R2）へ送る転送を数えるだけのノード（cdn の種類でヒットなし。課金は転送だけ）。 */
function awsOut(): ArchNodeIn {
  return {
    id: 'aws-out',
    label: 'AWS → インターネット（R2 への書き込み）',
    config: { kind: 'cdn', hitRate: {} },
    facts: ['lambda-out'],
    billing: {
      accountId: 'aws',
      provider: 'aws',
      planId: 'data-transfer-out',
      meters: { 'egress-gb': 'internet-out' },
    },
  };
}

/**
 * 土台の構成に、他の事業者の部品を差す（composeStack から呼ぶ）。今は Vercel・AWS の画像のスロットだけ。
 * 画像の配信・保存・変換を土台の CDN・置き場・画像の最適化から、Cloudflare の R2・画像のドメインのキャッシュ・Images に移す。
 */
export function applyCross(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  framework: FrameworkId | undefined,
): ArchitectureInput {
  const opt = CROSS_COMPONENTS.find(
    (c) =>
      c.slot === 'images' &&
      c.id === choices.images &&
      hostsOf(c).includes(host),
  );
  const shape = opt ? hostImageShape(host, arch) : undefined;
  if (!opt || !shape) return arch;
  const transform = opt.link!.as === 'images';
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  // Vercel Hobby（個人・非商用）は Images Free（月 5,000 の一意な変換まで・超えると 9422）、それ以外（Vercel Pro・AWS）は Images Paid（仮定）
  const imagesPlan = plan === 'hobby' ? 'images-free' : 'images-paid';
  const nodes: ArchNodeIn[] = [
    ...arch.nodes.filter((n) => !shape.remove.includes(n.id)),
    ...(shape.out ? [shape.out] : []),
    {
      id: 'cf-cache',
      label: 'Cloudflare（画像のドメインのキャッシュ）',
      config: { kind: 'cdn', hitRate: { 'image-read': CF_IMAGE_HIT_RATE } },
    },
    {
      id: 'cf-r2',
      label: 'Cloudflare R2（画像）',
      config: { kind: 'object-storage' },
      facts: ['custom-domain', 'egress-other-services'],
      billing: bill('r2-standard', {
        'storage-gb-month': 'storage',
        'object-writes': 'class-a',
        'object-reads': 'class-b',
        'egress-gb': 'egress',
      }),
    },
    ...(transform
      ? [
          {
            id: 'cf-images',
            label: 'Cloudflare Images（URL で変換）',
            config: { kind: 'image-optimizer' },
            facts: [
              'transform-url',
              'outside-images',
              ...(framework === undefined || framework === 'nextjs'
                ? ['next-loader']
                : []),
            ],
            billing: bill(imagesPlan, {
              'image-transformations': 'transformations',
            }),
          } as ArchNodeIn,
        ]
      : []),
  ];
  const routes: Partial<Record<RequestClass, string[]>> = {
    ...arch.routes,
    'image-read': ['cf-cache', 'cf-r2'],
    'image-write': [...shape.write, 'cf-r2'],
  };
  if (transform) routes['image-transform'] = ['cf-images'];
  else delete routes['image-transform'];
  return { ...arch, nodes, routes };
}

// ---- API の置き場（SPA は D-65・prd/10 §3。Next.js と VPS は D-67）----

/** API と一緒に他の事業者に移す（使わなくなれば外す）土台のノード。DB は API と同じ事業者に置く。 */
const AWS_API_NODES = [
  'apigw',
  'lambda',
  'aws-out',
  'dynamodb',
  'rds',
  'aurora',
  'aurora-pause',
  'dsql',
] as const;
const HOST_API_NODES: Partial<Record<Platform, readonly string[]>> = {
  vercel: ['fn', 'db'],
  netlify: ['fn', 'db'],
  aws: AWS_API_NODES,
  'aws-opennext': AWS_API_NODES,
  cloudflare: ['worker', 'd1', 'kv-db', 'hyperdrive', 'supabase'],
};

/** Next.js・Astro の構成で、サーバーが読む DB のノード（ここを他の事業者の API に差し替える）。 */
const HOST_DB_NODES: Partial<Record<Platform, readonly string[]>> = {
  vercel: ['db'],
  netlify: ['db'],
  cloudflare: ['d1', 'kv-db', 'hyperdrive', 'supabase'],
  aws: ['dynamodb', 'rds', 'aurora', 'aurora-pause', 'dsql'],
  'aws-opennext': ['dynamodb', 'rds', 'aurora', 'aurora-pause', 'dsql'],
};

/**
 * Next.js のサーバーに呼ばれた Worker が D1 を読んで JSON を返す 1 回の CPU（ms。ゲーム上の仮定。記事コミュニティの API の CPU と同じ値）。
 * SSR・ISR の作り直しの CPU（HTML の描画）は Next.js のサーバーの側に残る。
 */
export const SERVER_API_WORKER_CPU_MS = 5;
/**
 * DB を他の事業者に出した VPS の常駐メモリ（GB。仮定）。vpsNode の 1.35（OS 0.3・MySQL 0.6・Node 0.4・nginx 0.05）から MySQL を除いた値。
 */
export const VPS_RESIDENT_WITHOUT_DB_GB = 0.75;
/** Next.js のサーバーから外の API への 1 回の問い合わせで送るデータ（KB。ゲーム上の仮定）。応答の受信は課金されない。 */
export const SERVER_API_REQUEST_KB = 1;

/**
 * Cloudflare の Worker（API）と D1。土台が Vercel Hobby なら Workers Free、それ以外は Workers Paid（仮定）。
 * server はサーバーから呼ぶ形のフレームワーク（Next.js は D-67・Astro は D-69。false はブラウザから呼ぶ SPA）。
 */
function cfApiNodes(
  plan: string,
  server: false | 'nextjs' | 'astro',
): ArchNodeIn[] {
  const workers = plan === 'hobby' ? 'workers-free' : 'workers-paid';
  const bill = (meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId: workers,
    meters,
  });
  return [
    {
      id: 'cf-worker',
      label: server
        ? `Cloudflare Worker（API・${server === 'astro' ? 'Astro' : 'Next.js'} のサーバーから呼ぶ）`
        : 'Cloudflare Worker（API）',
      config: server
        ? {
            kind: 'function',
            classCpuMs: {
              'document-ssr': SERVER_API_WORKER_CPU_MS,
              'isr-revalidate': SERVER_API_WORKER_CPU_MS,
            },
          }
        : { kind: 'function' },
      facts: server
        ? [
            'custom-domain-origin',
            server === 'astro' ? 'astro-server-fetch' : 'server-fetch',
            'd1-binding',
          ]
        : ['custom-domain-origin', 'cors-headers', 'd1-binding'],
      billing: bill({ requests: 'requests', 'cpu-ms': 'cpu-ms' }),
    },
    {
      id: 'cf-d1',
      label: 'Cloudflare D1',
      config: { kind: 'sql-db' },
      billing: bill({
        'rows-read': 'd1-rows-read',
        'rows-written': 'd1-rows-written',
        ...(workers === 'workers-paid'
          ? { 'storage-gb-month': 'd1-storage' }
          : {}),
      }),
    },
  ];
}

/** OpenNext のサーバーの関数（Lambda）から外の API へ送る問い合わせ（応答の大きさでなく、1 回 SERVER_API_REQUEST_KB で数える）。 */
function awsOutToApi(): ArchNodeIn {
  return {
    id: 'aws-out-api',
    label: 'AWS → インターネット（外の API への問い合わせ）',
    config: {
      kind: 'cdn',
      hitRate: {},
      egressKBPerRequest: SERVER_API_REQUEST_KB,
    },
    facts: ['lambda-out'],
    billing: awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
  };
}

/** Netlify の関数から外の API へ送る問い合わせ（1 回 SERVER_API_REQUEST_KB。D-71）。 */
const netlifyOutToApi = (plan: string): ArchNodeIn =>
  netlifyOut({ plan }, '外の API への問い合わせ', SERVER_API_REQUEST_KB)!;

/** AWS の API Gateway（HTTP API）+ Lambda + DynamoDB と、AWS から外へ送る転送（API の応答・R2 への書き込み）。 */
function awsApiNodes(): ArchNodeIn[] {
  return [
    {
      id: 'aws-out',
      label: 'AWS → インターネット（API の応答・R2 への書き込み）',
      config: { kind: 'cdn', hitRate: {} },
      facts: ['api-gateway-out', 'lambda-out'],
      billing: awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
    },
    {
      id: 'apigw',
      label: 'API Gateway（HTTP API）',
      // HTTP API は 512 KB ごとに 1 リクエスト（aws.ts の SPA と同じ）
      config: { kind: 'cdn', hitRate: {}, requestUnitKB: 512 },
      billing: awsBill('api-gateway-http', { requests: 'requests' }),
    },
    {
      id: 'lambda',
      label: 'Lambda（API）',
      config: { kind: 'function', memoryGB: COMPUTE_MEMORY_GB, concurrency: 1 },
      billing: awsBill('lambda', {
        invocations: 'requests',
        'memory-gb-hours': 'compute',
      }),
    },
    awsDbNode('dynamodb'),
  ];
}

/**
 * 置き場ごとの、足すノードと API の経路。write は投稿の画像を書く手前まで（書き先は土台の経路の最後のノード。SPA だけ）。
 * Next.js（cf-workers-server）の api は、土台の経路の DB のノードと差し替える列。
 */
function placement(
  id: string,
  plan: string,
  host: Platform,
): { nodes: ArchNodeIn[]; api: string[]; write: string[] } | undefined {
  if (id === 'cf-workers')
    return {
      nodes: cfApiNodes(plan, false),
      api: ['cf-worker', 'cf-d1'],
      // Worker は R2 に binding で書き、S3 には HTTPS で書く（S3 はインターネットからの受信に課金しない）
      write: ['cf-worker'],
    };
  if (id === 'aws-lambda')
    return {
      nodes: awsApiNodes(),
      // 応答は API Gateway から外へ送る（CloudFront を通らない）ので、転送を数えるノードを前に置く
      api: ['aws-out', 'apigw', 'lambda', 'dynamodb'],
      write: ['apigw', 'lambda', 'aws-out'],
    };
  if (id === 'cf-workers-server') {
    // OpenNext の Lambda から外へ送る問い合わせだけ数える（Vercel・Amplify は料金の文書に項目が無い。数えない）
    // Netlify の関数から送る問い合わせは Netlify の転送量で数える（D-71）
    const out =
      host === 'aws-opennext'
        ? [awsOutToApi()]
        : host === 'netlify'
          ? [netlifyOutToApi(plan)]
          : [];
    return {
      nodes: [...out, ...cfApiNodes(plan, 'nextjs')],
      api: [...out.map((n) => n.id), 'cf-worker', 'cf-d1'],
      write: [],
    };
  }
  // Astro のサーバー（Vercel の関数・VPS の Node）から呼ぶ（D-69）。Vercel の関数・VPS から外への通信は数えない
  if (id === 'cf-workers-astro') {
    const out = host === 'netlify' ? [netlifyOutToApi(plan)] : [];
    return {
      nodes: [...out, ...cfApiNodes(plan, 'astro')],
      api: [...out.map((n) => n.id), 'cf-worker', 'cf-d1'],
      write: [],
    };
  }
  if (id === 'sakura-vps-2gb' || id === 'sakura-vps-4gb') {
    const vps = id === 'sakura-vps-2gb' ? '2gb' : '4gb';
    return {
      // api のサブドメインは DNS だけのレコードで VPS に直接向ける（Cloudflare の CDN を通らない）。
      // VPS から R2 への書き込みは、さくらの転送量無制限・R2 は受信に課金しない。ストレージ変更オプションは付けない（仮定）
      nodes: [
        vpsNode(
          vps,
          false,
          `さくらの VPS ${vps.toUpperCase()}（Node の API + MySQL）`,
          false,
        ),
      ],
      api: ['vps'],
      write: ['vps'],
    };
  }
  return undefined;
}

/**
 * API を他の事業者に置く（composeStack から、SPA の形にした後で呼ぶ。SPA は D-65・Next.js と VPS は D-67）。
 * - SPA: 記事の中身の API（api-content）ともともとの API（api）を、他の事業者の API と DB へ向ける。投稿の画像は API が受けて、
 *   今の置き場（R2・S3）に書く。Vercel Blob だけはアップロードを Vercel の関数に残す（Blob の書き込みの手順が
 *   Vercel の関数を前提にしているため。仮定）。
 * - Next.js: サーバー（SSR・ISR の作り直し・Route Handler）の経路の DB を、他の事業者の API（Worker → D1）に差し替える。
 *   ブラウザから見える経路（CDN → サーバー）は変わらない。
 * 土台の関数・DB は、ほかの経路（OGP の前処理・リアルタイム・Blob のアップロード）が使っていなければ外す。
 * standby.api（差し替えの途中）が別の置き場なら、その置き場のノードを経路に載せずに足す（常時かかる分だけ課金される）。
 */
export function applyCrossApi(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  standby: Choices,
  framework: FrameworkId,
): ArchitectureInput {
  const allowed = (id: string | undefined) =>
    id !== undefined &&
    CROSS_COMPONENTS.some(
      (c) =>
        c.slot === 'api' &&
        c.id === id &&
        hostsOf(c).includes(host) &&
        (c.frameworks ?? []).includes(framework),
    );
  const current = choices.api ?? 'same';
  const next = standby.api;
  const cur = allowed(current) ? placement(current, plan, host) : undefined;
  const nxt =
    next !== undefined && next !== current && allowed(next)
      ? placement(next, plan, host)
      : undefined;
  if (!cur && !nxt) return arch;
  const spa = framework === 'vite-spa';
  const astro = framework === 'astro';
  // Cloudflare の Astro + VPS の API（D-69）: ブラウザの API・投稿は SPA と同じく VPS へ直接、マイページを描く Worker も VPS の API を呼ぶ
  const browserCalls = spa || (astro && host === 'cloudflare');
  let routes: Partial<Record<RequestClass, string[]>> = { ...arch.routes };
  let nodes = [...arch.nodes];
  const addAll = (ns: ArchNodeIn[]) =>
    nodes.push(...ns.filter((n) => !nodes.some((x) => x.id === n.id)));
  /** 経路の DB のノードを API の列に差し替える（連続した DB のノード（Hyperdrive → Supabase）は 1 回だけ）。 */
  const replaceDb = (api: readonly string[]) => {
    const db = HOST_DB_NODES[host] ?? [];
    routes = Object.fromEntries(
      Object.entries(routes).map(([cls, path]) => [
        cls,
        path!.flatMap((id, i) =>
          !db.includes(id)
            ? [id]
            : i > 0 && db.includes(path![i - 1]!)
              ? []
              : api,
        ),
      ]),
    );
  };
  if (cur && browserCalls) {
    if (astro) replaceDb(cur.api);
    routes.api = [...cur.api];
    if (spa || routes['api-content']) routes['api-content'] = [...cur.api];
    const write = routes['image-write'];
    const target = write?.[write.length - 1];
    if (target && target !== 'blob')
      routes['image-write'] = [...cur.write, target];
  } else if (cur && host === 'sakura') {
    // VPS の Astro（D-69）: DB は VPS の中（ノードが無い）ので、DB を読む経路（マイページ・API）の VPS の後に API を足す
    for (const cls of ['document-ssr', 'api', 'api-content'] as const)
      if (routes[cls]?.includes('vps'))
        routes[cls] = routes[cls]!.flatMap((id) =>
          id === 'vps' ? ['vps', ...cur.api] : [id],
        );
  } else if (cur) replaceDb(cur.api);
  if (cur) addAll(cur.nodes);
  // 同じ id で別の契約のノード（VPS 2GB ↔ 4GB の移し替え）は、新しい側を別の id で足す（新旧の両方の月額を払う）
  if (nxt)
    addAll(
      nxt.nodes.map((n) =>
        nodes.some(
          (x) => x.id === n.id && x.billing?.planId !== n.billing?.planId,
        )
          ? { ...n, id: `${n.id}-next` }
          : n,
      ),
    );
  // 同じ事業者へ戻す途中は、土台の関数・DB を残す（新旧の両方を動かす）
  const keepHost = next === 'same' && current !== 'same';
  if (cur && !keepHost) {
    const used = new Set(Object.values(routes).flat());
    const placed = new Set(
      [...cur.nodes, ...(nxt?.nodes ?? [])].map((n) => n.id),
    );
    const drop = (HOST_API_NODES[host] ?? []).filter(
      (id) => !used.has(id) && !placed.has(id),
    );
    nodes = nodes.filter((n) => !drop.includes(n.id));
  }
  // VPS の Astro の DB を Workers・D1 に出したら、VPS は MySQL を動かさず、ディスクに DB を置かない（D-69。移し替えの途中は残す）
  if (cur && host === 'sakura' && !keepHost)
    nodes = nodes.map((n): ArchNodeIn =>
      n.id === 'vps' && n.config.kind === 'host'
        ? {
            ...n,
            label: 'VPS（nginx + Astro の Node。DB は D1）',
            config: {
              ...n.config,
              residentMemoryGB: VPS_RESIDENT_WITHOUT_DB_GB,
              dbCpuMsPerQuery: 0,
              storesDb: false,
            },
          }
        : n,
    );
  // Cloudflare の Astro: マイページを描く Worker が VPS の API を fetch で呼ぶ（課金されず、待つ時間は CPU 時間に数えない）。
  // VPS はページを描かず、API の 1 回として数える（OCL-4D1F5201）
  if (cur && astro && host === 'cloudflare')
    nodes = nodes.map((n): ArchNodeIn =>
      n.config.kind === 'host' && cur.nodes.some((x) => x.id === n.id)
        ? {
            ...n,
            config: { ...n.config, serverApiClasses: ['document-ssr'] },
          }
        : n.id === 'worker'
          ? {
              ...n,
              label: 'Worker（Astro。VPS の API を呼ぶ）',
              facts: [
                ...(n.facts ?? []),
                'astro-server-fetch',
                'worker-outbound',
              ],
            }
          : n,
    );
  if (cur && !spa)
    nodes = nodes.map((n): ArchNodeIn => {
      // サーバーから外の API への通信: Vercel の関数・Amplify の SSR は料金の文書に項目が無いので数えない（事実の文で出す）
      if ((host === 'vercel' || host === 'netlify') && n.id === 'fn')
        return { ...n, facts: [...(n.facts ?? []), 'function-outbound'] };
      if (host === 'aws' && n.id === 'ssr')
        return { ...n, facts: [...(n.facts ?? []), 'ssr-outbound'] };
      return n;
    });
  if (cur && host === 'cloudflare' && !astro)
    nodes = nodes.map((n): ArchNodeIn => {
      // Worker が OGP の前処理・リアルタイムだけに残るときの名前
      if (n.id === 'worker')
        return { ...n, label: 'Worker（OGP の前処理・リアルタイム）' };
      // Worker の binding でなく、ゾーンの URL で変換する
      if (n.id === 'images')
        return {
          ...n,
          label: 'Images（URL で変換）',
          facts: [...(n.facts ?? []), 'transform-url'],
        };
      return n;
    });
  return { ...arch, nodes, routes };
}
