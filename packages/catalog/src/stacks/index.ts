// MVP の構成（prd/README のスコープ・prd/06 §4）。Next.js 系のアプリを 3 つのホストに載せた形。
// 振る舞いは estimator の ComponentKind、ここはノードの値と課金先のメーターの対応だけを持つ。
// GD-4（D-24・prd/07 §11）: 構成は役割ごとのスロットの選択（部品）から組み立てる。完成品は「既定の選択」。
import type { ArchitectureInput, RequestClass, WorkloadInput } from 'estimator';
import { browserCallsApi, type FrameworkId } from '../frameworks/index.ts';
import {
  AWS_COMPONENTS,
  AWS_DEFAULT_CHOICES,
  AWS_STACK_DEFS,
  composeAws,
} from './aws.ts';
import {
  composeOpenNext,
  OPENNEXT_COMPONENTS,
  OPENNEXT_DEFAULT_CHOICES,
  OPENNEXT_STACK_DEFS,
} from './opennext.ts';
import {
  composeNetlify,
  NETLIFY_COMPONENTS,
  NETLIFY_DEFAULT_CHOICES,
  NETLIFY_STACK_DEFS,
} from './netlify.ts';
import {
  composeGcp,
  GCP_COMPONENTS,
  GCP_DEFAULT_CHOICES,
  GCP_STACK_DEFS,
} from './gcp.ts';
import { withBackups } from './backups.ts';
import { EMAIL_COMPONENTS, withEmail } from './email.ts';
import { withLogs } from './logs.ts';
import { vpsNode } from './sakura.ts';
import {
  apiPlacedElsewhere,
  applyCross,
  applyCrossApi,
  applyCrossDb,
  behaviorOf,
  CROSS_COMPONENTS,
  hostsOf,
  type CrossLink,
} from './cross.ts';

export type Platform =
  | 'cloudflare'
  | 'vercel'
  | 'sakura'
  | 'aws'
  | 'aws-opennext'
  | 'netlify'
  | 'gcp';
/** 部品の事業者（土台の事業者に加えて、部品だけを出す事業者。Neon は DB の部品だけ・D-77、Resend はメール送信の部品だけ・D-95）。 */
export type ComponentProvider = Platform | 'neon' | 'resend';
export type SlotId =
  | 'isrCache'
  | 'images'
  | 'api'
  | 'db'
  | 'realtime'
  | 'frontCdn'
  | 'ogp'
  | 'apiCache'
  | 'cdnPlan'
  | 'cdnInvalidation'
  | 'minInstances'
  | 'dbBackup'
  | 'email';
export type Choices = Partial<Record<SlotId, string>>;

/** 事業者 × プラン。完成品の構成は、これに既定の選択を当てたもの。 */
export type StackDef = {
  id: string;
  platform: Platform;
  plan: string;
  name: string;
  /** 自分で組む構成（OpenNext など。ゲームでは維持の手間がかかる。D-63）。 */
  assembled?: boolean;
  /** コンテナで動かすマネージドの構成（Cloud Run。ゲームでは小さな維持の手間がかかる。D-88）。 */
  containerized?: boolean;
};

export const STACK_DEFS: readonly StackDef[] = [
  {
    id: 'cloudflare-vinext-free',
    platform: 'cloudflare',
    plan: 'free',
    name: 'Cloudflare Free + vinext',
  },
  {
    id: 'cloudflare-vinext-paid',
    platform: 'cloudflare',
    plan: 'paid',
    name: 'Cloudflare Paid + vinext',
  },
  {
    id: 'vercel-supabase-hobby',
    platform: 'vercel',
    plan: 'hobby',
    name: 'Vercel Hobby + Supabase Free',
  },
  {
    id: 'vercel-supabase-pro',
    platform: 'vercel',
    plan: 'pro',
    name: 'Vercel Pro + Supabase Pro',
  },
  {
    id: 'sakura-vps-2gb',
    platform: 'sakura',
    plan: '2gb',
    name: 'さくらの VPS 2GB（東京）',
  },
  // SLA の出来事のため（D-24）。添字を変えないよう後ろに足す
  {
    id: 'sakura-vps-4gb',
    platform: 'sakura',
    plan: '4gb',
    name: 'さくらの VPS 4GB（東京）',
  },
  // AWS（prd/11 段 1・D-50）。構成は stacks/aws.ts
  ...AWS_STACK_DEFS,
  // AWS の 2 つ目（OpenNext・D-63）。構成は stacks/opennext.ts
  ...OPENNEXT_STACK_DEFS,
  // Netlify（D-71）。構成は stacks/netlify.ts
  ...NETLIFY_STACK_DEFS,
  // Google Cloud（D-88）。構成は stacks/gcp.ts
  ...GCP_STACK_DEFS,
];

/** スロットの部品（catalog のデータ）。当たりうる前提は前提の id の前方一致で挙げる（選ぶ前に出す）。 */
export type ComponentOption = {
  id: string;
  slot: SlotId;
  platform: ComponentProvider;
  label: string;
  /** 選ぶ前に出す説明（何が変わるか）。 */
  note: string;
  /** 学びのための不適切な選択（D-17 G-04）。 */
  inappropriate?: boolean;
  premiseRefs: string[];
  /**
   * オンデマンド ISR（即時反映）の要件を満たせるか（D-32）。fact は理由の前提（provider:planId:factId）。
   * 省略は要件に関係しない。
   */
  onDemandIsr?: { ok: boolean; fact: string };
  /** この部品を選べるフレームワーク（省略はすべて。ISR のキャッシュは Next.js だけ・OGP の前処理は SPA だけ。prd/10）。 */
  frameworks?: FrameworkId[];
  /** この部品を差せる土台の事業者（省略は platform だけ）。他の事業者の部品は cross.ts の CROSS_PAIRS で許した組だけ（D-52）。 */
  hosts?: Platform[];
  /** 土台と別の事業者のときの接続の形（D-52・prd/11 §2.2）。 */
  link?: CrossLink;
};

export const SLOT_LABELS: Record<SlotId, string> = {
  isrCache: 'ISR のキャッシュ',
  images: '画像',
  api: 'API の置き場',
  db: 'DB',
  realtime: 'リアルタイム',
  frontCdn: '前段の CDN',
  ogp: 'SNS のカード（OGP）',
  apiCache: 'API の応答のキャッシュ',
  cdnPlan: 'CDN の料金のプラン',
  cdnInvalidation: 'CDN の無効化のまとめ方',
  minInstances: '最小インスタンス数',
  dbBackup: 'DB のバックアップ',
  email: 'メール送信',
};

const BASE_COMPONENTS: readonly ComponentOption[] = [
  // Cloudflare
  {
    id: 'kv',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'cloudflare',
    label: 'KV',
    note: '閲覧のたびに Worker が KV を読み、再生成で書く。KV の書き込みは他の拠点で見えるまで 60 秒以上かかることがある',
    premiseRefs: ['pool:cloudflare:workers-paid:paid-kv-writes'],
    onDemandIsr: { ok: false, fact: 'cloudflare:workers-paid:kv-propagation' },
  },
  {
    id: 'r2',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'cloudflare',
    label: 'R2（自作のアダプター）',
    note: '閲覧で R2 を読み（Class B）、再生成で書く（Class A）。vinext に R2 を ISR の置き場にする公式のアダプターは見当たらない（README）ので、キャッシュの処理は自作になる。R2 は強い整合なので、書けばすぐ全世界で見える',
    premiseRefs: [
      'pool:cloudflare:r2-standard',
      'fact:cloudflare:r2-standard:',
    ],
    onDemandIsr: {
      ok: true,
      fact: 'cloudflare:r2-standard:strong-consistency',
    },
  },
  {
    id: 'workers-cache',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'cloudflare',
    label: 'Workers Cache（タグでパージ）',
    note: 'vinext の workersCacheCdnAdapter。ISR のページを拠点ごとの Workers Cache から返し、再検証はタグでパージする。Cache API の料金は記載なし（このモデルでは費用なし）。拠点ごとのキャッシュなので、ヒット率が下がって再生成が増える分は計算に入れていない',
    premiseRefs: ['fact:cloudflare:workers-paid:workers-cache'],
    onDemandIsr: { ok: true, fact: 'cloudflare:workers-paid:workers-cache' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'cloudflare',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事も毎回 SSR する。Worker のリクエスト数は変わらない。CPU と D1 の読み取りは、再検証の間隔とページあたりの閲覧しだいで増える（閲覧が薄いと ISR の効きは小さい）。記事は常に新しい',
    premiseRefs: [
      'limit:cloudflare:workers-free:cpu-ms-per-request',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
    ],
  },
  {
    id: 'images',
    slot: 'images',
    platform: 'cloudflare',
    label: 'Images（閲覧のときに変換）',
    note: '一意な変換（種類 × サイズ違い）を月ごとに数える',
    premiseRefs: ['pool:cloudflare:images-paid:images-transformations'],
  },
  {
    id: 'r2-variants',
    slot: 'images',
    platform: 'cloudflare',
    label: '投稿のときにサイズ違いを作って R2 に置く',
    note: '変換は投稿のときに Images で 1 回だけ（投稿数 × サイズ違い）',
    premiseRefs: ['pool:cloudflare:images-paid:images-transformations'],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'cloudflare',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）をそのまま配る。R2 は転送量に課金しないので費用は増えないが、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: ['fact:cloudflare:r2-standard:egress'],
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'cloudflare',
    label: '投稿のときに一律で縮めて置く',
    note: '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて置き、原本は残さない。変換のサービスの費用はかからず、保存量も小さい。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）',
    premiseRefs: [],
  },
  {
    id: 'd1',
    slot: 'images',
    platform: 'cloudflare',
    label: 'D1 に BLOB で置く',
    note: '画像を D1 の行に置き、Worker が読み出して配る',
    inappropriate: true,
    premiseRefs: [
      'limit:cloudflare:workers-paid:d1-db-size',
      'limit:cloudflare:workers-free:d1-db-size',
      'fact:cloudflare:workers-paid:d1-row-size',
    ],
  },
  {
    id: 'd1',
    slot: 'db',
    platform: 'cloudflare',
    label: 'D1',
    note: 'SQLite。1 データベース 10 GB まで',
    premiseRefs: ['limit:cloudflare:workers-paid:d1-db-size'],
  },
  {
    id: 'kv',
    slot: 'db',
    platform: 'cloudflare',
    label: 'KV を DB 代わりに',
    note: '問い合わせを KV の読み取り、行の書き込みを KV の書き込みにする',
    inappropriate: true,
    premiseRefs: [
      'limit:cloudflare:workers-paid:kv-same-key-writes',
      'fact:cloudflare:workers-paid:kv-propagation',
      'pool:cloudflare:workers-paid:paid-kv-writes',
    ],
  },
  {
    id: 'hyperdrive',
    slot: 'db',
    platform: 'cloudflare',
    label: 'Hyperdrive 経由で Supabase（Postgres）',
    note: 'DB だけ Supabase に置く（事業者をまたぐ例外の 1 組・D-24）。往復の遅延は計算しない',
    premiseRefs: [
      'pool:cloudflare:hyperdrive-free',
      'fact:cloudflare:hyperdrive-paid:queries',
      'fact:supabase:pro-micro:compute',
    ],
  },
  {
    id: 'none',
    slot: 'realtime',
    platform: 'cloudflare',
    label: 'なし',
    note: 'リアルタイムの機能を持たない',
    premiseRefs: [],
  },
  {
    id: 'durable-objects',
    slot: 'realtime',
    platform: 'cloudflare',
    label: 'Durable Objects（休止する WebSocket）',
    note: '受信メッセージは 20 件で 1 リクエスト。休止中は実行時間を課金しない',
    premiseRefs: [
      'pool:cloudflare:durable-objects-paid',
      'pool:cloudflare:durable-objects-free',
    ],
  },
  // Vercel の DB（D-77）。既定は Supabase（構成の名前の DB）。Neon（従量の Postgres）は cross.ts の他の事業者の部品
  {
    id: 'supabase',
    slot: 'db',
    platform: 'vercel',
    label: 'Supabase（Postgres）',
    note: 'Hobby は Supabase Free、Pro は Supabase Pro（月の基本料つき・Micro のサーバーが常に動く）。関数から接続のプール（pooler）でつなぐ',
    premiseRefs: [
      'fact:supabase:pro-micro:compute',
      'limit:supabase:pro-micro:pooler-connections',
      'limit:supabase:free:db-size',
    ],
  },
  // Vercel・VPS は共通の役割だけ（G-04）
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'vercel',
    label: 'ISR の永続ストレージ',
    note: 'ISR のページは CDN が返す。再検証すると全リージョンのキャッシュが 300ms 以内に更新される',
    premiseRefs: [],
    onDemandIsr: { ok: true, fact: 'vercel:pro:isr-purge' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'vercel',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回関数まで届く。記事は常に新しい',
    premiseRefs: [
      'credit:vercel:pro:usage-credit',
      'fact:vercel:pro:active-cpu',
    ],
  },
  // Next.js の静的書き出しでは next/image の既定のローダーが使えない（D-80）ので、閲覧のときの変換は選べない
  {
    id: 'default',
    slot: 'images',
    platform: 'vercel',
    frameworks: ['nextjs', 'vite-spa', 'astro'],
    label: '画像の最適化',
    note: '閲覧のときに変換する',
    premiseRefs: [],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'vercel',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）をそのまま配る。転送量（Fast Data Transfer）が大きく増え、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: ['credit:vercel:pro:usage-credit'],
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'vercel',
    label: '投稿のときに一律で縮めて置く',
    note: '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて置き、原本は残さない。変換のサービスの費用はかからず、保存量も小さい。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）',
    premiseRefs: [],
  },
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'sakura',
    label: 'ディスク',
    note: 'next start のキャッシュをディスクに置く（1 台・永続ディスクなら自動で動く）',
    premiseRefs: [],
    onDemandIsr: { ok: true, fact: 'sakura-vps:2gb-tokyo:next-fs-cache' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'sakura',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事も毎回 SSR する。CPU を使う。記事は常に新しい',
    premiseRefs: ['host:cpu'],
  },
  {
    id: 'default',
    slot: 'images',
    platform: 'sakura',
    frameworks: ['nextjs', 'vite-spa', 'astro'],
    label: 'ホストで変換',
    note: '閲覧のときに VPS の CPU で変換する',
    premiseRefs: [],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'sakura',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）をそのまま配る。共有回線を大きく使い、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: ['host:line'],
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'sakura',
    label: '投稿のときに一律で縮めて置く',
    note: '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて置き、原本は残さない。変換のサービスの費用はかからず、保存量も小さい。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）',
    premiseRefs: [],
  },
];

// さくらの VPS の前段の CDN（D-31・D-91）。Cloudflare のプロキシ（オレンジ雲・Free）を前に置く（事業者をまたぐ構成の最初の事例・D-20）。
// Free は転送量で課金せず、ヒットした分だけ VPS の回線（100 Mbps）と nginx の CPU に届かなくなる
const SAKURA_FRONT_CDN: ComponentOption[] = [
  {
    id: 'none',
    slot: 'frontCdn',
    platform: 'sakura',
    label: 'なし',
    note: 'すべてのリクエストを VPS（nginx）が受ける',
    premiseRefs: [],
  },
  {
    id: 'static',
    slot: 'frontCdn',
    platform: 'sakura',
    label: 'Cloudflare（静的と画像だけ）',
    note: 'DNS をプロキシ（オレンジ雲）にし、静的なファイルと変換済みの画像の大部分を CDN が返す（VPS の回線と CPU が減り、Free は転送量で課金しない）。HTML は既定でキャッシュされないので VPS のまま。/_next/image（拡張子を持たない URL）は Cache Rules で対象にする',
    premiseRefs: [
      'fact:cloudflare:cdn-free:html-not-cached',
      'fact:cloudflare:cdn-free:free-bandwidth',
      'fact:cloudflare:cdn-free:pictures-terms',
      'host:',
    ],
  },
  {
    id: 'html',
    slot: 'frontCdn',
    platform: 'sakura',
    label: 'Cloudflare（HTML も。Cache Rules）',
    note: 'Cache Rules で HTML もキャッシュの対象にし、記事のページも CDN が返す（ログインの要るページは条件で外す）。CDN は Next.js の s-maxage（再検証の間隔）に従うので、時間の再検証では更新が最大で間隔の約 2 倍遅れて見える。オンデマンドの再検証・ビルドでは、更新のたびに Free の API でそのページのキャッシュを消す（prefix・タグは 1 分 5 回・1 回 100 件まで）ので遅れない',
    onDemandIsr: { ok: true, fact: 'cloudflare:cdn-free:purge-free' },
    premiseRefs: [
      'fact:cloudflare:cdn-free:cache-rules-html',
      'fact:cloudflare:cdn-free:next-isr-headers',
      'fact:cloudflare:cdn-free:purge-free',
      'fact:cloudflare:cdn-free:free-bandwidth',
      'fact:cloudflare:cdn-free:pictures-terms',
      'host:',
    ],
  },
];

/**
 * SPA の SNS のカード（OGP）の前処理（prd/10 F-07）。記事の URL のページ遷移だけサーバーで HTML にメタタグを差し込む。
 * カードが出るかどうかの効き方（話題の倍率）はゲーム上の仮定。課金と Free の 429 は Cloudflare の公式の文書。
 */
const SPA_OGP: ComponentOption[] = (
  [
    [
      'cloudflare',
      'シェルを返す前に Worker（run_worker_first）が記事のメタタグを差し込む。シェルの読み込みが Worker の起動として課金され、Free の上限を超えると 429',
      [
        'fact:cloudflare:workers-free:run-worker-first',
        'fact:cloudflare:workers-paid:run-worker-first',
        'pool:cloudflare:workers-free:free-requests',
      ],
    ],
    [
      'vercel',
      'シェルを CDN から返さず、関数が記事のメタタグを差し込んで返す。シェルの読み込みが関数の起動になる',
      ['credit:vercel:pro:usage-credit', 'fact:vercel:pro:active-cpu'],
    ],
    [
      'sakura',
      'nginx でなく Node がシェルに記事のメタタグを差し込んで返す（この CPU は数えていない・仮定）',
      ['host:cpu'],
    ],
  ] as const
).flatMap(([platform, note, refs]): ComponentOption[] => [
  {
    id: 'none',
    slot: 'ogp',
    platform,
    frameworks: ['vite-spa'],
    label: '前処理しない（全ページ同じカード）',
    note: 'シェルのメタタグは全ページ同じ。記事ごとのカードは出ない（ゲーム上の仮定: SNS の話題が伸びにくい）',
    premiseRefs:
      platform === 'cloudflare'
        ? [
            'fact:cloudflare:workers-free:static-assets',
            'fact:cloudflare:workers-paid:static-assets',
          ]
        : [],
  },
  {
    id: 'prerender',
    slot: 'ogp',
    platform,
    frameworks: ['vite-spa'],
    label: 'OGP の前処理',
    note,
    premiseRefs: [...refs],
  },
]);

/**
 * SPA の API の応答のキャッシュ（D-37・prd/10 §8）。対象は全員に同じ中身（記事）を返すデータの API だけで、
 * 個人化された API（マイページ・ログインの要る API・書き込み）は対象にしない。期間（s-maxage）は ISR の間隔と同じ設定で選ぶ。
 * ヒット率は固定値にせず、閲覧の密度 × 期間から出す（ISR の再生成と同じ式。prd/04 §2）。
 */
const SPA_API_CACHE: ComponentOption[] = [
  ...(['cloudflare', 'vercel', 'sakura'] as const).map(
    (platform): ComponentOption => ({
      id: 'none',
      slot: 'apiCache',
      platform,
      frameworks: ['vite-spa'],
      label: 'なし',
      note: '記事の中身の API を毎回処理して DB を読む。記事は常に新しい',
      premiseRefs: [],
    }),
  ),
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'cloudflare',
    frameworks: ['vite-spa'],
    label: 'Workers Cache（Worker の前のキャッシュ）',
    note: 'Cache-Control に従い、ヒットは Worker を動かさずに返す（CPU と D1 の読み取りが減る）。有効にすると、キャッシュから返したものも静的アセットも、Worker へのリクエストはすべて課金される',
    premiseRefs: [
      'fact:cloudflare:workers-free:workers-cache-front',
      'fact:cloudflare:workers-paid:workers-cache-front',
      'pool:cloudflare:workers-free:free-requests',
      'pool:cloudflare:workers-paid:paid-requests',
    ],
  },
  {
    id: 'cache-api',
    slot: 'apiCache',
    platform: 'cloudflare',
    frameworks: ['vite-spa'],
    label: 'Workers の Cache API（コードの中）',
    note: 'Worker が拠点のキャッシュを読み、ヒットなら D1 を読まずに返す。Worker は毎回動くのでリクエスト数は減らず、CPU と D1 の読み取りが減る。キャッシュは拠点ごとで複製されない（拠点に分かれてヒット率が下がる分は計算に入れていない）',
    premiseRefs: [
      'fact:cloudflare:workers-free:cache-api-local',
      'fact:cloudflare:workers-paid:cache-api-local',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
    ],
  },
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'vercel',
    frameworks: ['vite-spa'],
    label: 'CDN のキャッシュ（s-maxage）',
    note: '記事の中身の API の応答に Cache-Control: s-maxage を付け、ヒットは CDN が返す（関数の起動・CPU・Fast Origin Transfer が減る。CDN Requests と Fast Data Transfer は残る）。キャッシュはリージョンごと（分かれてヒット率が下がる分は計算に入れていない）',
    premiseRefs: [
      'fact:vercel:hobby:cdn-cache-functions',
      'fact:vercel:pro:cdn-cache-functions',
      'credit:vercel:pro:usage-credit',
    ],
  },
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'sakura',
    frameworks: ['vite-spa'],
    label: '前段の CDN でキャッシュ（s-maxage）',
    note: '前段の CDN（Cloudflare）が記事の中身の API の応答を返し、VPS の CPU と回線が減る。前段の CDN が要る。Cloudflare は既定で JSON をキャッシュしないので、Cache Rules で API のパスを対象にする前提（推測）',
    premiseRefs: ['fact:cloudflare:cdn-free:html-not-cached', 'host:cpu'],
  },
];

/**
 * SPA の API の置き場（prd/10 §3・F-10〜F-13・D-65）。既定は同じ事業者に同居（段 1 の形）。他の事業者に置く部品は
 * cross.ts の CROSS_COMPONENTS（CROSS_PAIRS で許した組だけ）。DB は API と同じ事業者に置く（またぐ往復を API と DB の間に作らない）。
 * さくらの VPS の構成は API を他の事業者に置く組を入れていないので、スロットを出さない（同居だけ。VPS を API の置き場として
 * 他の構成に差す組は cross.ts。D-67）。
 */
const SPA_API_SAME: ComponentOption[] = (
  [
    [
      'cloudflare',
      'シェルを配るのと同じ Worker に API を置き、DB はこの構成の DB の部品（D1 など）を binding で使う。同じドメインなので CORS の設定は要らない',
    ],
    [
      'vercel',
      '同じプロジェクトの関数（Vercel Functions）に API を置き、DB は Supabase。同じドメインなので CORS の設定は要らない',
    ],
    [
      'aws',
      'CloudFront の後ろの API Gateway（HTTP API）+ Lambda に API を置き、DB はこの構成の DB の部品。同じ CloudFront のドメインなので CORS の設定は要らない',
    ],
  ] as const
).map(([platform, note]): ComponentOption => ({
  id: 'same',
  slot: 'api',
  platform,
  frameworks: ['vite-spa', 'nextjs-export'],
  label: '同じ事業者（同居）',
  note,
  premiseRefs: [],
}));

/**
 * Next.js の API・DB の置き場（F-14・D-67）。Next.js は SSR・ISR の再生成・Route Handler がサーバーの側で DB を読むので、
 * 既定は同じ事業者。他の事業者に置く部品は cross.ts の CROSS_COMPONENTS（Next.js のサーバーから別の事業者の API を呼ぶ形）。
 */
const NEXT_API_SAME: ComponentOption[] = (
  [
    [
      'vercel',
      'Next.js のサーバー（Vercel Functions）が同じ構成の Supabase を直接読む。API を別に立てない',
    ],
    [
      'aws',
      'Next.js のサーバー（Amplify の SSR）が同じ AWS の DB の部品を直接読む。API を別に立てない',
    ],
    [
      'aws-opennext',
      'Next.js のサーバーの関数（Lambda）が同じ AWS の DB の部品を直接読む。API を別に立てない',
    ],
  ] as const
).map(([platform, note]): ComponentOption => ({
  id: 'same',
  slot: 'api',
  platform,
  frameworks: ['nextjs'],
  label: '同じ事業者（同居）',
  note,
  premiseRefs: [],
}));

/**
 * Astro の API・DB の置き場（D-69）。Astro のアダプターで描くページ（マイページ）とエンドポイントがサーバーの側で DB を読むので、
 * 既定は同じ事業者。他の事業者に置く部品は cross.ts の CROSS_COMPONENTS（Vercel・VPS の Astro から Workers を呼ぶ・
 * Cloudflare の Astro + VPS の API）。AWS は Astro を載せない（D-68）。
 */
const ASTRO_API_SAME: ComponentOption[] = (
  [
    [
      'cloudflare',
      'Astro の Worker（アダプター）が同じ構成の DB の部品を binding で直接読む。API を別に立てない',
    ],
    [
      'vercel',
      'Astro のサーバー（Vercel Functions）が同じ構成の Supabase を直接読む。API を別に立てない',
    ],
    [
      'sakura',
      'Astro の Node（@astrojs/node）が同じ VPS の MySQL を直接読む。API を別に立てない',
    ],
  ] as const
).map(([platform, note]): ComponentOption => ({
  id: 'same',
  slot: 'api',
  platform,
  frameworks: ['astro'],
  label: '同じ事業者（同居）',
  note,
  premiseRefs: [],
}));

/**
 * DB のバックアップ（D-93・stacks/backups.ts）。どの事業者でも 2 択で、何が残り何に払うかは今の DB で決まる
 * （DB ごとの説明は backupStatus）。D1 のように既定で足りる・延ばせない DB では、ゲームはこのスロットを出さない。
 */
const BACKUP_NOTES: Record<Platform, { default: string; pitr: string }> = {
  cloudflare: {
    default:
      'D1 は Time Travel（Paid は 30 日・Free は 7 日）で任意の時点に戻せる（追加の費用なし）。Hyperdrive の先の Supabase Pro は日次のバックアップ 7 日分。API を AWS に置いたときの DynamoDB は PITR が無効',
    pitr: 'Hyperdrive の先の Supabase Pro に PITR（7 日）を付ける（月 約 $105。compute を Small に上げる）。API を AWS に置いたときの DynamoDB は PITR を有効にする（テーブルの大きさに $0.228 / GB 月）',
  },
  vercel: {
    default:
      'Supabase Pro は日次のバックアップ 7 日分（Free は無し）。Neon は履歴の窓 1 日（Free は 6 時間）',
    pitr: 'Supabase Pro に PITR（7 日・月 約 $105。compute を Small に上げる）、Neon Launch は履歴の窓を 7 日に（変更の量に $0.20 / GB 月）',
  },
  netlify: {
    default:
      'Supabase Pro は日次のバックアップ 7 日分（Free は無し）。Neon は履歴の窓 1 日（Free は 6 時間）',
    pitr: 'Supabase Pro に PITR（7 日・月 約 $105。compute を Small に上げる）、Neon Launch は履歴の窓を 7 日に（変更の量に $0.20 / GB 月）',
  },
  aws: {
    default:
      'DynamoDB の PITR は無効、Aurora は保持 1 日、RDS は保持 7 日（DB の容量までは無料）',
    pitr: 'DynamoDB の PITR を有効に（テーブルの大きさに $0.228 / GB 月）、Aurora は保持 7 日・RDS は 35 日に延ばす（DB の大きさを超えた分に課金）',
  },
  'aws-opennext': {
    default:
      'DynamoDB の PITR は無効、Aurora は保持 1 日、RDS は保持 7 日（DB の容量までは無料）',
    pitr: 'DynamoDB の PITR を有効に（テーブルの大きさに $0.228 / GB 月）、Aurora は保持 7 日・RDS は 35 日に延ばす（DB の大きさを超えた分に課金）',
  },
  gcp: {
    default:
      'Firestore の PITR は無効。Cloud SQL は自動バックアップ 7 つと PITR が既定で有効（使った量に $0.104 / GiB 月）',
    pitr: 'Firestore の PITR を有効に（7 日・DB の大きさに 約 $0.195 / GiB 月）',
  },
  sakura: {
    default:
      'さくらの VPS にバックアップの機能は無い。自分で取らなければ、壊れたときに戻せるものが無い',
    pitr: '日次のダンプとバイナリログを、さくらのオブジェクトストレージに自分で送る（7 日分・月 495 円から）。仕組みを作り、毎月見張る手間がかかる',
  },
};

const BACKUP_COMPONENTS: ComponentOption[] = (
  Object.keys(BACKUP_NOTES) as Platform[]
).flatMap((platform) => [
  {
    id: 'default',
    slot: 'dbBackup' as const,
    platform,
    label: '事業者の既定のまま',
    note: BACKUP_NOTES[platform].default,
    premiseRefs: [],
  },
  {
    id: 'pitr',
    slot: 'dbBackup' as const,
    platform,
    label: '保持を延ばす・PITR を付ける',
    note: BACKUP_NOTES[platform].pitr,
    premiseRefs: [],
  },
]);

export const COMPONENTS: readonly ComponentOption[] = [
  ...BASE_COMPONENTS,
  ...SAKURA_FRONT_CDN,
  ...SPA_OGP,
  ...SPA_API_CACHE,
  ...SPA_API_SAME,
  ...NEXT_API_SAME,
  ...ASTRO_API_SAME,
  ...AWS_COMPONENTS,
  ...OPENNEXT_COMPONENTS,
  ...NETLIFY_COMPONENTS,
  ...GCP_COMPONENTS,
  ...CROSS_COMPONENTS,
  ...BACKUP_COMPONENTS,
  ...EMAIL_COMPONENTS,
];

// SPA だけの部品（OGP の前処理・API の応答のキャッシュ）の既定はゲームの側（フレームワークの既定）が持つ。省略は「なし」
// DB のバックアップの既定はどの事業者も「事業者の既定のまま」（D-93）。メール送信の既定は構成の既定の送り先（D-95）
export const DEFAULT_CHOICES: Record<Platform, Choices> = {
  cloudflare: {
    isrCache: 'kv',
    images: 'images',
    db: 'd1',
    realtime: 'none',
    dbBackup: 'default',
    email: 'default',
  },
  vercel: {
    isrCache: 'default',
    images: 'default',
    db: 'supabase',
    dbBackup: 'default',
    email: 'default',
  },
  sakura: {
    isrCache: 'default',
    images: 'default',
    frontCdn: 'none',
    dbBackup: 'default',
    email: 'default',
  },
  aws: {
    ...AWS_DEFAULT_CHOICES,
    dbBackup: 'default',
    email: 'default',
  },
  'aws-opennext': {
    ...OPENNEXT_DEFAULT_CHOICES,
    dbBackup: 'default',
    email: 'default',
  },
  netlify: {
    ...NETLIFY_DEFAULT_CHOICES,
    dbBackup: 'default',
    email: 'default',
  },
  gcp: {
    ...GCP_DEFAULT_CHOICES,
    dbBackup: 'default',
    email: 'default',
  },
};

/**
 * Cache API でヒットを返すときの Worker の CPU（ms）。記事の ISR のページをキャッシュから返す CPU
 * （テンプレートの cachedServeCpuMs）と同じ値（ゲーム上の仮定）。
 */
const CACHE_API_HIT_CPU_MS = 2;

/** 選択で API の応答のキャッシュが効くか（SPA だけ。VPS は前段の CDN が要る）。 */
export function apiCacheActive(
  platform: Platform,
  choices: Choices,
  framework: FrameworkId | undefined,
): boolean {
  if (framework !== 'vite-spa') return false;
  const c = { ...DEFAULT_CHOICES[platform], ...choices };
  if (!c.apiCache || c.apiCache === 'none') return false;
  // API を他の事業者に置くと、この事業者の API の応答のキャッシュは効かない（選べない。D-65）
  if (apiPlacedElsewhere(c)) return false;
  return platform !== 'sakura' || (c.frontCdn ?? 'none') !== 'none';
}

/**
 * 事業者のスロットの部品（スロットの順）。framework を渡すと、そのフレームワークで選べる部品だけ
 * （省略はすべて。名前を引くだけのときなど）。
 */
export function componentsOf(
  platform: Platform,
  slot: SlotId,
  framework?: FrameworkId,
): ComponentOption[] {
  return COMPONENTS.filter(
    (c) =>
      hostsOf(c).includes(platform) &&
      c.slot === slot &&
      (framework === undefined ||
        c.frameworks === undefined ||
        c.frameworks.includes(framework)),
  );
}

export function stackDef(id: string): StackDef {
  const d = STACK_DEFS.find((s) => s.id === id);
  if (!d) throw new Error(`構成が無い: ${id}`);
  return d;
}

const withDefaults = (platform: Platform, choices: Choices = {}): Choices => ({
  ...DEFAULT_CHOICES[platform],
  ...choices,
});

/** 構成の組み立ての途中の形。ノードは id で重複を除いて足す。 */
class Builder {
  nodes: ArchNodeIn[] = [];
  add(...ns: ArchNodeIn[]) {
    for (const n of ns)
      if (!this.nodes.some((x) => x.id === n.id)) this.nodes.push(n);
  }
}
type ArchNodeIn = ArchitectureInput['nodes'][number];

/** 画像を変換のサービス・ホストで変換するか（最適化しない・投稿のときに一律で縮めるは変換しない。D-47）。 */
const transformsImages = (c: Choices) =>
  c.images !== 'none' && c.images !== 'resize';

/** Cloudflare Workers + D1 + R2 + KV + Images に vinext で載せる（D-08）。 */
function composeCloudflare(
  plan: 'free' | 'paid',
  choices: Choices,
  standby: Choices,
): ArchitectureInput {
  const workers = plan === 'free' ? 'workers-free' : 'workers-paid';
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  const b = new Builder();
  // 静的アセットは Workers を起動しないので無料・無制限（課金先なし）
  b.add(
    {
      id: 'assets',
      label: 'Workers 静的アセット',
      config: { kind: 'cdn', hitRate: { asset: 1, 'document-static': 1 } },
    },
    {
      id: 'worker',
      label: 'Worker（vinext）',
      config: {
        kind: 'function',
        // ⚠ 未確認: vinext の ISR の再生成は閲覧のリクエストの中で裏で走る（stale-while-revalidate）と仮定
        backgroundClasses: ['isr-revalidate'],
      },
      ...(choices.isrCache === 'workers-cache'
        ? { facts: ['workers-cache'] }
        : {}),
      billing: bill(workers, { requests: 'requests', 'cpu-ms': 'cpu-ms' }),
    },
  );
  const r2 = (storesImages: boolean): ArchNodeIn => ({
    id: 'r2',
    label: 'R2',
    config: {
      kind: 'object-storage',
      ...(storesImages ? {} : { storesImages: false }),
    },
    billing: bill('r2-standard', {
      'storage-gb-month': 'storage',
      'object-writes': 'class-a',
      'object-reads': 'class-b',
      'egress-gb': 'egress',
    }),
  });
  const d1 = (storesImages: boolean): ArchNodeIn => ({
    id: 'd1',
    label: storesImages ? 'D1（画像も置く）' : 'D1',
    config: {
      kind: 'sql-db',
      ...(storesImages ? { storesImages: true } : {}),
      // DB が別の部品のときは、画像だけを置く D1（アプリの DB の保存量を載せない。OCL-65B45666）
      // 差し替えの途中で D1 へ移す（standby）ときは、移行先としてアプリの DB も載せる（OCL-D3907993）
      ...(storesImages && choices.db !== 'd1' && standby.db !== 'd1'
        ? { storesDb: false }
        : {}),
    },
    ...(storesImages ? { facts: ['d1-row-size'] } : {}),
    billing: bill(workers, {
      'rows-read': 'd1-rows-read',
      'rows-written': 'd1-rows-written',
      ...(plan === 'paid' ? { 'storage-gb-month': 'd1-storage' } : {}),
    }),
  });
  const imagesInR2 = choices.images !== 'd1';
  const imagesInD1 = choices.images === 'd1';

  // ISR のキャッシュ
  const cacheNodes = (opt: string | undefined): ArchNodeIn[] =>
    opt === 'kv'
      ? [
          {
            id: 'kv',
            label: 'KV（ISR のキャッシュ）',
            config: { kind: 'kv' },
            billing: bill(workers, {
              'kv-reads': 'kv-reads',
              'kv-writes': 'kv-writes',
            }),
          },
        ]
      : opt === 'r2'
        ? [r2(imagesInR2)]
        : [];
  // DB
  const dbNodes = (opt: string | undefined): ArchNodeIn[] =>
    opt === 'kv'
      ? [
          {
            id: 'kv-db',
            label: 'KV（DB の代わり）',
            // 記事ごとのコメント数・いいね数など、同じキーに集中する書き込みの割合（仮定）
            config: { kind: 'kv', mode: 'db', hotKeyShare: 0.2 },
            facts: ['kv-propagation'],
            billing: bill(workers, {
              'kv-reads': 'kv-reads',
              'kv-writes': 'kv-writes',
            }),
          },
        ]
      : opt === 'hyperdrive'
        ? [
            {
              id: 'hyperdrive',
              label: 'Hyperdrive',
              config: { kind: 'db-proxy' },
              billing: bill(
                plan === 'free' ? 'hyperdrive-free' : 'hyperdrive-paid',
                { queries: 'queries' },
              ),
            },
            {
              id: 'supabase',
              label:
                plan === 'free' ? 'Supabase Free' : 'Supabase Pro（Micro）',
              config: { kind: 'managed-db' },
              billing: {
                accountId: 'supabase',
                provider: 'supabase',
                planId: plan === 'free' ? 'free' : 'pro-micro',
                meters:
                  plan === 'free'
                    ? { 'egress-gb': 'egress' }
                    : {
                        'instance-hours': 'compute',
                        'egress-gb': 'egress',
                        'storage-gb-month': 'disk',
                      },
              },
            },
          ]
        : [d1(imagesInD1)];
  const dbPath = (opt: string | undefined) => dbNodes(opt).map((n) => n.id);

  b.add(...cacheNodes(choices.isrCache), ...dbNodes(choices.db));
  // 画像
  if (imagesInD1) b.add(d1(true));
  else {
    b.add(
      {
        id: 'r2-cache',
        label: 'R2 公開バケットのキャッシュ',
        config: { kind: 'cdn', hitRate: { 'image-read': 0.9 } },
      },
      r2(true),
    );
  }
  if (transformsImages(choices))
    b.add({
      id: 'images',
      label: 'Images（バインディング）',
      config: { kind: 'image-optimizer' },
      billing: bill(plan === 'free' ? 'images-free' : 'images-paid', {
        'image-transformations': 'transformations',
      }),
    });
  // リアルタイム
  if (choices.realtime === 'durable-objects')
    b.add({
      id: 'do',
      label: 'Durable Objects',
      // 受信メッセージ 20 件で 1 リクエスト・128 MB として数える（doPricing）
      config: {
        kind: 'durable-object',
        messagesPerRequest: 20,
        memoryGB: 0.128,
      },
      billing: bill(
        plan === 'free' ? 'durable-objects-free' : 'durable-objects-paid',
        {
          requests: 'requests',
          'gb-seconds': 'duration',
          'rows-read': 'rows-read',
          'rows-written': 'rows-written',
        },
      ),
    });
  // 差し替えの途中（新旧の両方を動かしている間）の新しい部品。経路に載せず、保存量・常時動く分だけが課金される
  for (const [slot, opt] of Object.entries(standby) as [SlotId, string][]) {
    if (slot === 'db') b.add(...dbNodes(opt));
    if (slot === 'isrCache') b.add(...cacheNodes(opt));
  }

  const cache =
    choices.isrCache === 'kv'
      ? ['kv']
      : choices.isrCache === 'r2'
        ? ['r2']
        : [];
  // Workers Cache: 課金されるノードを持たない（Cache API の料金は記載なし）。閲覧は Worker が拠点のキャッシュから返す
  const workersCache = choices.isrCache === 'workers-cache';
  const db = dbPath(choices.db);
  const routes: Partial<Record<RequestClass, string[]>> = {
    'document-static': ['assets'],
    asset: ['assets'],
    'document-ssr': ['worker', ...db],
    // vinext の ISR は KV のキャッシュハンドラ: 閲覧のたびに Worker が動き KV を読む（spike 所見 4）
    ...(cache.length
      ? {
          'document-isr': ['worker', ...cache],
          'isr-revalidate': ['worker', ...cache, ...db],
        }
      : workersCache
        ? {
            'document-isr': ['worker'],
            'isr-revalidate': ['worker', ...db],
          }
        : {}),
    api: ['worker', ...db],
    'image-read': imagesInD1 ? ['worker', 'd1'] : ['r2-cache', 'r2'],
    'image-write': imagesInD1 ? ['worker', 'd1'] : ['worker', 'r2'],
    // 投稿のときに作るサイズ違いは R2 に書き込む（変換 1 件 = 書き込み 1 件。OCL-F3098083）
    ...(choices.images === 'r2-variants'
      ? { 'image-transform': ['images', 'r2'] }
      : transformsImages(choices)
        ? { 'image-transform': ['images'] }
        : {}),
    ...(choices.realtime === 'durable-objects'
      ? { 'realtime-connect': ['worker', 'do'], 'realtime-message': ['do'] }
      : {}),
  };
  return {
    id: `cloudflare-vinext-${plan}`,
    name: `Cloudflare ${plan === 'free' ? 'Free' : 'Paid'} + vinext`,
    nodes: b.nodes,
    routes,
  };
}

/** Vercel の CDN の画像のヒット率（仮定。最適化した画像・Blob の画像で同じ値）。 */
const IMAGE_CDN_HIT_RATE = 0.9;

/** Vercel に Next.js をネイティブで載せ、DB は Supabase。 */
function composeVercel(
  plan: 'hobby' | 'pro',
  choices: Choices,
): ArchitectureInput {
  const v = (meters: Record<string, string>) => ({
    accountId: 'vercel',
    provider: 'vercel',
    planId: plan,
    meters,
  });
  const isr = choices.isrCache !== 'none';
  const optimize = transformsImages(choices);
  const nodes: ArchNodeIn[] = [
    {
      id: 'cdn',
      label: 'Vercel CDN',
      config: {
        kind: 'cdn',
        hitRate: {
          asset: 1,
          'document-static': 1,
          'image-read': IMAGE_CDN_HIT_RATE,
        },
        // ISR のページのヒット率は固定値にせず、再生成の数と同じ式（閲覧の密度 × 再検証の間隔）から出す（D-37）
        ttlClasses: ['document-isr'],
        // Fast Origin Transfer は Functions・Middleware・Blob・Data Cache（ISR）で発生（画像最適化は挙がっていない）
        originClasses: ['document-ssr', 'document-isr', 'api'],
      },
      billing: v({
        requests: 'cdn-requests',
        'egress-gb': 'fast-data-transfer',
        'origin-transfer-gb': 'fast-origin-transfer',
      }),
    },
    {
      id: 'fn',
      label: 'Vercel Functions（Fluid）',
      config: { kind: 'function', memoryGB: 2, concurrency: 1 },
      billing: v({
        invocations: 'invocations',
        'cpu-ms': 'active-cpu',
        'memory-gb-hours': 'provisioned-memory',
      }),
    },
    ...(isr
      ? [
          {
            id: 'isr',
            label: 'ISR の永続ストレージ',
            config: { kind: 'isr-store', unitKB: 8, changedRate: 0.1 },
            billing: v({
              'isr-reads': 'isr-reads',
              'isr-writes': 'isr-writes',
            }),
          } as ArchNodeIn,
        ]
      : []),
    ...(optimize
      ? [
          {
            id: 'image',
            label: '画像の最適化',
            // CDN の miss だけが届くので、届いた読み取りはすべて共有キャッシュまで行く
            config: { kind: 'image-optimizer', unitKB: 8, cacheMissRate: 1 },
            billing: v({
              'image-transformations': 'image-transformations',
              'image-cache-reads': 'image-cache-reads',
              'image-cache-writes': 'image-cache-writes',
            }),
          } as ArchNodeIn,
        ]
      : []),
    // 画像の原本の置き場所は Vercel Blob（公開のストア。D-46）。保存量・Advanced Operations（アップロード）・
    // Simple Operations・Blob Data Transfer で課金する。最適化しない画像は、ブラウザが Blob の URL から直接読む:
    // CDN Requests と Blob Data Transfer はヒットも含む全件、Simple Operations と Fast Origin Transfer は miss だけ
    // （公式の料金の例どおり。Fast Data Transfer にはならない。OCL-2AE853BD）。ヒット率は画像の CDN のヒット率と同じ
    {
      id: 'blob',
      label: 'Vercel Blob（画像の原本）',
      config: { kind: 'object-storage', cdnHitRate: IMAGE_CDN_HIT_RATE },
      billing: v({
        'storage-gb-month': 'blob-storage',
        'object-writes': 'blob-advanced-operations',
        'object-reads': 'blob-simple-operations',
        'egress-gb': 'blob-data-transfer',
        requests: 'cdn-requests',
        'origin-transfer-gb': 'fast-origin-transfer',
      }),
    },
    {
      id: 'db',
      label: plan === 'hobby' ? 'Supabase Free' : 'Supabase Pro（Micro）',
      config: { kind: 'managed-db' },
      billing: {
        accountId: 'supabase',
        provider: 'supabase',
        planId: plan === 'hobby' ? 'free' : 'pro-micro',
        meters:
          plan === 'hobby'
            ? { 'egress-gb': 'egress' }
            : {
                'instance-hours': 'compute',
                'egress-gb': 'egress',
                'storage-gb-month': 'disk',
              },
      },
    },
  ];
  return {
    id: `vercel-supabase-${plan}`,
    name:
      plan === 'hobby'
        ? 'Vercel Hobby + Supabase Free'
        : 'Vercel Pro + Supabase Pro',
    nodes,
    routes: {
      'document-static': ['cdn'],
      asset: ['cdn'],
      'document-ssr': ['cdn', 'fn', 'db'],
      ...(isr
        ? {
            'document-isr': ['cdn', 'isr'],
            'isr-revalidate': ['fn', 'isr', 'db'],
          }
        : {}),
      api: ['cdn', 'fn', 'db'],
      // 最適化しない画像は Blob の URL から直接（CDN のノードを通さず、Blob のノードが配信を数える。OCL-2AE853BD）
      'image-read': optimize ? ['cdn', 'image'] : ['blob'],
      'image-write': ['fn', 'blob'],
      ...(optimize ? { 'image-transform': ['image'] } : {}),
    },
  };
}

/** さくらの VPS に nginx・next start・MySQL を同居させる（D-13・D-24）。ホストのノードは stacks/sakura.ts。 */
function composeSakura(
  plan: '2gb' | '4gb',
  storageOption: boolean,
  frontCdn: string | undefined,
): ArchitectureInput {
  return {
    id: `sakura-vps-${plan}`,
    name: `さくらの VPS ${plan === '2gb' ? '2GB' : '4GB'}（東京）`,
    nodes: [
      ...(frontCdn === 'static' || frontCdn === 'html'
        ? [
            {
              id: 'cf-cdn',
              label: 'Cloudflare CDN（Free）',
              config: {
                kind: 'cdn' as const,
                // ヒット率は仮定（Vercel の CDN と同じ値を使う）。HTML もキャッシュするときだけ、静的なページ（SPA のシェル・
                // Astro と静的書き出しの記事。ビルドの後に変わったページだけ消す前提）と ISR のページを返す
                // （ISR のページのヒット率は再生成の数と同じ式から出す。D-37。D-91）
                hitRate: {
                  asset: 1,
                  'document-static': frontCdn === 'html' ? 1 : 0,
                  'image-read': 0.9,
                },
                ...(frontCdn === 'html'
                  ? {
                      ttlClasses: ['document-isr' as const],
                      // オンデマンドの再検証のたびに、Free の purge の API でそのページを prefix で 1 回消す
                      // （HTML と RSC の変種をまとめて。課金は無い。D-91）
                      invalidationPathsPerPage: 1,
                    }
                  : {}),
              },
              facts:
                frontCdn === 'html'
                  ? [
                      'cache-rules-html',
                      'next-isr-headers',
                      'purge-free',
                      'free-bandwidth',
                      'pictures-terms',
                    ]
                  : ['html-not-cached', 'free-bandwidth', 'pictures-terms'],
              billing: {
                accountId: 'cloudflare',
                provider: 'cloudflare',
                planId: 'cdn-free',
                meters: {},
              },
            } as ArchNodeIn,
          ]
        : []),
      vpsNode(plan, storageOption, 'VPS（nginx + next start + MySQL）'),
    ],
    // キャッシュしない・最適化しないは Workload の側で変わる（経路は同じ VPS）
    routes:
      frontCdn === 'static' || frontCdn === 'html'
        ? {
            // 前段の CDN を通り、miss だけが VPS に届く（再生成と画像の変換は VPS の中）
            'document-static': ['cf-cdn', 'vps'],
            asset: ['cf-cdn', 'vps'],
            'document-ssr': ['cf-cdn', 'vps'],
            'document-isr': ['cf-cdn', 'vps'],
            'isr-revalidate': ['vps'],
            api: ['cf-cdn', 'vps'],
            'image-read': ['cf-cdn', 'vps'],
            'image-write': ['cf-cdn', 'vps'],
            'image-transform': ['vps'],
          }
        : {
            'document-static': ['vps'],
            asset: ['vps'],
            'document-ssr': ['vps'],
            'document-isr': ['vps'],
            'isr-revalidate': ['vps'],
            api: ['vps'],
            'image-read': ['vps'],
            'image-write': ['vps'],
            'image-transform': ['vps'],
          },
  };
}

/**
 * スロットの選択から構成を組み立てる（D-24）。選ばなかったスロットは既定。
 * standby は差し替えの途中で新旧の両方を動かしている部品（経路に載せず、常時かかる分だけ課金される）。
 */
export function composeStack(
  stack: StackDef | string,
  choices: Choices = {},
  options: {
    standby?: Choices;
    /** さくらの VPS のストレージ変更オプション（ディスクが 2 倍。D-30）。 */
    storageOption?: boolean;
    /** アプリのフレームワーク（省略は Next.js。prd/10）。 */
    framework?: FrameworkId;
  } = {},
): ArchitectureInput {
  const def = typeof stack === 'string' ? stackDef(stack) : stack;
  // Next.js の静的書き出し（D-80）は SPA と同じ形（静的な配信 + API）にし、ビルドし直しのノードを足す
  const spa = browserCallsApi(options.framework);
  const nextExport = options.framework === 'nextjs-export';
  const astro = options.framework === 'astro';
  // SPA・Astro・静的書き出しには ISR が無い（キャッシュの部品を作らない）。HTML を前段の CDN でキャッシュする部品は
  // さくらの VPS ではシェル・静的なページを CDN が返す形になる（D-91）。AWS の前段の CloudFront の「HTML も」は Next.js だけ
  const c =
    spa || astro
      ? {
          ...withDefaults(def.platform, choices),
          isrCache: 'none',
          ...(choices.frontCdn === 'html' && def.platform !== 'sakura'
            ? { frontCdn: 'static' }
            : {}),
        }
      : withDefaults(def.platform, choices);
  const standby = options.standby ?? {};
  const arch = (() => {
    switch (def.platform) {
      case 'cloudflare':
        return composeCloudflare(def.plan as 'free' | 'paid', c, standby);
      case 'vercel':
        return composeVercel(def.plan as 'hobby' | 'pro', c);
      case 'aws':
        return composeAws(c, standby, {
          spa,
          apiCache: apiCacheActive('aws', c, options.framework)
            ? c.apiCache!
            : 'none',
        });
      case 'aws-opennext':
        return composeOpenNext(c, standby, {
          spa,
          apiCache: apiCacheActive('aws-opennext', c, options.framework)
            ? c.apiCache!
            : 'none',
        });
      case 'netlify':
        return composeNetlify(def.plan as 'free' | 'personal' | 'pro', c, {
          framework: options.framework ?? 'nextjs',
          prerender: !nextExport && c.ogp === 'prerender',
          apiCache: apiCacheActive('netlify', c, options.framework)
            ? c.apiCache!
            : 'none',
        });
      case 'gcp':
        return composeGcp(c, standby, {
          framework: options.framework ?? 'nextjs',
          prerender: !nextExport && c.ogp === 'prerender',
          apiCache: apiCacheActive('gcp', c, options.framework)
            ? c.apiCache!
            : 'none',
        });
      case 'sakura':
        return composeSakura(
          def.plan as '2gb' | '4gb',
          options.storageOption ?? false,
          c.frontCdn,
        );
    }
  })();
  // 他の事業者の部品（D-52）。DB（Neon。D-77）は画像・API より先に差す（API を他の事業者に置くと DB のノードは外れる）
  const crossed = applyCross(
    applyCrossDb(arch, def.platform, def.plan, c, standby),
    def.platform,
    def.plan,
    c,
    options.framework,
  );
  // AWS は SPA の形（S3 + CloudFront + Lambda）を stacks/aws.ts で、Netlify・Google Cloud は SPA・Astro の形を
  // stacks/netlify.ts・stacks/gcp.ts で直接組む
  const direct =
    def.platform === 'aws' ||
    def.platform === 'aws-opennext' ||
    def.platform === 'netlify' ||
    def.platform === 'gcp';
  // 静的書き出し・Astro の形（名前・ビルドし直し）まで自分で組む事業者
  const shapesAll = def.platform === 'netlify' || def.platform === 'gcp';
  const shaped =
    spa && !direct
      ? asSpa(crossed, def.platform, {
          prerender: !nextExport && c.ogp === 'prerender',
          apiCache: apiCacheActive(def.platform, c, options.framework)
            ? c.apiCache!
            : 'none',
          suffix: nextExport ? EXPORT_SUFFIX : '（Vite の SPA）',
        })
      : nextExport && !shapesAll
        ? // AWS（S3 + CloudFront + Lambda）は SPA の形を stacks/aws.ts で組む。名前だけ替える
          {
            ...crossed,
            name: crossed.name.replace('（Vite の SPA）', EXPORT_SUFFIX),
          }
        : crossed;
  const built =
    astro && !shapesAll
      ? asAstro(shaped, def.platform, def.plan)
      : nextExport
        ? withBuild(shaped, def.platform, def.plan, 'Next.js')
        : shaped;
  // API を他の事業者に置く（SPA は D-65・Next.js は D-67・Astro は D-69）。Astro は静的なページのビルドし直しを足した形に差す（D-68）
  // 関数・コンテナの実行ごとのログ（課金のある事業者だけ。D-92）と DB のバックアップ（D-93）・メールの送信（D-95）は、部品を差し終えた後にまとめて足す
  // アプリのメールの送信（D-95）も最後に足す（経路を持たない）
  return withEmail(
    withBackups(
      withLogs(
        applyCrossApi(
          built,
          def.platform,
          def.plan,
          c,
          standby,
          options.framework ?? 'nextjs',
        ),
      ),
      c.dbBackup,
    ),
    def.platform,
    def.plan,
    c.email,
  );
}

/** Next.js の静的書き出しの構成の名前に添える文字（D-80）。 */
const EXPORT_SUFFIX = '（Next.js の静的書き出し）';

/** Vercel の Elastic のビルドのマシンの vCPU の最小（新しい Pro の既定。CPU minute の数に効く。D-68）。 */
const VERCEL_BUILD_CPUS = 4;

/**
 * Next.js の構成を Astro の形に直す（D-68・prd/06 §6）。記事（ISR だったルート）は静的なページとして事業者の静的な配信から返し、
 * ログインの要るページ（SSR）はアダプター（Cloudflare は Worker・Vercel は Functions・VPS は Node）が描く。
 * 静的なページの更新はビルドし直しで、ビルドの時間を事業者のビルド（Workers Builds・Vercel のビルド）で数える。
 * VPS はビルドも同じホストで行う（ビルドの CPU は数えない・仮定）。
 */
function asAstro(
  arch: ArchitectureInput,
  platform: Platform,
  plan: string,
): ArchitectureInput {
  const routes = { ...arch.routes };
  delete routes['document-isr'];
  delete routes['isr-revalidate'];
  const label: Record<string, string> = {
    worker: 'Worker（Astro）',
    fn: 'Vercel Functions（Astro）',
    vps: 'VPS（nginx + Astro の Node + MySQL）',
  };
  const nodes = arch.nodes.map((n): ArchNodeIn =>
    label[n.id] ? { ...n, label: label[n.id]! } : n,
  );
  return withBuild(
    {
      ...arch,
      name: arch.name.replace(' + vinext', '') + '（Astro）',
      nodes,
      routes,
    },
    platform,
    plan,
    'Astro',
  );
}

/**
 * 静的なページのビルドし直しのノード（経路を持たない）を足す（Astro は D-68・Next.js の静的書き出しは D-80）。
 * Cloudflare は Workers Builds、Vercel はビルドの CPU minute（Pro）・込み（Hobby）。VPS は同じホストでビルドし（CPU は数えない・仮定）、
 * AWS（S3 + CloudFront）・Google Cloud（Firebase Hosting）は手元か CI でビルドする前提で数えない（仮定）。Netlify は stacks/netlify.ts（デプロイの回数）。
 */
function withBuild(
  arch: ArchitectureInput,
  platform: Platform,
  plan: string,
  what: string,
): ArchitectureInput {
  const billingOf = (id: string) =>
    arch.nodes.find((n) => n.id === id)?.billing;
  const ci: ArchNodeIn | undefined =
    platform === 'cloudflare'
      ? {
          id: 'build',
          label: `Workers Builds（${what} の静的なページのビルド）`,
          config: { kind: 'ci-build' },
          billing: {
            ...billingOf('worker')!,
            meters: { 'build-minutes': 'build-minutes' },
          },
        }
      : platform === 'vercel'
        ? {
            id: 'build',
            label: `Vercel のビルド（${what} の静的なページ）`,
            config: {
              kind: 'ci-build',
              cpusPerBuild: plan === 'pro' ? VERCEL_BUILD_CPUS : 2,
            },
            // Hobby は Basic のマシンで込み（メーターなし。1 日のデプロイの上限は事実として出す）
            ...(plan === 'pro' ? {} : { facts: ['builds-hobby'] }),
            billing: {
              ...billingOf('fn')!,
              meters:
                plan === 'pro' ? { 'build-minutes': 'build-cpu-minutes' } : {},
            },
          }
        : undefined;
  return ci ? { ...arch, nodes: [...arch.nodes, ci] } : arch;
}

/**
 * Next.js の構成を Vite の SPA の形に直す（prd/10 §2.3）。シェル・JS・CSS は静的な配信のまま、
 * API は同じ事業者に同居（Cloudflare は同じ Worker・Vercel は同じプロジェクトの関数・VPS は同じホストの Node）。
 * OGP の前処理を付けると、シェルの読み込み（document-static）がサーバーを通る（prd/10 F-07）。
 */
function asSpa(
  arch: ArchitectureInput,
  platform: Platform,
  opts: { prerender: boolean; apiCache: string; suffix: string },
): ArchitectureInput {
  const { prerender, apiCache } = opts;
  const routes = { ...arch.routes };
  delete routes['document-ssr'];
  delete routes['document-isr'];
  delete routes['isr-revalidate'];
  // 記事の中身の API は、キャッシュの有無によらず api と同じ経路（キャッシュはノードの側で効かせる。D-37）
  if (routes.api) routes['api-content'] = [...routes.api];
  // Workers Cache を有効にすると、静的アセットへのリクエストも Workers の料金で課金される（workers-cache-front）
  const workersCacheFront = platform === 'cloudflare' && apiCache === 'cdn';
  const worker = arch.nodes.find((x) => x.id === 'worker');
  const nodes = arch.nodes.map((n): ArchNodeIn => {
    if (platform === 'cloudflare' && n.id === 'worker') {
      const facts = [
        ...(n.facts ?? []),
        'static-assets',
        'spa-navigation',
        ...(prerender ? ['run-worker-first'] : []),
        ...(workersCacheFront ? ['workers-cache-front'] : []),
        ...(apiCache === 'cache-api' ? ['cache-api-local'] : []),
      ];
      // Workers Cache: ヒットは Worker を動かさない（CPU 0）がリクエストは課金。Cache API: Worker が動いてキャッシュを読む
      const hitCpuMs =
        apiCache === 'cdn'
          ? 0
          : apiCache === 'cache-api'
            ? CACHE_API_HIT_CPU_MS
            : undefined;
      return {
        ...n,
        label: prerender ? 'Worker（API・OGP の前処理）' : 'Worker（API）',
        config: {
          kind: 'function',
          ...(hitCpuMs !== undefined
            ? { cache: { classes: ['api-content'], hitCpuMs } }
            : {}),
        },
        facts,
      };
    }
    if (workersCacheFront && n.id === 'assets' && worker?.billing)
      return {
        ...n,
        label: 'Workers 静的アセット（Workers Cache で課金）',
        billing: { ...worker.billing, meters: { requests: 'requests' } },
      };
    if (platform === 'vercel' && n.id === 'cdn' && n.config.kind === 'cdn') {
      const cached = apiCache === 'cdn';
      return {
        ...n,
        ...(cached
          ? { facts: [...(n.facts ?? []), 'cdn-cache-functions'] }
          : {}),
        config: {
          ...n.config,
          ...(prerender
            ? { hitRate: { ...n.config.hitRate, 'document-static': 0 } }
            : {}),
          originClasses: [
            ...(n.config.originClasses ?? []),
            ...(prerender ? (['document-static'] as const) : []),
            'api-content',
          ],
          ...(cached
            ? {
                ttlClasses: [
                  ...(n.config.ttlClasses ?? []),
                  'api-content' as const,
                ],
              }
            : {}),
        },
      };
    }
    if (
      platform === 'sakura' &&
      apiCache === 'cdn' &&
      n.id === 'cf-cdn' &&
      n.config.kind === 'cdn'
    )
      return {
        ...n,
        config: {
          ...n.config,
          ttlClasses: [...(n.config.ttlClasses ?? []), 'api-content'],
        },
      };
    if (platform === 'vercel' && n.id === 'fn')
      return {
        ...n,
        label: prerender
          ? 'Vercel Functions（API・OGP の前処理）'
          : 'Vercel Functions（API）',
      };
    if (platform === 'sakura' && n.id === 'vps')
      return { ...n, label: 'VPS（nginx + Node の API + MySQL）' };
    return n;
  });
  if (prerender && platform === 'cloudflare')
    routes['document-static'] = ['worker'];
  if (prerender && platform === 'vercel')
    routes['document-static'] = ['cdn', 'fn'];
  return {
    ...arch,
    name: arch.name.replace(' + vinext', '') + opts.suffix,
    nodes,
    routes,
  };
}

/**
 * 部品が Workload の側を変えるもの（キャッシュしない → ISR を SSR に・サイズ違いを作る時）。
 * 最適化しない画像（原本）と、投稿のときに一律で縮めた画像の大きさはシナリオの仮定なので、呼ぶ側が渡す（D-47）。
 */
export function applyComponentsToWorkload(
  w: WorkloadInput,
  platform: Platform,
  choices: Choices = {},
  options: { originalImageKB?: number; resizedImageKB?: number } = {},
): WorkloadInput {
  const given = withDefaults(platform, choices);
  // 他の事業者の部品は、同じ振る舞いの部品として Workload を変える（D-52）
  const c = {
    ...given,
    images: imagesBehavior(platform, given.images),
  };
  const out: WorkloadInput = { ...w };
  if (c.isrCache === 'none')
    out.routes = w.routes.map((r) =>
      r.rendering === 'isr' ? { ...r, rendering: 'ssr' } : r,
    );
  if (c.images === 'none')
    out.images = {
      ...w.images,
      transformAt: 'none',
      ...(options.originalImageKB !== undefined
        ? { sizeKB: options.originalImageKB }
        : {}),
    };
  else if (c.images === 'resize')
    // 投稿のときに 1 回だけ縮めて置く: 変換のサービスは使わず、サイズ違いは 1 種（スマホにも同じ大きさ）
    out.images = {
      ...w.images,
      transformAt: 'none',
      variants: 1,
      ...(options.resizedImageKB !== undefined
        ? { sizeKB: options.resizedImageKB }
        : {}),
    };
  else if (c.images === 'r2-variants')
    out.images = { ...w.images, transformAt: 'upload' };
  return out;
}

/**
 * 画像の部品の振る舞いの id（他の事業者の部品は同じ振る舞いの部品の id。例: 'cf-resize' → 'resize'。D-52）。
 * 画像の大きさ・サイズ違い・保存量の判定は、部品の id でなくこれで見る。
 */
export function imagesBehavior(
  platform: Platform,
  id: string | undefined,
): string | undefined {
  return behaviorOf(COMPONENTS, platform, 'images', id);
}

/** Cloudflare Workers + D1 + R2 + KV + Images に vinext で載せる（D-08）。既定の選択。 */
export function cloudflareVinext(plan: 'free' | 'paid'): ArchitectureInput {
  return composeStack(`cloudflare-vinext-${plan}`);
}

/** Vercel に Next.js をネイティブで載せ、DB は Supabase。既定の選択。 */
export function vercelSupabase(plan: 'hobby' | 'pro'): ArchitectureInput {
  return composeStack(`vercel-supabase-${plan}`);
}

/** さくらの VPS（既定は 2GB。D-13）。 */
export function sakuraVps(plan: '2gb' | '4gb' = '2gb'): ArchitectureInput {
  return composeStack(`sakura-vps-${plan}`);
}

/** 完成品の構成（STACK_DEFS の順。添字はゲームの保存と基準プレイが使う）。 */
export const MVP_STACKS = STACK_DEFS.map((d) => composeStack(d));
