// 接続の規則（D-114・prd/14 案 C の段 1）。土台と別の事業者の部品を、役割（Role。estimator の ROLES）と接続の口（Port）で表し、
// 「どの土台のどの役割から、どの事業者の部品のどの口へつなげるか」を規則（CONNECTION_RULES）で決める。部品を差せる土台
// （ComponentOption.hosts）は規則から導く（partOptions）。根拠の出典は規則ごと（CP-10）、料金・制限の前提は部品ごと（premiseRefs）。
// 事業者の間の転送は、送り手の事業者の送り出し（OUTBOUND）と受け手の事業者の受け取り（INBOUND）の項目を、それぞれ数えて足す（CP-06）。
// 料金表に項目が見つからない側は課金なし（ノードを足さない）で、前提の文で「未確認」を出す。
// 段 1 は今の組（CROSS_PAIRS で手で許していた組）を移し替えただけで、選べる組・金額は変えない（cross.test.ts が突き合わせる）。
// 規則・項目の値は estimator の型と stacks/aws.ts の課金先だけに依存する（index.ts からは型だけを読む）。
import type { ArchitectureInput, Role } from 'estimator';
import type { FrameworkId } from '../frameworks/index.ts';
import { bill as awsBill } from './aws.ts';
import type {
  ComponentOption,
  ComponentProvider,
  Platform,
  SlotId,
} from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/**
 * 接続の口（CP-03）。public-url: 認証なしの公開の URL・https-api: 認証つきの HTTPS の API（SDK・REST）・
 * tcp-sql: DB のワイヤプロトコル・binding: 同じ事業者の実行環境の中からだけ・private-net: 私設の網の中だけ。
 */
export const PORTS = [
  'public-url',
  'https-api',
  'tcp-sql',
  'binding',
  'private-net',
] as const;
export type Port = (typeof PORTS)[number];

export type Source = { url: string; retrievedAt: string };

/** 規則の端の事業者。viewer は閲覧者のブラウザ（土台を選ばない）。 */
export type Endpoint = ComponentProvider | 'viewer';

/** 接続の規則（CP-02・03・05・10）。from が呼ぶ側、to が受ける側の口。 */
export type ConnectionRule = {
  id: string;
  /** 選ぶ単位（スロット）。役割の上の選ぶ単位として残す（CP-02）。 */
  slot: SlotId;
  from: { providers: readonly Endpoint[]; role?: Role };
  to: { providers: readonly Endpoint[]; role: Role; port: Port };
  /** この接続が成り立つフレームワーク（省略はすべて）。 */
  frameworks?: readonly FrameworkId[];
  /** ok: そのまま・needs-relay: 中継（relay）が要る・blocked: つなげない（reason を出す）。段 1 は ok だけ。 */
  verdict: 'ok' | 'needs-relay' | 'blocked';
  relay?: readonly string[];
  reason?: string;
  /** 根拠の要約（転送の課金は書かない。OUTBOUND・INBOUND の項目で数える）。 */
  basis: string;
  sources: readonly Source[];
};

/** 部品と土台の接続の形（ComponentOption.link。部品の側の役割と口）。 */
export type CrossLink = {
  /**
   * 部品の事業者の側で、振る舞いが同じ部品の id（Workload の変え方と、ゲームの画像の大きさ・サイズ違いの判定に使う）。
   * 例: 「Cloudflare: R2 に一律で縮めて置く」は Cloudflare の 'resize' と同じ振る舞い。
   */
  as: string;
  role: Role;
  accepts: readonly Port[];
};

/** 他の事業者の部品（差し替える側）。id は今の部品の id のまま（保存の互換。CP-13）。差せる土台は規則から導く。 */
export type PartDef = Omit<ComponentOption, 'hosts' | 'link'> & {
  role: Role;
  /** 受ける口（この部品を呼ぶ側が使う口）。 */
  accepts: readonly Port[];
  /** 土台の側でつながる役割（部品を呼ぶ土台の役割か、部品が呼ぶ土台の役割）。 */
  attachesTo: readonly Role[];
  /** 振る舞いが同じ部品の id（CrossLink.as）。 */
  as: string;
};

const at = (retrievedAt: string, urls: readonly string[]): Source[] =>
  urls.map((url) => ({ url, retrievedAt }));

/** 画像を差せる土台（画像だけ Cloudflare・Bunny。D-52・D-63・D-71・D-88・D-98）。 */
const IMAGE_HOSTS = [
  'vercel',
  'aws',
  'aws-opennext',
  'netlify',
  'gcp',
] as const satisfies readonly Platform[];

const ALL_PLATFORMS = [
  'cloudflare',
  'vercel',
  'sakura',
  'aws',
  'aws-opennext',
  'netlify',
  'gcp',
] as const satisfies readonly Platform[];

/**
 * 接続の規則。今の組（D-52・D-65・D-67・D-69・D-71・D-77・D-88・D-95・D-98）を、つながり方ごとにまとめ直したもの。
 * 出典と取得日は移し替える前の組（CROSS_PAIRS）のものをそのまま引き継ぐ（同じ URL を別の日に確かめたものは両方の日を残す）。
 */
export const CONNECTION_RULES: readonly ConnectionRule[] = [
  // ---- 画像（R2 + 変換。D-52・D-63・D-71・D-88）----
  {
    id: 'viewer-r2-public',
    slot: 'images',
    from: { providers: ['viewer'] },
    to: { providers: ['cloudflare'], role: 'object-store', port: 'public-url' },
    verdict: 'ok',
    basis:
      'R2 の公開バケットはカスタムドメイン（同じアカウントの Cloudflare のゾーン）で配れて、R2 の転送は無料。' +
      'URL での変換は変換を有効にしたゾーンで頼め、同じゾーンの元の画像は既定で受け付ける。' +
      'Next.js の next/image は Cloudflare の変換の URL を返すローダーに替えられる（公式の例）。往復の遅延は計算しない',
    sources: [
      ...at('2026-11-01', [
        'https://developers.cloudflare.com/r2/buckets/public-buckets/',
        'https://developers.cloudflare.com/r2/pricing/',
        'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
        'https://developers.cloudflare.com/images/transform-images/sources/',
        'https://developers.cloudflare.com/images/pricing/',
        'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
      ]),
      ...at('2026-11-02', [
        'https://developers.cloudflare.com/r2/buckets/public-buckets/',
        'https://developers.cloudflare.com/r2/pricing/',
        'https://developers.cloudflare.com/images/transform-images/transform-via-url/',
        'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
      ]),
    ],
  },
  {
    id: 'host-compute-r2-write',
    slot: 'images',
    from: { providers: IMAGE_HOSTS, role: 'compute' },
    to: { providers: ['cloudflare'], role: 'object-store', port: 'https-api' },
    verdict: 'ok',
    basis:
      '投稿は土台の処理（Vercel の関数・Amplify の SSR・OpenNext のサーバーの関数・S3 + CloudFront の SPA の Lambda・Netlify Functions・Cloud Run）が受けて R2 に書く。' +
      '送るデータは土台の送り出しの項目、受け取りは R2 の項目で数える（OUTBOUND・INBOUND）',
    sources: at('2026-11-01', [
      'https://developers.cloudflare.com/r2/pricing/',
    ]),
  },
  // ---- 画像（Bunny Storage + CDN + Optimizer。D-98）----
  {
    id: 'viewer-bunny-public',
    slot: 'images',
    from: { providers: ['viewer'] },
    to: { providers: ['bunny'], role: 'object-store', port: 'public-url' },
    verdict: 'ok',
    basis:
      'Bunny Storage の Storage Zone を Pull Zone のオリジンにでき、Storage から CDN への転送は無料。' +
      'Optimizer の Dynamic Image API を有効にすると URL の引数（?width=）で変換でき、結果は拠点でキャッシュされる（Optimizer はサイトごとに月 $9.50・変換は無制限）。' +
      'CDN の転送は Asia & Oceania で $0.03/GB・要求の課金なし・月の最低額 $1。' +
      'next/image は loaderFile で ?width= の URL を返す関数に替えられる（公式の例に Bunny は無い）',
    sources: at('2026-11-02', [
      'https://bunny.net/pricing/cdn/',
      'https://bunny.net/pricing/storage/',
      'https://bunny.net/pricing/optimizer/',
      'https://bunny.net/docs/optimizer/dynamic-images/overview.md',
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/images',
    ]),
  },
  {
    id: 'host-compute-bunny-write',
    slot: 'images',
    from: { providers: IMAGE_HOSTS, role: 'compute' },
    to: { providers: ['bunny'], role: 'object-store', port: 'https-api' },
    verdict: 'ok',
    basis:
      'アップロードは HTTP API の PUT（API の要求・転送は無料）。投稿はサーバーが受けて Storage に書き、その送るデータは土台の外への転送の料金で数える',
    sources: at('2026-11-02', [
      'https://bunny.net/pricing/storage/',
      'https://bunny.net/docs/storage/quickstart.md',
    ]),
  },
  // ---- 前段の CDN（Bunny の Pull Zone。D-98）。部品（Bunny）が土台をオリジンとして呼ぶ ----
  {
    id: 'bunny-pull-amplify',
    slot: 'frontCdn',
    from: { providers: ['bunny'], role: 'edge-cdn' },
    to: { providers: ['aws'], role: 'edge-cdn', port: 'public-url' },
    verdict: 'ok',
    basis:
      'Bunny CDN の Pull Zone は自分のサーバー（オリジン）につなぎ、キャッシュに無ければオリジンから取ってキャッシュして返す。' +
      'CDN の転送は Asia & Oceania で $0.03/GB・要求の課金なし・月の最低額 $1。' +
      'Amplify の既定のドメインをオリジンにする（自前の CloudFront の前段と同じ形。D-51 の §9.2）。Bunny が取りに来る分は Amplify の配信（$0.15/GB）として課金されるとみなす',
    sources: at('2026-11-02', [
      'https://bunny.net/docs/cdn.md',
      'https://bunny.net/pricing/cdn/',
      'https://aws.amazon.com/amplify/pricing/',
    ]),
  },
  {
    id: 'bunny-pull-vps',
    slot: 'frontCdn',
    from: { providers: ['bunny'], role: 'edge-cdn' },
    to: { providers: ['sakura'], role: 'compute', port: 'public-url' },
    verdict: 'ok',
    basis:
      'Bunny CDN の Pull Zone は自分のサーバー（オリジン）につなぎ、キャッシュに無ければオリジンから取ってキャッシュして返す。' +
      'CDN の転送は Asia & Oceania で $0.03/GB・要求の課金なし・月の最低額 $1。' +
      'VPS の nginx をオリジンにする（Cloudflare のプロキシの前段と同じ形。D-31・D-91）。VPS の転送量は無制限なので、Bunny が取りに来る分に転送の料金はかからない',
    sources: at('2026-11-02', [
      'https://bunny.net/docs/cdn.md',
      'https://bunny.net/pricing/cdn/',
      'https://vps.sakura.ad.jp/specification/',
    ]),
  },
  // ---- API の置き場（SPA・Next.js の静的書き出し: ブラウザが別のサブドメインの API を呼ぶ。D-65・D-80）----
  {
    id: 'browser-workers-api',
    slot: 'api',
    from: { providers: ['vercel', 'aws', 'netlify'], role: 'static-host' },
    to: { providers: ['cloudflare'], role: 'compute', port: 'https-api' },
    frameworks: ['vite-spa', 'nextjs-export'],
    verdict: 'ok',
    basis:
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、そのホスト名では Worker がオリジンになる。' +
      '別のホスト名のサイトから呼ぶ API は Worker が CORS のヘッダーを返す（公式の例）。D1 は Worker の binding から使う' +
      '（D1 の REST API は管理用の面で、Vercel から直接つなぐ形は出さない。AX-10）。' +
      'Vercel の外部への rewrite で同じドメインに見せる形は課金の記載が無い（prd/10 B-3）ので使わない。' +
      'シェル・JS・CSS・画像は土台に残る（Vercel・S3 + CloudFront・Netlify）。投稿の画像は Worker が土台の置き場に書く（S3 はインターネットからの受信に課金しない）。' +
      'Netlify Blobs は自分のサイトからだけ使えるので、Netlify Functions が書く。' +
      'Next.js の静的書き出し（D-80）: クライアントでのデータの取得は Client Component から（公式の例は SWR）。SPA と同じくブラウザが Worker の API を呼ぶ',
    sources: [
      ...at('2026-11-02', [
        'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
        'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
        'https://developers.cloudflare.com/d1/worker-api/',
        'https://developers.cloudflare.com/d1/best-practices/query-d1/',
        'https://developers.cloudflare.com/workers/platform/pricing/',
        'https://nextjs.org/docs/app/guides/static-exports',
        'https://aws.amazon.com/s3/pricing/',
        'https://docs.netlify.com/build/data-and-storage/netlify-blobs/',
      ]),
    ],
  },
  {
    id: 'browser-aws-api',
    slot: 'api',
    from: { providers: ['cloudflare'], role: 'static-host' },
    to: { providers: ['aws'], role: 'compute', port: 'https-api' },
    frameworks: ['vite-spa', 'nextjs-export'],
    verdict: 'ok',
    basis:
      'シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。API は API Gateway の HTTP API（カスタムドメインを Cloudflare の DNS で向ける）+ Lambda + DynamoDB。' +
      'HTTP API は呼び出しと送り出したデータの量で課金され、外へのデータ転送は EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      '投稿の画像は Lambda が R2 に書く（同じく EC2 のデータ転送の料金）',
    sources: at('2026-11-02', [
      'https://aws.amazon.com/api-gateway/pricing/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
    ]),
  },
  {
    id: 'browser-vps-api',
    slot: 'api',
    from: { providers: ['cloudflare'], role: 'static-host' },
    to: { providers: ['sakura'], role: 'compute', port: 'https-api' },
    frameworks: ['vite-spa', 'nextjs-export'],
    verdict: 'ok',
    basis:
      'シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。API は さくらの VPS の Node と MySQL。' +
      'api のサブドメインは DNS だけのレコード（「does not route HTTP/HTTPS traffic through its network」）で VPS に直接向け、CDN を通さない。' +
      'さくらの VPS は転送量が無制限（回線は 100 Mbps の共有）。投稿の画像は VPS が R2 に書く（R2 は書き込みの受信に課金しない）',
    sources: at('2026-11-02', [
      'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
      'https://developers.cloudflare.com/dns/proxy-status/',
      'https://developers.cloudflare.com/workers/examples/cors-header-proxy/',
      'https://vps.sakura.ad.jp/specification/',
    ]),
  },
  // ---- API の置き場（サーバーから別の事業者の API を呼ぶ。Next.js は D-67・Astro は D-69）----
  {
    id: 'nextjs-server-workers-api',
    slot: 'api',
    from: {
      providers: ['vercel', 'aws', 'aws-opennext', 'netlify'],
      role: 'compute',
    },
    to: { providers: ['cloudflare'], role: 'compute', port: 'https-api' },
    frameworks: ['nextjs'],
    verdict: 'ok',
    basis:
      'Next.js の Server Components は fetch で外の API を呼べ、キャッシュしない fetch は応答まで描画を止める（公式の文書）。' +
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、D1 は Worker の binding で使う。' +
      'Next.js のサーバー（Vercel の関数・Amplify の SSR・OpenNext のサーバーの関数・Netlify Functions）が fetch で Worker の API を呼ぶ',
    sources: at('2026-11-02', [
      'https://nextjs.org/docs/app/getting-started/fetching-data',
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/d1/worker-api/',
    ]),
  },
  {
    id: 'astro-server-workers-api',
    slot: 'api',
    from: { providers: ['vercel', 'sakura', 'netlify'], role: 'compute' },
    to: { providers: ['cloudflare'], role: 'compute', port: 'https-api' },
    frameworks: ['astro'],
    verdict: 'ok',
    basis:
      'Astro のサーバー（@astrojs/vercel の Vercel Functions・@astrojs/node（standalone）の Node・@astrojs/netlify の関数）が描くページの fetch は実行時に走り、Worker の API を呼べる。' +
      'Worker はカスタムドメイン（Cloudflare のゾーンのサブドメイン）に置け、D1 は Worker の binding で使う。VPS の Astro は MySQL を VPS に置かない',
    sources: at('2026-11-02', [
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/vercel/',
      'https://docs.astro.build/en/guides/integrations-guide/node/',
      'https://docs.astro.build/en/guides/integrations-guide/netlify/',
      'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/',
      'https://developers.cloudflare.com/d1/worker-api/',
    ]),
  },
  {
    id: 'astro-worker-vps-api',
    slot: 'api',
    from: { providers: ['cloudflare'], role: 'compute' },
    to: { providers: ['sakura'], role: 'compute', port: 'https-api' },
    frameworks: ['astro'],
    verdict: 'ok',
    basis:
      'Astro（D-69）: 記事は Workers の静的アセット、マイページは @astrojs/cloudflare の Worker が描き、その fetch（実行時に走る）が VPS の API を呼ぶ',
    sources: at('2026-11-02', [
      'https://docs.astro.build/en/guides/data-fetching/',
      'https://docs.astro.build/en/guides/integrations-guide/cloudflare/',
      'https://developers.cloudflare.com/workers/platform/limits/',
    ]),
  },
  // ---- DB だけ Neon（D-77）----
  {
    id: 'host-compute-neon',
    slot: 'db',
    from: { providers: ['vercel', 'netlify'], role: 'compute' },
    to: { providers: ['neon'], role: 'sql-db', port: 'https-api' },
    verdict: 'ok',
    basis:
      'Neon の serverless driver は「serverless and edge environments」から HTTP か WebSocket で問い合わせられ、HTTP を既定に使うよう書かれる（Next.js・Vercel Functions の例がある）。' +
      'TCP でつなぐなら serverless の関数には接続のプール（PgBouncer）が推奨。Vercel の Marketplace に Neon があり、新しく作ると請求は Vercel にまとまる（ここでは Neon に直接払う形で数える）。' +
      'Netlify Functions からも同じ（Netlify 自身の Postgres（Netlify Database・クレジットで課金）は扱っていない）。' +
      'Neon の AWS のリージョンに東京は無く、近いのはシンガポール（往復の遅延は計算しない。AX-13・AX-14）',
    sources: at('2026-11-02', [
      'https://neon.com/docs/serverless/serverless-driver',
      'https://neon.com/docs/connect/connection-pooling',
      'https://neon.com/docs/introduction/regions',
      'https://neon.com/pricing',
      'https://vercel.com/marketplace/neon',
      'https://docs.netlify.com/build/data-and-storage/netlify-db/',
    ]),
  },
  // ---- DB だけ AWS（D-114 段 2・CP-15）。Vercel の Marketplace にある DynamoDB・Aurora を、公開の口でつなぐ（CP-07）----
  {
    id: 'vercel-compute-dynamodb',
    slot: 'db',
    from: { providers: ['vercel'], role: 'compute' },
    to: { providers: ['aws'], role: 'sql-db', port: 'https-api' },
    verdict: 'ok',
    basis:
      'DynamoDB は認証つきの HTTPS の API（SDK）で呼ぶ。Vercel の関数は OIDC で AWS の一時的な認証を得られ（全プラン）、Marketplace の DynamoDB の雛形も OIDC でつなぐ。' +
      'Vercel の Marketplace に DynamoDB があり、請求は AWS（「All billing is handled directly through AWS」。料金は AWS の料金表）。中継（Static IPs・NAT）は要らない。' +
      '関数の地域と DB の地域の違い（Vercel の関数の既定は iad1）による遅延は計算しない（CP-08）',
    sources: at('2026-11-03', [
      'https://vercel.com/marketplace/aws',
      'https://vercel.com/docs/oidc/aws',
      'https://vercel.com/docs/marketplace-storage',
      'https://aws.amazon.com/dynamodb/pricing/on-demand/',
    ]),
  },
  {
    id: 'vercel-compute-aurora',
    slot: 'db',
    from: { providers: ['vercel'], role: 'compute' },
    to: { providers: ['aws'], role: 'sql-db', port: 'tcp-sql' },
    verdict: 'ok',
    basis:
      'Vercel の Marketplace の Aurora PostgreSQL は、設定の手順で DB を作り、セキュリティグループ・IAM のロール・OIDC の信頼を Marketplace が設定する。' +
      '関数は OIDC で得た一時的な認証で RDS の IAM 認証のトークンを作り、クラスターのエンドポイント（PGHOST）に Postgres（TCP）でつなぐ（接続のプールを使う）。請求は AWS。' +
      'Vercel の Pro では VPC の中へつなぐ手段（Secure Compute）が無いので、公開の口（公開のエンドポイント + IAM 認証）とみなす（推測。Marketplace の文書に公開の設定の記載は無い）。' +
      'IP を絞る形（Static IPs）は段 3。関数の地域と DB の地域の違いによる遅延は計算しない（CP-08）',
    sources: [
      ...at('2026-11-03', [
        'https://vercel.com/marketplace/aws',
        'https://vercel.com/kb/guide/connect-next-js-to-amazon-aurora-postgresql-using-vercel-marketplace',
        'https://vercel.com/docs/oidc/aws',
        'https://vercel.com/docs/networking/secure-compute',
        'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html',
        'https://aws.amazon.com/rds/aurora/pricing/',
      ]),
    ],
  },
  // ---- アプリのメールの送信（D-95・D-110）。インターネットの API・SMTP で呼ぶので、どの土台からも同じ形 ----
  {
    id: 'host-compute-ses',
    slot: 'email',
    from: { providers: ['cloudflare'], role: 'compute' },
    to: { providers: ['aws'], role: 'email', port: 'https-api' },
    verdict: 'ok',
    basis:
      'Amazon SES は SMTP のインターフェースか API（HTTP の要求）で送れ、SMTP に対応したアプリ・言語からも使える（公式の文書）。' +
      '送信は受け取る人 1 人ごとに 1,000 通 $0.10（東京）。送る元のドメインは SES で確かめる',
    sources: at('2026-11-02', [
      'https://docs.aws.amazon.com/ses/latest/dg/send-email.html',
      'https://aws.amazon.com/ses/pricing/',
    ]),
  },
  {
    id: 'host-compute-resend',
    slot: 'email',
    from: { providers: ALL_PLATFORMS, role: 'compute' },
    to: { providers: ['resend'], role: 'email', port: 'https-api' },
    verdict: 'ok',
    basis:
      'Resend は API キーと確かめた送る元のドメインで、サーバーの SDK（resend.emails.send）から送る（公式の Node.js の手順）。' +
      'Free は 1 日 100 通・月 3,000 通まで（超過の料金なし）、Pro は月 $20 で 5 万通・月 $35 で 10 万通まで込み、超えた分は 1,000 通 $0.90（D-110）',
    sources: [
      ...at('2026-11-02', ['https://resend.com/docs/send-with-nodejs']),
      ...at('2026-11-03', [
        'https://resend.com/pricing',
        'https://resend.com/docs/knowledge-base/account-quotas-and-limits',
      ]),
    ],
  },
];

// ---- 部品を差せる土台（規則から導く）----

/** 規則が「土台 host と部品 part」の組を許すか（フレームワークの条件は返す。undefined はすべて）。許さないなら null。 */
function ruleMatch(
  r: ConnectionRule,
  host: Platform,
  part: Pick<PartDef, 'slot' | 'platform' | 'role' | 'accepts' | 'attachesTo'>,
): readonly FrameworkId[] | undefined | null {
  if (r.slot !== part.slot || r.verdict === 'blocked') return null;
  // 土台が呼ぶ側（部品の口へつなぐ）
  const hostCalls =
    r.from.providers.includes(host) &&
    r.from.role !== undefined &&
    part.attachesTo.includes(r.from.role) &&
    r.to.providers.includes(part.platform) &&
    r.to.role === part.role &&
    part.accepts.includes(r.to.port);
  // 部品が呼ぶ側（土台をオリジンにする前段の CDN など）
  const partCalls =
    r.from.providers.includes(part.platform) &&
    r.from.role === part.role &&
    r.to.providers.includes(host) &&
    part.attachesTo.includes(r.to.role);
  if (!hostCalls && !partCalls) return null;
  return r.frameworks;
}

/** 部品を土台 host に差せるフレームワーク（undefined はすべて・null は差せない）。規則の和と部品の条件の積。 */
export function partFrameworksOn(
  part: Pick<
    PartDef,
    'slot' | 'platform' | 'role' | 'accepts' | 'attachesTo' | 'frameworks'
  >,
  host: Platform,
  rules: readonly ConnectionRule[] = CONNECTION_RULES,
): readonly FrameworkId[] | undefined | null {
  const matched = rules.map((r) => ruleMatch(r, host, part));
  if (matched.every((m) => m === null)) return null;
  const any = matched.some((m) => m === undefined);
  const fromRules = any
    ? undefined
    : [...new Set(matched.flatMap((m) => m ?? []))];
  if (fromRules === undefined) return part.frameworks;
  const fws = part.frameworks
    ? part.frameworks.filter((f) => fromRules.includes(f))
    : fromRules;
  return fws.length ? fws : null;
}

/**
 * 部品を、差せる土台ごとの ComponentOption にする。差せるフレームワークが同じ土台をまとめる（今の部品は 1 つにまとまる）。
 * hosts は規則で許した土台だけ（土台の順は ALL_PLATFORMS）。
 */
export function partOptions(
  part: PartDef,
  rules: readonly ConnectionRule[] = CONNECTION_RULES,
): ComponentOption[] {
  const groups = new Map<
    string,
    { hosts: Platform[]; frameworks: readonly FrameworkId[] | undefined }
  >();
  for (const host of ALL_PLATFORMS) {
    if (host === part.platform) continue;
    const fws = partFrameworksOn(part, host, rules);
    if (fws === null) continue;
    const key = JSON.stringify(fws ?? null);
    const g = groups.get(key);
    if (g) g.hosts.push(host);
    else groups.set(key, { hosts: [host], frameworks: fws });
  }
  const { role, accepts, attachesTo, as, frameworks: _f, ...rest } = part;
  void attachesTo;
  void _f;
  return [...groups.values()].map((g) => ({
    ...rest,
    ...(g.frameworks ? { frameworks: [...g.frameworks] } : {}),
    hosts: g.hosts,
    link: { as, role, accepts },
  }));
}

/** 土台 host と部品の組を許す規則（根拠の合成・前提の文に使う）。 */
export function rulesFor(
  host: Platform,
  part: Pick<PartDef, 'slot' | 'platform' | 'role' | 'accepts' | 'attachesTo'>,
  rules: readonly ConnectionRule[] = CONNECTION_RULES,
): ConnectionRule[] {
  return rules.filter((r) => ruleMatch(r, host, part) !== null);
}

// ---- 事業者の間の転送（CP-06）----

/** 送り出し・受け取りの項目。課金先の事業者（billing.provider）と、プランで引く。 */
export type TransferItem = {
  provider: string;
  /** 当てるプラン（省略は事業者のすべて）。 */
  planIds?: readonly string[];
  /** 転送を数えるノード（省略は料金表に項目が無い＝課金なし。前提の文で出す）。 */
  meter?: {
    /** ノードの id の頭（`${idPrefix}-out`・問い合わせは `${idPrefix}-out-api`）。 */
    idPrefix: string;
    /** ノードの名前の事業者の名前。 */
    name: string;
    facts: readonly string[];
    /** 課金先（プランは送り手の処理のプランを受ける）。 */
    billing: (planId: string) => NonNullable<ArchNodeIn['billing']>;
  };
  /** サーバーから外の API を呼ぶときに、送り手の処理のノードに足す事実（料金の文書に項目が無いことの根拠。D-67）。 */
  senderFacts?: readonly string[];
  /** 受け手の処理のノードに足す事実（受け取りの項目が無いことの根拠。D-114 段 2）。 */
  receiverFacts?: readonly string[];
  basis: string;
  sources: readonly Source[];
};

/**
 * AWS の DB から別の事業者の関数への応答を、インターネットへの転送として数えるか（D-114 段 2・2026-11-03 のユーザーの決定）。
 * 同じリージョンの AWS のサービス間（$0）に当たると公式に確かめられたら false にする。
 */
export const AWS_DB_OUT_TO_INTERNET = true;

/** 応答の転送を数える AWS の DB のプランと、その根拠の事実（catalog の data-transfer-out の facts）。 */
const AWS_DB_OUT = [
  { planId: 'dynamodb-on-demand', fact: 'dynamodb-out' },
  { planId: 'aurora-serverless-v2-io', fact: 'aurora-out' },
] as const;

/** 送り出し（egress）の項目。送り手の処理（role: compute）の課金先で引く。 */
export const OUTBOUND: readonly TransferItem[] = [
  {
    provider: 'vercel',
    senderFacts: ['function-outbound'],
    basis:
      'Vercel の料金の文書の課金の項目に、関数から外への通信の転送は無い（未確認・数えない）',
    sources: at('2026-11-02', ['https://vercel.com/docs/pricing']),
  },
  {
    provider: 'aws',
    planIds: ['amplify-hosting'],
    senderFacts: ['ssr-outbound'],
    basis:
      'Amplify の SSR から外への通信の課金は料金ページに記載が無い（未確認・数えない）',
    sources: [
      ...at('2026-11-01', ['https://aws.amazon.com/amplify/pricing/']),
      ...at('2026-11-02', ['https://aws.amazon.com/amplify/pricing/']),
    ],
  },
  {
    provider: 'aws',
    planIds: ['lambda'],
    meter: {
      idPrefix: 'aws',
      name: 'AWS',
      facts: ['lambda-out'],
      billing: () =>
        awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
    },
    basis:
      'Lambda の関数がリージョンの外とやり取りするデータは EC2 のデータ転送の料金（東京 → インターネット $0.114/GB・月 100 GB は無料）。' +
      'OpenNext のサーバーの関数・S3 + CloudFront の SPA の Lambda から R2・外の API へ送るデータを数える（D-63）',
    sources: [
      ...at('2026-11-01', [
        'https://aws.amazon.com/lambda/pricing/',
        'https://aws.amazon.com/ec2/pricing/on-demand/',
        'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
      ]),
      ...at('2026-11-02', ['https://aws.amazon.com/lambda/pricing/']),
    ],
  },
  // AWS の DB（DynamoDB・Aurora）から別の事業者の関数（Vercel）へ返す応答（D-114 段 2）。ユーザーの決定（2026-11-03）で
  // インターネットへの転送（Data Transfer Out）として数える。Vercel の関数と同じリージョンの扱い（AWS のサービス間は $0）が
  // 公式に確かめられたら、AWS_DB_OUT_TO_INTERNET を false にすれば課金なし（ノードを作らない）に切り替わる（扱いはここ 1 か所）
  ...AWS_DB_OUT.map(({ planId, fact }): TransferItem => ({
    provider: 'aws',
    planIds: [planId],
    ...(AWS_DB_OUT_TO_INTERNET
      ? {
          meter: {
            idPrefix: 'aws-db',
            name: 'AWS',
            facts: [fact],
            billing: () =>
              awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
          },
        }
      : {}),
    basis:
      'DynamoDB・Aurora の料金ページに外への転送の単価の表は無く、AWS 共通の Data Transfer Out（東京 → インターネット $0.114/GB・全サービス・全リージョン合わせて月 100 GB は無料）の適用と読んだ。' +
      'Vercel の関数が AWS のどのアカウントで動き、同じリージョンの DB との通信が「同じリージョン内の AWS サービス間は $0」に当たるかは公式に記載が無い（未確認）',
    sources: at('2026-11-03', [
      'https://aws.amazon.com/dynamodb/pricing/on-demand/',
      'https://aws.amazon.com/rds/aurora/pricing/',
      'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
      'https://aws.amazon.com/ec2/pricing/on-demand/',
      'https://vercel.com/docs/regions',
      'https://vercel.com/docs/marketplace-storage',
    ]),
  })),
  {
    provider: 'netlify',
    senderFacts: ['function-outbound'],
    meter: {
      idPrefix: 'netlify',
      name: 'Netlify',
      facts: ['function-outbound'],
      billing: (planId) => ({
        accountId: 'netlify',
        provider: 'netlify',
        planId,
        meters: { 'egress-gb': 'bandwidth' },
      }),
    },
    basis:
      'Netlify の関数から外へ送るデータは Netlify の転送量（Bandwidth は「サイトがインターネットへ送るデータ」）に数える（受け取る応答は数えない。D-71）',
    sources: at('2026-11-02', [
      'https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/',
    ]),
  },
  {
    provider: 'gcp',
    planIds: ['cloud-run'],
    meter: {
      idPrefix: 'gcp',
      name: 'Google Cloud',
      facts: ['run-outbound'],
      billing: () => ({
        accountId: 'gcp',
        provider: 'gcp',
        planId: 'internet-egress',
        meters: { 'egress-gb': 'transfer' },
      }),
    },
    basis:
      'Cloud Run から外へ送るデータは Premium Tier のインターネットへの転送（東京 → アジアは 1 TiB まで $0.12 / GiB）で数える（D-88）',
    sources: at('2026-11-02', [
      'https://cloud.google.com/run/pricing',
      'https://cloud.google.com/vpc/network-pricing',
    ]),
  },
  {
    provider: 'sakura-vps',
    basis:
      'さくらの VPS は転送量が無制限（回線は 100 Mbps の共有）なので、VPS から外へ送るデータに転送の料金はかからない',
    sources: at('2026-11-02', ['https://vps.sakura.ad.jp/specification/']),
  },
  {
    provider: 'cloudflare',
    basis:
      'Worker から外への fetch（サブリクエスト）は課金されず転送の料金も無く、応答を待つ時間は CPU 時間に数えない',
    sources: at('2026-11-02', [
      'https://developers.cloudflare.com/workers/platform/pricing/',
      'https://developers.cloudflare.com/workers/platform/limits/',
    ]),
  },
];

/** 受け取り（ingress）の項目。受け手の部品の事業者で引く。今の受け手はどれも受け取りに課金しない（ノードを足さない）。 */
export const INBOUND: readonly TransferItem[] = [
  {
    provider: 'cloudflare',
    basis:
      'R2 は書き込みの受信に課金しない（料金表に項目が無い）。Workers は転送に課金しない',
    sources: [
      ...at('2026-11-01', ['https://developers.cloudflare.com/r2/pricing/']),
      ...at('2026-11-02', [
        'https://developers.cloudflare.com/workers/platform/pricing/',
      ]),
    ],
  },
  {
    provider: 'aws',
    basis:
      'S3 はインターネットからの受信に課金しない。DynamoDB も受信に課金しない（「DynamoDB does not charge for inbound data transfer」）。' +
      'Aurora の受信の課金は料金ページに記載が無い（未確認・数えない）',
    sources: [
      ...at('2026-11-02', ['https://aws.amazon.com/s3/pricing/']),
      ...at('2026-11-03', [
        'https://aws.amazon.com/dynamodb/pricing/on-demand/',
        'https://aws.amazon.com/rds/aurora/pricing/',
      ]),
    ],
  },
  {
    provider: 'vercel',
    receiverFacts: ['function-inbound'],
    basis:
      'Vercel の料金の文書の課金の項目に、関数が外（DB など）から受け取る通信は無い（未確認・数えない）',
    sources: at('2026-11-03', ['https://vercel.com/docs/pricing']),
  },
  {
    provider: 'bunny',
    basis:
      'Storage へのアップロード（HTTP API の PUT）は API の要求・転送とも無料',
    sources: at('2026-11-02', ['https://bunny.net/pricing/storage/']),
  },
  {
    provider: 'neon',
    basis:
      'Neon の転送の課金は公開の転送（DB からの応答）だけで、関数から送る問い合わせは数えない',
    sources: at('2026-11-02', ['https://neon.com/pricing']),
  },
  {
    provider: 'sakura-vps',
    basis: 'さくらの VPS は転送量が無制限',
    sources: at('2026-11-02', ['https://vps.sakura.ad.jp/specification/']),
  },
];

const itemFor = (
  items: readonly TransferItem[],
  provider: string | undefined,
  planId?: string,
): TransferItem | undefined =>
  items.find(
    (t) =>
      t.provider === provider &&
      // プランを渡さない（受け手の部品の事業者で引く）ときは、事業者だけで引く
      (t.planIds === undefined ||
        planId === undefined ||
        t.planIds.includes(planId)),
  );

/** 送り手の処理のノードの送り出しの項目（無ければ undefined）。 */
export const outboundOf = (sender: ArchNodeIn): TransferItem | undefined =>
  itemFor(OUTBOUND, sender.billing?.provider, sender.billing?.planId);

/** 受け手の事業者の受け取りの項目（無ければ undefined）。 */
export const inboundOf = (provider: string): TransferItem | undefined =>
  itemFor(INBOUND, provider);

/** 料金の事業者（billing.provider）を、部品の事業者に。 */
const billingProviderOf = (p: string): string =>
  p === 'sakura' ? 'sakura-vps' : p;

/**
 * 送り手の処理のノードから、別の事業者（receiver。部品の事業者）へ送るデータを数えるノード（CP-06）。
 * 送り手の送り出しの項目と、受け手の受け取りの項目をそれぞれ見て、項目があるほうだけノードを作る（両方あれば両方）。
 * what はノードの名前に添える行き先（「R2 への書き込み」など）。requestKB を渡すと、1 回の大きさをそれにする（外の API への問い合わせ）。
 * 'per-query' は問い合わせの数 × DB の応答の大きさで数える（DB が送り手。D-114 段 2）。
 */
export function transferNodes(
  sender: ArchNodeIn,
  receiver: string,
  what: string,
  requestKB?: number | 'per-query',
  items: {
    outbound: readonly TransferItem[];
    inbound: readonly TransferItem[];
  } = { outbound: OUTBOUND, inbound: INBOUND },
): ArchNodeIn[] {
  const from = sender.billing?.provider;
  const to = billingProviderOf(receiver);
  if (from === undefined || from === to) return [];
  const make = (
    item: TransferItem | undefined,
    planId: string,
    dir: 'out' | 'in',
  ) => {
    if (!item?.meter) return [];
    const m = item.meter;
    return [
      {
        id: `${m.idPrefix}-${dir}${typeof requestKB === 'number' ? '-api' : ''}`,
        label:
          dir === 'out'
            ? `${m.name} → インターネット（${what}）`
            : `インターネット → ${m.name}（${what}）`,
        config: {
          kind: 'cdn',
          hitRate: {},
          ...(typeof requestKB === 'number'
            ? { egressKBPerRequest: requestKB }
            : requestKB === 'per-query'
              ? { egressPerQuery: true }
              : {}),
        },
        facts: [...m.facts],
        billing: m.billing(planId),
      } as ArchNodeIn,
    ];
  };
  const inbound = itemFor(items.inbound, to);
  return [
    ...make(
      itemFor(items.outbound, from, sender.billing?.planId),
      sender.billing?.planId ?? '',
      'out',
    ),
    // 受け取りの項目は、今の受け手のどれにも無い（課金しない）。受け手のプランは項目の planIds の最初（無ければ空）
    ...make(inbound, inbound?.planIds?.[0] ?? '', 'in'),
  ];
}

/**
 * 土台の置き場（役割 object-store）の口（課金先の事業者で引く）。Vercel Blob・Netlify Blobs は土台の関数からだけ書く
 * （Netlify Blobs は自分のサイトからだけ使える。Vercel Blob は書き込みの手順が Vercel の関数を前提にしている・仮定）。
 */
const STORE_PORTS: Readonly<Record<string, readonly Port[]>> = {
  vercel: ['binding'],
  netlify: ['binding'],
  aws: ['https-api'],
  cloudflare: ['https-api', 'binding'],
  gcp: ['https-api'],
  bunny: ['https-api'],
};

/** 置き場に、別の事業者の処理から書けるか（口に https-api があるか。置き場でなければ書けるとみなす）。 */
export const storeAcceptsFromOutside = (n: ArchNodeIn): boolean =>
  n.role !== 'object-store' ||
  (STORE_PORTS[n.billing?.provider ?? ''] ?? []).includes('https-api');

/** 転送を数えるだけのノード（役割を持たない。transferNodes が作る形と、部品が自分で持つ外への転送）。 */
export const isTransferNode = (n: ArchNodeIn): boolean =>
  n.role === undefined &&
  n.config.kind === 'cdn' &&
  n.billing !== undefined &&
  Object.keys(n.billing.meters ?? {}).length > 0 &&
  Object.keys(n.billing.meters ?? {}).every((k) => k === 'egress-gb');
