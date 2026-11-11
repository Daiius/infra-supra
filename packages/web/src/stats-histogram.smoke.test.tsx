// @vitest-environment jsdom
// 集計の分布の表示（段 3・D-161〜D-163・④ 費用の合計は向きなし D-166・花火 D-168）の描画テスト（D-86）。fetch はモック。分布の切り方は packages/stats、上位 % の数え方は
// distribution.test.ts が持つので、ここでは取る・取らない・順序・出る・戻ることだけを見る。
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import {
  newSave,
  replaySave,
  RESULT_AXES,
  withTurn,
  type SaveData,
} from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { infoDialog, renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SAVE_KEY = 'infra-supra:game-save';

/** CF Paid（構成の 2 番目）・何もしないで 11 か月目まで進めた保存（次の月へで完走する）。 */
function almostDone(seed = 42): SaveData {
  let save = newSave({
    scenarioId: 'article-community',
    stackIndex: 1,
    seed,
    startDate: '2026-11-02',
  });
  while (replaySave(save).history.length < 11) save = withTurn(save, []);
  return save;
}

const victory = () => screen.getByRole('dialog', { name: /完走/ });

async function finish(save = almostDone()) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  await renderApp();
  fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
}

const hist = (count: number, above: number, equal = 1) => ({
  count,
  min: 0,
  max: 10,
  median: 2,
  bins: [
    { from: 0, to: 5, count: count - 1 },
    { from: 5, to: 10, count: 1 },
  ],
  position: { above, equal },
});

/**
 * 分布の応答: 全シード 40 件・同じシード seedCount 件。所持金・満足度・機能開発は上位（自分以上 4 件 / 40 = 10%）。
 * ④ 費用の合計も分布の上の方にいるが、向きを持たない軸なので上位には数えない（D-166）。
 */
function distribution(allCount = 40, seedCount = 12) {
  const top = (n: number) => hist(n, Math.max(0, Math.round(n / 10) - 1));
  return {
    scenarioId: 'article-community',
    seed: 42,
    axes: {
      cash: { seed: top(seedCount), all: top(allCount) },
      satisfaction: { seed: top(seedCount), all: top(allCount) },
      featurePoints: { seed: top(seedCount), all: top(allCount) },
      totalCost: { seed: top(seedCount), all: top(allCount) },
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** POST /api/results は 201、GET /api/results/distribution は dist（関数なら呼んだ結果）。 */
function statsFetch(
  dist: () => Response | Promise<Response>,
  inHistogram = true,
) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url === '/api/results')
      return json({ ok: true, duplicate: false, inHistogram }, 201);
    if (url.startsWith('/api/results/distribution')) return dist();
    return json({ error: 'not-found' }, 404);
  });
}

const dialogAxes = () =>
  victory().querySelector<HTMLElement>('[data-result-axes]')!;
/** 4 軸の欄の注記の横の ⓘ を開き、分布との比べ方の詳しい説明の文を返して閉じる（D-207）。 */
function compareDetail(root: HTMLElement): string {
  fireEvent.click(
    within(root).getByRole('button', { name: '分布との比べ方の説明' }),
  );
  const d = infoDialog()!;
  const text = d.querySelector('[data-compare-detail]')!.textContent ?? '';
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(infoDialog()).toBeNull();
  return text;
}
/** 見る分布（同じシード / 全シード）の切り替えを押す（D-204）。 */
const pickScope = (root: HTMLElement, scope: 'seed' | 'all') =>
  fireEvent.click(
    root.querySelector<HTMLElement>(
      `[data-chips="dist-scope"] [data-chip="${scope}"]`,
    )!,
  );

describe('集計の分布の表示（段 3）', () => {
  it('W-97 VITE_STATS_ENABLED が無ければ分布を取らず、段 1 の表示（手元の履歴との比較・自己ベストの段）', async () => {
    const fetch = statsFetch(() => json(distribution()));
    vi.stubGlobal('fetch', fetch);
    await finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    const axes = dialogAxes();
    expect(axes.dataset.stats).toBe('off');
    expect(axes.querySelector('[data-histogram]')).toBeNull();
    expect(
      axes.querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('この端末に');
    expect(victory().dataset.fireworkLevel).toBe('1');
  });

  it('W-98 フラグがあると送信の後に 1 回で取り、4 軸 × 2 のヒストグラム・上位 %・花火の段を出す（結果の画面も）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch(() => json(distribution()));
    vi.stubGlobal('fetch', fetch);
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    // 送信（POST）が先、分布（GET）が後で、分布は 1 回だけ（結果の画面の比較の図の groups は D-175 の stats-breakdown.smoke.test.tsx で見る）
    const urls = fetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => !u.startsWith('/api/results/groups'));
    expect(urls).toEqual(['/api/results', expect.any(String)]);
    const q = new URL(urls[1]!, 'http://x').searchParams;
    expect(new URL(urls[1]!, 'http://x').pathname).toBe(
      '/api/results/distribution',
    );
    expect(q.get('scenario')).toBe('article-community');
    expect(q.get('seed')).toBe('42');
    for (const a of RESULT_AXES)
      expect(Number.isFinite(Number(q.get(a.id)))).toBe(true);
    const axes = dialogAxes();
    // 4 軸とも見る分布の 1 本だけ（既定は全シード。D-204）
    expect(axes.querySelectorAll('[data-histogram]')).toHaveLength(4);
    // 数値の要約をテキストでも出す（色だけに頼らない）
    const cash = axes.querySelector<HTMLElement>('[data-axis="cash"]')!;
    expect(
      cash.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('40 件中 上位 10%');
    expect(within(cash).getByText(/★ 上位 \d+%/)).toBeDefined();
    pickScope(axes, 'seed');
    expect(
      cash.querySelector('[data-dist="seed"] [data-dist-summary]')!.textContent,
    ).toContain('12 件中 上位');
    expect(
      cash.querySelector('[role="img"]')!.getAttribute('aria-label'),
    ).toMatch(/同じシードの分布（12 件中 上位 \d+%）/);
    pickScope(axes, 'all');
    // ④ 費用の合計は分布の上の方でも上位 % ・上位の印を出さず、中央値だけ（D-166）
    const cost = axes.querySelector<HTMLElement>('[data-axis="totalCost"]')!;
    expect(cost.querySelector('[data-axis-top]')).toBeNull();
    expect(cost.querySelectorAll('[data-histogram]')).toHaveLength(1);
    expect(
      cost.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('40 件・全体の中央値は $2.00 です');
    expect(cost.textContent).not.toMatch(/上位|自己ベスト|位$/);
    expect(
      cost.querySelector('[data-dist="all"]')!.hasAttribute('data-top-percent'),
    ).toBe(false);
    expect(cost.textContent).not.toContain('安全運転');
    // 向きのある 3 つの軸が上位 → 花火は 3 段・見出しに数
    expect(victory().dataset.fireworkLevel).toBe('3');
    expect(victory().textContent).toContain('3 つの軸で上位 25% に入りました');
    // 注記は 1 行だけにし、数え方の詳しい説明は ⓘ に畳む（D-207）
    const note = axes.querySelector<HTMLElement>('[data-result-compare-note]')!;
    expect(note.textContent).toBe('集計した完走のプレイの分布と比べています。');
    expect(note.dataset.self).toBe('included');
    const detail = compareDetail(axes);
    expect(detail).toContain('上位 25% 以内に入った軸を「上位」に数えます');
    expect(detail).toContain('上位 % は 10 件から出します');
    expect(detail).toContain(
      '④ 費用の合計は高い・低いで良し悪しを付けないので、上位を数えず',
    );
    expect(detail).toContain(
      '見る分布を選ぶだけで、「上位」の数え方は変えません',
    );
    expect(detail).toContain('あなたのプレイも数に入っています');
    expect(detail).not.toContain('開発用の架空');
    // ⓘ を閉じても完走のダイアログは開いたまま
    expect(victory()).toBeDefined();
    // 狭い画面で高さを超えても、4 軸の欄だけを縦にスクロールできる（OCL-3AA8C258）
    expect(axes.parentElement!.className).toContain('overflow-y-auto');
    // 結果の画面にも同じ分布
    const result = [...document.querySelectorAll('[data-result-axes]')].find(
      (el) => !victory().contains(el),
    )!;
    expect(result.querySelectorAll('[data-histogram]')).toHaveLength(4);
  });

  it('W-99 分布の取得に失敗したら（500・通信の失敗）、段 1 の表示に戻る', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', '1');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json({ error: 'internal' }, 500)),
    );
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('failed'));
    expect(dialogAxes().querySelector('[data-histogram]')).toBeNull();
    expect(
      dialogAxes().querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('集計の分布を読み込めなかったので、この端末に');
    expect(victory().dataset.fireworkLevel).toBe('1');
  });

  it('W-99b 通信の失敗でも段 1 に戻る', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', '1');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => {
        throw new TypeError('network');
      }),
    );
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('failed'));
    expect(dialogAxes().querySelector('[data-histogram]')).toBeNull();
  });

  it('W-100 件数が少ないとき: 全シードが 10 件未満なら段 1 に戻す（上位の判定の下限は 10 件のまま。D-198）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json(distribution(5, 3))),
    );
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('few'));
    expect(dialogAxes().querySelector('[data-histogram]')).toBeNull();
    expect(
      dialogAxes().querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('集計の完走がまだ 5 件と少ないので');
  });

  it('W-100b 同じシードだけ少なければ、その分布も描いて（参考程度の注記は添えない。D-199）、上位は全シードの分布で数える（D-163・D-198）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json(distribution(40, 3))),
    );
    await finish(almostDone(7));
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    const cash = dialogAxes().querySelector<HTMLElement>('[data-axis="cash"]')!;
    // 「★ 上位」の印は見る分布によらない（D-204）
    expect(cash.querySelector('[data-axis-top]')).not.toBeNull();
    pickScope(dialogAxes(), 'seed');
    const seed = cash.querySelector<HTMLElement>('[data-dist="seed"]')!;
    // 同じシードは 3 件でも描く。上位 % は出さず、件数と中央値と、上位 % が出ない理由
    expect(seed.querySelector('[data-dist-summary]')!.textContent).toMatch(
      /同じシード 3 件・同じシードの中央値は/,
    );
    expect(
      seed.querySelector('[data-dist-summary]')!.textContent,
    ).not.toContain('上位');
    expect(seed.dataset.topPercent).toBeUndefined();
    expect(seed.querySelector('[data-dist-rank-note]')!.textContent).toBe(
      '上位 % は 10 件から出します。',
    );
    expect(cash.textContent).not.toContain('参考程度');
    expect(cash.querySelectorAll('[data-histogram]')).toHaveLength(1);
    // 「★ 上位」の印と花火は全シード（40 件）で決める（同じシードを見ていても変わらない）
    expect(cash.querySelector('[data-axis-top]')).not.toBeNull();
    pickScope(dialogAxes(), 'all');
    expect(
      cash.querySelector<HTMLElement>('[data-dist="all"]')!.dataset.topPercent,
    ).toBeDefined();
    expect(victory().dataset.fireworkLevel).toBe('3');
  });

  it('W-101 開発用の VITE_STATS_MOCK では、取りに行かずに架空の分布を出し、架空と明記する（D-164）', async () => {
    vi.stubEnv('VITE_STATS_MOCK', '1');
    const fetch = statsFetch(() => json(distribution()));
    vi.stubGlobal('fetch', fetch);
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    expect(fetch).not.toHaveBeenCalled();
    expect(dialogAxes().querySelectorAll('[data-histogram]')).toHaveLength(4);
    expect(
      dialogAxes().querySelector('[data-result-compare-note]')!.textContent,
    ).toBe(
      '開発用の架空の分布です。集計した完走のプレイの分布と比べています。',
    );
    expect(compareDetail(dialogAxes())).toContain(
      '開発用の架空の分布です（遊んだ人の結果ではありません）',
    );
  });

  it('W-101b VITE_STATS_MOCK と VITE_STATS_ENABLED を両方立てても、完走・途中終了とも送らない（OCL-87C871FB）', async () => {
    vi.stubEnv('VITE_STATS_MOCK', '1');
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const fetch = statsFetch(() => json(distribution()));
    vi.stubGlobal('fetch', fetch);
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    cleanup();
    // CF Free は何もしないと止まった月の上限を超えて途中で終わる
    let lost = newSave({
      scenarioId: 'article-community',
      stackIndex: 0,
      seed: 42,
      startDate: '2026-11-02',
    });
    while (replaySave(withTurn(lost, [])).phase === 'playing')
      lost = withTurn(lost, []);
    await finish(lost);
    expect(screen.getByText('止まった回数の上限を超えた')).toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('W-98b 保存された行が分布に入らない（inHistogram: false）なら、自分を 1 件足して数える（OCL-9B705B16）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json(distribution()), false),
    );
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    const cash = dialogAxes().querySelector<HTMLElement>('[data-axis="cash"]')!;
    expect(
      cash.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('41 件中 上位');
    expect(
      dialogAxes().querySelector<HTMLElement>('[data-result-compare-note]')!
        .dataset.self,
    ).toBe('added');
    expect(compareDetail(dialogAxes())).toContain(
      'あなたのプレイを 1 件足して数えています',
    );
  });

  it('W-98c 開き直したとき（送り直さない）も、送ったときの inHistogram の結末で自分を数える（OCL-9B705B16）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    // 自分を数えたかの文は ⓘ に畳んだので（D-207）、注記の data-self で見る
    const note = () =>
      document.querySelector<HTMLElement>(
        '[data-result-axes][data-stats="ready"] [data-result-compare-note]',
      )?.dataset.self ?? '';
    for (const [inHistogram, text] of [
      [false, 'added'],
      [true, 'included'],
    ] as const) {
      const fetch = statsFetch(() => json(distribution()), inHistogram);
      vi.stubGlobal('fetch', fetch);
      await finish(almostDone(inHistogram ? 8 : 9));
      await waitFor(() => expect(note()).toBe(text));
      cleanup();
      // 終わった状態のまま開き直す: 送らず、分布だけ取り直す
      await renderApp();
      await waitFor(() => expect(note()).toBe(text));
      expect(
        fetch.mock.calls.filter((c) => c[1]?.method === 'POST'),
      ).toHaveLength(1);
      cleanup();
    }
  });
});

describe('見る分布の切り替えと完走のダイアログの高さ（D-204）', () => {
  it('W-204 既定は全シード。切り替えると 4 軸がそろって替わり、覚えて次も同じ。★ 上位と花火は変わらない', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json(distribution())),
    );
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    // ダイアログの高さは dvh で抑え、中身だけをスクロールする（iOS Safari のツールバーで下のボタンが隠れない）
    expect(victory().querySelector('.modal-box')!.className).toContain(
      'max-h-[calc(100dvh-2rem)]',
    );
    const axes = dialogAxes();
    const chips = [
      ...axes.querySelectorAll<HTMLElement>(
        '[data-chips="dist-scope"] [data-chip]',
      ),
    ];
    expect(
      chips.map((c) => [c.textContent, c.getAttribute('aria-pressed')]),
    ).toEqual([
      ['全シード（40 件）', 'true'],
      ['同じシード（12 件）', 'false'],
    ]);
    const kinds = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('[data-dist]')].map(
        (d) => d.dataset.dist,
      );
    expect(kinds(axes)).toEqual(['all', 'all', 'all', 'all']);
    const tops = () => axes.querySelectorAll('[data-axis-top]').length;
    expect(tops()).toBe(3);
    pickScope(axes, 'seed');
    expect(kinds(axes)).toEqual(['seed', 'seed', 'seed', 'seed']);
    expect(axes.querySelectorAll('[data-histogram]')).toHaveLength(4);
    // 上位の判定は見る分布によらない
    expect(tops()).toBe(3);
    expect(victory().dataset.fireworkLevel).toBe('3');
    expect(localStorage.getItem('infra-supra:dist-scope')).toBe('seed');
    // 後ろの結果の画面もそろう
    const result = [
      ...document.querySelectorAll<HTMLElement>('[data-result-axes]'),
    ].find((el) => !victory().contains(el))!;
    await waitFor(() =>
      expect(kinds(result)).toEqual(['seed', 'seed', 'seed', 'seed']),
    );
    // 開き直しても覚えている
    cleanup();
    await finish();
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    expect(kinds(dialogAxes())).toEqual(['seed', 'seed', 'seed', 'seed']);
  });
});
