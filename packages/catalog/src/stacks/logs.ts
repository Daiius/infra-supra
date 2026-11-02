// 関数・コンテナの実行ごとに出るログ（D-92・prd/04 §3.3.2・prd/11 §18）。課金のある事業者の部品にだけ、1 回の実行あたりのログの量と
// メーターを足す。構成を組んだ後にまとめて差すので、部品ごとの組み立て（config の差し替え）に混ぜない。
// 値はゲーム上の仮定（出典なし）。アプリが書くのは 1 回の実行にアクセスログ 1 行（約 0.2 KB）とみる。
import type { ArchitectureInput } from 'estimator';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/**
 * Lambda（Amplify の SSR も）の 1 回の実行のログ（KB）。START・END・REPORT の 3 行（約 0.3 KB。RequestId の UUID・実行時間・
 * メモリの行）+ アクセスログ 1 行（約 0.2 KB）。
 */
export const LAMBDA_LOG_KB_PER_INVOCATION = 0.5;
/**
 * Cloud Run の 1 件のログ（KB）。自動の要求ログ（LogEntry の JSON。httpRequest・インスタンスの ID・trace・リソースのラベルで約 1 KB）
 * + アクセスログ 1 行（stdout の 1 行も LogEntry になり、同じラベルが付いて約 0.5 KB）。Cloud Logging は索引を付ける前の
 * LogEntry の大きさで数える。
 */
export const CLOUD_RUN_LOG_KB_PER_REQUEST = 1.5;
/** Workers Logs の 1 回の実行の件数。呼び出しのログ 1 件 + console.log 1 件（公式の料金の例も 1 リクエスト 2 件）。 */
export const WORKERS_LOG_EVENTS_PER_INVOCATION = 2;
/**
 * Workers Logs の 1 回の実行のログの量（KB。2026-12-01 からの Cloudflare Observability の取り込み。D-94）。公式に 1 件の大きさの記載は無い。
 * 呼び出しのログ（要求の URL・メソッド・結果・Worker の名前などの既定の属性で約 1 KB）+ console.log 1 行（属性つきで約 0.5 KB）とみる。
 */
export const WORKERS_LOG_KB_PER_INVOCATION = 1.5;
/** Cloudflare Observability の既定の保持（日。保存の GB 月に効く。D-94）。 */
export const WORKERS_LOG_RETENTION_DAYS = 7;

/** 課金先のプラン → その部品のログの量と、メーター。挙げないプランはログを数えない（課金が無い・料金未取得）。 */
const LOG_PROFILES: Record<
  string,
  {
    logs: {
      kbPerInvocation?: number;
      eventsPerInvocation?: number;
      retentionDays?: number;
    };
    meters: Record<string, string>;
  }
> = {
  'aws:lambda': {
    logs: { kbPerInvocation: LAMBDA_LOG_KB_PER_INVOCATION },
    meters: { 'log-gb': 'logs' },
  },
  'aws:amplify-hosting': {
    logs: { kbPerInvocation: LAMBDA_LOG_KB_PER_INVOCATION },
    meters: { 'log-gb': 'logs' },
  },
  'gcp:cloud-run': {
    logs: { kbPerInvocation: CLOUD_RUN_LOG_KB_PER_REQUEST },
    meters: { 'log-gb': 'logs' },
  },
  'cloudflare:workers-paid': {
    // 件数は 2026-12-01 までの Workers Logs、量と保存はその後の Cloudflare Observability のメーター（D-94）
    logs: {
      eventsPerInvocation: WORKERS_LOG_EVENTS_PER_INVOCATION,
      kbPerInvocation: WORKERS_LOG_KB_PER_INVOCATION,
      retentionDays: WORKERS_LOG_RETENTION_DAYS,
    },
    meters: {
      'log-events': 'workers-logs',
      'log-gb': 'observability-ingest',
      'log-gb-month': 'observability-storage',
    },
  },
};

function withNodeLogs(n: ArchNodeIn): ArchNodeIn {
  const c = n.config;
  if (!n.billing || (c.kind !== 'function' && c.kind !== 'container')) return n;
  const p = LOG_PROFILES[`${n.billing.provider}:${n.billing.planId}`];
  if (!p) return n;
  return {
    ...n,
    config: { ...c, logs: p.logs },
    billing: {
      ...n.billing,
      meters: { ...n.billing.meters, ...p.meters },
    },
  };
}

/** 構成の関数・コンテナに、実行ごとのログを差す（D-92）。 */
export function withLogs(arch: ArchitectureInput): ArchitectureInput {
  return { ...arch, nodes: arch.nodes.map(withNodeLogs) };
}
