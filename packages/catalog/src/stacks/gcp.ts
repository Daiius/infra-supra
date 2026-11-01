// Google Cloud の構成（D-88・prd/11 §16）。Firebase Hosting（CDN・静的なファイル）の後ろに Cloud Run のコンテナを置く。
// Next.js は output: 'standalone' のコンテナを Cloud Run で動かし（ISR のキャッシュはインスタンスごと。共有しない）、
// SPA・Next.js の静的書き出し・Astro は Hosting から静的に配り、API（Astro はマイページも）を Cloud Run に置く。
// 料金は providers/gcp.ts。SPA と Astro の形もここで直接組む（index.ts の asSpa・asAstro は通さない。Netlify と同じ）。
// ノードの id は cdn・run・gcs と DB（firestore・cloud-sql）。他の事業者の部品（cross.ts）はこの id に頼る。
import type { ArchitectureInput, RequestClass } from 'estimator';
import { browserCallsApi, type FrameworkId } from '../frameworks/index.ts';
import type { Choices, ComponentOption, StackDef } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

export const GCP_STACK_DEFS: readonly StackDef[] = [
  {
    id: 'gcp-cloud-run',
    platform: 'gcp',
    plan: 'pay-as-you-go',
    name: 'Google Cloud（Cloud Run + Firebase Hosting）',
    containerized: true,
  },
];

export const GCP_DEFAULT_CHOICES: Choices = {
  isrCache: 'default',
  images: 'default',
  db: 'firestore',
  minInstances: '0',
};

/** Hosting の CDN の画像のヒット率（仮定。他の事業者の CDN と同じ値）。 */
const IMAGE_CDN_HIT_RATE = 0.9;
/** Cloud Run のインスタンスの大きさ（仮定: 1 vCPU・512 MiB。Next.js の standalone のサーバーが動く最小に近い形）。 */
const RUN_VCPU = 1;
const RUN_MEMORY_GB = 0.5;
/** 1 インスタンスの同時のリクエストの上限（公式の既定 80。gcloud では vCPU × 80）。 */
const RUN_CONCURRENCY = 80;
/** 仕事の無いインスタンスを残す時間（公式: 15 分の待機の後に止める）。 */
const RUN_IDLE_KEEP_SECONDS = 900;
/** next/image の 1 回の変換の時間（ms。仮定。OpenNext の画像の関数・VPS のホストと同じ値）。 */
const IMAGE_TRANSFORM_MS = 150;
/** Cloud Storage の画像を Cloud Run がそのまま返す 1 回の時間（ms。仮定）。 */
const IMAGE_PASS_MS = 10;
/** Firestore の 1 ドキュメントの大きさ（KB。仮定。DynamoDB の 1 行と同じ値）。 */
const FIRESTORE_DOC_KB = 1;

const RUN_REFS = [
  'pool:gcp:run-free-cpu',
  'pool:gcp:run-free-memory',
  'pool:gcp:run-free-requests',
];

const RESIZE_NOTE =
  '投稿のとき（ブラウザかサーバーで）に 1 回だけ、長い辺 1,600〜2,000px 程度・数百 KB に一律で縮めて Cloud Storage に置き、原本は残さない。変換の CPU はかからず、保存量も小さい。サイズ違いが無いので、スマホにも同じ大きさを配る（最適化より遅い）。配信は Hosting の CDN の後ろの Cloud Run が Cloud Storage から返す';

export const GCP_COMPONENTS: readonly ComponentOption[] = [
  {
    id: 'default',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'gcp',
    label: 'Hosting の CDN（s-maxage）+ インスタンスごとのキャッシュ',
    note: 'ISR のページは Firebase Hosting の CDN が s-maxage の間だけ返し、外れると Cloud Run の Next.js が自分のインスタンスのキャッシュから返して、期限が来たら作り直す。キャッシュはインスタンスごとで共有されない（増えたインスタンスはそれぞれ作り直す）。オンデマンドの再検証は受けたインスタンスにしか効かず、CDN はデプロイのときしか消えないので届かない',
    premiseRefs: [
      'fact:gcp:cloud-run:next-local-cache',
      'fact:gcp:firebase-hosting:dynamic-cache',
      'fact:gcp:firebase-hosting:cache-cleared-on-deploy',
      'fact:gcp:cloud-run:cpu-outside-requests',
    ],
    onDemandIsr: {
      ok: false,
      fact: 'gcp:firebase-hosting:cache-cleared-on-deploy',
    },
  },
  {
    id: 'none',
    slot: 'isrCache',
    frameworks: ['nextjs'],
    platform: 'gcp',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回 Cloud Run まで届き、CPU とリクエストが増える（同時に処理する分はまとめて数える）。記事は常に新しい',
    premiseRefs: RUN_REFS,
  },
  {
    id: 'default',
    slot: 'images',
    frameworks: ['nextjs', 'vite-spa', 'astro'],
    platform: 'gcp',
    label: 'Cloud Run で変換（next/image・sharp）',
    note: 'Next.js は next/image の最適化がコンテナの中でそのまま動き、Cloud Storage の原本から変換して Hosting の CDN にキャッシュさせる（外れた分だけ 1 回 150 ms と仮定）。SPA・Astro は同じ形の変換の口を自分で書く（自作）',
    premiseRefs: ['fact:gcp:cloud-run:next-image', ...RUN_REFS],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'gcp',
    label: '最適化しない',
    note: '投稿された原本（このゲームでは 1 枚 4 MB と仮定）をそのまま配る。Hosting の転送（1 GB $0.15）が大きく増え、とても遅くなる（速さが悪い月は PV の伸びも下がる。ゲーム上の仮定）',
    premiseRefs: ['pool:gcp:hosting-free-transfer'],
  },
  {
    id: 'resize',
    slot: 'images',
    platform: 'gcp',
    label: '投稿のときに一律で縮めて置く',
    note: RESIZE_NOTE,
    premiseRefs: [],
  },
  {
    id: 'firestore',
    slot: 'db',
    platform: 'gcp',
    label: 'Firestore（従量）',
    note: 'ドキュメントの読み書きの件数と保存だけを払う（1 日 5 万の読み取り・2 万の書き込み・1 GiB までは無料）。基本料は無い。SQL ではない（ドキュメントの DB）ので、作りは Postgres と違う',
    premiseRefs: ['fact:gcp:firestore-standard:', 'pool:gcp:firestore-'],
  },
  {
    id: 'cloud-sql',
    slot: 'db',
    platform: 'gcp',
    label: 'Cloud SQL for PostgreSQL（最小・db-f1-micro）',
    note: '共有の vCPU の最小のインスタンス（メモリ 0.6 GiB）が常に動き、月 約 $8.9 + 保存（1 GiB $0.221）。問い合わせが無くても止まらない。SLA の対象外',
    premiseRefs: ['fact:gcp:cloud-sql-f1-micro:shared-core'],
  },
  {
    id: '0',
    slot: 'minInstances',
    platform: 'gcp',
    label: '0（使っていない間は止める）',
    note: 'リクエストの無いインスタンスは 15 分で止まり、待機の費用はかからない。止まった後に届いた閲覧はコンテナの起動を待つ（閲覧が途切れがちなサイトでは速さが下がる。ゲーム上の仮定）',
    premiseRefs: ['fact:gcp:cloud-run:idle-timeout'],
  },
  {
    id: '1',
    slot: 'minInstances',
    platform: 'gcp',
    label: '1（常に 1 つ温めておく）',
    note: '1 つのインスタンスを常に温めておき、冷えた起動を待たない。リクエストを処理していない間も待機の単価で払う（1 vCPU・512 MiB で月 最大 約 $9.9。処理している時間はアクティブの単価になり、その分は待機から外れる）',
    premiseRefs: ['fact:gcp:cloud-run:min-instances'],
  },
  // API の置き場の既定（同じ事業者）
  ...(
    [
      [
        'vite-spa',
        'Firebase Hosting の書き換えで同じドメインの /api を Cloud Run に渡し、DB を読む。同じドメインなので CORS の設定は要らない',
      ],
      [
        'nextjs',
        'Next.js のサーバー（Cloud Run のコンテナ）が同じプロジェクトの DB を直接読む。API を別に立てない',
      ],
      [
        'astro',
        'Astro のサーバー（@astrojs/node のコンテナを Cloud Run で動かす）が同じプロジェクトの DB を直接読む。API を別に立てない',
      ],
      [
        'nextjs-export',
        'Firebase Hosting の書き換えで同じドメインの /api を Cloud Run に渡し、DB を読む。ブラウザ（Client Component）から呼ぶ。同じドメインなので CORS の設定は要らない',
      ],
    ] as const
  ).map(([framework, note]): ComponentOption => ({
    id: 'same',
    slot: 'api',
    platform: 'gcp',
    frameworks: [framework],
    label: '同じ事業者（同居）',
    note,
    premiseRefs: ['fact:gcp:firebase-hosting:cloud-run-rewrite'],
  })),
  // SPA の SNS のカード（OGP）の前処理（prd/10 F-07）
  {
    id: 'none',
    slot: 'ogp',
    platform: 'gcp',
    frameworks: ['vite-spa'],
    label: '前処理しない（全ページ同じカード）',
    note: 'シェルのメタタグは全ページ同じ。記事ごとのカードは出ない（ゲーム上の仮定: SNS の話題が伸びにくい）',
    premiseRefs: [],
  },
  {
    id: 'prerender',
    slot: 'ogp',
    platform: 'gcp',
    frameworks: ['vite-spa'],
    label: 'OGP の前処理',
    note: 'シェルを Hosting から返さず、Cloud Run が記事のメタタグを差し込んで返す。シェルの読み込みが Cloud Run のリクエストになる',
    premiseRefs: RUN_REFS,
  },
  // SPA の API の応答のキャッシュ（D-37）
  {
    id: 'none',
    slot: 'apiCache',
    platform: 'gcp',
    frameworks: ['vite-spa'],
    label: 'なし',
    note: '記事の中身の API を毎回処理して DB を読む。記事は常に新しい',
    premiseRefs: [],
  },
  {
    id: 'cdn',
    slot: 'apiCache',
    platform: 'gcp',
    frameworks: ['vite-spa'],
    label: 'Hosting の CDN のキャッシュ（public・s-maxage）',
    note: '記事の中身の API の応答に Cache-Control: public, s-maxage を付け、ヒットは Hosting の CDN が返す（Cloud Run と DB に届く件数が減る。転送は残る）。CDN はデプロイのときしか消えない',
    premiseRefs: ['fact:gcp:firebase-hosting:dynamic-cache'],
  },
];

/** DB のノード（Firestore は件数で課金・Cloud SQL は時間で課金）。 */
export function gcpDbNode(opt: string | undefined): ArchNodeIn {
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'gcp',
    provider: 'gcp',
    planId,
    meters,
  });
  return opt === 'cloud-sql'
    ? {
        id: 'cloud-sql',
        label: 'Cloud SQL for PostgreSQL（db-f1-micro）',
        config: { kind: 'managed-db' },
        facts: ['shared-core'],
        billing: bill('cloud-sql-f1-micro', {
          'instance-hours': 'instance',
          'storage-gb-month': 'storage',
        }),
      }
    : {
        id: 'firestore',
        label: 'Firestore（Standard）',
        config: {
          kind: 'request-db',
          readUnitKB: FIRESTORE_DOC_KB,
          writeUnitKB: FIRESTORE_DOC_KB,
          eventuallyConsistent: false,
          itemKB: FIRESTORE_DOC_KB,
        },
        facts: ['document-reads'],
        billing: bill('firestore-standard', {
          'read-request-units': 'reads',
          'write-request-units': 'writes',
          'storage-gb-month': 'storage',
        }),
      };
}

/**
 * Google Cloud に載せる（Next.js・SPA・Next.js の静的書き出し・Astro）。
 * - Firebase Hosting は転送（ヒットも外れも）だけを数え、リクエストの件数は課金されない。画像の投稿は Hosting を通さずに数える
 *   （Cloud Run に直接届く形にし、投稿の大きさを転送に入れない）。
 * - Cloud Run はコンテナのサービス（estimator の container）。アクティブな時間・待機（最小インスタンス）・リクエストを数える。
 * - 画像の原本は Cloud Storage。配信は Hosting の CDN の後ろの Cloud Run が返す（変換するなら next/image）。
 * - Astro・静的書き出しの記事の更新は CI でビルドして Hosting にデプロイする前提で、ビルドの費用は数えない（AWS と同じ仮定）。
 */
export function composeGcp(
  choices: Choices,
  standby: Choices,
  opts: { framework: FrameworkId; prerender: boolean; apiCache: string },
): ArchitectureInput {
  const spa = browserCallsApi(opts.framework);
  const nextExport = opts.framework === 'nextjs-export';
  const astro = opts.framework === 'astro';
  const isr = !spa && !astro && choices.isrCache !== 'none';
  const optimize = choices.images !== 'none' && choices.images !== 'resize';
  const cachedApi = spa && opts.apiCache === 'cdn';
  const prerender = spa && opts.prerender;
  const minInstances = choices.minInstances === '1' ? 1 : 0;
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'gcp',
    provider: 'gcp',
    planId,
    meters,
  });
  const db = gcpDbNode(choices.db);
  const standbyDb =
    standby.db !== undefined && standby.db !== choices.db
      ? [gcpDbNode(standby.db)]
      : [];
  const ttl: RequestClass[] = [
    ...(isr ? (['document-isr'] as const) : []),
    ...(cachedApi ? (['api-content'] as const) : []),
  ];
  const nodes: ArchNodeIn[] = [
    {
      id: 'cdn',
      label: 'Firebase Hosting（CDN）',
      config: {
        kind: 'cdn',
        hitRate: {
          asset: 1,
          'document-static': prerender ? 0 : 1,
          'image-read': IMAGE_CDN_HIT_RATE,
        },
        ...(ttl.length ? { ttlClasses: ttl } : {}),
      },
      facts: [
        'cloud-run-rewrite',
        'transfer-from-run',
        ...(ttl.length ? ['dynamic-cache', 'cache-cleared-on-deploy'] : []),
        ...(spa ? [] : ['session-cookie']),
      ],
      billing: bill('firebase-hosting', { 'egress-gb': 'transfer' }),
    },
    {
      id: 'run',
      label: spa
        ? prerender
          ? 'Cloud Run（API・OGP の前処理）'
          : 'Cloud Run（API）'
        : astro
          ? 'Cloud Run（Astro の Node）'
          : 'Cloud Run（Next.js の standalone）',
      config: {
        kind: 'container',
        vcpu: RUN_VCPU,
        memoryGB: RUN_MEMORY_GB,
        concurrency: RUN_CONCURRENCY,
        minInstances,
        idleKeepSeconds: RUN_IDLE_KEEP_SECONDS,
        // ISR の作り直しと一意な変換は、閲覧のリクエストの中（裏）で走る。リクエストの件数には数えない
        backgroundClasses: ['isr-revalidate', 'image-transform'],
        classCpuMs: {
          'image-read': optimize ? IMAGE_TRANSFORM_MS : IMAGE_PASS_MS,
          'image-transform': 0,
        },
      },
      facts: [
        'request-billing',
        'idle-timeout',
        ...(minInstances > 0 ? ['min-instances'] : []),
        ...(isr ? ['next-local-cache', 'cpu-outside-requests'] : []),
        ...(optimize && !spa && !astro ? ['next-image'] : []),
      ],
      billing: bill('cloud-run', {
        requests: 'requests',
        'cpu-hours': 'cpu',
        'memory-gb-hours': 'memory',
        'idle-cpu-hours': 'idle-cpu',
        'idle-memory-gb-hours': 'idle-memory',
      }),
    },
    {
      id: 'gcs',
      label: 'Cloud Storage（画像の原本）',
      config: { kind: 'object-storage' },
      billing: bill('cloud-storage-standard', {
        'storage-gb-month': 'storage',
        'object-writes': 'class-a',
        'object-reads': 'class-b',
      }),
    },
    db,
    ...standbyDb,
  ];
  const images: Partial<Record<RequestClass, string[]>> = {
    'image-read': ['cdn', 'run', 'gcs'],
    'image-write': ['run', 'gcs'],
    'image-transform': ['run'],
  };
  const routes: Partial<Record<RequestClass, string[]>> = spa
    ? {
        'document-static': prerender ? ['cdn', 'run'] : ['cdn'],
        asset: ['cdn'],
        api: ['cdn', 'run', db.id],
        'api-content': ['cdn', 'run', db.id],
        ...images,
      }
    : {
        'document-static': ['cdn'],
        asset: ['cdn'],
        'document-ssr': ['cdn', 'run', db.id],
        ...(isr
          ? {
              // CDN の外れはインスタンスのキャッシュから返し、期限の来たページはそのインスタンスが裏で作り直す
              'document-isr': ['cdn', 'run'],
              'isr-revalidate': ['run', db.id],
            }
          : {}),
        api: ['cdn', 'run', db.id],
        ...images,
      };
  const base = GCP_STACK_DEFS[0]!;
  return {
    id: base.id,
    name: nextExport
      ? `${base.name}（Next.js の静的書き出し）`
      : spa
        ? `${base.name}（Vite の SPA）`
        : astro
          ? `${base.name}（Astro）`
          : base.name,
    nodes,
    routes,
  };
}
