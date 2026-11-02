// 構成図のモデル（D-105）。費用の計算に使う構成（catalog の composeStack が組む Architecture のノードと経路）から、
// 閲覧者から左→右へ流れる図の箱と線を作る。構成ごとに手で描かない（計算と図がずれないように）。
//   - 列: 経路の中での位置（閲覧者から何段目か。経路をまたいで最も深い段）
//   - 行: 課金のアカウント（事業者）ごとの帯。課金の無いノード（Workers の静的アセットなど）は経路で隣のノードの事業者に入れる
//   - 線: 経路の隣り合うノードの組。リクエストクラスを「流れ」（ページの描き方・API・画像など）にまとめて線に載せる
//   - 経路に載らないノード（メールの送信・DNS・ドメイン・ビルド・バックアップ）は図の下に事業者ごとに並べる
// 純粋関数。描画（system-diagram.tsx）は位置をそのまま使う。
import {
  composeStack,
  STACK_DEFS,
  withoutUnusedEmail,
  type FrameworkId,
} from 'catalog';
import type { ArchitectureInput, RequestClass } from 'estimator';
import type { RegionSource, Scenario } from 'game';
import type { BrandId } from './brand-logos.tsx';

/**
 * 図に描く構成（費用の計算と同じ composeStack。アプリがメールを送らないシナリオでは、見積と同じく送信のノードを外す。D-101）。
 * components は部品の選択（選んでいないスロットは composeStack が既定で埋める）。
 */
export function diagramArchitecture(
  scenario: Pick<Scenario, 'template'>,
  stackIndex: number,
  framework: FrameworkId,
  components: Partial<Record<string, string>> = {},
): ArchitectureInput {
  return withoutUnusedEmail(
    composeStack(STACK_DEFS[stackIndex]!, components, { framework }),
    scenario.template(1),
  );
}

/** 流れ（リクエストクラスのまとまり）。色は見取り図の作られ方の色にそろえる（ISR は info・SSR は warning など）。 */
export type LaneId =
  'static' | 'isr' | 'ssr' | 'api' | 'image' | 'realtime' | 'revalidate';

export const LANES: Readonly<
  Record<LaneId, { label: string; classes: readonly RequestClass[] }>
> = {
  static: {
    label: '静的なページ・JS と CSS',
    classes: ['document-static', 'asset'],
  },
  isr: { label: 'ISR のページ（キャッシュ）', classes: ['document-isr'] },
  ssr: { label: '閲覧ごとに描くページ', classes: ['document-ssr'] },
  api: { label: 'API', classes: ['api', 'api-content'] },
  image: {
    label: '画像（表示・投稿・変換）',
    classes: ['image-read', 'image-write', 'image-transform'],
  },
  realtime: {
    label: 'リアルタイム',
    classes: ['realtime-connect', 'realtime-message'],
  },
  revalidate: {
    label: 'ISR の再生成（裏で動く）',
    classes: ['isr-revalidate'],
  },
};
export const LANE_ORDER = Object.keys(LANES) as LaneId[];

const laneOf = (cls: RequestClass): LaneId =>
  LANE_ORDER.find((l) => LANES[l].classes.includes(cls)) ?? 'api';

/** 閲覧者から来ないクラス（同じ実行の中・関数が自分で起こす）。 */
const INTERNAL: readonly RequestClass[] = ['isr-revalidate'];

/** 見取り図の作られ方 → 流れ（ページの名前を流れに添える）。 */
const SOURCE_LANE: Readonly<Record<RegionSource, LaneId>> = {
  build: 'static',
  shell: 'static',
  isr: 'isr',
  ssr: 'ssr',
  api: 'api',
  island: 'api',
  image: 'image',
};

/** ノードの種類の短い名前（箱の上の小さい字）。 */
const KIND_CAPTION: Readonly<Record<string, string>> = {
  cdn: '配信・中継',
  function: '関数',
  container: 'コンテナ',
  host: 'サーバー',
  kv: 'KV',
  'sql-db': 'DB',
  'db-proxy': 'DB への接続',
  'durable-object': 'リアルタイム',
  'managed-db': 'DB',
  'processing-db': 'DB',
  'request-db': 'DB',
  'object-storage': 'ストレージ',
  'image-optimizer': '画像の変換',
  'isr-store': 'ISR のキャッシュ',
  'ci-build': 'ビルド',
  'db-backup': 'バックアップ',
  'email-sender': 'メールの送信',
  'dns-zone': 'DNS',
  'domain-registration': 'ドメイン',
};
/** 処理を動かすノード（図で太く描く）。 */
const COMPUTE_KINDS = new Set(['function', 'container', 'host']);
export const isComputeKind = (kind: string) => COMPUTE_KINDS.has(kind);

/** 課金のアカウント → ロゴ。無いもの（未知のアカウント）は名前だけ。 */
const ACCOUNT_BRAND: Readonly<Record<string, BrandId>> = {
  cloudflare: 'cloudflare',
  vercel: 'vercel',
  supabase: 'supabase',
  sakura: 'sakura',
  aws: 'aws',
  gcp: 'gcp',
  neon: 'neon',
  resend: 'resend',
  bunny: 'bunny',
  netlify: 'netlify',
};

export const VIEWER = 'viewer';
export const VIEWER_LABEL = '閲覧者（ブラウザ）';

export type DiagramNode = {
  id: string;
  label: string;
  kind: string;
  caption: string;
  compute: boolean;
  billed: boolean;
  group: string;
  /** 閲覧者を 0 とした列（経路に載らないノードは undefined）。 */
  depth?: number;
  x: number;
  y: number;
};
export type DiagramEdge = {
  from: string;
  to: string;
  /** 流れ（LANE_ORDER の順）と、そのもとのクラス。 */
  lanes: LaneId[];
  classes: RequestClass[];
  /** 左へ戻る線（経路の輪。列を決めるのに使わない）。 */
  back?: boolean;
};
export type DiagramGroup = {
  account: string;
  brand?: BrandId;
  /** 帯の枠（経路に載るノードが無い帯は box なし）。 */
  box?: { x: number; y: number; w: number; h: number };
};
export type DiagramLane = { id: LaneId; label: string; pages: string[] };
export type DiagramModel = {
  width: number;
  height: number;
  viewer: { x: number; y: number; w: number; h: number };
  nodes: DiagramNode[];
  /** 経路に載らないノード（図の下に事業者ごとに並べる）。 */
  side: { group: string; brand?: BrandId; nodes: DiagramNode[] }[];
  edges: DiagramEdge[];
  groups: DiagramGroup[];
  lanes: DiagramLane[];
};

/** 戻る線が箱の下を回る深さ。 */
export const BACK_LOOP = 24;

export const LAYOUT = {
  viewerW: 64,
  viewerH: 64,
  nodeW: 156,
  nodeH: 66,
  colGap: 36,
  rowGap: 8,
  bandHeader: 22,
  bandGap: 12,
  bandPad: 8,
  pad: 6,
} as const;

/**
 * 構成図のモデルを作る。pages はページの見取り図（D-102）で、流れごとに通るページの名前を添える（省略可）。
 */
export function diagramModel(
  arch: ArchitectureInput,
  pages: readonly {
    label: string;
    regions: readonly { source: RegionSource }[];
  }[] = [],
): DiagramModel {
  const routes = Object.entries(arch.routes).filter(
    (e): e is [RequestClass, string[]] => (e[1]?.length ?? 0) > 0,
  );
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));

  // --- 線（経路の隣り合う組 + 閲覧者から入口）
  const edgeMap = new Map<string, DiagramEdge>();
  const addEdge = (from: string, to: string, cls: RequestClass) => {
    const key = `${from}>${to}`;
    const e = edgeMap.get(key) ?? { from, to, lanes: [], classes: [] };
    if (!e.classes.includes(cls)) e.classes.push(cls);
    const lane = laneOf(cls);
    if (!e.lanes.includes(lane)) e.lanes.push(lane);
    edgeMap.set(key, e);
  };
  for (const [cls, path] of routes) {
    if (!INTERNAL.includes(cls)) addEdge(VIEWER, path[0]!, cls);
    for (let i = 1; i < path.length; i++) addEdge(path[i - 1]!, path[i]!, cls);
  }
  // 裏で動くクラスの入口が閲覧者から届かないなら、閲覧者から結ぶ（届かない箱を残さない）
  const reached = () => {
    const seen = new Set([VIEWER]);
    for (let changed = true; changed;) {
      changed = false;
      for (const e of edgeMap.values())
        if (seen.has(e.from) && !seen.has(e.to)) {
          seen.add(e.to);
          changed = true;
        }
    }
    return seen;
  };
  for (const [cls, path] of routes)
    if (INTERNAL.includes(cls) && !reached().has(path[0]!))
      addEdge(VIEWER, path[0]!, cls);
  const edges: DiagramEdge[] = [...edgeMap.values()].map((e) => ({
    ...e,
    lanes: LANE_ORDER.filter((l) => e.lanes.includes(l)),
  }));

  // --- 輪を切る（事業者の外への転送のノードは、行きと帰りの両方の経路に載ることがある。例: Cloudflare の SPA + AWS の API の
  // 「AWS → インターネット」は API の応答と R2 への書き込みの両方）。閲覧者から深さ優先で辿り、戻る線（back）は列を決めるのに使わない
  const out = new Map<string, DiagramEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const back = new Set<DiagramEdge>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 'open') back.add(e);
      else if (s === undefined) visit(e.to);
    }
    state.set(id, 'done');
  };
  visit(VIEWER);

  // --- 列（閲覧者からの最も深い段。戻る線を除けば輪は無いが、念のため段の数で打ち切る）
  const depth = new Map<string, number>();
  const limit = arch.nodes.length + 1;
  for (let round = 0; round < limit; round++) {
    let changed = false;
    for (const e of edges) {
      if (back.has(e)) continue;
      const d = (e.from === VIEWER ? 0 : (depth.get(e.from) ?? 0)) + 1;
      if (d > (depth.get(e.to) ?? 0) && d <= limit) {
        depth.set(e.to, d);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // --- 帯（課金のアカウント。無いノードは経路で次・前のノードのアカウント、無ければ最初の課金先）
  const fallback =
    arch.nodes.find((n) => n.billing)?.billing?.accountId ?? 'other';
  const accountOf = (id: string, seen = new Set<string>()): string => {
    const n = byId.get(id);
    if (n?.billing) return n.billing.accountId;
    if (seen.has(id)) return fallback;
    seen.add(id);
    for (const [, path] of routes) {
      const i = path.indexOf(id);
      if (i >= 0 && i + 1 < path.length) return accountOf(path[i + 1]!, seen);
    }
    for (const [, path] of routes) {
      const i = path.indexOf(id);
      if (i > 0) return accountOf(path[i - 1]!, seen);
    }
    return fallback;
  };

  const L = LAYOUT;
  const colX = (d: number) =>
    L.pad + L.viewerW + L.colGap + (d - 1) * (L.nodeW + L.colGap);
  const routed = arch.nodes.filter((n) => depth.has(n.id));
  const groupOrder: string[] = [];
  for (const n of [...routed].sort(
    (a, b) => depth.get(a.id)! - depth.get(b.id)!,
  )) {
    const g = accountOf(n.id);
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  const nodes: DiagramNode[] = [];
  const groups: DiagramGroup[] = [];
  let y = L.pad;
  for (const g of groupOrder) {
    const members = routed.filter((n) => accountOf(n.id) === g);
    const cells = new Map<number, number>();
    let rows = 0;
    let minD = Infinity;
    let maxD = 0;
    const top = y + L.bandHeader;
    for (const n of members) {
      const d = depth.get(n.id)!;
      const row = cells.get(d) ?? 0;
      cells.set(d, row + 1);
      rows = Math.max(rows, row + 1);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      nodes.push({
        ...nodeView(n, g),
        depth: d,
        x: colX(d),
        y: top + row * (L.nodeH + L.rowGap),
      });
    }
    const h = L.bandHeader + rows * (L.nodeH + L.rowGap) - L.rowGap + L.bandPad;
    const brand = ACCOUNT_BRAND[g];
    groups.push({
      account: g,
      ...(brand ? { brand } : {}),
      box: {
        x: colX(minD) - L.bandPad,
        y,
        w: colX(maxD) - colX(minD) + L.nodeW + 2 * L.bandPad,
        h,
      },
    });
    y += h + L.bandGap;
  }
  const maxDepth = Math.max(1, ...depth.values());
  // 戻る線は箱の下を回るので、その分だけ下を空ける
  const height =
    Math.max(y - L.bandGap + L.pad, L.viewerH + 2 * L.pad) +
    (back.size > 0 ? BACK_LOOP : 0);
  const width = colX(maxDepth) + L.nodeW + L.bandPad + L.pad;

  // --- 経路に載らないノード（事業者ごと。経路の帯の順、その後に新しい事業者）
  const side: DiagramModel['side'] = [];
  for (const n of arch.nodes) {
    if (depth.has(n.id)) continue;
    const g = accountOf(n.id);
    let s = side.find((x) => x.group === g);
    if (!s) {
      const brand = ACCOUNT_BRAND[g];
      s = { group: g, ...(brand ? { brand } : {}), nodes: [] };
      side.push(s);
    }
    s.nodes.push({ ...nodeView(n, g), x: 0, y: 0 });
    if (!groups.some((x) => x.account === g)) {
      const brand = ACCOUNT_BRAND[g];
      groups.push({ account: g, ...(brand ? { brand } : {}) });
    }
  }
  side.sort(
    (a, b) =>
      rank(groups, a.group) - rank(groups, b.group) ||
      a.group.localeCompare(b.group),
  );

  // --- 流れ（図に出るものだけ。見取り図のページの名前を添える）
  const used = new Set(edges.flatMap((e) => e.lanes));
  const lanes = LANE_ORDER.filter((l) => used.has(l)).map((l) => ({
    id: l,
    label: LANES[l].label,
    pages: pages
      .filter((p) => p.regions.some((r) => SOURCE_LANE[r.source] === l))
      .map((p) => p.label),
  }));

  return {
    width,
    height,
    viewer: {
      x: L.pad,
      y: height / 2 - L.viewerH / 2,
      w: L.viewerW,
      h: L.viewerH,
    },
    nodes,
    side,
    edges: edges.map((e) => (back.has(e) ? { ...e, back: true } : e)),
    groups,
    lanes,
  };
}

const rank = (groups: DiagramGroup[], g: string) => {
  const i = groups.findIndex((x) => x.account === g);
  return i < 0 ? groups.length : i;
};

function nodeView(
  n: ArchitectureInput['nodes'][number],
  group: string,
): Omit<DiagramNode, 'x' | 'y' | 'depth'> {
  const kind = n.config.kind;
  return {
    id: n.id,
    label: n.label,
    kind,
    caption: KIND_CAPTION[kind] ?? kind,
    compute: isComputeKind(kind),
    billed: n.billing !== undefined,
    group,
  };
}

/** ノードの名前（閲覧者を含む）。 */
export function labelOf(model: DiagramModel, id: string): string {
  if (id === VIEWER) return VIEWER_LABEL;
  return (
    model.nodes.find((n) => n.id === id)?.label ??
    model.side.flatMap((s) => s.nodes).find((n) => n.id === id)?.label ??
    id
  );
}

/** 図の要約（role="img" の aria-label）。 */
export function diagramSummary(
  model: DiagramModel,
  groupTitle: (g: string) => string,
): string {
  const first = model.edges
    .filter((e) => e.from === VIEWER)
    .map((e) => labelOf(model, e.to));
  const providers = [
    ...new Set([...model.groups.map((g) => groupTitle(g.account))]),
  ];
  return `構成図: 閲覧者のリクエストは ${first.join('・')} に届く。部品 ${model.nodes.length + model.side.reduce((a, s) => a + s.nodes.length, 0)} 個、事業者は ${providers.join('・')}`;
}
