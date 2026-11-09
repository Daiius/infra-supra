// @vitest-environment jsdom
// 結果の画面の構成・フレームワークごとの分布（ST-11・D-175）の描画テスト（D-86）。fetch はモック。絞り込み・分位の数え方は
// packages/stats が持つので、ここでは取る・取らない・引数・出る行・自分の線・件数が少ないときの表示だけを見る。
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { newSave, replaySave, STACKS, withTurn, type SaveData } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATS_BREAKDOWN_KEY } from './distribution.ts';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SAVE_KEY = 'infra-supra:game-save';
const OWN_STACK = 'cloudflare-vinext-paid';

/** CF Paid・何もしないで 11 か月目まで進めた保存（次の月へで完走する）。 */
function almostDone(): SaveData {
  let save = newSave({
    scenarioId: 'article-community',
    stackIndex: STACKS.findIndex((s) => s.id === OWN_STACK),
    seed: 42,
    startDate: '2026-11-02',
  });
  while (replaySave(save).history.length < 11) save = withTurn(save, []);
  return save;
}

async function finish() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(almostDone()));
  await renderApp();
  fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
}

const victory = () => screen.queryByRole('dialog', { name: /完走/ });

/** 結果の画面（完走のダイアログの外）の 4 軸の欄。 */
const resultAxes = () =>
  [...document.querySelectorAll<HTMLElement>('[data-result-axes]')].find(
    (el) => !victory()?.contains(el),
  );

const hist = (count: number, above: number) => ({
  count,
  min: 0,
  max: 10,
  median: 2,
  bins: [
    { from: 0, to: 5, count: Math.max(0, count - 1) },
    { from: 5, to: 10, count: Math.min(1, count) },
  ],
  position: { above, equal: 1 },
});

/** 4 軸 × 2 の分布。above は自分より上の件数（全部の分布では上位 10%）。 */
function distribution(allCount: number, seedCount: number, top = true) {
  const h = (n: number) =>
    hist(n, top ? Math.max(0, Math.round(n / 10) - 1) : n - 1);
  const axis = () => ({ seed: h(seedCount), all: h(allCount) });
  return {
    scenarioId: 'article-community',
    seed: 42,
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

const GROUPS = [
  { key: OWN_STACK, count: 30, p25: 1500, median: 2000, p75: 2600 },
  { key: 'sakura-vps-2gb', count: 4, p25: 100, median: 200, p75: 300 },
  // 隠した構成（D-100）は行に出さない
  { key: 'aws-opennext', count: 50, p25: 1, median: 2, p75: 3 },
  { key: 'nextjs', count: 12, p25: 1000, median: 1800, p75: 2400 },
];

/**
 * POST /api/results は 201。distribution は絞り込みが無ければ 40 件（上位）、あれば filtered()。groups は GROUPS。
 */
function statsFetch(
  filtered: () => unknown = () => distribution(20, 12, false),
) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    if (init?.method === 'POST' && url.pathname === '/api/results')
      return json({ ok: true, duplicate: false, inHistogram: true }, 201);
    if (url.pathname === '/api/results/distribution')
      return json(
        url.searchParams.has('stack') || url.searchParams.has('framework')
          ? filtered()
          : distribution(40, 12),
      );
    if (url.pathname === '/api/results/groups')
      return json({
        scenarioId: 'article-community',
        axis: url.searchParams.get('axis'),
        by: url.searchParams.get('by'),
        seed: null,
        groups: GROUPS,
      });
    return json({ error: 'not-found' }, 404);
  });
}

const callsTo = (fetch: ReturnType<typeof statsFetch>, path: string) =>
  fetch.mock.calls
    .map((c) => new URL(String(c[0]), 'http://x'))
    .filter((u) => u.pathname === path);

const chips = (name: string) =>
  document.querySelector<HTMLElement>(`[data-chips="${name}"]`)!;
const chip = (name: string, value: string) =>
  chips(name).querySelector<HTMLButtonElement>(`[data-chip="${value}"]`)!;
const compare = () =>
  document.querySelector<HTMLElement>('[data-group-compare]')!;

async function ready() {
  await waitFor(() => expect(resultAxes()?.dataset.stats).toBe('ready'));
}

describe('構成・フレームワークごとの分布（ST-11・D-175）', () => {
  it('W-104 結果の画面だけに絞り込みのチップ。同じインフラ・同じ組み合わせは自分の構成で絞って取り、★ 上位の印は全部の分布のまま', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await finish();
    await ready();
    // 完走のダイアログにはチップも比較の図も置かない
    expect(victory()!.querySelector('[data-chips]')).toBeNull();
    expect(victory()!.querySelector('[data-group-compare]')).toBeNull();
    const group = within(chips('filter'));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '全部',
      '同じインフラ',
      '同じフレームワーク',
      '同じ組み合わせ',
    ]);
    expect(chip('filter', 'all').getAttribute('aria-pressed')).toBe('true');
    expect(callsTo(fetch, '/api/results/distribution')).toHaveLength(1);

    fireEvent.click(chip('filter', 'stack'));
    await waitFor(() =>
      expect(
        resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
      ).toContain('同じインフラ（Cloudflare Paid + vinext）'),
    );
    const byStack = callsTo(fetch, '/api/results/distribution').at(-1)!;
    expect(byStack.searchParams.get('stack')).toBe(OWN_STACK);
    expect(byStack.searchParams.has('framework')).toBe(false);
    expect(byStack.searchParams.get('seed')).toBe('42');
    const cash =
      resultAxes()!.querySelector<HTMLElement>('[data-axis="cash"]')!;
    // 絞った分布の件数（20 件・最下位）を出しつつ、★ 上位の印は全部の分布（上位 10%）で決める
    expect(
      cash.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('20 件中 上位 100%');
    expect(cash.querySelector('[data-axis-top]')!.textContent).toMatch(
      /★ 上位 \d+%/,
    );
    // 花火の段も全部の分布のまま
    expect(victory()!.dataset.fireworkLevel).toBe('3');
    expect(chip('filter', 'stack').getAttribute('aria-pressed')).toBe('true');
    expect(
      JSON.parse(localStorage.getItem(STATS_BREAKDOWN_KEY)!),
    ).toMatchObject({ filter: 'stack' });

    fireEvent.click(chip('filter', 'both'));
    await waitFor(() =>
      expect(callsTo(fetch, '/api/results/distribution')).toHaveLength(3),
    );
    const both = callsTo(fetch, '/api/results/distribution').at(-1)!;
    expect(both.searchParams.get('stack')).toBe(OWN_STACK);
    expect(both.searchParams.get('framework')).toBe('nextjs');

    // 全部に戻すと取り直さずに全部の分布
    fireEvent.click(chip('filter', 'all'));
    expect(
      resultAxes()!.querySelector('[data-dist="all"] [data-dist-summary]')!
        .textContent,
    ).toContain('40 件中');
    expect(callsTo(fetch, '/api/results/distribution')).toHaveLength(3);
  });

  it('W-105 絞った分布が 10 件未満なら、分布を出さず件数を出す（全部の分布が少ないときのように段 1 には戻さない）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    localStorage.setItem(
      STATS_BREAKDOWN_KEY,
      JSON.stringify({ filter: 'both', by: 'stack', axis: 'cash' }),
    );
    vi.stubGlobal(
      'fetch',
      statsFetch(() => distribution(6, 2)),
    );
    await finish();
    // 覚えた絞り込みで開く
    await waitFor(() =>
      expect(
        resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
      ).toContain('同じ組み合わせ'),
    );
    const axes = resultAxes()!;
    expect(axes.dataset.stats).toBe('ready');
    expect(axes.querySelector('[data-histogram]')).toBeNull();
    const cash = axes.querySelector<HTMLElement>('[data-axis="cash"]')!;
    expect(
      cash.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('まだ 6 件');
    expect(
      cash.querySelector('[data-dist="seed"] [data-dist-summary]')!.textContent,
    ).toContain('まだ 2 件');
  });

  it('W-106 比較の図: 隠した構成を除いた構成ごとの行・自分の行と自分の縦の線・10 件未満の行は「まだ n 件です」。フレームワークごとに切り替えられる', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await finish();
    await ready();
    await waitFor(() =>
      expect(
        compare().querySelector('[data-group-range-chart]'),
      ).not.toBeNull(),
    );
    const groups = callsTo(fetch, '/api/results/groups').at(-1)!;
    expect(groups.searchParams.get('by')).toBe('stack');
    expect(groups.searchParams.get('axis')).toBe('cash');
    expect(groups.searchParams.get('scenario')).toBe('article-community');
    const rows = [
      ...compare().querySelectorAll<HTMLElement>('[data-group-row]'),
    ];
    const visible = STACKS.filter((s) => !s.hidden);
    expect(rows.map((r) => r.dataset.groupRow)).toEqual(
      visible.map((s) => s.id),
    );
    expect(rows.some((r) => r.dataset.groupRow === 'aws-opennext')).toBe(false);
    const own = compare().querySelector<HTMLElement>(
      `[data-group-row="${OWN_STACK}"]`,
    )!;
    expect(own.dataset.mine).toBe('true');
    expect(own.textContent).toContain('Cloudflare Paid + vinext（あなた）');
    expect(own.querySelector('[data-group-count]')!.textContent).toBe('30 件');
    expect(own.querySelector('[data-group-band]')).not.toBeNull();
    expect(own.querySelector('[data-group-mine-line]')).not.toBeNull();
    expect(
      own.querySelector('[data-group-band]')!.getAttribute('aria-label'),
    ).toContain('中央値 $2,000');
    const few = compare().querySelector<HTMLElement>(
      '[data-group-row="sakura-vps-2gb"]',
    )!;
    expect(few.querySelector('[data-group-band]')).toBeNull();
    expect(few.querySelector('[data-group-few]')!.textContent).toBe(
      'まだ 4 件です',
    );
    // 行の無い構成も 0 件として出す（件数は常に見える）
    const empty = compare().querySelector<HTMLElement>(
      '[data-group-row="gcp-cloud-run"]',
    )!;
    expect(empty.querySelector('[data-group-count]')!.textContent).toBe('0 件');
    expect(compare().textContent).toContain('▼ あなた');

    fireEvent.click(chip('by', 'framework'));
    await waitFor(() =>
      expect(
        callsTo(fetch, '/api/results/groups').at(-1)!.searchParams.get('by'),
      ).toBe('framework'),
    );
    await waitFor(() =>
      expect(
        compare().querySelector<HTMLElement>('[data-group-row="nextjs"]')
          ?.dataset.mine,
      ).toBe('true'),
    );
    expect(compare().querySelectorAll('[data-group-row]')).toHaveLength(4);
  });

  it('W-107 比較の図の軸を ④ 費用の合計に替えると、向きの文が「良し悪しを付けません」になり、良し悪しの色を使わない', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await finish();
    await ready();
    await waitFor(() =>
      expect(
        compare().querySelector('[data-group-range-chart]'),
      ).not.toBeNull(),
    );
    expect(compare().dataset.directed).toBe('true');
    expect(
      compare().querySelector('[data-group-direction]')!.textContent,
    ).toContain('右ほど上位です');
    fireEvent.click(chip('axis', 'totalCost'));
    await waitFor(() =>
      expect(
        callsTo(fetch, '/api/results/groups').at(-1)!.searchParams.get('axis'),
      ).toBe('totalCost'),
    );
    await waitFor(() =>
      expect(compare().querySelector('[aria-busy]')).toBeNull(),
    );
    expect(compare().dataset.directed).toBe('false');
    const direction = compare().querySelector('[data-group-direction]')!;
    expect(direction.textContent).toContain('良し悪しを付けません');
    expect(direction.textContent).not.toContain('上位');
    const chart = compare().querySelector('[data-group-range-chart]')!;
    expect(chart.innerHTML).not.toMatch(/--status-|success|error|warning/);
    expect(
      JSON.parse(localStorage.getItem(STATS_BREAKDOWN_KEY)!),
    ).toMatchObject({ axis: 'totalCost' });
  });

  it('W-108 VITE_STATS_ENABLED が無ければ、チップも比較の図も出さず、取りに行かない', async () => {
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    expect(resultAxes()!.dataset.stats).toBe('off');
    expect(document.querySelector('[data-chips]')).toBeNull();
    expect(document.querySelector('[data-group-compare]')).toBeNull();
  });

  it('W-109 開発用の VITE_STATS_MOCK では、取りに行かずに架空の絞った分布と構成ごとの値を出す（D-164）', async () => {
    vi.stubEnv('VITE_STATS_MOCK', '1');
    const fetch = statsFetch();
    vi.stubGlobal('fetch', fetch);
    await finish();
    await ready();
    await waitFor(() =>
      expect(
        compare().querySelector('[data-group-range-chart]'),
      ).not.toBeNull(),
    );
    expect(compare().textContent).toContain('開発用の架空の値です');
    expect(
      compare().querySelectorAll('[data-group-band]').length,
    ).toBeGreaterThan(0);
    expect(
      compare().querySelectorAll('[data-group-few]').length,
    ).toBeGreaterThan(0);
    fireEvent.click(chip('filter', 'both'));
    await waitFor(() =>
      expect(
        resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
      ).toContain('同じ組み合わせ'),
    );
    // 架空の同じ組み合わせは全シードも 10 件未満
    expect(resultAxes()!.querySelector('[data-histogram]')).toBeNull();
    expect(
      resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('開発用の架空の分布です');
    expect(fetch).not.toHaveBeenCalled();
  });
});
