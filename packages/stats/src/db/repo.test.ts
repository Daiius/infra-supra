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
  it('1 行足し、同じ playId は duplicate で足さない。保存（jsonb）はそのまま読める（D-169）', async () => {
    const marks = { endReason: 'completed', rewound: false, flag: null };
    expect(await repo.insert(base)).toEqual({
      status: 'inserted',
      stored: marks,
    });
    // 同じ結果のプレイが後から戻らずに来ても、前からある行（戻った印つき）の印を返す（OCL-9B705B16）
    await repo.insert({ ...base, playId: 'rw', rewound: true });
    expect(await repo.insert({ ...base, playId: 'rw' })).toEqual({
      status: 'duplicate',
      stored: { ...marks, rewound: true },
    });
    expect(await repo.insert(base)).toEqual({
      status: 'duplicate',
      stored: marks,
    });
    const rows = await client.query<{ n: number; save: unknown }>(
      'select count(*)::int as n, max(save::text)::jsonb as save from results',
    );
    expect(rows.rows[0]!.n).toBe(2);
    expect(rows.rows[0]!.save).toEqual(base.save);
  });

  it('同じ playHash（同じ結果）でも playId が違えば別の行（別の端末の同じ遊び方。D-169）', async () => {
    await repo.insert({ ...base, playId: 'other-device' });
    const rows = await client.query<{ n: number }>(
      'select count(*)::int as n from results where play_hash = $1',
      [base.playHash],
    );
    expect(rows.rows[0]!.n).toBe(3);
    await client.query("delete from results where play_id = 'other-device'");
  });

  it('🔒 表に IP・端末の情報の列が無い', async () => {
    const cols = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'results'",
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('play_hash');
    expect(names).toContain('play_id');
    for (const n of names) expect(n).not.toMatch(/ip|agent|addr|name/i);
  });

  it('ヒストグラムの値は完走・戻っていない・同じシナリオ（・同じシード）だけ', async () => {
    await repo.insert(rec({ playId: 'h1', seed: 1, cash: 100 }));
    await repo.insert(rec({ playId: 'h2', seed: 2, cash: 200 }));
    await repo.insert(
      rec({ playId: 'h3', seed: 1, cash: 900, endReason: 'outages' }),
    );
    await repo.insert(rec({ playId: 'h4', seed: 1, cash: 900, rewound: true }));
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
      await repo.histogramValues({ ...q, axis: 'totalCost', seed: 2 }),
    ).toEqual([base.totalCost]);
  });

  it('印（flag）の付いた行は保存するが分布に入れない（D-174）', async () => {
    await repo.insert(rec({ playId: 'f1', seed: 3, cash: 300 }));
    await repo.insert(
      rec({ playId: 'f2', seed: 3, cash: 301, flag: 'bad-token' }),
    );
    await repo.insert(
      rec({ playId: 'f3', seed: 3, cash: 302, flag: 'no-token' }),
    );
    const q = {
      scenarioId: 'article-community',
      axis: 'cash',
      seed: 3,
    } as const;
    expect(await repo.histogramValues(q)).toEqual([300]);
    const rows = await client.query<{ play_id: string; flag: string | null }>(
      "select play_id, flag from results where play_id like 'f%' order by play_id",
    );
    expect(rows.rows).toEqual([
      { play_id: 'f1', flag: null },
      { play_id: 'f2', flag: 'bad-token' },
      { play_id: 'f3', flag: 'no-token' },
    ]);
    await expect(
      repo.insert(rec({ playId: 'f4', flag: 'other' as never })),
    ).rejects.toThrow();
  });

  it('同じ結果の数の上限: 窓の中で印の無い完走の行だけを数え、上限からは dup-cap を付ける（D-174）', async () => {
    const hash = 'dup-hash';
    const r = (playId: string, over: Partial<ResultRecord> = {}) =>
      rec({ playId, playHash: hash, ...over });
    // 窓の外（古い）行と、印の付いた行・戻った行は数えない
    await repo.insert(r('d-old'));
    await client.query(
      "update results set created_at = now() - interval '2 hours' where play_id = 'd-old'",
    );
    await repo.insert(r('d-flag', { flag: 'too-fast' }));
    await repo.insert(r('d-rw', { rewound: true }));
    const cap = { since: new Date(Date.now() - 60 * 60 * 1000), max: 2 };
    expect((await repo.insert(r('d1'), cap)).stored.flag).toBeNull();
    expect((await repo.insert(r('d2'), cap)).stored.flag).toBeNull();
    expect((await repo.insert(r('d3'), cap)).stored.flag).toBe('dup-cap');
    // 印の付いた送信・途中終了には上限を当てない（そのまま足す）
    expect(
      (await repo.insert(r('d4', { flag: 'bad-token' }), cap)).stored.flag,
    ).toBe('bad-token');
    // 並んで届いても上限を超えない（同じ play_hash の間で直列）
    const parallel = await Promise.all(
      ['p1', 'p2', 'p3'].map((id) =>
        repo.insert(r(id, { playHash: 'par-hash' }), cap),
      ),
    );
    expect(parallel.map((x) => x.stored.flag).sort()).toEqual([
      'dup-cap',
      null,
      null,
    ]);
  });

  it('知らない終わり方は表の検査で入らない', async () => {
    await expect(
      repo.insert(rec({ playId: 'x', endReason: 'won' as never })),
    ).rejects.toThrow();
  });
});
