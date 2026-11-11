// @vitest-environment jsdom
// 外部のプレイで見つかった小さな不具合の回帰（描画テスト。D-86）: 「新しいゲーム」の確認・再開の知らせ・「−$0」・規約違反の強調。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advance,
  expectGameScreen,
  pickRadio,
  renderApp,
  restartFromHeader,
  showFrameworkTab,
  showStackTab,
  startGame,
  useSmokeEnv,
  waitLoaded,
  expectFixedChrome,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const SAVE_KEY = 'infra-supra:game-save';
const ARTICLE = '記事コミュニティ';

const start = () =>
  startGame({
    scenario: ARTICLE,
    framework: 'Next.js（App Router）',
    stack: 'Cloudflare Paid + vinext',
  });

const resumedToast = () =>
  document.querySelector<HTMLElement>('[data-resumed-toast]');

/** 丸めると 0 になる値に符号が付いた金額（「−$0」「+$0」「$-0.00」）。 */
const SIGNED_ZERO = /[−+-]\$0(?![\d,]|\.\d*[1-9])|\$-0(?![\d,]|\.\d*[1-9])/;

describe('小さな不具合の回帰', () => {
  it('「新しいゲーム」は確認のダイアログを出し、「やめる」なら続き、「新しく始める」で始める画面に戻る', async () => {
    await renderApp();
    await start();
    advance(1);
    fireEvent.click(screen.getByRole('button', { name: '新しいゲーム' }));
    const dialog = screen.getByRole('dialog', {
      name: '新しいゲームを始めますか？',
    });
    expect(dialog.textContent).toContain('今のプレイは途中で終わります');
    // やめる: 何も消えない
    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expectGameScreen(2);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    // 新しく始める: 保存を消して始める画面へ
    restartFromHeader();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: '運営を始める' })).toBeDefined();
    // 始める画面には「新しいゲーム」を出さない（確認も要らない）
    expect(screen.queryByRole('button', { name: '新しいゲーム' })).toBeNull();
  });

  it('リロードして再開したときだけ「前回の続き（n か月目）から再開しました」を一度出し、× で閉じる', async () => {
    await renderApp();
    await start();
    // 新しく始めたときは出さない
    expect(resumedToast()).toBeNull();
    advance(2);
    expect(resumedToast()).toBeNull();
    cleanup();
    await renderApp();
    expectGameScreen(3);
    expect(resumedToast()?.textContent).toContain(
      '前回の続き（3 か月目）から再開しました',
    );
    fireEvent.click(screen.getByRole('button', { name: '知らせを閉じる' }));
    expect(resumedToast()).toBeNull();
    // 月を進めても出し直さない
    advance(1);
    expect(resumedToast()).toBeNull();
    // 見積の画面へ切り替えて戻っても出し直さない（運営中の画面は作り直される。OCL-F453F189）
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
    expectGameScreen(4);
    expect(resumedToast()).toBeNull();
  });

  it('ページの描き方を比べる表の費用の差は、丸めると 0 なら「±$0」で、「−$0」「+$0」にしない', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    showFrameworkTab();
    pickRadio('Astro');
    showStackTab();
    pickRadio('Cloudflare Free');
    showFrameworkTab();
    const card = document.querySelector<HTMLElement>(
      'section[data-framework][aria-current="true"]',
    )!;
    fireEvent.click(within(card).getByRole('button', { name: '詳しく比べる' }));
    const dialog = screen.getByRole('dialog', {
      name: /^ページの描き方を比べる/,
    });
    // 見出しと × は固定し、表だけスクロールする（D-208）
    expectFixedChrome(dialog);
    // 小さい構成では描き方を替えても 1 か月目の費用が $1 未満しか変わらない（以前は「−$0」「+$0」と出ていた）
    expect(dialog.textContent).toContain('±$0');
    expect(dialog.textContent).not.toMatch(SIGNED_ZERO);
  });

  it('規約違反（Vercel Hobby の非商用）は、上限・制限の一覧の一番上に「規約違反」と原因のプランを出し、終わった後の振り返りにも原因のプランを出す', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Hobby + Supabase Free',
    });
    const list = screen
      .getByRole('heading', { name: 'プラットフォームの上限・制限' })
      .parentElement!.querySelector('ul')!;
    const first = list.querySelector('li')!;
    expect(first.hasAttribute('data-policy-violation')).toBe(true);
    expect(within(first).getByText('規約違反').className).toContain(
      'badge-error',
    );
    expect(first.querySelector('[data-policy-cause]')!.textContent).toBe(
      '原因: Vercel Hobby',
    );
    expect(first.textContent).toContain('非商用');
    // 指摘の翌月も違反したままならアカウント停止で終わる
    advance(1);
    expect(screen.queryByRole('button', { name: '次の月へ' })).toBeNull();
    const cause = document.querySelector<HTMLElement>(
      '[data-policy-cause-result]',
    )!;
    expect(cause).not.toBeNull();
    expect(cause.textContent).toContain('原因のプラン: Vercel Hobby');
    expect(cause.textContent).toContain('1 か月目に指摘を受けました');
  });
});

describe('ダイアログの箱の高さ（D-208）', () => {
  // vitest は CSS の import を空にするので、ファイルを直に読む
  const read = (rel: string) =>
    readFileSync(join(import.meta.dirname, rel), 'utf8');

  it('W-208 全部の .modal-box の高さの上限を styles.css で dvh 基準にする（vh を先に書いて上書き・層の外）', () => {
    const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const m = /(^|\n)\.modal-box \{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    const decls = m![2]!
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    expect(decls).toEqual([
      'max-height: calc(100vh - 2rem)',
      'max-height: calc(100dvh - 2rem)',
    ]);
    // 層の外（daisyUI の値より優先する）: 規則より前に開いたままの @layer が無い
    const before = css.slice(0, m!.index);
    expect(before).not.toContain('@layer');
    // 個別の上限は残さない（全部のダイアログに styles.css の上限が効く）
    const tsx = [
      ...readdirSync(import.meta.dirname, { recursive: true }),
    ].filter(
      (f): f is string =>
        typeof f === 'string' && f.endsWith('.tsx') && !f.includes('.test.'),
    );
    const boxes = tsx.flatMap((f) =>
      read(f)
        .split('\n')
        .filter((l) => l.includes('modal-box')),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(10);
    for (const l of boxes) expect(l).not.toMatch(/\bmax-h-/);
  });
});
