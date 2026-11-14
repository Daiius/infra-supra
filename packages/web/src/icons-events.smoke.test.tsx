// @vitest-environment jsdom
// シナリオの図柄・出来事の種類の印・未決の提案の確認（D-140）の描画テスト（D-86）。
// 図柄・印の見た目は確かめない（出る・種類が合う・確認を経て進む・進まないことだけを見る）。
import { fireEvent, screen, within } from '@testing-library/react';
import { ARTICLE_COMMUNITY, rollSchedule, SCENARIOS } from 'game';
import { describe, expect, it } from 'vitest';
import {
  advance,
  closeEventsDialog,
  declineConfirm,
  getRadio,
  monthHeading,
  readEventPages,
  renderApp,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';
import { SCENARIO_ART } from './scenario-art.tsx';

useSmokeEnv();

const SETUP = {
  scenario: '記事コミュニティ',
  framework: 'Next.js（App Router）',
  stack: 'Cloudflare Paid + vinext',
};
const start = async () => {
  await renderApp();
  await startGame(SETUP);
};

/** シード 42 で個人向けのページの提案が来る月（W-61〜W-63 と同じ）。 */
const proposalMonth = () =>
  rollSchedule(ARTICLE_COMMUNITY, 42).find((x) => x.id === 'p-personal')!.month;

/** 出来事のダイアログが自動で開いていたら閉じる。 */
const closeEventsIfOpen = () => {
  const dialog = screen.queryByRole('dialog');
  if (!dialog) return;
  readEventPages(dialog);
  closeEventsDialog(dialog);
};

describe('シナリオの図柄と出来事の印（D-140）', () => {
  it('W-83 始める画面のシナリオの説明に、アイコンを組み合わせた図柄が出る（シナリオごと）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    const art = screen.getByRole('img', { name: /^記事コミュニティの図柄: / });
    expect(art.getAttribute('data-scenario-art')).toBe('article-community');
    const nodes = art.querySelectorAll('[data-art-node]');
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.length).toBeLessThanOrEqual(7);
    // 各印はアイコン（svg）で、ラスタ画像は使わない
    for (const n of nodes) expect(n.querySelector('svg')).not.toBeNull();
    expect(art.querySelector('img')).toBeNull();
    expect(art.getAttribute('aria-label')).toContain('記事');
    // 受託は別の図柄
    fireEvent.click(getRadio({ name: /^受託先の業務アプリの運用/ }));
    const contract = screen.getByRole('img', {
      name: /^受託先の業務アプリの運用の図柄: /,
    });
    expect(contract.getAttribute('data-scenario-art')).toBe(
      'contract-operations',
    );
    // どのシナリオにも図柄がある
    for (const id of Object.keys(SCENARIOS))
      expect(SCENARIO_ART[id], id).toBeDefined();
  });

  it('W-84 出来事の詳しい説明は種類ごとの印の付いた一覧で、運営中の出来事の通知の見出しにも同じ印が出る', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'イベントの詳しい説明' }),
    );
    const dialog = screen.getByRole('dialog', { name: '運営中のイベント' });
    const list = dialog.querySelector('[data-events-list]')!;
    const rows = [...list.querySelectorAll('li')];
    // シナリオの行 + 料金の改定の行
    expect(rows).toHaveLength(ARTICLE_COMMUNITY.text!.events.length + 1);
    const kinds = rows.map((r) =>
      r.querySelector('[data-event-icon]')?.getAttribute('data-event-icon'),
    );
    expect(kinds.every((k) => k && k !== 'other')).toBe(true);
    expect(kinds).toEqual(
      expect.arrayContaining(['buzz', 'bot', 'team', 'proposal', 'limit']),
    );
    expect(kinds.at(-1)).toBe('revision');
    expect(rows[1]!.textContent).toContain('Bot・クローラーが大量に来ます');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));

    // 運営中の出来事のダイアログ: 提案のページに提案の印、どのページにも印
    const m = proposalMonth();
    await startGame(SETUP);
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const events = screen.getByRole('dialog', {
      name: new RegExp(`^${m} か月目のイベント`),
    });
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const page = events.querySelector('[data-events-page]')!;
      const icon = page.querySelector('[data-event-icon]');
      expect(icon, page.textContent!).not.toBeNull();
      seen.push(icon!.getAttribute('data-event-icon')!);
      const next = within(events).queryByRole<HTMLButtonElement>('button', {
        name: /^次へ/,
      });
      if (!next || next.disabled) break;
      fireEvent.click(next);
    }
    expect(seen).toContain('proposal');
    closeEventsDialog(events);
  });
});

describe('未決の提案の確認（D-140）', () => {
  it('W-85 未決の提案があると「次の月へ」で確認が出て、「提案を選ぶ」で戻り、「断って進む」で進む', async () => {
    const m = proposalMonth();
    await start();
    advance(m - 1);
    monthHeading(m);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    let confirm = declineConfirm()!;
    expect(confirm).not.toBeNull();
    within(confirm).getByRole('heading', {
      name: '未決の開発依頼が 1 件あります',
    });
    expect(confirm.textContent).toContain('断ったことになります');
    expect(confirm.textContent).toContain('会員向けの個人化');
    // 提案を選ぶ: 進まずに、提案の行へ戻る
    fireEvent.click(
      within(confirm).getByRole('button', { name: '開発依頼を選ぶ' }),
    );
    expect(declineConfirm()).toBeNull();
    monthHeading(m);
    const row = document.querySelector<HTMLElement>(
      '[data-proposal-choice="p-personal"]',
    )!;
    expect(row.contains(document.activeElement)).toBe(true);
    // 選ぶまでは受ける・断るのどちらにも印が無い
    expect(
      within(row)
        .getAllByRole<HTMLInputElement>('radio')
        .some((r) => r.checked),
    ).toBe(false);
    // もう一度押して、断って進む
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    confirm = declineConfirm()!;
    fireEvent.click(
      within(confirm).getByRole('button', { name: '断って進む' }),
    );
    expect(declineConfirm()).toBeNull();
    closeEventsIfOpen();
    monthHeading(m + 1);
  });

  it('W-86 提案に返事を選んであれば、確認なしで進む', async () => {
    const m = proposalMonth();
    await start();
    advance(m - 1);
    const row = document.querySelector<HTMLElement>(
      '[data-proposal-choice="p-personal"]',
    )!;
    fireEvent.click(within(row).getByRole('radio', { name: /^断る/ }));
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    expect(declineConfirm()).toBeNull();
    closeEventsIfOpen();
    monthHeading(m + 1);
  });

  it('W-87 提案が無い月は、確認なしで進む', async () => {
    await start();
    // 1〜2 か月目は提案を出さない（V-12）
    expect(document.querySelector('[data-proposal-choice]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    expect(declineConfirm()).toBeNull();
    closeEventsIfOpen();
    monthHeading(2);
  });
});
