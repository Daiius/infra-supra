// drizzle の層のテスト。実 Postgres の代わりに PGlite（wasm の Postgres）へ、本番と同じ migration（drizzle/*/migration.sql）を当てる。
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finishedSave, submissionOf } from '../plays.test-helpers.ts';
import type { ResultRecord, ResultsRepo } from '../repo.ts';
import { verifySubmission } from '../verify.ts';
import { drizzleRepo } from './repo.ts';

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

let client: PGlite;
let repo: ResultsRepo;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder });
  repo = drizzleRepo(db);
});
afterAll(async () => {
  await client.close();
});

const base = (() => {
  const v = verifySubmission(submissionOf(finishedSave()));
  if (!v.ok) throw new Error('照合に失敗');
  return v.record;
})();
const rec = (over: Partial<ResultRecord>): ResultRecord => ({
  ...base,
  ...over,
});

describe('drizzleRepo（PGlite）', () => {
  it('1 行足し、同じ playHash は duplicate で足さない。保存（jsonb）はそのまま読める', async () => {
    expect(await repo.insert(base)).toEqual({
      status: 'inserted',
      inHistogram: true,
    });
    // 同じ結果のプレイが後から戻らずに来ても、前からある行（戻った印つき）の印を返す（OCL-9B705B16）
    await repo.insert({ ...base, playHash: 'rw', rewound: true });
    expect(await repo.insert({ ...base, playHash: 'rw' })).toEqual({
      status: 'duplicate',
      inHistogram: false,
    });
    expect(await repo.insert(base)).toEqual({
      status: 'duplicate',
      inHistogram: true,
    });
    const rows = await client.query<{ n: number; save: unknown }>(
      'select count(*)::int as n, max(save::text)::jsonb as save from results',
    );
    expect(rows.rows[0]!.n).toBe(2);
    expect(rows.rows[0]!.save).toEqual(base.save);
  });

  it('🔒 表に IP・端末の情報の列が無い', async () => {
    const cols = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'results'",
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('play_hash');
    for (const n of names) expect(n).not.toMatch(/ip|agent|addr|name/i);
  });

  it('ヒストグラムの値は完走・戻っていない・同じシナリオ（・同じシード）だけ', async () => {
    await repo.insert(rec({ playHash: 'h1', seed: 1, cash: 100 }));
    await repo.insert(rec({ playHash: 'h2', seed: 2, cash: 200 }));
    await repo.insert(
      rec({ playHash: 'h3', seed: 1, cash: 900, endReason: 'outages' }),
    );
    await repo.insert(
      rec({ playHash: 'h4', seed: 1, cash: 900, rewound: true }),
    );
    const q = { scenarioId: 'article-community', axis: 'cash' } as const;
    const all = await repo.histogramValues(q);
    expect(all.sort((a, b) => a - b)).toEqual(
      [100, 200, base.cash].sort((a, b) => a - b),
    );
    expect(await repo.histogramValues({ ...q, seed: 1 })).toEqual([100]);
    expect(
      await repo.histogramValues({ ...q, scenarioId: 'contract-operations' }),
    ).toEqual([]);
    expect(
      await repo.histogramValues({ ...q, axis: 'edgeMonths', seed: 2 }),
    ).toEqual([base.edgeMonths]);
  });

  it('知らない終わり方は表の検査で入らない', async () => {
    await expect(
      repo.insert(rec({ playHash: 'x', endReason: 'won' as never })),
    ).rejects.toThrow();
  });
});
