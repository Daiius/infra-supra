// 積んで別の所で動かす解析（Workload の api.invocation が async）の 1 件の形と、設定「解析の区切り方」「1 局面に残す候補の数」
// （prd/17 §5.2・§5.3・KF-05・KF-08・D-236）。テンプレートは「局面ごと・既定の候補の数」で作り、設定はこの関数で Workload を替える。
// 交換条件のもとになる仮定（supervisor の決定。D-236）: 1 件の解析ごとに、エンジンの起動と評価関数の読み込みの固定の重さ
// （CPU と壁時計）がかかる。値はどれもゲーム上の仮定で、テンプレート（kifu-analysis.ts）が名前つきの定数で持つ。
import type { WorkloadInput } from 'estimator';

/** 解析の区切り方（1 件の解析の単位）。 */
export const ANALYSIS_UNITS = ['position', 'game', 'resumable'] as const;
export type AnalysisUnit = (typeof ANALYSIS_UNITS)[number];

/**
 * 解析の結果の保存の形（部品「保存の形」。prd/17 §5.4・KF-12・D-237）。per-move: 一手を 1 行（既定。1 行に候補の数ぶん）・
 * per-game: 1 局を 1 行（1 局の結果を 1 行に詰める）。棋譜そのものの行（アップロード）はどちらも別の 1 行。
 */
export const STORAGE_SHAPES = ['per-move', 'per-game'] as const;
export type StorageShape = (typeof STORAGE_SHAPES)[number];

/** 解析の 1 件の形（テンプレートの仮定）。1 局 = batch、1 局面 = item。 */
export type AnalysisJobShape = {
  /** 1 局の局面の数（手数）。 */
  itemsPerBatch: number;
  /** 1 局面を解析する CPU（ms）。 */
  itemCpuMs: number;
  /** 1 件ごとの固定の重さ: エンジンの起動・評価関数の読み込みの CPU（ms）。 */
  startupCpuMs: number;
  /** 1 件ごとの固定の重さ: 評価関数のファイルを読む待ち（ms。壁時計だけ）。 */
  startupIoMs: number;
  /** 1 件の DB の読み書きの待ち（ms。棋譜を読み、結果を書く）。 */
  ioWaitMs: number;
  /** 「1 局ずつ・小分けに保存」の 1 塊の局面の数（塊ごとに結果と続きの位置を保存し、切れたら続きの塊から再開する）。 */
  chunkItems: number;
  /** テンプレートの既定の候補の数（在庫・応答の大きさの基準）。 */
  candidates: number;
  /** 候補 1 つの大きさ（KB）。 */
  candidateKB: number;
  /** 1 局の棋譜そのものの大きさ（KB。候補の数によらない在庫）。 */
  recordKB: number;
  /**
   * 1 行ごとの保存のオーバーヘッド（KB。行の見出し・主キーと索引の分。在庫にだけ足す）。書き込みの単位の大きさには入れない
   * （DynamoDB の項目ごとの 100 B は保存の課金のためだけ。D-237）。
   */
  rowOverheadKB: number;
  /** 「小分けに保存」で一手を 1 行のときに別に書く、続きの位置の 1 行の大きさ（KB）。 */
  progressKB: number;
  /** 解析の結果を読むページ（ルートの id）。問い合わせの 1 つが結果を読む（一手を 1 行なら手数ぶんの行・1 局を 1 行なら 1 行）。 */
  resultRouteIds: readonly string[];
};

export type AnalysisSettings = {
  unit: AnalysisUnit;
  candidates: number;
  /** 保存の形（部品。省略は一手を 1 行。D-237）。 */
  storage?: StorageShape;
};

/** 1 局を何件で解析するか（局面ごと = 手数・1 局まとめて = 1・小分け = 塊の数）。 */
export function jobsPerBatch(shape: AnalysisJobShape, unit: AnalysisUnit) {
  switch (unit) {
    case 'position':
      return shape.itemsPerBatch;
    case 'game':
      return 1;
    case 'resumable':
      return shape.itemsPerBatch / shape.chunkItems;
  }
}

/** 1 件が解析する局面の数。 */
export const itemsPerJob = (shape: AnalysisJobShape, unit: AnalysisUnit) =>
  shape.itemsPerBatch / jobsPerBatch(shape, unit);

/**
 * 解析の 1 件の API（Workload の api のうち解析の分）。
 * - CPU = 固定の重さ + 局面の数 × 1 局面。壁時計 = それ + 評価関数を読む待ち + DB の待ち。
 * - 書き込み（一手を 1 行）: 局面ごとは 1 件に結果の 1 行。1 局まとめては 1 局の結果を 1 回で書く（手数ぶんの行）。
 *   小分けは塊ごとに結果と続きの位置（別の 1 行）を書く。
 * - 書き込み（1 局を 1 行。D-237）: どの区切り方も 1 件に 1 局の行を 1 行書く（局面ごと・小分けは、その局の行を書き足して
 *   上書きする）。上書きは行全体を書き直すので、1 行の大きさは件数を重ねた平均（1 局 × (件数 + 1) / (2 × 件数)）。
 *   小分けの続きの位置は 1 局の行の中に持つ（別の行を書かない）。
 * - どれも棋譜のアップロード（1 局に 1 回・1 行）を件数に均して足す。1 行の大きさ（rowKB）は書く行の平均。
 * - 読み: 棋譜を読む 1 回（小分けは続きの位置も読むので 2 行。1 局を 1 行ならその行）。
 * - 応答（解析する側が返す結果）= 局面の数 × 候補の数 × 1 候補。
 */
export function analysisApiOf(
  shape: AnalysisJobShape,
  s: AnalysisSettings,
): Pick<
  WorkloadInput['api'],
  | 'cpuMs'
  | 'ioWaitMs'
  | 'queries'
  | 'rowsReadPerQuery'
  | 'rowsReturnedPerQuery'
  | 'responseKB'
  | 'writesPerCall'
  | 'rowsWrittenPerWrite'
  | 'rowKB'
> {
  const jobs = jobsPerBatch(shape, s.unit);
  const items = itemsPerJob(shape, s.unit);
  const perGame = s.storage === 'per-game';
  const progressRows = s.unit === 'resumable' ? 1 : 0;
  const candidateKB = s.candidates * shape.candidateKB;
  // 1 件の書き込み: 結果を 1 回と、棋譜のアップロードを件数に均した分
  const upload = 1 / jobs;
  const writesPerCall = 1 + upload;
  // 結果の行（一手を 1 行: 局面の数 + 続きの位置。1 局を 1 行: 1 局の行を 1 行）と、その大きさの合計
  const resultRows = perGame ? 1 : items + progressRows;
  const resultKB = perGame
    ? (shape.itemsPerBatch * candidateKB * (jobs + 1)) / (2 * jobs)
    : items * candidateKB + progressRows * shape.progressKB;
  const rows = resultRows + upload;
  const readRows = 1 + progressRows;
  return {
    cpuMs: shape.startupCpuMs + items * shape.itemCpuMs,
    ioWaitMs: shape.startupIoMs + shape.ioWaitMs,
    queries: 1,
    rowsReadPerQuery: readRows,
    rowsReturnedPerQuery: readRows,
    responseKB: items * candidateKB,
    writesPerCall,
    rowsWrittenPerWrite: rows / writesPerCall,
    rowKB: (resultKB + upload * shape.recordKB) / rows,
  };
}

/** ページが結果を読む問い合わせの行の数（一手を 1 行なら手数・1 局を 1 行なら 1。D-237）。 */
export const resultRowsPerRead = (
  shape: AnalysisJobShape,
  storage: StorageShape = 'per-move',
): number => (storage === 'per-game' ? 1 : shape.itemsPerBatch);

/**
 * 1 局の在庫（KB）= 棋譜 + 手数 × 候補の数 × 1 候補 + 行ごとのオーバーヘッド（棋譜の行と、一手を 1 行なら手数ぶん・
 * 1 局を 1 行なら 1 行。D-237）。小分けの続きの位置は上書きする小さな行なので数えない。
 */
export const analysisKBPerBatch = (
  shape: AnalysisJobShape,
  candidates: number,
  storage: StorageShape = 'per-move',
): number =>
  shape.recordKB +
  shape.itemsPerBatch * candidates * shape.candidateKB +
  (1 + resultRowsPerRead(shape, storage)) * shape.rowOverheadKB;

/** 在庫（DB にたまる量）の倍率（テンプレートの既定の候補の数・一手を 1 行に対して）。 */
export const analysisStockFactor = (
  shape: AnalysisJobShape,
  candidates: number,
  storage: StorageShape = 'per-move',
): number =>
  analysisKBPerBatch(shape, candidates, storage) /
  analysisKBPerBatch(shape, shape.candidates);

/**
 * 結果を読むページの問い合わせ（棋譜の 1 行と結果の行）の、1 回あたりの読む行・返す行（D-237）。索引（主キー）で引くので、
 * 読む（走査する）行は返す行と同じとみなす（D1 の rows read は走査した行。索引が当たらない問い合わせは全表を走査する）。
 */
function withResultReads(
  r: WorkloadInput['routes'][number],
  shape: AnalysisJobShape,
  storage: StorageShape | undefined,
): WorkloadInput['routes'][number] {
  if (!shape.resultRouteIds.includes(r.id) || r.processing.queries <= 0)
    return r;
  const q = r.processing.queries;
  // 結果を読む 1 回と、ほかの問い合わせ（1 行ずつ）
  const perQuery = (resultRowsPerRead(shape, storage) + (q - 1)) / q;
  return {
    ...r,
    processing: {
      ...r.processing,
      rowsReadPerQuery: perQuery,
      rowsReturnedPerQuery: perQuery,
    },
  };
}

/**
 * 設定をテンプレートの Workload に当てる（テンプレートは局面ごと・既定の候補の数・一手を 1 行で作る）。非同期の API が無ければそのまま返す。
 * 件数は 1 局あたりの件数の比で替え、DB の大きさ（見積の蓄積）は候補の数と保存の形の分を替える。結果を読むページの読む行は保存の形で替える。
 */
export function applyAnalysisSettings(
  w: WorkloadInput,
  shape: AnalysisJobShape | undefined,
  s: AnalysisSettings,
): WorkloadInput {
  if (!shape || w.api.invocation !== 'async') return w;
  const perJob = jobsPerBatch(shape, s.unit) / shape.itemsPerBatch;
  const scale = (n: number | undefined) =>
    n === undefined ? undefined : n * perJob;
  return {
    ...w,
    perPage: { ...w.perPage, apiCalls: w.perPage.apiCalls * perJob },
    routes: w.routes.map((r) =>
      withResultReads(
        r.apiCalls === undefined ? r : { ...r, apiCalls: scale(r.apiCalls)! },
        shape,
        s.storage,
      ),
    ),
    api: { ...w.api, ...analysisApiOf(shape, s) },
    db: {
      ...w.db,
      sizeGB: w.db.sizeGB * analysisStockFactor(shape, s.candidates, s.storage),
    },
  };
}
