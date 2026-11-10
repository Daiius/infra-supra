// @vitest-environment jsdom
// 「この月に戻る」と前の試行（D-128）の画面の描画テスト（D-86）。戻った状態の値は game の save.test.ts が持つので、
// ここでは戻れる・確認が出る・前の試行の線が出る・保存に残る・消えることだけを見る。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { newSave, replaySave, withTurn, type SaveData } from 'game';
import { describe, expect, it } from 'vitest';
import {
  advance,
  closeEventsDialog,
  expectGameScreen,
  monthHeading,
  readEventPages,
  renderApp,
  restartFromHeader,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const SAVE_KEY = 'infra-supra:game-save';

const start = () =>
  startGame({
    scenario: '記事コミュニティ',
    framework: 'Next.js（App Router）',
    stack: 'Cloudflare Paid + vinext',
  });

const historyCard = () =>
  screen
    .getByRole('heading', { name: 'これまでの運営' })
    .closest('.card-body') as HTMLElement;
const historyRows = () =>
  within(historyCard())
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent);
const rewindDialog = () =>
  screen.getByRole('dialog', { name: '過去の月に戻る' });
/** ヘッダーの「戻る…」（D-192。狭い画面ではアイコンだけなので名前は aria-label）。 */
const headerRewind = () =>
  screen.queryByRole('button', { name: '過去の月に戻る…' });

/** 出来事のダイアログが開いていたら最後まで送って閉じる（戻った月でも開き直す。D-126・D-128）。 */
function closeEventsIfOpen() {
  const d = screen.queryByRole('dialog', { name: /か月目の出来事/ });
  if (!d) return;
  readEventPages(d);
  closeEventsDialog(d);
}

/** これまでの運営の行の「この月に戻る」を押して確認のダイアログで戻る。 */
function rewindFromHistory(month: number) {
  fireEvent.click(
    within(historyCard()).getByRole('button', {
      name: `${month} か月目に戻る`,
    }),
  );
  fireEvent.click(
    within(rewindDialog()).getByRole('button', {
      name: `${month} か月目に戻る`,
    }),
  );
  closeEventsIfOpen();
}

const savedPrevious = () =>
  (JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveData).previous;

describe('この月に戻る（D-128）', () => {
  it('W-70 これまでの運営の行とヘッダーの「戻る…」から、ダイアログを経て過去の月に戻る。やめると戻らない', async () => {
    await renderApp();
    await start();
    // 1 か月目はまだ戻る先が無い（ヘッダーにも出さない。D-192）
    expect(screen.queryByRole('button', { name: /^この月に戻る/ })).toBeNull();
    expect(headerRewind()).toBeNull();
    advance(3);
    expectGameScreen(4);
    const before = historyRows();
    // 今の月・終わった月には戻れない（行動を選んだ月だけ）
    expect(
      within(historyCard()).queryByRole('button', { name: '4 か月目に戻る' }),
    ).toBeNull();

    // やめると何も変わらない
    fireEvent.click(
      within(historyCard()).getByRole('button', { name: '2 か月目に戻る' }),
    );
    const dialog = rewindDialog();
    // 履歴の行から開くと、その行の月を選んだ状態
    expect(
      (within(dialog).getByLabelText('戻る先の月') as HTMLSelectElement).value,
    ).toBe('2');
    expect(dialog.textContent).toContain(
      '2 か月目の行動を選ぶ前に戻ります。今の結果（4 か月目まで）は「前の試行」として 1 本だけ残ります。',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expectGameScreen(4);
    expect(savedPrevious()).toBeUndefined();

    // 戻ると 2 か月目の行動を選ぶ前の画面（1・2 か月目は戻る前と同じ。決定論）
    rewindFromHistory(2);
    expectGameScreen(2);
    expect(historyRows().map((r) => r!.replace('この月に戻る', ''))).toEqual(
      before.slice(0, 2).map((r) => r!.replace('この月に戻る', '')),
    );
    expect(savedPrevious()).toHaveLength(3);
    expect(screen.getByText(/前の試行（4 か月目まで）/)).toBeDefined();

    // 行動の欄の上には戻る欄を出さない（D-192）
    expect(screen.queryByLabelText('戻る先の月')).toBeNull();
    // ヘッダーの「戻る…」からも戻れる。既定は 1 つ前の月。もう一度戻ると前の試行は上書き
    fireEvent.click(headerRewind()!);
    const select = within(rewindDialog()).getByLabelText(
      '戻る先の月',
    ) as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['1 か月目']);
    expect(rewindDialog().textContent).toContain(
      '選んだ月の行動を選ぶ前の状態に戻ります。',
    );
    expect(rewindDialog().textContent).toContain(
      '今ある前の試行（4 か月目まで）は上書きされます。',
    );
    fireEvent.click(
      within(rewindDialog()).getByRole('button', { name: '1 か月目に戻る' }),
    );
    closeEventsIfOpen();
    expectGameScreen(1);
    expect(savedPrevious()).toHaveLength(1);
    expect(screen.getByText(/前の試行（2 か月目まで）/)).toBeDefined();
    // 戻った後も進められる
    advance(1);
    expectGameScreen(2);
  });

  it('W-192 ヘッダーの「戻る…」のダイアログで月を選び直して戻る。やめると戻らない', async () => {
    await renderApp();
    await start();
    advance(3);
    expectGameScreen(4);
    // 行動の欄の上に戻る欄は無い
    expect(screen.queryByLabelText('戻る先の月')).toBeNull();
    // 既定は 1 つ前の月（3 か月目）。やめると何も変わらない
    fireEvent.click(headerRewind()!);
    const select = () =>
      within(rewindDialog()).getByLabelText('戻る先の月') as HTMLSelectElement;
    expect(select().value).toBe('3');
    expect(
      within(select())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['1 か月目', '2 か月目', '3 か月目']);
    fireEvent.click(
      within(rewindDialog()).getByRole('button', { name: 'やめる' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expectGameScreen(4);
    expect(savedPrevious()).toBeUndefined();
    // 選び直すと、文と戻るボタンが選んだ月に変わる
    fireEvent.click(headerRewind()!);
    fireEvent.change(select(), { target: { value: '2' } });
    expect(rewindDialog().textContent).toContain(
      '2 か月目の行動を選ぶ前に戻ります。今の結果（4 か月目まで）は「前の試行」として 1 本だけ残ります。',
    );
    fireEvent.click(
      within(rewindDialog()).getByRole('button', { name: '2 か月目に戻る' }),
    );
    closeEventsIfOpen();
    expectGameScreen(2);
    expect(savedPrevious()).toHaveLength(3);
    // 履歴の行の「この月に戻る」は残る
    expect(
      within(historyCard()).getByRole('button', { name: '1 か月目に戻る' }),
    ).toBeDefined();
  });

  it('W-71 推移のグラフに前の試行の破線（所持金・PV・費用・満足度）と凡例が出て、前の試行の方が長くても描き、ツールチップに値が並ぶ', async () => {
    await renderApp();
    await start();
    expect(document.querySelector('[data-previous-series]')).toBeNull();
    expect(document.querySelector('[data-legend-previous]')).toBeNull();
    advance(4);
    rewindFromHistory(2);
    expectGameScreen(2);
    const ids = new Set(
      [...document.querySelectorAll('[data-previous-series]')].map((e) =>
        e.getAttribute('data-previous-series'),
      ),
    );
    expect([...ids].sort()).toEqual(['cash', 'cost', 'pv', 'score']);
    // 前の試行は 5 か月目まで（今は 2 か月目）。PV の線は 5 点を結ぶ
    const pvLine = document.querySelector('path[data-previous-series="pv"]')!;
    expect(pvLine.getAttribute('d')!.match(/[ML]/g)).toHaveLength(5);
    // 灰色の細かい点線（凡例と同じ）。所持金の見込み（系列の色の長い破線）とは模様も色も違う
    expect(pvLine.getAttribute('stroke-dasharray')).toBe('2 3');
    expect(pvLine.getAttribute('stroke')).toBe('var(--color-base-content)');
    const cashChart = screen
      .getByRole('img', { name: /^所持金/ })
      .closest('figure')!;
    const cashPrev = cashChart.querySelector('path[data-previous-series]')!;
    const projection = [...cashChart.querySelectorAll('path')].find(
      (p) =>
        !p.hasAttribute('data-previous-series') &&
        p.getAttribute('stroke-dasharray'),
    );
    expect(projection, '所持金の見込みの線').toBeDefined();
    expect(cashPrev.getAttribute('stroke-dasharray')).not.toBe(
      projection!.getAttribute('stroke-dasharray'),
    );
    expect(cashPrev.getAttribute('stroke')).not.toBe(
      projection!.getAttribute('stroke'),
    );
    const legendLine = cashChart.querySelector('[data-legend-previous] line')!;
    expect(legendLine.getAttribute('stroke')).toBe(
      cashPrev.getAttribute('stroke'),
    );
    expect(legendLine.getAttribute('stroke-dasharray')).toBe('2 3');
    // 凡例（1 系列のグラフにも出す）
    const pvChart = screen
      .getByRole('img', { name: /^PV（月）。/ })
      .closest('figure')!;
    expect(within(pvChart).getByText('前の試行')).toBeDefined();
    // 今の試行の無い月（4 か月目）にも、前の試行の値だけツールチップに出る
    const svg = within(pvChart).getByRole('img');
    let tip: HTMLElement | null = null;
    for (let px = 0; px <= 640 && !tip; px += 4) {
      fireEvent.pointerMove(svg, { clientX: px });
      tip =
        within(pvChart).queryByText('4 か月目')?.closest<HTMLElement>('div') ??
        null;
    }
    expect(tip, '4 か月目のツールチップ').not.toBeNull();
    expect(tip!.parentElement!.textContent).toContain('PV（前の試行）');
  });

  it('W-72 前の試行はリロードしても残り、「前の試行を消す」で消え、「最初から」で新しく始めると消える', async () => {
    await renderApp();
    await start();
    advance(3);
    rewindFromHistory(3);
    expectGameScreen(3);
    const rows = historyRows();
    // 開き直しても前の試行が残る（保存の previous から再生する）
    cleanup();
    await renderApp();
    expectGameScreen(3);
    expect(historyRows()).toEqual(rows);
    expect(screen.getByText(/前の試行（4 か月目まで）/)).toBeDefined();
    expect(document.querySelector('[data-previous-series]')).not.toBeNull();

    // 前の試行を消す（今の試行はそのまま）
    fireEvent.click(screen.getByRole('button', { name: '前の試行を消す' }));
    expect(document.querySelector('[data-previous-series]')).toBeNull();
    expect(document.querySelector('[data-previous-trial]')).toBeNull();
    expect(savedPrevious()).toBeUndefined();
    expectGameScreen(3);
    cleanup();
    await renderApp();
    expect(document.querySelector('[data-previous-series]')).toBeNull();

    // もう一度前の試行を作ってから「最初から」→ 新しく始めると前の試行は無い
    rewindFromHistory(2);
    expect(savedPrevious()).toHaveLength(2);
    restartFromHeader();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    await start();
    expect(savedPrevious()).toBeUndefined();
    expect(document.querySelector('[data-previous-trial]')).toBeNull();
  });

  it('W-73 終わった後もヘッダーの「戻る…」から過去の月に戻れ、前の試行は終わった月まで描く', async () => {
    // CF Free（構成の 1 番目）は行動なしだと数か月で終わる。終わるまで進めた保存を置いて開く
    let save = newSave({
      scenarioId: 'article-community',
      stackIndex: 0,
      seed: 42,
      startDate: '2026-10-31',
    });
    while (replaySave(save).phase === 'playing') save = withTurn(save, []);
    const end = replaySave(save).history.length;
    expect(end).toBeGreaterThan(1);
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    await renderApp();
    expect(screen.getByText(new RegExp(`${end} か月目で終了`))).toBeDefined();
    expect(screen.queryByRole('button', { name: '次の月へ' })).toBeNull();
    // 結果の画面には戻る欄を出さず、ヘッダーの「戻る…」から戻る（D-192）
    expect(screen.queryByLabelText('戻る先の月')).toBeNull();
    fireEvent.click(headerRewind()!);
    expect(
      within(within(rewindDialog()).getByLabelText('戻る先の月'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(Array.from({ length: end - 1 }, (_, i) => `${i + 1} か月目`));
    expect(rewindDialog().textContent).toContain(
      `今の結果（${end} か月目で終了）`,
    );
    fireEvent.click(
      within(rewindDialog()).getByRole('button', {
        name: `${end - 1} か月目に戻る`,
      }),
    );
    closeEventsIfOpen();
    monthHeading(end - 1);
    screen.getByRole('button', { name: '次の月へ' });
    expect(screen.getByText(/前の試行（\d+ か月目で終了）/)).toBeDefined();
  });
});

describe('これまでの運営の表は既定で畳む（D-187）', () => {
  it('W-187 表は畳んだ状態で始まり、見出しに月数が出る。開くと月ごとの行と「この月に戻る」が出る', async () => {
    await renderApp();
    await start();
    advance(2);
    expectGameScreen(3);
    const details = historyCard().querySelector<HTMLDetailsElement>(
      'details[data-history]',
    )!;
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary')!;
    expect(summary.textContent).toContain('これまでの運営');
    expect(summary.textContent).toContain('（3 か月）');
    // 表は畳んだ中身（summary の外）にある
    expect(summary.querySelector('table')).toBeNull();
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(historyRows()).toHaveLength(3);
    expect(
      within(details).getByRole('button', { name: '1 か月目に戻る' }),
    ).toBeDefined();
  });
});
