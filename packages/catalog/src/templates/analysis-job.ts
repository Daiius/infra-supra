// 積んで別の所で動かす解析（Workload の api.invocation が async）の 1 件の形と、設定「解析の区切り方」「1 局面に残す候補の数」
// （prd/17 §5.2・§5.3・KF-05・KF-08・D-236）。テンプレートは「局面ごと・既定の候補の数」で作り、設定はこの関数で Workload を替える。
// 交換条件のもとになる仮定（supervisor の決定。D-236）: 1 件の解析ごとに、エンジンの起動と評価関数の読み込みの固定の重さ
// （CPU と壁時計）がかかる。値はどれもゲーム上の仮定で、テンプレート（kifu-analysis.ts）が名前つきの定数で持つ。
import type { WorkloadInput } from 'estimator';

/** 解析の区切り方（1 件の解析の単位）。 */
export const ANALYSIS_UNITS = ['position', 'game', 'resumable'] as const;
export type AnalysisUnit = (typeof ANALYSIS_UNITS)[number];

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
};

export type AnalysisSettings = { unit: AnalysisUnit; candidates: number };

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
 * - 書き込み: 局面ごとは 1 件に結果の 1 行。1 局まとめては 1 局の結果を 1 回で書く。小分けは塊ごとに結果と続きの位置（1 行）を書く。
 *   どれも棋譜のアップロード（1 局に 1 回・1 行）を件数に均して足す。
 * - 読み: 棋譜を読む 1 回（小分けは続きの位置も読むので 2 行）。
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
  | 'responseKB'
  | 'writesPerCall'
  | 'rowsWrittenPerWrite'
> {
  const jobs = jobsPerBatch(shape, s.unit);
  const items = itemsPerJob(shape, s.unit);
  const progressRows = s.unit === 'resumable' ? 1 : 0;
  // 1 件の書き込み: 結果を 1 回（行は局面の数 + 続きの位置）と、棋譜のアップロードを件数に均した分
  const upload = 1 / jobs;
  const writesPerCall = 1 + upload;
  const rows = items + progressRows + upload;
  return {
    cpuMs: shape.startupCpuMs + items * shape.itemCpuMs,
    ioWaitMs: shape.startupIoMs + shape.ioWaitMs,
    queries: 1,
    rowsReadPerQuery: 1 + progressRows,
    responseKB: items * s.candidates * shape.candidateKB,
    writesPerCall,
    rowsWrittenPerWrite: rows / writesPerCall,
  };
}

/** 1 局の在庫（KB）= 棋譜 + 手数 × 候補の数 × 1 候補。 */
export const analysisKBPerBatch = (
  shape: AnalysisJobShape,
  candidates: number,
): number =>
  shape.recordKB + shape.itemsPerBatch * candidates * shape.candidateKB;

/** 在庫（DB にたまる量）の倍率（テンプレートの既定の候補の数に対して）。 */
export const analysisStockFactor = (
  shape: AnalysisJobShape,
  candidates: number,
): number =>
  analysisKBPerBatch(shape, candidates) /
  analysisKBPerBatch(shape, shape.candidates);

/**
 * 設定をテンプレートの Workload に当てる（テンプレートは局面ごと・既定の候補の数で作る）。非同期の API が無ければそのまま返す。
 * 件数は 1 局あたりの件数の比で替え、DB の大きさ（見積の蓄積）は候補の数に比例する分を替える。
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
      r.apiCalls === undefined ? r : { ...r, apiCalls: scale(r.apiCalls)! },
    ),
    api: { ...w.api, ...analysisApiOf(shape, s) },
    db: {
      ...w.db,
      sizeGB: w.db.sizeGB * analysisStockFactor(shape, s.candidates),
    },
  };
}
