// シナリオ: 棋譜解析サービス（prd/17）。**PR-2 の仮の形**: 見積モードでテンプレートを選べるようにするためだけの最小の形で、
// ゲームの SCENARIOS には登録しない（遊べない。登録と出来事・文言・見取り図・基準プレイは PR-10・PR-11）。
// お金の流れ・満足度・手間などの遊びの値は受託（contract-operations）のものを仮に借りていて、見積モードでは使わない。
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
  kifuAnalysis,
} from 'catalog';
import type { PageWireframe, Scenario } from '../scenario.ts';
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
 * 解析の速さ・正確さの仮定（D-238・prd/17 §5.5。どれもゲーム上の仮定で、PR-11 の基準プレイで決め直す）。
 * - 良い: 1 局の解析が 5 分以内に見える（利用者がページを開いている間。P-4）。普通: 15 分以内（少し離れて戻れば見える）。
 * - 滞留: ピークの比が 1 を超えた分 × 30 分（ピークの 1 時間のうちに積み上がった分を、届いた解析が平均して待つ）。
 * - 端末: 1 局面の CPU × 0.5（軽い評価関数で 1 局面は軽いが、端末はサーバーより遅い）。遅い端末はその 3 倍。
 * - 正確さ: 候補 3 つ以上で良い（候補 1 つは普通）。端末の軽い評価関数は 1 段下げる。
 */
export const KIFU_ANALYSIS_SATISFACTION: NonNullable<
  Scenario['satisfaction']['analysis']
> = {
  speed: { goodSec: 300, fairSec: 900 },
  stallWindowSec: 1800,
  client: { cpuFactor: 0.5, slowDeviceFactor: 3 },
  accuracy: { goodCandidates: KIFU_CANDIDATES },
};

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
  // 満足度（D-238・prd/17 §5.5）: 解析の速さを重く（感度 高）、解析の正確さを軽く足す。ほかの境目は受託のまま（PR-11 で決め直す）
  satisfaction: {
    ...CONTRACT_OPERATIONS.satisfaction,
    weights: KIFU_SATISFACTION_WEIGHTS,
    analysis: KIFU_ANALYSIS_SATISFACTION,
  },
  // 棋譜と解析の結果がたまる（画像は保存しない）
  stock: { dbGBPerMillionPV: KIFU_DB_GB_PER_MILLION_PV, gbPerImage: 0 },
  scale: { startPV: 300_000 },
  // 共有のページは解析が終わってから作るので、作り直しは無いとみなす
  pageUpdateShare: 0,
  // 遊びの出来事・基準プレイは PR-10 で足す
  rare: { perGame: 0, from: 1, to: 1 },
  events: [],
  baselines: [],
  frameworks: {
    allowed: ['nextjs', 'vite-spa', 'astro', 'nextjs-export'],
    default: 'nextjs',
    astro: { shape: KIFU_ANALYSIS_ASTRO, firstLoadLight: false },
    spa: {
      shape: KIFU_ANALYSIS_SPA,
      socialCardFactor: 1,
      firstLoadHeavy: false,
    },
  },
  preview: true,
  hidden: {
    // 画像は配らない。共有のページ（全員に同じ中身・OGP）があるので、再検証の間隔・ISR のキャッシュ・SNS のカードは出す
    settings: [
      'format',
      'variants',
      'apiCacheTtl',
      'buildInterval',
      'pageCache',
    ],
    slots: ['images', 'realtime', 'apiCache'],
    blockBots: true,
  },
  text: {
    intro:
      '利用者が棋譜を上げ、サーバーが全局面を解析して、評価値の推移・悪手・候補を見せる Web サービスです（開発中のテンプレート）。',
    pages: [
      '棋譜のページ（PV の 65%）: 評価値のグラフ・悪手の印・候補と読み筋。ログインした利用者の個人のページです',
      '棋譜の一覧（PV の 30%）: 上げた棋譜と解析の状況・アップロード。個人のページです',
      '共有のページ（PV の 5%）: 解析の結果を SNS で共有するページです（全員に同じ中身・SNS のカード）',
    ],
    scale: `利用者 1 人が月に ${KIFU_PV_PER_MAU} PV・棋譜を ${KIFU_GAMES_PER_MAU} 局上げます（ゲーム上の仮定）。`,
    growth: {
      up: '解析が速く正確だと、口コミで利用者が増えます',
      down: '満足度が低いと、利用者が減ります',
    },
    events: [],
    app: [
      `解析は既定では 1 局面ごとに 1 件の重い API として数えます（1 局 ${KIFU_MOVES_PER_GAME} 手。積んで別の所で解析する非同期の処理で、キューの費用は数えません）。1 件ごとにエンジンの起動と評価関数の読み込みの重さがかかり、区切り方の設定で 1 件の単位を替えられます`,
      '解析の結果は一手を 1 行で DB に書き、たまっていきます。画像は配りません（ゲーム上の仮定）',
    ],
    wireframes: KIFU_WIREFRAMES,
  },
};
