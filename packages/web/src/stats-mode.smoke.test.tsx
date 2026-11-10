// @vitest-environment jsdom
// 統計の画面（ヘッダーの 3 つ目のタブ「統計」・?mode=stats。D-197）の描画テスト（D-86）。fetch はモック。
// タブの出し分け・読み込み中 / 空 / 少ない / エラー / 出せる状態・手元の最新の完走の「▼ あなた」の有無・シナリオと絞り込みのチップを見る。
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESULTS_KEY,
  RESULTS_VERSION,
  type ResultEntry,
} from './results-history.ts';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const OWN_STACK = 'cloudflare-vinext-paid';

const hist = (count: number) =>
  count === 0
    ? { count: 0, min: null, max: null, median: null, bins: [] }
    : {
        count,
        min: 0,
        max: 4000,
        median: 1500,
        bins: [
          { from: 0, to: 2000, count: count - 1 },
          { from: 2000, to: 4000, count: 1 },
        ],
      };

function distribution(count: number) {
  const axis = () => ({ seed: hist(Math.min(count, 3)), all: hist(count) });
  return {
    scenarioId: 'article-community',
    seed: 0,
    stack: null,
    framework: null,
    axes: {
      cash: axis(),
      satisfaction: axis(),
      featurePoints: axis(),
      totalCost: axis(),
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const BIN_EDGES = Array.from({ length: 13 }, (_, i) => 300 * i);

/** distribution は count 件（status を付けるとその状態で返す）。groups は自分の構成に 30 件。 */
function statsFetch(count = 40, status = 200) {
  return vi.fn(async (input: unknown) => {
    const url = new URL(String(input), 'http://x');
    if (url.pathname === '/api/results/distribution')
      return status === 200
        ? json(distribution(count))
        : json({ error: 'x' }, status);
    if (url.pathname === '/api/results/groups')
      return json({
        scenarioId: url.searchParams.get('scenario'),
        axis: url.searchParams.get('axis'),
        by: url.searchParams.get('by'),
        seed: null,
        binEdges: BIN_EDGES,
        groups: [
          {
            key: OWN_STACK,
            count: 30,
            p25: 1500,
            median: 2000,
            p75: 2600,
            bins: [0, 0, 0, 1, 2, 4, 6, 8, 5, 3, 1, 0],
          },
        ],
      });
    return json({ error: 'not-found' }, 404);
  });
}

const callsTo = (fetch: ReturnType<typeof statsFetch>, path: string) =>
  fetch.mock.calls
    .map((c) => new URL(String(c[0]), 'http://x'))
    .filter((u) => u.pathname === path);

/** このブラウザの結果の履歴（新しい順）。 */
function storeResults(entries: Partial<ResultEntry>[]) {
  const base: ResultEntry = {
    id: 'p1',
    scenarioId: 'article-community',
    seed: 42,
    startDate: '2026-11-02',
    finishedAt: '2026-11-09',
    setup: 'Cloudflare Paid + vinext・Next.js',
    stackId: OWN_STACK,
    framework: 'nextjs',
    axes: { cash: 2100, satisfaction: 0.82, featurePoints: 64, totalCost: 700 },
    outages: 0,
    end: { reason: 'completed', month: 12 },
  };
  localStorage.setItem(
    RESULTS_KEY,
    JSON.stringify({
      version: RESULTS_VERSION,
      entries: entries.map((e, i) => ({ ...base, id: `p${i}`, ...e })),
    }),
  );
}

const nav = () =>
  within(screen.getByRole('banner')).getByRole('navigation', {
    name: 'モード',
  });
const page = () => document.querySelector<HTMLElement>('[data-stats-mode]');
const chip = (name: string, value: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-chips="${name}"] [data-chip="${value}"]`,
  )!;

async function openStats() {
  window.history.replaceState(null, '', '/?mode=stats');
  await renderApp();
}

const ready = () =>
  waitFor(() => expect(page()?.dataset.statsStatus).toBe('ready'));

describe('統計の画面（D-197）', () => {
  it('W-110 集計が無効ならタブを出さず、?mode=stats で来てもゲームを開いて URL から外す', async () => {
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await openStats();
    expect(
      within(nav())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['ゲーム', '見積']);
    expect(page()).toBeNull();
    expect(
      within(nav())
        .getByRole('button', { name: 'ゲーム' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(window.location.search).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('W-111 集計が有効ならタブを出し、押すと ?mode=stats で開く。遊んでいなければ印を出さず控えめに案内する', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await renderApp();
    const tab = within(nav()).getByRole('button', { name: '統計' });
    fireEvent.click(tab);
    await waitFor(() => expect(page()).not.toBeNull());
    expect(window.location.search).toBe('?mode=stats');
    expect(tab.getAttribute('aria-current')).toBe('page');
    await ready();
    expect(
      screen.getByRole('heading', { level: 2, name: '遊んだ人の結果の分布' }),
    ).toBeDefined();
    // 自分の値は付けない（位置・上位 % を出さない）・シードは 0（全シードの側だけ使う）
    const q = callsTo(fetch, '/api/results/distribution')[0]!;
    expect(q.searchParams.get('scenario')).toBe('article-community');
    expect(q.searchParams.get('seed')).toBe('0');
    expect(q.searchParams.has('cash')).toBe(false);
    expect(q.searchParams.has('stack')).toBe(false);
    // 4 軸の全シードの分布（同じシードは出さない）。「▼ あなた」も上位 % も出さない
    const hists = page()!.querySelectorAll<HTMLElement>('[data-histogram]');
    expect(hists).toHaveLength(4);
    for (const h of hists) expect(h.dataset.hasMine).toBe('false');
    expect(page()!.textContent).not.toContain('▼ あなた');
    expect(page()!.textContent).not.toMatch(/上位 \d+%/);
    expect(
      page()!.querySelector('[data-axis="cash"] [data-dist-summary]')!
        .textContent,
    ).toBe('40 件・中央値は $1,500.00 です');
    expect(page()!.querySelector('[data-stats-own]')!.textContent).toBe(
      'このシナリオを完走すると、ここにあなたの位置が出ます。',
    );
    // 自分の構成が無いので絞り込みのチップは出さない。比較の図は出し、自分の線は引かない
    expect(page()!.querySelector('[data-chips="filter"]')).toBeNull();
    await waitFor(() =>
      expect(page()!.querySelector('[data-group-range-chart]')).not.toBeNull(),
    );
    expect(page()!.querySelector('[data-group-mine-line]')).toBeNull();
    // 数値で見る（表）
    expect(
      page()!.querySelectorAll('[data-axis="cash"] [data-axis-table] tbody tr'),
    ).toHaveLength(2);
  });

  it('W-112 手元の最新の完走を「▼ あなた」として重ね、日付・構成を添える。絞り込みはその構成で取る', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    storeResults([
      // 途中終了は重ねない
      { end: { reason: 'cash', month: 5 }, finishedAt: '2026-11-10' },
      { finishedAt: '2026-11-09', seed: 7 },
      {
        finishedAt: '2026-11-08',
        axes: { cash: 1, satisfaction: 0, featurePoints: 0, totalCost: 0 },
      },
    ]);
    await openStats();
    await ready();
    const own = page()!.querySelector<HTMLElement>('[data-stats-own]')!;
    expect(own.dataset.statsOwn).toBe('latest');
    expect(own.textContent).toContain('2026-11-09');
    expect(own.textContent).toContain('Cloudflare Paid + vinext・Next.js');
    const hists = page()!.querySelectorAll<HTMLElement>('[data-histogram]');
    for (const h of hists) expect(h.dataset.hasMine).toBe('true');
    expect(
      page()!.querySelector('[data-axis="cash"] [data-axis-own]')!.textContent,
    ).toBe('あなた $2,100.00');
    expect(
      callsTo(fetch, '/api/results/distribution')[0]!.searchParams.get('seed'),
    ).toBe('7');
    await waitFor(() =>
      expect(page()!.querySelector('[data-group-mine-line]')).not.toBeNull(),
    );
    expect(
      page()!
        .querySelector(`[data-group-row="${OWN_STACK}"]`)!
        .getAttribute('data-mine'),
    ).toBe('true');

    fireEvent.click(chip('filter', 'stack'));
    // StrictMode では最初の取得が 2 回になるので、最後の取得を見る
    await waitFor(() =>
      expect(
        callsTo(fetch, '/api/results/distribution')
          .at(-1)!
          .searchParams.get('stack'),
      ).toBe(OWN_STACK),
    );
    await ready();
    expect(page()!.querySelector('[data-stats-note]')!.textContent).toContain(
      '同じインフラ（Cloudflare Paid + vinext）の完走 40 件の分布です。',
    );
  });

  it('W-113 シナリオを切り替えると、そのシナリオの分布と最新の完走（無ければ印なし）に替わる', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    storeResults([{}]);
    await openStats();
    await ready();
    expect(
      chip('scenario', 'article-community').getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(chip('scenario', 'contract-operations'));
    await waitFor(() =>
      expect(
        callsTo(fetch, '/api/results/distribution')
          .at(-1)!
          .searchParams.get('scenario'),
      ).toBe('contract-operations'),
    );
    await ready();
    expect(
      page()!.querySelector<HTMLElement>('[data-stats-own]')!.dataset.statsOwn,
    ).toBe('none');
    expect(page()!.querySelector('[data-chips="filter"]')).toBeNull();
  });

  it('W-114 件数が 0 なら空、10 件未満なら少ないと出し、ヒストグラムを出さない', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal('fetch', statsFetch(0));
    await openStats();
    await ready();
    expect(
      page()!.querySelector<HTMLElement>('[data-stats-note]')!.dataset
        .statsNote,
    ).toBe('empty');
    expect(page()!.textContent).toContain('まだ集計された完走がありません。');
    expect(page()!.querySelectorAll('[data-histogram]')).toHaveLength(0);
    expect(page()!.querySelector('[data-group-compare]')).toBeNull();
  });

  it('W-114b 1〜9 件も描き、「形は参考程度」の注記は添えない（D-198・D-199）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal('fetch', statsFetch(4));
    await openStats();
    await ready();
    expect(
      page()!.querySelector<HTMLElement>('[data-stats-note]')!.dataset
        .statsNote,
    ).toBe('ready');
    expect(
      page()!.querySelector<HTMLElement>('[data-stats-note]')!.textContent,
    ).toBe('完走 4 件の分布です。');
    expect(page()!.querySelectorAll('[data-axis-few]')).toHaveLength(0);
    expect(page()!.querySelectorAll('[data-histogram]')).toHaveLength(4);
    expect(page()!.textContent).not.toContain('参考程度');
    expect(page()!.textContent).not.toContain('※');
    // 中央値・数値で見る の表も出す
    const cash = page()!.querySelector<HTMLElement>('[data-axis="cash"]')!;
    expect(cash.querySelector('[data-dist-summary]')!.textContent).toContain(
      '4 件・中央値は',
    );
    expect(cash.querySelector('[data-axis-table]')).not.toBeNull();
    // 比較の図も出す（1 件以上）
    expect(page()!.querySelector('[data-group-compare]')).not.toBeNull();
  });

  it('W-114c 1 件でも描く（中央値はその値）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal('fetch', statsFetch(1));
    await openStats();
    await ready();
    expect(
      page()!.querySelector<HTMLElement>('[data-stats-note]')!.dataset
        .statsNote,
    ).toBe('ready');
    expect(page()!.querySelectorAll('[data-histogram]')).toHaveLength(4);
    expect(
      page()!.querySelector('[data-axis="cash"] [data-dist-summary]')!
        .textContent,
    ).toContain('1 件・中央値は');
    expect(page()!.textContent).not.toContain('参考程度');
  });

  it('W-115 読み込みに失敗したら知らせる。読み込み中はその旨を出す', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const failing = statsFetch(40, 500);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        await gate;
        return failing(input);
      }),
    );
    await openStats();
    expect(page()!.dataset.statsStatus).toBe('loading');
    expect(page()!.textContent).toContain('集計の分布を読み込んでいます。');
    release();
    await waitFor(() => expect(page()!.dataset.statsStatus).toBe('failed'));
    expect(screen.getByRole('alert').textContent).toContain(
      '集計の分布を読み込めませんでした。',
    );
    expect(page()!.querySelectorAll('[data-histogram]')).toHaveLength(0);
  });

  it('W-116 開発用の VITE_STATS_MOCK では取りに行かずに架空の分布を出し、架空と明記する', async () => {
    vi.stubEnv('VITE_STATS_MOCK', '1');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await openStats();
    await ready();
    expect(fetch).not.toHaveBeenCalled();
    expect(page()!.textContent).toContain('開発用の架空の分布です');
    expect(page()!.querySelectorAll('[data-histogram]')).toHaveLength(4);
  });
});
