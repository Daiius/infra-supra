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
import { bill as awsBill, COMPUTE_MEMORY_GB } from './aws.ts';
import {
  RUN_CONCURRENCY,
  RUN_IDLE_KEEP_SECONDS,
  RUN_MEMORY_GB,
  RUN_VCPU,
} from './gcp.ts';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/**
 * 解析の実行先（サーバーで解析するとき。D-245・prd/17 §5.6）。same: アプリと同じ実行環境・fn-*: 別の事業者のサーバーレス
 * （Web の事業者から独立して選ぶ。結果はアプリの API に送る）・worker-vps-*: 解析だけの さくらの VPS。
 */
export const ANALYSIS_FN_TARGETS = [
  'fn-lambda',
  'fn-cloud-run',
  'fn-workers',
  'fn-vercel',
] as const;
export type AnalysisFnTarget = (typeof ANALYSIS_FN_TARGETS)[number];
export const ANALYSIS_TARGETS = [
  'same',
  ...ANALYSIS_FN_TARGETS,
  'worker-vps-2gb',
  'worker-vps-4gb',
] as const;
export type AnalysisTarget = (typeof ANALYSIS_TARGETS)[number];

/** 解析の置き方（D-245）。server: サーバーだけ・client: 利用者の端末だけ・hybrid: 端末で速報、サーバーで本解析。 */
export const ANALYSIS_MODES = ['server', 'client', 'hybrid'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

/** 置き方と実行先から部品の id（今の id は保つ: same・client・hybrid・worker-vps-*。併用は hybrid-<実行先>）。 */
export function analysisPlacementId(
  mode: AnalysisMode,
  target: AnalysisTarget = 'same',
): string {
  if (mode === 'client') return 'client';
  if (mode === 'server') return target;
  return target === 'same' ? 'hybrid' : `hybrid-${target}`;
}

/** 部品の id を置き方と実行先に分ける（省略・知らない id は同じ実行環境のサーバー。端末だけは実行先なし）。 */
export function analysisPlacementOf(id: string | undefined): {
  mode: AnalysisMode;
  target?: AnalysisTarget;
} {
  if (id === 'client') return { mode: 'client' };
  if (id === 'hybrid') return { mode: 'hybrid', target: 'same' };
  const rest = id?.startsWith('hybrid-') ? id.slice('hybrid-'.length) : id;
  const target = (ANALYSIS_TARGETS as readonly string[]).includes(rest ?? '')
    ? (rest as AnalysisTarget)
    : 'same';
  return { mode: rest === id ? 'server' : 'hybrid', target };
}

/** 解析の置き場の選択肢の id（置き方 × 実行先）。 */
export const ANALYSIS_PLACEMENTS = [
  'client',
  ...ANALYSIS_TARGETS,
  ...ANALYSIS_TARGETS.map((t) => analysisPlacementId('hybrid', t)),
] as const;
export type AnalysisPlacement = string;

/** worker の VPS のプラン（選択肢の id から。併用の本解析も含む。worker でなければ undefined）。 */
export const analysisWorkerPlan = (
  id: string | undefined,
): '2gb' | '4gb' | undefined => {
  const t = analysisPlacementOf(id).target;
  return t === 'worker-vps-2gb'
    ? '2gb'
    : t === 'worker-vps-4gb'
      ? '4gb'
      : undefined;
};

/** 別の事業者のサーバーレスの実行先（併用の本解析も含む。そうでなければ undefined）。 */
export const analysisFnTarget = (
  id: string | undefined,
): AnalysisFnTarget | undefined => {
  const t = analysisPlacementOf(id).target;
  return (ANALYSIS_FN_TARGETS as readonly string[]).includes(t ?? '')
    ? (t as AnalysisFnTarget)
    : undefined;
};

/** サーバーが解析するか（端末だけの置き場は解析しない）。 */
export const serverAnalyzes = (id: string | undefined): boolean =>
  analysisPlacementOf(id).mode !== 'client';

/** 端末で解析するか（端末・併用。エンジンと評価関数を配る）。 */
export const browserAnalyzes = (id: string | undefined): boolean =>
  analysisPlacementOf(id).mode !== 'server';

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
  aws: '同じアカウントの Lambda（Amplify の SSR とは別の関数）',
  'aws-opennext': 'Lambda',
  netlify: 'Netlify のバックグラウンド関数',
  gcp: 'Cloud Run',
};

/** 構成ごとの「アプリと同じ実行環境」の選択肢の名前（具体的なサービスの名前で見せる）。 */
const SERVICE: Record<Platform, string> = {
  cloudflare: 'Cloudflare Workers',
  vercel: 'Vercel Functions',
  sakura: 'アプリと同じ VPS',
  aws: 'AWS Lambda',
  'aws-opennext': 'AWS Lambda',
  netlify: 'Netlify Background Functions',
  gcp: 'Cloud Run',
};

const PLATFORMS = Object.keys(RUNTIME) as Platform[];

const sameNote = (p: Platform) =>
  p === 'sakura'
    ? '解析を同じ VPS の別のプロセスで動かします。月額は変わりませんが、解析の CPU がアプリと同じ VPS の使用率に入り、混むとページも解析も遅くなります'
    : `解析を${RUNTIME[p]}で動かします（${p === 'aws' ? 'Amplify の SSR はキューから起こせないので、同じアカウントに別の関数を置きます' : '今のアプリと同じ所'}）。使った分だけ払う従量で、件数が増えても並べて動きますが、1 件の CPU・時間の上限（事業者ごと）に当たると止まります`;

const CLIENT_NOTE =
  '解析のエンジンと軽い評価関数をブラウザに配り（WebAssembly）、利用者の端末で解析します。サーバーの解析の CPU は 0 になり、代わりに配るファイル（大きさはゲーム上の仮定）の転送が増えます。' +
  '結果はアプリの API に送って DB に書くので、書き込みと保存の量は変わりません。アプリを開いている間だけ動きます';

const hybridNote = (p: Platform) =>
  `端末で速報を出し（保存しない）、本解析は${RUNTIME[p]}で動かします（「${SERVICE[p]}」の選択肢と同じ数え方）。費用は端末に配るファイルの転送と、サーバーの本解析の両方です`;

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

/** 解析の Lambda のメモリ（GB。仮定: Amplify の SSR・API の Lambda と同じ大きさ。aws.ts の COMPUTE_MEMORY_GB）。 */
export const ANALYSIS_LAMBDA_MEMORY_GB = COMPUTE_MEMORY_GB;
/** 解析の Vercel Functions のメモリ（GB。仮定: Vercel の構成の関数と同じ 2 GB）。 */
export const ANALYSIS_VERCEL_MEMORY_GB = 2;

/** 併用の説明（本解析の実行先の説明の前に、端末の速報を足す）。 */
const HYBRID_PREFIX =
  '端末で速報を出し（保存しない）、本解析はサーバーで動かします。費用は端末に配るファイルの転送と、サーバーの本解析の両方です。本解析は: ';

/**
 * 別の事業者のサーバーレスの実行先（D-245・prd/17 §5.6）。Web の事業者から独立して選ぶ。解析は別のノード（その事業者の
 * アカウント）で動かし、結果はアプリの API（HTTPS）に送って DB に書く（worker と同じ形。DB の接続の規則には触れない）。
 * プランは本番の解析に使えるもの（Workers Paid・Vercel Pro。Free・Hobby は解析の重さに使えない）。基本料は、そのアカウントが
 * 構成に無ければ新しく足される（API の置き場の別アカウントと同じ数え方。D-65・D-67）。
 */
export const ANALYSIS_FN: Record<
  AnalysisFnTarget,
  {
    provider: 'aws' | 'gcp' | 'cloudflare' | 'vercel';
    /** 選択肢・構成図に出すサービスの名前。 */
    service: string;
    note: string;
  }
> = {
  'fn-lambda': {
    provider: 'aws',
    service: 'AWS Lambda',
    note: `AWS のアカウントに解析の Lambda（メモリ ${ANALYSIS_LAMBDA_MEMORY_GB} GB）を置き、キューから起こします。実行時間 × メモリの従量で、件数が増えても並べて動きます。1 件の時間の上限に当たると止まります`,
  },
  'fn-cloud-run': {
    provider: 'gcp',
    service: 'Cloud Run',
    note: 'Google Cloud に解析のコンテナ（Cloud Run。アプリの構成の Cloud Run と同じ大きさ）を置きます。リクエストを処理している間の CPU・メモリの従量で、件数が増えてもインスタンスが増えます。1 件の時間の上限に当たると止まります',
  },
  'fn-workers': {
    provider: 'cloudflare',
    service: 'Cloudflare Workers',
    note: 'Cloudflare のアカウント（Workers Paid）にキューの受け手の Worker を置きます。CPU 時間の従量で、待ちの時間は課金されません。1 件の CPU 時間の上限に当たると止まります',
  },
  'fn-vercel': {
    provider: 'vercel',
    service: 'Vercel Functions',
    note: 'Vercel のアカウント（Pro）に解析の関数を置きます。動いている CPU の時間とメモリの従量で、件数が増えても並べて動きます。1 件の実行時間の上限に当たると止まります',
  },
};

const FN_ELSEWHERE_NOTE =
  '解析の結果はアプリの API（HTTPS）に送って DB に書きます（アプリの側は受けて書くだけ）。アプリと別の事業者なら、アカウントと請求が 1 つ増え、外へ送る転送を数えます。往復の遅延は計算しません';

/** 実行先のサービスの名前（選択肢・説明の文）。土台の事業者で「同じ実行環境」の名前が決まる。 */
export function analysisTargetName(
  target: AnalysisTarget,
  platform: Platform,
): string {
  if (target === 'same') return SERVICE[platform];
  if (target === 'worker-vps-2gb' || target === 'worker-vps-4gb')
    return `さくらの VPS ${target.slice(-3).toUpperCase()}（解析の worker）`;
  return ANALYSIS_FN[target].service;
}

/** 別の事業者のサーバーレスの部品（どの土台にも差せる。同じ事業者の土台では「同じ実行環境」と重なるので出さない）。 */
const fnPart = (target: AnalysisFnTarget, hybrid: boolean): PartDef => {
  const f = ANALYSIS_FN[target];
  return {
    id: analysisPlacementId(hybrid ? 'hybrid' : 'server', target),
    slot: 'analysis',
    platform: f.provider,
    role: 'compute',
    accepts: [],
    attachesTo: ['compute'],
    as: target,
    label: hybrid ? `端末で速報・${f.service}で本解析` : f.service,
    note: `${hybrid ? HYBRID_PREFIX : ''}${f.note}。${FN_ELSEWHERE_NOTE}`,
    premiseRefs: [],
  };
};

/** 併用の worker の部品（他の事業者の土台に差す）。 */
const hybridWorkerPart = (p: PartDef): PartDef => ({
  ...p,
  id: `hybrid-${p.id}`,
  label: `端末で速報・${analysisTargetName(p.id as AnalysisTarget, 'sakura')}で本解析`,
  note: `${HYBRID_PREFIX}${p.note}`,
});

/** 同じ事業者の別の名前の土台（AWS の Lambda は OpenNext の構成の関数と重なる）は、別の事業者の部品を差さない。 */
const fnHosts = (o: ComponentOption): ComponentOption => ({
  ...o,
  hosts: (o.hosts ?? []).filter(
    (h) => !(o.platform === 'aws' && h === 'aws-opennext'),
  ),
});

/** 部品「解析の置き場」の選択肢（土台の事業者ごとの同居・端末・併用と、別の事業者のサーバーレス・worker とその併用）。 */
export const ANALYSIS_COMPONENTS: readonly ComponentOption[] = [
  ...PLATFORMS.flatMap((platform): ComponentOption[] => [
    {
      id: 'same',
      slot: 'analysis',
      platform,
      label: SERVICE[platform],
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
      label: `端末で速報・${SERVICE[platform]}で本解析`,
      note: hybridNote(platform),
      premiseRefs: [],
    },
  ]),
  // アプリが さくらの VPS のときは、同じ事業者の VPS をもう 1 台足す（同居は「アプリと同じ実行環境」）
  ...(['2gb', '4gb'] as const).flatMap((plan): ComponentOption[] => {
    const own: ComponentOption = {
      id: `worker-vps-${plan}`,
      slot: 'analysis',
      platform: 'sakura',
      label: `解析の worker に VPS ${plan.toUpperCase()} をもう 1 台足す`,
      note: workerNote(plan, true),
      premiseRefs: [...ANALYSIS_PARTS[0]!.premiseRefs],
    };
    return [
      own,
      {
        ...own,
        id: `hybrid-${own.id}`,
        label: `端末で速報・解析の worker（VPS ${plan.toUpperCase()} をもう 1 台）で本解析`,
        note: `${HYBRID_PREFIX}${own.note}`,
      },
    ];
  }),
  ...ANALYSIS_PARTS.flatMap((p) => [
    ...partOptions(p),
    ...partOptions(hybridWorkerPart(p)),
  ]),
  ...ANALYSIS_FN_TARGETS.flatMap((t) => [
    ...partOptions(fnPart(t, false)).map(fnHosts),
    ...partOptions(fnPart(t, true)).map(fnHosts),
  ]),
];

/** 別の事業者のサーバーレスの実行先のノード（id は ANALYSIS_FN_NODE_ID。構成に 1 つだけ）。 */
function fnNode(target: AnalysisFnTarget): ArchNodeIn {
  const base = {
    id: ANALYSIS_FN_NODE_ID,
    role: 'compute' as const,
    label: `${ANALYSIS_FN[target].service}（解析）`,
  };
  switch (target) {
    case 'fn-lambda':
      return {
        ...base,
        config: {
          kind: 'function',
          memoryGB: ANALYSIS_LAMBDA_MEMORY_GB,
          concurrency: 1,
        },
        billing: awsBill('lambda', {
          invocations: 'requests',
          'memory-gb-hours': 'compute',
        }),
      };
    case 'fn-cloud-run':
      return {
        ...base,
        config: {
          kind: 'container',
          vcpu: RUN_VCPU,
          memoryGB: RUN_MEMORY_GB,
          concurrency: RUN_CONCURRENCY,
          minInstances: 0,
          idleKeepSeconds: RUN_IDLE_KEEP_SECONDS,
        },
        billing: {
          accountId: 'gcp',
          provider: 'gcp',
          planId: 'cloud-run',
          meters: {
            requests: 'requests',
            'cpu-hours': 'cpu',
            'memory-gb-hours': 'memory',
            'idle-cpu-hours': 'idle-cpu',
            'idle-memory-gb-hours': 'idle-memory',
          },
        },
      };
    case 'fn-workers':
      return {
        ...base,
        config: { kind: 'function' },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-paid',
          meters: { requests: 'requests', 'cpu-ms': 'cpu-ms' },
        },
      };
    case 'fn-vercel':
      return {
        ...base,
        config: {
          kind: 'function',
          memoryGB: ANALYSIS_VERCEL_MEMORY_GB,
          concurrency: 1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            invocations: 'invocations',
            'cpu-ms': 'active-cpu',
            'memory-gb-hours': 'provisioned-memory',
          },
        },
      };
  }
}

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

/** AWS の構成で解析を動かす Lambda のノードの id。 */
export const ANALYSIS_FN_NODE_ID = 'analysis-fn';

/**
 * アプリの処理がキューから起こせない実行環境なら、解析を動かす別の関数を返す（そうでなければ undefined）。
 * Amplify Hosting の SSR は HTTP の応答を返すための実行環境で、キューから起こす口が無く、単価も Lambda の約 3.3 倍
 * （$0.20 / GB 時間 ≒ $0.0000556 / GB 秒。Lambda は $0.0000166667）。AWS で積んだ解析を流すなら、同じアカウントに
 * Lambda を置くのが自然なので、そちらで数える。メモリは SSR と同じ（ゲーム上の仮定）。
 */
function asyncComputeFor(n: ArchNodeIn): ArchNodeIn | undefined {
  const c = n.config;
  if (
    c.kind !== 'function' ||
    n.billing?.provider !== 'aws' ||
    n.billing.planId !== 'amplify-hosting'
  )
    return undefined;
  return {
    id: ANALYSIS_FN_NODE_ID,
    role: 'compute',
    label: 'Lambda（解析）',
    config: { kind: 'function', memoryGB: c.memoryGB, concurrency: 1 },
    billing: {
      ...n.billing,
      planId: 'lambda',
      meters: { invocations: 'requests', 'memory-gb-hours': 'compute' },
    },
  };
}

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
  const fnTarget = analysisFnTarget(choice);
  if (plan === undefined && fnTarget === undefined) {
    // アプリの処理がキューから起こせない（Amplify の SSR）なら、同じアカウントの別の関数で解析し、DB へは API と同じ先に書く
    const app = arch.nodes.find((n) => api.includes(n.id) && isAppCompute(n));
    const fn = app && asyncComputeFor(app);
    if (app && fn) {
      routes['api-async'] = [fn.id, ...api.slice(api.indexOf(app.id) + 1)];
      return { ...arch, nodes: [...arch.nodes, fn], routes };
    }
    // アプリと同じ実行環境・併用: API と同じ経路
    routes['api-async'] = [...api];
    return { ...arch, nodes: withOrigin(arch.nodes), routes };
  }
  // worker・別の事業者のサーバーレス（D-245）: 解析は別のノード、結果はアプリの API（同じ経路）に送り、アプリの処理は受けて書くだけ
  const worker = plan ? workerNode(plan) : fnNode(fnTarget!);
  const onApi = new Set(api);
  const out = transferNodes(
    worker,
    arch.nodes.find((n) => onApi.has(n.id) && n.billing)?.billing?.provider ??
      'sakura',
    '解析の結果の送信',
  );
  // 同じ事業者の外への転送のノードが構成にもうあれば（API を同じ事業者に置いた構成）、それを経路に入れて数える
  const have = new Set(arch.nodes.map((n) => n.id));
  const added = out.filter((n) => !have.has(n.id));
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
  return { ...arch, nodes: [...nodes, ...added, worker], routes };
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
