// 資源シミュレーション（prd/04-resource-simulation.md）。Workload × Architecture → ノードごとの汎用リソースの使用量。
// ComponentKind の振る舞いはここ（コード）、値は Architecture のデータ。純粋関数。
import { ceilUnits } from '../num/arith.ts';
import { HOURS_PER_MONTH, bytesToGb } from '../num/unit.ts';
import type { ResourceKey } from '../pricing/resources.ts';
import {
  ArchitectureSchema,
  type ArchNode,
  type Architecture,
  type ArchitectureInput,
} from '../architecture/schema.ts';
import {
  kbMixOf,
  type ClassFlow,
  type RequestClass,
  type ResolvedWorkload,
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
  /** 通ったリクエストの 1 件あたり CPU の最大（ms。制限 cpu-ms-per-request の判定用）。 */
  maxCpuMsPerRequest: number;
  /** 接続・実行を保持している時間の合計（ms・月。ピークの同時数の判定用）。 */
  busyMs: number;
  /**
   * ピークの時間帯のヒット率（ResolvedWorkload.peakCacheHitRate）で流したときの busyMs（ms・月の換算）。
   * ピークの同時数の判定はこちらを使う（D-44）。
   */
  peakBusyMs: number;
  /** 止まる DB の動いている時間の割合（0〜1。止まらない DB では持たない）。 */
  awakeShare?: number;
  /** コンテナのサービスの、1 件以上を処理しているインスタンスの数の月の平均（D-88。コンテナのサービスだけ）。 */
  activeInstanceShare?: number;
  /**
   * コンテナのサービスで、届いたリクエストのうち動いているインスタンスが無く冷えた起動を待つ割合（0〜1。D-88）。
   * 最小インスタンスが 1 以上なら 0（話題の集中で増やすインスタンスの起動は数えない）。
   */
  coldStartShare?: number;
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

/** ノードごとの集計（ホストの容量と、関数の 1 回の実行の CPU の最大に使う）。 */
type NodeAcc = {
  kb: number;
  cpuMs: number;
  queries: number;
  transforms: number;
  /** ホストが受けたリクエストの数（前段の Web サーバーの CPU に使う。D-31）。 */
  requests: number;
  /** クラスごとの 1 件あたり CPU の最大（件数が正のものだけ）。 */
  maxCpuByClass: Partial<Record<RequestClass, number>>;
};

/**
 * 裏で走るクラスを起こす閲覧のクラス（prd/06 §5: ISR の再生成は閲覧のリクエストの中で裏で走る）。
 * waitUntil は同じ呼び出しの寿命を延ばす（"ctx.waitUntil() extends the lifetime of your Worker"）ので、
 * 裏の処理の CPU は起こした呼び出しの CPU 時間に数えると解釈する（公式に明記はない。D-10）。
 * 合算はルートごと（ResolvedWorkload.backgroundCpuMs）。
 */
const BACKGROUND_TRIGGER: Partial<Record<RequestClass, RequestClass>> = {
  'isr-revalidate': 'document-isr',
};

function add(u: NodeUsage, r: ResourceKey, v: number) {
  if (v === 0) return;
  u.resources[r] = (u.resources[r] ?? 0) + v;
}

/**
 * 期間つきのキャッシュを通った後の流れ（miss）。ルートごとの miss で重み付けした流れ（cacheMissFlow）を、
 * 届いた件数の割合で縮めて使う（OCL-48C8B649）。キャッシュの対象でなければ undefined。
 */
function ttlMiss(
  w: ResolvedWorkload,
  cls: RequestClass,
  f: ClassFlow,
  flush = false,
): ClassFlow | undefined {
  // ワイルドカードでまとめた無効化の CDN は、更新のたびにルートの全ページを失う（D-79）
  const miss = (flush ? w.cdnFlushMissFlow : w.cacheMissFlow)[cls];
  const total = w.classes[cls].count;
  if (!miss || total <= 0) return undefined;
  return { count: f.count * (miss.count / total), perRequest: miss.perRequest };
}

/** 1 ノードがクラスの流れを受け取ったときの使用量と、次のノードへ渡す流れ。 */
function consume(
  node: ArchNode,
  cls: RequestClass,
  f: ClassFlow,
  u: NodeUsage,
  w: ResolvedWorkload,
  hostAcc: NodeAcc,
): ClassFlow {
  const c = node.config;
  const n = f.count;
  const p = f.perRequest;
  switch (c.kind) {
    case 'cdn': {
      const ttl = c.ttlClasses?.includes(cls)
        ? ttlMiss(
            w,
            cls,
            f,
            // 更新のたびに消えるのは ISR のページだけ（API の応答のキャッシュは消さない。OCL-62E7477C）
            cls === 'document-isr' &&
              c.invalidationWildcardPathsPerUpdate !== undefined,
          )
        : undefined;
      add(
        u,
        'requests',
        c.requestUnitKB === undefined
          ? n * c.requestsPerItem
          : n *
              c.requestsPerItem *
              kbMixOf(p).reduce(
                (s, part) =>
                  s +
                  part.share *
                    Math.max(1, ceilUnits(part.kb, c.requestUnitKB!)),
                0,
              ),
      );
      add(u, 'egress-gb', kbToGb(n * (c.egressKBPerRequest ?? p.kb)));
      const out = ttl ?? {
        count:
          n * (1 - (c.ttlClasses?.includes(cls) ? 0 : (c.hitRate[cls] ?? 0))),
        perRequest: p,
      };
      if (!c.originClasses || c.originClasses.includes(cls)) {
        add(u, 'origin-transfer-gb', kbToGb(out.count * out.perRequest.kb));
      }
      return out;
    }
    case 'function':
    case 'container': {
      // コードの中のキャッシュ: ヒットはキャッシュから返す CPU だけ、miss は処理して次（DB）へ流す
      const cache = c.kind === 'function' ? c.cache : undefined;
      const missFlow = cache?.classes.includes(cls)
        ? ttlMiss(w, cls, f)
        : undefined;
      const miss = missFlow?.count ?? n;
      // 画像のクラスの変換の時間は、画像の形式による重さの倍率を掛ける（OCL-ECDEF8A1）
      const fixedCpu =
        c.classCpuMs?.[cls] === undefined
          ? undefined
          : c.classCpuMs[cls]! *
            (cls === 'image-read' || cls === 'image-transform'
              ? w.input.images.transformWorkFactor
              : 1);
      const base = missFlow?.perRequest ?? p;
      const mp =
        fixedCpu === undefined
          ? base
          : { ...base, cpuMs: fixedCpu, maxCpuMs: fixedCpu, wallMs: fixedCpu };
      const hits = n - miss;
      const hitCpu = missFlow ? cache!.hitCpuMs : 0;
      // 1 リクエストの CPU の最大は、件数が正の経路（miss の処理・ヒットの返却）それぞれの最大（OCL-8B3B0CB7）
      const maxCpu = Math.max(
        miss > 0 ? mp.maxCpuMs : 0,
        hits > 0 ? hitCpu : 0,
      );
      if (n > 0)
        hostAcc.maxCpuByClass[cls] = Math.max(
          hostAcc.maxCpuByClass[cls] ?? 0,
          maxCpu,
        );
      const wallMs = hits * hitCpu + miss * mp.wallMs;
      u.busyMs += wallMs;
      const cpuMs = hits * hitCpu + miss * mp.cpuMs;
      add(u, 'cpu-ms', cpuMs);
      // コンテナのサービスはインスタンスの時間を経路の後でまとめて出す（月の壁時計時間・CPU・件数から。D-88）
      if (c.kind === 'function')
        add(
          u,
          'memory-gb-hours',
          (wallMs / 3_600_000) * (c.memoryGB / c.concurrency),
        );
      else hostAcc.cpuMs += cpuMs;
      if (!c.backgroundClasses?.includes(cls)) {
        add(u, 'requests', n);
        add(u, 'invocations', n);
        u.events += n;
        hostAcc.requests += n;
      }
      return missFlow ?? f;
    }
    case 'kv': {
      if (c.mode === 'db') {
        // DB の代わり: 問い合わせ 1 回を読み取り 1 回、書く行 1 行を書き込み 1 回（仮定）
        add(u, 'kv-reads', n * p.queries);
        add(u, 'kv-writes', n * p.rowsWritten);
      } else if (cls === 'isr-revalidate') add(u, 'kv-writes', n);
      else add(u, 'kv-reads', n);
      return f;
    }
    case 'sql-db': {
      u.busyMs += n * p.wallMs;
      if (cls === 'image-read')
        add(u, 'rows-read', n); // 画像 1 枚 1 行（仮定）
      else if (cls === 'image-write') add(u, 'rows-written', n);
      else {
        add(u, 'rows-read', n * p.rowsRead);
        add(u, 'rows-written', n * p.rowsWritten);
      }
      return f;
    }
    case 'db-proxy': {
      u.busyMs += n * p.wallMs;
      add(u, 'queries', n * p.queries);
      return f;
    }
    case 'durable-object': {
      if (cls === 'realtime-message') {
        add(u, 'requests', n / c.messagesPerRequest);
        add(u, 'gb-seconds', ((n * p.cpuMs) / 1000) * c.memoryGB);
      } else add(u, 'requests', n);
      add(u, 'rows-read', n * p.rowsRead);
      add(u, 'rows-written', n * p.rowsWritten);
      return f;
    }
    case 'managed-db': {
      hostAcc.requests += n; // 止まる DB の動いている時間の割合に使う
      u.busyMs += n * p.wallMs; // 関数が接続を持っている間（壁時計時間）
      add(
        u,
        'egress-gb',
        kbToGb(n * p.queries * w.input.db.responseKBPerQuery),
      );
      return f;
    }
    case 'processing-db': {
      u.busyMs += n * p.wallMs;
      add(u, 'processing-units', n * c.unitsPerRequest);
      return f;
    }
    case 'request-db': {
      u.busyMs += n * p.wallMs;
      // 該当のアイテムが無い（応答 0 KB）読み取りも 1 単位を消費する（DynamoDB の文書。OCL-0E5E2CF2）
      const readUnits =
        Math.max(1, ceilUnits(w.input.db.responseKBPerQuery, c.readUnitKB)) *
        (c.eventuallyConsistent ? 0.5 : 1);
      add(u, 'read-request-units', n * p.queries * readUnits);
      add(
        u,
        'write-request-units',
        n * p.rowsWritten * ceilUnits(c.itemKB, c.writeUnitKB),
      );
      return f;
    }
    case 'object-storage': {
      // 投稿のときに作ったサイズ違いの書き込み（image-transform）も書き込み
      if (
        cls === 'image-write' ||
        cls === 'isr-revalidate' ||
        cls === 'image-transform'
      )
        add(u, 'object-writes', n);
      else if (c.cdnHitRate !== undefined) {
        // 事業者の CDN が配信する（Vercel Blob）: 転送とリクエストはヒットも含む全件、操作と origin への転送は miss だけ
        const miss = n * (1 - c.cdnHitRate);
        add(u, 'requests', n);
        add(u, 'egress-gb', kbToGb(n * p.kb));
        add(u, 'object-reads', miss);
        add(u, 'origin-transfer-gb', kbToGb(miss * p.kb));
      } else {
        add(u, 'object-reads', n);
        add(u, 'egress-gb', kbToGb(n * p.kb));
      }
      return f;
    }
    case 'image-optimizer': {
      if (cls === 'image-transform') {
        add(u, 'image-transformations', n);
        if (c.unitKB)
          add(u, 'image-cache-writes', n * ceilUnits(p.kb, c.unitKB));
      } else if (cls === 'image-read' && c.unitKB) {
        add(
          u,
          'image-cache-reads',
          n * c.cacheMissRate * ceilUnits(p.kb, c.unitKB),
        );
      }
      return f;
    }
    case 'isr-store': {
      const units = ceilUnits(p.kb, c.unitKB);
      if (cls === 'isr-revalidate')
        add(u, 'isr-writes', n * c.changedRate * units);
      else add(u, 'isr-reads', n * units);
      return f;
    }
    case 'ci-build':
      // 経路を持たない（ビルドの時間は staticUsage で数える。D-68）
      return f;
    case 'host': {
      // 他のサーバーから API として呼ばれるクラスは、描画でなく API の 1 回の CPU と応答の大きさ（D-69・OCL-4D1F5201）
      const api = c.serverApiClasses?.includes(cls)
        ? w.classes.api.perRequest
        : undefined;
      const kb = api?.kb ?? p.kb;
      hostAcc.kb += n * kb;
      hostAcc.requests += n;
      hostAcc.cpuMs += n * (api?.cpuMs ?? p.cpuMs);
      hostAcc.queries += n * p.queries;
      if (cls === 'image-transform') hostAcc.transforms += n;
      add(u, 'requests', n);
      add(u, 'egress-gb', kbToGb(n * kb));
      return f;
    }
  }
}

/** 経路に依存しない使用量（保存量・常時動くコンピュート）。 */
function staticUsage(node: ArchNode, u: NodeUsage, w: ResolvedWorkload) {
  switch (node.config.kind) {
    case 'sql-db':
      add(
        u,
        'storage-gb-month',
        (node.config.storesDb ? w.storage.dbGB : 0) +
          (node.config.storesImages ? w.storage.imagesGB : 0),
      );
      break;
    case 'managed-db':
      add(u, 'storage-gb-month', w.storage.dbGB);
      add(u, 'instance-hours', HOURS_PER_MONTH * node.config.capacityUnits);
      break;
    case 'processing-db':
      add(u, 'storage-gb-month', w.storage.dbGB);
      break;
    case 'request-db':
      add(u, 'storage-gb-month', w.storage.dbGB);
      break;
    case 'object-storage':
      add(
        u,
        'storage-gb-month',
        (node.config.storesImages
          ? w.storage.imagesGB + w.storage.variantsGB
          : 0) +
          w.storage.isrPagesGB * node.config.isrCacheSizeFactor,
      );
      break;
    case 'ci-build':
      // 静的なページのビルドし直し（D-68）。経路を持たない
      add(u, 'build-minutes', w.builds.minutes * node.config.cpusPerBuild);
      // 本番へのデプロイの回数（Netlify は 1 回ごとにクレジットを使う。D-71）
      add(u, 'deploys', w.builds.count);
      break;
    case 'cdn':
      // オンデマンドの再検証のたびに、ISR のページ（とそのデータのルート）を無効化する（D-66）
      // ワイルドカードでまとめるなら、更新 1 回あたりのパスで数える（D-79）
      if (node.config.ttlClasses?.includes('document-isr')) {
        const wildcard = node.config.invalidationWildcardPathsPerUpdate;
        const perPage = node.config.invalidationPathsPerPage;
        if (wildcard !== undefined)
          add(u, 'invalidation-paths', w.onDemandUpdates * wildcard);
        else if (perPage !== undefined)
          add(u, 'invalidation-paths', w.onDemandPageRevalidations * perPage);
      }
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
  const unroutedClasses: RequestClass[] = [];
  // ISR のページを期間つきでキャッシュする CDN（ttlClasses に document-isr）が前にあるか（さくらの VPS の前段の CDN で
  // HTML もキャッシュ。D-31）。あれば、再生成を起こすのは CDN を miss して ISR を返すノードに届いた閲覧だけ（D-55）
  const isrBehindTtlCache = (architecture.routes['document-isr'] ?? []).some(
    (id) => {
      const c = byId.get(id)?.config;
      return c?.kind === 'cdn' && !!c.ttlClasses?.includes('document-isr');
    },
  );

  /** クラスの流れを経路に流す。w の cacheHitRate で期間つきのキャッシュのヒットを決める。 */
  const run = (w: ResolvedWorkload, collectUnrouted: boolean, peak = false) => {
    const nodes: Record<string, NodeUsage> = {};
    const hostAcc = new Map<string, NodeAcc>();
    for (const n of architecture.nodes) {
      nodes[n.id] = {
        nodeId: n.id,
        resources: {},
        events: 0,
        maxCpuMsPerRequest: 0,
        busyMs: 0,
        peakBusyMs: 0,
      };
      hostAcc.set(n.id, {
        kb: 0,
        cpuMs: 0,
        queries: 0,
        transforms: 0,
        requests: 0,
        maxCpuByClass: {},
      });
      staticUsage(n, nodes[n.id]!, w);
    }
    for (const [cls, f] of Object.entries(w.classes) as [
      RequestClass,
      ClassFlow,
    ][]) {
      const path = architecture.routes[cls];
      if (!path) {
        if (collectUnrouted && f.count > 0) unroutedClasses.push(cls);
        continue;
      }
      // CDN の期間と ISR の期間は同じ（Next.js は s-maxage に再検証の間隔を付ける）ので、CDN を miss して届いた閲覧は
      // そのつど ISR の期間も切れていて、1 件が再生成を 1 回起こす（届いた閲覧 = 再生成）。月は従来の流れと同じで、
      // ピークの時間帯はルートごとのピークの miss で重み付けした再生成の流れ（件数と処理の両方。D-55・OCL-55732091）
      let current =
        cls === 'isr-revalidate' && isrBehindTtlCache && peak
          ? w.peakRevalidateFlow
          : f;
      for (const id of path) {
        current = consume(
          byId.get(id)!,
          cls,
          current,
          nodes[id]!,
          w,
          hostAcc.get(id)!,
        );
      }
    }
    return { nodes, hostAcc };
  };

  // 課金は月の平均のヒット率で流す。容量（ホストのピーク・同時数）は、ピークの時間帯のヒット率で流し直した値を使う
  // （その時間帯は閲覧の密度が高いので、期間つきのキャッシュがよく当たる。D-44）
  const { nodes, hostAcc } = run(workload, true);
  const hasPeakRates = Object.keys(workload.peakCacheHitRate).length > 0;
  const peakAcc = hasPeakRates
    ? run(
        {
          ...workload,
          cacheHitRate: workload.peakCacheHitRate,
          cacheMissFlow: workload.peakCacheMissFlow,
          cdnFlushMissFlow: workload.peakCdnFlushMissFlow,
        },
        false,
        true,
      )
    : { nodes, hostAcc };
  for (const n of architecture.nodes)
    nodes[n.id]!.peakBusyMs = peakAcc.nodes[n.id]!.busyMs;

  // 止まる DB（Aurora Serverless v2 の 0 ACU）: 待ちの秒数 T の間に 1 件も届かない時間だけ止まる。
  // 動いている割合は λT / (1 + λT)（月の平均の到着率。夜間に減る分は入れない）
  for (const n of architecture.nodes) {
    const c = n.config;
    if (c.kind !== 'managed-db' || c.pauseAfterIdleSeconds === undefined)
      continue;
    const lt =
      (hostAcc.get(n.id)!.requests / SECONDS_PER_MONTH) *
      c.pauseAfterIdleSeconds;
    const awake = lt / (1 + lt);
    nodes[n.id]!.awakeShare = awake;
    nodes[n.id]!.resources['instance-hours'] =
      HOURS_PER_MONTH * c.capacityUnits * awake;
  }

  // コンテナのサービス（Cloud Run の型。D-88）: 月のアクティブなインスタンスの秒数と、最小インスタンスの待機・冷えた起動の割合。
  // 時間帯の区間（D-89）ごとに到着率を出して積む。区間が 1 つ（hourlyProfile なし）なら月の平均の式（D-88）と同じ
  for (const n of architecture.nodes) {
    const c = n.config;
    if (c.kind !== 'container') continue;
    const u = nodes[n.id]!;
    const acc = hostAcc.get(n.id)!;
    let activeHours = 0;
    let idleHours = 0;
    let cold = 0;
    for (const b of workload.timeBuckets) {
      if (b.hours <= 0) continue;
      const s = b.hours * 3600;
      // 同時に処理している件数の平均（Σ λ × 壁時計時間）。区間の流れは月の流れ × share
      const x = (u.busyMs * b.share) / 1000 / s;
      // 1 件以上を処理しているインスタンスの数の平均（1 を超えうる）。到着がポアソンなら 1 件以上を処理している時間の割合は
      // 1 − e^(−x)。同時実行の上限（x / concurrency）と、CPU を使い切る分（CPU 秒 / vCPU）より少なくはならない
      const active = Math.max(
        -Math.expm1(-x),
        x / c.concurrency,
        (acc.cpuMs * b.share) / 1000 / s / c.vcpu,
      );
      activeHours += active * b.hours;
      idleHours += Math.max(0, c.minInstances - active) * b.hours;
      // 届いたリクエストのうち、直前の idleKeepSeconds に 1 件も届いていない（インスタンスが無い）割合。区間の件数の割合で重みづけ
      cold +=
        b.share * Math.exp(-((acc.requests * b.share) / s) * c.idleKeepSeconds);
    }
    add(u, 'cpu-hours', activeHours * c.vcpu);
    add(u, 'memory-gb-hours', activeHours * c.memoryGB);
    add(u, 'idle-cpu-hours', idleHours * c.vcpu);
    add(u, 'idle-memory-gb-hours', idleHours * c.memoryGB);
    u.activeInstanceShare = activeHours / HOURS_PER_MONTH;
    u.coldStartShare = c.minInstances > 0 || acc.requests <= 0 ? 0 : cold;
  }

  // 関数の 1 回の実行の CPU の最大: 前景のクラスはそのまま、裏のクラスは起こした閲覧の CPU に足す
  for (const n of architecture.nodes) {
    if (n.config.kind !== 'function' && n.config.kind !== 'container') continue;
    const bg = new Set(n.config.backgroundClasses ?? []);
    const byClass = Object.entries(hostAcc.get(n.id)!.maxCpuByClass) as [
      RequestClass,
      number,
    ][];
    const fg = byClass.filter(([cls]) => !bg.has(cls));
    const fgMax = Math.max(0, ...fg.map(([, v]) => v));
    let max = fgMax;
    for (const [cls, v] of byClass) {
      if (!bg.has(cls)) continue;
      const trigger = BACKGROUND_TRIGGER[cls];
      const triggered =
        trigger !== undefined &&
        hostAcc.get(n.id)!.maxCpuByClass[trigger] !== undefined;
      // 起こす閲覧がこの関数を通るなら、ルートごとに足した値。起こすクラスが分からなければ前景の最大に足す。
      // 起こす閲覧が通らなければ、裏の処理だけで 1 回の実行とみる
      const combined = triggered
        ? (workload.backgroundCpuMs[cls] ?? fgMax + v)
        : trigger === undefined
          ? fgMax + v
          : v;
      max = Math.max(max, combined);
    }
    nodes[n.id]!.maxCpuMsPerRequest = max;
  }

  for (const n of architecture.nodes) {
    if (n.config.kind !== 'host') continue;
    const acc = peakAcc.hostAcc.get(n.id)!;
    const c = n.config;
    const peak = workload.peakHourFactor / SECONDS_PER_MONTH;
    nodes[n.id]!.host = {
      peakMbps: (acc.kb * KB * 8 * peak) / 1_000_000,
      peakCores:
        ((acc.cpuMs +
          acc.queries * c.dbCpuMsPerQuery +
          acc.transforms * c.imageTransformCpuMs +
          acc.requests * c.proxyCpuMsPerRequest) /
          1000) *
        peak,
      memoryGB: c.residentMemoryGB,
      diskGB:
        (c.storesDb ? workload.storage.dbGB : 0) +
        (c.storesImages
          ? workload.storage.imagesGB + workload.storage.variantsGB
          : 0) +
        c.otherDiskGB,
    };
  }
  return { architecture, workload, nodes, unroutedClasses };
}
