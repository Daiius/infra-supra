// シナリオ: 棋譜解析サービス（prd/17）。遊べる形（PR-10・D-241）。開発中の印（preview）付きで、`?preview=1` のときだけ始める画面に出し、
// 集計には送らない。出来事は prd/17 §6 の 6 つと共通のもの。遊びの値（規模・収益・目標・基準プレイ）は KF-16 の基準で決めた（PR-11・D-242・
// prd/17 §6.6）。成長・満足度の境目・工数・最初の所持金は受託（contract-operations）のものを借りたまま（基準を満たしたので動かさない）。
// 値はすべてゲーム上の仮定で、実在の値でも相場でもない。料金・制限は catalog のデータをそのまま使う。
import {
  KIFU_ANALYSIS_ASTRO,
  KIFU_ANALYSIS_JOB,
  KIFU_BROWSER_ANALYSIS,
  KIFU_CANDIDATES,
  KIFU_ANALYSIS_ROUTES,
  KIFU_ANALYSIS_SPA,
  KIFU_DB_GB_PER_MILLION_PV,
  KIFU_GAMES_PER_MAU,
  KIFU_MOVES_PER_GAME,
  KIFU_PV_PER_MAU,
  KIFU_STUDY_REALTIME,
  kifuAnalysis,
  STACK_DEFS,
} from 'catalog';
import type { Action, GameState } from '../state.ts';
import type {
  BackgroundJobDef,
  EventDef,
  PageWireframe,
  Scenario,
  Strategy,
} from '../scenario.ts';
import { CONTRACT_OPERATIONS } from './contract-operations.ts';

/** 個人のページの作られ方（受託の業務の画面と同じ: Next.js・Astro は SSR、静的書き出しは枠 + API、SPA はシェル + API）。 */
const personalSources = (frame: string[], content: string[]) => ({
  nextjs: Object.fromEntries(
    [...frame, ...content].map((id) => [id, 'ssr' as const]),
  ),
  astro: Object.fromEntries(
    [...frame, ...content].map((id) => [id, 'ssr' as const]),
  ),
  'nextjs-export': Object.fromEntries([
    ...frame.map((id) => [id, 'build' as const]),
    ...content.map((id) => [id, 'api' as const]),
  ]),
  'vite-spa': Object.fromEntries([
    ...frame.map((id) => [id, 'shell' as const]),
    ...content.map((id) => [id, 'api' as const]),
  ]),
});
const PERSONAL_BADGES: PageWireframe['badges'] = {
  nextjs: [{ kind: 'cpu', text: 'CPU: 閲覧ごとにサーバーが描く' }],
  astro: [{ kind: 'cpu', text: 'CPU: 閲覧ごとにサーバーが描く' }],
  'nextjs-export': [{ kind: 'api', text: 'API: 1 PV あたり 1 回増える' }],
  'vite-spa': [{ kind: 'api', text: 'API: 1 PV あたり 1 回増える' }],
};

/**
 * ページの見取り図（D-102。ゲーム上の仮定の図）。解析そのもの（重い API）はページの外で動く（非同期）ので区画にしない。
 */
const KIFU_WIREFRAMES: PageWireframe[] = [
  {
    route: 'kifu',
    regions: [
      {
        id: 'header',
        kind: 'header',
        label: 'ヘッダー（ログイン中）',
        needs: ['personal'],
      },
      {
        id: 'graph',
        kind: 'body',
        label: '評価値のグラフ',
        height: 'md',
        needs: ['personal', 'fresh'],
      },
      {
        id: 'moves',
        kind: 'list',
        label: '手の一覧と悪手の印',
        width: 'half',
        height: 'lg',
        needs: ['personal', 'fresh'],
      },
      {
        id: 'candidates',
        kind: 'table',
        label: '候補と読み筋',
        width: 'half',
        height: 'lg',
        needs: ['personal', 'fresh'],
      },
    ],
    islandRegions: ['header', 'graph', 'moves', 'candidates'],
    byFramework: personalSources(['header'], ['graph', 'moves', 'candidates']),
    badges: PERSONAL_BADGES,
  },
  {
    route: 'list',
    regions: [
      {
        id: 'header',
        kind: 'header',
        label: 'ヘッダー（ログイン中）',
        needs: ['personal'],
      },
      { id: 'menu', kind: 'menu', label: 'メニュー', needs: ['same'] },
      {
        id: 'list',
        kind: 'list',
        label: '棋譜の一覧と解析の状況',
        height: 'lg',
        needs: ['personal', 'fresh'],
      },
      {
        id: 'upload',
        kind: 'form',
        label: '棋譜のアップロード（送信は API）',
        height: 'sm',
        needs: ['input'],
      },
    ],
    islandRegions: ['header', 'list'],
    byFramework: personalSources(['menu', 'upload'], ['header', 'list']),
    badges: PERSONAL_BADGES,
  },
  {
    route: 'share',
    regions: [
      {
        id: 'header',
        kind: 'header',
        label: 'ヘッダー・ナビ',
        needs: ['same'],
      },
      {
        id: 'title',
        kind: 'title',
        label: '棋譜の題・対局者',
        needs: ['same', 'ogp'],
      },
      {
        id: 'graph',
        kind: 'body',
        label: '評価値のグラフ',
        height: 'md',
        needs: ['same'],
      },
    ],
    byFramework: {
      nextjs: { header: 'isr', title: 'isr', graph: 'isr' },
      astro: { header: 'cached', title: 'cached', graph: 'cached' },
      'nextjs-export': { header: 'build', title: 'build', graph: 'build' },
      'vite-spa': { header: 'shell', title: 'api', graph: 'api' },
    },
    shellPerPage: {
      sources: { header: 'build', title: 'build', graph: 'api' },
      badges: [
        { kind: 'ogp', text: 'SNS のカード: 棋譜ごとの枠に入る' },
        { kind: 'api', text: 'API: 1 PV あたり 1 回増える' },
      ],
    },
    badges: {
      nextjs: [{ kind: 'ogp', text: 'SNS のカード: HTML に入る' }],
      astro: [{ kind: 'ogp', text: 'SNS のカード: HTML に入る' }],
      'nextjs-export': [{ kind: 'ogp', text: 'SNS のカード: HTML に入る' }],
      'vite-spa': [
        { kind: 'ogp', text: 'SNS のカード: 前処理の部品が要る' },
        { kind: 'api', text: 'API: 1 PV あたり 1 回増える' },
      ],
    },
  },
];

/**
 * 満足度の重み（D-238。ゲーム上の仮定。合計 1）。解析の速さ（感度 高）は可用性の次に重く、解析の正確さは速さより軽い（KF-10）。
 * 画像・反映スピードは判定に使わない（受託と同じ 0）。
 */
export const KIFU_SATISFACTION_WEIGHTS: Scenario['satisfaction']['weights'] = {
  availability: 0.35,
  speed: 0.15,
  feature: 0.15,
  freshness: 0,
  quality: 0,
  analysisSpeed: 0.25,
  analysisAccuracy: 0.1,
};

/**
 * 解析の速さ・正確さの仮定（D-238・prd/17 §5.5。どれもゲーム上の仮定。PR-11 の基準プレイで見直し、そのまま採った。D-242）。
 * - 良い: 1 局の解析が 5 分以内に見える（利用者がページを開いている間。P-4）。普通: 15 分以内（少し離れて戻れば見える）。
 * - 滞留: ピークの比が 1 を超えた分 × 30 分（ピークの 1 時間のうちに積み上がった分を、届いた解析が平均して待つ）。
 * - 端末: 1 局面の CPU × 0.5（軽い評価関数で 1 局面は軽いが、端末はサーバーより遅い）。遅い端末はその 3 倍。
 * - 正確さ: 候補 3 つ以上で良い（候補 1 つは普通）。端末の評価関数では下げない（D-244）。
 */
export const KIFU_ANALYSIS_SATISFACTION: NonNullable<
  Scenario['satisfaction']['analysis']
> = {
  speed: { goodSec: 300, fairSec: 900 },
  stallWindowSec: 1800,
  client: { cpuFactor: 0.5, slowDeviceFactor: 3 },
  accuracy: { goodCandidates: KIFU_CANDIDATES },
};

/**
 * 出来事 7「バックエンドの長時間の処理」の処理（D-239・prd/17 §6。提案の文言・起きる月は PR-10）。解析の結果は変えず、ためた解析の結果を
 * 読み直して集計する裏の処理。量（vCPU 時間）と終わったときの効果はどれもゲーム上の仮定（PR-11 で見直し、そのまま採った。D-242:
 * VPS は空きで 2〜3 か月・追加の費用 0、サーバーレスはその月に $140〜$400 を払うので、受けるかどうかが構成で分かれる）。
 * - 戦法の分析の更新: 2,000 vCPU 時間。終わると機能 +4・成長 +2 ポイント × 3 か月（新しい戦法の傾向が見えて話題になる）。
 * - 次の一手の問題の選び方の更新: 1,000 vCPU 時間。終わると機能 +3。
 */
export const KIFU_BACKGROUND_JOBS: Record<
  'strategy' | 'problems',
  BackgroundJobDef
> = {
  strategy: {
    label: '戦法の分析の更新',
    vcpuHours: 2_000,
    onDone: [
      { type: 'feature', points: 4 },
      { type: 'growth', add: 0.02, months: 3 },
    ],
  },
  problems: {
    label: '次の一手の問題の選び方の更新',
    vcpuHours: 1_000,
    onDone: [{ type: 'feature', points: 3 }],
  },
};

/**
 * 出来事（prd/17 §6・D-241）。時期・確率・効果の値はどれもゲーム上の仮定（PR-11 の基準プレイで見直し、そのまま採った。D-242）。序盤の 1〜2 か月目は
 * 台本・提案を出さない（D-20 V-12）。Bot（解析はログインした利用者だけ）と完了のメール（開いている間に終わる）は入れない（§6.2）。
 * 込み分の 70%・料金の改定の予告（revisions。D-226）・自前の VPS の障害（incidents）は共通の作法のまま。
 */
const KIFU_EVENTS: EventDef[] = [
  // ---- 状態で起きる（S）----
  {
    id: 'k-s-allowance',
    kind: 'state',
    tier: 'common',
    title: 'プランに含まれる分・クレジットの 70% を超えた',
    text: '解析の CPU と利用の増加で、プランに含まれる分（Vercel Pro は月のクレジット）に近づきました。超えた分は従量で払います',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-requests',
        'pool:cloudflare:workers-paid:paid-cpu-ms',
        'credit:vercel:pro:usage-credit',
        'pool:supabase:pro-micro:pro-egress',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 'k-s-db-size',
    kind: 'state',
    tier: 'occasional',
    title: 'DB が大きくなった',
    text: '上がった棋譜と解析の結果がたまり、DB の保存量がプランに含まれる分・上限に近づきました',
    when: {
      type: 'premise',
      premiseIds: [
        'pool:cloudflare:workers-paid:paid-d1-storage',
        'pool:supabase:pro-micro:pro-disk',
        'limit:cloudflare:workers-free:d1-db-size',
        'limit:supabase:free:db-size',
        'host:disk:',
      ],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  {
    id: 'k-s-d1-limit',
    kind: 'state',
    tier: 'rare',
    title: 'D1 が 10 GB に近づいた',
    text: 'D1 のデータベースの大きさは引き上げられません。超えると止まるので、保存の形を見直すか乗り換えを考える時期です',
    when: {
      type: 'premise',
      premiseIds: ['limit:cloudflare:workers-paid:d1-db-size'],
      atLeast: 0.7,
    },
    premiseRefs: [],
  },
  // ---- 提案として来る（P）----
  {
    // 出来事 2（KF-15）。端末が置き場なら、取り込んだ分は利用者が開いたときに端末で解析する（サーバーの解析は増えない）
    id: 'k-p-import',
    kind: 'proposal',
    tier: 'common',
    title: '過去の棋譜をまとめて取り込みたい',
    text: '利用者から、ほかの所にためていた過去の棋譜をまとめて取り込みたいという要望です。受けると、翌月は取り込んだ分の解析が一気に増え、棋譜と解析の結果もまとめてたまります（収益は増えません）。解析の置き場が利用者の端末なら、取り込んだ分は開いたときに端末で解析するので、サーバーの解析は増えません',
    when: { type: 'window', from: 3, to: 8 },
    premiseRefs: [
      'pool:cloudflare:workers-paid:paid-cpu-ms',
      'pool:cloudflare:workers-paid:paid-d1-storage',
      'limit:cloudflare:workers-paid:d1-db-size',
      'credit:vercel:pro:usage-credit',
      'pool:supabase:pro-micro:pro-disk',
      'host:cpu:',
      'host:disk:',
    ],
    accept: {
      label: '受ける',
      cost: '工数 3',
      effects: [
        // 利用者 1 人が過去の棋譜を 2 か月分ほど上げる（翌月の解析と DB の増え方が 3 倍。ゲーム上の仮定）
        { type: 'analysis-burst', factor: 3, months: 1 },
        { type: 'feature', points: 4 },
        { type: 'interrupt', featureWork: true, points: 3, months: 1 },
      ],
    },
  },
  {
    // 出来事 5（KF-15）。共有の仕組みの細部はここでは考え尽くさない。SPA は OGP の前処理の部品が無いとカードが出ない
    id: 'k-p-share-ogp',
    kind: 'proposal',
    tier: 'occasional',
    title: '棋譜を画像付きのカードで共有したい',
    text: '利用者から、解析した棋譜を SNS で共有したとき、評価値のグラフの画像が入ったカード（OGP）で見せたいという要望です。共有のページを見に来るログインしていない人が増え、利用者が伸びます。ページごとのカードが HTML に入らない構成（SPA で OGP の前処理の部品なし）では、カードが出ないので伸びが小さくなります',
    when: { type: 'window', from: 3, to: 9 },
    premiseRefs: ['host:cpu:', 'pool:cloudflare:workers-paid:paid-requests'],
    accept: {
      label: '受ける',
      cost: '工数 2',
      effects: [
        { type: 'feature', points: 4 },
        { type: 'growth', add: 0.03, months: 3, social: true },
        { type: 'interrupt', featureWork: true, points: 2, months: 1 },
      ],
    },
  },
  {
    // 出来事 6（KF-15・D-240）。受けるとその構成の手段（realtimeOptionFor）を付ける。セッションを保てない構成でも受けられ、
    // 提案にはつなぎ直し・盤面の置き場の文を出す。手段の無い構成（隠した構成）では受けられない（受けるには構成の変更が要る）
    id: 'k-p-study',
    kind: 'proposal',
    tier: 'occasional',
    title: '研究会で一緒に検討したい',
    text: '利用者から、仲間と同じ盤面を見ながら、手を動かしたり書き込んだりして一緒に検討したいという要望です。参加している間ずっと接続（WebSocket）を保ち、1 回の研究会は 90 分ほど続きます。セッションを保てない構成では、接続が切れるたびにつなぎ直し、盤面をインスタンスの外に置く作りになります',
    when: { type: 'window', from: 4, to: 9 },
    premiseRefs: [
      'pool:cloudflare:durable-objects-',
      'credit:vercel:pro:usage-credit',
      'host:memory:',
      'pool:gcp:run-free-',
      'pool:aws:lambda:lambda-free-',
    ],
    accept: {
      label: '受ける',
      cost: 'リアルタイムの部品を付ける。工数 4',
      effects: [
        { type: 'workload', mods: { realtime: KIFU_STUDY_REALTIME } },
        { type: 'realtime-component' },
        { type: 'feature', points: 6 },
        { type: 'growth', add: 0.02, months: 3 },
        { type: 'interrupt', featureWork: true, points: 4, months: 1 },
      ],
    },
  },
  {
    // 出来事 7（KF-15・D-239）。置き場によらずサーバーで、空いている容量で少しずつ進む（VPS は追加の費用 0・サーバーレスはその月に払う）
    id: 'k-p-strategy',
    kind: 'proposal',
    tier: 'occasional',
    title: '戦法の分析を新しくしたい',
    text: 'ためた解析の結果を読み直して、戦法ごとの傾向の分析を新しくしたいという案です。解析の結果は変えない裏の長い処理で、置き場によらずサーバーで動きます。VPS なら空いている CPU で少しずつ進み（追加の費用はほぼ 0）、サーバーレスならその月に流して CPU の分を払います',
    when: { type: 'window', from: 4, to: 10 },
    premiseRefs: [
      'host:cpu:',
      'credit:vercel:pro:usage-credit',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
    ],
    accept: {
      label: '受ける',
      cost: '工数 2',
      effects: [
        { type: 'background-job', job: KIFU_BACKGROUND_JOBS.strategy },
        { type: 'interrupt', points: 2, months: 1 },
      ],
    },
  },
  {
    id: 'k-p-problems',
    kind: 'proposal',
    tier: 'occasional',
    title: '次の一手の問題の選び方を新しくしたい',
    text: 'ためた解析の結果から、次の一手の問題に向いた局面を選び直したいという案です。解析の結果は変えない裏の長い処理で、置き場によらずサーバーで動きます。VPS なら空いている CPU で少しずつ進み、サーバーレスならその月に流して CPU の分を払います',
    // 起きる確率（窓の中で 1 / 2）はゲーム上の仮定
    when: { type: 'window', from: 5, to: 10, chance: 0.5 },
    premiseRefs: [
      'host:cpu:',
      'credit:vercel:pro:usage-credit',
      'pool:cloudflare:workers-paid:paid-cpu-ms',
    ],
    accept: {
      label: '受ける',
      cost: '工数 2',
      effects: [
        { type: 'background-job', job: KIFU_BACKGROUND_JOBS.problems },
        { type: 'interrupt', points: 2, months: 1 },
      ],
    },
  },
  // ---- シナリオの台本（SC）----
  {
    // 出来事 1（KF-15）。個人の対局の解析が主の用途なので、対局が多く行われるイベントとして。閲覧と解析の依頼が数日に集中する
    id: 'k-tournament',
    kind: 'script',
    tier: 'common',
    title: '大きな対局イベントがあった',
    text: '対局が多く行われる大きなイベントがあり、今月は閲覧と解析の依頼が増え、イベントの数日に集中しました。解析の待ちが長くなりやすい月です。満足度が高ければ、その後も利用者が一部残ります',
    when: { type: 'window', from: 5, to: 10 },
    notice: {
      monthsAhead: 1,
      title: '大きな対局イベントがありそう',
      text: '来月、対局が多く行われる大きなイベントがあります。閲覧と解析の依頼がイベントの数日に集中する見込みです',
      notBefore: 3,
    },
    premiseRefs: [
      'pool:cloudflare:workers-free:',
      'pool:cloudflare:workers-paid:',
      'credit:vercel:pro:usage-credit',
      'host:cpu:',
      'pool:gcp:run-free-',
    ],
    effects: [
      {
        type: 'traffic',
        // PV と解析が 2 倍になり、上乗せ分は 3 日に集中する（容量の判定だけ。ゲーム上の仮定。D-44）
        factor: 2,
        earnsRevenue: true,
        months: 1,
        lasting: true,
        social: true,
        spikeDays: 3,
      },
    ],
  },
];

/** 構成の番号（catalog の構成の id から引く）。 */
const stackOf = (id: string): number => {
  const i = STACK_DEFS.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`構成が無い: ${id}`);
  return i;
};

const respondAll = (s: GameState, accept: boolean): Action[] =>
  s.pendingProposals.map((eventId) => ({ type: 'respond', eventId, accept }));

/** 1 か月目の終わりに解析の置き場を替える（D-64 の「構成に合った対策」の書き方。prd/12 §2.5 の語彙に収まる）。 */
const placeAnalysis = (option: string): Action[][] => [
  [{ type: 'component', slot: 'analysis', option }],
];

/**
 * 基準プレイ（D-242・prd/17 §6.6。KF-16 の基準で決めた）。構成ごとの「何もしない」（解析はアプリと同じ実行環境）と、構成に合った対策
 * （解析の置き場を 1 か月目の終わりに替える・提案を全部受ける）。結果の画面の比較の表と、シナリオの golden（kifu-analysis.test.ts）に使う。
 */
const KIFU_BASELINES: Strategy[] = [
  {
    id: 'cf-paid',
    label: 'Cloudflare Paid・何もしない（提案は断る）',
    short: 'CF Paid・何もしない',
    stackIndex: stackOf('cloudflare-vinext-paid'),
  },
  {
    id: 'cf-paid-accept',
    label: 'Cloudflare Paid・提案を全部受ける',
    short: 'CF Paid・提案を受ける',
    stackIndex: stackOf('cloudflare-vinext-paid'),
    decide: (s) => respondAll(s, true),
  },
  {
    id: 'cf-paid-client',
    label: 'Cloudflare Paid・1 か月目の終わりに解析を利用者の端末へ移す',
    short: 'CF Paid・端末で解析',
    stackIndex: stackOf('cloudflare-vinext-paid'),
    actions: placeAnalysis('client'),
  },
  {
    id: 'vps',
    label: 'さくらの VPS 2GB・何もしない（アプリと解析が同じ VPS）',
    short: 'VPS・何もしない',
    stackIndex: stackOf('sakura-vps-2gb'),
  },
  {
    id: 'vps-worker',
    label:
      'さくらの VPS 2GB・1 か月目の終わりに解析の worker（VPS 4GB）を足し、提案を全部受ける',
    short: 'VPS・worker 4GB',
    stackIndex: stackOf('sakura-vps-2gb'),
    decide: (s) => [
      ...(s.history.length === 1 ? placeAnalysis('worker-vps-4gb')[0]! : []),
      ...respondAll(s, true),
    ],
  },
  {
    id: 'vercel-pro',
    label: 'Vercel Pro・何もしない',
    short: 'Vercel Pro・何もしない',
    stackIndex: stackOf('vercel-supabase-pro'),
  },
  {
    id: 'vercel-pro-worker',
    label:
      'Vercel Pro・1 か月目の終わりに解析の worker（さくらの VPS 4GB）を足す',
    short: 'Vercel Pro・worker 4GB',
    stackIndex: stackOf('vercel-supabase-pro'),
    actions: placeAnalysis('worker-vps-4gb'),
  },
  {
    id: 'gcp',
    label: 'Google Cloud Run・何もしない',
    short: 'Cloud Run・何もしない',
    stackIndex: stackOf('gcp-cloud-run'),
  },
  {
    id: 'aws-amplify',
    label: 'AWS Amplify・何もしない',
    short: 'Amplify・何もしない',
    stackIndex: stackOf('aws-amplify'),
  },
];

export const KIFU_ANALYSIS: Scenario = {
  ...CONTRACT_OPERATIONS,
  id: 'kifu-analysis',
  name: '棋譜解析サービス',
  template: kifuAnalysis,
  routeTraits: KIFU_ANALYSIS_ROUTES,
  // 解析の置き場が端末・併用のときに配るエンジンと評価関数（ゲーム上の仮定。D-235）
  browserAnalysis: KIFU_BROWSER_ANALYSIS,
  // 解析の 1 件の形（区切り方・候補の数の設定が替える。ゲーム上の仮定。D-236）
  analysisJob: KIFU_ANALYSIS_JOB,
  // 満足度（D-238・prd/17 §5.5）: 解析の速さを重く（感度 高）、解析の正確さを軽く足す。ほかの境目は受託のまま（PR-11 で見直し、そのまま。D-242）
  satisfaction: {
    ...CONTRACT_OPERATIONS.satisfaction,
    weights: KIFU_SATISFACTION_WEIGHTS,
    analysis: KIFU_ANALYSIS_SATISFACTION,
  },
  // 棋譜と解析の結果がたまる（画像は保存しない）
  stock: { dbGBPerMillionPV: KIFU_DB_GB_PER_MILLION_PV, gbPerImage: 0 },
  // 12 万 PV ≒ 利用者 1,000 人（1 人 月 120 PV）。D-242 の 3 万 PV（1 人 30 PV）から、1 人の局数を月 90 局にしたのに合わせて
  // 1 人の PV を 120（一覧と各局を 1 回開く分）にし、利用者の数は保った（2026-11-24 のユーザーの決定: 現実の試算を優先）
  scale: { startPV: 120_000 },
  // 話題（大きな対局イベント）の後に残る伸び（ゲーム上の仮定。記事コミュニティより小さく置いた）
  buzz: { extra: 0.1, reference: 0.9 },
  revenue: {
    // 有料会員の月額を 1,000 PV あたりの従量に畳む（KF-03）。ゲーム上の仮定（利用者 1 人 月 $0.33。相場ではない）。D-242 で 1 人 月 30 PV・
    // $11 / 1,000 PV に置いた 1 人あたりの収益を保ち、1 人の PV を 120 にした分だけ単価を 1 / 4 にした（2026-11-24。収益の形は未決）
    adsUsdPer1000PV: 2.75,
    loss: CONTRACT_OPERATIONS.revenue.loss,
  },
  // 参照値（D-142。完走したときのヒントの出し分けにだけ使う）。D-64 の決め方で基準プレイ（シード 1〜50）から決め直した（2026-11-24。
  // 1 人 月 90 局にした規模）: 完走するのは VPS の 2 本だけで、CF Paid の 3 本・Vercel Pro の 2 本・Cloud Run・Amplify は 1 か月目に
  // 所持金が尽きる（同じ実行環境のサーバーレスの解析の費用。端末・worker へ移すのは 1 か月目の終わりなので間に合わない）。D-64 の「少なくとも 3 構成が全シードで届く」は満たせないので、残る道筋の
  // VPS + worker 4GB が自前の VPS の障害が無いシード（11 / 50）で全部届き（最小 $3,531）、VPS 2GB・何もしない（最大 $3,097）が
  // 届かない範囲 $3,098〜$3,531 の中ほどに置いた（D-242 の $4,300 から）
  goal: { cash: 3300, satisfaction: 0.75, maxOutageMonths: 2 },
  // 共有のページは解析が終わってから作るので、作り直しは無いとみなす
  pageUpdateShare: 0,
  // まれな出来事は無い
  rare: { perGame: 0, from: 1, to: 1 },
  events: KIFU_EVENTS,
  baselines: KIFU_BASELINES,
  frameworks: {
    allowed: ['nextjs', 'vite-spa', 'astro', 'nextjs-export'],
    default: 'nextjs',
    astro: { shape: KIFU_ANALYSIS_ASTRO, firstLoadLight: false },
    spa: {
      shape: KIFU_ANALYSIS_SPA,
      // 共有のページのカード（OGP）が出ないと、共有と大きな対局イベントの伸びが半分（記事コミュニティと同じ仮定。D-241）
      socialCardFactor: 0.5,
      firstLoadHeavy: false,
    },
  },
  preview: true,
  // 研究会の共同検討（出来事 6）は全構成で受けられる（Cloudflare 以外のリアルタイムの部品も選べる。D-240）
  realtimeAllPlatforms: true,
  hidden: {
    // 画像は配らない。共有のページ（全員に同じ中身・OGP）があるので、再検証の間隔・ISR のキャッシュ・SNS のカードは出す
    settings: [
      'format',
      'variants',
      'apiCacheTtl',
      'buildInterval',
      'pageCache',
    ],
    // リアルタイムは研究会の提案で付く部品なので、始める画面には出さない（D-240・D-241）
    slots: ['images', 'realtime', 'apiCache'],
    blockBots: true,
  },
  text: {
    intro:
      '一般向けの棋譜解析の Web サービスを運営しています。ログインした利用者が対局の棋譜を上げると、全局面を解析して、評価値の推移・悪手・候補を見せます。収益は有料会員の月額で、利用が増えるほど増えます（開発中のシナリオです）。',
    pages: [
      '棋譜のページ（PV の 65%）: 評価値のグラフ・悪手の印・候補と読み筋。ログインした利用者の個人のページです',
      '棋譜の一覧（PV の 30%）: 上げた棋譜と解析の状況・アップロード。個人のページです',
      '共有のページ（PV の 5%）: 解析の結果を SNS で共有するページです（全員に同じ中身・SNS のカード）',
    ],
    scale: `利用者 1 人が月に ${KIFU_PV_PER_MAU} PV・棋譜を ${KIFU_GAMES_PER_MAU} 局上げます。対局を終えた夜に集中します（ゲーム上の仮定）。`,
    growth: {
      up: '解析が速く正確だと、口コミで利用者が増えます',
      down: '満足度が低いと、利用者が減ります',
    },
    events: [
      {
        about: ['k-tournament'],
        text: '大きな対局イベントがあります（前の月に予告が出ます）。閲覧と解析の依頼がイベントの数日に集中します。',
      },
      {
        about: ['k-p-import', 'k-p-share-ogp', 'k-p-study'],
        text: '利用者から要望が来ます（過去の棋譜のまとめての取り込み・画像付きのカードでの共有・研究会での共同検討。受けるか断るかを選びます）。',
      },
      {
        about: ['k-p-strategy', 'k-p-problems'],
        text: 'ためた解析の結果を読み直す、裏の長い処理の案が来ます（戦法の分析・次の一手の問題の選び方）。VPS は空いている CPU で少しずつ、サーバーレスはその月に払って進めます。',
      },
    ],
    app: [
      `解析は既定では 1 局面ごとに 1 件の重い API として数えます（1 局 ${KIFU_MOVES_PER_GAME} 手。積んで別の所で解析する非同期の処理で、キューの費用は数えません）。1 件ごとにエンジンの起動と評価関数の読み込みの重さがかかり、区切り方の設定で 1 件の単位を替えられます`,
      '解析の結果は一手を 1 行で DB に書き、たまっていきます。画像は配りません（ゲーム上の仮定）',
      '解析はログインした利用者だけが頼めます（ログインせずに解析する経路はありません）。解析はページを開いている間に終わってほしいので、完了のメールは送りません',
    ],
    revenue:
      '収益は有料会員の月額を、1,000 PV あたり $2.75 に畳んだものです（ゲーム上の仮定で、相場ではありません）。止まった月は減ります。人件費は入れません。',
    wireframes: KIFU_WIREFRAMES,
  },
};
