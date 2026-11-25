// アプリのテンプレート: 棋譜解析サービス（prd/17・KF-14・PR-2）。値はすべてテンプレートの既定値（template-default）で、
// **ゲーム上の仮定**（出典なし。実測でも相場でもない）。フレームワークは決めない（prd/06・AGENTS.md: 見積対象を特定のスタックに寄せない）。
// 今のエンジンの語彙だけで作る最初の形（prd/17 §3.1）:
// - 解析は重い API（`api` の cpuMs と件数）。解析は非同期で、局面ごとに 1 件と数える（KF-04・KF-05 の既定「局面ごとに投げる」）。
//   キューの費用は数えない（P-2）。API のクラスは 1 つなので、このテンプレートの API は解析だけにし、閲覧の中身は SSR のページが DB から読む。
// - 解析の結果の保存は、API の書き込み（一手を 1 行。KF-12 の既定）と DB の在庫。
// - ページは棋譜のページ・棋譜の一覧（ログインした利用者の個人のページが主）と、共有のページ（全員に同じ中身・OGP。少なめ）。
// 後の段で、解析の置き場（PR-5）・区切り方と候補の数（PR-6）・保存の形（PR-7）がこの値を変える。その口になる値を名前の付いた定数にした。
// 区切り方と候補の数は analysis-job.ts の applyAnalysisSettings が、このテンプレート（局面ごと・既定の候補の数）から替える（D-236）。
// 大きさ（KB）は転送の大きさ（圧縮後。D-211・prd/04 §2.1）。
import type { WorkloadInput } from 'estimator';
import type { AstroShape, RouteTraits, SpaShape } from '../frameworks/index.ts';
import {
  analysisApiOf,
  analysisKBPerBatch,
  type AnalysisJobShape,
} from './analysis-job.ts';

/** 1 局の手数（解析する局面の数。ゲーム上の仮定）。区切り方（PR-6）が 1 件の重さ・件数をこれで変える。 */
export const KIFU_MOVES_PER_GAME = 100;
/** 1 局面に残す候補の数の既定（ゲーム上の仮定。設定の選択肢は PR-6。利用者の端末の解析は 1 つまで。KF-08）。 */
export const KIFU_CANDIDATES = 3;
/** 解析の結果の候補 1 つの大きさ（KB。評価値・深さ・読み筋の手の列。ゲーム上の仮定）。保存の形（PR-7）が行の大きさをこれで変える。 */
export const KIFU_CANDIDATE_KB = 0.15;
/**
 * 1 局面を解析する CPU（ms。思考時間を固定した 1 局面ぶん。解析の深さは選ばせない。KF-09。ゲーム上の仮定）。
 * 区切り方の「1 局まとめて」（手数 × これ ≒ 400 秒）が、短い上限（Vercel Hobby の 300 秒・Workers Paid の CPU 5 分）に当たり、
 * 長い上限（Vercel Pro の 800 秒・15 分・30 分）に当たらない並びに仮に置いた（D-236。PR-11 で決め直す）。
 */
export const KIFU_POSITION_CPU_MS = 4_000;
/**
 * 解析の 1 件ごとの固定の重さ: エンジンの起動と評価関数の読み込みの CPU（ms）と、評価関数のファイルを読む待ち（ms）。
 * 交換条件（区切り方）のもとになる仮定（supervisor の決定。D-236）。**ゲーム上の仮定**で、実在のエンジンの値ではない。
 */
export const KIFU_ENGINE_STARTUP_CPU_MS = 1_000;
export const KIFU_ENGINE_STARTUP_IO_MS = 1_000;
/** 解析の 1 件の DB の読み書きの待ち（ms。棋譜を読み、結果を書く。ゲーム上の仮定）。 */
export const KIFU_ANALYSIS_IO_MS = 20;
/** 「1 局ずつ・小分けに保存」の 1 塊の局面の数（塊ごとに結果と続きの位置を保存する。ゲーム上の仮定。D-236）。 */
export const KIFU_RESUME_CHUNK_MOVES = 10;
/** 棋譜そのものの大きさ（KB。手の列の文字列。ゲーム上の仮定）。 */
export const KIFU_RECORD_KB = 2;
/**
 * 1 行ごとの保存のオーバーヘッド（KB。行の見出し・主キーと索引の分。**ゲーム上の仮定**。DynamoDB は項目ごとに 100 B を保存の課金に
 * 足すと書いている（dynamodbItemSize）ので、その大きさに揃えた。D-237）。保存の形（PR-7）で一手を 1 行は手数ぶん、1 局を 1 行は 1 行ぶん。
 */
export const KIFU_ROW_OVERHEAD_KB = 0.1;
/** 「小分けに保存」で一手を 1 行のときに書く続きの位置の 1 行の大きさ（KB。ゲーム上の仮定。D-237）。 */
export const KIFU_PROGRESS_KB = 0.05;
/** 利用者 1 人が月に上げて解析する棋譜の数（ゲーム上の仮定。1 日 3 局。分布は仮定せず平均として決め打ち・上限なし。2026-11-24 のユーザーの決定）。 */
export const KIFU_GAMES_PER_MAU = 90;
/** 利用者 1 人の月の PV（棋譜の一覧と、上げた棋譜を 1 回ずつ開く分。ゲーム上の仮定。局数を月 90 局にしたのに合わせた。2026-11-24）。 */
export const KIFU_PV_PER_MAU = 120;
/** 共有のページ（OGP）が PV に占める割合（少なめ。ゲーム上の仮定）。 */
export const KIFU_SHARE_ROUTE_SHARE = 0.05;
/** 見積の DB の大きさに数える蓄積の月数（始めてからの解析の結果がたまった分。ゲーム上の仮定）。 */
export const KIFU_STOCK_MONTHS = 3;

/**
 * 端末で解析するとき（解析の置き場の端末・併用。prd/17 §5.1・D-235）にブラウザへ配る、エンジン（WebAssembly）と軽い評価関数の
 * 転送の大きさ（KB・圧縮後）。**ゲーム上の仮定**で、実在のエンジン・評価関数の大きさではない（B-3）。
 */
export const KIFU_BROWSER_ENGINE_KB = 10_000;
/** 訪問 1 回あたりにエンジンを読む割合（棋譜のページを開く訪問。ゲーム上の仮定）。 */
export const KIFU_BROWSER_ENGINE_PER_VISIT = 0.8;
/** エンジンをブラウザのキャッシュから出す割合（訪問をまたいで残る。ゲーム上の仮定）。 */
export const KIFU_BROWSER_ENGINE_REUSE = 0.8;
/** 端末で解析するときに配るファイル（catalog の BrowserAnalysisShape。シナリオが applyComponentsToWorkload に渡す）。 */
export const KIFU_BROWSER_ANALYSIS = {
  engineKB: KIFU_BROWSER_ENGINE_KB,
  perVisit: KIFU_BROWSER_ENGINE_PER_VISIT,
  browserReuse: KIFU_BROWSER_ENGINE_REUSE,
} as const;

/**
 * 詳細解析の範囲が「希望した棋譜だけ」のとき、サーバーの詳細解析を頼まれる局の割合（併用の置き場だけ。D-246）。**ゲーム上の仮定**:
 * 負けた局を中心に頼む想定。分布は考えない。
 */
export const KIFU_REQUESTED_SHARE = 0.5;

/** 解析の 1 件の形（区切り方・候補の数の設定が替える。analysis-job.ts・D-236）。 */
export const KIFU_ANALYSIS_JOB: AnalysisJobShape = {
  itemsPerBatch: KIFU_MOVES_PER_GAME,
  itemCpuMs: KIFU_POSITION_CPU_MS,
  startupCpuMs: KIFU_ENGINE_STARTUP_CPU_MS,
  startupIoMs: KIFU_ENGINE_STARTUP_IO_MS,
  ioWaitMs: KIFU_ANALYSIS_IO_MS,
  chunkItems: KIFU_RESUME_CHUNK_MOVES,
  candidates: KIFU_CANDIDATES,
  candidateKB: KIFU_CANDIDATE_KB,
  recordKB: KIFU_RECORD_KB,
  rowOverheadKB: KIFU_ROW_OVERHEAD_KB,
  progressKB: KIFU_PROGRESS_KB,
  requestedShare: KIFU_REQUESTED_SHARE,
  // 棋譜のページと共有のページが結果を読む（保存の形で読む行が替わる。D-237）
  resultRouteIds: ['kifu', 'share'],
};

/** 1 局の解析の結果の大きさ（KB）= 手数 × 候補の数 × 1 候補の大きさ（prd/17 §5.3）。 */
export const kifuResultKB = (
  candidates: number = KIFU_CANDIDATES,
  candidateKB: number = KIFU_CANDIDATE_KB,
  moves: number = KIFU_MOVES_PER_GAME,
): number => moves * candidates * candidateKB;

/** 1 局で増える DB の量（KB）= 棋譜 + 解析の結果 + 行ごとのオーバーヘッド（一手を 1 行。D-237）。 */
export const KIFU_KB_PER_GAME = analysisKBPerBatch(
  KIFU_ANALYSIS_JOB,
  KIFU_CANDIDATES,
);

/** 人の PV 100 万あたり・月に増える DB の量（GB）。シナリオの在庫の増え方（StockRule）に使う口。 */
export const KIFU_DB_GB_PER_MILLION_PV =
  ((1_000_000 / KIFU_PV_PER_MAU) * KIFU_GAMES_PER_MAU * KIFU_KB_PER_GAME) /
  1_000_000;

/** 棋譜解析のページの性質（D-107・RS-17）。 */
export const KIFU_ANALYSIS_ROUTES: Readonly<Record<string, RouteTraits>> = {
  kifu: {
    audience: 'personal',
    needsOgp: false,
    freshness: '解析が進んだ分がすぐ見えます',
    parts: ['評価値のグラフ', '悪手の印', '候補と読み筋'],
  },
  list: {
    audience: 'personal',
    needsOgp: false,
    freshness: '上げた棋譜と解析の状況がすぐ一覧に出ます',
    parts: ['棋譜の一覧', '棋譜のアップロード'],
  },
  share: {
    audience: 'public',
    needsOgp: true,
    freshness: '解析が終わった棋譜を共有するので、共有の後の変更はまれです',
    parts: ['評価値のグラフ'],
  },
};

/**
 * 研究会の共同検討（prd/17 §6 の出来事 6・D-240）のリアルタイムの形。Workload の realtime に入れる。**ゲーム上の仮定**（出典なし）:
 * 利用者の 5% が月 4 回の研究会に参加し、1 回 90 分つなぐ。1 回に盤面の手と書き込みを 60 件送り、同じ盤面を見る 6 人のうち
 * 自分以外の 5 人に配る（ファンアウト 5）。1 件 0.5 KB・処理 2 ms、つなぐと棋譜と検討の手 100 行を読む。研究会は夜に集まるので、
 * 同時接続のピークは月の平均の 8 倍。駒を動かすたびの解析は数えない（prd/17 §6.1）。
 */
export const KIFU_STUDY_REALTIME = {
  usersPerMau: 0.05,
  connectionsPerUser: 4,
  minutesPerConnection: 90,
  messagesPerUser: 4 * 60,
  processingMs: 2,
  historyRowsPerConnect: 100,
  fanout: 5,
  messageKB: 0.5,
  peakFactor: 8,
} as const satisfies NonNullable<WorkloadInput['realtime']>;

/**
 * 棋譜解析の 1 日の時間帯の形（0 時〜23 時の重み。D-89）。ゲーム上の仮定（出典なし）: 対局を終えた夜（20〜22 時）に最も多く、
 * 昼休みに小さな山、深夜 3〜5 時は少ない。休日のほうが多い（weekdayToWeekend 0.8）。
 */
export const KIFU_HOURLY_PROFILE: readonly number[] = [
  2, 1, 0.5, 0.3, 0.2, 0.3, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3, 3, 3, 3.5, 4, 5,
  6.5, 8, 8.5, 7, 4,
];

/**
 * 応答の転送の大きさ（KB・圧縮後。D-211。**ゲーム上の仮定**）。棋譜のページは評価値のグラフと候補・読み筋の分だけ業務の画面より大きい。
 * 解析の API の応答は、解析する側が返す結果（候補の数 × 1 候補）で、利用者のブラウザには届かない内部の応答とみなす。
 */
export const KIFU_TRANSFER_KB = {
  kifuHtml: 10,
  listHtml: 5,
  analysis: KIFU_CANDIDATES * KIFU_CANDIDATE_KB,
  spaShell: 2,
  spaData: 4,
} as const;

/**
 * 棋譜解析サービス: ログインした利用者が棋譜を上げ、サーバーが全局面を解析して、評価値の推移・悪手・候補を見る。
 * - 解析は API の 1 件 = 1 局面（KIFU_POSITION_CPU_MS）。件数は 利用者 × 月の棋譜の数 × 手数。共有のページの閲覧は解析を起こさない。
 * - 書き込みは解析 1 件ごとに結果の 1 行（一手を 1 行）と、棋譜 1 局に 1 回（解析の件数に均して足す）。
 * - DB の大きさは、始めてから KIFU_STOCK_MONTHS か月分の棋譜と解析の結果（PV に比例）。
 * - 画像は配らない。メールは送らない（完了のメールは入れない。prd/17 §6.2）。
 * @param monthlyPageViews 月間 PV（MAU からの導出を上書きする）
 */
export function kifuAnalysis(monthlyPageViews: number): WorkloadInput {
  const mau = monthlyPageViews / KIFU_PV_PER_MAU;
  const gamesPerMonth = mau * KIFU_GAMES_PER_MAU;
  const analysesPerMonth = gamesPerMonth * KIFU_MOVES_PER_GAME;
  // 解析の件数は個人のページの閲覧に割り付ける（共有のページの apiCalls は 0）
  const personalPV = monthlyPageViews * (1 - KIFU_SHARE_ROUTE_SHARE);
  const analysesPerPersonalPV =
    personalPV > 0 ? analysesPerMonth / personalPV : 0;
  return {
    commercial: true,
    traffic: {
      mau,
      dauPerMau: 0.25,
      sessionsPerDau: 1,
      pagesPerSession: 4,
      weekdayToWeekend: 0.8,
      peakHourFactor: 3,
      hourlyProfile: [...KIFU_HOURLY_PROFILE],
      monthlyPageViewsOverride: monthlyPageViews,
    },
    routes: [
      {
        id: 'kifu',
        label: '棋譜のページ',
        rendering: 'ssr',
        share: 0.65,
        pages: 1,
        processing: {
          cpuMs: 15,
          ioWaitMs: 60,
          // 棋譜と解析の結果（一手を 1 行なら手数ぶんの行）の 2 回。主キーで引くので、読む行は返す行と同じ（D-237）
          queries: 2,
          rowsReadPerQuery: (1 + KIFU_MOVES_PER_GAME) / 2,
          rowsReturnedPerQuery: (1 + KIFU_MOVES_PER_GAME) / 2,
          responseKB: KIFU_TRANSFER_KB.kifuHtml,
        },
      },
      {
        id: 'list',
        label: '棋譜の一覧',
        rendering: 'ssr',
        share: 1 - 0.65 - KIFU_SHARE_ROUTE_SHARE,
        pages: 1,
        processing: {
          cpuMs: 10,
          ioWaitMs: 40,
          queries: 1,
          rowsReadPerQuery: 20,
          rowsReturnedPerQuery: 20,
          responseKB: KIFU_TRANSFER_KB.listHtml,
        },
      },
      {
        id: 'share',
        label: '共有のページ',
        rendering: 'isr',
        share: KIFU_SHARE_ROUTE_SHARE,
        // 共有された棋譜の数（ゲーム上の仮定）。解析が終わってから共有するので、作り直しはまれ（1 日の期限で取り直す）
        pages: 2_000,
        revalidateSeconds: 86_400,
        processing: {
          cpuMs: 15,
          ioWaitMs: 60,
          queries: 2,
          rowsReadPerQuery: (1 + KIFU_MOVES_PER_GAME) / 2,
          rowsReturnedPerQuery: (1 + KIFU_MOVES_PER_GAME) / 2,
          responseKB: KIFU_TRANSFER_KB.kifuHtml,
        },
        cachedServeCpuMs: 2,
        // 共有のページを見る人は解析を起こさない
        apiCalls: 0,
        zipfExponent: 1,
      },
    ],
    perPage: { apiCalls: analysesPerPersonalPV, assets: 8, images: 0 },
    // 解析 1 件 = 1 局面（区切り方の既定）。棋譜を読み（1 回・1 行）、結果の 1 行と、棋譜のアップロード（1 局に 1 回）を件数に均して書く。
    // 1 件ごとにエンジンの起動と評価関数の読み込みの固定の重さがかかる（D-236）。受け付けて積み、受けて処理する側が動かす（P-2）ので、
    // 1 件の実行時間は受けて処理する側（キューの受け手・Cron・バックグラウンド関数）の上限で判定する（B-6・D-234）
    api: {
      invocation: 'async',
      ...analysisApiOf(KIFU_ANALYSIS_JOB, {
        unit: 'position',
        candidates: KIFU_CANDIDATES,
      }),
    },
    assets: { sizeKB: 40, browserReuse: 0.9 },
    // 画像は配らない・保存しない
    images: {
      sizeKB: 0,
      browserReuse: 0,
      distinct: 0,
      variants: 1,
      storedGB: 0,
      uploadsPerMau: 0,
      transformAt: 'none',
    },
    db: {
      sizeGB:
        (gamesPerMonth * KIFU_KB_PER_GAME * KIFU_STOCK_MONTHS) / 1_000_000,
      responseKBPerQuery: 5,
    },
  };
}

/**
 * 棋譜解析を Vite の SPA で作ったときの形（prd/10。template-default・実測ではない）。ページの中身を返す API は HTML を描かない分
 * SSR の半分の CPU・応答 4 KB（評価値と候補の JSON。圧縮後）と仮定。
 */
export const KIFU_ANALYSIS_SPA: SpaShape = {
  shellKB: KIFU_TRANSFER_KB.spaShell,
  dataCpuFactor: 0.5,
  dataResponseKB: KIFU_TRANSFER_KB.spaData,
};

/**
 * 棋譜解析を Astro で作ったときの形（D-68。template-default・実測ではない）。評価値のグラフ・盤など動きのある部品が画面の大半なので、
 * JS・CSS は Next.js と同じとみなす（assetsFactor 1）。共有のページは閲覧のときに描いてキャッシュする（ビルドし直しは無い）。
 */
export const KIFU_ANALYSIS_ASTRO: AstroShape = {
  assetsFactor: 1,
  minutesPerBuild: { base: 1, perThousandPages: 0.5 },
};
