// 見積対象のフレームワーク（prd/06 §2.2・§2.3 の最小の実装。prd/10 F-02）。
// FrameworkProfile は 2 つ（Next.js・Vite の SPA）、DeployTarget は「どのホストにどう載るか」の表だけを持つ。
// BuildOutput は新しい型を作らず、Workload の routes をそのまま使う（フレームワークの違いはテンプレートの書き換えに閉じ込める）。
// 対応の状況は公式の文書を出典にし、取得日を付ける（prd/03 §1 と同じ規律）。
import type { WorkloadInput } from 'estimator';
import type { Platform } from '../stacks/index.ts';

export type FrameworkId = 'nextjs' | 'vite-spa' | 'astro' | 'nextjs-export';

/**
 * サーバーで HTML を描かず、ログインの要る中身をブラウザが API で取るか（Vite の SPA と Next.js の静的書き出し。D-80）。
 * 構成は SPA と同じ形（静的な配信 + API。API の置き場は D-65 の仕組み）になる。
 */
export const browserCallsApi = (f: FrameworkId | undefined): boolean =>
  f === 'vite-spa' || f === 'nextjs-export';

/**
 * 記事を静的なページにし、更新をビルドし直しで反映するか（Next.js の静的書き出し。D-80）。
 * Astro は D-103 で、記事を閲覧のときに描いて前段でキャッシュする形（ISR と同じ経路）に替えた。
 */
export const rebuildsStaticPages = (f: FrameworkId | undefined): boolean =>
  f === 'nextjs-export';

type Source = { url: string; retrievedAt: string };
const R = '2026-11-01';
const src = (url: string): Source => ({ url, retrievedAt: R });
/** Astro の調査の取得日（D-68）。Next.js の静的書き出し（D-80）も同じ日。 */
const src2 = (url: string): Source => ({ url, retrievedAt: '2026-11-02' });
/** Astro の記事をキャッシュする形の調査の取得日（D-103）。 */
const src3 = (url: string): Source => ({ url, retrievedAt: '2026-11-03' });
/** Astro の route caching（astro@7.0.0。Astro.cache.set・cache.invalidate・事業者ごとの provider。D-103）。 */
const ASTRO_CACHING_DOC = 'https://docs.astro.build/en/guides/caching/';
/** Next.js の静的書き出しの公式の文書（2026-08-09 更新・2026-11-02 取得。D-80）。 */
const NEXT_EXPORT_DOC = 'https://nextjs.org/docs/app/guides/static-exports';

export type FrameworkProfile = {
  id: FrameworkId;
  /** 画面の名前。 */
  label: string;
  renderingModes: ('static' | 'ssr' | 'isr' | 'spa')[];
  /** 選ぶ前に出す説明（何が変わるか）。 */
  note: string;
  sources: Source[];
};

export const FRAMEWORKS: Record<FrameworkId, FrameworkProfile> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js（App Router）',
    renderingModes: ['static', 'ssr', 'isr'],
    note: 'ページごとの HTML をサーバーが作る（ISR・SSR）。記事ごとの SNS のカード（OGP）は HTML に入る。API は同じデプロイの中（Route Handler）',
    sources: [
      src('https://nextjs.org/docs/app/guides/single-page-applications'),
    ],
  },
  'vite-spa': {
    id: 'vite-spa',
    label: 'Vite（SPA）+ API',
    renderingModes: ['static', 'spa'],
    note: '1 つの静的なシェル（index.html）とブラウザの JS で描き、中身は API で取る。HTML の生成（ISR・SSR）は無い。API は同じ事業者に同居させる（別の事業者に置く選択は後の段。prd/10 §3.5）',
    sources: [
      src('https://vite.dev/guide/static-deploy'),
      src('https://nextjs.org/docs/app/guides/single-page-applications'),
    ],
  },
  astro: {
    id: 'astro',
    label: 'Astro',
    renderingModes: ['static', 'ssr', 'isr'],
    note: '記事のページはアダプターで閲覧のときに描き、前段（事業者の CDN・Workers Cache・Node のメモリ）にキャッシュして、記事の投稿・編集のときにそのページのキャッシュを消す（Astro の route caching。消せない事業者は期限で取り直す）。ログインの要るページは毎回描く。ブラウザの JS は動きのある部品（アイランド）の分だけ。記事ごとの SNS のカード（OGP）は HTML に入る。記事のためにビルドし直さない（ビルドはデプロイのときだけ）',
    sources: [
      src2('https://docs.astro.build/en/guides/on-demand-rendering/'),
      src2('https://docs.astro.build/en/concepts/islands/'),
      src3(ASTRO_CACHING_DOC),
    ],
  },
  'nextjs-export': {
    id: 'nextjs-export',
    label: 'Next.js（静的書き出し）',
    renderingModes: ['static', 'spa'],
    note: "next.config の output: 'export' で、ルートごとの HTML をビルドのときに作る（サーバーを持たない）。記事ごとの SNS のカード（OGP）は HTML に入る。ISR・SSR・Cookie・Server Actions・リクエストに依る Route Handler・Proxy（Middleware）・既定のローダーでの画像の最適化は使えないので、マイページなどの中身はブラウザ（Client Component）から API で取り、記事の更新はビルドし直しで反映する",
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2('https://nextjs.org/docs/app/api-reference/components/image'),
    ],
  },
};

/** フレームワーク × 事業者の載せ方（prd/06 §2.3 の最小の形。mapping は composeStack が持つ）。 */
export type DeployTarget = {
  framework: FrameworkId;
  platform: Platform;
  /** 使うアダプター・配り方。 */
  adapter: string;
  support: 'native' | 'emulated' | 'unsupported';
  note: string;
  sources: Source[];
  /**
   * 記事（全員に同じ中身）を閲覧のときに描いてキャッシュする置き場（Astro。D-103）。onDemand は、記事の投稿・編集のときに
   * そのページのキャッシュを全体から消せるか（消せなければ期限で取り直す）。
   */
  pageCache?: { label: string; onDemand: boolean; reason: string };
};

export const DEPLOY_TARGETS: readonly DeployTarget[] = [
  {
    framework: 'nextjs',
    platform: 'cloudflare',
    adapter: 'vinext',
    support: 'native',
    note: 'Next.js の API を Vite の上で実装し Workers へ載せる（experimental。D-08・prd/06 §5）',
    sources: [
      {
        url: 'https://github.com/cloudflare/vinext',
        retrievedAt: '2026-10-31',
      },
    ],
  },
  {
    framework: 'nextjs',
    platform: 'vercel',
    adapter: 'ネイティブ',
    support: 'native',
    note: 'Vercel がそのまま載せる',
    sources: [src('https://vercel.com/docs/frameworks/full-stack/nextjs')],
  },
  {
    framework: 'nextjs',
    platform: 'sakura',
    adapter: 'next start（Node）',
    support: 'native',
    note: 'nginx の後ろで next start を動かす（自前運用）',
    sources: [src('https://nextjs.org/docs/app/getting-started/deploying')],
  },
  {
    framework: 'vite-spa',
    platform: 'cloudflare',
    adapter: 'Workers の静的アセット + 同じ Worker の API',
    support: 'native',
    note: 'not_found_handling = "single-page-application" でシェルを返す。ページ遷移は Worker を起動しない。API（/api/*）は同じ Worker',
    sources: [
      src(
        'https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/',
      ),
      src(
        'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
      ),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'vercel',
    adapter: '静的 + Vercel Functions の API',
    support: 'native',
    note: 'vercel.json の rewrites で /index.html を返す。素の Vite に関数を足す方法は、Vercel の Vite のページでは Nitro などを推奨していて /api の扱いは未確認（prd/10 B-2）',
    sources: [src('https://vercel.com/docs/frameworks/frontend/vite')],
  },
  {
    framework: 'vite-spa',
    platform: 'sakura',
    adapter: 'nginx で静的 + 同じホストの Node の API',
    support: 'native',
    note: 'nginx が dist を配り（try_files でシェルへ）、API は同じ VPS の Node',
    sources: [src('https://vite.dev/guide/static-deploy')],
  },
  // Astro（D-68・prd/06 §6）。静的なページは事業者の静的な配信、ログインの要るページはアダプター
  {
    framework: 'astro',
    platform: 'cloudflare',
    adapter: '@astrojs/cloudflare（Workers）+ Workers Cache',
    support: 'native',
    note: 'JS・CSS は Workers の静的アセット、ページは Worker が描く。Pages はアダプターの対象外になった。記事は route caching の cacheCloudflare()（アダプターが Workers Cache を有効にし、Cache-Tag を付ける）で Worker の前にキャッシュし、投稿・編集のときに ctx.cache.purge でタグ・パスごと消す（Instant Purge で全体に伝わる）。ヒットは Worker を動かさない（CPU なし）が、Workers Cache を有効にすると静的アセットも含めてすべてのリクエストが Workers の料金で数えられる。消した後の最初の閲覧は Worker が描き終わるのを待つ（その閲覧の CPU に描画の全部が乗る）。画像は Images の binding（imageService: cloudflare-binding）',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/cloudflare/'),
      src3(ASTRO_CACHING_DOC),
      src3('https://developers.cloudflare.com/workers/cache/'),
      src3('https://developers.cloudflare.com/workers/cache/purge/'),
      src3('https://developers.cloudflare.com/workers/platform/pricing/'),
    ],
    pageCache: {
      label: 'Workers Cache（cacheCloudflare）',
      onDemand: true,
      reason:
        '投稿・編集のときに ctx.cache.purge でそのページのタグを消す（Instant Purge で全体に伝わる。消す呼び出しは Free の制限: タグ・prefix は 1 分 5 回・貯めて 25 回）',
    },
  },
  {
    framework: 'astro',
    platform: 'vercel',
    adapter: '@astrojs/vercel（isr）',
    support: 'native',
    note: 'ページは Vercel Functions が描く。アダプターの isr で記事を最初の閲覧の後にキャッシュし（Next.js の ISR と同じ CDN と ISR の永続ストレージ・同じ料金）、投稿・編集のときに bypassToken（x-prerender-revalidate のヘッダー）でそのページを取り直す（全リージョンで 300ms 以内）。期限（expiration）で取り直すこともできる。exclude に挙げたページ（ログインの要るページ）は毎回描く。画像は imageService で Vercel の画像の最適化',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/vercel/'),
      src3('https://vercel.com/docs/incremental-static-regeneration'),
      src2('https://vercel.com/docs/pricing'),
    ],
    pageCache: {
      label: 'ISR（@astrojs/vercel の isr）',
      onDemand: true,
      reason:
        'bypassToken を付けたリクエストでそのページを取り直す（Vercel の ISR の全リージョンの更新）',
    },
  },
  {
    framework: 'astro',
    platform: 'sakura',
    adapter: '@astrojs/node（standalone）+ memoryCache',
    support: 'native',
    note: 'nginx の後ろの同じ VPS の Node がページを描く。記事は route caching の memoryCache()（Node のメモリ。1 台なので共有の問題は無い）にキャッシュし、投稿・編集のときに cache.invalidate でタグ・パスごと消す。nginx の proxy_cache で持つ形は、消す仕組み（proxy_cache_purge）がオープンソース版の標準に無いので採らない。前段の Cloudflare で HTML もキャッシュするときは、Free の purge の API で同じページを消す（D-91）',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/node/'),
      src3(ASTRO_CACHING_DOC),
    ],
    pageCache: {
      label: 'Node のメモリ（memoryCache）',
      onDemand: true,
      reason:
        '投稿・編集のときに cache.invalidate でそのページのタグ・パスを消す（1 台の Node の中）',
    },
  },
  {
    framework: 'astro',
    platform: 'aws',
    adapter: 'なし（公式のアダプターが無い）',
    support: 'unsupported',
    note: 'Astro の AWS の手順は、静的なら Amplify・S3 + CloudFront、リクエストのたびに描くページは Amplify のコミュニティのアダプター（astro-aws-amplify）か SST。公式のアダプターが無いので、このモデルでは扱わない',
    sources: [src2('https://docs.astro.build/en/guides/deploy/aws/')],
  },
  {
    framework: 'astro',
    platform: 'aws-opennext',
    adapter: 'なし（OpenNext は Next.js 用）',
    support: 'unsupported',
    note: 'OpenNext は Next.js のビルド出力を直す道具で、Astro には使えない',
    sources: [src2('https://docs.astro.build/en/guides/deploy/aws/')],
  },
  // Next.js の静的書き出し（D-80）。out/ の静的なファイルを事業者の静的な配信から返し、API は SPA と同じ置き場（D-65）。
  // 画像は既定のローダーが使えないので、変換のサービスの URL を返すローダー（loaderFile）か、最適化しない（unoptimized）か、投稿のときに縮める
  {
    framework: 'nextjs-export',
    platform: 'cloudflare',
    adapter: 'Workers の静的アセット + 同じ Worker の API',
    support: 'native',
    note: 'out/ を静的アセットで配る（Worker を起動しない）。/blog/post-1 は既定の html_handling（auto-trailing-slash）で /blog/post-1.html を返す。API（/api/*）は同じ Worker。画像は Cloudflare の公式の Next.js のローダー（/cdn-cgi/image/ の URL）で Images の変換を使える。記事の更新は Workers Builds でビルドし直す',
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2(
        'https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/',
      ),
      src2(
        'https://developers.cloudflare.com/images/transform-images/integrate-with-frameworks/',
      ),
      src2(
        'https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/',
      ),
    ],
  },
  {
    framework: 'nextjs-export',
    platform: 'vercel',
    adapter: '静的 + Vercel Functions の API',
    support: 'native',
    note: 'out/ を CDN から配り、API は同じプロジェクトの関数。Vercel の画像の最適化は next/image の既定のローダー（/_next/image）で使う形で、静的書き出しでは既定のローダーが使えない（他のフレームワークの /_vercel/image は Build Output API の設定。Next.js の静的書き出しから使う手順は未確認）ので、画像は投稿のときに縮める・最適化しない・他の事業者の変換のどれか。記事の更新は Vercel のビルドでビルドし直す',
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2('https://vercel.com/docs/image-optimization'),
      src2('https://vercel.com/docs/builds/managing-builds'),
    ],
  },
  {
    framework: 'nextjs-export',
    platform: 'sakura',
    adapter: 'nginx で静的 + 同じホストの Node の API',
    support: 'native',
    note: 'nginx が out/ を配る（公式の例: try_files $uri $uri.html $uri/ =404）。API は同じ VPS の Node。next start が無いので、ホストでの画像の変換（next/image の既定のローダー）は使えない。ビルドも VPS の上（ビルドの CPU は数えていない・仮定）',
    sources: [src2(NEXT_EXPORT_DOC)],
  },
  {
    framework: 'nextjs-export',
    platform: 'aws',
    adapter: 'S3 + CloudFront + Lambda（API Gateway の HTTP API）',
    support: 'native',
    note: 'out/ を S3 に置いて CloudFront で配り、API は HTTP API の後ろの Lambda（SPA と同じ形）。ビルドは手元か CI（GitHub Actions など）で行う前提で、ビルドの費用は数えない（仮定）。デプロイのたびの CloudFront の無効化（/* は 1 パス）も数えていない',
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2('https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/'),
    ],
  },
  {
    framework: 'nextjs-export',
    platform: 'aws-opennext',
    adapter: 'なし（OpenNext はサーバーの出力を直す道具）',
    support: 'unsupported',
    note: '静的書き出しにはサーバーが無いので OpenNext は使わない。AWS（S3 + CloudFront）の構成を選ぶ',
    sources: [src2('https://opennext.js.org/aws')],
  },
  {
    framework: 'nextjs-export',
    platform: 'netlify',
    adapter: '静的 + Netlify Functions の API',
    support: 'native',
    note: 'out/ を CDN から配り、API は同じサイトの Netlify Functions。画像は Netlify Image CDN を /.netlify/images の URL で使える（「For all other frameworks, you can use Netlify Image CDN directly」。ローダーで URL を返す）。ビルドし直しは本番のデプロイ 1 回ごとにクレジットを使う',
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2('https://docs.netlify.com/build/image-cdn/overview/'),
    ],
  },
  // AWS（prd/11 段 1・D-50）
  {
    framework: 'nextjs',
    platform: 'aws',
    adapter: 'Amplify Hosting（SSR の計算）',
    support: 'native',
    note: 'Amplify Hosting が Next.js 12〜15 の SSR・ISR・画像の最適化を扱う。オンデマンド ISR・ストリーミング・Edge のミドルウェアは非対応（16 の機能は使わない前提。prd/11 AX-03）',
    sources: [
      src(
        'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html',
      ),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'aws',
    adapter: 'S3 + CloudFront + Lambda（API Gateway の HTTP API）',
    support: 'native',
    note: 'シェルと静的なファイルを S3 に置いて CloudFront で配り、API は HTTP API の後ろの Lambda。ディープリンクをシェルへ寄せる設定（CloudFront のエラー応答など）の手順は未確認（prd/11 §1.2）',
    sources: [src('https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/')],
  },
  // AWS の OpenNext（D-63）
  {
    framework: 'nextjs',
    platform: 'aws-opennext',
    adapter: 'OpenNext（Lambda + CloudFront + S3 + DynamoDB + SQS）',
    support: 'emulated',
    note: 'OpenNext がビルド出力を Lambda 向けに直す。ISR は S3 のキャッシュ・DynamoDB のタグ・SQS の再検証で自前に再現する（オンデマンドの再検証に対応）。Next.js 15 が対象。インフラは SST などで自分で組む',
    sources: [
      src('https://opennext.js.org/aws'),
      src('https://opennext.js.org/aws/inner_workings/architecture'),
      src('https://opennext.js.org/aws/inner_workings/components/server/node'),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'aws-opennext',
    adapter: 'S3 + CloudFront + Lambda（API Gateway の HTTP API）',
    support: 'native',
    note: 'SPA では OpenNext を使わず、AWS の SPA と同じ形になる',
    sources: [src('https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/')],
  },
  // Netlify（D-71・prd/11 §14）
  {
    framework: 'nextjs',
    platform: 'netlify',
    adapter: 'OpenNext のアダプター（設定なし）',
    support: 'native',
    note: 'Next.js 13.5 以降を設定なしで載せる。SSR・ISR・Route Handler・Server Actions は Netlify Functions、ミドルウェアは Edge Functions。ISR は時間・オンデマンド（パス・タグ）の再検証とも完全に対応。next/image は Netlify Image CDN',
    sources: [src2('https://docs.netlify.com/frameworks/next-js/overview/')],
  },
  {
    framework: 'vite-spa',
    platform: 'netlify',
    adapter: '静的 + Netlify Functions の API',
    support: 'native',
    note: 'dist を配り、SPA は書き換えの規則で index.html を返す。API は同じサイトの Netlify Functions',
    sources: [
      src2(
        'https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/',
      ),
    ],
  },
  {
    framework: 'astro',
    platform: 'netlify',
    adapter: '@astrojs/netlify',
    support: 'native',
    note: 'ページは Netlify Functions が描く。記事は route caching の cacheNetlify()（Netlify-CDN-Cache-Control・Netlify-Cache-Tag。全エッジで共有する durable cache）でキャッシュし、投稿・編集のときにタグで消す。画像は既定で Netlify Image CDN',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/netlify/'),
      src2(
        'https://docs.netlify.com/build/frameworks/framework-setup-guides/astro/',
      ),
      src3(ASTRO_CACHING_DOC),
    ],
    pageCache: {
      label: 'Netlify の durable cache（cacheNetlify）',
      onDemand: true,
      reason: '投稿・編集のときにそのページのタグを消す',
    },
  },
  // Google Cloud（D-88・prd/11 §16。2026-11-02 に公式の文書で確かめた）
  {
    framework: 'nextjs',
    platform: 'gcp',
    adapter: "output: 'standalone' のコンテナ（Cloud Run）+ Firebase Hosting",
    support: 'native',
    note: "Next.js は Docker のコンテナですべての機能が動く（公式）。output: 'standalone' のサーバーを Cloud Run で動かし、Firebase Hosting の書き換えで渡す。ISR のキャッシュはインスタンスごとのローカルで、複数のインスタンスで共有されない（共有するには cacheHandler を自分で書く）。next/image の最適化もコンテナの中で動く",
    sources: [
      src2('https://nextjs.org/docs/app/getting-started/deploying'),
      src2('https://nextjs.org/docs/app/guides/self-hosting'),
      src2('https://firebase.google.com/docs/hosting/cloud-run'),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'gcp',
    adapter: 'Firebase Hosting + Cloud Run の API',
    support: 'native',
    note: 'dist を Firebase Hosting から配り（SPA は書き換えで index.html を返す）、/api を書き換えで Cloud Run のコンテナに渡す',
    sources: [
      src2('https://firebase.google.com/docs/hosting/full-config'),
      src2('https://firebase.google.com/docs/hosting/cloud-run'),
    ],
  },
  {
    framework: 'nextjs-export',
    platform: 'gcp',
    adapter: 'Firebase Hosting + Cloud Run の API',
    support: 'native',
    note: 'out/ を Firebase Hosting から配り、API は書き換えで Cloud Run のコンテナに渡す。next start が無いので next/image の既定のローダーは使えない。ビルドは手元か CI で行い firebase deploy する前提で、ビルドの費用は数えない（仮定）。デプロイのたびに Hosting の CDN のキャッシュは全体が消える',
    sources: [
      src2(NEXT_EXPORT_DOC),
      src2('https://firebase.google.com/docs/hosting/manage-cache'),
    ],
  },
  {
    framework: 'astro',
    platform: 'gcp',
    adapter:
      '@astrojs/node（standalone のコンテナを Cloud Run）+ Firebase Hosting',
    support: 'native',
    note: 'ページは @astrojs/node のサーバーを Cloud Run で動かし、Firebase Hosting の書き換えで渡す。記事は Cache-Control に public・s-maxage を付けて Hosting の CDN にキャッシュさせる。Hosting の CDN はデプロイのときしか消えず、パスやタグで消す方法が無いので、期限（s-maxage）で取り直す（Next.js の ISR と同じ）',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/node/'),
      src2('https://firebase.google.com/docs/hosting/cloud-run'),
      src2('https://firebase.google.com/docs/hosting/manage-cache'),
    ],
    pageCache: {
      label: 'Hosting の CDN（s-maxage）',
      onDemand: false,
      reason:
        'Firebase Hosting の CDN のキャッシュはデプロイのときにしか消えない（パスやタグを指定して消す方法が文書に無い）ので、記事の投稿・編集で消せない',
    },
  },
];

/** フレームワークをその事業者に載せられるか（DeployTarget が unsupported・無いなら載せられない。D-68）。 */
export function frameworkSupported(
  framework: FrameworkId,
  platform: Platform,
): boolean {
  const d = deployTarget(framework, platform);
  return d !== undefined && d.support !== 'unsupported';
}

export function deployTarget(
  framework: FrameworkId,
  platform: Platform,
): DeployTarget | undefined {
  return DEPLOY_TARGETS.find(
    (d) => d.framework === framework && d.platform === platform,
  );
}

/**
 * SPA にしたときのアプリの形（テンプレートの既定値。template-default・実測ではない）。
 * dataCpuFactor: HTML の描画が無い分、ページの中身を返す API の CPU を SSR の何倍とみなすか（仮定）。
 * この値で Cloudflare Free の 1 リクエスト CPU 10 ms に当たるかが決まる（prd/10 B-5）。
 */
export type SpaShape = {
  shellKB: number;
  dataCpuFactor: number;
  dataResponseKB: number;
};

/**
 * テンプレートの Workload を SPA の形に書き換える（ISR・SSR のルートを spa に。静的なルートはそのまま）。
 * ページの中身はデータの API で取り、処理は SSR の値から作る（CPU は dataCpuFactor 倍・DB の往復は同じ）。
 * cacheContent: 記事（ISR だったルート＝全員に同じ中身）の API の応答をキャッシュする。期間は ISR の間隔
 * （revalidateSeconds）をそのまま使う。SSR だったルートは個人化された中身なのでキャッシュしない（D-37）。
 */
export function toSpa(
  w: WorkloadInput,
  shape: SpaShape,
  options: { cacheContent?: boolean } = {},
): WorkloadInput {
  return {
    ...w,
    routes: w.routes.map((r) => {
      if (r.rendering === 'static' || r.rendering === 'spa') return r;
      return {
        id: r.id,
        ...(r.label !== undefined ? { label: r.label } : {}),
        rendering: 'spa' as const,
        share: r.share,
        pages: r.pages,
        shellKB: shape.shellKB,
        ...(options.cacheContent &&
        r.rendering === 'isr' &&
        r.revalidateSeconds !== undefined
          ? { cacheSeconds: r.revalidateSeconds }
          : {}),
        processing: {
          ...r.processing,
          cpuMs: r.processing.cpuMs * shape.dataCpuFactor,
          responseKB: shape.dataResponseKB,
        },
      };
    }),
  };
}

/**
 * Astro にしたときのアプリの形（テンプレートの既定値。template-default・実測ではない。D-68）。
 * assetsFactor: ページあたりの JS・CSS のファイル数を Next.js の何倍とみなすか（アイランドの分だけ）。
 * minutesPerBuild: 1 回のビルドの時間（分）= base + 静的なページ 1,000 あたり perThousandPages。Astro の記事はビルドし直さなく
 * なった（D-103）ので、今は Next.js の静的書き出しのビルドの時間の式として使う（ゲーム上の仮定。D-80）。
 */
export type AstroShape = {
  assetsFactor: number;
  minutesPerBuild: { base: number; perThousandPages: number };
};

/**
 * テンプレートの Workload を Astro の形に書き換える（D-68・D-103）。ISR だったルート（全員に同じ中身の記事）は、アダプターが
 * 閲覧のときに描いて前段でキャッシュし、投稿・編集で消す（Astro の route caching）。数え方は ISR と同じ（時間の期限・オンデマンドの
 * 式がそのまま使える。新しい種類は足さない。RS-05）ので、ルートは isr のまま残す。消した後の閲覧が描くのを待つか裏で描くかは
 * 構成のノードで決まる。SSR のルート（個人化）は毎回描く。JS・CSS はアイランドの分だけ（assetsFactor）。
 */
export function toAstro(w: WorkloadInput, shape: AstroShape): WorkloadInput {
  return {
    ...w,
    perPage: { ...w.perPage, assets: w.perPage.assets * shape.assetsFactor },
  };
}

/**
 * ISR だったルート（全員に同じ中身の記事）をビルドのときに HTML にし、更新をビルドし直しで反映する（Next.js の静的書き出し。D-80）。
 * 内容の更新（updatesPerMonth。記事の投稿・編集。コメントを記事のページに含めるとコメントの投稿も）を、間隔（省略は更新のたび）で
 * まとめてビルドする。
 */
export function toStaticBuild(
  w: WorkloadInput,
  minutesPerBuild: AstroShape['minutesPerBuild'],
  build: { updatesPerMonth: number; intervalSeconds?: number },
): WorkloadInput {
  let staticPages = 0;
  const routes = w.routes.map((r) => {
    if (r.rendering !== 'isr') return r;
    staticPages += r.pages;
    return {
      id: r.id,
      ...(r.label !== undefined ? { label: r.label } : {}),
      rendering: 'static' as const,
      share: r.share,
      pages: r.pages,
      processing: r.processing,
    };
  });
  return {
    ...w,
    routes,
    ...(staticPages > 0
      ? {
          build: {
            updatesPerMonth: build.updatesPerMonth,
            ...(build.intervalSeconds !== undefined
              ? { intervalSeconds: build.intervalSeconds }
              : {}),
            minutesPerBuild: buildMinutes(minutesPerBuild, staticPages),
          },
        }
      : {}),
  };
}

/** 1 回のビルドの時間（分）= base + 静的なページ 1,000 あたり perThousandPages（ゲーム上の仮定。D-68）。 */
export function buildMinutes(
  m: AstroShape['minutesPerBuild'],
  staticPages: number,
): number {
  return m.base + (staticPages / 1000) * m.perThousandPages;
}

/**
 * テンプレートの Workload を Next.js の静的書き出しの形に書き換える（D-80）。ISR だったルート（全員に同じ中身の記事）は
 * ビルドのときに HTML にし（更新はビルドし直し）、SSR だったルート（個人化）はビルドした HTML の上で
 * Client Component が API で中身を取る（SPA と同じく、ページの中身はデータの API）。JS・CSS は Next.js のまま。
 * 1 回のビルドの時間は buildMinutes（ゲーム上の仮定）。
 */
export function toNextExport(
  w: WorkloadInput,
  spa: SpaShape,
  minutesPerBuild: AstroShape['minutesPerBuild'],
  build: { updatesPerMonth: number; intervalSeconds?: number },
): WorkloadInput {
  return toSpa(toStaticBuild(w, minutesPerBuild, build), spa);
}
