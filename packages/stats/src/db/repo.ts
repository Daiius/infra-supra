// 保存の口（repo.ts の ResultsRepo）の drizzle の実装。本番は node-postgres（connection.ts）、テストは PGlite（同じ migration を当てる）。
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { AXIS_FIELD, inHistogram, type ResultsRepo } from '../repo.ts';
import { results } from './schema.ts';

/** node-postgres・PGlite のどちらの drizzle も受ける。 */
type AnyDb = PgAsyncDatabase<PgQueryResultHKT, any>;

export function drizzleRepo(db: AnyDb): ResultsRepo {
  return {
    async insert(record) {
      const inserted = await db
        .insert(results)
        .values(record)
        .onConflictDoNothing({ target: results.playId })
        .returning({ id: results.id });
      if (inserted.length > 0)
        return { status: 'inserted', inHistogram: inHistogram(record) };
      // 前からある行の印で、ヒストグラムに入るかを返す（OCL-9B705B16）
      const [found] = await db
        .select({ endReason: results.endReason, rewound: results.rewound })
        .from(results)
        .where(eq(results.playId, record.playId));
      return {
        status: 'duplicate',
        inHistogram: found ? inHistogram(found) : false,
      };
    },
    async histogramValues({ scenarioId, axis, seed }) {
      const column = results[AXIS_FIELD[axis]];
      const rows = await db
        .select({ v: column })
        .from(results)
        .where(
          and(
            eq(results.scenarioId, scenarioId),
            eq(results.endReason, 'completed'),
            eq(results.rewound, false),
            // ④ 費用の合計を足す前の行は null（分布に入れない。D-166）
            isNotNull(column),
            seed === undefined ? undefined : eq(results.seed, seed),
          ),
        );
      return rows.flatMap((r) => (r.v === null ? [] : [r.v]));
    },
  };
}
