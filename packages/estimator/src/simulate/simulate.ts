// 資源シミュレーション（prd/04-resource-simulation.md）。Workload × Architecture → ノードごとの汎用リソースの使用量。
// ComponentKind の振る舞いはここ（コード）、値は Architecture のデータ。純粋関数。
import { HOURS_PER_MONTH, bytesToGb } from '../num/unit.ts';
import type { ResourceKey } from '../pricing/resources.ts';
import {
  ArchitectureSchema,
  type ArchNode,
  type Architecture,
  type ArchitectureInput,
} from '../architecture/schema.ts';
import type {
  ClassFlow,
  RequestClass,
  ResolvedWorkload,
} from '../workload/resolve.ts';

const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;
const KB = 1000; // 1 KB = 1000 バイト（GB の既定の SI と揃える）

/** ホストの容量の使用（ピーク時間帯）。判定は P1-8。 */
export type HostLoad = {
  peakMbps: number;
  peakCores: number;
  memoryGB: number;
  diskGB: number;
};

export type NodeUsage = {
  nodeId: string;
  resources: Partial<Record<ResourceKey, number>>;
  /** 1 回ごとの丸め（cpu-ms など）に使う件数。 */
  events: number;
  host?: HostLoad;
};

export type Simulation = {
  architecture: Architecture;
  workload: ResolvedWorkload;
  nodes: Record<string, NodeUsage>;
  /** 経路のどこにも載らなかったクラス（件数が 0 でないのに行き先がない = 構成の欠落）。 */
  unroutedClasses: RequestClass[];
};

const kbToGb = (kb: number) => bytesToGb(kb * KB);

function add(u: NodeUsage, r: ResourceKey, v: number) {
  if (v === 0) return;
  u.resources[r] = (u.resources[r] ?? 0) + v;
}

/** 1 ノードがクラスの流れを受け取ったときの使用量と、次のノードへ渡す流れ。 */
function consume(
  node: ArchNode,
  cls: RequestClass,
  f: ClassFlow,
  u: NodeUsage,
  w: ResolvedWorkload,
  hostAcc: { kb: number; cpuMs: number; queries: number; transforms: number },
): ClassFlow {
  const c = node.config;
  const n = f.count;
  const p = f.perRequest;
  switch (c.kind) {
    case 'cdn': {
      const hit = c.hitRate[cls] ?? 0;
      add(u, 'requests', n);
      add(u, 'egress-gb', kbToGb(n * p.kb));
      const miss = n * (1 - hit);
      add(u, 'origin-transfer-gb', kbToGb(miss * p.kb));
      return { count: miss, perRequest: p };
    }
    case 'function': {
      add(u, 'requests', n);
      add(u, 'invocations', n);
      add(u, 'cpu-ms', n * p.cpuMs);
      add(
        u,
        'memory-gb-hours',
        ((n * p.wallMs) / 3_600_000) * (c.memoryGB / c.concurrency),
      );
      u.events += n;
      return f;
    }
    case 'kv': {
      if (cls === 'isr-revalidate') add(u, 'kv-writes', n);
      else add(u, 'kv-reads', n);
      return f;
    }
    case 'sql-db': {
      add(u, 'rows-read', n * p.rowsRead);
      add(u, 'rows-written', n * p.rowsWritten);
      return f;
    }
    case 'managed-db': {
      add(
        u,
        'egress-gb',
        kbToGb(n * p.queries * w.input.db.responseKBPerQuery),
      );
      return f;
    }
    case 'object-storage': {
      if (cls === 'image-write') add(u, 'object-writes', n);
      else {
        add(u, 'object-reads', n);
        add(u, 'egress-gb', kbToGb(n * p.kb));
      }
      return f;
    }
    case 'image-optimizer': {
      if (cls === 'image-transform') {
        add(u, 'image-transformations', n);
        if (c.unitKB)
          add(u, 'image-cache-writes', n * Math.ceil(p.kb / c.unitKB));
      } else if (cls === 'image-read' && c.unitKB) {
        add(
          u,
          'image-cache-reads',
          n * c.cacheMissRate * Math.ceil(p.kb / c.unitKB),
        );
      }
      return f;
    }
    case 'isr-store': {
      const units = Math.ceil(p.kb / c.unitKB);
      if (cls === 'isr-revalidate')
        add(u, 'isr-writes', n * c.changedRate * units);
      else add(u, 'isr-reads', n * units);
      return f;
    }
    case 'host': {
      hostAcc.kb += n * p.kb;
      hostAcc.cpuMs += n * p.cpuMs;
      hostAcc.queries += n * p.queries;
      if (cls === 'image-transform') hostAcc.transforms += n;
      add(u, 'requests', n);
      add(u, 'egress-gb', kbToGb(n * p.kb));
      return f;
    }
  }
}

/** 経路に依存しない使用量（保存量・常時動くコンピュート）。 */
function staticUsage(node: ArchNode, u: NodeUsage, w: ResolvedWorkload) {
  switch (node.config.kind) {
    case 'sql-db':
      add(u, 'storage-gb-month', w.storage.dbGB);
      break;
    case 'managed-db':
      add(u, 'storage-gb-month', w.storage.dbGB);
      add(u, 'instance-hours', HOURS_PER_MONTH);
      break;
    case 'object-storage':
      add(u, 'storage-gb-month', w.storage.imagesGB);
      break;
    default:
      break;
  }
}

export function simulateResources(
  workload: ResolvedWorkload,
  architectureInput: ArchitectureInput,
): Simulation {
  const architecture = ArchitectureSchema.parse(architectureInput);
  const byId = new Map(architecture.nodes.map((n) => [n.id, n]));
  const nodes: Record<string, NodeUsage> = {};
  const hostAcc = new Map<
    string,
    { kb: number; cpuMs: number; queries: number; transforms: number }
  >();
  for (const n of architecture.nodes) {
    nodes[n.id] = { nodeId: n.id, resources: {}, events: 0 };
    hostAcc.set(n.id, { kb: 0, cpuMs: 0, queries: 0, transforms: 0 });
    staticUsage(n, nodes[n.id]!, workload);
  }

  const unroutedClasses: RequestClass[] = [];
  for (const [cls, f] of Object.entries(workload.classes) as [
    RequestClass,
    ClassFlow,
  ][]) {
    const path = architecture.routes[cls];
    if (!path) {
      if (f.count > 0) unroutedClasses.push(cls);
      continue;
    }
    let current = f;
    for (const id of path) {
      current = consume(
        byId.get(id)!,
        cls,
        current,
        nodes[id]!,
        workload,
        hostAcc.get(id)!,
      );
    }
  }

  for (const n of architecture.nodes) {
    if (n.config.kind !== 'host') continue;
    const acc = hostAcc.get(n.id)!;
    const c = n.config;
    const peak = workload.peakHourFactor / SECONDS_PER_MONTH;
    nodes[n.id]!.host = {
      peakMbps: (acc.kb * KB * 8 * peak) / 1_000_000,
      peakCores:
        ((acc.cpuMs +
          acc.queries * c.dbCpuMsPerQuery +
          acc.transforms * c.imageTransformCpuMs) /
          1000) *
        peak,
      memoryGB: c.residentMemoryGB,
      diskGB: workload.storage.dbGB + workload.storage.imagesGB + c.otherDiskGB,
    };
  }
  return { architecture, workload, nodes, unroutedClasses };
}
