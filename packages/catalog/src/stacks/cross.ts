// 事業者をまたぐ構成の差し方（prd/11 §2・D-52・D-114）。他の事業者の部品（parts.ts）を、土台の構成のノードの役割（role）から
// 外すノードと経路を導いて差す。差せる組は接続の規則（connections.ts）で決まり、事業者の間の転送は送り手の送り出しと
// 受け手の受け取りの項目をそれぞれ数える（CP-06）。今の組は「画像だけ Cloudflare（R2 + 変換）・Bunny」と、API の置き場
// （SPA は D-65・Next.js と VPS は D-67・Astro は D-69）、DB だけ Neon・AWS（D-77・D-114 段 2・段 2b）、メールの送信（D-95）、Bunny の前段の CDN（D-98）。
// DB の部品は、規則が要る中継（Cloudflare の Hyperdrive。CP-05）を自動で足す（applyCrossDb）。
// 既存の Cloudflare + Hyperdrive（Supabase）・さくらの VPS + 前段の CDN（Cloudflare）は、土台の事業者の部品として
// 先に入っていたもの（D-24 X-6・D-31）で、規則の外にある（アカウントの数は accountsOf で同じく数える。Hyperdrive のノードは中継と共通の hyperdriveNode）。
import type { ArchitectureInput, RequestClass } from 'estimator';
import {
  COMPUTE_MEMORY_GB,
  bill as awsBill,
  dbNode as awsDbNode,
} from './aws.ts';
import { vpsNode } from './sakura.ts';
import { BUNNY_IMAGE_HIT_RATE, bunnyBill, bunnyCdnNode } from './bunny.ts';
import { browserCallsApi, type FrameworkId } from '../frameworks/index.ts';
import {
  inboundOf,
  isTransferNode,
  outboundOf,
  RELAYS,
  relaysFor,
  storeAcceptsFromOutside,
  transferNodes,
  type RelayId,
} from './connections.ts';
import { CROSS_COMPONENTS, CROSS_PARTS } from './parts.ts';
import type {
  Choices,
  ComponentOption,
  ComponentProvider,
  Platform,
  SlotId,
} from './index.ts';

export { CROSS_COMPONENTS, CROSS_PARTS } from './parts.ts';
export { isTransferNode } from './connections.ts';

/** API を他の事業者に置いているか（SPA の API の置き場・D-65。既定・省略は同じ事業者）。 */
export const apiPlacedElsewhere = (c: Choices): boolean =>
  c.api !== undefined && c.api !== 'same';

/** 部品を差せる土台の事業者（省略は自分の事業者だけ）。 */
export const hostsOf = (c: ComponentOption): readonly ComponentProvider[] =>
  c.hosts ?? [c.platform];

/** 部品の振る舞いの id（他の事業者の部品は、同じ振る舞いの部品の id。それ以外はそのまま）。 */
export function behaviorOf(
  options: readonly ComponentOption[],
  host: Platform,
  slot: SlotId,
  id: string | undefined,
): string | undefined {
  const o = options.find(
    (x) => x.slot === slot && x.id === id && hostsOf(x).includes(host),
  );
  return o?.link?.as ?? id;
}

/** 構成の課金のアカウント（ノードの billing.accountId の種類。出てきた順）。 */
export function accountsOf(arch: ArchitectureInput): string[] {
  return [
    ...new Set(
      arch.nodes.flatMap((n) => (n.billing ? [n.billing.accountId] : [])),
    ),
  ];
}

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** Cloudflare の画像のドメインのキャッシュのヒット率（仮定。Cloudflare の構成の R2 公開バケットと同じ値）。 */
const CF_IMAGE_HIT_RATE = 0.9;

/** 画像の経路（読む・書く・変換）。 */
const IMAGE_CLASSES: readonly RequestClass[] = [
  'image-read',
  'image-write',
  'image-transform',
];

/** 画像の差し方（外す土台のノード・投稿の経路の部品の手前まで・足す転送のノード）。 */
type ImageShape = { remove: string[]; write: string[]; out: ArchNodeIn[] };

/**
 * 土台の画像の部品を、役割の印（role）から導いて外す（D-114。土台のノードの id に頼らない）。
 * - 外す: 画像の経路にある置き場（object-store）・変換（image-transform）と、画像を配るだけの CDN（image-read にあり、
 *   画像の外の経路に無い edge-cdn。Amplify の画像だけの CloudFront）。投稿を受ける口（Netlify の upload）は残す。
 * - 投稿の経路: 土台の image-write から外したノードを除き、最後の処理（compute）から部品の事業者へ送るデータを、
 *   送り手の送り出し・受け手の受け取りの項目で数える（transferNodes。CP-06）。
 *   例: Vercel の関数・Amplify の SSR は料金の文書に項目が無いので数えない。Lambda（OpenNext・SPA）は東京 → インターネット、
 *   Netlify Functions は Netlify の転送量、Cloud Run は Premium Tier のインターネットへの転送で数える。R2・Bunny は受け取りに課金しない。
 * 投稿を受ける処理が無い土台では差さない（undefined）。
 */
function imageShape(
  arch: ArchitectureInput,
  provider: ComponentProvider,
  target: string,
): ImageShape | undefined {
  const routes = arch.routes;
  const onImage = new Set(IMAGE_CLASSES.flatMap((c) => routes[c] ?? []));
  const onOther = new Set(
    Object.entries(routes).flatMap(([cls, path]) =>
      IMAGE_CLASSES.includes(cls as RequestClass) ? [] : (path ?? []),
    ),
  );
  const read = new Set(routes['image-read'] ?? []);
  const remove = arch.nodes
    .filter(
      (n) =>
        onImage.has(n.id) &&
        (n.role === 'object-store' ||
          n.role === 'image-transform' ||
          (n.role === 'edge-cdn' && read.has(n.id) && !onOther.has(n.id))),
    )
    .map((n) => n.id);
  const write = (routes['image-write'] ?? []).filter(
    (id) => !remove.includes(id),
  );
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));
  const sender = [...write]
    .reverse()
    .map((id) => byId.get(id))
    .find((n) => n?.role === 'compute');
  if (!sender) return undefined;
  const out = transferNodes(sender, provider, `${target} への書き込み`);
  return { remove, write: [...write, ...out.map((n) => n.id)], out };
}

/**
 * 土台の構成に、他の事業者の画像の部品を差す（composeStack から呼ぶ）。差せる土台は規則（connections.ts）で決まる。
 * 画像の配信・保存・変換を土台の CDN・置き場・画像の最適化から、Cloudflare の R2・画像のドメインのキャッシュ・Images
 * （または Bunny）に移す。外すノードと投稿の経路は役割の印から導く（imageShape）。
 */
export function applyCross(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  framework: FrameworkId | undefined,
): ArchitectureInput {
  const opt = CROSS_COMPONENTS.find(
    (c) =>
      c.slot === 'images' &&
      c.id === choices.images &&
      hostsOf(c).includes(host),
  );
  const shape = opt
    ? imageShape(
        arch,
        opt.platform,
        opt.platform === 'bunny' ? 'Bunny Storage' : 'R2',
      )
    : undefined;
  if (!opt || !shape) return arch;
  const transform = opt.link!.as === 'images';
  if (opt.platform === 'bunny')
    return applyBunnyImages(arch, shape, transform, framework);
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  // Vercel Hobby（個人・非商用）は Images Free（月 5,000 の一意な変換まで・超えると 9422）、それ以外（Vercel Pro・AWS）は Images Paid（仮定）
  const imagesPlan = plan === 'hobby' ? 'images-free' : 'images-paid';
  const nodes: ArchNodeIn[] = [
    ...arch.nodes.filter((n) => !shape.remove.includes(n.id)),
    ...shape.out,
    {
      id: 'cf-cache',
      label: 'Cloudflare（画像のドメインのキャッシュ）',
      role: 'edge-cdn',
      config: { kind: 'cdn', hitRate: { 'image-read': CF_IMAGE_HIT_RATE } },
    },
    {
      id: 'cf-r2',
      label: 'Cloudflare R2（画像）',
      role: 'object-store',
      config: { kind: 'object-storage' },
      facts: ['custom-domain', 'egress-other-services'],
      billing: bill('r2-standard', {
        'storage-gb-month': 'storage',
        'object-writes': 'class-a',
        'object-reads': 'class-b',
        'egress-gb': 'egress',
      }),
    },
    ...(transform
      ? [
          {
            id: 'cf-images',
            label: 'Cloudflare Images（URL で変換）',
            role: 'image-transform',
            config: { kind: 'image-optimizer' },
            facts: [
              'transform-url',
              'outside-images',
              ...(framework === undefined ||
              framework === 'nextjs' ||
              framework === 'nextjs-export'
                ? ['next-loader']
                : []),
            ],
            billing: bill(imagesPlan, {
              'image-transformations': 'transformations',
            }),
          } as ArchNodeIn,
        ]
      : []),
  ];
  const routes: Partial<Record<RequestClass, string[]>> = {
    ...arch.routes,
    'image-read': ['cf-cache', 'cf-r2'],
    'image-write': [...shape.write, 'cf-r2'],
  };
  if (transform) routes['image-transform'] = ['cf-images'];
  else delete routes['image-transform'];
  return { ...arch, nodes, routes };
}

// ---- 画像を Bunny で配る（D-98・prd/11 §23）----

/**
 * 画像の配信・保存・変換を、土台から Bunny（Storage・CDN・Optimizer）に移す。土台のノードの外し方と投稿の経路は
 * Cloudflare の画像と同じ imageShape（投稿はサーバーが受けて Storage に PUT し、送るデータは土台の外への転送で数える）。
 * Storage から CDN への転送・API の要求は無料なので、Storage のノードは保存だけを課金する。
 */
function applyBunnyImages(
  arch: ArchitectureInput,
  shape: ImageShape,
  transform: boolean,
  framework: FrameworkId | undefined,
): ArchitectureInput {
  const nextLoader =
    framework === undefined ||
    framework === 'nextjs' ||
    framework === 'nextjs-export';
  const nodes: ArchNodeIn[] = [
    ...arch.nodes.filter((n) => !shape.remove.includes(n.id)),
    ...shape.out,
    bunnyCdnNode('bunny-img', 'Bunny CDN（画像）', {
      'image-read': BUNNY_IMAGE_HIT_RATE,
    }),
    {
      id: 'bunny-storage',
      label: 'Bunny Storage（画像）',
      role: 'object-store',
      config: { kind: 'object-storage' },
      facts: ['storage-origin'],
      billing: bunnyBill('standard', { 'storage-gb-month': 'storage' }),
    },
    ...(transform
      ? [
          {
            id: 'bunny-optimizer',
            label: 'Bunny Optimizer（URL で変換）',
            role: 'image-transform',
            config: { kind: 'image-optimizer' },
            facts: [
              'dynamic-images',
              'optimizer-flat',
              ...(nextLoader ? ['no-next-loader'] : []),
            ],
            billing: bunnyBill('optimizer', {
              'image-transformations': 'transformations',
            }),
          } as ArchNodeIn,
        ]
      : []),
  ];
  const routes: Partial<Record<RequestClass, string[]>> = {
    ...arch.routes,
    'image-read': ['bunny-img', 'bunny-storage'],
    'image-write': [...shape.write, 'bunny-storage'],
  };
  if (transform) routes['image-transform'] = ['bunny-optimizer'];
  else delete routes['image-transform'];
  return { ...arch, nodes, routes };
}

// ---- DB だけ Neon（D-77・prd/11 §15）----

/** Neon の最小の計算の大きさ（CU。0.25 CU は約 1 GB の RAM。自動の拡大は計算しない）。 */
export const NEON_MIN_CU = 0.25;
/** Neon が止まるまでの、問い合わせの無い時間（秒。既定の 5 分）。 */
export const NEON_SUSPEND_SECONDS = 300;

/** 土台が無料のプラン（Vercel Hobby・Netlify Free・Cloudflare Free）か（DB の部品のプランと名前を分ける）。 */
const freeHostPlan = (plan: string): boolean =>
  plan === 'hobby' || plan === 'free';

/**
 * Neon の DB のノード。土台が無料のプランなら Neon Free、それ以外は Neon Launch。
 * relayed は中継（Hyperdrive）を通してワイヤプロトコルでつなぐ形（serverless driver を使わない）。
 */
function neonNode(id: string, hostPlan: string, relayed = false): ArchNodeIn {
  const free = freeHostPlan(hostPlan);
  return {
    id,
    label: free ? 'Neon Free（Postgres）' : 'Neon Launch（Postgres）',
    role: 'sql-db',
    config: {
      kind: 'managed-db',
      capacityUnits: NEON_MIN_CU,
      pauseAfterIdleSeconds: NEON_SUSPEND_SECONDS,
    },
    facts: relayed
      ? ['region', 'scale-to-zero', 'compute-size']
      : ['region', 'serverless-driver', 'scale-to-zero', 'compute-size'],
    billing: {
      accountId: 'neon',
      provider: 'neon',
      planId: free ? 'free' : 'launch',
      meters: free
        ? { 'instance-hours': 'compute', 'egress-gb': 'transfer' }
        : {
            'instance-hours': 'compute',
            'storage-gb-month': 'storage',
            'egress-gb': 'transfer',
          },
    },
  };
}

// ---- 中継と DB の部品のノード（D-114 段 2b）----

/**
 * Hyperdrive（Cloudflare の DB の接続のプール）のノード。Cloudflare の既存の「Hyperdrive 経由で Supabase」と、
 * 規則が自動で足す中継（CP-05）で同じノード。facts は中継として他の事業者の Postgres につなぐときだけ添える（既存の組は添えない）。
 */
export function hyperdriveNode(
  plan: string,
  facts?: readonly string[],
): ArchNodeIn {
  return {
    id: 'hyperdrive',
    role: 'db-proxy',
    label: 'Hyperdrive',
    config: { kind: 'db-proxy' },
    ...(facts ? { facts: [...facts] } : {}),
    billing: {
      accountId: 'cloudflare',
      provider: 'cloudflare',
      planId: plan === 'free' ? 'hyperdrive-free' : 'hyperdrive-paid',
      meters: { queries: 'queries' },
    },
  };
}

/** 規則が自動で足す中継のノード（RELAYS の id ごと。プランは土台のプラン）。 */
const RELAY_NODES: Record<RelayId, (plan: string) => ArchNodeIn> = {
  hyperdrive: (plan) => hyperdriveNode(plan, ['origin-db', 'idle-connections']),
};

/**
 * DB の部品のノード（部品の事業者ごと）。id は土台の DB のノードの id（経路を変えない）。relayed は中継を通すか。
 * 部品の事業者を足すときは、ここにノードの作り方を足す。
 */
const DB_PART_NODES: Partial<
  Record<
    ComponentProvider,
    (opt: string, id: string, plan: string, relayed: boolean) => ArchNodeIn
  >
> = {
  neon: (_opt, id, plan, relayed) => neonNode(id, plan, relayed),
  aws: (opt, id) => ({ ...awsDbNode(opt), id }),
};

/** 土台 host の DB のスロットで、他の事業者の DB の部品（規則で許したもの）。 */
const dbPartOn = (
  host: Platform,
  opt: string | undefined,
): ComponentOption | undefined =>
  opt === undefined
    ? undefined
    : CROSS_COMPONENTS.find(
        (c) => c.slot === 'db' && c.id === opt && hostsOf(c).includes(host),
      );

/** 選んだ DB が他の事業者の部品か（土台の組み立てが自分の DB を置かず、applyCrossDb に任せる。D-114 段 2b）。 */
export const isCrossDb = (host: Platform, opt: string | undefined): boolean =>
  dbPartOn(host, opt) !== undefined;

const partDefOf = (o: ComponentOption) =>
  CROSS_PARTS.find(
    (p) => p.slot === o.slot && p.id === o.id && p.platform === o.platform,
  );

/** 土台 host から DB の部品へつなぐ中継（規則から。CP-05）。 */
const dbRelaysOn = (host: Platform, o: ComponentOption): readonly RelayId[] => {
  const def = partDefOf(o);
  return def ? relaysFor(host, def) : [];
};

/**
 * 構成の名前に出す DB の名前（D-77・D-114 段 2・段 2b）。部品の title と、規則が足す中継の名前から作る
 * （「Neon（Launch）」「AWS DynamoDB」「Hyperdrive + Neon（Launch）」）。free は土台が無料のプラン。
 * host を渡すと、その土台に差せる部品だけ（土台の事業者自身の DB は undefined）。替えなければ undefined。
 */
export function crossDbName(
  db: string | undefined,
  free: boolean,
  host?: Platform,
): string | undefined {
  const o =
    host !== undefined
      ? dbPartOn(host, db)
      : CROSS_COMPONENTS.find((c) => c.slot === 'db' && c.id === db);
  const t = o && partDefOf(o)?.title;
  if (!o || t === undefined) return undefined;
  const name = typeof t === 'string' ? t : free ? t.free : t.paid;
  const relays = host !== undefined ? dbRelaysOn(host, o) : [];
  return [...relays.map((r) => RELAYS[r].name), name].join(' + ');
}

/**
 * 構成の名前に DB の名前を入れる。名前に土台の DB（Supabase）があれば替え、無ければ（Cloudflare の「+ vinext」など）後ろに足す。
 */
export const withCrossDbName = (name: string, db: string): string =>
  /Supabase (Free|Pro)/.test(name)
    ? name.replace(/Supabase (Free|Pro)/, db)
    : `${name} + ${db}`;

/**
 * 土台の DB（役割 sql-db のノード。Vercel・Netlify の Supabase、Cloudflare は組み立てが置く仮の DB）を他の事業者の DB の部品
 * （Neon・AWS の DynamoDB・Aurora・RDS）に差し替える（composeStack から、画像・API の前に呼ぶ）。差せる土台・要る中継は規則（connections.ts）で決まる。
 * ノードの id は変えない（経路はそのまま）。中継（Hyperdrive。CP-05）は経路の DB の手前に自動で足す。
 * 部品が送り手になる応答の転送（AWS の DB → 土台の関数・中継。D-114 段 2）は、部品の送り出しと土台の受け取りの項目で数え（transferNodes。CP-06）、
 * 経路の DB の手前に置く。standby.db（差し替えの途中）が今と違えば、移す先の DB を `db-next` で経路に載せずに足す（新旧の両方の費用）。
 * 移す先が土台の DB のときは、土台の組み立てが置いていなければ（Vercel・Netlify の Supabase）土台の DB を写して足す。
 */
export function applyCrossDb(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  standby: Choices,
): ArchitectureInput {
  if (
    !CROSS_COMPONENTS.some((c) => c.slot === 'db' && hostsOf(c).includes(host))
  )
    return arch;
  const base = arch.nodes.find((n) => n.role === 'sql-db');
  if (!base) return arch;
  const current = choices.db;
  const next = standby.db;
  /** 部品の DB のノードと中継（部品でなければ undefined）。 */
  const build = (opt: string | undefined, id: string) => {
    const part = dbPartOn(host, opt);
    const make = part && DB_PART_NODES[part.platform];
    if (!part || !make) return undefined;
    const relays = dbRelaysOn(host, part).map((r) => RELAY_NODES[r](plan));
    return { db: make(part.id, id, plan, relays.length > 0), relays };
  };
  const cur = build(current, base.id);
  let nodes = arch.nodes.map((n) => (n.id === base.id && cur ? cur.db : n));
  const addNew = (ns: readonly ArchNodeIn[]) => {
    for (const n of ns) if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
  };
  if (next !== undefined && next !== current) {
    const nxt = build(next, `${base.id}-next`);
    if (nxt) addNew([...nxt.relays, nxt.db]);
    // 土台の DB へ戻す途中: 土台の組み立てが移す先を置いていない（課金のある土台の DB が経路の上にある）ときだけ写す
    else if (cur && base.billing) addNew([{ ...base, id: `${base.id}-next` }]);
  }
  const name = cur ? crossDbName(current, freeHostPlan(plan), host) : undefined;
  if (!cur || name === undefined) return { ...arch, nodes };
  // DB が送り手の応答の転送（受け手は土台の処理・中継。項目のある側だけノードを作る）。中継と転送を経路の DB の手前に置く
  const out = transferNodes(cur.db, host, 'DB の応答', 'per-query');
  const before = [...cur.relays, ...out].map((n) => n.id);
  const routes = before.length
    ? Object.fromEntries(
        Object.entries(arch.routes).map(([cls, path]) => [
          cls,
          path!.flatMap((id) => (id === base.id ? [...before, id] : [id])),
        ]),
      )
    : arch.routes;
  // 受け手の処理（DB を呼ぶ土台の compute）に、受け取りの項目が無いことの根拠を添える
  const receiverFacts = out.length ? inboundOf(host)?.receiverFacts : undefined;
  const callers = new Set(
    Object.values(arch.routes).flatMap((path) =>
      (path ?? []).filter((id, i) => path![i + 1] === base.id),
    ),
  );
  if (receiverFacts?.length)
    nodes = nodes.map((n) =>
      callers.has(n.id) && n.role === 'compute'
        ? { ...n, facts: [...(n.facts ?? []), ...receiverFacts] }
        : n,
    );
  // 中継は、差し替えの途中で土台の組み立てが同じ id のノードを置いていれば（Cloudflare の Hyperdrive 経由で Supabase）それを使う
  const relays = cur.relays.filter((r) => !nodes.some((n) => n.id === r.id));
  return {
    ...arch,
    name: withCrossDbName(arch.name, name),
    nodes: [...nodes, ...relays, ...out],
    routes,
  };
}

// ---- API の置き場（SPA は D-65・prd/10 §3。Next.js と VPS は D-67）----

/** 土台の DB の役割（API と一緒に他の事業者に移す。DB は API と同じ事業者に置く）。Hyperdrive は DB の手前の中継。 */
const isDbNode = (n: ArchNodeIn): boolean =>
  n.role === 'sql-db' || n.role === 'db-proxy';

/**
 * Next.js のサーバーに呼ばれた Worker が D1 を読んで JSON を返す 1 回の CPU（ms。ゲーム上の仮定。記事コミュニティの API の CPU と同じ値）。
 * SSR・ISR の作り直しの CPU（HTML の描画）は Next.js のサーバーの側に残る。
 */
export const SERVER_API_WORKER_CPU_MS = 5;
/**
 * DB を他の事業者に出した VPS の常駐メモリ（GB。仮定）。vpsNode の 1.35（OS 0.3・MySQL 0.6・Node 0.4・nginx 0.05）から MySQL を除いた値。
 */
export const VPS_RESIDENT_WITHOUT_DB_GB = 0.75;
/** Next.js のサーバーから外の API への 1 回の問い合わせで送るデータ（KB。ゲーム上の仮定）。応答の受信は課金されない。 */
export const SERVER_API_REQUEST_KB = 1;

/**
 * Cloudflare の Worker（API）と D1。土台が Vercel Hobby なら Workers Free、それ以外は Workers Paid（仮定）。
 * server はサーバーから呼ぶ形のフレームワーク（Next.js は D-67・Astro は D-69。false はブラウザから呼ぶ SPA）。
 */
function cfApiNodes(
  plan: string,
  server: false | 'nextjs' | 'astro',
): ArchNodeIn[] {
  const workers = plan === 'hobby' ? 'workers-free' : 'workers-paid';
  const bill = (meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId: workers,
    meters,
  });
  return [
    {
      id: 'cf-worker',
      role: 'compute',
      label: server
        ? `Cloudflare Worker（API・${server === 'astro' ? 'Astro' : 'Next.js'} のサーバーから呼ぶ）`
        : 'Cloudflare Worker（API）',
      config: server
        ? {
            kind: 'function',
            classCpuMs: {
              'document-ssr': SERVER_API_WORKER_CPU_MS,
              'isr-revalidate': SERVER_API_WORKER_CPU_MS,
            },
          }
        : { kind: 'function' },
      facts: server
        ? [
            'custom-domain-origin',
            server === 'astro' ? 'astro-server-fetch' : 'server-fetch',
            'd1-binding',
          ]
        : ['custom-domain-origin', 'cors-headers', 'd1-binding'],
      billing: bill({ requests: 'requests', 'cpu-ms': 'cpu-ms' }),
    },
    {
      id: 'cf-d1',
      label: 'Cloudflare D1',
      role: 'sql-db',
      config: { kind: 'sql-db' },
      billing: bill({
        'rows-read': 'd1-rows-read',
        'rows-written': 'd1-rows-written',
        ...(workers === 'workers-paid'
          ? { 'storage-gb-month': 'd1-storage' }
          : {}),
      }),
    },
  ];
}

/** AWS の API Gateway（HTTP API）+ Lambda + DynamoDB と、AWS から外へ送る転送（API の応答・R2 への書き込み）。 */
function awsApiNodes(): ArchNodeIn[] {
  return [
    {
      id: 'aws-out',
      label: 'AWS → インターネット（API の応答・R2 への書き込み）',
      config: { kind: 'cdn', hitRate: {} },
      facts: ['api-gateway-out', 'lambda-out'],
      billing: awsBill('data-transfer-out', { 'egress-gb': 'internet-out' }),
    },
    {
      id: 'apigw',
      label: 'API Gateway（HTTP API）',
      role: 'compute',
      // HTTP API は 512 KB ごとに 1 リクエスト（aws.ts の SPA と同じ）
      config: { kind: 'cdn', hitRate: {}, requestUnitKB: 512 },
      billing: awsBill('api-gateway-http', { requests: 'requests' }),
    },
    {
      id: 'lambda',
      label: 'Lambda（API）',
      role: 'compute',
      config: { kind: 'function', memoryGB: COMPUTE_MEMORY_GB, concurrency: 1 },
      billing: awsBill('lambda', {
        invocations: 'requests',
        'memory-gb-hours': 'compute',
      }),
    },
    awsDbNode('dynamodb'),
  ];
}

/**
 * 土台の API を動かす処理（役割 compute のノード）。土台の api の経路（無ければ api-content）にある処理の順。
 * 例: Vercel・Netlify は関数（fn）、Amplify は SSR、OpenNext はサーバーの関数、S3 + CloudFront の SPA は API Gateway と Lambda、
 * Cloudflare は Worker、さくらの VPS は VPS。
 */
function hostApiCompute(arch: ArchitectureInput): ArchNodeIn[] {
  const path = arch.routes.api ?? arch.routes['api-content'] ?? [];
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));
  return path
    .map((id) => byId.get(id))
    .filter((n): n is ArchNodeIn => n?.role === 'compute');
}

/**
 * 置き場ごとの、足すノードと API の経路。write は投稿の画像を書く手前まで（書き先は土台の経路の最後のノード。SPA だけ）。
 * Next.js（cf-workers-server）の api は、土台の経路の DB のノードと差し替える列。
 * caller はサーバーから呼ぶ形で API を呼ぶ土台の処理（送るデータを、その送り出しの項目で数える。CP-06）。
 */
function placement(
  id: string,
  plan: string,
  caller: ArchNodeIn | undefined,
): { nodes: ArchNodeIn[]; api: string[]; write: string[] } | undefined {
  if (id === 'cf-workers')
    return {
      nodes: cfApiNodes(plan, false),
      api: ['cf-worker', 'cf-d1'],
      // Worker は R2 に binding で書き、S3 には HTTPS で書く（S3 はインターネットからの受信に課金しない）
      write: ['cf-worker'],
    };
  if (id === 'aws-lambda')
    return {
      nodes: awsApiNodes(),
      // 応答は API Gateway から外へ送る（CloudFront を通らない）ので、転送を数えるノードを前に置く
      api: ['aws-out', 'apigw', 'lambda', 'dynamodb'],
      write: ['apigw', 'lambda', 'aws-out'],
    };
  // サーバーから外の API へ送る問い合わせ（1 回 SERVER_API_REQUEST_KB）は、呼ぶ土台の処理の送り出しの項目で数える:
  // OpenNext の Lambda は東京 → インターネット、Netlify の関数は Netlify の転送量（D-71）。Vercel の関数・Amplify の SSR は
  // 料金の文書に項目が無く、VPS は転送量が無制限なので数えない
  const out_ = () =>
    caller
      ? transferNodes(
          caller,
          'cloudflare',
          '外の API への問い合わせ',
          SERVER_API_REQUEST_KB,
        )
      : [];
  if (id === 'cf-workers-server') {
    const out = out_();
    return {
      nodes: [...out, ...cfApiNodes(plan, 'nextjs')],
      api: [...out.map((n) => n.id), 'cf-worker', 'cf-d1'],
      write: [],
    };
  }
  // Astro のサーバー（Vercel の関数・VPS の Node・Netlify の関数）から呼ぶ（D-69）
  if (id === 'cf-workers-astro') {
    const out = out_();
    return {
      nodes: [...out, ...cfApiNodes(plan, 'astro')],
      api: [...out.map((n) => n.id), 'cf-worker', 'cf-d1'],
      write: [],
    };
  }
  if (id === 'sakura-vps-2gb' || id === 'sakura-vps-4gb') {
    const vps = id === 'sakura-vps-2gb' ? '2gb' : '4gb';
    return {
      // api のサブドメインは DNS だけのレコードで VPS に直接向ける（Cloudflare の CDN を通らない）。
      // VPS から R2 への書き込みは、さくらの転送量無制限・R2 は受信に課金しない。ストレージ変更オプションは付けない（仮定）
      nodes: [
        vpsNode(
          vps,
          false,
          `さくらの VPS ${vps.toUpperCase()}（Node の API + MySQL）`,
          false,
        ),
      ],
      api: ['vps'],
      write: ['vps'],
    };
  }
  return undefined;
}

/**
 * API を他の事業者に置く（composeStack から、SPA の形にした後で呼ぶ。SPA は D-65・Next.js と VPS は D-67）。
 * - SPA: 記事の中身の API（api-content）ともともとの API（api）を、他の事業者の API と DB へ向ける。投稿の画像は API が受けて、
 *   今の置き場（R2・S3）に書く。Vercel Blob だけはアップロードを Vercel の関数に残す（Blob の書き込みの手順が
 *   Vercel の関数を前提にしているため。仮定）。
 * - Next.js: サーバー（SSR・ISR の作り直し・Route Handler）の経路の DB を、他の事業者の API（Worker → D1）に差し替える。
 *   ブラウザから見える経路（CDN → サーバー）は変わらない。
 * 土台の関数・DB は、ほかの経路（OGP の前処理・リアルタイム・Blob のアップロード）が使っていなければ外す。
 * standby.api（差し替えの途中）が別の置き場なら、その置き場のノードを経路に載せずに足す（常時かかる分だけ課金される）。
 */
export function applyCrossApi(
  arch: ArchitectureInput,
  host: Platform,
  plan: string,
  choices: Choices,
  standby: Choices,
  framework: FrameworkId,
): ArchitectureInput {
  const allowed = (id: string | undefined) =>
    id !== undefined &&
    CROSS_COMPONENTS.some(
      (c) =>
        c.slot === 'api' &&
        c.id === id &&
        hostsOf(c).includes(host) &&
        (c.frameworks ?? []).includes(framework),
    );
  const current = choices.api ?? 'same';
  const next = standby.api;
  // 土台の API を動かす処理（役割の印から。D-114）。サーバーから呼ぶ形は、その最後（DB を読む処理）が外の API を呼ぶ
  const callers = hostApiCompute(arch);
  const callerIds = new Set(callers.map((n) => n.id));
  const caller = callers[callers.length - 1];
  const cur = allowed(current) ? placement(current, plan, caller) : undefined;
  const nxt =
    next !== undefined && next !== current && allowed(next)
      ? placement(next, plan, caller)
      : undefined;
  if (!cur && !nxt) return arch;
  // Next.js の静的書き出し（D-80）も SPA と同じく、ブラウザが API を呼ぶ
  const spa = browserCallsApi(framework);
  const astro = framework === 'astro';
  // Cloudflare の Astro + VPS の API（D-69）: ブラウザの API・投稿は SPA と同じく VPS へ直接、マイページを描く Worker も VPS の API を呼ぶ
  const browserCalls = spa || (astro && host === 'cloudflare');
  let routes: Partial<Record<RequestClass, string[]>> = { ...arch.routes };
  let nodes = [...arch.nodes];
  /** 置き場のノード（今と、差し替えの途中の置き場）の id。 */
  const placed = new Set<string>();
  const addAll = (ns: ArchNodeIn[]) => {
    for (const n of ns) placed.add(n.id);
    nodes.push(...ns.filter((n) => !nodes.some((x) => x.id === n.id)));
  };
  /** 経路の DB のノード（役割 sql-db・db-proxy）を API の列に差し替える（連続した DB のノード（Hyperdrive → Supabase）は 1 回だけ）。 */
  const replaceDb = (api: readonly string[]) => {
    const db = arch.nodes.filter(isDbNode).map((n) => n.id);
    // DB の応答の転送（DB の手前の転送のノード。D-114 段 2）も DB と一緒に外す
    const dbOut = new Set(
      arch.nodes
        .filter(isTransferNode)
        .map((n) => n.id)
        .filter((id) =>
          Object.values(routes).some((p) =>
            p!.some((x, i) => x === id && db.includes(p![i + 1] ?? '')),
          ),
        ),
    );
    // 連続した DB・転送のノード（中継 → 転送 → DB。D-114 段 2b）は 1 回だけ API の列にする
    const gone = (id: string) => db.includes(id) || dbOut.has(id);
    routes = Object.fromEntries(
      Object.entries(routes).map(([cls, path]) => [
        cls,
        path!.flatMap((id, i) =>
          !gone(id) ? [id] : i > 0 && gone(path![i - 1]!) ? [] : api,
        ),
      ]),
    );
  };
  if (cur && browserCalls) {
    if (astro) replaceDb(cur.api);
    routes.api = [...cur.api];
    if (spa || routes['api-content']) routes['api-content'] = [...cur.api];
    // 投稿の画像の書き先（土台の経路の最後の置き場）に、他の事業者の API から書けるなら書き先はそのまま、書く処理を API に替える。
    // 土台の関数からだけ書ける置き場（Vercel Blob・Netlify Blobs。口が binding だけ）は、アップロードを土台の関数に残す
    const write = routes['image-write'];
    const target = write?.[write.length - 1];
    const store = arch.nodes.find((n) => n.id === target);
    if (target && (!store || storeAcceptsFromOutside(store)))
      routes['image-write'] = [...cur.write, target];
  } else if (cur && host === 'sakura') {
    // VPS の Astro（D-69）: DB は VPS の中（ノードが無い）ので、DB を読む経路（マイページ・API）の VPS の後に API を足す
    for (const cls of [
      'document-ssr',
      'isr-revalidate',
      'api',
      'api-content',
    ] as const)
      if (routes[cls]?.some((id) => callerIds.has(id)))
        routes[cls] = routes[cls]!.flatMap((id) =>
          callerIds.has(id) ? [id, ...cur.api] : [id],
        );
  } else if (cur) replaceDb(cur.api);
  if (cur) addAll(cur.nodes);
  // 同じ id で別の契約のノード（VPS 2GB ↔ 4GB の移し替え）は、新しい側を別の id で足す（新旧の両方の月額を払う）
  if (nxt)
    addAll(
      nxt.nodes.map((n) =>
        nodes.some(
          (x) => x.id === n.id && x.billing?.planId !== n.billing?.planId,
        )
          ? { ...n, id: `${n.id}-next` }
          : n,
      ),
    );
  // 同じ事業者へ戻す途中は、土台の関数・DB を残す（新旧の両方を動かす）
  const keepHost = next === 'same' && current !== 'same';
  if (cur && !keepHost) {
    // 土台の処理・DB（差し替えの途中の DB を含む）と転送を数えるノードは、どの経路にも残らなければ外す（役割の印から。D-114）
    const used = new Set(Object.values(routes).flat());
    nodes = nodes.filter(
      (n) =>
        used.has(n.id) ||
        placed.has(n.id) ||
        !(n.role === 'compute' || isDbNode(n) || isTransferNode(n)),
    );
  }
  // VPS の Astro の DB を Workers・D1 に出したら、VPS は MySQL を動かさず、ディスクに DB を置かない（D-69。移し替えの途中は残す）
  if (cur && host === 'sakura' && !keepHost)
    nodes = nodes.map((n): ArchNodeIn =>
      callerIds.has(n.id) && n.config.kind === 'host'
        ? {
            ...n,
            label: 'VPS（nginx + Astro の Node。DB は D1）',
            config: {
              ...n.config,
              residentMemoryGB: VPS_RESIDENT_WITHOUT_DB_GB,
              dbCpuMsPerQuery: 0,
              storesDb: false,
            },
          }
        : n,
    );
  // Cloudflare の Astro: マイページを描く Worker が VPS の API を fetch で呼ぶ（課金されず、待つ時間は CPU 時間に数えない）。
  // VPS はページを描かず、API の 1 回として数える（OCL-4D1F5201）
  if (cur && astro && host === 'cloudflare')
    nodes = nodes.map((n): ArchNodeIn =>
      n.config.kind === 'host' && cur.nodes.some((x) => x.id === n.id)
        ? {
            ...n,
            // 記事のキャッシュを描き直す閲覧（D-103）も Worker から VPS の API を呼ぶ
            config: {
              ...n.config,
              serverApiClasses: ['document-ssr', 'isr-revalidate'],
            },
          }
        : callerIds.has(n.id)
          ? {
              ...n,
              label: 'Worker（Astro。VPS の API を呼ぶ）',
              facts: [
                ...(n.facts ?? []),
                'astro-server-fetch',
                'worker-outbound',
              ],
            }
          : n,
    );
  if (cur && !spa)
    nodes = nodes.map((n): ArchNodeIn => {
      // サーバーから外の API への通信: 送り出しの項目に添えた事実（Vercel の関数・Amplify の SSR は料金の文書に項目が無いので
      // 数えない・Netlify の関数は転送量で数える）を、API を呼ぶ土台の処理に出す
      const facts = callerIds.has(n.id)
        ? outboundOf(n)?.senderFacts
        : undefined;
      return facts?.length
        ? { ...n, facts: [...(n.facts ?? []), ...facts] }
        : n;
    });
  if (cur && host === 'cloudflare' && !astro)
    nodes = nodes.map((n): ArchNodeIn => {
      // Worker が OGP の前処理・リアルタイムだけに残るときの名前
      if (callerIds.has(n.id))
        return { ...n, label: 'Worker（OGP の前処理・リアルタイム）' };
      // Worker の binding でなく、ゾーンの URL で変換する
      if (n.role === 'image-transform')
        return {
          ...n,
          label: 'Images（URL で変換）',
          facts: [...(n.facts ?? []), 'transform-url'],
        };
      return n;
    });
  return { ...arch, nodes, routes };
}
