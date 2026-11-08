// @vitest-environment jsdom
// ⓘ の当たり判定（画面の描画テスト。D-86）。select の欄を label で包むと、label の中で最初の操作できる要素が ⓘ のボタンになり、
// 欄のどこを押しても説明が開いていた。欄の見出し・余白を押しても開かず、ⓘ を押したときだけ開き、select は選べることを見る。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ensurePartsList,
  infoDialog,
  openSlot,
  renderApp,
  showFrameworkTab,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

/** ⓘ の説明のダイアログ（D-129）。 */
const tooltip = () => infoDialog();
/** 部品の ⓘ で開く比較のダイアログ（D-124）。 */
const compareDialog = () =>
  document.querySelector<HTMLElement>('dialog[data-slot-compare-dialog]');

/** ⓘ を押して説明が開き、閉じられる（部品の ⓘ は比較のダイアログ、ほかは説明のダイアログ。D-129）。 */
function toggleInfo(info: HTMLElement) {
  fireEvent.click(info);
  const compare = compareDialog();
  const d = compare ?? infoDialog();
  expect(d).not.toBeNull();
  if (compare) expect(infoDialog()).toBeNull();
  fireEvent.click(within(d!).getByRole('button', { name: '閉じる' }));
  expect(compareDialog()).toBeNull();
  expect(infoDialog()).toBeNull();
  expect(document.activeElement).toBe(info);
}

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
  // ⓘ を押すと開き、閉じられる（部品の欄は比較のダイアログ。D-124）
  toggleInfo(within(field).getByRole('button', { name: /説明$/ }));
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
        'ページのキャッシュ（ISR）': 'KV',
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

  it('W-10 見積モードの欄は、見出しで入力に結ばれ、ⓘ を押したときだけ説明が開く', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=vercel-supabase-pro',
    );
    await renderApp();
    // ⓘ の付いた input は、見出しの文字だけが名前になる
    const pv = screen.getByRole('spinbutton', { name: '月の PV' });
    const field = pv.parentElement!;
    // 欄の余白と見出しの文字（label）を押しても、説明は開かない
    fireEvent.click(field);
    expect(tooltip()).toBeNull();
    fireEvent.click(screen.getByText('月の PV', { selector: 'label' }));
    expect(tooltip()).toBeNull();
    // ⓘ を押すと開き、閉じられる
    toggleInfo(within(field).getByRole('button', { name: /説明$/ }));
    // 部品（DB のバックアップ）はゲームと共用の、構成のカードのチップ（D-115・D-116）。チップの ⓘ を押しても選ばない
    ensurePartsList();
    const backup = openSlot(
      screen.getByRole('group', { name: /^DB のバックアップ/ }),
    );
    const other = within(backup)
      .getAllByRole<HTMLButtonElement>('button', { pressed: false })
      .find((b) => !b.disabled)!;
    const chip = other.closest('li')!;
    // チップの ⓘ は、そのスロットの比較のダイアログ（D-124）
    toggleInfo(within(chip).getByRole('button', { name: /説明$/ }));
    expect(other.getAttribute('aria-pressed')).toBe('false');
    const label = other.textContent!;
    fireEvent.click(other);
    // 選ぶと行は畳まれ、選んだ部品の名前が残る（D-116 の補足）
    expect(
      screen
        .getByRole('group', { name: /^DB のバックアップ/ })
        .querySelector('[data-selected="true"]')!.textContent,
    ).toContain(label);
  });

  it('W-11 始める画面のフレームワークのカードは、ⓘ を押しても選ばれず、カードの文字を押すと選ばれる', async () => {
    await renderApp();
    // ② フレームワークの欄はタブで開く（D-116 の補足）
    showFrameworkTab();
    // 選ばれていないフレームワークのカード（ⓘ のあるもの。D-102 でタブ + カードにした）
    const radio = screen
      .getAllByRole<HTMLInputElement>('radio')
      .find((r) => r.name === 'framework' && !r.checked)!;
    const name = radio.closest('label')!.textContent!.replace(/^export/, '');
    const card = screen.getByRole('region', { name: `${name} の説明` });
    fireEvent.click(
      within(card).getByRole('button', { name: `${name} の説明` }),
    );
    expect(tooltip()).not.toBeNull();
    expect(radio.checked).toBe(false);
    // 説明の中（ポータル）を押しても選ばれない（OCL-A1FCD9AC）
    fireEvent.click(tooltip()!);
    fireEvent.click(
      tooltip()!.querySelector('[data-info-body] *') ?? tooltip()!,
    );
    expect(radio.checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    fireEvent.click(card.querySelector('p, li')!);
    expect(radio.checked).toBe(true);
    expect(tooltip()).toBeNull();
  });
});
