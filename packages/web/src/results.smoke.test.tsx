// @vitest-environment jsdom
// 完走の振り返り（D-131〜D-133）と手元の結果の履歴（D-144・D-145）の画面の描画テスト（D-86）。
// 4 軸の値・比べ方は results.test.ts（game）と results-history.test.ts が持つので、ここでは出る・溜まる・比べることだけを見る。
import { fireEvent, screen, within } from '@testing-library/react';
import { newSave, replaySave, withTurn, type SaveData } from 'game';
import { describe, expect, it } from 'vitest';
import {
  RESULTS_KEY,
  RESULTS_VERSION,
  type ResultStore,
} from './results-history.ts';
import { renderApp, useSmokeEnv } from './smoke.test-helpers.tsx';

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
      'edgeMonths',
    ]);
    expect(d.textContent).toContain('ギリギリを攻める');
    expect(d.textContent).toContain('止まった月');
    expect(d.textContent).toContain('比べる過去の完走はまだありません');
    // 目標の値・合否は出さない（D-131）
    expect(d.textContent).not.toContain('目標');
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
    expect(screen.queryByText(/目標/)).toBeNull();
  });

  it('W-75 過去の完走があると、自己ベスト・前回との差・順位を出し、更新した軸の数で花火の段が上がる', async () => {
    // 過去 2 回（どれも低い値）を置く。今回は全部の軸で上回るので 3 段
    const low = (id: string, cash: number) => ({
      id,
      scenarioId: 'article-community',
      seed: 1,
      startDate: '2026-11-02',
      finishedAt: '2026-11-08',
      setup: 'x',
      axes: { cash, satisfaction: 0.1, featurePoints: 1, edgeMonths: -1 },
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
    expect(d.getAttribute('data-firework-level')).toBe('3');
    expect(
      stored()
        .entries.map((e) => e.id)
        .slice(1),
    ).toEqual(['b', 'a']);
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
    expect(screen.queryByRole('dialog', { name: /完走/ })).toBeNull();
    expect(document.querySelector('[data-result-axes]')).toBeNull();
    const s = stored();
    expect(s.entries.length).toBe(1);
    expect(s.entries[0]!.end.reason).toBe('outages');
  });

  it('W-77 始める画面の箱は「走り切る・4 つの軸で振り返る」紹介で、目標の値を出さない（D-133）', async () => {
    await renderApp();
    const box = document.querySelector<HTMLElement>('[data-run-goal]')!;
    expect(box).not.toBeNull();
    expect(
      within(box).getByRole('heading', { name: /12 か月を走り切りましょう/ }),
    ).toBeDefined();
    for (const label of [
      '所持金',
      '満足度の平均',
      '機能開発の累計',
      'ギリギリを攻める',
    ])
      expect(box.textContent).toContain(label);
    expect(box.textContent).toContain('その場で終わります');
    expect(box.textContent).not.toMatch(/\$1,730|以上/);
    expect(box.className).toContain('border-success');
    expect(box.className).not.toContain('bg-success');
  });
});
