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
import { RESULT_FLAGS, type ResultFlag } from '../repo.ts';

const table = snakeCase.table;

export const results = table(
  'results',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /**
     * 端末ごとのプレイの id（D-169。web が新しいプレイを始めたときに作るランダムな UUID と、手元の履歴の id をつないだもの）。
     * 同じ端末の同じプレイの送り直しを 1 行にする。別の端末の同じ遊び方は別の行になる。
     */
    playId: text().notNull().unique(),
    /**
     * 再生した月ごとの結果と始めたときの選択の SHA-256（16 進。verify.ts の playHashOf）。分析用（同じ結果のプレイを束ねる）。
     * D-169 で一意をやめた（別の人の同じ遊び方が 1 行にまとまり、人気の遊び方が少なく数えられたため）。
     */
    playHash: text().notNull(),
    /** 受け付けた日時。シーズンの区切り（ST-12）を後で決めるときの手がかり。 */
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    scenarioId: text().notNull(),
    /** シード（クライアントが決めた 32 ビットの整数。API が整数だけを受ける。列は最初の migration のまま double precision）。 */
    seed: doublePrecision().notNull(),
    /** 始めた日（YYYY-MM-DD。改定の出来事に効く）。存在しない日付も保存は読めるので、date 型にせず text のまま持つ。 */
    startDate: text().notNull(),
    /** 構成の id（例 cloudflare-vinext-paid）。STACKS の並びの番号で持つと、並びを変えたときに過去の行の意味がずれる（D-171）。 */
    stackId: text().notNull(),
    framework: text().notNull(),
    /** 「この月に戻る」を使ったプレイ（D-148・ST-06）。ヒストグラムには入れない。 */
    rewound: boolean().notNull(),
    /** 終わり方（completed・cash・outages・policy）と終わった月。 */
    endReason: text().notNull(),
    endMonth: smallint().notNull(),
    /** 止まった月の数（軸ではない。振り返りの材料）。 */
    outages: smallint().notNull(),
    // 4 軸（D-132・D-166）。サーバーが再生して数えた値（クライアントの値と照合済み）
    cash: doublePrecision().notNull(),
    satisfaction: doublePrecision().notNull(),
    featurePoints: doublePrecision().notNull(),
    /**
     * ④ 費用の合計（プレイした月のインフラの費用の合計・ドル。D-166）。この列を足した migration より前の行（④ がギリギリを攻めるだった
     * 版のサーバーが保存した行）だけ null（保存の jsonb を再生し直せば数えられる）。新しい行は照合で必ず入れる。分布には null を入れない。
     */
    totalCost: doublePrecision(),
    /** 送られた保存（始めたときの選択と行動の列。前の試行は除く）。バランスの見直しで再生し直す元。 */
    save: jsonb().$type<SaveData>().notNull(),
    /**
     * 分布に入れない理由の印（D-174。repo.ts の RESULT_FLAGS）。null なら印なし。大量の送信を止めるために付け、行は消さない
     * （後で見直して null に戻せば分布に入る）。この列を足す前の行は null。
     */
    flag: text().$type<ResultFlag>(),
  },
  (t) => [
    check(
      'results_end_reason_check',
      sql`${t.endReason} in ('completed', 'cash', 'outages', 'policy')`,
    ),
    check(
      'results_flag_check',
      sql`${t.flag} is null or ${t.flag} in (${sql.raw(RESULT_FLAGS.map((f) => `'${f}'`).join(', '))})`,
    ),
    // ヒストグラムの絞り込み（シナリオ・完走・戻っていない・同じシード）
    index('results_histogram_idx').on(
      t.scenarioId,
      t.endReason,
      t.rewound,
      t.seed,
    ),
    // 同じ結果の数の上限（D-174）: 同じ play_hash の直近の行を数える
    index('results_dup_cap_idx').on(t.playHash, t.createdAt),
    // 同じ構成・同じフレームワークの分布の絞り込み（ST-11・D-175）
    index('results_stack_idx').on(t.scenarioId, t.stackId),
    index('results_framework_idx').on(t.scenarioId, t.framework),
  ],
);

export type ResultRow = typeof results.$inferInsert;
