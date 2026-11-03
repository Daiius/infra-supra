// @vitest-environment jsdom
// ⓘ の当たり判定（画面の描画テスト。D-86）。select の欄を label で包むと、label の中で最初の操作できる要素が ⓘ のボタンになり、
// 欄のどこを押しても説明が開いていた。欄の見出し・余白を押しても開かず、ⓘ を押したときだけ開き、select は選べることを見る。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, startGame, useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

const tooltip = () => screen.queryByRole('tooltip');

/**
 * select の欄（select と見出し・ⓘ を含む要素）で、見出し・余白・ⓘ・select を順に操作する。
 * 選び替えられる選択肢があれば選んで true を返す（今は他の選択肢が選べない欄もある）。
 */
function checkField(select: HTMLSelectElement): boolean {
  const field = select.parentElement!;
  expect(within(field).getAllByRole('combobox')).toEqual([select]);
  // 欄の余白（外側の要素そのもの）と見出しの文字を押しても、説明は開かない
  fireEvent.click(field);
  expect(tooltip()).toBeNull();
  fireEvent.click(field.firstElementChild!);
  expect(tooltip()).toBeNull();
  fireEvent.click(field.firstElementChild!.firstElementChild!);
  expect(tooltip()).toBeNull();
  // ⓘ を押すと開き、もう一度押すと閉じる
  const info = within(field).getByRole('button', { name: /説明$/ });
  fireEvent.click(info);
  expect(tooltip()).not.toBeNull();
  fireEvent.click(info);
  expect(tooltip()).toBeNull();
  // select は選べる
  const next = Array.from(select.options).find(
    (o) => !o.disabled && o.value !== select.value,
  );
  if (!next) return false;
  fireEvent.change(select, { target: { value: next.value } });
  expect(select.value).toBe(next.value);
  expect(tooltip()).toBeNull();
  return true;
}

describe('ⓘ の当たり判定', () => {
  it('W-09 今月の行動の設定・部品の欄は、ⓘ を押したときだけ説明が開く', async () => {
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
      parts: {
        'ISR のキャッシュ': 'KV',
        画像: 'Images（閲覧のときに変換）',
        DB: 'D1',
      },
    });
    // 設定の欄（ISR の再検証など）と部品の欄（DB など）。名前は select の aria-label
    const selects = screen.getAllByRole<HTMLSelectElement>('combobox');
    expect(selects.length).toBeGreaterThan(1);
    let changed = 0;
    for (const s of selects) if (!s.disabled && checkField(s)) changed++;
    expect(changed).toBeGreaterThan(0);
  });

  it('W-10 見積モードの欄は、見出しで select に結ばれ、ⓘ を押したときだけ説明が開く', async () => {
    // ⓘ のある部品の欄（DB のバックアップ）が出る構成
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=vercel-supabase-pro',
    );
    await renderApp();
    const backup = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'DB のバックアップ',
    });
    expect(checkField(backup)).toBe(true);
    // 見出しの文字（label）を押しても説明は開かない
    fireEvent.click(
      screen.getByText('DB のバックアップ', { selector: 'label' }),
    );
    expect(tooltip()).toBeNull();
    // ⓘ の付いた input も、見出しの文字だけが名前になる
    expect(screen.getByRole('spinbutton', { name: '月の PV' })).toBeDefined();
  });

  it('W-11 始める画面のフレームワークのカードは、ⓘ を押しても選ばれず、カードの文字を押すと選ばれる', async () => {
    await renderApp();
    // 選ばれていないフレームワークのカード（ⓘ のあるもの。D-102 でタブ + カードにした）
    const radio = screen
      .getAllByRole<HTMLInputElement>('radio')
      .find((r) => r.name === 'framework' && !r.checked)!;
    const name = radio.closest('label')!.textContent!.replace(/^export/, '');
    const card = screen.getByRole('region', { name: `${name} の説明` });
    fireEvent.click(within(card).getByRole('button', { name: /説明$/ }));
    expect(tooltip()).not.toBeNull();
    expect(radio.checked).toBe(false);
    // 説明の中（ポータル）を押しても選ばれない（OCL-A1FCD9AC）
    fireEvent.click(tooltip()!);
    fireEvent.click(tooltip()!.querySelector('*') ?? tooltip()!);
    expect(radio.checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    fireEvent.click(card.querySelector('p, li')!);
    expect(radio.checked).toBe(true);
    expect(tooltip()).toBeNull();
  });
});
