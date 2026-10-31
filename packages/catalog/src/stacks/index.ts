// MVP の構成（prd/README のスコープ・prd/06 §4）。Next.js 系のアプリを 3 つのホストに載せた形。
// 振る舞いは estimator の ComponentKind、ここはノードの値と課金先のメーターの対応だけを持つ。
// GD-4（D-24・prd/07 §11）: 構成は役割ごとのスロットの選択（部品）から組み立てる。完成品は「既定の選択」。
import type { ArchitectureInput, RequestClass, WorkloadInput } from 'estimator';

export type Platform = 'cloudflare' | 'vercel' | 'sakura';
export type SlotId = 'isrCache' | 'images' | 'db' | 'realtime' | 'frontCdn';
export type Choices = Partial<Record<SlotId, string>>;

/** 事業者 × プラン。完成品の構成は、これに既定の選択を当てたもの。 */
export type StackDef = {
  id: string;
  platform: Platform;
  plan: string;
  name: string;
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
];

/** スロットの部品（catalog のデータ）。当たりうる前提は前提の id の前方一致で挙げる（選ぶ前に出す）。 */
export type ComponentOption = {
  id: string;
  slot: SlotId;
  platform: Platform;
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
};

export const SLOT_LABELS: Record<SlotId, string> = {
  isrCache: 'ISR のキャッシュ',
  images: '画像',
  db: 'DB',
  realtime: 'リアルタイム',
  frontCdn: '前段の CDN',
};

const BASE_COMPONENTS: readonly ComponentOption[] = [
  // Cloudflare
  {
    id: 'kv',
    slot: 'isrCache',
    platform: 'cloudflare',
    label: 'KV',
    note: '閲覧のたびに Worker が KV を読み、再生成で書く。KV の書き込みは他の拠点で見えるまで 60 秒以上かかることがある',
    premiseRefs: ['pool:cloudflare:workers-paid:paid-kv-writes'],
    onDemandIsr: { ok: false, fact: 'cloudflare:workers-paid:kv-propagation' },
  },
  {
    id: 'r2',
    slot: 'isrCache',
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
    platform: 'cloudflare',
    label: 'Workers Cache（タグでパージ）',
    note: 'vinext の workersCacheCdnAdapter。ISR のページを拠点ごとの Workers Cache から返し、再検証はタグでパージする。Cache API の料金は記載なし（このモデルでは費用なし）。拠点ごとのキャッシュなので、ヒット率が下がって再生成が増える分は計算に入れていない',
    premiseRefs: ['fact:cloudflare:workers-paid:workers-cache'],
    onDemandIsr: { ok: true, fact: 'cloudflare:workers-paid:workers-cache' },
  },
  {
    id: 'none',
    slot: 'isrCache',
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
    note: '原本をそのまま配る。R2 は転送量に課金しないので費用は増えず、遅くなる',
    premiseRefs: ['fact:cloudflare:r2-standard:egress'],
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
  // Vercel・VPS は共通の役割だけ（G-04）
  {
    id: 'default',
    slot: 'isrCache',
    platform: 'vercel',
    label: 'ISR の永続ストレージ',
    note: 'ISR のページは CDN が返す。再検証すると全リージョンのキャッシュが 300ms 以内に更新される',
    premiseRefs: [],
    onDemandIsr: { ok: true, fact: 'vercel:pro:isr-purge' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    platform: 'vercel',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事の閲覧が毎回関数まで届く。記事は常に新しい',
    premiseRefs: [
      'pool:vercel:pro:pro-cdn-requests',
      'fact:vercel:pro:active-cpu',
    ],
  },
  {
    id: 'default',
    slot: 'images',
    platform: 'vercel',
    label: '画像の最適化',
    note: '閲覧のときに変換する',
    premiseRefs: [],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'vercel',
    label: '最適化しない',
    note: '原本をそのまま配る。転送量（Fast Data Transfer）が増え、遅くなる',
    premiseRefs: ['pool:vercel:pro:pro-fdt'],
  },
  {
    id: 'default',
    slot: 'isrCache',
    platform: 'sakura',
    label: 'ディスク',
    note: 'next start のキャッシュをディスクに置く（1 台・永続ディスクなら自動で動く）',
    premiseRefs: [],
    onDemandIsr: { ok: true, fact: 'sakura-vps:2gb-tokyo:next-fs-cache' },
  },
  {
    id: 'none',
    slot: 'isrCache',
    platform: 'sakura',
    label: 'キャッシュしない（毎回 SSR）',
    note: '記事も毎回 SSR する。CPU を使う。記事は常に新しい',
    premiseRefs: ['host:cpu'],
  },
  {
    id: 'default',
    slot: 'images',
    platform: 'sakura',
    label: 'ホストで変換',
    note: '閲覧のときに VPS の CPU で変換する',
    premiseRefs: [],
  },
  {
    id: 'none',
    slot: 'images',
    platform: 'sakura',
    label: '最適化しない',
    note: '原本をそのまま配る。共有回線を多く使い、遅くなる',
    premiseRefs: ['host:line'],
  },
];

// さくらの VPS の前段の CDN（D-31）。Cloudflare の CDN（Free）を前に置く（事業者をまたぐ構成の最初の事例・D-20）
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
    note: '静的なファイルと変換済みの画像の大部分を CDN が返し、VPS の回線と CPU が減る。HTML は既定でキャッシュされないので VPS のまま。/_next/image（拡張子を持たない URL）は Cache Rules で対象にする前提（推測）',
    premiseRefs: [
      'fact:cloudflare:cdn-free:html-not-cached',
      'fact:cloudflare:cdn-free:pictures-terms',
      'host:',
    ],
  },
  {
    id: 'html',
    slot: 'frontCdn',
    platform: 'sakura',
    label: 'Cloudflare（HTML もキャッシュ）',
    note: 'ISR のページも CDN が返す。オンデマンドの再検証は CDN に届かず、s-maxage が切れるまで古いページが出る（パージの連携が要る）',
    inappropriate: true,
    onDemandIsr: { ok: false, fact: 'cloudflare:cdn-free:next-on-demand' },
    premiseRefs: [
      'fact:cloudflare:cdn-free:next-on-demand',
      'fact:cloudflare:cdn-free:pictures-terms',
      'host:',
    ],
  },
];

export const COMPONENTS: readonly ComponentOption[] = [
  ...BASE_COMPONENTS,
  ...SAKURA_FRONT_CDN,
];

export const DEFAULT_CHOICES: Record<Platform, Choices> = {
  cloudflare: { isrCache: 'kv', images: 'images', db: 'd1', realtime: 'none' },
  vercel: { isrCache: 'default', images: 'default' },
  sakura: { isrCache: 'default', images: 'default', frontCdn: 'none' },
};

/** 事業者のスロットの部品（スロットの順）。 */
export function componentsOf(
  platform: Platform,
  slot: SlotId,
): ComponentOption[] {
  return COMPONENTS.filter((c) => c.platform === platform && c.slot === slot);
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
  if (choices.images !== 'none')
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
      : choices.images !== 'none'
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
  const optimize = choices.images !== 'none';
  const nodes: ArchNodeIn[] = [
    {
      id: 'cdn',
      label: 'Vercel CDN',
      config: {
        kind: 'cdn',
        hitRate: {
          asset: 1,
          'document-static': 1,
          'document-isr': 0.8,
          'image-read': 0.9,
        },
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
    // 画像の原本の置き場所（Vercel Blob など）は料金を取得していない。課金先なしで残し、見積に「対応なし」として出す
    {
      id: 'blob',
      label: '画像の原本（置き場所は未定）',
      config: { kind: 'object-storage' },
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
      'image-read': optimize ? ['cdn', 'image'] : ['cdn', 'blob'],
      'image-write': ['fn', 'blob'],
      ...(optimize ? { 'image-transform': ['image'] } : {}),
    },
  };
}

/** さくらの VPS の仕様。storageOptionDiskGB はストレージ変更オプションを付けたときのディスク（D-30・機能ページの表）。 */
const SAKURA_HOST = {
  '2gb': { vcpu: 3, memoryGB: 2, diskGB: 100, storageOptionDiskGB: 200 },
  '4gb': { vcpu: 4, memoryGB: 4, diskGB: 200, storageOptionDiskGB: 400 },
} as const;

/** さくらの VPS に nginx・next start・MySQL を同居させる（D-13・D-24）。 */
function composeSakura(
  plan: '2gb' | '4gb',
  storageOption: boolean,
  frontCdn: string | undefined,
): ArchitectureInput {
  const { storageOptionDiskGB, ...spec } = SAKURA_HOST[plan];
  const h = {
    ...spec,
    ...(storageOption ? { diskGB: storageOptionDiskGB } : {}),
  };
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
                // ヒット率は仮定（Vercel の CDN と同じ値を使う）。HTML もキャッシュするときだけ ISR のページを返す
                hitRate: {
                  asset: 1,
                  'document-static': frontCdn === 'html' ? 1 : 0,
                  'image-read': 0.9,
                  ...(frontCdn === 'html' ? { 'document-isr': 0.8 } : {}),
                },
              },
              facts:
                frontCdn === 'html'
                  ? ['next-on-demand', 'pictures-terms']
                  : ['html-not-cached', 'pictures-terms'],
              billing: {
                accountId: 'cloudflare',
                provider: 'cloudflare',
                planId: 'cdn-free',
                meters: {},
              },
            } as ArchNodeIn,
          ]
        : []),
      {
        id: 'vps',
        label: 'VPS（nginx + next start + MySQL）',
        config: {
          kind: 'host',
          ...h,
          lineMbps: 100,
          residentMemoryGB: 1.35, // OS 0.3・MySQL 0.6・Node 0.4・nginx 0.05（仮定）
          dbCpuMsPerQuery: 0.3,
          imageTransformCpuMs: 150,
          otherDiskGB: 10,
          // nginx の TLS・転送の 1 リクエストあたりの CPU（仮定。D-31）
          proxyCpuMsPerRequest: 0.3,
        },
        billing: {
          accountId: 'sakura',
          provider: 'sakura-vps',
          planId: `${plan}-tokyo`,
          meters: { 'egress-gb': 'transfer' },
        },
      },
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
  } = {},
): ArchitectureInput {
  const def = typeof stack === 'string' ? stackDef(stack) : stack;
  const c = withDefaults(def.platform, choices);
  switch (def.platform) {
    case 'cloudflare':
      return composeCloudflare(
        def.plan as 'free' | 'paid',
        c,
        options.standby ?? {},
      );
    case 'vercel':
      return composeVercel(def.plan as 'hobby' | 'pro', c);
    case 'sakura':
      return composeSakura(
        def.plan as '2gb' | '4gb',
        options.storageOption ?? false,
        c.frontCdn,
      );
  }
}

/**
 * 部品が Workload の側を変えるもの（キャッシュしない → ISR を SSR に・サイズ違いを作る時）。
 * 最適化しない画像の大きさはテンプレート・シナリオの仮定なので、呼ぶ側が originalImageKB で渡す。
 */
export function applyComponentsToWorkload(
  w: WorkloadInput,
  platform: Platform,
  choices: Choices = {},
  options: { originalImageKB?: number } = {},
): WorkloadInput {
  const c = withDefaults(platform, choices);
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
  else if (c.images === 'r2-variants')
    out.images = { ...w.images, transformAt: 'upload' };
  return out;
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
