// @vitest-environment jsdom
// 見積モードの画面の描画テスト（D-86・prd/05 §7）。構成・フレームワーク・テンプレート・PV を切り替えても例外が無く、
// 月の費用・比較表・費用の曲線が出ることだけを見る（金額は model.test.ts と game のテストが持つ）。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 画面を何度も描き直すので、CI の遅い実行環境では既定の 5 秒を超えることがある（D-87）。
vi.setConfig({ testTimeout: 30_000 });
import { renderApp, useSmokeEnv } from '../smoke.test-helpers.tsx';

useSmokeEnv();

const card = (title: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section')!;
const combo = (label: string) =>
  screen.getByRole('combobox', { name: new RegExp(`^${label}`) });

/** 月の費用・明細・比較表・費用の曲線が出ていることを見て、今の構成の名前を返す。 */
function expectEstimate(): string {
  const title = screen.getByRole('heading', { level: 2, name: /^月の費用: / });
  expect(
    within(card(/^月の費用: /)).getByText(/^\$[\d,]+\.\d\d$/),
  ).toBeDefined();
  expect(
    within(card('明細（事業者・メーターごと）')).getAllByRole('row').length,
  ).toBeGreaterThan(1);
  const compare = within(card('構成を比べる'));
  // 見出しの行 + 載せられる構成（2 つ以上）。今の構成の行が 1 つだけ印される
  expect(compare.getAllByRole('row').length).toBeGreaterThan(2);
  expect(
    compare
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'true'),
  ).toHaveLength(1);
  const curve = within(card('費用の曲線（月の PV を振る）'));
  const chart = curve.getByRole('img', {
    name: '月の PV ごとの月額（構成ごと）',
  });
  expect(chart.querySelectorAll('path').length).toBeGreaterThan(0);
  return title.textContent!.replace(/^月の費用: /, '');
}

describe('見積モードの画面', () => {
  it('W-05 見積を描き、構成・フレームワーク・テンプレート・PV を切り替える', () => {
    renderApp();
    fireEvent.click(screen.getByRole('tab', { name: '見積' }));
    const first = expectEstimate();

    // 構成を切り替える（選べる構成をすべて回す）
    const stacks = within(combo('構成')).getAllByRole('option');
    expect(stacks.length).toBeGreaterThan(5);
    const names = new Set([first]);
    for (const o of stacks) {
      fireEvent.change(combo('構成'), {
        target: { value: (o as HTMLOptionElement).value },
      });
      names.add(expectEstimate());
    }
    expect(names.size).toBe(stacks.length);

    // 比較表の行を押すと、その構成の見積になる
    const compare = within(card('構成を比べる'));
    const other = compare
      .getAllByRole('button')
      .find(
        (b) => b.closest('td') && b.getAttribute('aria-current') !== 'true',
      )!;
    const picked = other.textContent;
    fireEvent.click(other);
    expectEstimate();
    const current = within(card('構成を比べる'))
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-current') === 'true')!;
    expect(current.textContent).toBe(picked);

    // フレームワーク・テンプレート・PV を切り替える
    for (const o of within(combo('フレームワーク')).getAllByRole('option')) {
      fireEvent.change(combo('フレームワーク'), {
        target: { value: (o as HTMLOptionElement).value },
      });
      expectEstimate();
    }
    fireEvent.change(combo('テンプレート'), { target: { value: 'business' } });
    expectEstimate();
    fireEvent.click(screen.getByRole('button', { name: '10M' }));
    expectEstimate();

    // 入力は URL に残り、その URL で開き直すと同じ条件の見積になる（共有のため）
    expect(window.location.search).toContain('t=business');
    const name = expectEstimate();
    cleanup();
    renderApp();
    expect((combo('テンプレート') as HTMLSelectElement).value).toBe('business');
    expect(expectEstimate()).toBe(name);
  });

  it('W-06 選んでも変わらない部品は出さない（D1 の構成に DB のバックアップの欄が無い。始める画面と同じ判定。D-94）', () => {
    const partSelect = (label: string) =>
      screen.queryByRole<HTMLSelectElement>('combobox', { name: label });
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=cloudflare-vinext-paid&c.dbBackup=pitr',
    );
    renderApp();
    expectEstimate();
    expect(partSelect('DB のバックアップ')).toBe(null);
    // URL に残っていた値は無視して既定にする（URL からも消える）
    expect(window.location.search).not.toContain('dbBackup');

    // 選べば変わる DB（Supabase Pro）に替えると出る
    fireEvent.change(combo('構成'), {
      target: { value: 'vercel-supabase-pro' },
    });
    expectEstimate();
    expect(partSelect('DB のバックアップ')?.value).toBe('default');
  });

  it('W-07 見出しに ⓘ のある欄の select は、見出しの文字だけを名前に持つ（ボタンの名前が混ざらない。D-94）', () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=vercel-supabase-pro',
    );
    renderApp();
    expectEstimate();
    // 部品の欄（DB のバックアップ）と、ⓘ のある条件の欄（構成）を、見出しの文字そのもので取れる
    const backup = screen.getByRole('combobox', { name: 'DB のバックアップ' });
    expect(backup.tagName).toBe('SELECT');
    expect(screen.getByRole('combobox', { name: '構成' }).tagName).toBe(
      'SELECT',
    );
  });
});
