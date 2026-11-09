// 保存の口（repo.ts の ResultsRepo）の drizzle の実装。本番は node-postgres（connection.ts）、テストは PGlite（同じ migration を当てる）。
import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  AXIS_FIELD,
  inHistogram,
  type ResultRecord,
  type ResultsRepo,
} from '../repo.ts';
import { binEdgesOf, binWidthOf, GROUP_BINS } from '../histogram.ts';
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
    async groupStats({ scenarioId, axis, by, seed }) {
      const column = results[AXIS_FIELD[axis]];
      const key = by === 'stack' ? results.stackId : results.framework;
      const where = and(
        eq(results.scenarioId, scenarioId),
        inHistogramWhere,
        isNotNull(column),
        seed === undefined ? undefined : eq(results.seed, seed),
      );
      // 範囲・分位・棒の 3 つの問い合わせを、同じスナップショット（repeatable read の読むだけのトランザクション）で行う。
      // 間に送信が足されても同じ母集団で数え、件数と棒の合計が食い違わない・最小より小さい値で棒の番号が負にならない（OCL-7F31023B）
      return db.transaction(
        async (tx) => {
          // 共通の区切りは、その軸のその条件での全体の最小・最大から決める（D-175）
          const [range] = await tx
            .select({
              min: sql<number | null>`min(${column})`,
              max: sql<number | null>`max(${column})`,
            })
            .from(results)
            .where(where);
          if (range?.min == null || range.max == null)
            return { binEdges: [], groups: [] };
          const min = Number(range.min);
          const max = Number(range.max);
          const width = binWidthOf(min, max);
          // 分位と棒の件数は SQL で集計する（行を読み出さない）。percentile_cont は double precision で、node-postgres・PGlite とも
          // number で返る。棒の番号は histogram.ts の binIndexOf と同じ式（width_bucket は計算の順が違い、境目で 1 本ずれうる）
          // 同じトランザクションの中では 1 つの接続で順に流す（並べない）
          const stats = await tx
            .select({
              key,
              count: sql<number>`count(*)::int`,
              p25: sql<number>`percentile_cont(0.25) within group (order by ${column})`,
              median: sql<number>`percentile_cont(0.5) within group (order by ${column})`,
              p75: sql<number>`percentile_cont(0.75) within group (order by ${column})`,
            })
            .from(results)
            .where(where)
            .groupBy(key);
          const counts = await (() => {
            const bin =
              width > 0
                ? sql<number>`least(${sql.raw(String(GROUP_BINS - 1))}, floor((${column} - ${min}::float8) / ${width}::float8))::int`
                : sql<number>`0`;
            return (
              tx
                .select({ key, bin, n: sql<number>`count(*)::int` })
                .from(results)
                .where(where)
                // 式を 2 度書くと引数が別の番号になり、同じ式とみなされないので、列の番号で束ねる
                .groupBy(sql`1, 2`)
            );
          })();
          const groups = stats
            .map((r) => {
              const bins = Array<number>(GROUP_BINS).fill(0);
              for (const c of counts)
                if (c.key === r.key) bins[Number(c.bin)] = Number(c.n);
              return {
                key: r.key,
                count: Number(r.count),
                p25: Number(r.p25),
                median: Number(r.median),
                p75: Number(r.p75),
                bins,
              };
            })
            // 鍵の順は手元の実装と同じ（コードの単位の順。DB の照合順序に依らない）
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
          return { binEdges: binEdgesOf(min, max), groups };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async histogramValues({ scenarioId, axis, seed, stackId, framework }) {
      // 軸ごとに条件に合う行の値を全部読む（distribution は 1 回で 8 本 = 8 回読む）。行が増えて重くなったら SQL でビンに分ける
      // （width_bucket など。D-161 の残した点）
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
            stackId === undefined ? undefined : eq(results.stackId, stackId),
            framework === undefined
              ? undefined
              : eq(results.framework, framework),
          ),
        );
      return rows.flatMap((r) => (r.v === null ? [] : [r.v]));
    },
  };
}
