// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 出来事のダイアログ・提案の印・出来事の欄（App.smoke.test.tsx から分けた）。
import { fireEvent, screen, within } from '@testing-library/react';
import { ARTICLE_COMMUNITY, rollSchedule } from 'game';
import { describe, expect, it } from 'vitest';
import {
  useSmokeEnv,
  waitLoaded,
  renderApp,
  startGame,
  nextMonth,
  advance,
  eventPosition,
  readEventPages,
  closeEventsDialog,
  monthHeading,
  expectGameScreen,
  ARTICLE,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
  it('W-61 出来事のある月は出来事のダイアログが開き、1 件ずつ前後に移れて、最後のページで「閉じる」が出る（D-126）', async () => {
    // シード 42 は 6 か月目に 3 件（話題・個人向けのページの提案・料金の改定）
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.getByRole('dialog', {
      name: new RegExp(`^${m} か月目のイベント（\\d+ 件）`),
    });
    const n = Number(
      within(dialog)
        .getByRole('heading')
        .textContent!.match(/（(\d+) 件）/)![1],
    );
    expect(n).toBeGreaterThanOrEqual(2);
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    const page = () => dialog.querySelector('[data-events-page]')!.textContent!;
    const first = page();
    // ナビ（前へ・位置・次へ・件数ぶんの印）は本文の上にあり、× とは別の行（D-126）
    const nav = within(dialog).getByRole('navigation', {
      name: 'イベントのページ',
    });
    const body = dialog.querySelector('[data-events-page]')!;
    // 2 件以上の月は高さを一定にして、ページを替えても上端・ナビが動かない（見た目は画面で確かめる）
    expect(dialog.querySelector('[data-events-fixed-height]')).not.toBeNull();
    expect(
      nav.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nav.contains(
        within(dialog).getByRole('button', { name: 'ダイアログを閉じる' }),
      ),
    ).toBe(false);
    // 件数はページ送りの点で示す。今のページは横長、未読は塗り、既読は輪郭だけ
    const dots = within(nav).getAllByRole('button', { name: /^\d+ 件目（/ });
    expect(dots).toHaveLength(n);
    const dotStates = () => dots.map((d) => d.getAttribute('data-dot'));
    expect(dots[0]!.getAttribute('aria-current')).toBe('step');
    expect(dotStates()).toEqual(['current', ...Array(n - 1).fill('unread')]);
    // 見出しの近くに未読の数（開いたページは既読）、未読だったカードの角に NEW
    const unread = () =>
      dialog.querySelector('[data-events-unread]')!.textContent;
    const isNew = () => dialog.querySelector('[data-events-new]') !== null;
    expect(unread()).toBe(`未読 ${n - 1}`);
    expect(isNew()).toBe(true);
    // 読み上げにも位置と未読の数を伝える
    expect(dialog.querySelector('[aria-live="polite"]')!.textContent).toBe(
      `${n} 件中 1 件目。未読 ${n - 1} 件`,
    );
    // 1 ページ目: 前へは押せず、次へ・あとで見る・× がある。最後でないので「閉じる」は無い
    const prev = () =>
      within(dialog).getByRole<HTMLButtonElement>('button', {
        name: /^← 前へ/,
      });
    expect(prev().disabled).toBe(true);
    within(dialog).getByRole('button', { name: 'あとで見る（閉じる）' });
    within(dialog).getByRole('button', { name: 'ダイアログを閉じる' });
    expect(within(dialog).queryByRole('button', { name: '閉じる' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    expect(eventPosition(dialog)).toBe(`2 / ${n}`);
    expect(page()).not.toBe(first);
    expect(unread()).toBe(`未読 ${n - 2}`);
    expect(isNew()).toBe(true);
    expect(dotStates().slice(0, 2)).toEqual(['read', 'current']);
    fireEvent.click(prev());
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    expect(page()).toContain(first.replace(/^NEW/, ''));
    // 読んだページに戻ると NEW は出ず、未読の数も減らない
    expect(isNew()).toBe(false);
    expect(unread()).toBe(`未読 ${n - 2}`);
    // 点を押すとそのページへ移る
    const proposalDot = dots.find((b) =>
      b.getAttribute('aria-label')!.includes('会員向けの個人化'),
    )!;
    fireEvent.click(proposalDot);
    expect(page()).toContain('◆ 開発依頼');
    expect(proposalDot.getAttribute('aria-current')).toBe('step');
    fireEvent.click(dots[0]!);
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    // 左右の矢印キーでも移る
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(eventPosition(dialog)).toBe(`2 / ${n}`);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    // 各ページに出来事の印（一覧と同じ文言）と題が出る。提案のページには行動の欄で選ぶ案内
    const pages = readEventPages(dialog);
    expect(pages).toHaveLength(n);
    const proposal = pages.find((t) => t.includes('◆ 開発依頼'))!;
    expect(proposal).toContain('会員向けの個人化');
    // 提案のページで受ける / 断るを選べる（D-202）
    expect(proposal).toContain(
      '受けるか断るかを選びます（選ばなければ断ります）',
    );
    expect(pages.some((t) => t.includes('⚡ 今月発生'))).toBe(true);
    // 最後のページ: 「閉じる」が主ボタン。次へは位置を動かさず押せなくなり、あとで見るは無い。全部読んだ
    expect(eventPosition(dialog)).toBe(`${n} / ${n}`);
    expect(unread()).toBe('✓ すべて既読');
    expect(dotStates().filter((x) => x === 'unread')).toHaveLength(0);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: /^次へ/ })
        .disabled,
    ).toBe(true);
    expect(
      within(dialog).queryByRole('button', { name: 'あとで見る（閉じる）' }),
    ).toBeNull();
    const close = within(dialog).getByRole('button', { name: '閉じる' });
    expect(close.classList.contains('btn-primary')).toBe(true);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 閉じても月のカードに出来事の一覧が残り、そこから 1 ページ目で開き直せる
    expect(screen.getAllByText('◆ 開発依頼').length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole('button', {
        name: `イベントを 1 件ずつ見る（${n} 件）`,
      }),
    );
    const again = screen.getByRole('dialog');
    expect(eventPosition(again)).toBe(`1 / ${n}`);
    // 既読は開いている間だけ。開き直すと初めから（D-126）
    expect(again.querySelector('[data-events-unread]')!.textContent).toBe(
      `未読 ${n - 1}`,
    );
    closeEventsDialog(again);
  });

  it('W-62 出来事のダイアログは途中のページでも閉じられ、同じ月では再び自動では開かない（D-126）', async () => {
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    // 途中のページで「あとで見る（閉じる）」
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'あとで見る（閉じる）' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // × でも閉じる（一覧のボタンで開き直してから）
    fireEvent.click(
      screen.getByRole('button', { name: /^イベントを 1 件ずつ見る/ }),
    );
    dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'ダイアログを閉じる' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // 見積の画面へ移って戻ると、運営中の画面は作り直されるが、同じ月の出来事は自動では開かない
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'モード' })).getByRole(
        'button',
        { name: '見積' },
      ),
    );
    await waitLoaded();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'モード' })).getByRole(
        'button',
        { name: 'ゲーム' },
      ),
    );
    await waitLoaded();
    monthHeading(m);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 次の出来事のある月はまた開く（この月の提案は選ばずに断って進む。D-140）
    nextMonth();
    within(screen.getByRole('dialog')).getByRole('heading', {
      name: new RegExp(`^${m + 1} か月目のイベント`),
    });
  });

  it('W-63 行動の欄の機能追加の提案の選択肢に、出来事と同じ「◆ 提案」の印と primary の枠が付く（D-126）', async () => {
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    expect(document.querySelector('[data-proposal-choice]')).toBeNull();
    advance(m - 1);
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[data-proposal-choice]'),
    ];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.textContent).toContain('会員向けの個人化');
    expect(row.classList.contains('border-primary')).toBe(true);
    const badge = within(row).getByText('◆ 開発依頼');
    expect(badge.classList.contains('badge-primary')).toBe(true);
    // 月のカードの出来事の一覧の印と同じ文言・色
    const listed = screen
      .getAllByText('◆ 開発依頼')
      .find((el) => !row.contains(el))!;
    expect(listed.className).toContain('badge-primary');
    // 受ける・断るの選択肢はこの行の中にある
    expect(within(row).getAllByRole('radio')).toHaveLength(2);
  });

  it('W-53 Bot を遮断してから Bot が来ると、出来事の欄に遮断済みの文が出る（2026-11-04）', async () => {
    // 既定のシード 42 は Bot が予告なしで来る
    const bot = ARTICLE_COMMUNITY.events.find((e) => e.id === 'bot')!;
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'bot',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    // 始めた時点で 1 か月目の報告が出ている。m - 1 か月目まで進めてから次の月へ
    advance(m - 2);
    expectGameScreen(m - 1);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.getByRole('dialog');
    within(dialog).getByRole('heading', {
      name: new RegExp(`^${m} か月目のイベント`),
    });
    // 出来事は 1 件ずつ出る（D-126）。Bot のページまで送る
    for (let i = 0; i < 10 && !dialog.textContent!.includes(bot.title); i++)
      fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    expect(dialog.textContent).toContain(bot.blockedSurpriseText);
    expect(dialog.textContent).not.toContain(bot.surpriseText);
    // 効果の行は実際の倍率、予告なしの印の説明も遮断済みの文
    expect(dialog.textContent).toContain(
      '効果: Bot のPV × 1.5（遮断で半分・2 か月・収益なし）',
    );
    expect(dialog.textContent).toContain(
      '今月の費用・満足度に効いています（遮断済みで半分）',
    );
    expect(dialog.textContent).not.toContain('対処は来月から');
    // 緑の印（文字つき）を添える。閉じた後の月の報告の一覧にも出る
    expect(
      within(dialog)
        .getByText('🛡 対策済み')
        .classList.contains('badge-success'),
    ).toBe(true);
    closeEventsDialog(dialog);
    expect(screen.getAllByText('🛡 対策済み').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/🛡 対策済み）: Bot・クローラーの大量アクセス/),
    ).toBeDefined();
  });
});
