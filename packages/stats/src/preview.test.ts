// 開発中のシナリオ（Scenario.preview。D-232）の結果は受け付けない・分布も返さない。
// 組み込みのシナリオには印が無いので、game の表に架空の開発中のシナリオを足して確かめる。
import { describe, expect, it, vi } from 'vitest';
import { finishedSave, submissionOf } from './plays.test-helpers.ts';
import { memoryTokenStore } from './play-tokens.ts';
import { memoryRepo } from './repo.ts';
import { createApp } from './route.ts';
import { verifySubmission, type Submission } from './verify.ts';

// vi.mock は先頭に引き上げられるので、id も vi.hoisted で先に作る
const { PREVIEW_ID } = vi.hoisted(() => ({ PREVIEW_ID: 'fictional-preview' }));

vi.mock('game', async (importOriginal) => {
  const g = await importOriginal<typeof import('game')>();
  const SCENARIOS = {
    ...g.SCENARIOS,
    [PREVIEW_ID]: { ...g.ARTICLE_COMMUNITY, id: PREVIEW_ID, preview: true },
  } as typeof g.SCENARIOS;
  return {
    ...g,
    SCENARIOS,
    isPreviewScenario: (id: string) =>
      Object.hasOwn(SCENARIOS, id) && SCENARIOS[id]!.preview === true,
  };
});

/** 完走したプレイを、シナリオの id だけ開発中のものに替えた送信。 */
const previewSubmission = (): Submission => {
  const s = structuredClone(submissionOf(finishedSave()));
  s.save.scenarioId = PREVIEW_ID;
  return s;
};

const app = () =>
  createApp({
    repo: memoryRepo(() => 0),
    tokens: memoryTokenStore(() => 0),
    now: () => 0,
    log: () => {},
  });

describe('開発中のシナリオ（D-232）', () => {
  it('照合は再生する前に preview-scenario で落とす', () => {
    expect(verifySubmission(previewSubmission())).toEqual({
      ok: false,
      code: 'preview-scenario',
    });
    // 印の無いシナリオは今までどおり通る
    expect(verifySubmission(submissionOf(finishedSave())).ok).toBe(true);
  });

  it('組み込みの開発中のシナリオ（棋譜解析。D-241）も preview-scenario で落とす', () => {
    const s = structuredClone(submissionOf(finishedSave()));
    s.save.scenarioId = 'kifu-analysis';
    expect(verifySubmission(s)).toEqual({
      ok: false,
      code: 'preview-scenario',
    });
  });

  it('POST /api/results は 422 で保存しない', async () => {
    const repo = memoryRepo(() => 0);
    const a = createApp({
      repo,
      tokens: memoryTokenStore(() => 0),
      now: () => 0,
      log: () => {},
    });
    const r = await a.request('/api/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(previewSubmission()),
    });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'preview-scenario' });
    expect(repo.rows).toHaveLength(0);
  });

  it('分布・構成ごとの口も開発中のシナリオは 400', async () => {
    const a = app();
    for (const path of [
      `/api/results/histogram?scenario=${PREVIEW_ID}&axis=cash`,
      `/api/results/distribution?scenario=${PREVIEW_ID}&seed=42`,
      `/api/results/groups?scenario=${PREVIEW_ID}&axis=cash&by=stack`,
    ])
      expect((await a.request(path)).status, path).toBe(400);
    expect(
      (
        await a.request(
          '/api/results/histogram?scenario=article-community&axis=cash',
        )
      ).status,
    ).toBe(200);
  });
});
