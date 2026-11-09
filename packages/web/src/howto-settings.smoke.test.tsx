// @vitest-environment jsdom
// 遊び方のダイアログ（D-146）と設定のダイアログ（D-147）の描画テスト（D-86）。
// useSmokeEnv は各テストの前に遊び方を見た扱いにするので、初回の動きを確かめるテストは記録を消してから描く。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { USD_JPY } from 'game';
import { HOWTO_PAGES, PREMISE_NOTE } from './howto-dialog.tsx';
import { HOWTO_SEEN_KEY } from './local-records.ts';
import {
  advance,
  renderApp,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const howto = () => screen.queryByRole('dialog', { name: '遊び方' });
const forgetHowto = () => localStorage.removeItem(HOWTO_SEEN_KEY);
const appKeys = (s: Storage) =>
  Array.from({ length: s.length }, (_, i) => s.key(i)!).filter((k) =>
    k.startsWith('infra-supra:'),
  );
const openSettings = () => {
  fireEvent.click(screen.getByRole('button', { name: '設定' }));
  return screen.getByRole('dialog', { name: '設定' });
};

describe('遊び方と設定', () => {
  it('W-88 初回はゲームモードで遊び方が自動で開き、全ページに図がある。「始める」で閉じると記録し、再読み込みでは開かない', async () => {
    forgetHowto();
    await renderApp();
    const d = howto()!;
    expect(d).not.toBeNull();
    // 1 ページ目に前置き（ゲームで、実際の開発より大幅に単純化）と料金の前提（時点・円の換算。D-173）
    const premise = d.querySelector('[data-howto-premise]')!.textContent;
    expect(premise).toContain(PREMISE_NOTE);
    expect(premise).toContain('2026-10-31');
    expect(premise).toContain(`1 USD = ${USD_JPY} 円`);
    expect(premise).toContain('障害の影響');
    const titles: string[] = [];
    for (let i = 0; i < HOWTO_PAGES.length; i++) {
      const page = d.querySelector<HTMLElement>('[data-howto-page]')!;
      expect(page.getAttribute('data-howto-page')).toBe(String(i + 1));
      titles.push(within(page).getByRole('heading', { level: 3 }).textContent!);
      // 各ページに図（アイコンの組み合わせ。画像は使わない）
      const fig = page.querySelector('[data-howto-figure]')!;
      expect(fig.querySelectorAll('svg').length).toBeGreaterThan(0);
      expect(fig.querySelector('img')).toBeNull();
      if (i < HOWTO_PAGES.length - 1)
        fireEvent.click(within(d).getByRole('button', { name: '次へ →' }));
    }
    expect(titles).toEqual(HOWTO_PAGES.map((p) => p.title));
    // 外部のプレイで分かりにくかった読み方に触れている
    fireEvent.click(within(d).getByRole('button', { name: /2 ページ目/ }));
    expect(d.textContent).toContain('残りを既定にする');
    fireEvent.click(within(d).getByRole('button', { name: /5 ページ目/ }));
    expect(d.textContent).toContain('毎月 手間 3 を 2 か月（合計 6）');
    fireEvent.click(within(d).getByRole('button', { name: /6 ページ目/ }));
    expect(d.textContent).toContain('✗ 上限に達した');
    expect(d.textContent).toContain('止まる上限に達する数 +1');
    fireEvent.click(within(d).getByRole('button', { name: /7 ページ目/ }));
    expect(localStorage.getItem(HOWTO_SEEN_KEY)).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: '始める' }));
    expect(howto()).toBeNull();
    expect(localStorage.getItem(HOWTO_SEEN_KEY)).not.toBeNull();
    // 再読み込み
    cleanup();
    await renderApp();
    expect(howto()).toBeNull();
    // 始める画面の下の前置きはやめ、遊び方の 1 ページ目だけにした（D-173）
    expect(document.querySelector('[data-premise-note]')).toBeNull();
  });

  it('W-89 × で閉じても見た扱いになる。壊れた記録は見ていない扱い', async () => {
    localStorage.setItem(HOWTO_SEEN_KEY, '{壊れた');
    await renderApp();
    const d = howto()!;
    expect(d).not.toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: '遊び方を閉じる' }));
    expect(howto()).toBeNull();
    cleanup();
    await renderApp();
    expect(howto()).toBeNull();
  });

  it('W-90 設定の「遊び方を見る」とヘッダーの「遊び方」で 1 ページ目から開く（最後のボタンは「閉じる」）', async () => {
    await renderApp();
    expect(howto()).toBeNull();
    const s = openSettings();
    fireEvent.click(within(s).getByRole('button', { name: '遊び方を見る' }));
    expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
    let d = howto()!;
    expect(
      d.querySelector('[data-howto-page]')!.getAttribute('data-howto-page'),
    ).toBe('1');
    fireEvent.click(
      within(d).getByRole('button', {
        name: `${HOWTO_PAGES.length} ページ目: ${HOWTO_PAGES.at(-1)!.title}`,
      }),
    );
    expect(within(d).queryByRole('button', { name: '始める' })).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: '閉じる' }));
    expect(howto()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '遊び方' }));
    d = howto()!;
    expect(
      d.querySelector('[data-howto-page]')!.getAttribute('data-howto-page'),
    ).toBe('1');
  });

  it('W-91 「ローカルの記録を消す」は確認の後に infra-supra: のキーを全部消し、始める画面に戻って遊び方が自動で開く', async () => {
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(1);
    sessionStorage.setItem('infra-supra:events-seen', 'x:1');
    localStorage.setItem('other-app:keep', '1');
    expect(appKeys(localStorage).length).toBeGreaterThan(1);
    // やめる: 何も消えない
    let s = openSettings();
    fireEvent.click(
      within(s).getByRole('button', { name: 'ローカルの記録を消す…' }),
    );
    expect(s.querySelector('[data-settings-confirm]')).not.toBeNull();
    fireEvent.click(within(s).getByRole('button', { name: 'やめる' }));
    expect(s.querySelector('[data-settings-confirm]')).toBeNull();
    fireEvent.click(within(s).getByRole('button', { name: '設定を閉じる' }));
    expect(localStorage.getItem('infra-supra:game-save')).not.toBeNull();
    // 消す
    s = openSettings();
    fireEvent.click(
      within(s).getByRole('button', { name: 'ローカルの記録を消す…' }),
    );
    fireEvent.click(within(s).getByRole('button', { name: '消す' }));
    expect(appKeys(localStorage)).toEqual([]);
    expect(appKeys(sessionStorage)).toEqual([]);
    expect(localStorage.getItem('other-app:keep')).toBe('1');
    // 始める画面に戻り、前回の構成も残っていない。遊び方が自動で開いている
    expect(screen.getByRole('button', { name: '運営を始める' })).toBeDefined();
    expect(
      screen.queryByRole('button', { name: /^前回の構成を選ぶ/ }),
    ).toBeNull();
    const d = howto()!;
    expect(d).not.toBeNull();
    fireEvent.click(
      within(d).getByRole('button', {
        name: `${HOWTO_PAGES.length} ページ目: ${HOWTO_PAGES.at(-1)!.title}`,
      }),
    );
    fireEvent.click(within(d).getByRole('button', { name: '始める' }));
    expect(appKeys(localStorage)).toEqual([HOWTO_SEEN_KEY]);
  });

  it('W-92 見積モードでは自動で開かず、ゲームのタブに移ったときに開く', async () => {
    forgetHowto();
    window.history.replaceState(null, '', '/?mode=estimate');
    await renderApp();
    expect(howto()).toBeNull();
    // 見積モードのヘッダーには遊び方の入口を出さない（設定からは開ける）
    expect(screen.queryByRole('button', { name: '遊び方' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'ゲーム' }));
    expect(howto()).not.toBeNull();
  });
});
