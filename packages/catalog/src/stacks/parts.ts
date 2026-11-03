// 他の事業者の部品（D-114・prd/14 案 C の段 1）。部品は自分の事業者（platform）・役割（role）・受ける口（accepts）・
// 土台の側でつながる役割（attachesTo）を持ち、差せる土台は接続の規則（connections.ts）から導く。id は今の部品の id のまま（CP-13）。
// label は事業者の名前を前に付ける（prd/11 §3.1）。差し方（土台のノードの外し方・経路）は cross.ts。
import type { ComponentOption } from './index.ts';
import { partOptions, type PartDef } from './connections.ts';

const VERCEL_TO_CF_IMAGES_REFS = [
  'fact:cloudflare:r2-standard:custom-domain',
  'pool:cloudflare:r2-storage',
];

/** 他の事業者の部品（表で許した組だけ）。label は事業者の名前を前に付ける（prd/11 §3.1）。 */
export const CROSS_PARTS: readonly PartDef[] = [
  {
    id: 'cf-images',
    slot: 'images',
    platform: 'cloudflare',
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['compute'],
    as: 'images',
    label: 'Cloudflare: R2 に置き、閲覧のときに Images で変換',
    note:
      '画像の原本を Cloudflare の R2 に置き、画像のドメイン（Cloudflare のゾーン）の URL で変換して配る。土台（Vercel・AWS・Netlify・Google Cloud）の CDN を通らないので、' +
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
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['compute'],
    as: 'resize',
    label: 'Cloudflare: 投稿のときに一律で縮めて R2 に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloudflare の R2 に置き、原本は残さない。' +
      '画像のドメイン（Cloudflare のゾーン）から配るので、画像の転送は土台（Vercel・AWS・Netlify・Google Cloud）の転送の料金にならない（R2 の転送は無料）。' +
      '変換のサービスは使わない。サイズ違いが無いので、スマホにも同じ大きさを配る。Cloudflare のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [...VERCEL_TO_CF_IMAGES_REFS],
  },
  // Bunny の画像（D-98）。Cloudflare の cf-images・cf-resize と同じ振る舞いで、置き場・配信・変換を Bunny にする
  {
    id: 'bunny-images',
    slot: 'images',
    platform: 'bunny',
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['compute'],
    as: 'images',
    label: 'Bunny: Storage に置き、閲覧のときに Optimizer で変換',
    note:
      '画像の原本を Bunny Storage（東京の 1 地域）に置き、Bunny CDN の URL の引数（?width=）で Optimizer が変換して配る。土台の CDN を通らないので、' +
      '画像の転送は土台の転送の料金にならず、Bunny の $0.03/GB（アジア）になる。Optimizer は月 $9.50 で変換は無制限（一意な変換の数で課金されない）。' +
      'next/image のローダーは自分で書く（公式の例に無い）。月の最低額は $1。Bunny のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:bunny:standard:asia-rate',
      'fact:bunny:standard:monthly-minimum',
      'fact:bunny:standard:storage-origin',
      'fact:bunny:optimizer:dynamic-images',
      'fact:bunny:optimizer:optimizer-flat',
    ],
  },
  {
    id: 'bunny-resize',
    slot: 'images',
    platform: 'bunny',
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['compute'],
    as: 'resize',
    label: 'Bunny: 投稿のときに一律で縮めて Storage に置く',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Bunny Storage に置き、原本は残さない。' +
      'Bunny CDN から配るので、画像の転送は土台の転送の料金にならず、Bunny の $0.03/GB（アジア）になる。Optimizer は使わない（月額なし）。' +
      'サイズ違いが無いので、スマホにも同じ大きさを配る。月の最低額は $1。Bunny のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [
      'fact:bunny:standard:asia-rate',
      'fact:bunny:standard:monthly-minimum',
      'fact:bunny:standard:storage-origin',
    ],
  },
  // 原本だけ R2 に置き、変換は土台の画像の最適化（D-114 段 2c）。土台の変換（image-transform）が R2 の公開の URL から原本を取るので、
  // 土台の変換と配信は残り、置き場だけが替わる（cross.ts の applyCross が attachesTo で見分ける）。振る舞いは土台の「画像の最適化」と同じ
  {
    id: 'cf-r2-origin',
    slot: 'images',
    platform: 'cloudflare',
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['image-transform'],
    as: 'default',
    label:
      'Cloudflare: R2 に原本を置き、閲覧のときに Vercel の画像の最適化で変換',
    note:
      '画像の原本を Cloudflare の R2（公開バケット・Cloudflare のゾーンのカスタムドメイン）に置き、閲覧のときの変換と配信は今の画像の最適化のまま（変換・キャッシュの読み書き・CDN の転送とリクエストは同じに数える）。' +
      'Vercel Blob の保存・操作・転送の代わりに、R2 の保存と書き込みがかかる（R2 の転送は無料）。' +
      '画像の最適化が原本を取りに来る R2 の読み取り（Class B。外れた変換 1 回あたり 1 回・月 1,000 万回まで無料）は数えない（Blob の原本を取る分を数えないのと同じ）。' +
      'Cloudflare のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      ...VERCEL_TO_CF_IMAGES_REFS,
      'pool:cloudflare:r2-standard:r2-class-a',
      'pool:cloudflare:r2-standard:r2-class-b',
    ],
  },
  // 画像だけ AWS（S3 + CloudFront。D-114 段 2c）。AWS の構成の「投稿のときに一律で縮めて置く」と同じ置き方（S3 と CloudFront のノードは stacks/aws.ts）
  {
    id: 'aws-s3-resize',
    slot: 'images',
    platform: 'aws',
    role: 'object-store',
    accepts: ['public-url', 'https-api'],
    attachesTo: ['compute'],
    as: 'resize',
    label: 'AWS: 投稿のときに一律で縮めて S3 に置き、CloudFront で配る',
    note:
      '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて AWS の S3（東京）に置き、原本は残さない。' +
      '画像は CloudFront（S3 をオリジンにし、OAC で CloudFront からだけ読ませる）から配るので、画像の転送は土台の転送の料金にならず、CloudFront の料金（常時無料の月 1 TB の後）になる。S3 から CloudFront への転送は無料。' +
      '変換のサービスは使わない。サイズ違いが無いので、スマホにも同じ大きさを配る。往復の遅延は計算しない',
    premiseRefs: [
      'fact:aws:cloudfront:origin-fetch-free',
      'pool:aws:cloudfront:cloudfront-free-transfer',
      'pool:aws:cloudfront:cloudfront-free-requests',
    ],
  },
  // Bunny の前段の CDN（D-98）。土台ごとにフレームワークの条件が違う（Amplify は Next.js だけ・VPS はすべて）ので部品を分ける
  {
    id: 'bunny',
    slot: 'frontCdn',
    platform: 'bunny',
    role: 'edge-cdn',
    accepts: ['public-url'],
    // Amplify の配信（edge-cdn）をオリジンにする
    attachesTo: ['edge-cdn'],
    frameworks: ['nextjs'],
    as: 'static',
    label: 'Bunny: CDN を前段に置く（静的と画像だけ）',
    note:
      'Bunny CDN の Pull Zone の後ろに Amplify を置き、静的なファイルと Amplify で最適化した画像を Bunny が返す（$0.03/GB・要求の課金なし・月の最低額 $1）。' +
      '外れた分と HTML・API は Amplify の配信としても課金される（二重になる）とみなす（自前の CloudFront の前段と同じ読み）。CloudFront の常時無料（月 1 TB）は使えない。' +
      'Bunny のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [
      'fact:bunny:standard:pull-zone-origin',
      'fact:bunny:standard:asia-rate',
      'fact:bunny:standard:monthly-minimum',
      'fact:aws:amplify-hosting:front-cloudfront',
    ],
  },
  {
    id: 'bunny',
    slot: 'frontCdn',
    platform: 'bunny',
    role: 'edge-cdn',
    accepts: ['public-url'],
    // VPS（nginx。処理の役割）をオリジンにする
    attachesTo: ['compute'],
    as: 'static',
    label: 'Bunny: CDN を前段に置く（静的と画像だけ）',
    note:
      'Bunny CDN の Pull Zone の後ろに VPS（nginx）を置き、静的なファイルと変換済みの画像の大部分を Bunny が返す（VPS の回線と CPU が減る）。' +
      'Cloudflare の Free と違い転送に $0.03/GB（アジア）かかるが、画像の割合についての規約の制限は無い。HTML は VPS のまま。' +
      'API の応答のキャッシュは扱わない（Cloudflare の前段だけ）。月の最低額は $1。Bunny のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: [
      'fact:bunny:standard:pull-zone-origin',
      'fact:bunny:standard:asia-rate',
      'fact:bunny:standard:monthly-minimum',
      'host:',
    ],
  },
  // SPA の API の置き場（D-65）。label・note の方針は画像と同じ（事業者の名前を前に付け、損は note で分かるようにする）
  {
    id: 'cf-workers',
    slot: 'api',
    platform: 'cloudflare',
    role: 'compute',
    accepts: ['https-api'],
    // ブラウザ（土台が配った SPA）が呼ぶ
    attachesTo: ['static-host'],
    frameworks: ['vite-spa', 'nextjs-export'],
    as: 'same',
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
    role: 'compute',
    accepts: ['https-api'],
    attachesTo: ['static-host'],
    frameworks: ['vite-spa', 'nextjs-export'],
    as: 'same',
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
    role: 'compute',
    accepts: ['https-api'],
    // 土台のサーバー（処理）が呼ぶ
    attachesTo: ['compute'],
    frameworks: ['nextjs'],
    as: 'same',
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
    role: 'compute',
    accepts: ['https-api'],
    attachesTo: ['compute'],
    frameworks: ['astro'],
    as: 'same',
    label:
      'Cloudflare: Workers に API を置き、DB は D1（Astro のサーバーから呼ぶ）',
    note:
      'API を Cloudflare の Worker（api のサブドメイン）に置き、DB は D1 を binding で使う。Astro のサーバー（マイページの SSR・エンドポイント）は DB を直接読まず、' +
      'Worker の API を fetch で呼び、ページの描画は応答を待つ（往復の遅延は計算しない）。記事は今の事業者で描いてキャッシュする（描き直すときも API を呼ぶ。D-103）。' +
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
  // ---- DB の部品（D-77・D-114 段 2・段 2b）。土台の DB（Vercel・Netlify の Supabase、Cloudflare の D1 など）の代わりに置く。----
  // 説明（note）は土台によらない文にし、土台ごとのつなぎ方（認証・作り方・中継）は接続の規則の partNote に置く（土台を足すときは規則を足すだけ）。
  // ノードは cross.ts の DB_PART_NODES（事業者ごと）、構成の名前は title（crossDbName）。API の置き場が同居のときだけ効く（他の事業者に置くと DB はその事業者の部品）
  {
    id: 'neon',
    slot: 'db',
    platform: 'neon',
    role: 'sql-db',
    // serverless driver（HTTP。Vercel・Netlify の関数）と、Postgres のワイヤプロトコル（Cloudflare の Hyperdrive）
    accepts: ['https-api', 'tcp-sql'],
    attachesTo: ['compute'],
    as: 'neon',
    title: { free: 'Neon（Free）', paid: 'Neon（Launch）' },
    label: 'Neon: 従量の Postgres（閲覧が途切れると止まる）',
    note:
      'DB を Neon に替える。基本料が無く、動いている時間（最小の 0.25 CU）・保存・転送（月 500 GB の後）の分だけ払う。問い合わせが 5 分無いと止まり、止まっている間は計算に払わない（動いている割合は DB に届く件数から出す。ほぼ常に誰かが見ているサイトでは、ほとんど止まらない）。' +
      '土台が無料のプラン（Vercel Hobby・Netlify Free・Cloudflare Free）なら Neon Free（月 100 CU 時間・転送 5 GB・1 GB まで。超えると止まる）、それ以外は Neon Launch。' +
      '東京のリージョンが無く、最寄りはシンガポール（往復の遅延は計算しない）。Neon のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: ['fact:neon:', 'pool:neon:', 'limit:neon:'],
  },
  // Supabase（D-114 段 2d）。Vercel・Netlify は土台の既定の DB、Cloudflare は「Hyperdrive 経由で Supabase」（土台の部品）があるので、
  // それ以外の土台（さくらの VPS・Google Cloud・AWS）の部品。ノードは Vercel・Netlify の既定の Supabase と同じ組み立て（cross.ts の supabaseNode）
  {
    id: 'supabase',
    slot: 'db',
    platform: 'supabase',
    role: 'sql-db',
    accepts: ['tcp-sql'],
    attachesTo: ['compute'],
    as: 'supabase',
    title: { free: 'Supabase Free', paid: 'Supabase Pro' },
    label: 'Supabase: Postgres（共有のプールでつなぐ）',
    note:
      'DB を Supabase に替える。Pro は月の基本料（$25）と Micro のサーバーの稼働がかかり（Compute のクレジット $10 つき）、転送は月 250 GB の後 $0.09/GB、ディスクは 8 GB の後。' +
      '土台が無料のプランなら Supabase Free（転送 5 GB・1 週間使われないと一時停止）。共有のプール（Supavisor。IPv4）でつなぎ、プール経由の転送は DB の転送と二重に数えない。' +
      'Supabase のアカウントが 1 つ増え、請求が 2 つになる。往復の遅延は計算しない',
    premiseRefs: [
      'fact:supabase:pro-micro:compute',
      'limit:supabase:pro-micro:pooler-connections',
      'limit:supabase:free:db-size',
    ],
  },
  // AWS の DB（D-114 段 2・段 2b）。公開の口でつなぐ（CP-07）。id は AWS の構成の DB の部品と同じ（料金・ノードは stacks/aws.ts の dbNode）
  {
    id: 'dynamodb',
    slot: 'db',
    platform: 'aws',
    role: 'sql-db',
    accepts: ['https-api'],
    attachesTo: ['compute'],
    as: 'dynamodb',
    title: 'AWS DynamoDB',
    label: 'AWS: DynamoDB（オンデマンド）',
    note:
      'DB を AWS の DynamoDB（東京・オンデマンド）に替える。読み書きの単位で課金し、時間課金のコンピュートが無い（保存は 25 GB 月まで無料）。' +
      'DB の応答は AWS からインターネットへの転送（$0.114/GB。AWS 全体で月 100 GB は無料）で数える。請求は AWS。往復の遅延は計算しない',
    premiseRefs: [
      'fact:aws:dynamodb-on-demand:request-units',
      'pool:aws:dynamodb-on-demand:dynamodb-free-storage',
      'pool:aws:data-transfer-out:internet-free-transfer',
    ],
  },
  ...(
    [
      {
        id: 'aurora',
        label: 'Aurora Serverless v2（最小 0.5 ACU）',
        size: '最小の 0.5 ACU の分は常にかかる（負荷で伸びた分はこのモデルでは数えない）',
        refs: ['fact:aws:aurora-serverless-v2-io:io-optimized'],
      },
      {
        id: 'aurora-pause',
        label: 'Aurora Serverless v2（0 ACU まで縮める）',
        size: '接続が 300 秒ないと止まり、止まっている間は ACU の料金がかからない（再開の待ちは速さに入れていない）',
        refs: ['fact:aws:aurora-serverless-v2-io:auto-pause'],
      },
    ] as const
  ).map((a): PartDef => ({
    id: a.id,
    slot: 'db',
    platform: 'aws',
    role: 'sql-db',
    accepts: ['tcp-sql'],
    attachesTo: ['compute'],
    as: a.id,
    title: 'AWS Aurora Serverless v2',
    label: `AWS: ${a.label}`,
    note:
      `DB を AWS の Aurora PostgreSQL（東京・Serverless v2・I/O-Optimized）に替える。ACU の時間で課金し、${a.size}。` +
      'DB の応答は AWS からインターネットへの転送（$0.114/GB。AWS 全体で月 100 GB は無料）で数える。公開の IPv4 のアドレスの時間課金は未確認で数えない。請求は AWS。往復の遅延は計算しない',
    premiseRefs: [
      ...a.refs,
      'pool:aws:data-transfer-out:internet-free-transfer',
    ],
  })),
  // 公開の RDS（D-114 段 2b・段 2d）。Cloudflare は Hyperdrive 経由、ほかの土台は公開のエンドポイントへ直接（Vercel の Marketplace には無い）
  {
    id: 'rds',
    slot: 'db',
    platform: 'aws',
    role: 'sql-db',
    accepts: ['tcp-sql'],
    attachesTo: ['compute'],
    as: 'rds',
    title: 'AWS RDS for PostgreSQL',
    label: 'AWS: RDS for PostgreSQL（db.t4g.micro）',
    note:
      'DB を AWS の RDS for PostgreSQL（東京・db.t4g.micro・Single-AZ）に替える。時間課金で、使われていなくても毎月かかる（ディスクは 20 GiB から）。' +
      'DB の応答は AWS からインターネットへの転送（$0.114/GB。AWS 全体で月 100 GB は無料）で数える。公開の IPv4 のアドレスの時間課金は未確認で数えない。請求は AWS。往復の遅延は計算しない',
    premiseRefs: ['pool:aws:data-transfer-out:internet-free-transfer'],
  },
  // VPS の API + Cloudflare の静的（SPA・D-67）。自前運用の維持の手間・障害は部品で VPS を使うときにも効く（game の selfHostedOf）。
  // プランは 2GB と 4GB（ディスクが 2 倍）。プランの間の移し替えも API と DB のデータの移行として扱う（仮定）
  ...(['2gb', '4gb'] as const).map((plan): PartDef => ({
    id: `sakura-vps-${plan}`,
    slot: 'api',
    platform: 'sakura',
    role: 'compute',
    accepts: ['https-api'],
    // SPA・静的書き出しはブラウザが、Astro は Worker（処理）が呼ぶ
    attachesTo: ['static-host', 'compute'],
    // Astro（D-69・D-103）: 記事は Workers Cache、マイページと記事を描く Worker が VPS の API を呼ぶ
    // Next.js の静的書き出し（D-80）: SPA と同じく、ブラウザ（Client Component）が VPS の API を呼ぶ
    frameworks: ['vite-spa', 'astro', 'nextjs-export'],
    as: 'same',
    label: `さくらの VPS: ${plan.toUpperCase()} に API と MySQL を置く（自前運用）`,
    note:
      `API を さくらの VPS ${plan.toUpperCase()}（東京）の Node に置き、DB は同じ VPS の MySQL。api のサブドメインは Cloudflare の DNS で VPS に直接向ける（プロキシしない DNS だけのレコードで、CDN を通らない）。` +
      '静的なファイル（SPA のシェル・Next.js の静的書き出しの記事のページ）・JS・CSS と画像は Cloudflare から配る。Astro のページ（マイページ・キャッシュを描き直す記事）は Worker が描き、その中から VPS の API を呼ぶ。月額は固定で転送量は無制限だが、回線（100 Mbps の共有）・CPU・メモリ・ディスクに上限があり、話題の集中も API の分が VPS に届く。' +
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

/** 他の事業者の部品の選択肢（規則で許した土台だけ）。 */
export const CROSS_COMPONENTS: readonly ComponentOption[] = CROSS_PARTS.flatMap(
  (p) => partOptions(p),
);
