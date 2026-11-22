// 部品「解析の置き場」（prd/17 §5.1・KF-07・D-235）。積んで別の所で動かす API（Workload の api.invocation が async。
// estimator の api-async のクラス）を、どこで動かすかを選ぶ。非同期の API を持たないテンプレート（記事・受託）では選ぶ前の既定のまま
// （選択が無ければ構成を変えない）で、ゲームはそのシナリオではスロットを出さない（game の scenarioAnalyzes）。
// - same: アプリと同じ実行環境（関数・Workers・コンテナ・VPS）。今までの形（api-async は api の経路を通る）
// - worker-vps-2gb / 4gb: 解析だけの さくらの VPS を別に置く。解析の CPU はその VPS の使用率、費用は月額の定額。
//   結果はアプリの API（HTTPS）に送って DB に書く（DB に直接つながない: D1 のように実行環境の中からしか使えない DB があり、
//   DB の口を構成ごとに分けないため）。アプリの側は受けて書くだけの CPU（ANALYSIS_RESULT_CPU_MS）
// - client: 利用者の端末（ブラウザ）。サーバーの解析の CPU は 0 で、エンジンと評価関数のファイルを配る（Workload の visitAssets）。
//   結果はアプリの API に送って保存する（書き込みと在庫は残る）
// - hybrid: 端末で速報（保存しない）、本解析はアプリと同じ実行環境（same と同じ構成 + 端末の配布）
// 値（受けて書く CPU・配るファイルの大きさ・worker の常駐のメモリ）はゲーム上の仮定。正確さ・端末の差・滞留の満足度は prd/17 PR-8。
import type { ArchitectureInput, WorkloadInput } from 'estimator';
import { partOptions, transferNodes, type PartDef } from './connections.ts';
import { vpsNode } from './sakura.ts';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** 解析の置き場の選択肢の id。 */
export const ANALYSIS_PLACEMENTS = [
  'same',
  'worker-vps-2gb',
  'worker-vps-4gb',
  'client',
  'hybrid',
] as const;
export type AnalysisPlacement = (typeof ANALYSIS_PLACEMENTS)[number];

/** worker の VPS のプラン（選択肢の id から。worker でなければ undefined）。 */
export const analysisWorkerPlan = (
  id: string | undefined,
): '2gb' | '4gb' | undefined =>
  id === 'worker-vps-2gb' ? '2gb' : id === 'worker-vps-4gb' ? '4gb' : undefined;

/** サーバーが解析するか（端末だけの置き場は解析しない）。 */
export const serverAnalyzes = (id: string | undefined): boolean =>
  id !== 'client';

/** 端末で解析するか（端末・併用。エンジンと評価関数を配る）。 */
export const browserAnalyzes = (id: string | undefined): boolean =>
  id === 'client' || id === 'hybrid';

/**
 * アプリの API が解析の結果を受けて DB に書く 1 件の CPU（ms。ゲーム上の仮定。Next.js のサーバーに呼ばれた Worker が D1 を読んで返す
 * CPU（cross.ts の SERVER_API_WORKER_CPU_MS）と同じ大きさ）。worker・端末の置き場で、アプリの側に残る処理。
 */
export const ANALYSIS_RESULT_CPU_MS = 5;
/**
 * 端末の置き場で、アプリの API が結果を受けて DB に書く 1 件の待ち（ms。ゲーム上の仮定）。サーバーではエンジンを起こさないので、
 * 解析の 1 件の固定の重さ（評価関数を読む待ち。D-236）は乗らない。
 */
export const ANALYSIS_RESULT_IO_MS = 20;
/** worker の VPS の常駐メモリ（GB。仮定）。OS 0.3・解析のプロセス（エンジンと評価関数・置換表）0.5。 */
export const ANALYSIS_WORKER_RESIDENT_GB = 0.8;
/** worker の VPS に置くファイル（GB。仮定。OS・エンジンと評価関数）。 */
export const ANALYSIS_WORKER_DISK_GB = 10;
/** worker のノードの id。 */
export const ANALYSIS_WORKER_NODE_ID = 'analysis-worker';

/** 端末で解析するときに配るファイル（シナリオ・テンプレートの仮定。visitAssets に写す）。 */
export type BrowserAnalysisShape = {
  /** エンジンと軽い評価関数の転送の大きさ（KB・圧縮後）。 */
  engineKB: number;
  /** 訪問 1 回あたりに読む割合（解析のページを開く訪問の割合）。 */
  perVisit: number;
  /** ブラウザのキャッシュから出す割合（訪問をまたいで残る）。 */
  browserReuse: number;
};

/** 構成ごとの「アプリと同じ実行環境」の呼び名（説明の文に使う）。 */
const RUNTIME: Record<Platform, string> = {
  cloudflare: 'キューの受け手の Worker',
  vercel: 'Vercel Functions',
  sakura: '同じ VPS の別のプロセス',
  aws: 'アプリの実行環境（Amplify の SSR・Lambda）',
  'aws-opennext': 'Lambda',
  netlify: 'Netlify のバックグラウンド関数',
  gcp: 'Cloud Run',
};

const PLATFORMS = Object.keys(RUNTIME) as Platform[];

const sameNote = (p: Platform) =>
  p === 'sakura'
    ? '解析を同じ VPS の別のプロセスで動かします。月額は変わりませんが、解析の CPU がアプリと同じ VPS の使用率に入り、混むとページも解析も遅くなります'
    : `解析を${RUNTIME[p]}で動かします（今のアプリと同じ所）。使った分だけ払う従量で、件数が増えても並べて動きますが、1 件の CPU・時間の上限（事業者ごと）に当たると止まります`;

const CLIENT_NOTE =
  '解析のエンジンと軽い評価関数をブラウザに配り（WebAssembly）、利用者の端末で解析します。サーバーの解析の CPU は 0 になり、代わりに配るファイル（大きさはゲーム上の仮定）の転送が増えます。' +
  '結果はアプリの API に送って DB に書くので、書き込みと保存の量は変わりません。アプリを開いている間だけ動きます';

const hybridNote = (p: Platform) =>
  `端末で速報を出し（保存しない）、本解析は${RUNTIME[p]}で動かします（アプリと同じ実行環境と同じ数え方）。費用は端末に配るファイルの転送と、サーバーの本解析の両方です`;

const workerNote = (plan: '2gb' | '4gb', sameProvider: boolean) =>
  `解析だけを動かす さくらの VPS ${plan.toUpperCase()}（東京）をアプリとは別に置きます。解析の CPU はその VPS の使用率に入り、費用は月額の定額です。` +
  '解析の結果はアプリの API（HTTPS）に送って DB に書きます（アプリの側は受けて書くだけ）。1 件の時間の上限はありませんが、ピークに CPU が埋まると解析が滞ります。' +
  '自前運用の維持の工数と偶発的な障害（1 台構成）が加わります。' +
  (sameProvider
    ? 'アプリの VPS と同じアカウントで、月額が 1 台分増えます'
    : 'さくらのアカウントが 1 つ増え、請求が 2 つになります。往復の遅延は計算しません');

/** worker の部品（他の事業者の土台に差す。差せる土台は接続の規則 vps-worker-app-api から導く）。 */
export const ANALYSIS_PARTS: readonly PartDef[] = (['2gb', '4gb'] as const).map(
  (plan): PartDef => ({
    id: `worker-vps-${plan}`,
    slot: 'analysis',
    platform: 'sakura',
    role: 'compute',
    // 誰からも呼ばれない（worker がアプリの API を呼ぶ）
    accepts: [],
    attachesTo: ['compute'],
    as: `worker-vps-${plan}`,
    label: `さくらの VPS: ${plan.toUpperCase()} を解析の worker に足す（自前運用）`,
    note: workerNote(plan, false),
    premiseRefs: [
      `host:cpu:${ANALYSIS_WORKER_NODE_ID}`,
      `host:memory:${ANALYSIS_WORKER_NODE_ID}`,
    ],
  }),
);

/** 部品「解析の置き場」の選択肢（土台の事業者ごとの同居・端末・併用と、worker）。 */
export const ANALYSIS_COMPONENTS: readonly ComponentOption[] = [
  ...PLATFORMS.flatMap((platform): ComponentOption[] => [
    {
      id: 'same',
      slot: 'analysis',
      platform,
      label: 'アプリと同じ実行環境',
      note: sameNote(platform),
      premiseRefs: [],
    },
    {
      id: 'client',
      slot: 'analysis',
      platform,
      label: '利用者の端末（ブラウザ）',
      note: CLIENT_NOTE,
      premiseRefs: [],
    },
    {
      id: 'hybrid',
      slot: 'analysis',
      platform,
      label: '端末で速報・アプリと同じ実行環境で本解析',
      note: hybridNote(platform),
      premiseRefs: [],
    },
  ]),
  // アプリが さくらの VPS のときは、同じ事業者の VPS をもう 1 台足す（同居は「アプリと同じ実行環境」）
  ...(['2gb', '4gb'] as const).map((plan): ComponentOption => ({
    id: `worker-vps-${plan}`,
    slot: 'analysis',
    platform: 'sakura',
    label: `解析の worker に VPS ${plan.toUpperCase()} をもう 1 台足す`,
    note: workerNote(plan, true),
    premiseRefs: [...ANALYSIS_PARTS[0]!.premiseRefs],
  })),
  ...ANALYSIS_PARTS.flatMap((p) => partOptions(p)),
];

/** worker の VPS のノード（DB・画像を置かない・nginx を通さない）。 */
function workerNode(plan: '2gb' | '4gb'): ArchNodeIn {
  const base = vpsNode(
    plan,
    false,
    `さくらの VPS ${plan.toUpperCase()}（解析の worker）`,
    false,
  );
  if (base.config.kind !== 'host') return base;
  return {
    ...base,
    id: ANALYSIS_WORKER_NODE_ID,
    config: {
      ...base.config,
      residentMemoryGB: ANALYSIS_WORKER_RESIDENT_GB,
      otherDiskGB: ANALYSIS_WORKER_DISK_GB,
      dbCpuMsPerQuery: 0,
      // 受けるリクエストは無い（worker がアプリの API から取り、結果を送る）
      proxyCpuMsPerRequest: 0,
      storesDb: false,
    },
  };
}

/** アプリの API を動かす処理（役割 compute で、関数・コンテナ・ホスト）。 */
const isAppCompute = (n: ArchNodeIn): boolean =>
  n.role === 'compute' &&
  (n.config.kind === 'function' ||
    n.config.kind === 'container' ||
    n.config.kind === 'host');

/**
 * 解析の置き場を構成に当てる（composeStack から、API の置き場を差した後に呼ぶ）。選択が無ければ構成を変えない
 * （非同期の API は estimator が api の経路で流す）。
 */
export function applyAnalysis(
  arch: ArchitectureInput,
  choice: string | undefined,
): ArchitectureInput {
  if (choice === undefined) return arch;
  const api = arch.routes.api ?? [];
  const routes = { ...arch.routes };
  // オリジンへの転送を数えるクラスを挙げた CDN（Vercel の Fast Origin Transfer）は、API と同じく非同期の API も数える
  const withOrigin = (ns: readonly ArchNodeIn[]): ArchNodeIn[] =>
    ns.map((n): ArchNodeIn => {
      const c = n.config;
      return c.kind === 'cdn' && c.originClasses?.includes('api')
        ? ({
            ...n,
            config: { ...c, originClasses: [...c.originClasses, 'api-async'] },
          } as ArchNodeIn)
        : n;
    });
  // 端末だけで解析する: 非同期の API は無い（結果の送信はブラウザから呼ぶ API。Workload の側で api に替える）
  if (!serverAnalyzes(choice)) {
    delete routes['api-async'];
    return { ...arch, routes };
  }
  const plan = analysisWorkerPlan(choice);
  if (plan === undefined) {
    // アプリと同じ実行環境・併用: API と同じ経路
    routes['api-async'] = [...api];
    return { ...arch, nodes: withOrigin(arch.nodes), routes };
  }
  // worker: 解析は worker の VPS、結果はアプリの API（同じ経路）に送り、アプリの処理は受けて書くだけ
  const worker = workerNode(plan);
  const onApi = new Set(api);
  const out = transferNodes(
    worker,
    arch.nodes.find((n) => onApi.has(n.id) && n.billing)?.billing?.provider ??
      'sakura',
    '解析の結果の送信',
  );
  const nodes = withOrigin(arch.nodes).map((n): ArchNodeIn => {
    if (!onApi.has(n.id) || !isAppCompute(n)) return n;
    const c = n.config;
    if (c.kind !== 'function' && c.kind !== 'container' && c.kind !== 'host')
      return n;
    return {
      ...n,
      config: {
        ...c,
        classCpuMs: {
          ...(c.classCpuMs ?? {}),
          'api-async': ANALYSIS_RESULT_CPU_MS,
        },
      },
    } as ArchNodeIn;
  });
  routes['api-async'] = [worker.id, ...out.map((n) => n.id), ...api];
  return { ...arch, nodes: [...nodes, ...out, worker], routes };
}

/**
 * 解析の置き場が Workload を変えるもの（composeStack と対で、applyComponentsToWorkload から呼ぶ）。
 * 端末: 非同期の解析をやめ、ブラウザが結果を送る API（受けて書くだけの CPU）にする。送る回数は区切り方の件数のまま（D-236）。
 * 端末・併用: エンジンと評価関数を配る。
 */
export function applyAnalysisToWorkload(
  w: WorkloadInput,
  choice: string | undefined,
  browser: BrowserAnalysisShape | undefined,
): WorkloadInput {
  if (choice === undefined || w.api.invocation !== 'async') return w;
  let out = w;
  if (!serverAnalyzes(choice)) {
    const { invocation: _i, ...api } = w.api;
    void _i;
    out = {
      ...out,
      api: {
        ...api,
        cpuMs: ANALYSIS_RESULT_CPU_MS,
        ioWaitMs: ANALYSIS_RESULT_IO_MS,
      },
    };
  }
  if (browserAnalyzes(choice) && browser)
    out = {
      ...out,
      visitAssets: {
        sizeKB: browser.engineKB,
        perVisit: browser.perVisit,
        browserReuse: browser.browserReuse,
      },
    };
  return out;
}
