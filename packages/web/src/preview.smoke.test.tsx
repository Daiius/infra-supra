// @vitest-environment jsdom
// 開発中のシナリオ（Scenario.preview。D-232）の出し分けの描画テスト（D-86）。組み込みのシナリオには印が無いので、
// game の表に架空の開発中のシナリオ（記事コミュニティの写し）を足して確かめる。
// 始める画面: ?preview=1 で出て覚える・?preview=0 で消える。統計の画面: いつも出さない。集計: 送らない・分布を取りに行かない。
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { newSave, replaySave, withTurn } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_KEY, readPreview } from './preview.ts';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';
import { loadStatsView, statsQueryOf, submitResult } from './stats-client.ts';

// vi.mock は先頭に引き上げられるので、id と名前も vi.hoisted で先に作る
const P = vi.hoisted(() => ({
  id: 'fictional-preview',
  name: '架空の開発中のシナリオ',
}));

vi.mock('game', async (importOriginal) => {
  const g = await importOriginal<typeof import('game')>();
  const SCENARIOS = {
    ...g.SCENARIOS,
    [P.id]: {
      ...g.ARTICLE_COMMUNITY,
      id: P.id,
      name: P.name,
      preview: true,
    },
  } as typeof g.SCENARIOS;
  return {
    ...g,
    SCENARIOS,
    isPreviewScenario: (id: string) =>
      Object.hasOwn(SCENARIOS, id) && SCENARIOS[id]!.preview === true,
    listedScenarios: (
      preview: boolean,
      all: readonly import('game').Scenario[] = Object.values(SCENARIOS),
    ) => g.listedScenarios(preview, all),
  };
});

useSmokeEnv();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const scenarioNames = () =>
  screen
    .queryAllByRole('radio')
    .filter((r) => (r as HTMLInputElement).name === 'scenario')
    .map((r) => r.closest('label')!.textContent);

const open = async (url: string) => {
  window.history.replaceState(null, '', url);
  await renderApp();
};

describe('開発中のシナリオ（D-232）', () => {
  it('W-PV1 ?preview が無ければ、始める画面のシナリオの選択に出さない', async () => {
    await open('/');
    const names = scenarioNames();
    expect(names).toContain('記事コミュニティ');
    expect(names).not.toContain(P.name);
    expect(localStorage.getItem(PREVIEW_KEY)).toBeNull();
  });

  it('W-PV2 ?preview=1 で出し、覚えて次からは付けなくても出す。?preview=0 で消す', async () => {
    await open('/?preview=1');
    expect(scenarioNames()).toContain(P.name);
    expect(localStorage.getItem(PREVIEW_KEY)).toBe('1');
    // 最初に選ばれているのは並びの 1 番目のまま（開発中のシナリオを既定にしない）
    expect(
      (
        screen.getByRole('radio', {
          name: '記事コミュニティ',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    screen.getByRole('radio', { name: P.name });

    cleanup();
    await open('/');
    expect(scenarioNames()).toContain(P.name);

    cleanup();
    await open('/?preview=0');
    expect(scenarioNames()).not.toContain(P.name);
    expect(localStorage.getItem(PREVIEW_KEY)).toBeNull();
  });

  it('W-PV3 統計の画面は ?preview=1 でも開発中のシナリオを並べない（集計に無い）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    await open('/?mode=stats&preview=1');
    const section = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-stats-mode]')!,
    );
    const chips = [
      ...within(section)
        .getByRole('group', { name: 'シナリオ' })
        .querySelectorAll('button'),
    ].map((b) => b.textContent);
    expect(chips).toContain('記事コミュニティ');
    expect(chips).not.toContain(P.name);
  });

  it('W-PV4 開発中のシナリオのプレイは送らない・分布を取りに行かない・絞り込みの元を作らない', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    let save = newSave({
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 42,
      startDate: '2026-11-02',
    });
    while (replaySave(save).phase === 'playing') save = withTurn(save, []);
    const state = replaySave(save);
    const preview = { ...save, scenarioId: P.id };
    expect(await submitResult(preview, state, 'n')).toBe('skipped');
    expect(
      await loadStatsView({
        id: 'x',
        scenarioId: P.id,
        seed: 42,
        axes: { cash: 0, satisfaction: 0, featurePoints: 0, totalCost: 0 },
        rewound: false,
        sent: null,
      }),
    ).toEqual({ status: 'off' });
    expect(statsQueryOf(preview)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    // 印の無いシナリオは今までどおり（絞り込みの元を作る）
    expect(statsQueryOf(save)).not.toBeNull();
  });

  it('W-PV5 保存領域が投げても例外を出さず、URL の値で決める', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readPreview('?preview=1', throwing)).toBe(true);
    expect(readPreview('', throwing)).toBe(false);
    expect(readPreview('?preview=0', throwing)).toBe(false);
    expect(readPreview('?preview=1', undefined)).toBe(true);
    expect(readPreview('?preview=yes', undefined)).toBe(false);
  });
});
