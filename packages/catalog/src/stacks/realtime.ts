// 部品「リアルタイム」を Cloudflare 以外の構成にも足す（prd/17 §6 の出来事 6「研究会で一緒に検討したい」・D-240）。
// Cloudflare の Durable Objects は今までどおり composeCloudflare の中（数え方も変えない。prd/07 §11）。
// ここの部品はどれも optIn（シナリオが有効にしたときだけ選べる。記事コミュニティのチャット（W-1）は Cloudflare だけのまま。X-5）。
// - Vercel: Vercel Functions の WebSocket（2026-10-20 GA）。接続の間ずっとメモリ、メッセージの処理の間だけ CPU。
//   最大の実行時間（Hobby 300 秒・Pro 800 秒）で閉じるのでつなぎ直す。盤面は外部の置き場（仲立ちの費用は数えない）
// - さくらの VPS: 常駐のプロセスで保つ。追加の料金なし。メモリに 同時接続のピーク × 1 接続のメモリ（仮定）を足して判定する
// - Google Cloud: Cloud Run の WebSocket。開いている間インスタンスが動いていて課金。60 分（timeout の最大）でつなぎ直す
// - AWS: API Gateway の WebSocket API（メッセージと接続の分）+ メッセージごとに呼ぶ Lambda（盤面は DB）
// 隠している構成（Netlify・OpenNext。D-100）には足さない（受けるには構成の変更が要る）。
import type { ArchitectureInput } from 'estimator';
import { bill as awsBill } from './aws.ts';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** 構成ごとのリアルタイムの部品の id（セッションを保つ手段。Cloudflare は既存の Durable Objects）。 */
export const REALTIME_OPTION: Partial<Record<Platform, string>> = {
  cloudflare: 'durable-objects',
  vercel: 'functions-websocket',
  sakura: 'vps-websocket',
  gcp: 'cloud-run-websocket',
  aws: 'api-gateway-websocket',
};

/**
 * Vercel Functions の 1 インスタンスが同時に保つ接続の数（ゲーム上の仮定。Fluid compute で 1 インスタンスが複数の WebSocket を
 * さばく。メモリ × 接続の時間をこれで割る）。
 */
export const VERCEL_WS_CONNECTIONS_PER_INSTANCE = 10;
/** さくらの VPS の常駐のプロセスが 1 接続に使うメモリ（KB。ws のバッファ・盤面・参加者。ゲーム上の仮定）。 */
export const VPS_WS_KB_PER_CONNECTION = 100;
/** API Gateway の WebSocket から呼ぶ Lambda のメモリ（GB。メッセージを DB に書いて配るだけの小さな関数。ゲーム上の仮定）。 */
export const AWS_WS_LAMBDA_MEMORY_GB = 0.128;

/** 接続の上限（分。公式の値。Vercel は最大の実行時間・Cloud Run は timeout の最大・API Gateway は接続の最大）。 */
const MAX_CONNECTION_MINUTES = {
  vercelHobby: 300 / 60,
  vercelPro: 800 / 60,
  cloudRun: 60,
  apiGateway: 120,
} as const;

/**
 * セッションを保つ形（判定の材料。D-240）。state は盤面を置く所: object（接続をまとめる 1 つのオブジェクトが持つ・Durable Objects）・
 * process（常駐の 1 プロセスのメモリ・VPS）・external（インスタンスをまたぐので外部の置き場が要る）。maxConnectionMinutes は 1 回の接続の
 * 上限（無ければ時間で切られない）。
 */
export type RealtimeSession = {
  option: string;
  state: 'object' | 'process' | 'external';
  maxConnectionMinutes?: number;
  /** 前提の文の id（provider:planId:factId）。 */
  facts: string[];
};

/** 構成とプランのリアルタイムの手段（部品）と、セッションの保ち方。持たない構成（隠した構成）は undefined。 */
export function realtimeSession(
  platform: Platform,
  plan: string,
): RealtimeSession | undefined {
  const option = REALTIME_OPTION[platform];
  if (!option) return undefined;
  switch (platform) {
    case 'cloudflare':
      return {
        option,
        state: 'object',
        facts: [
          `cloudflare:${plan === 'free' ? 'durable-objects-free' : 'durable-objects-paid'}`,
        ],
      };
    case 'vercel':
      return {
        option,
        state: 'external',
        maxConnectionMinutes:
          plan === 'hobby'
            ? MAX_CONNECTION_MINUTES.vercelHobby
            : MAX_CONNECTION_MINUTES.vercelPro,
        facts: [
          `vercel:${plan}:websocket-max-duration`,
          `vercel:${plan}:websocket-instance-state`,
        ],
      };
    case 'sakura':
      return {
        option,
        state: 'process',
        facts: [`sakura-vps:${plan}-tokyo:websocket-resident`],
      };
    case 'gcp':
      return {
        option,
        state: 'external',
        maxConnectionMinutes: MAX_CONNECTION_MINUTES.cloudRun,
        facts: [
          'gcp:cloud-run:websocket-timeout',
          'gcp:cloud-run:websocket-state',
        ],
      };
    case 'aws':
      return {
        option,
        state: 'external',
        maxConnectionMinutes: MAX_CONNECTION_MINUTES.apiGateway,
        facts: [
          'aws:api-gateway-websocket:websocket-duration',
          'aws:api-gateway-websocket:websocket-state',
        ],
      };
    default:
      return undefined;
  }
}

const NONE_NOTE = 'リアルタイムの機能を持ちません';

/** 部品「リアルタイム」の Cloudflare 以外の選択肢（どれも optIn）。 */
export const REALTIME_COMPONENTS: readonly ComponentOption[] = [
  ...(['vercel', 'sakura', 'gcp', 'aws'] as const).map(
    (platform): ComponentOption => ({
      id: 'none',
      slot: 'realtime',
      platform,
      label: 'なし',
      note: NONE_NOTE,
      premiseRefs: [],
      optIn: true,
    }),
  ),
  {
    id: 'functions-websocket',
    slot: 'realtime',
    platform: 'vercel',
    label: 'Vercel Functions の WebSocket',
    note:
      'Vercel Functions で WebSocket を受けます。つないでいる間はずっとメモリ（Provisioned Memory）を、メッセージを処理している間だけ CPU を払います。' +
      '関数の最大の実行時間（Hobby 5 分・Pro 800 秒）で接続が閉じるので、ブラウザがつなぎ直して盤面を読み直します。' +
      'つなぎ直すと別のインスタンスにつながることがあるので、盤面は外部の置き場に置きます（仲立ちの費用は数えません）',
    premiseRefs: [
      'fact:vercel:pro:websocket-',
      'fact:vercel:hobby:websocket-',
      'credit:vercel:pro:usage-credit',
    ],
    optIn: true,
  },
  {
    id: 'vps-websocket',
    slot: 'realtime',
    platform: 'sakura',
    label: 'VPS の常駐のプロセスで WebSocket',
    note:
      'VPS の Node のプロセスで WebSocket を保ちます。月額は変わらず、接続は時間で切られず、盤面はプロセスのメモリに置けます。' +
      '同時接続が増えるとメモリと CPU を使い、VPS が止まるとつながっている全員が切れます',
    premiseRefs: [
      'fact:sakura-vps:2gb-tokyo:websocket-resident',
      'fact:sakura-vps:4gb-tokyo:websocket-resident',
      'host:memory:vps',
    ],
    optIn: true,
  },
  {
    id: 'cloud-run-websocket',
    slot: 'realtime',
    platform: 'gcp',
    label: 'Cloud Run の WebSocket',
    note:
      'Cloud Run で WebSocket を受けます。接続を 1 本でも開いているインスタンスは動いているとみなされ、メッセージが無い間も CPU とメモリを払います。' +
      'リクエストの timeout（最大 60 分）で切れるので、60 分ごとにつなぎ直します。盤面は外部の置き場に置きます（仲立ちの費用は数えません）',
    premiseRefs: ['fact:gcp:cloud-run:websocket-', 'pool:gcp:run-free-'],
    optIn: true,
  },
  {
    id: 'api-gateway-websocket',
    slot: 'realtime',
    platform: 'aws',
    label: 'API Gateway の WebSocket API + Lambda',
    note:
      'API Gateway が接続を保ち、メッセージごとに Lambda を呼びます。メッセージ（受け取った分と配った分）と接続の分で払います。' +
      '接続は 2 時間まで・無通信 10 分で切れます。Lambda は状態を持てないので、盤面とつながっている人は DB に置きます',
    premiseRefs: [
      'fact:aws:api-gateway-websocket:',
      'pool:aws:lambda:lambda-free-',
    ],
    optIn: true,
  },
];

const DB_KINDS: readonly string[] = [
  'sql-db',
  'managed-db',
  'request-db',
  'processing-db',
  'db-proxy',
  'kv',
];

/** アプリの API の経路のうち、処理（関数・コンテナ・ホスト）の後ろの DB の部分。 */
function dbTail(arch: ArchitectureInput): string[] {
  const api = arch.routes.api ?? [];
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));
  const i = api.findIndex((id) => {
    const k = byId.get(id)?.config.kind;
    return k === 'function' || k === 'container' || k === 'host';
  });
  if (i < 0) return [];
  return api
    .slice(i + 1)
    .filter((id) => DB_KINDS.includes(byId.get(id)?.config.kind ?? ''));
}

/** リアルタイムの 2 つのクラスの経路を足す。 */
const withRoutes = (
  arch: ArchitectureInput,
  nodes: ArchNodeIn[],
  head: string[],
): ArchitectureInput => {
  const db = dbTail(arch);
  return {
    ...arch,
    nodes,
    routes: {
      ...arch.routes,
      'realtime-connect': [...head, ...db],
      'realtime-message': [...head, ...db],
    },
  };
};

/**
 * 部品「リアルタイム」を Cloudflare 以外の構成に当てる（composeStack から、API の置き場・解析の置き場を差した後に呼ぶ）。
 * 選択が無い・なしなら構成を変えない。Cloudflare は composeCloudflare の中（Durable Objects）。
 */
export function applyRealtime(
  arch: ArchitectureInput,
  platform: Platform,
  plan: string,
  choice: string | undefined,
): ArchitectureInput {
  if (choice === undefined || choice === 'none') return arch;
  const session = realtimeSession(platform, plan);
  if (!session || session.option !== choice || platform === 'cloudflare')
    return arch;
  const max = session.maxConnectionMinutes;
  switch (platform) {
    case 'vercel': {
      const fn = arch.nodes.find((n) => n.id === 'fn');
      if (!fn?.billing) return arch;
      const ws: ArchNodeIn = {
        id: 'ws',
        role: 'compute',
        label: 'Vercel Functions（WebSocket）',
        config: {
          kind: 'function',
          memoryGB: 2,
          concurrency: VERCEL_WS_CONNECTIONS_PER_INSTANCE,
          websocket: { maxConnectionMinutes: max! },
        },
        facts: [
          'websocket-max-duration',
          'websocket-billing',
          'websocket-instance-state',
        ],
        billing: fn.billing,
      };
      return withRoutes(arch, [...arch.nodes, ws], ['ws']);
    }
    case 'sakura': {
      const nodes = arch.nodes.map((n): ArchNodeIn =>
        n.id === 'vps' && n.config.kind === 'host'
          ? {
              ...n,
              config: {
                ...n.config,
                websocket: { kbPerConnection: VPS_WS_KB_PER_CONNECTION },
              },
              facts: [...(n.facts ?? []), 'websocket-resident'],
            }
          : n,
      );
      return withRoutes(arch, nodes, ['vps']);
    }
    case 'gcp': {
      const nodes = arch.nodes.map((n): ArchNodeIn =>
        n.id === 'run' && n.config.kind === 'container'
          ? {
              ...n,
              config: {
                ...n.config,
                websocket: { maxConnectionMinutes: max! },
              },
              facts: [
                ...(n.facts ?? []),
                'websocket-timeout',
                'websocket-billing',
                'websocket-state',
              ],
            }
          : n,
      );
      return withRoutes(arch, nodes, ['run']);
    }
    case 'aws': {
      const gateway: ArchNodeIn = {
        id: 'apigw-ws',
        role: 'compute',
        label: 'API Gateway（WebSocket API）',
        // メッセージは 32 KB ごとに 1 件（料金ページ）
        config: {
          kind: 'websocket-gateway',
          messageUnitKB: 32,
          websocket: { maxConnectionMinutes: max! },
        },
        facts: ['websocket-duration', 'websocket-messages', 'websocket-state'],
        billing: awsBill('api-gateway-websocket', {
          messages: 'messages',
          'connection-minutes': 'connection-minutes',
        }),
      };
      const lambda: ArchNodeIn = {
        id: 'ws-lambda',
        role: 'compute',
        label: 'Lambda（WebSocket のメッセージ）',
        config: {
          kind: 'function',
          memoryGB: AWS_WS_LAMBDA_MEMORY_GB,
          concurrency: 1,
        },
        billing: awsBill('lambda', {
          invocations: 'requests',
          'memory-gb-hours': 'compute',
        }),
      };
      return withRoutes(
        arch,
        [...arch.nodes, gateway, lambda],
        ['apigw-ws', 'ws-lambda'],
      );
    }
    default:
      return arch;
  }
}
