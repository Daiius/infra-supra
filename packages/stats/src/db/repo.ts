// 保存の口（repo.ts の ResultsRepo）の drizzle の実装。本番は node-postgres（connection.ts）、テストは PGlite（同じ migration を当てる）。
import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  AXIS_FIELD,
  inHistogram,
  type ResultRecord,
  type ResultsRepo,
} from '../repo.ts';
import { results } from './schema.ts';

/** node-postgres・PGlite のどちらの drizzle も受ける。 */
type AnyDb = PgAsyncDatabase<PgQueryResultHKT, any>;

/** 分布に入る行の条件（完走・戻っていない・印なし。repo.ts の inHistogram と同じ）。 */
const inHistogramWhere = and(
  eq(results.endReason, 'completed'),
  eq(results.rewound, false),
  isNull(results.flag),
);

export function drizzleRepo(db: AnyDb): ResultsRepo {
  return {
    async insert(record, dupCap) {
      return db.transaction(async (tx) => {
        let row: ResultRecord = record;
        if (dupCap && inHistogram(row)) {
          // 同じ結果の送信が並んで届いても上限を超えないよう、同じ play_hash の間で数えて足すまでを直列にする（D-174）
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${row.playHash}, 0))`,
          );
          const [recent] = await tx
            .select({ n: count() })
            .from(results)
            .where(
              and(
                eq(results.playHash, row.playHash),
                gte(results.createdAt, dupCap.since),
                inHistogramWhere,
              ),
            );
          if ((recent?.n ?? 0) >= dupCap.max) row = { ...row, flag: 'dup-cap' };
        }
        const inserted = await tx
          .insert(results)
          .values(row)
          .onConflictDoNothing({ target: results.playId })
          .returning({ id: results.id });
        if (inserted.length > 0)
          return {
            status: 'inserted' as const,
            stored: {
              endReason: row.endReason,
              rewound: row.rewound,
              flag: row.flag,
            },
          };
        // 前からある行の印で、ヒストグラムに入るかを返す（OCL-9B705B16）
        const [found] = await tx
          .select({
            endReason: results.endReason,
            rewound: results.rewound,
            flag: results.flag,
          })
          .from(results)
          .where(eq(results.playId, record.playId));
        // 一意の制約で足せなかったのに行が無いことは起きない（常駐のロールに DELETE は無い）
        if (!found) throw new Error('重複した play_id の行が見つかりません');
        return {
          status: 'duplicate' as const,
          stored: {
            ...found,
            endReason: found.endReason as ResultRecord['endReason'],
          },
        };
      });
    },
    async histogramValues({ scenarioId, axis, seed }) {
      const column = results[AXIS_FIELD[axis]];
      const rows = await db
        .select({ v: column })
        .from(results)
        .where(
          and(
            eq(results.scenarioId, scenarioId),
            inHistogramWhere,
            // ④ 費用の合計を足す前の行は null（分布に入れない。D-166）
            isNotNull(column),
            seed === undefined ? undefined : eq(results.seed, seed),
          ),
        );
      return rows.flatMap((r) => (r.v === null ? [] : [r.v]));
    },
  };
}
