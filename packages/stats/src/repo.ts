// 保存の口（D-154）。API（route.ts）はこの形だけを知り、drizzle の層（db/repo.ts）とテスト用の手元の実装（memoryRepo）を差し替える。
import type { EndReason, ResultAxisId, SaveData } from 'game';
import { groupStatsOf, type GroupStat } from './histogram.ts';

/** 照合を通った 1 プレイ（表 results の 1 行。id と受け付けた日時は DB が付ける）。 */
export type ResultRecord = {
  /** 端末ごとのプレイの id（D-169）。二重の送信を 1 行にする鍵。 */
  playId: string;
  /** 結果の中身のハッシュ（分析用。一意ではない）。 */
  playHash: string;
  scenarioId: string;
  seed: number;
  startDate: string;
  /** 構成の id（STACKS の id。例 cloudflare-vinext-paid。並びの番号では持たない。D-171）。 */
  stackId: string;
  framework: string;
  rewound: boolean;
  endReason: EndReason;
  endMonth: number;
  outages: number;
  cash: number;
  satisfaction: number;
  featurePoints: number;
  totalCost: number;
  save: SaveData;
  /** 分布に入れない理由の印（D-174）。null なら印なし。後で見直して外せば分布に戻る。 */
  flag: ResultFlag | null;
};

/**
 * 分布に入れない理由（D-174。大量の送信を止める）。行は保存し、後で見直して除外・復帰できるようにする。
 * - no-token: 開始のトークンが本文に無い（開始の通信に失敗した正直なプレイとみなす。応答も正直に分布に入らないと返す）
 * - bad-token: トークンが置き場に無い（期限切れ・使い済み・作り物）
 * - too-fast: 発行から送信までが、遊んだ月の数 × 下限の秒数より短い
 * - dup-cap: 同じ結果（play_hash）が直近 1 時間に上限の件数だけ分布に入っている
 */
export const RESULT_FLAGS = [
  'no-token',
  'bad-token',
  'too-fast',
  'dup-cap',
] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

/** 分布の絞り込み。seed を指定すれば同じシードだけ（D-136）。 */
export type AxisQuery = {
  scenarioId: string;
  axis: ResultAxisId;
  seed?: number;
  /** 指定すれば同じ構成（stack_id）だけ（ST-11・D-175）。 */
  stackId?: string;
  /** 指定すれば同じフレームワークだけ（ST-11・D-175）。 */
  framework?: string;
};

/** 比較の図の分け方（構成ごと / フレームワークごと。ST-11・D-175）。 */
export const GROUP_BY = ['stack', 'framework'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

/** 構成（またはフレームワーク）ごとの要約の絞り込み。seed を指定すれば同じシードだけ。 */
export type GroupQuery = {
  scenarioId: string;
  axis: ResultAxisId;
  by: GroupBy;
  seed?: number;
};

/** 同じ結果の数の上限（D-174）。since より後に、同じ play_hash で分布に入った行が max 件以上あれば dup-cap の印を付ける。 */
export type DupCap = { since: Date; max: number };

export interface ResultsRepo {
  /**
   * 1 行足す。同じ playId がすでにあれば足さずに 'duplicate'。stored は保存されている行（duplicate なら前からある行）の印
   * （画面が自分を分布に数えるかの判断に使う。戻ったプレイの行が先にあれば入らない。OCL-9B705B16）。
   * dupCap を渡すと、印の無い完走の行は同じ結果の件数を数えてから足す（数えて足すまでを同じ play_hash の間で直列にする）。
   */
  insert(record: ResultRecord, dupCap?: DupCap): Promise<InsertResult>;
  /** ヒストグラムに入れる値（完走・戻っていない・印の無いプレイだけ。D-137・D-148・D-174）。並びは問わない。 */
  histogramValues(q: AxisQuery): Promise<number[]>;
  /**
   * 構成（またはフレームワーク）ごとの件数・25%・中央値・75%（分布と同じ条件の行だけ。鍵の順）。行の無い鍵は返さない。
   * DB の層は SQL の percentile_cont で集計する（行を読み出さない）。
   */
  groupStats(q: GroupQuery): Promise<GroupStat[]>;
}

/** 分布に入るかを決める行の欄。 */
export type HistogramMarks = Pick<
  ResultRecord,
  'endReason' | 'rewound' | 'flag'
>;

export type InsertResult = {
  status: 'inserted' | 'duplicate';
  stored: HistogramMarks;
};

/** 4 軸の id → 行の欄。 */
export const AXIS_FIELD = {
  cash: 'cash',
  satisfaction: 'satisfaction',
  featurePoints: 'featurePoints',
  totalCost: 'totalCost',
} as const satisfies Record<ResultAxisId, keyof ResultRecord>;

/** 印を除けば分布に入る行か（完走・戻っていない）。 */
export const histogramEligible = (r: { endReason: string; rewound: boolean }) =>
  r.endReason === 'completed' && !r.rewound;

/** ヒストグラムに入れる行か（完走・戻っていない・印なし）。DB の層も同じ条件で絞る。 */
export const inHistogram = (r: HistogramMarks) =>
  histogramEligible(r) && r.flag === null;

/**
 * 応答で返す inHistogram（D-174）。no-token は正直に返し、ほかの印（bad-token・too-fast・dup-cap）は印が無いときと同じ値を返して、
 * 弾いたことを悟らせない（大量の送信を作る側に、どの条件で弾かれたかを試させない）。
 */
export const reportedInHistogram = (r: HistogramMarks) =>
  r.flag === 'no-token' ? false : histogramEligible(r);

const marksOf = ({ endReason, rewound, flag }: HistogramMarks) => ({
  endReason,
  rewound,
  flag,
});

/** 手元の実装（テスト・DB を使わない確かめ用）。createdAt は now で付ける。 */
export function memoryRepo(
  now: () => number = Date.now,
): ResultsRepo & { rows: (ResultRecord & { createdAt?: Date })[] } {
  const rows: (ResultRecord & { createdAt?: Date })[] = [];
  return {
    rows,
    async insert(record, dupCap) {
      const found = rows.find((r) => r.playId === record.playId);
      if (found) return { status: 'duplicate', stored: marksOf(found) };
      let row = { ...record, createdAt: new Date(now()) };
      if (dupCap && inHistogram(row)) {
        const recent = rows.filter(
          (r) =>
            r.playHash === row.playHash &&
            inHistogram(r) &&
            (r.createdAt?.getTime() ?? 0) >= dupCap.since.getTime(),
        ).length;
        if (recent >= dupCap.max) row = { ...row, flag: 'dup-cap' };
      }
      rows.push(row);
      return { status: 'inserted', stored: marksOf(row) };
    },
    async histogramValues({ scenarioId, axis, seed, stackId, framework }) {
      return rows
        .filter(
          (r) =>
            r.scenarioId === scenarioId &&
            inHistogram(r) &&
            (seed === undefined || r.seed === seed) &&
            (stackId === undefined || r.stackId === stackId) &&
            (framework === undefined || r.framework === framework),
        )
        .map((r) => r[AXIS_FIELD[axis]]);
    },
    async groupStats({ scenarioId, axis, by, seed }) {
      return groupStatsOf(
        rows
          .filter(
            (r) =>
              r.scenarioId === scenarioId &&
              inHistogram(r) &&
              (seed === undefined || r.seed === seed),
          )
          .map((r) => ({
            key: by === 'stack' ? r.stackId : r.framework,
            value: r[AXIS_FIELD[axis]],
          })),
      );
    },
  };
}
