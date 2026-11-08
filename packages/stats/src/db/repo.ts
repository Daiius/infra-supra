// 保存の口（repo.ts の ResultsRepo）の drizzle の実装。本番は node-postgres（connection.ts）、テストは PGlite（同じ migration を当てる）。
import { and, eq } from 'drizzle-orm';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { AXIS_FIELD, type ResultsRepo } from '../repo.ts';
import { results } from './schema.ts';

/** node-postgres・PGlite のどちらの drizzle も受ける。 */
type AnyDb = PgAsyncDatabase<PgQueryResultHKT, any>;

export function drizzleRepo(db: AnyDb): ResultsRepo {
  return {
    async insert(record) {
      const inserted = await db
        .insert(results)
        .values(record)
        .onConflictDoNothing({ target: results.playHash })
        .returning({ id: results.id });
      return inserted.length > 0 ? 'inserted' : 'duplicate';
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
            seed === undefined ? undefined : eq(results.seed, seed),
          ),
        );
      return rows.map((r) => r.v);
    },
  };
}
