// 構成図のモデル（D-105）。費用の計算に使う構成（catalog の composeStack が組む Architecture のノードと経路）から、
// 閲覧者から左→右（狭い幅では上→下）へ流れる図の箱と線を作る。構成ごとに手で描かない（計算と図がずれないように）。
//   - 列: 経路の中での位置（閲覧者から何段目か。経路をまたいで最も深い段）
//   - 行: 課金のアカウント（事業者）ごとの帯。課金の無いノード（Workers の静的アセットなど）は経路で隣のノードの事業者に入れる
//   - 線: 経路の隣り合うノードの組。リクエストクラスを「流れ」（ページの描き方・API・画像など）にまとめて線に載せる
//   - 経路に載らないノード（メールの送信・DNS・ドメイン・ビルド・バックアップ）は図の下に事業者ごとに並べる
//   - 向き: 横（列を左→右・帯を上→下）と縦（狭い幅。段を上→下・帯を左→右に並べ、箱を小さくする）。D-105 の補足
// 純粋関数。描画（system-diagram.tsx）は位置をそのまま使う。
import {
  composeStack,
  DEFAULT_CHOICES,
  STACK_DEFS,
  withoutUnusedEmail,
  type FrameworkId,
} from 'catalog';
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  frameworkDefaults,
  STACKS,
  staticBuildOf,
  type RegionSource,
  type RouteOverrides,
  type Scenario,
} from 'game';
import type { BrandId } from './brand-logos.tsx';

/**
 * 図に描く部品の選択。ゲームの始まり（newGame）と同じ重ね方: catalog の既定 → フレームワーク・シナリオの既定
 * （静的書き出しの Vercel の画像は投稿時の縮小など）→ 選んだ部品。始める画面で選ぶ前のスロットも、始めたときと同じ部品で描く。
 */
export function diagramComponents(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Partial<Record<string, string>> = {},
): Partial<Record<string, string>> {
  const platform = STACKS[stackIndex]!.provider;
  return {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(framework, platform, scenario),
    ...components,
  };
}

/**
 * 図に描く構成（費用の計算と同じ composeStack。アプリがメールを送らないシナリオでは、見積と同じく送信のノードを外す。D-101）。
 * components は部品の選択（選んでいないスロットは diagramComponents の既定）。
 */
export function diagramArchitecture(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Partial<Record<string, string>> = {},
  /** 選んだページごとの描き方（S1 のビルド・Astro の記事のキャッシュの有無が構成に効く。D-107）。 */
  routes?: RouteOverrides,
): ArchitectureInput {
  return withoutUnusedEmail(
    composeStack(
      STACK_DEFS[stackIndex]!,
      diagramComponents(scenario, stackIndex, framework, components),
      {
        framework,
        ...staticBuildOf(scenario, stackIndex, framework, routes),
      },
    ),
    scenario.template(1),
  );
}

/** 流れ（リクエストクラスのまとまり）。色は見取り図の作られ方の色にそろえる（ISR は info・SSR は warning など）。 */
export type LaneId =
  | 'static'
  | 'isr'
  | 'ssr'
  | 'island'
  | 'holes'
  | 'api'
  | 'image'
  | 'realtime'
  | 'revalidate';

export const LANES: Readonly<
  Record<LaneId, { label: string; classes: readonly RequestClass[] }>
> = {
  static: {
    label: '静的なページ・JS と CSS',
    classes: ['document-static', 'asset'],
  },
  isr: { label: 'ISR のページ（キャッシュ）', classes: ['document-isr'] },
  ssr: { label: '閲覧ごとに描くページ', classes: ['document-ssr'] },
  // 枠 + サーバーの島（S6。D-108）。島のリクエストは document-ssr で数えるので、クラスでなく見取り図の島の区画で分ける
  // （islandLanes。島の区画のあるページがあれば document-ssr の線に載せる）
  island: {
    label: 'サーバーの島（閲覧ごとに一部だけ描く）',
    classes: [],
  },
  // 部品ごとにキャッシュ（Cache Components。D-111）の人ごとに違う部分。島と同じく document-ssr を見取り図の区画で分ける
  holes: {
    label: '動的な穴（部品ごとにキャッシュ・閲覧ごとに一部だけ描く）',
    classes: [],
  },
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
    // Astro の Cloudflare では、消した後の閲覧が描き終わるのを待つ（裏ではない。D-103）
    label: 'ISR の再生成・キャッシュの描き直し',
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
  // Astro の記事（閲覧時に描いてキャッシュし、投稿で消す。D-103）は ISR と同じ経路（document-isr・isr-revalidate）
  cached: 'isr',
  ssr: 'ssr',
  api: 'api',
  island: 'api',
  'island-shell': 'island',
  'server-island': 'island',
  // キャッシュした部品は ISR と同じ置き場（Vercel は枠を全体の ISR のキャッシュに置く。D-111）
  'cc-cached': 'isr',
  'cc-dynamic': 'holes',
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
  /** 短い名前（縦の図の小さい箱に出す。括弧の補足を外したもの）。 */
  short: string;
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
/** 図の向き。横は列を左→右、縦（狭い幅）は段を上→下に積む。 */
export type Orientation = 'horizontal' | 'vertical';
export type DiagramModel = {
  orientation: Orientation;
  /** 箱の大きさ（向きで違う）。 */
  node: { w: number; h: number };
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

/** 戻る線が箱の下（縦の図では右）を回る深さ。 */
export const BACK_LOOP = 24;
/** 線の終わりの、入る向きにまっすぐな部分の長さ（矢印の先端の長さより長く。矢印の向きと線の向きをそろえる）。 */
export const EDGE_TAIL = 10;
/** 矢印の先端の長さ（図の座標。描画の marker と同じ）。 */
export const ARROW = 8;

/** 入れ物がこの幅（sm）より狭く、横の図が縮めずには収まらないときは、縦の図にする。 */
export const NARROW_BELOW = 640;
/**
 * 縦の図にするか。入れ物の幅（ResizeObserver で測る。0 = まだ測れていない・畳まれている）と横の図の幅で決める。
 * 入れ物が sm 以上か、横の図がそのまま収まるなら横の図（広い幅の見た目は変えない）。
 */
export const isNarrow = (containerWidth: number, horizontalWidth: number) =>
  containerWidth > 0 &&
  containerWidth < Math.min(NARROW_BELOW, horizontalWidth);

/** 横の図の寸法（列 = colGap で左→右、同じ列の箱 = rowGap で上→下）。 */
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
 * 縦の図（狭い幅）の寸法。段 = colGap で上→下、同じ段の箱 = rowGap で左→右。箱は短い名前だけの小さい箱で、
 * 詳しい説明は箱を押して出す。帯の頭（bandHeader）は帯の上の左端にロゴだけを置く（線は箱の真ん中から入るので重ならない）。
 */
export const LAYOUT_VERTICAL = {
  viewerW: 84,
  viewerH: 28,
  nodeW: 56,
  nodeH: 40,
  colGap: 30,
  rowGap: 4,
  bandHeader: 16,
  bandGap: 8,
  bandPad: 4,
  pad: 4,
} as const satisfies Record<keyof typeof LAYOUT, number>;

/**
 * 構成図のモデルを作る。pages はページの見取り図（D-102）で、流れごとに通るページの名前を添える（省略可）。
 */
export function diagramModel(
  arch: ArchitectureInput,
  pages: readonly {
    label: string;
    regions: readonly { source: RegionSource }[];
  }[] = [],
  orientation: Orientation = 'horizontal',
): DiagramModel {
  const routes = Object.entries(arch.routes).filter(
    (e): e is [RequestClass, string[]] => (e[1]?.length ?? 0) > 0,
  );
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));
  // 閲覧ごとに描く経路（document-ssr）の流れ: サーバーの島（S6）のページがあれば島、毎回描くページがあれば（または
  // 見取り図が無ければ）SSR。両方あれば両方の線を並べる（D-108）
  const sources = new Set(pages.flatMap((p) => p.regions.map((r) => r.source)));
  const ssrLanes: LaneId[] = [
    ...(sources.has('ssr') ||
    (!sources.has('server-island') && !sources.has('cc-dynamic'))
      ? (['ssr'] as const)
      : []),
    ...(sources.has('server-island') ? (['island'] as const) : []),
    ...(sources.has('cc-dynamic') ? (['holes'] as const) : []),
  ];
  const lanesOf = (cls: RequestClass): LaneId[] =>
    cls === 'document-ssr' ? ssrLanes : [laneOf(cls)];

  // --- 線（経路の隣り合う組 + 閲覧者から入口）
  const edgeMap = new Map<string, DiagramEdge>();
  const addEdge = (from: string, to: string, cls: RequestClass) => {
    const key = `${from}>${to}`;
    const e = edgeMap.get(key) ?? { from, to, lanes: [], classes: [] };
    if (!e.classes.includes(cls)) e.classes.push(cls);
    for (const lane of lanesOf(cls))
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

  const vertical = orientation === 'vertical';
  const L = vertical ? LAYOUT_VERTICAL : LAYOUT;
  // 段（閲覧者からの深さ）の位置。横の図は x、縦の図は y
  const colX = (d: number) =>
    L.pad +
    (vertical ? L.viewerH : L.viewerW) +
    L.colGap +
    (d - 1) * ((vertical ? L.nodeH : L.nodeW) + L.colGap);
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
  // 帯を積む位置（横の図は y を上→下、縦の図は x を左→右）
  let y = L.pad;
  for (const g of groupOrder) {
    const members = routed.filter((n) => accountOf(n.id) === g);
    const cells = new Map<number, number>();
    let rows = 0;
    let minD = Infinity;
    let maxD = 0;
    const top = y + (vertical ? L.bandPad : L.bandHeader);
    for (const n of members) {
      const d = depth.get(n.id)!;
      const row = cells.get(d) ?? 0;
      cells.set(d, row + 1);
      rows = Math.max(rows, row + 1);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      const across = top + row * ((vertical ? L.nodeW : L.nodeH) + L.rowGap);
      nodes.push({
        ...nodeView(n, g),
        depth: d,
        ...(vertical ? { x: across, y: colX(d) } : { x: colX(d), y: across }),
      });
    }
    const brand = ACCOUNT_BRAND[g];
    let box: NonNullable<DiagramGroup['box']>;
    if (vertical) {
      const w = 2 * L.bandPad + rows * (L.nodeW + L.rowGap) - L.rowGap;
      box = {
        x: y,
        y: colX(minD) - L.bandHeader,
        w,
        h: colX(maxD) - colX(minD) + L.nodeH + L.bandHeader + L.bandPad,
      };
      y += w + L.bandGap;
    } else {
      const h =
        L.bandHeader + rows * (L.nodeH + L.rowGap) - L.rowGap + L.bandPad;
      box = {
        x: colX(minD) - L.bandPad,
        y,
        w: colX(maxD) - colX(minD) + L.nodeW + 2 * L.bandPad,
        h,
      };
      y += h + L.bandGap;
    }
    groups.push({ account: g, ...(brand ? { brand } : {}), box });
  }
  const maxDepth = Math.max(1, ...depth.values());
  // 戻る線は箱の下（縦の図では右）を回るので、その分だけ空ける
  const loop = back.size > 0 ? BACK_LOOP : 0;
  const across = Math.max(
    y - L.bandGap + L.pad,
    (vertical ? L.viewerW : L.viewerH) + 2 * L.pad,
  );
  const along =
    colX(maxDepth) + (vertical ? L.nodeH : L.nodeW) + L.bandPad + L.pad;
  const width = vertical ? across + loop : along;
  const height = vertical ? along : across + loop;

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
    orientation,
    node: { w: L.nodeW, h: L.nodeH },
    width,
    height,
    // 閲覧者は流れの始まりの端の真ん中（横の図は左、縦の図は上）
    viewer: vertical
      ? { x: across / 2 - L.viewerW / 2, y: L.pad, w: L.viewerW, h: L.viewerH }
      : { x: L.pad, y: height / 2 - L.viewerH / 2, w: L.viewerW, h: L.viewerH },
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
    short: shortLabel(n.label),
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

/** 強調する流れ（選んでいた流れが今の図に無ければ強調しない）。 */
export function activeLane(
  chosen: LaneId | null,
  model: Pick<DiagramModel, 'lanes'>,
): LaneId | null {
  return chosen !== null && model.lanes.some((l) => l.id === chosen)
    ? chosen
    : null;
}

/** 短い名前: 括弧の補足（「Worker（vinext）」の「（vinext）」）を外す。外すと何も残らないときは元の名前。 */
export function shortLabel(label: string): string {
  const s = label.replace(/（[^）]*）/g, '').trim();
  return s === '' ? label : s;
}

/** ノードを通る流れ（入る線と出る線の流れ。LANE_ORDER の順）。 */
export function lanesThrough(model: DiagramModel, id: string): LaneId[] {
  const set = new Set(
    model.edges
      .filter((e) => e.from === id || e.to === id)
      .flatMap((e) => e.lanes),
  );
  return LANE_ORDER.filter((l) => set.has(l));
}

type Pt = { x: number; y: number };
export type EdgeGeometry = {
  start: Pt;
  c1: Pt;
  c2: Pt;
  mid: Pt;
  end: Pt;
  /** SVG の path（M start C c1 c2 mid L end）。 */
  d: string;
};

/**
 * 線の形: start から 3 次ベジェ（c1・c2）で mid まで曲がり、mid から end へ、箱に入る向きにまっすぐ進む（長さ EDGE_TAIL）。
 * 曲がりが強いと、ベジェの終わりのわずかな区間で向きが急に変わり、終わりの接線に付く矢印の先端（marker の orient="auto"）が、
 * 見えている線の向きとずれる。終わりを矢印より長いまっすぐな線にし、c2 → mid もその向きにそろえて（つなぎ目でも折れない）、
 * 矢印の向き・線の終わりの向き・曲線の終わりの接線を一致させる。off は同じ組の中で流れを並べるずれ（流れと直交する向き）。
 *   - 横の図: 箱の右から出て、次の箱の左へ右向きに入る（戻る線は箱の下から出て下を回り、戻り先の箱の下へ上向きに入る）
 *   - 縦の図: 箱の下から出て、次の箱の上へ下向きに入る（戻る線は箱の右から出て右を回り、戻り先の箱の右へ左向きに入る）
 */
export function edgeGeometry(
  model: DiagramModel,
  e: Pick<DiagramEdge, 'from' | 'to' | 'back'>,
  off: number,
): EdgeGeometry | undefined {
  const rect = (id: string) => {
    if (id === VIEWER) return model.viewer;
    const n = model.nodes.find((x) => x.id === id);
    return n && { x: n.x, y: n.y, w: model.node.w, h: model.node.h };
  };
  const a = rect(e.from);
  const b = rect(e.to);
  if (!a || !b) return undefined;
  const vertical = model.orientation === 'vertical';
  // 流れの軸（横の図は x、縦の図は y）と、それに直交する軸で書き、点にするときに入れ替える
  const P = (along: number, across: number): Pt =>
    vertical ? { x: across, y: along } : { x: along, y: across };
  const axes = (r: { x: number; y: number; w: number; h: number }) =>
    vertical
      ? { s: r.y, len: r.h, c: r.x, wid: r.w }
      : { s: r.x, len: r.w, c: r.y, wid: r.h };
  const A = axes(a);
  const B = axes(b);
  let g: Omit<EdgeGeometry, 'd'>;
  if (e.back) {
    // 流れと直交する向きの向こう側（横の図は下・縦の図は右）を回る
    const aSide = A.c + A.wid;
    const bSide = B.c + B.wid;
    const aMid = A.s + A.len / 2 + off;
    const bMid = B.s + B.len / 2 + off;
    g = {
      start: P(aMid, aSide),
      c1: P(aMid, aSide + BACK_LOOP),
      c2: P(bMid, bSide + BACK_LOOP),
      mid: P(bMid, bSide + EDGE_TAIL),
      end: P(bMid, bSide + 1),
    };
  } else {
    const aOut = A.s + A.len;
    const bIn = B.s;
    const aMid = A.c + A.wid / 2 + off;
    const bMid = B.c + B.wid / 2 + off;
    const m = bIn - EDGE_TAIL;
    const k = Math.max(8, (m - aOut) / 2);
    g = {
      start: P(aOut, aMid),
      c1: P(aOut + k, aMid),
      c2: P(m - k, bMid),
      mid: P(m, bMid),
      end: P(bIn - 1, bMid),
    };
  }
  const f = (p: Pt) => `${p.x},${p.y}`;
  return {
    ...g,
    d: `M${f(g.start)} C${f(g.c1)} ${f(g.c2)} ${f(g.mid)} L${f(g.end)}`,
  };
}
