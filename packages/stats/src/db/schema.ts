// 集計の表（D-154・prd/15 §5・ST-08）。1 プレイ 1 行。照合（verify.ts）を通ったものだけを入れる。
// 🔒 名前・IP・端末の情報（User-Agent など）の列は持たない（D-134）。
// 列名は snake_case（seseraki と同じく snakeCase.table で定義する。pgTable を使わない）。
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  smallint,
  snakeCase,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SaveData } from 'game';

const table = snakeCase.table;

export const results = table(
  'results',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /**
     * 再生した月ごとの結果と始めたときの選択の SHA-256（16 進。verify.ts の playHashOf）。同じプレイの二重の送信を 1 行にする。
     * web の手元の履歴の id（FNV-1a・32 ビット）は衝突しうるうえ、結果を変えない書き換えで変わるので使わない（OCL-64BE2E4E）。
     */
    playHash: text().notNull().unique(),
    /** 受け付けた日時。シーズンの区切り（ST-12）を後で決めるときの手がかり。 */
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    scenarioId: text().notNull(),
    /** シード（クライアントが決めた 32 ビットの整数。API が整数だけを受ける。列は最初の migration のまま double precision）。 */
    seed: doublePrecision().notNull(),
    /** 始めた日（YYYY-MM-DD。改定の出来事に効く）。存在しない日付も保存は読めるので、date 型にせず text のまま持つ。 */
    startDate: text().notNull(),
    stackIndex: smallint().notNull(),
    framework: text().notNull(),
    /** 「この月に戻る」を使ったプレイ（D-148・ST-06）。ヒストグラムには入れない。 */
    rewound: boolean().notNull(),
    /** 終わり方（completed・cash・outages・policy）と終わった月。 */
    endReason: text().notNull(),
    endMonth: smallint().notNull(),
    /** 止まった月の数（軸ではない。振り返りの材料）。 */
    outages: smallint().notNull(),
    // 4 軸（D-132）。サーバーが再生して数えた値（クライアントの値と照合済み）
    cash: doublePrecision().notNull(),
    satisfaction: doublePrecision().notNull(),
    featurePoints: doublePrecision().notNull(),
    edgeMonths: smallint().notNull(),
    /** 送られた保存（始めたときの選択と行動の列。前の試行は除く）。バランスの見直しで再生し直す元。 */
    save: jsonb().$type<SaveData>().notNull(),
  },
  (t) => [
    check(
      'results_end_reason_check',
      sql`${t.endReason} in ('completed', 'cash', 'outages', 'policy')`,
    ),
    // ヒストグラムの絞り込み（シナリオ・完走・戻っていない・同じシード）
    index('results_histogram_idx').on(
      t.scenarioId,
      t.endReason,
      t.rewound,
      t.seed,
    ),
  ],
);

export type ResultRow = typeof results.$inferInsert;
