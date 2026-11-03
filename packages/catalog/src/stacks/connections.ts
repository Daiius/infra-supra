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
  to: {
    providers: readonly Endpoint[];
    role: Role;
    port: Port;
    /** 受ける部品の id（省略は、事業者・役割・口が合う部品すべて）。 */
    parts?: readonly string[];
  };
  /** この接続が成り立つフレームワーク（省略はすべて）。 */
  frameworks?: readonly FrameworkId[];
  /**
   * ok: そのまま・needs-relay: 中継（relay。RELAYS の id）が要る・blocked: つなげない（reason を出す）。
   * 中継は差し方（cross.ts）が自動で足し、明細・構成図に出す（CP-05）。
   */
  verdict: 'ok' | 'needs-relay' | 'blocked';
  relay?: readonly RelayId[];
  reason?: string;
  /** 根拠の要約（転送の課金は書かない。OUTBOUND・INBOUND の項目で数える）。 */
  basis: string;
  /**
   * 部品の説明（ⓘ）に添える、この土台からのつなぎ方の文（土台ごとに違う認証・作り方・中継。D-114 段 2b）。
   * 部品の説明は土台によらない文にし、土台ごとの文はここに置く（土台を足すときは規則を足すだけで済む）。
   */
  partNote?: string;
  /** 部品の前提に添える参照（この土台からつなぐときだけ効く事実。partNote と同じ考え方）。 */
  partRefs?: readonly string[];
  sources: readonly Source[];
};

/** 規則が自動で足す中継（CP-05）。名前は構成の名前・部品の説明に使う。ノードは cross.ts の RELAY_NODES。 */
export const RELAYS = {
  hyperdrive: { name: 'Hyperdrive', provider: 'cloudflare' },
} as const satisfies Record<string, { name: string; provider: Endpoint }>;
export type RelayId = keyof typeof RELAYS;

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
  /**
   * 構成の名前に出す部品の名前（DB の部品。crossDbName）。free は土台が無料のプランのとき（Neon は Free になる）。
   * 中継（Hyperdrive）が要る土台では、その名前を前に足す（「Hyperdrive + Neon（Launch）」）。
   */
  title?: string | { free: string; paid: string };
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
 * 処理が既定で公開のインターネットへ出られる土台（D-114 段 2d）。さくらの VPS（固定の IP・転送量の課金なし）・Cloud Run（既定で
 * 共有の動的な IP からインターネットへ）・Lambda（既定で Lambda が管理する VPC からインターネットへ。Amplify の SSR・S3 + CloudFront の
 * SPA の Lambda・OpenNext のサーバーの関数）・Netlify Functions（隠した構成）。VPC に入れる形（NAT が要る）は扱わない（CP-05）。
 */
const PUBLIC_EGRESS_HOSTS = [
  'sakura',
  'gcp',
  'aws',
  'aws-opennext',
] as const satisfies readonly Platform[];
/** AWS の DB を公開の口で開く土台（AWS の構成は自分の DB の部品、Vercel・Cloudflare は専用の規則）。 */
const PUBLIC_AWS_DB_HOSTS = [
  'sakura',
  'gcp',
  'netlify',
] as const satisfies readonly Platform[];
const PUBLIC_EGRESS_BASIS =
  '土台の処理は既定で公開のインターネットへ出られる: さくらの VPS は固定の IP（転送量は無制限）、Cloud Run は既定で共有の動的な IP の集まりから、Lambda は既定で Lambda が管理する VPC（インターネットに出られる）から。' +
  'Netlify Functions（隠した構成）から外へつなぐ形は Neon（host-compute-neon）と同じ。VPC に入れた Lambda・Cloud Run の VPC の出口を全部に向ける形は NAT が要り（東京の単価が未取得）、扱わない。往復の遅延は計算しない（CP-08）';
const PUBLIC_EGRESS_NOTE =
  '土台の処理から DB へ送る問い合わせの転送は数えない（DB の応答は DB の事業者の転送で数える）';
const PUBLIC_EGRESS_URLS = [
  'https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html',
  'https://docs.cloud.google.com/run/docs/configuring/networking-best-practices',
];
/** さくらの VPS の仕様（転送量は無制限。2026-11-02 取得のものを引き継ぐ）。 */
const SAKURA_SPEC = at('2026-11-02', [
  'https://vps.sakura.ad.jp/specification/',
]);

/** Vercel から AWS の DB へつなぐときの部品の説明の文（D-114 段 2。how は認証とつなぎ方）。 */
const VERCEL_AWS_DB_NOTE = (how: string) =>
  `Vercel の Marketplace で作る。${how}。Vercel の関数と同じリージョンなら DB の応答の転送が安くなる可能性があるが、公式に記載が無く未確認。` +
  'AWS のアカウントは既定のメールの送信（Amazon SES）と同じなので増えない';

/** Hyperdrive を中継にするときの部品の説明の文（D-114 段 2b）。 */
const HYPERDRIVE_NOTE =
  'Worker から Hyperdrive（Cloudflare の DB の接続のプール。Free は 1 日 10 万クエリまで・Paid は無制限・転送の課金なし）を通し、node-postgres などのドライバーで DB のユーザーとパスワードでつなぐ（自動で足す中継）。' +
  'Hyperdrive は使っていない接続を最大 10 分保つので、問い合わせが途切れると止まる DB は止まりにくい可能性がある（未確認・計算に入れない）。Hyperdrive の問い合わせのキャッシュは計算に入れていない';

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
  // ---- 画像の原本だけ R2、変換は土台の画像の最適化（D-114 段 2c・2026-11-04）。土台の変換（image-transform）が R2 の公開の URL から原本を取る ----
  {
    id: 'vercel-image-r2-origin',
    slot: 'images',
    from: { providers: ['vercel'], role: 'image-transform' },
    to: {
      providers: ['cloudflare'],
      role: 'object-store',
      port: 'public-url',
      parts: ['cf-r2-origin'],
    },
    // Vercel の画像の最適化を使える形（土台の「画像の最適化」と同じ）。Next.js の静的書き出しは既定のローダーが使えない（D-80）
    frameworks: ['nextjs', 'vite-spa', 'astro'],
    verdict: 'ok',
    basis:
      'Vercel の画像の最適化は外の画像（remote images）も変換する（「remote images (stored externally)」。next.config の remotePatterns に R2 のカスタムドメインを書く）。' +
      '課金は外の画像でも同じ数え方（変換は cache の MISS・STALE ごと、キャッシュの読み書きは 8 KB 単位。キャッシュの鍵が外の画像は絶対 URL になるだけ）で、全プランで使える。' +
      'Astro は @astrojs/vercel の imageService（本番は Vercel の画像の最適化。remotePatterns は Astro の画像の設定から自動で入る）、Next.js 以外は /_vercel/image（Build Output API の images の remotePatterns）。' +
      'Next.js の静的書き出しは既定のローダーでの最適化が使えない。R2 の公開バケットはカスタムドメインで配れ、R2 の転送は無料。投稿は Vercel の関数が R2 に書く',
    partNote:
      'Vercel の関数が投稿を R2 に書き（S3 互換の API とアクセスキー）、閲覧のときは Vercel の画像の最適化が R2 のカスタムドメインの URL から原本を取って変換する（next/image の remotePatterns・@astrojs/vercel の imageService・/_vercel/image）',
    sources: [
      ...at('2026-11-04', [
        'https://vercel.com/docs/image-optimization',
        'https://vercel.com/docs/image-optimization/limits-and-pricing',
        'https://vercel.com/docs/build-output-api/configuration',
        'https://nextjs.org/docs/app/api-reference/components/image',
        'https://nextjs.org/docs/app/guides/static-exports',
        'https://docs.astro.build/en/guides/integrations-guide/vercel/',
      ]),
      ...at('2026-11-01', [
        'https://developers.cloudflare.com/r2/buckets/public-buckets/',
        'https://developers.cloudflare.com/r2/pricing/',
      ]),
    ],
  },
  // ---- 画像だけ AWS（S3 + CloudFront。D-114 段 2c）。投稿は土台の処理が S3 に書き、閲覧者は CloudFront から読む ----
  {
    id: 'vercel-compute-s3-write',
    slot: 'images',
    from: { providers: ['vercel'], role: 'compute' },
    to: { providers: ['aws'], role: 'object-store', port: 'https-api' },
    verdict: 'ok',
    basis:
      'Vercel の関数は OIDC で AWS の一時的な認証を得られ（全プラン）、S3 の API（SDK）で書ける。S3 はインターネットからの受信に課金しない。' +
      'CloudFront は S3 をオリジンにし、オリジンのアクセス制御（OAC）で CloudFront からだけ読ませる。S3 から CloudFront への転送は無料',
    partNote:
      'Vercel の関数が OIDC の一時的な認証で S3 に書く。AWS のアカウントは既定のメールの送信（Amazon SES）と同じなので増えない',
    sources: [
      ...at('2026-11-04', [
        'https://aws.amazon.com/s3/pricing/',
        'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html',
      ]),
      ...at('2026-11-03', ['https://vercel.com/docs/oidc/aws']),
    ],
  },
  {
    id: 'host-compute-s3-write',
    slot: 'images',
    from: { providers: ['netlify', 'gcp'], role: 'compute' },
    to: { providers: ['aws'], role: 'object-store', port: 'https-api' },
    verdict: 'ok',
    basis:
      'S3 の API（SDK・署名した HTTPS）はどこからでも呼べ、Netlify Functions・Cloud Run は IAM のアクセスキー（環境変数・Secret に置く）で書く。S3 はインターネットからの受信に課金しない。' +
      '送るデータは土台の送り出しの項目（Netlify の転送量・Cloud Run の Premium Tier）で数える。CloudFront は S3 をオリジンにし（OAC）、S3 から CloudFront への転送は無料',
    partNote:
      '土台の関数が IAM のアクセスキーで S3 に書く。AWS のアカウントは既定のメールの送信（Amazon SES）と同じなので増えない',
    sources: at('2026-11-04', [
      'https://aws.amazon.com/s3/pricing/',
      'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html',
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
    partNote: '関数から serverless driver（HTTP）で問い合わせる',
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
    partNote: VERCEL_AWS_DB_NOTE(
      '関数から OIDC の一時的な認証で SDK（HTTPS）を呼ぶ',
    ),
    partRefs: ['fact:aws:data-transfer-out:dynamodb-out'],
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
    // Marketplace にあるのは Aurora だけ（公開の RDS は後の段の候補）
    to: {
      providers: ['aws'],
      role: 'sql-db',
      port: 'tcp-sql',
      parts: ['aurora', 'aurora-pause'],
    },
    verdict: 'ok',
    partNote: VERCEL_AWS_DB_NOTE(
      '関数は OIDC の一時的な認証で IAM 認証のトークンを作り、公開のエンドポイントに接続のプールでつなぐ（公開の設定は推測）',
    ),
    partRefs: ['fact:aws:data-transfer-out:aurora-out'],
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
  // ---- Cloudflare の Worker から他の事業者の DB（D-114 段 2b・2026-11-04 のユーザーの決定）----
  // Postgres（Neon・AWS の RDS / Aurora）は Hyperdrive を中継にする（CP-16: Worker から直接の TCP は出さない）。
  // DynamoDB は認証つきの HTTPS の API なので中継なし
  {
    id: 'cf-compute-hyperdrive-neon',
    slot: 'db',
    from: { providers: ['cloudflare'], role: 'compute' },
    to: { providers: ['neon'], role: 'sql-db', port: 'tcp-sql' },
    verdict: 'needs-relay',
    relay: ['hyperdrive'],
    basis:
      'Workers から外の Postgres へは Hyperdrive を勧める（接続のプールを Cloudflare の側に持つ）。Hyperdrive の接続先に Neon の接続文字列（接続のプールを外したもの）を設定し、Worker は node-postgres などのドライバーで Hyperdrive の binding につなぐ（Neon の serverless driver は使わない）。' +
      'Hyperdrive は Workers の Free・Paid に含まれ（Free は 1 日 10 万クエリ・Paid は無制限）、転送に課金しない。Neon の転送は Neon の公開の転送の項目で数える。' +
      'Neon に東京のリージョンは無い（往復の遅延は計算しない。CP-08）',
    partNote: HYPERDRIVE_NOTE,
    partRefs: [
      'fact:cloudflare:hyperdrive-paid:',
      'fact:cloudflare:hyperdrive-free:',
    ],
    sources: [
      ...at('2026-11-04', [
        'https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/',
        'https://developers.cloudflare.com/hyperdrive/platform/pricing/',
        'https://developers.cloudflare.com/hyperdrive/platform/limits/',
        'https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/',
      ]),
      ...at('2026-11-02', ['https://neon.com/pricing']),
    ],
  },
  {
    id: 'cf-compute-hyperdrive-aws',
    slot: 'db',
    from: { providers: ['cloudflare'], role: 'compute' },
    to: {
      providers: ['aws'],
      role: 'sql-db',
      port: 'tcp-sql',
      parts: ['aurora', 'aurora-pause', 'rds'],
    },
    verdict: 'needs-relay',
    relay: ['hyperdrive'],
    basis:
      'Hyperdrive の公式の手順（AWS RDS and Aurora）: DB の公開のアクセスを有効にし、セキュリティグループで Cloudflare の IP からの接続を許し、DB のユーザーとパスワードの接続文字列を Hyperdrive に設定する（IAM 認証の記載は無い。私設の網へは Cloudflare Tunnel でもつなげるが扱わない）。' +
      'Hyperdrive は転送に課金しない。DB の応答は AWS からインターネットへの転送で数える（OUTBOUND）。公開の IPv4 のアドレスの時間課金は未確認として数えない（段 2 の Aurora と同じ）',
    partNote: `${HYPERDRIVE_NOTE}。DB は公開のアクセスを有効にし、Cloudflare の IP からの接続を許す（IAM 認証でなく DB のユーザーとパスワード）`,
    partRefs: [
      'fact:cloudflare:hyperdrive-paid:',
      'fact:cloudflare:hyperdrive-free:',
      'fact:aws:data-transfer-out:db-out-internet',
    ],
    sources: [
      ...at('2026-11-04', [
        'https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/aws-rds-aurora/',
        'https://developers.cloudflare.com/hyperdrive/platform/pricing/',
        'https://developers.cloudflare.com/hyperdrive/platform/limits/',
        'https://aws.amazon.com/rds/postgresql/pricing/',
      ]),
      ...at('2026-11-03', [
        'https://aws.amazon.com/rds/aurora/pricing/',
        'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
      ]),
    ],
  },
  {
    id: 'cf-compute-dynamodb',
    slot: 'db',
    from: { providers: ['cloudflare'], role: 'compute' },
    to: { providers: ['aws'], role: 'sql-db', port: 'https-api' },
    verdict: 'ok',
    basis:
      'DynamoDB の API は署名（Signature Version 4）した HTTP(S) の POST で、Worker の fetch（サブリクエスト）から呼べる。Worker から外への fetch は課金されず、応答を待つ時間は CPU 時間に数えない。' +
      '認証は IAM のアクセスキー（Worker の Secret に置く。Cloudflare から AWS の一時的な認証を得る仕組みは扱わない）。DB の応答は AWS からインターネットへの転送で数える（OUTBOUND）',
    partNote:
      'Worker から IAM のアクセスキー（Secret に置く）で署名した HTTPS の要求（SDK など）を呼ぶ。中継は要らない。' +
      '問い合わせ 1 回が Worker のサブリクエスト 1 回になる（1 回の呼び出しで Free は 50・Paid は 10,000 まで。このモデルでは上限に当たるかを見ていない）',
    partRefs: ['fact:aws:data-transfer-out:db-out-internet'],
    sources: [
      ...at('2026-11-04', [
        'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.LowLevelAPI.html',
        'https://developers.cloudflare.com/workers/platform/limits/',
      ]),
      ...at('2026-11-03', [
        'https://aws.amazon.com/dynamodb/pricing/on-demand/',
      ]),
      ...at('2026-11-02', [
        'https://developers.cloudflare.com/workers/platform/pricing/',
      ]),
    ],
  },
  // ---- 公開の口へ出られる土台の処理 → 公開の口を持つ DB（D-114 段 2d・2026-11-04 のユーザーの決定「規則で一括に開く」）----
  // 土台ごとに手で書かず、土台の処理が既定で公開のインターネットへ出られる（VPC・NAT が要らない）ことと、DB が公開のエンドポイントを
  // 持つことの 2 つで開く。中継（Static IPs・NAT・RDS Proxy・Tunnel）が要る形（IP を絞る・VPC の中の DB）は扱わない（CP-05・CP-07）。
  // 土台の既定の DB と同じ事業者の部品（Vercel・Netlify の Supabase・AWS の構成の AWS の DB）と、専用の規則がある土台
  // （Vercel・Netlify の Neon、Vercel の DynamoDB・Aurora、Cloudflare の Hyperdrive）は、ここに入れない（同じ部品が 2 つ出ないように）
  {
    id: 'public-compute-neon',
    slot: 'db',
    from: { providers: PUBLIC_EGRESS_HOSTS, role: 'compute' },
    to: { providers: ['neon'], role: 'sql-db', port: 'tcp-sql' },
    verdict: 'ok',
    basis:
      'Neon は公開のエンドポイントに Postgres（TCP・TLS）でつなぎ、サーバーレスの関数には接続のプール（-pooler の接続文字列。PgBouncer・最大 10,000 の接続）を勧める。' +
      PUBLIC_EGRESS_BASIS,
    partNote: `土台の処理から接続のプール（-pooler の接続文字列）に Postgres のドライバーでつなぐ。${PUBLIC_EGRESS_NOTE}`,
    sources: [
      ...at('2026-11-04', [
        'https://neon.com/docs/connect/connection-pooling',
        ...PUBLIC_EGRESS_URLS,
      ]),
      ...SAKURA_SPEC,
      ...at('2026-11-02', [
        'https://neon.com/docs/introduction/regions',
        'https://neon.com/pricing',
      ]),
    ],
  },
  {
    id: 'public-compute-supabase',
    slot: 'db',
    from: { providers: PUBLIC_EGRESS_HOSTS, role: 'compute' },
    to: { providers: ['supabase'], role: 'sql-db', port: 'tcp-sql' },
    verdict: 'ok',
    basis:
      'Supabase の直接の接続は IPv6 だけ（IPv4 はアドオン）で、共有のプール（Supavisor）はどのプランでも IPv4。サーバーレスの関数は transaction モード（6543）、VM・常駐のコンテナは直接の接続か、IPv4 だけの網からは session モード（5432）。' +
      'プール経由の転送は Shared Pooler Egress として数え、DB の転送と二重に数えない（枠はサービスをまたいで共通）。' +
      PUBLIC_EGRESS_BASIS,
    partNote: `土台の処理から共有のプール（IPv4。関数は transaction モード・VPS とコンテナは session モード）に Postgres のドライバーでつなぐ。${PUBLIC_EGRESS_NOTE}`,
    sources: [
      ...at('2026-11-04', [
        'https://supabase.com/docs/guides/database/connecting-to-postgres',
        'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
        ...PUBLIC_EGRESS_URLS,
      ]),
      ...SAKURA_SPEC,
    ],
  },
  {
    id: 'public-compute-dynamodb',
    slot: 'db',
    from: { providers: PUBLIC_AWS_DB_HOSTS, role: 'compute' },
    to: {
      providers: ['aws'],
      role: 'sql-db',
      port: 'https-api',
      parts: ['dynamodb'],
    },
    verdict: 'ok',
    basis:
      'DynamoDB の API は署名（Signature Version 4）した HTTPS の要求で、どこからでも呼べる。土台の処理は IAM のアクセスキー（環境変数・Secret に置く）で SDK を呼ぶ。DynamoDB は受信に課金しない。' +
      'DB の応答は AWS からインターネットへの転送で数える（OUTBOUND）。' +
      PUBLIC_EGRESS_BASIS,
    partNote: `土台の処理から IAM のアクセスキーで署名した HTTPS の要求（SDK）を呼ぶ。中継は要らない。${PUBLIC_EGRESS_NOTE}`,
    partRefs: ['fact:aws:data-transfer-out:db-out-internet'],
    sources: [
      ...at('2026-11-04', [
        'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.LowLevelAPI.html',
        ...PUBLIC_EGRESS_URLS,
      ]),
      ...SAKURA_SPEC,
      ...at('2026-11-03', [
        'https://aws.amazon.com/dynamodb/pricing/on-demand/',
      ]),
    ],
  },
  {
    id: 'public-compute-aws-sql',
    slot: 'db',
    from: { providers: PUBLIC_AWS_DB_HOSTS, role: 'compute' },
    to: {
      providers: ['aws'],
      role: 'sql-db',
      port: 'tcp-sql',
      parts: ['aurora', 'aurora-pause', 'rds'],
    },
    verdict: 'ok',
    basis:
      'RDS・Aurora を外から使うには、DB の公開のアクセス（Public access）を有効にし、DB のサブネットがインターネットゲートウェイを持ち、セキュリティグループが受け入れを許す必要がある。' +
      '土台の処理の送り元の IP は決まっていない（固定の IP は中継の部品で、扱わない）ので、セキュリティグループは広く開け、DB のユーザーとパスワード（TLS）で守る前提。' +
      'DB の応答は AWS からインターネットへの転送で数える（OUTBOUND）。公開の IPv4 のアドレスの時間課金は未確認として数えない。' +
      PUBLIC_EGRESS_BASIS,
    partNote: `DB の公開のアクセスを有効にし、セキュリティグループを広く開けて（送り元の IP が決まっていない）、DB のユーザーとパスワードで TLS でつなぐ。${PUBLIC_EGRESS_NOTE}`,
    partRefs: ['fact:aws:data-transfer-out:db-out-internet'],
    sources: [
      ...at('2026-11-04', [
        'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html',
        'https://aws.amazon.com/rds/postgresql/pricing/',
        ...PUBLIC_EGRESS_URLS,
      ]),
      ...SAKURA_SPEC,
      ...at('2026-11-03', ['https://aws.amazon.com/rds/aurora/pricing/']),
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
/** 規則に当てる部品の形（id は規則が部品を絞るとき（to.parts）だけ見る）。 */
type PartKey = Pick<
  PartDef,
  'slot' | 'platform' | 'role' | 'accepts' | 'attachesTo'
> & { id?: string };

function ruleMatch(
  r: ConnectionRule,
  host: Platform,
  part: PartKey,
): readonly FrameworkId[] | undefined | null {
  if (r.slot !== part.slot || r.verdict === 'blocked') return null;
  // 土台が呼ぶ側（部品の口へつなぐ）
  const hostCalls =
    r.from.providers.includes(host) &&
    r.from.role !== undefined &&
    part.attachesTo.includes(r.from.role) &&
    r.to.providers.includes(part.platform) &&
    r.to.role === part.role &&
    part.accepts.includes(r.to.port) &&
    (r.to.parts === undefined ||
      (part.id !== undefined && r.to.parts.includes(part.id)));
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
  part: PartKey & Pick<PartDef, 'frameworks'>,
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
  // 差せるフレームワークと、土台ごとの文（規則の partNote・partRefs）が同じ土台をまとめる
  const groups = new Map<
    string,
    {
      hosts: Platform[];
      frameworks: readonly FrameworkId[] | undefined;
      notes: string[];
      refs: string[];
    }
  >();
  for (const host of ALL_PLATFORMS) {
    if (host === part.platform) continue;
    const fws = partFrameworksOn(part, host, rules);
    if (fws === null) continue;
    const matched = rulesFor(host, part, rules);
    const notes = matched.flatMap((r) => (r.partNote ? [r.partNote] : []));
    const refs = matched.flatMap((r) => r.partRefs ?? []);
    const key = JSON.stringify([fws ?? null, notes, refs]);
    const g = groups.get(key);
    if (g) g.hosts.push(host);
    else groups.set(key, { hosts: [host], frameworks: fws, notes, refs });
  }
  const {
    role,
    accepts,
    attachesTo,
    as,
    frameworks: _f,
    title: _t,
    ...rest
  } = part;
  void attachesTo;
  void _f;
  void _t;
  return [...groups.values()].map((g) => ({
    ...rest,
    note: [rest.note, ...g.notes].join('。'),
    premiseRefs: [...rest.premiseRefs, ...g.refs],
    ...(g.frameworks ? { frameworks: [...g.frameworks] } : {}),
    hosts: g.hosts,
    link: { as, role, accepts },
  }));
}

/** 土台 host と部品の組を許す規則（根拠の合成・前提の文に使う）。 */
export function rulesFor(
  host: Platform,
  part: PartKey,
  rules: readonly ConnectionRule[] = CONNECTION_RULES,
): ConnectionRule[] {
  return rules.filter((r) => ruleMatch(r, host, part) !== null);
}

/**
 * 土台 host から部品へつなぐのに自動で足す中継（CP-05）。中継なしでつなげる規則があればそれを使う（中継は要らない）。
 * 無ければ、中継が要る規則の中継（最初の規則）。
 */
export function relaysFor(
  host: Platform,
  part: PartKey,
  rules: readonly ConnectionRule[] = CONNECTION_RULES,
): readonly RelayId[] {
  const matched = rulesFor(host, part, rules);
  if (matched.some((r) => r.verdict === 'ok')) return [];
  return matched.find((r) => r.verdict === 'needs-relay')?.relay ?? [];
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
    /** 受け手の事業者ごとの事実（省略の受け手は facts）。 */
    factsTo?: Readonly<Partial<Record<string, readonly string[]>>>;
    /** 数えない受け手の事業者（同じリージョンの扱いなど、受け手で課金が変わるとき）。 */
    freeTo?: readonly string[];
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
 * AWS の DB から Vercel の関数への応答を、インターネットへの転送として数えるか（D-114 段 2・2026-11-03 のユーザーの決定）。
 * 同じリージョンの AWS のサービス間（$0）に当たると公式に確かめられたら false にする。
 * AWS の外で動く受け手（Cloudflare の Worker・Hyperdrive。D-114 段 2b）は、この切り替えによらずインターネットへの転送で数える。
 */
export const AWS_DB_OUT_TO_INTERNET = true;

/**
 * 応答の転送を数える AWS の DB のプランと、Vercel が受け手のときの根拠の事実（catalog の data-transfer-out の facts）。
 * それ以外の受け手は db-out-internet。
 */
const AWS_DB_OUT = [
  { planId: 'dynamodb-on-demand', vercelFact: 'dynamodb-out' },
  { planId: 'aurora-serverless-v2-io', vercelFact: 'aurora-out' },
  { planId: 'rds-postgres-t4g-micro', vercelFact: undefined },
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
  // AWS の DB（DynamoDB・Aurora・RDS）から別の事業者（Vercel の関数・Cloudflare の Worker と Hyperdrive）へ返す応答（D-114 段 2・段 2b）。
  // ユーザーの決定（2026-11-03）でインターネットへの転送（Data Transfer Out）として数える。Vercel の関数と同じリージョンの扱い
  // （AWS のサービス間は $0）が公式に確かめられたら、AWS_DB_OUT_TO_INTERNET を false にすれば Vercel だけ課金なし（ノードを作らない）に
  // 切り替わる（扱いはここ 1 か所）。Cloudflare は AWS の外なので、いつもインターネットへの転送
  ...AWS_DB_OUT.map(({ planId, vercelFact }): TransferItem => ({
    provider: 'aws',
    planIds: [planId],
    meter: {
      idPrefix: 'aws-db',
      name: 'AWS',
      facts: ['db-out-internet'],
      ...(vercelFact ? { factsTo: { vercel: [vercelFact] } } : {}),
      ...(AWS_DB_OUT_TO_INTERNET ? {} : { freeTo: ['vercel'] }),
      billing: () =>
        awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
    },
    basis:
      'DynamoDB・Aurora・RDS の料金ページに外への転送の単価の表は無く（取れず）、AWS 共通の Data Transfer Out（東京 → インターネット $0.114/GB・全サービス・全リージョン合わせて月 100 GB は無料）の適用と読んだ。' +
      'Vercel の関数が AWS のどのアカウントで動き、同じリージョンの DB との通信が「同じリージョン内の AWS サービス間は $0」に当たるかは公式に記載が無い（未確認）。' +
      'Cloudflare の Worker・Hyperdrive は AWS の外なので、インターネットへの転送',
    sources: [
      ...at('2026-11-03', [
        'https://aws.amazon.com/dynamodb/pricing/on-demand/',
        'https://aws.amazon.com/rds/aurora/pricing/',
        'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json',
        'https://aws.amazon.com/ec2/pricing/on-demand/',
        'https://vercel.com/docs/regions',
        'https://vercel.com/docs/marketplace-storage',
      ]),
      ...at('2026-11-04', ['https://aws.amazon.com/rds/postgresql/pricing/']),
    ],
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
    // 受け手で課金しない（送り出しの項目の受け手の条件。同じリージョンの扱いなど）
    if (dir === 'out' && m.freeTo?.includes(to)) return [];
    const facts = (dir === 'out' ? m.factsTo?.[to] : undefined) ?? m.facts;
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
        facts: [...facts],
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
