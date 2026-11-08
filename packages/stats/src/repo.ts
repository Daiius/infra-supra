// 保存の口（D-154）。API（route.ts）はこの形だけを知り、drizzle の層（db/repo.ts）とテスト用の手元の実装（memoryRepo）を差し替える。
import type { EndReason, ResultAxisId, SaveData } from 'game';

/** 照合を通った 1 プレイ（表 results の 1 行。id と受け付けた日時は DB が付ける）。 */
export type ResultRecord = {
  playHash: string;
  scenarioId: string;
  seed: number;
  startDate: string;
  stackIndex: number;
  framework: string;
  rewound: boolean;
  endReason: EndReason;
  endMonth: number;
  outages: number;
  cash: number;
  satisfaction: number;
  featurePoints: number;
  edgeMonths: number;
  save: SaveData;
};

/** 分布の絞り込み。seed を指定すれば同じシードだけ（D-136）。 */
export type AxisQuery = {
  scenarioId: string;
  axis: ResultAxisId;
  seed?: number;
};

export interface ResultsRepo {
  /**
   * 1 行足す。同じ playHash がすでにあれば足さずに 'duplicate'。inHistogram は保存されている行（duplicate なら前からある行）が
   * ヒストグラムに入るか（画面が自分を分布に数えるかの判断に使う。戻ったプレイの行が先にあれば入らない。OCL-9B705B16）。
   */
  insert(record: ResultRecord): Promise<InsertResult>;
  /** ヒストグラムに入れる値（完走・戻っていないプレイだけ。D-137・D-148）。並びは問わない。 */
  histogramValues(q: AxisQuery): Promise<number[]>;
}

export type InsertResult = {
  status: 'inserted' | 'duplicate';
  inHistogram: boolean;
};

/** 4 軸の id → 行の欄。 */
export const AXIS_FIELD = {
  cash: 'cash',
  satisfaction: 'satisfaction',
  featurePoints: 'featurePoints',
  edgeMonths: 'edgeMonths',
} as const satisfies Record<ResultAxisId, keyof ResultRecord>;

/** ヒストグラムに入れる行か（完走・戻っていない）。DB の層も同じ条件で絞る。 */
export const inHistogram = (r: { endReason: string; rewound: boolean }) =>
  r.endReason === 'completed' && !r.rewound;

/** 手元の実装（テスト・DB を使わない確かめ用）。 */
export function memoryRepo(): ResultsRepo & { rows: ResultRecord[] } {
  const rows: ResultRecord[] = [];
  return {
    rows,
    async insert(record) {
      const found = rows.find((r) => r.playHash === record.playHash);
      if (found)
        return { status: 'duplicate', inHistogram: inHistogram(found) };
      rows.push(record);
      return { status: 'inserted', inHistogram: inHistogram(record) };
    },
    async histogramValues({ scenarioId, axis, seed }) {
      return rows
        .filter(
          (r) =>
            r.scenarioId === scenarioId &&
            inHistogram(r) &&
            (seed === undefined || r.seed === seed),
        )
        .map((r) => r[AXIS_FIELD[axis]]);
    },
  };
}
