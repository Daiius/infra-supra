// migration を順に当てたとき、前の migration の行が残って通るか（D-166・D-169・D-171・D-174）。
// 本番は最初の migration（20261108180633_results）を流した後に、次の migration を足して流す。前の形で保存した行があっても
// 止まらず、play_id・stack_id は埋まり、total_cost は null（分布に入れない）になることを PGlite で確かめる。
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { drizzleRepo } from './repo.ts';

const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);
const FIRST = '20261108180633_results';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('migration の順序', () => {
  it('最初の migration は残したまま、後ろに足している（既に流した SQL を書き換えない）', async () => {
    const names = (await readdir(migrationsFolder)).sort();
    expect(names[0]).toBe(FIRST);
    expect(names.length).toBeGreaterThan(1);
  });

  it('前の形の行があっても次の migration が通り、play_id・stack_id を埋め、total_cost は null で分布に入れない', async () => {
    const only = await mkdtemp(join(tmpdir(), 'stats-mig-'));
    dirs.push(only);
    await cp(join(migrationsFolder, FIRST), join(only, FIRST), {
      recursive: true,
    });
    const client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: only });
    await client.query(
      `insert into results (play_hash, scenario_id, seed, start_date, stack_index, framework, rewound,
         end_reason, end_month, outages, cash, satisfaction, feature_points, edge_months, save)
       values ('h-old', 'article-community', 42, '2026-11-01', 1, 'nextjs', false,
         'completed', 12, 0, 2000, 0.8, 50, 0, '{}'::jsonb)`,
    );
    await migrate(db, { migrationsFolder });
    const rows = await client.query<{
      play_id: string;
      stack_id: string;
      total_cost: number | null;
      flag: string | null;
    }>('select play_id, stack_id, total_cost, flag from results');
    expect(rows.rows).toEqual([
      {
        play_id: expect.stringMatching(/^legacy-\d+$/),
        stack_id: 'cloudflare-vinext-paid',
        total_cost: null,
        // 印の列（D-174）を足す前の行は印なし（分布に入る）
        flag: null,
      },
    ]);
    const repo = drizzleRepo(db);
    const q = { scenarioId: 'article-community' } as const;
    expect(await repo.histogramValues({ ...q, axis: 'cash' })).toEqual([2000]);
    expect(await repo.histogramValues({ ...q, axis: 'totalCost' })).toEqual([]);
    await client.close();
  });
});
