// @vitest-environment jsdom
// 出来事のダイアログで提案に返事をする（D-202）・受けると止まりうる上限の見込み（D-203）・受けられない提案の知らせ（D-201）の描画テスト（D-86）。
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  acceptPreview,
  ARTICLE_COMMUNITY,
  newGame,
  playMonth,
  rollSchedule,
  type GameState,
} from 'game';
import { describe, expect, it } from 'vitest';
import { Game } from './game-screen.tsx';
import {
  advance,
  closeEventsDialog,
  declineConfirm,
  monthHeading,
  renderApp,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const SETUP = {
  scenario: '記事コミュニティ',
  framework: 'Next.js（App Router）',
  stack: 'Cloudflare Paid + vinext',
};
const CF_PAID = 1;

/** シード 42 で個人向けのページの提案が来る月（W-85 と同じ）。 */
const proposalMonth = () =>
  rollSchedule(ARTICLE_COMMUNITY, 42).find((x) => x.id === 'p-personal')!.month;

/** 出来事のダイアログを、その提案の返事の欄のあるページまで送る。 */
function pageOf(dialog: HTMLElement, id: string): HTMLElement {
  for (let i = 0; i < 20; i++) {
    const row = dialog.querySelector<HTMLElement>(
      `[data-dialog-proposal-choice="${id}"]`,
    );
    if (row) return row;
    const next = within(dialog).queryByRole<HTMLButtonElement>('button', {
      name: /^次へ/,
    });
    if (!next || next.disabled) break;
    fireEvent.click(next);
  }
  throw new Error(`${id} の返事の欄が無い`);
}

/** 行動の欄の提案の行。 */
const actionRow = (id: string) =>
  document.querySelector<HTMLElement>(`[data-proposal-choice="${id}"]`)!;

/**
 * 2 か月目の終わりに、その出来事だけが起きた状態（台本を差し替える）。change で状態を手直しする（在庫・手間など）。
 */
function stateWith(
  id: string,
  change: (s: GameState) => GameState = (s) => s,
): GameState {
  const g = newGame(CF_PAID, 42);
  const s = playMonth(
    playMonth({ ...g, schedule: [{ id, month: 2 }], revisions: [] }),
  );
  return change(s);
}

/** Game だけを描く（出来事のダイアログは自動で開く）。 */
function renderGame(state: GameState) {
  let advanced: unknown[] | null = null;
  render(
    <Game
      state={state}
      restored={false}
      resumeNotice={false}
      onResumeNoticeShown={() => {}}
      runId="smoke"
      results={[]}
      playId="smoke"
      stats={{ status: 'off' }}
      onAdvance={(actions) => {
        advanced = actions;
        return state;
      }}
      previous={null}
      onPickRewind={() => {}}
      onClearPrevious={() => {}}
    />,
  );
  return { advanced: () => advanced };
}

describe('出来事のダイアログで提案に返事をする（D-202）', () => {
  it('W-202a ダイアログで選んだ返事が行動の欄にも付き、「次の月へ」で確認が出ない', async () => {
    const m = proposalMonth();
    await renderApp();
    await startGame(SETUP);
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.getByRole('dialog', {
      name: new RegExp(`^${m} か月目の出来事`),
    });
    const choice = pageOf(dialog, 'p-personal');
    // 手間の残りも出す
    expect(choice.querySelector('[data-dialog-effort]')!.textContent).toMatch(
      /^来月の手間の残り [\d.]+ \/ [\d.]+$/,
    );
    // 受ける → 行動の欄も受ける
    fireEvent.click(within(choice).getByRole('radio', { name: /^受ける/ }));
    closeEventsDialog(dialog);
    expect(
      within(actionRow('p-personal')).getByRole<HTMLInputElement>('radio', {
        name: /^受ける/,
      }).checked,
    ).toBe(true);
    // 行動の欄で断るに替えると、開き直したダイアログも断る
    fireEvent.click(
      within(actionRow('p-personal')).getByRole('radio', { name: /^断る/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: /出来事/ }));
    const again = screen.getByRole('dialog', {
      name: new RegExp(`^${m} か月目の出来事`),
    });
    expect(
      within(pageOf(again, 'p-personal')).getByRole<HTMLInputElement>('radio', {
        name: /^断る/,
      }).checked,
    ).toBe(true);
    closeEventsDialog(again);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    expect(declineConfirm()).toBeNull();
    const d = screen.queryByRole('dialog');
    if (d) closeEventsDialog(d);
    monthHeading(m + 1);
  });

  it('W-202b 受けられないときは、ダイアログにも選べない理由を出す', () => {
    // 手間を 0 にして、受ける手間が足りない形
    renderGame(stateWith('p-archive', (s) => ({ ...s, effortPerMonth: -50 })));
    const dialog = screen.getByRole('dialog', { name: /^2 か月目の出来事/ });
    const choice = pageOf(dialog, 'p-archive');
    const accept = within(choice).getByRole<HTMLInputElement>('radio', {
      name: /^受ける/,
    });
    expect(accept.disabled).toBe(true);
    expect(choice.querySelector('[data-accept-blocked]')!.textContent).toMatch(
      /手間/,
    );
    // 断るは選べる
    expect(
      within(choice).getByRole<HTMLInputElement>('radio', { name: /^断る/ })
        .disabled,
    ).toBe(false);
  });
});

describe('受けると止まりうる上限の見込み（D-203）', () => {
  it('W-203a 受けると D1 の 10 GB を越えるなら、ダイアログと行動の欄に赤の「受けると来月止まります」を出す', () => {
    const state = stateWith('p-archive', (s) => ({
      ...s,
      stock: { ...s.stock, dbGB: 1.5 },
    }));
    const [x] = acceptPreview(state, 'p-archive', [
      { type: 'respond', eventId: 'p-archive', accept: false },
    ]);
    expect(x!.stops).toBe(true);
    renderGame(state);
    const dialog = screen.getByRole('dialog', { name: /^2 か月目の出来事/ });
    const rows = [pageOf(dialog, 'p-archive'), actionRow('p-archive')].map(
      (r) => r.querySelector<HTMLElement>('[data-accept-limit]')!,
    );
    for (const row of rows) {
      expect(row.getAttribute('data-accept-limit-tone')).toBe('stop');
      expect(row.textContent).toContain(
        `今 ${x!.before.toFixed(1)} GB → 受けると ${x!.after.toFixed(1)} / 10 GB（${(x!.after - 10).toFixed(1)} GB 超える）`,
      );
      expect(row.textContent).toContain('受けると来月止まります');
      expect(row.textContent).toContain(
        'この上限はプランの変更では引き上げられません',
      );
      expect(row.querySelector('.text-error-strong')).not.toBeNull();
      // 今の規模での見込みと断る
      expect(row.closest('[data-accept-limits]')!.textContent).toContain(
        '今の規模（基準の PV）での見込み',
      );
    }
  });

  it('W-203b 来月は越えなくても、残りの月に届く見込みなら黄の「n か月後に止まる見込み」を出す', () => {
    const state = stateWith('p-archive');
    const [x] = acceptPreview(state, 'p-archive');
    expect(x!.stops).toBe(false);
    expect(x!.monthsUntil).toBeDefined();
    renderGame(state);
    const row = actionRow('p-archive').querySelector<HTMLElement>(
      '[data-accept-limit]',
    )!;
    expect(row.getAttribute('data-accept-limit-tone')).toBe('soon');
    expect(row.textContent).toContain(
      `今の規模なら ${x!.monthsUntil} か月後に止まる見込みです`,
    );
    expect(row.textContent).toMatch(/（残り [\d.]+ GB）/);
    expect(row.textContent).not.toContain('受けると来月止まります');
  });
});

describe('受けられない提案は知らせにする（D-201）', () => {
  it('W-201 Cloudflare の SLA の打診は返事の欄を出さず、「次の月へ」で確認も出ない', () => {
    const state = stateWith('p-sla');
    expect(state.pendingProposals).toEqual([]);
    const { advanced } = renderGame(state);
    const dialog = screen.getByRole('dialog', { name: /^2 か月目の出来事/ });
    const page = dialog.querySelector('[data-events-page]')!;
    expect(page.textContent).toContain('今の構成では受けられません: ');
    expect(page.querySelector('[data-event-unavailable]')).not.toBeNull();
    expect(dialog.querySelector('[data-dialog-proposal-choice]')).toBeNull();
    closeEventsDialog(dialog);
    expect(document.querySelector('[data-proposal-choice]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    expect(declineConfirm()).toBeNull();
    expect(advanced()).toEqual([]);
  });
});
