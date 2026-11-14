// @vitest-environment jsdom
// ⓘ の説明のダイアログ（D-129。画面の描画テスト。D-86）。ⓘ を押すとモーダルのダイアログが開き、見出し（aria-labelledby）と中身が出る。
// 箇条は li で並び、Esc・×・背景で閉じてフォーカスが ⓘ に戻ることを、代表的な ⓘ で見る。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  infoDialog,
  renderApp,
  showFrameworkTab,
  showStackTab,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

/** ⓘ を押して、開いた説明のダイアログと見出しの文字を返す（見出しは aria-labelledby で結ばれている）。 */
function openInfo(button: HTMLElement) {
  expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  fireEvent.click(button);
  const d = infoDialog();
  expect(d, `${button.getAttribute('aria-label')} のダイアログ`).not.toBeNull();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  const heading = document.getElementById(d!.getAttribute('aria-labelledby')!);
  expect(heading?.tagName).toBe('H2');
  expect(d!.contains(heading)).toBe(true);
  const body = d!.querySelector<HTMLElement>('[data-info-body]')!;
  expect(body.textContent).not.toBe('');
  return { dialog: d!, heading: heading!.textContent, body };
}

describe('ⓘ の説明のダイアログ', () => {
  it('W-80 始める画面のフレームワークの ⓘ: 見出しに名前、「このシナリオでは」の箇条は li。Esc で閉じて ⓘ に戻る', async () => {
    await renderApp();
    showFrameworkTab();
    const radio = screen
      .getAllByRole<HTMLInputElement>('radio')
      .find((r) => r.name === 'framework')!;
    const name = radio.closest('label')!.textContent!.replace(/^export/, '');
    const wasChecked = radio.checked;
    const button = screen.getAllByRole('button', {
      name: `${name} の説明`,
    })[0]!;
    const { dialog, heading, body } = openInfo(button);
    expect(heading).toBe(name);
    expect(body.textContent).toContain('このシナリオでは');
    const items = within(body).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(li.tagName).toBe('LI');
    // 開いている間だけ描く（閉じた ⓘ のダイアログは DOM に無い）
    expect(document.querySelectorAll('dialog[data-info-dialog]').length).toBe(
      1,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog.isConnected).toBe(false);
    expect(infoDialog()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    // ⓘ はカードの選択を切り替えない
    expect(radio.checked).toBe(wasChecked);
  });

  it('W-81 始める画面の構成のカードの ⓘ: 前提の箇条は li。× で閉じ、背景を押しても閉じて ⓘ に戻る', async () => {
    await renderApp();
    showStackTab();
    const card = document.querySelector<HTMLElement>(
      'section[data-stack][aria-current="true"]',
    )!;
    const name = card.getAttribute('aria-label')!.replace(/ の構成$/, '');
    const button = within(card).getByRole('button', { name: `${name} の説明` });
    let { dialog, heading, body } = openInfo(button);
    expect(heading).toBe(name);
    // 短い説明はカードに出さず ⓘ の冒頭に。前提・図の注記は「詳しい説明を見る」を押すと出る（D-217）
    expect(card.querySelector('.card-body > p')).toBeNull();
    expect(body.querySelector('p')).not.toBeNull();
    expect(body.querySelector('[data-more-details]')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: '詳しい説明を見る' }),
    );
    expect(body.querySelector('[data-more-details]')).not.toBeNull();
    expect(within(body).queryAllByRole('listitem').length).toBeGreaterThan(0);
    for (const li of within(body).queryAllByRole('listitem'))
      expect(li.tagName).toBe('LI');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(infoDialog()).toBeNull();
    expect(document.activeElement).toBe(button);
    ({ dialog } = openInfo(button));
    fireEvent.click(
      within(dialog).getByRole('button', { name: '背景を押して閉じる' }),
    );
    expect(infoDialog()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('W-82 見積モード: 欄の ⓘ は見出しに欄の名前。設定の ⓘ の選択肢は dt / dd で並ぶ。画像の箱の吹き出しの中の ⓘ は、吹き出しを閉じずに開く', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-paid&c.isrCache=kv',
    );
    await renderApp();
    // 欄の ⓘ（1 つの長い文は段落のまま）
    const pv = screen.getByRole('spinbutton', { name: '月の PV' });
    const pvInfo = within(pv.parentElement!).getByRole('button', {
      name: '月の PV の説明',
    });
    const { heading } = openInfo(pvInfo);
    expect(heading).toBe('月の PV');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(pvInfo);
    // 描き方の設定の ⓘ: 「選択肢: 説明」は dt / dd
    showFrameworkTab();
    const isr = within(
      document.querySelector<HTMLElement>(
        'section[data-framework][aria-current="true"] section[data-route="article"]',
      )!,
    ).getByRole('group', { name: 'ISR の再検証' });
    const isrInfo = within(isr).getByRole('button', {
      name: 'ISR の再検証の説明',
    });
    const isrOpen = openInfo(isrInfo);
    expect(isrOpen.heading).toBe('ISR の再検証');
    const terms = isrOpen.body.querySelectorAll('dl dt');
    expect(terms.length).toBeGreaterThan(1);
    expect(isrOpen.body.querySelectorAll('dl dd').length).toBe(terms.length);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(isrInfo);
    // 構成図の画像の箱の吹き出し（部品の選択の UI。ダイアログにしない）の中の、画像の形式の ⓘ
    showStackTab();
    const stack = document.querySelector<HTMLElement>(
      'section[data-stack][aria-current="true"]',
    )!;
    const diagramTab = within(stack).queryByRole('button', {
      name: '構成図から選ぶ',
    });
    if (diagramTab) fireEvent.click(diagramTab);
    fireEvent.click(
      stack.querySelector<HTMLElement>('[data-slots~="images"] button')!,
    );
    const popover = screen.getByRole('dialog', { name: /を替える$/ });
    expect(popover.tagName).toBe('DIV');
    const format = within(popover).getByRole('group', { name: '画像の形式' });
    const formatInfo = within(format).getByRole('button', {
      name: '画像の形式の説明',
    });
    const { dialog, heading: h2 } = openInfo(formatInfo);
    expect(h2).toBe('画像の形式');
    // 吹き出しの中で押しても、吹き出しは閉じない（ダイアログは吹き出しの中に描く）
    fireEvent.pointerDown(dialog);
    expect(popover.isConnected).toBe(true);
    expect(popover.contains(dialog)).toBe(true);
    // Esc は説明のダイアログだけを閉じる（吹き出しは開いたまま）
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(infoDialog()).toBeNull();
    expect(popover.isConnected).toBe(true);
    expect(document.activeElement).toBe(formatInfo);
    // もう一度 Esc で吹き出しも閉じる
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popover.isConnected).toBe(false);
  });
});
