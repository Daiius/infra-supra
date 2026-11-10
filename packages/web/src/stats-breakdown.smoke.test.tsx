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

/** 共通の区切り（0〜3,600 を 12 等分）と、構成ごとの棒の件数。 */
const BIN_EDGES = Array.from({ length: 13 }, (_, i) => 300 * i);
const GROUPS = [
  {
    key: OWN_STACK,
    count: 30,
    p25: 1500,
    median: 2000,
    p75: 2600,
    bins: [0, 0, 0, 1, 2, 4, 6, 8, 5, 3, 1, 0],
  },
  {
    key: 'sakura-vps-2gb',
    count: 4,
    p25: 100,
    median: 200,
    p75: 300,
    bins: [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // 隠した構成（D-100）は行に出さない
  {
    key: 'aws-opennext',
    count: 50,
    p25: 1,
    median: 2,
    p75: 3,
    bins: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    key: 'nextjs',
    count: 12,
    p25: 1000,
    median: 1800,
    p75: 2400,
    bins: [0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0],
  },
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
        binEdges: BIN_EDGES,
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

  it('W-105 絞った分布が 10 件未満でも描き、上位 % を出さない（全部の分布が少ないときのように段 1 には戻さない。D-198）。参考程度の注記は添えない（D-199）', async () => {
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
    const cash = axes.querySelector<HTMLElement>('[data-axis="cash"]')!;
    const all = cash.querySelector<HTMLElement>('[data-dist="all"]')!;
    const seed = cash.querySelector<HTMLElement>('[data-dist="seed"]')!;
    expect(all.querySelector('[data-histogram]')).not.toBeNull();
    expect(seed.querySelector('[data-histogram]')).not.toBeNull();
    // 件数と中央値は出すが、上位 % は出さない
    expect(all.querySelector('[data-dist-summary]')!.textContent).toContain(
      '6 件・全体の中央値は',
    );
    expect(all.querySelector('[data-dist-summary]')!.textContent).not.toContain(
      '上位',
    );
    expect(all.dataset.topPercent).toBeUndefined();
    // 向きのある軸は上位 % が出ない理由だけを添え、「参考程度」の注記は出さない（D-199）
    expect(all.querySelector('[data-dist-rank-note]')!.textContent).toBe(
      '上位 % は 10 件から出します。',
    );
    expect(seed.querySelector('[data-dist-rank-note]')!.textContent).toBe(
      '上位 % は 10 件から出します。',
    );
    expect(cash.textContent).not.toContain('参考程度');
    expect(
      all.querySelector('[data-histogram] svg')!.getAttribute('aria-label'),
    ).not.toContain('参考程度');
  });

  it('W-106 比較の図: 隠した構成と 0 件の構成を除いた構成ごとの行・自分の行と自分の縦の線・10 件未満の行も ※ や注記なしで描く（D-199）。フレームワークごとに切り替えられる', async () => {
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
    // 並びは構成の順のまま、集計に 1 件以上ある構成だけ（D-198）
    const withData = STACKS.filter(
      (s) => !s.hidden && GROUPS.some((g) => g.key === s.id),
    );
    expect(rows.map((r) => r.dataset.groupRow)).toEqual(
      withData.map((s) => s.id),
    );
    expect(rows.some((r) => r.dataset.groupRow === 'aws-opennext')).toBe(false);
    const own = compare().querySelector<HTMLElement>(
      `[data-group-row="${OWN_STACK}"]`,
    )!;
    expect(own.dataset.mine).toBe('true');
    expect(own.textContent).toContain('Cloudflare Paid + vinext（あなた）');
    expect(own.querySelector('[data-group-count]')!.textContent).toBe('30 件');
    // 行ごとの小さなヒストグラム: 件数の無い棒は描かず、棒の高さは行ごとの最大（8）で割る
    const ownBars = [
      ...own.querySelectorAll<SVGRectElement>('[data-group-hist] rect'),
    ];
    expect(ownBars.map((r) => Number(r.dataset.bin))).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    const heights = ownBars.map((r) => Number(r.getAttribute('height')));
    const tallest = Math.max(...heights);
    expect(heights[4]).toBe(tallest);
    expect(heights[0]).toBeCloseTo(tallest / 8, 6);
    // 自分の行は強調の色・ほかの行は控えめの色
    expect(ownBars[0]!.getAttribute('fill')).toBe('var(--series-1)');
    expect(own.querySelector('[data-group-median]')).not.toBeNull();
    expect(
      own.querySelector('[data-group-hist]')!.getAttribute('aria-label'),
    ).toContain('中央値 $2,000');
    const few = compare().querySelector<HTMLElement>(
      '[data-group-row="sakura-vps-2gb"]',
    )!;
    // 10 件未満の行も描き、件数に ※ も読み上げの注記も付けない（D-198・D-199）
    expect(few.querySelector('[data-group-hist]')).not.toBeNull();
    expect(few.querySelector('[data-group-median]')).not.toBeNull();
    expect(few.querySelector('[data-group-few]')).toBeNull();
    expect(few.querySelector('[data-group-count]')!.textContent).toBe('4 件');
    const fewLabel = few
      .querySelector('[data-group-hist]')!
      .getAttribute('aria-label');
    expect(fewLabel).toContain('4 件・中央値');
    expect(fewLabel).not.toContain('参考程度');
    expect(compare().textContent).not.toContain('※');
    expect(compare().textContent).not.toContain('参考程度');
    // 0 件の構成の行は出さない（D-198）
    expect(
      compare().querySelector('[data-group-row="gcp-cloud-run"]'),
    ).toBeNull();
    // 数値で見る: 10 件未満の行も分位を出す（件数に ※ は付けない。D-199）
    const tableRows = [
      ...compare().querySelectorAll<HTMLTableRowElement>(
        '[data-group-table] tbody tr',
      ),
    ];
    expect(tableRows).toHaveLength(withData.length);
    const fewRow = tableRows.find((r) => r.textContent!.includes('さくら'))!;
    expect(fewRow.querySelector('[data-group-table-count]')!.textContent).toBe(
      '4',
    );
    expect(fewRow.querySelectorAll('td')).toHaveLength(5);
    // 配置（テストの幅 640 では 3 列）: 棒・自分の線・目盛り・「▼ あなた」が同じ座標の基準（1 つの SVG）にあり、
    // 「▼」は自分の線の真上・目盛りは棒の列の中・件数は棒の列の右（以前は HTML のグリッドと伸び縮みする SVG がずれた）
    const svg = compare().querySelector<SVGSVGElement>(
      '[data-group-range-chart] svg',
    )!;
    expect(svg.dataset.layout).toBe('wide');
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 640 ${svg.getAttribute('height')}`,
    );
    const x0 = Number(svg.dataset.bandX0);
    const x1 = Number(svg.dataset.bandX1);
    expect(x1 - x0).toBeGreaterThan(640 / 2);
    const mineLabel = svg.querySelector<SVGGElement>(
      '[data-group-mine-label]',
    )!;
    expect(mineLabel.textContent).toBe('あなた');
    const mineX = Number(mineLabel.dataset.x);
    // 自分の線は 1 本で全部の行を貫く
    const lines = [...svg.querySelectorAll('[data-group-mine-line]')];
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.getAttribute('x1'))).toBe(mineX);
    expect(Number(lines[0]!.getAttribute('x2'))).toBe(mineX);
    const rowCount = svg.querySelectorAll('[data-group-row]').length;
    expect(Number(lines[0]!.getAttribute('y2'))).toBeGreaterThan(
      Number(lines[0]!.getAttribute('y1')) + (rowCount - 1) * 24,
    );
    // 棒の区切りは全部の行でそろう（同じ番号の棒は同じ x）
    const xsOf = (key: string) =>
      new Map(
        [
          ...svg.querySelectorAll<SVGRectElement>(
            `[data-group-row="${key}"] [data-group-hist] rect`,
          ),
        ].map((r) => [r.dataset.bin, r.getAttribute('x')]),
      );
    const tickXs = [
      ...svg.querySelectorAll<SVGTextElement>('[data-group-ticks] text'),
    ].map((t) => Number(t.dataset.x));
    expect(tickXs).toHaveLength(3);
    // 6 本目の棒の左端（2px のすき間の半分を足す）は、真ん中の目盛り（区切りの 6 番目）と同じ x
    expect(Number(xsOf(OWN_STACK).get('6'))).toBeCloseTo(tickXs[1]! + 1, 6);
    const tip = mineLabel.querySelector('path')!.getAttribute('d')!;
    expect(tip).toContain(`L${mineX},`);
    for (const t of svg.querySelectorAll<SVGTextElement>(
      '[data-group-ticks] text',
    )) {
      expect(Number(t.dataset.x)).toBeGreaterThanOrEqual(x0);
      expect(Number(t.dataset.x)).toBeLessThanOrEqual(x1);
    }
    for (const c of svg.querySelectorAll('[data-group-count]'))
      expect(Number(c.getAttribute('x'))).toBeGreaterThan(x1);
    for (const r of own.querySelectorAll('[data-group-hist] rect')) {
      expect(Number(r.getAttribute('x'))).toBeGreaterThanOrEqual(x0);
      expect(
        Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
      ).toBeLessThanOrEqual(x1);
    }

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
    // フレームワークで集計にあるのは Next.js だけ（0 件のフレームワークの行は出さない）
    expect(compare().querySelectorAll('[data-group-row]')).toHaveLength(1);
    // フレームワークごとでも同じ区切りの同じ番号の棒は同じ x（行どうしで区切りがそろう）
    expect(Number(xsOf('nextjs').get('6'))).toBeCloseTo(
      Number(xsOf(OWN_STACK).get('6') ?? tickXs[1]! + 1),
      6,
    );
  });

  it('W-106b 比較の図: 0 件の行は自分の構成でも出さず（自分の線は出す）、全部 0 件なら図を出さない（D-198）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    let groups: unknown[] = GROUPS.filter((g) => g.key !== OWN_STACK);
    const base = statsFetch();
    const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/results/groups')
        return json({
          scenarioId: 'article-community',
          axis: url.searchParams.get('axis'),
          by: url.searchParams.get('by'),
          seed: null,
          binEdges: groups.length > 0 ? BIN_EDGES : [],
          groups,
        });
      return base(input, init);
    });
    vi.stubGlobal('fetch', fetch);
    await finish();
    await ready();
    await waitFor(() =>
      expect(
        compare().querySelector('[data-group-range-chart]'),
      ).not.toBeNull(),
    );
    expect(
      compare().querySelector(`[data-group-row="${OWN_STACK}"]`),
    ).toBeNull();
    expect(compare().querySelector('[data-group-mine-line]')).not.toBeNull();
    // 全部 0 件: 図を出さず、まだ無いことを書く
    groups = [];
    fireEvent.click(chip('axis', 'satisfaction'));
    await waitFor(() =>
      expect(
        compare().querySelector('[data-group-status="empty"]'),
      ).not.toBeNull(),
    );
    expect(compare().querySelector('[data-group-range-chart]')).toBeNull();
    expect(
      compare().querySelector('[data-group-status="empty"]')!.textContent,
    ).toBe('まだ構成ごとに数えられる完走がありません。');
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
      compare().querySelectorAll('[data-group-hist]').length,
    ).toBeGreaterThan(0);
    // 10 件未満の行も描く（※ は付けない。D-199）
    const counts = [...compare().querySelectorAll('[data-group-count]')].map(
      (e) => e.textContent,
    );
    expect(counts.some((t) => /^[1-9] 件$/.test(t ?? ''))).toBe(true);
    expect(compare().textContent).not.toContain('※');
    fireEvent.click(chip('filter', 'both'));
    await waitFor(() =>
      expect(
        resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
      ).toContain('同じ組み合わせ'),
    );
    // 架空の同じ組み合わせは全シードも 10 件未満: 描いて上位 % を出さない。参考程度の注記は添えない（D-198・D-199）
    expect(resultAxes()!.querySelector('[data-histogram]')).not.toBeNull();
    expect(
      resultAxes()!.querySelector('[data-dist="all"] [data-dist-rank-note]'),
    ).not.toBeNull();
    expect(resultAxes()!.textContent).not.toContain('参考程度');
    expect(
      resultAxes()!.querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('開発用の架空の分布です');
    expect(fetch).not.toHaveBeenCalled();
  });
});
