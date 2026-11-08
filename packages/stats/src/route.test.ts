// API（Hono RPC）のテスト。保存は手元の実装（memoryRepo）に差し替える（drizzle の層は db/repo.test.ts）。
import { replaySave } from 'game';
import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import { finishedSave, submissionOf } from './plays.test-helpers.ts';
import { memoryRepo, type ResultRecord } from './repo.ts';
import {
  buildVersionFromEnv,
  createApp,
  MAX_BODY_BYTES,
  type AppType,
} from './route.ts';
import { verifySubmission } from './verify.ts';

const completed = finishedSave();
const lost = finishedSave(42, [], 0);

function setup() {
  const repo = memoryRepo();
  const lines: string[] = [];
  const app = createApp({ repo, log: (l) => lines.push(l) });
  // web と同じ hc<AppType> の client で叩く（型の出所が route.ts の鎖 1 本で足りることも確かめる）
  const client = hc<AppType>('http://stats.test', {
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      app.request(input, init),
  });
  return { repo, lines, app, client };
}

const post = (app: ReturnType<typeof createApp>, body: string, headers = {}) =>
  app.request('/api/results', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

describe('POST /api/results', () => {
  it('照合が合えば 201 で保存し、同じプレイの 2 回目は 200（duplicate）で行を増やさない', async () => {
    const { repo, client } = setup();
    const json = submissionOf(completed);
    const r1 = await client.api.results.$post({ json });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ ok: true, duplicate: false });
    const r2 = await client.api.results.$post({ json });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: true, duplicate: true });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.endReason).toBe('completed');
  });

  it('途中終了も終わり方つきで保存する（ヒストグラムには入れない）', async () => {
    const { repo, client } = setup();
    expect(replaySave(lost).phase).toBe('lost');
    const r = await client.api.results.$post({ json: submissionOf(lost) });
    expect(r.status).toBe(201);
    expect(repo.rows[0]!.endReason).not.toBe('completed');
  });

  it('照合で食い違えば 422 で、保存しない', async () => {
    const { repo, client } = setup();
    const json = submissionOf(completed);
    json.axes.cash += 100;
    const r = await client.api.results.$post({ json });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'mismatch', fields: ['cash'] });
    const unfinished = submissionOf(completed);
    unfinished.save.turns = unfinished.save.turns.slice(0, 2);
    const r2 = await client.api.results.$post({ json: unfinished });
    expect(r2.status).toBe(422);
    expect(await r2.json()).toEqual({ error: 'unfinished' });
    expect(repo.rows).toHaveLength(0);
  });

  it('形が違う・JSON でない本文は 400、大きすぎる本文は 413 で、保存しない', async () => {
    const { repo, app } = setup();
    expect((await post(app, '{"save":{}}')).status).toBe(400);
    expect((await post(app, 'not json')).status).toBe(400);
    const bad = submissionOf(completed) as unknown as Record<string, unknown>;
    delete bad.axes;
    const r = await post(app, JSON.stringify(bad));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid' });
    const big = JSON.stringify({
      ...submissionOf(completed),
      pad: 'x'.repeat(MAX_BODY_BYTES),
    });
    expect((await post(app, big)).status).toBe(413);
    expect(repo.rows).toHaveLength(0);
  });

  it('🔒 アクセスのログに IP（X-Forwarded-For など）・User-Agent・クエリを出さない', async () => {
    const { app, lines } = setup();
    await post(app, JSON.stringify(submissionOf(completed)), {
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.9',
      'user-agent': 'TestAgent/1.0',
    });
    await app.request(
      '/api/results/histogram?scenario=article-community&axis=cash&seed=42',
      { headers: { 'x-forwarded-for': '198.51.100.7' } },
    );
    expect(lines).toEqual([
      expect.stringMatching(/^POST \/api\/results 201 \d+ms$/),
      expect.stringMatching(/^GET \/api\/results\/histogram 200 \d+ms$/),
    ]);
    const all = lines.join('\n');
    for (const leaked of ['203.0.113', '198.51.100', 'TestAgent', 'seed='])
      expect(all).not.toContain(leaked);
  });
});

describe('GET /api/results/histogram', () => {
  const rec = (over: Partial<ResultRecord>): ResultRecord => {
    const v = verifySubmission(submissionOf(completed));
    if (!v.ok) throw new Error('照合に失敗');
    return { ...v.record, ...over };
  };

  it('完走・戻っていないプレイだけを、同じシード / 全シードで数える', async () => {
    const { repo, client } = setup();
    repo.rows.push(
      rec({ playHash: 'a', seed: 1, cash: 1000 }),
      rec({ playHash: 'b', seed: 1, cash: 2000 }),
      rec({ playHash: 'c', seed: 2, cash: 3000 }),
      rec({ playHash: 'd', seed: 1, cash: 9999, endReason: 'cash' }),
      rec({ playHash: 'e', seed: 1, cash: 9999, rewound: true }),
      rec({ playHash: 'f', seed: 1, cash: 9999, scenarioId: 'other' }),
    );
    const all = await client.api.results.histogram.$get({
      query: { scenario: 'article-community', axis: 'cash', value: '2000' },
    });
    expect(all.status).toBe(200);
    const h = await all.json();
    expect(h).toMatchObject({
      scenarioId: 'article-community',
      axis: 'cash',
      seed: null,
      count: 3,
      min: 1000,
      max: 3000,
      position: { above: 1, equal: 1 },
    });
    expect('bins' in h && h.bins.reduce((n, b) => n + b.count, 0)).toBe(3);
    const same = await (
      await client.api.results.histogram.$get({
        query: { scenario: 'article-community', axis: 'cash', seed: '1' },
      })
    ).json();
    expect(same).toMatchObject({ seed: 1, count: 2, min: 1000, max: 2000 });
  });

  it('データが無ければ空の分布', async () => {
    const { client } = setup();
    const r = await client.api.results.histogram.$get({
      query: { scenario: 'contract-operations', axis: 'edgeMonths' },
    });
    expect(await r.json()).toMatchObject({
      count: 0,
      min: null,
      max: null,
      bins: [],
    });
  });

  it('知らないシナリオ・軸・数でないシードは 400', async () => {
    const { app } = setup();
    for (const q of [
      'scenario=nope&axis=cash',
      'scenario=article-community&axis=rank',
      'scenario=article-community&axis=cash&seed=abc',
      'axis=cash',
    ])
      expect((await app.request(`/api/results/histogram?${q}`)).status).toBe(
        400,
      );
  });
});

describe('GET /api/results/distribution', () => {
  const rec = (over: Partial<ResultRecord>): ResultRecord => {
    const v = verifySubmission(submissionOf(completed));
    if (!v.ok) throw new Error('照合に失敗');
    return { ...v.record, ...over };
  };

  it('4 軸 ×（同じシード / 全シード）の 8 本を 1 回で返し、値を付けた軸だけ位置を返す（D-161）', async () => {
    const { repo, client } = setup();
    repo.rows.push(
      rec({ playHash: 'a', seed: 1, cash: 1000, edgeMonths: 0 }),
      rec({ playHash: 'b', seed: 1, cash: 2000, edgeMonths: 3 }),
      rec({ playHash: 'c', seed: 2, cash: 3000, edgeMonths: 3 }),
      rec({ playHash: 'd', seed: 1, cash: 9999, endReason: 'cash' }),
      rec({ playHash: 'e', seed: 1, cash: 9999, rewound: true }),
    );
    const r = await client.api.results.distribution.$get({
      query: { scenario: 'article-community', seed: '1', cash: '1500' },
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    if (!('axes' in d)) throw new Error('エラーの応答');
    expect(d).toMatchObject({ scenarioId: 'article-community', seed: 1 });
    expect(Object.keys(d.axes)).toEqual([
      'cash',
      'satisfaction',
      'featurePoints',
      'edgeMonths',
    ]);
    expect(d.axes.cash.seed).toMatchObject({
      count: 2,
      min: 1000,
      max: 2000,
      position: { above: 1, equal: 0 },
    });
    expect(d.axes.cash.all).toMatchObject({
      count: 3,
      max: 3000,
      position: { above: 2, equal: 0 },
    });
    // 値を付けなかった軸は位置なし。ヒストグラムの切り方は 1 本ずつの口と同じ
    expect(d.axes.edgeMonths.all).not.toHaveProperty('position');
    const single = await (
      await client.api.results.histogram.$get({
        query: { scenario: 'article-community', axis: 'edgeMonths' },
      })
    ).json();
    expect('bins' in single && single.bins).toEqual(d.axes.edgeMonths.all.bins);
  });

  it('知らないシナリオ・シードが無い・数でない値は 400', async () => {
    const { app } = setup();
    for (const q of [
      'scenario=nope&seed=1',
      'scenario=article-community',
      'scenario=article-community&seed=1&cash=abc',
    ])
      expect((await app.request(`/api/results/distribution?${q}`)).status).toBe(
        400,
      );
  });
});

describe('GET /api/version', () => {
  it('ビルドの版を返す（読めない値は unknown）', async () => {
    const version = buildVersionFromEnv({
      GIT_COMMIT: 'A'.repeat(40),
      BUILD_TIME: '2026-11-09T00:00:00Z',
    });
    expect(version).toEqual({
      commit: 'a'.repeat(40),
      builtAt: '2026-11-09T00:00:00Z',
    });
    expect(buildVersionFromEnv({ GIT_COMMIT: 'abc' })).toEqual({
      commit: 'unknown',
      builtAt: 'unknown',
    });
    const app = createApp({ repo: memoryRepo(), log: () => {}, version });
    expect(await (await app.request('/api/version')).json()).toEqual(version);
  });
});
