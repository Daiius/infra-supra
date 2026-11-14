// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: ゲームの途中で構成・部品・描き方を変える欄（D-185）（App.smoke.test.tsx から分けた）。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useSmokeEnv,
  renderApp,
  pickRadio,
  showPartsView,
  showStackTab,
  showFrameworkTab,
  openSlot,
  startGame,
  slotGroup,
  setupChangeFold,
  openSetupChange,
  changeItems,
  registerSetupChange,
  nextMonth,
  advance,
  readEventPages,
  closeEventsDialog,
  ARTICLE,
  pageOf,
  chosenOf,
  pickStrategy,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
  it('W-14 ゲームの途中で個人向けのページの描き方を替える（構成を変えるの欄の ② のチップ・手間 4・来月から。D-107・D-185）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    openSetupChange();
    expect(chosenOf('personal')).toBe('ssr');
    pickStrategy('個人向けのページ', 'Client-side data fetching');
    expect(chosenOf('personal')).toBe('shell-api');
    // 内訳に行動の名前と手間
    const items = changeItems();
    expect(items.map((x) => x.getAttribute('data-change-kind'))).toEqual([
      'route',
    ]);
    expect(items[0]!.textContent).toMatch(
      /^個人向けのページを「[^」]+」に.*手間 4・来月から/,
    );
    registerSetupChange();
    expect(setupChangeFold().querySelector('summary')!.textContent).toMatch(
      /来月のアクション: 個人向けのページを「/,
    );
    advance(1);
    // 次の月の欄では、替えた描き方が「今」（欄は畳んだ状態から）
    expect(setupChangeFold().open).toBe(false);
    openSetupChange();
    expect(chosenOf('personal')).toBe('shell-api');
    expect(changeItems()).toEqual([]);
  });

  it('W-53 ゲームの途中の画像の形式: 最適化の部品（Vercel の next/image）では欄が無効で、固定の WebP を選択中として見せ、理由を出す（D-58 の補足・OCL-CAAEFA7D）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
    });
    const select = screen.getByRole<HTMLSelectElement>('combobox', {
      name: '画像の形式',
    });
    expect(select.disabled).toBe(true);
    // 保存した設定は JPEG のままだが、数えるのも見せるのも固定の WebP
    expect(select.value).toBe('105');
    // 選べない理由は選択肢の後ろに付く。保存した値（JPEG）には「（今）」を付けない
    expect(select.querySelector('option[value="105"]')!.textContent).toMatch(
      /^WebP（固定）（/,
    );
    expect(select.querySelector('option[value="150"]')!.textContent).toBe(
      'JPEG（そのまま）',
    );
    expect(
      screen.getByText(/^今は効かない: 画像の部品が「画像の最適化」なので/)
        .textContent,
    ).toContain('WebP');
  });

  it('W-25 ゲームの途中の「構成を変える」に、記事のページのコメント欄の選択は出ない（D-220。選ばせずブラウザで読み込む）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    openSetupChange();
    expect(
      pageOf('article').querySelector('li[data-part="comments"]'),
    ).toBeNull();
    expect(
      screen.queryByRole('radio', { name: /^記事のページに含める/ }),
    ).toBeNull();
  });

  it('W-15 ゲーム中の構成を変えるの欄の構成図も、今の描き方で描く（記事を静的にしたビルドのノード。OCL-C9CD8783・D-185）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      beforeStart: () => pickStrategy('記事のページ', 'Prerendering'),
    });
    openSetupChange();
    showPartsView('diagram');
    const card = setupChangeFold().querySelector<HTMLElement>(
      'section[data-stack][aria-current="true"]',
    )!;
    expect(card.getAttribute('data-stack')).toBe('vercel-supabase-pro');
    expect(card.querySelector('[data-side-node="build"]')).not.toBeNull();
  });

  it('W-57 構成を変えるの欄は畳んで出し、開くと今の状態が選ばれている。選び直すと内訳、登録すると見出しに要約、取り消せる。乗り換え中は欄を出さない（D-185）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
    });
    // 前の種類ごとの一覧は無い
    expect(screen.queryByText('構成の乗り換え・プラン変更')).toBeNull();
    expect(
      screen.queryByText('アプリの作り直し（フレームワークを替える）'),
    ).toBeNull();
    const fold = setupChangeFold();
    expect(fold.open).toBe(false);
    // 畳んでいる間は中身を描かない
    expect(fold.querySelector('[data-setup-tab-button]')).toBeNull();
    openSetupChange();
    // 今の構成・フレームワークが選ばれている。変更は無く、登録できない
    showStackTab();
    expect(
      within(fold).getByRole<HTMLInputElement>('radio', {
        name: /^Vercel Pro \+ Supabase Pro/,
      }).checked,
    ).toBe(true);
    showFrameworkTab();
    expect(
      within(fold).getByRole<HTMLInputElement>('radio', {
        name: /^Next\.js（App Router）/,
      }).checked,
    ).toBe(true);
    expect(fold.textContent).toContain('今の構成と同じです');
    expect(
      within(fold).getByRole<HTMLButtonElement>('button', {
        name: '来月のアクションにする',
      }).disabled,
    ).toBe(true);
    // 選び直すと内訳、登録すると見出しに要約
    showStackTab();
    pickRadio('Cloudflare Paid + vinext', fold);
    registerSetupChange();
    const summary = () => fold.querySelector('summary')!.textContent!;
    expect(summary()).toMatch(
      /来月のアクション: Cloudflare Paid \+ vinext.*へ乗り換える/,
    );
    // 取り消すと今の状態に戻り、要約も消える
    fireEvent.click(
      within(fold).getByRole('button', { name: '構成はこのまま' }),
    );
    expect(summary()).not.toContain('来月のアクション');
    expect(fold.textContent).toContain('今の構成と同じです');
    // 登録してから全体の「選択を戻す」を押すと、欄の選び直しも今の状態に戻る（OCL-E8982F9F）
    pickRadio('Cloudflare Paid + vinext', fold);
    registerSetupChange();
    fireEvent.click(screen.getByRole('button', { name: '選択を戻す' }));
    expect(
      setupChangeFold().querySelector('summary')!.textContent,
    ).not.toContain('来月のアクション');
    openSetupChange();
    expect(setupChangeFold().textContent).toContain('今の構成と同じです');
    // もう一度選んで登録し、次の月へ: 乗り換え中も欄は出し、見出しに進み具合を出す（OCL-0B7CAFEB）
    showStackTab();
    pickRadio('Cloudflare Paid + vinext', setupChangeFold());
    registerSetupChange();
    advance(1);
    const moving = setupChangeFold();
    expect(moving.querySelector('summary')!.textContent).toMatch(
      /へ乗り換え中（\d+ \/ \d+ ポイント）/,
    );
    openSetupChange();
    // ① の構成・部品は選べず、理由を出す
    showStackTab();
    expect(
      moving.querySelector('[data-migrating-note]')!.textContent,
    ).toContain('乗り換えの最中は選べません');
    expect(
      within(moving).queryAllByRole('radio', { name: /^Cloudflare/ }),
    ).toEqual([]);
    // ② は今のフレームワークだけ（作り直しは選べない）。描き方は選び直して登録できる
    showFrameworkTab();
    expect(within(moving).queryByRole('radio', { name: /^Astro/ })).toBeNull();
    pickStrategy('個人向けのページ', 'Client-side data fetching');
    expect(
      changeItems().map((x) => x.getAttribute('data-change-kind')),
    ).toEqual(['route']);
    registerSetupChange();
    advance(1);
    openSetupChange();
    expect(chosenOf('personal')).toBe('shell-api');
  });

  it('W-106 構成を変えるの欄で部品を差し替えると行動が送られ、乗り換えと作り直しの組み合わせはできない理由を出す（D-185）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
      parts: { 'ISR のキャッシュ': 'KV' },
    });
    const fold = openSetupChange();
    // 乗り換えと作り直しを一緒に選ぶと、作り直しの行に今の行動の検査の理由が出て、登録できない
    showStackTab();
    pickRadio('Vercel Pro + Supabase Pro', fold);
    showFrameworkTab();
    pickRadio('Astro', fold);
    const rewrite = changeItems().find(
      (x) => x.getAttribute('data-change-kind') === 'rewrite',
    )!;
    expect(rewrite.textContent).toContain(
      'できません: 乗り換えの最中は選べません',
    );
    expect(
      within(fold).getByRole<HTMLButtonElement>('button', {
        name: '来月のアクションにする',
      }).disabled,
    ).toBe(true);
    // 取り消して、今の構成のまま部品（ISR のキャッシュ）を差し替える
    fireEvent.click(
      within(fold).getByRole('button', { name: '構成はこのまま' }),
    );
    showPartsView('list');
    const row = openSlot(slotGroup('ISR のキャッシュ'));
    const other = within(row)
      .getAllByRole<HTMLButtonElement>('button', { pressed: false })
      .find(
        (b) =>
          !b.disabled &&
          !/説明$/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
      )!;
    fireEvent.click(other);
    const items = changeItems();
    expect(items.map((x) => x.getAttribute('data-change-kind'))).toEqual([
      'component',
    ]);
    expect(items[0]!.textContent).toMatch(/^ISR のキャッシュを.*に差し替える/);
    registerSetupChange();
    nextMonth();
    const dialog = screen.queryByRole('dialog');
    if (dialog) {
      readEventPages(dialog);
      closeEventsDialog(dialog);
    }
    // これまでの運営に、差し替えた行動が残る
    const history = screen
      .getByRole('heading', { name: 'これまでの運営' })
      .closest('.card-body') as HTMLElement;
    expect(history.textContent).toMatch(
      /ISR のキャッシュ: [^・]+に差し替えました/,
    );
  });
});
