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
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

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
    expect(axes.querySelectorAll('[data-histogram]')).toHaveLength(8);
    // 数値の要約をテキストでも出す（色だけに頼らない）
    const cash = axes.querySelector<HTMLElement>('[data-axis="cash"]')!;
    expect(
      cash.querySelector('[data-dist="all"] [data-dist-summary]')!.textContent,
    ).toContain('40 件中 上位 10%');
    expect(
      cash.querySelector('[data-dist="seed"] [data-dist-summary]')!.textContent,
    ).toContain('12 件中 上位');
    expect(within(cash).getByText(/★ 上位 \d+%/)).toBeDefined();
    expect(
      cash.querySelector('[role="img"]')!.getAttribute('aria-label'),
    ).toMatch(/同じシードの分布（12 件中 上位 \d+%）/);
    // ④ 費用の合計は分布の上の方でも上位 % ・上位の印を出さず、中央値だけ（D-166）
    const cost = axes.querySelector<HTMLElement>('[data-axis="totalCost"]')!;
    expect(cost.querySelector('[data-axis-top]')).toBeNull();
    expect(cost.querySelectorAll('[data-histogram]')).toHaveLength(2);
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
    expect(
      axes.querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('あなたのプレイも数に入っています');
    // 狭い画面で高さを超えても、4 軸の欄だけを縦にスクロールできる（OCL-3AA8C258）
    expect(axes.parentElement!.className).toContain('overflow-y-auto');
    // 結果の画面にも同じ分布
    const result = [...document.querySelectorAll('[data-result-axes]')].find(
      (el) => !victory().contains(el),
    )!;
    expect(result.querySelectorAll('[data-histogram]')).toHaveLength(8);
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

  it('W-100b 同じシードだけ少なければ、その分布も描いて形は参考程度と添え、上位は全シードの分布で数える（D-163・D-198）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      statsFetch(() => json(distribution(40, 3))),
    );
    await finish(almostDone(7));
    await waitFor(() => expect(dialogAxes().dataset.stats).toBe('ready'));
    const cash = dialogAxes().querySelector<HTMLElement>('[data-axis="cash"]')!;
    const seed = cash.querySelector<HTMLElement>('[data-dist="seed"]')!;
    // 同じシードは 3 件でも描く。上位 % は出さず、件数と中央値・注記
    expect(seed.querySelector('[data-dist-summary]')!.textContent).toMatch(
      /同じシード 3 件・同じシードの中央値は/,
    );
    expect(
      seed.querySelector('[data-dist-summary]')!.textContent,
    ).not.toContain('上位');
    expect(seed.dataset.topPercent).toBeUndefined();
    expect(seed.querySelector('[data-dist-few-note]')!.textContent).toContain(
      'まだ 3 件なので、形は参考程度です。',
    );
    expect(cash.querySelectorAll('[data-histogram]')).toHaveLength(2);
    // 「★ 上位」の印と花火は全シード（40 件）で決める
    expect(cash.querySelector('[data-axis-top]')).not.toBeNull();
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
    expect(dialogAxes().querySelectorAll('[data-histogram]')).toHaveLength(8);
    expect(
      dialogAxes().querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('開発用の架空の分布です');
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
      dialogAxes().querySelector('[data-result-compare-note]')!.textContent,
    ).toContain('あなたのプレイを 1 件足して数えています');
  });

  it('W-98c 開き直したとき（送り直さない）も、送ったときの inHistogram の結末で自分を数える（OCL-9B705B16）', async () => {
    vi.stubEnv('VITE_STATS_ENABLED', 'true');
    const note = () =>
      document.querySelector<HTMLElement>(
        '[data-result-axes][data-stats="ready"] [data-result-compare-note]',
      )?.textContent ?? '';
    for (const [inHistogram, text] of [
      [false, 'あなたのプレイを 1 件足して数えています'],
      [true, 'あなたのプレイも数に入っています'],
    ] as const) {
      const fetch = statsFetch(() => json(distribution()), inHistogram);
      vi.stubGlobal('fetch', fetch);
      await finish(almostDone(inHistogram ? 8 : 9));
      await waitFor(() => expect(note()).toContain(text));
      cleanup();
      // 終わった状態のまま開き直す: 送らず、分布だけ取り直す
      await renderApp();
      await waitFor(() => expect(note()).toContain(text));
      expect(
        fetch.mock.calls.filter((c) => c[1]?.method === 'POST'),
      ).toHaveLength(1);
      cleanup();
    }
  });
});
