// @vitest-environment jsdom
// 完走の振り返り（D-131〜D-133）と手元の結果の履歴（D-144）・④ 費用の合計（D-166）・目標の目安（D-167）・花火（D-168）・
// 完走の帯（D-170）の画面の描画テスト（D-86）。
// 4 軸の値・比べ方は results.test.ts（game）と results-history.test.ts が持つので、ここでは出る・溜まる・比べることだけを見る。
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { newSave, replaySave, withTurn, type SaveData } from 'game';
import { describe, expect, it } from 'vitest';
import {
  RESULTS_KEY,
  RESULTS_VERSION,
  type ResultStore,
} from './results-history.ts';
import { infoDialog, renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

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

const stored = (): ResultStore =>
  JSON.parse(localStorage.getItem(RESULTS_KEY) ?? 'null') as ResultStore;
const victory = () => screen.getByRole('dialog', { name: /完走/ });

/** 保存を置いて開き、次の月へ進めて完走する。 */
async function finish(save: SaveData) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  await renderApp();
  fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
}

describe('完走の振り返りと手元の結果の履歴', () => {
  it('W-74 12 か月を走り切ると完走のダイアログ（花火）に 4 軸が並び、履歴に 1 件溜まる。比べる過去が無いことを出す', async () => {
    await finish(almostDone());
    const d = victory();
    expect(within(d).getByRole('heading', { name: /完走/ })).toBeDefined();
    const labels = [...d.querySelectorAll('[data-axis]')].map((x) =>
      x.getAttribute('data-axis'),
    );
    expect(labels).toEqual([
      'cash',
      'satisfaction',
      'featurePoints',
      'totalCost',
    ]);
    expect(d.textContent).toContain('費用の合計');
    expect(d.textContent).not.toContain('ギリギリを攻める');
    expect(d.textContent).not.toContain('ジョーク');
    expect(d.textContent).toContain('止まった月');
    expect(d.textContent).toContain('比べる過去の完走はまだありません');
    // 所持金の目標の目安は出すが、合否の言葉は使わない（D-131・D-167）
    const guide = d.querySelector('[data-axis="cash"] [data-cash-guide]')!;
    expect(guide.textContent).toMatch(
      /目標の目安 \$1,730\.00 (を \$[\d,.]+ 上回りました|まで \$[\d,.]+ でした)/,
    );
    expect(d.textContent).not.toMatch(/未達|達成|不合格|合格|✗/);
    expect(d.getAttribute('data-firework-level')).toBe('1');
    const s = stored();
    expect(s.entries.length).toBe(1);
    expect(s.entries[0]!.end.reason).toBe('completed');
    // 結果の画面にも 4 軸が出て、目標の線は出さない
    fireEvent.click(
      within(d).getByRole('button', { name: '閉じて結果を見る' }),
    );
    expect(screen.getByText('完走')).toBeDefined();
    expect(document.querySelector('[data-result-axes]')).not.toBeNull();
    expect(
      document.querySelector('[data-result-axes] [data-cash-guide]'),
    ).not.toBeNull();
    // 完走の帯は success の枠と印だけで、全面は塗らない（D-170）
    const band = document.querySelector<HTMLElement>(
      '[data-result-band="completed"]',
    )!;
    expect(band.className).toContain('border-success');
    expect(band.className).not.toContain('alert-success');
    expect(band.className).not.toContain('bg-success');
    expect(band.textContent).toContain('✓');
    // 結果の画面を絞る（D-223）: 所持金は ① の軸に、止まった月は帯に、軸の説明の文は ⓘ に任せて重ねない
    expect(band.textContent).not.toContain('所持金');
    expect(band.textContent).toContain('止まった月 0 回');
    const axes = document.querySelector<HTMLElement>('[data-result-axes]')!;
    expect(axes.textContent).not.toContain('止まった月');
    expect(axes.textContent).not.toContain('最後の月の所持金');
    fireEvent.click(
      within(axes).getByRole('button', { name: '4 つの軸の見方' }),
    );
    const info = infoDialog()!;
    expect(info.querySelector('[data-axis-captions]')!.textContent).toContain(
      '最後の月の所持金',
    );
    expect(info.textContent).toContain('軸には入れません');
    fireEvent.keyDown(document, { key: 'Escape' });
    // 工数の使い道は輪と同じ色の帯と、0 でない区分だけの凡例
    const stack = document.querySelector('[data-effort-stack]')!;
    expect(
      stack.querySelector('[role="img"]')!.getAttribute('aria-label'),
    ).toMatch(/^工数の使い道: 機能開発 /);
    expect(stack.textContent).not.toMatch(/イベントへの対応 0/);
    // 帯の中の「新しいゲームを始める」で、確かめずに始める画面へ戻る（結果は履歴に残っている。D-227）
    fireEvent.click(
      within(band).getByRole('button', { name: '新しいゲームを始める' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-result-band]')).toBeNull();
    expect(
      screen.getByRole('button', { name: /はじめる|始める/ }),
    ).toBeDefined();
    expect(stored().entries.length).toBe(1);
  });

  it('W-75 過去の完走があると、自己ベスト・前回との差・順位を出す。分布が無いので花火は自己ベストの数に依らず 1 段（D-168）', async () => {
    // 過去 2 回（どれも低い値）を置く。今回は向きのある 3 軸すべてで上回るが、花火の段は変えない
    const low = (id: string, cash: number) => ({
      id,
      scenarioId: 'article-community',
      seed: 1,
      startDate: '2026-11-02',
      finishedAt: '2026-11-08',
      setup: 'x',
      axes: { cash, satisfaction: 0.1, featurePoints: 1, totalCost: 5 },
      outages: 0,
      end: { reason: 'completed', month: 12 },
    });
    localStorage.setItem(
      RESULTS_KEY,
      JSON.stringify({
        version: RESULTS_VERSION,
        entries: [low('b', 20), low('a', 10)],
      }),
    );
    await finish(almostDone());
    const d = victory();
    expect(d.textContent).toContain('同じシナリオの 2 回');
    const cash = d.querySelector('[data-axis="cash"]')!;
    expect(cash.textContent).toContain('★ 自己ベスト更新');
    expect(cash.textContent).toContain('これまでの自己ベスト $20.00');
    expect(cash.textContent).toContain('前回との差 +$');
    expect(cash.textContent).toContain('過去 3 回の中で 1 位');
    // ④ 費用の合計は前回との差だけ（自己ベスト・順位を出さない。D-166）
    const cost = d.querySelector('[data-axis="totalCost"]')!;
    expect(cost.textContent).toContain('前回との差 +$');
    expect(cost.textContent).not.toContain('自己ベスト');
    expect(cost.textContent).not.toContain('位');
    expect(d.getAttribute('data-firework-level')).toBe('1');
    expect(d.textContent).not.toContain('自己ベストを更新しました');
    expect(
      stored()
        .entries.map((e) => e.id)
        .slice(1),
    ).toEqual(['b', 'a']);
  });

  it('W-78 履歴はタブをまたぐ鍵（Web Locks）の中で、保存済みの履歴を読み直して足す。開いた後に別のタブが足した結果を消さない（OCL-E9D5918D）', async () => {
    // 鍵の取得を記録し、前の鍵の処理が終わってから次を動かす（Web Locks と同じく 1 つずつ）
    const names: string[] = [];
    let queue = Promise.resolve();
    const locks = {
      request: (name: string, cb: () => void) => {
        names.push(name);
        queue = queue.then(cb);
        return queue;
      },
    };
    Object.defineProperty(navigator, 'locks', {
      value: locks,
      configurable: true,
    });
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(almostDone()));
      await renderApp();
      // 画面を開いた後に、別のタブが 1 件書いた
      localStorage.setItem(
        RESULTS_KEY,
        JSON.stringify({
          version: RESULTS_VERSION,
          entries: [
            {
              id: 'other-tab',
              scenarioId: 'article-community',
              seed: 7,
              startDate: '2026-11-02',
              finishedAt: '2026-11-09',
              setup: 'x',
              axes: {
                cash: 1,
                satisfaction: 0.1,
                featurePoints: 1,
                totalCost: 0,
              },
              outages: 0,
              end: { reason: 'completed', month: 12 },
            },
          ],
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
      await waitFor(() => expect(stored().entries.length).toBe(2));
      expect(names).toEqual([RESULTS_KEY]);
      expect(stored().entries[1]!.id).toBe('other-tab');
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('W-76 途中で終わったプレイも履歴に残り、結果の画面には 4 軸の比較を出さない', async () => {
    // CF Free は何もしないと数か月で止まった月の上限を超える。終わる 1 か月前の保存を置いて進める
    let save = newSave({
      scenarioId: 'article-community',
      stackIndex: 0,
      seed: 42,
      startDate: '2026-11-02',
    });
    while (replaySave(withTurn(save, [])).phase === 'playing')
      save = withTurn(save, []);
    await finish(save);
    expect(screen.getByText('止まった回数の上限を超えた')).toBeDefined();
    // 途中終了は 4 軸が無いので、帯に所持金を残す（D-223）
    expect(
      document.querySelector('[data-result-band="lost"]')!.textContent,
    ).toContain('所持金');
    // 途中で終わったときも、帯から始め直せる（D-227）
    expect(
      document.querySelector('[data-result-band="lost"] [data-result-restart]'),
    ).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: /完走/ })).toBeNull();
    expect(document.querySelector('[data-result-axes]')).toBeNull();
    const s = stored();
    expect(s.entries.length).toBe(1);
    expect(s.entries[0]!.end.reason).toBe('outages');
  });

  it('W-102 プレイ中は推移に所持金の目標の目安を出す: 文と所持金のグラフの控えめな点線（合否の言葉・色を使わない。D-167）', async () => {
    let save = newSave({
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 42,
      startDate: '2026-11-02',
    });
    for (let i = 0; i < 4; i++) save = withTurn(save, []);
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    await renderApp();
    // 見込みと目安の文は出さず、所持金のグラフ（目安の点線と札）に任せる（D-222 の補足）
    expect(document.querySelector('p[data-cash-guide]')).toBeNull();
    expect(document.querySelector('[data-cash-projection]')).toBeNull();
    const ref = document.querySelector('[data-reference="neutral"]')!;
    expect(ref).not.toBeNull();
    expect(ref.textContent).toContain('目標の目安');
    expect(ref.querySelector('line')!.getAttribute('stroke')).not.toContain(
      'critical',
    );
  });

  it('W-77 始める画面には「走り切る・4 つの軸」の箱を出さない（遊び方の 1 ページ目と重なる。D-217 で D-133 の箱をやめた）', async () => {
    await renderApp();
    expect(document.querySelector('[data-run-goal]')).toBeNull();
    expect(screen.queryByText(/か月を走り切りましょう/)).toBeNull();
  });
});
