// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 画面を何度も描き直すので、CI の遅い実行環境では既定の 5 秒を超えることがある（D-87）。
vi.setConfig({ testTimeout: 30_000 });
import {
  advance,
  expectGameScreen,
  monthHeading,
  renderApp,
  startGame,
  useSmokeEnv,
  type Setup,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const ARTICLE = '記事コミュニティ';
const CONTRACT = '受託先の業務アプリの運用';

describe('ゲームモードの画面', () => {
  it('W-01 記事コミュニティ × Next.js × CF Paid で始めて 3 か月進める', () => {
    renderApp();
    // 始める画面: シナリオ・フレームワーク・構成・部品の選択肢が出る
    expect(screen.getAllByRole('radio', { name: /^Cloudflare/ }).length).toBe(
      2,
    );
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
      parts: {
        'ISR のキャッシュ': 'KV',
        画像: 'Images（閲覧のときに変換）',
        DB: 'D1',
      },
    });
    expectGameScreen(1);
    advance(3);
    expectGameScreen(4);
    expect(screen.getByRole('button', { name: '次の月へ' })).toBeDefined();
  });

  const combos: [string, Setup][] = [
    [
      'SPA × AWS（Amplify）',
      {
        scenario: ARTICLE,
        framework: 'Vite（SPA）+ API',
        stack: 'AWS（Amplify Hosting）',
        // 「最適化しない」（最初の選択肢）は 1 か月目に所持金が尽きる（CloudFront の転送）ので縮めて置く
        parts: { 画像: '投稿のときに一律で縮めて置く' },
      },
    ],
    [
      'Astro × Vercel Pro',
      {
        scenario: ARTICLE,
        framework: 'Astro',
        stack: 'Vercel Pro + Supabase Pro',
      },
    ],
    [
      // Netlify は隠した（D-100）ので Cloudflare Paid で回す
      '静的書き出し × Cloudflare Paid',
      {
        scenario: ARTICLE,
        framework: 'Next.js（静的書き出し）',
        stack: 'Cloudflare Paid',
      },
    ],
    [
      '受託 × さくらの VPS 2GB',
      {
        scenario: CONTRACT,
        framework: 'Next.js（App Router）',
        stack: 'さくらの VPS 2GB（東京）',
      },
    ],
  ];
  it.each(combos)('W-02 %s で始めて 1 か月進める', (_, setup) => {
    renderApp();
    startGame(setup);
    expectGameScreen(1);
    advance(1);
    expectGameScreen(2);
  });

  // 前は Astro × Netlify Personal（3 か月目に尽きる）。Netlify は隠した（D-100）ので、1 か月目に尽きる組にした
  it('W-03 所持金が尽きる組（静的書き出し × Vercel Pro・画像を最適化しない）で結果の画面とヒントが出る', () => {
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（静的書き出し）',
      stack: 'Vercel Pro + Supabase Pro',
    });
    expect(screen.getByText('所持金が尽きた')).toBeDefined();
    expect(screen.getByText(/1 か月目で終了/)).toBeDefined();
    const hints = screen
      .getByRole('heading', { name: '次のプレイへのヒント' })
      .closest('section')!;
    expect(within(hints).getAllByRole('listitem').length).toBeGreaterThan(0);
    // 終わった後は進められない
    expect(screen.queryByRole('button', { name: '次の月へ' })).toBeNull();
  });

  it('W-05 Astro × CF Free: 1 リクエストの CPU の上限に当たるルートを、始める画面と月の報告に出す（D-99。D-103 で記事のページも描き直しの閲覧が当たる）', () => {
    const detail =
      '記事のページ（ISR の閲覧と再生成・CPU 17 ms）・個人向けのページ（SSR・CPU 15 ms）が Workers Free の 1 リクエスト 10 ms を超える';
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Astro',
      stack: 'Cloudflare Free',
      // 始める画面の 1 か月目の見込みに、当たる上限とルートが出る
      beforeStart: () => expect(document.body.textContent).toContain(detail),
    });
    advance(1);
    // 月の報告の前提（SSR の CPU は開発が進むと重くなるので、数値は見ない）
    expect(document.body.textContent).toMatch(
      /記事のページ（ISR の閲覧と再生成・CPU [\d.]+ ms）・個人向けのページ（SSR・CPU [\d.]+ ms）が Workers Free の 1 リクエスト 10 ms を超える/,
    );
  });

  it('W-06 始める画面: 記事コミュニティの前提・ページの一覧と、フレームワークごとのページの描き方が出る（D-101）', () => {
    renderApp();
    const text = document.body.textContent ?? '';
    expect(text).toContain('別の CMS は無い');
    expect(text).toContain('一覧・トップのページは記事のページに含めて数える');
    // 中央のカードに、選んでいるフレームワークのページごとの描き方が出る（D-102 でカルーセルにした）
    const card = (fw: string) =>
      screen.getByRole('region', { name: `${fw} の説明` }).textContent ?? '';
    expect(card('Next.js（App Router）')).toContain('ISR（最初の閲覧で描いて');
    fireEvent.click(screen.getByRole('button', { name: /^次の選択肢/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Astro/ }));
    expect(card('Astro')).toContain(
      'アダプターで SSR（閲覧のたびにサーバーが描く。Cloudflare では Worker が描くので、1 リクエストの CPU の上限に注意）',
    );
    // 隠した構成（D-100）は構成の一覧に出ない
    expect(
      screen.queryByRole('radio', { name: /^Netlify|^AWS（OpenNext）/ }),
    ).toBeNull();
  });

  it('W-07 始める画面: ページの見取り図の札が、フレームワークとコメントの描き方で変わる（D-102）', () => {
    renderApp();
    const pick = (name: RegExp) =>
      fireEvent.click(screen.getByRole('radio', { name }));
    /** 見取り図の区画の札（区画の名前 → 作られ方の札の文字）。 */
    /** 選んでいるカード（前後のカードも同じ中身で並ぶので、選んでいるものに絞る）。 */
    const current = () =>
      document.querySelector<HTMLElement>('section[aria-current="true"]')!;
    const tag = (page: string, region: string) => {
      const list = within(current()).getByRole('list', {
        name: `${page}の見取り図`,
      });
      const cell = within(list).getByText(region).closest('li');
      return cell?.textContent?.replace(region, '').replace(/^: /, '');
    };
    pick(/^記事コミュニティ/);
    pick(/^Next\.js（App Router）/);
    // ロゴ（D-102）: simple-icons にあるものは SVG、無いもの（AWS・さくら）は頭文字のバッジ
    const labelOf = (name: RegExp) =>
      screen.getByRole('radio', { name }).closest('label')!;
    expect(
      labelOf(/^Next\.js（App Router）/).querySelector(
        'svg[data-brand="nextjs"]',
      ),
    ).not.toBeNull();
    expect(
      labelOf(/^Cloudflare Paid/).querySelector('svg[data-brand="cloudflare"]'),
    ).not.toBeNull();
    const aws = labelOf(/^AWS（Amplify Hosting）/).querySelector(
      '[data-brand="aws"]',
    );
    expect(aws?.getAttribute('data-fallback')).toBe('monogram');
    expect(aws?.textContent).toBe('AWS');
    expect(
      labelOf(/^さくらの VPS 2GB/).querySelector(
        '[data-brand="sakura"][data-fallback="monogram"]',
      ),
    ).not.toBeNull();
    // 選んでいるカードが印つきで、前後のカードも同じ中身で読める
    expect(current().getAttribute('aria-label')).toBe(
      'Next.js（App Router） の説明',
    );
    expect(
      within(screen.getByRole('region', { name: 'Astro の説明' })).getByRole(
        'list',
        { name: '記事のページの見取り図' },
      ),
    ).toBeDefined();
    expect(tag('記事のページ', '本文')).toBe('ISR（キャッシュ）');
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'ブラウザが API で取る',
    );
    expect(tag('個人向けのページ', '自分の下書き・記事の一覧')).toBe(
      '閲覧ごとに SSR',
    );
    // コメントを記事のページに含めると、コメント欄は ISR のページの一部になる（D-82）
    pick(/^記事のページに含める/);
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'ISR（キャッシュ）',
    );
    pick(/^ブラウザで読み込む/);

    // Astro の記事は閲覧時に SSR + キャッシュ（投稿で消す。D-103）
    pick(/^Astro/);
    expect(tag('記事のページ', '本文')).toBe(
      '閲覧時に SSR + キャッシュ（投稿で消す）',
    );
    expect(tag('記事のページ', 'いいね')).toBe('アイランドが API で取る');
    expect(tag('個人向けのページ', '自分の下書き・記事の一覧')).toBe(
      '閲覧ごとに SSR',
    );
    pick(/^記事のページに含める/);
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      '閲覧時に SSR + キャッシュ（投稿で消す）',
    );

    pick(/^Next\.js（静的書き出し）/);
    expect(tag('個人向けのページ', 'ヘッダー・ナビ')).toBe('ビルドで静的');
    expect(tag('個人向けのページ', '通知')).toBe('ブラウザが API で取る');

    // SPA はコメントを含められない（設定が出ない）ので、コメント欄は API のまま
    pick(/^Vite（SPA）/);
    expect(tag('記事のページ', 'ヘッダー・ナビ')).toBe('シェル + JS');
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'ブラウザが API で取る',
    );
    // 凡例は文字で出る
    expect(
      within(
        within(current()).getByRole('list', { name: '見取り図の凡例' }),
      ).getByText('シェル + JS'),
    ).toBeDefined();

    // 前後のボタンでも選ぶ（並びは Next.js・SPA・Astro・静的書き出し）
    fireEvent.click(screen.getByRole('button', { name: /^次の選択肢/ }));
    expect(
      (screen.getByRole('radio', { name: /^Astro/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    // 選んでいないカードを押しても選ぶ
    fireEvent.click(
      within(
        screen.getByRole('region', { name: 'Next.js（静的書き出し） の説明' }),
      ).getByRole('heading', { level: 4 }),
    );
    expect(current().getAttribute('aria-label')).toBe(
      'Next.js（静的書き出し） の説明',
    );
    pick(/^Astro/);
    // ページの札（CPU の注意）
    expect(
      within(
        within(current()).getByRole('region', { name: '個人向けのページ' }),
      ).getByText(/^CPU: 閲覧ごとにサーバーが描く/),
    ).toBeDefined();

    // 受託: 業務の画面の 1 枚
    pick(/^受託先の業務アプリの運用/);
    pick(/^Next\.js（App Router）/);
    expect(tag('業務の画面', '一覧の表（申請・記録）')).toBe('閲覧ごとに SSR');
    expect(
      screen.queryByRole('list', { name: '記事のページの見取り図' }),
    ).toBeNull();
  });

  it('W-13 始める画面: ページの描き方を選び、行ごとの要件の判定・見取り図・カードの既定が変わる（D-106・D-107）', () => {
    renderApp();
    const pick = (name: RegExp) =>
      fireEvent.click(screen.getByRole('radio', { name }));
    const current = () =>
      document.querySelector<HTMLElement>('section[aria-current="true"]')!;
    const table = () =>
      within(screen.getByRole('region', { name: 'ページの描き方' })).getByRole(
        'table',
        { name: 'ページごとの描き方' },
      );
    const row = (route: string) =>
      table().querySelector<HTMLElement>(`tr[data-route="${route}"]`)!;
    const strategy = (route: string) =>
      row(route)
        .querySelector('[data-strategy]')!
        .getAttribute('data-strategy');
    const alternative = (route: string, s: string) =>
      row(route).querySelector(`[data-alternative="${s}"]`);
    const check = (route: string, c: string) =>
      row(route).querySelector(`[data-check="${c}"]`)?.getAttribute('data-ok');
    pick(/^記事コミュニティ/);
    pick(/^Astro/);
    pick(/^Cloudflare Free/);
    expect(strategy('article')).toBe('cached-purge');
    expect(strategy('personal')).toBe('ssr');
    expect(within(row('article')).getAllByText(/^S3/).length).toBeGreaterThan(
      0,
    );
    // カードには既定の描き方が短く出る
    expect(
      within(current()).getByRole('list', { name: '既定のページの描き方' }),
    ).toBeDefined();
    // 要件の判定: CF Free は 1 リクエスト 10 ms に、記事（再生成）も個人向けも当たる
    expect(check('article', 'cpu')).toBe('false');
    expect(check('personal', 'cpu')).toBe('false');
    expect(check('article', 'ogp')).toBe('true');
    // 個人向けのページに使い回す描き方は灰色（理由は ⓘ）、枠 + API は選べる
    expect(
      alternative('personal', 'cached-purge')?.getAttribute('data-available'),
    ).toBe('false');
    // 確かめていない描き方（S6）は出さない
    expect(alternative('personal', 'server-island')).toBeNull();
    // 個人向けを枠 + API（S5）にすると、その行は CPU の制限に当たらない
    fireEvent.click(
      within(row('personal')).getByRole('button', {
        name: /^個人向けのページを S5/,
      }),
    );
    expect(strategy('personal')).toBe('shell-api');
    expect(check('personal', 'cpu')).toBe('true');
    expect(
      within(row('personal')).getByText(/既定から変わっている/),
    ).toBeDefined();
    // 選んでいるカードの見取り図も枠 + API になる
    const list = within(current()).getByRole('list', {
      name: '個人向けのページの見取り図',
    });
    expect(
      [...list.querySelectorAll('[data-source]')].some(
        (x) => x.getAttribute('data-source') === 'api',
      ),
    ).toBe(true);
    // Google Cloud（Hosting の CDN）では消せないので、記事は期限で取り直す（選んだ個人向けの S5 は残る）
    pick(/^Google Cloud/);
    expect(strategy('article')).toBe('cached-ttl');
    expect(strategy('personal')).toBe('shell-api');
    expect(
      alternative('article', 'cached-purge')?.getAttribute('data-available'),
    ).toBe('false');
    // フレームワークを替えると既定に戻る。静的書き出しは S1/S5、SPA は S5/S5
    pick(/^Next\.js（静的書き出し）/);
    expect(strategy('article')).toBe('static-build');
    expect(strategy('personal')).toBe('shell-api');
    pick(/^Vite（SPA）/);
    expect(strategy('article')).toBe('shell-api');
  });

  it('W-14 ゲームの途中で個人向けのページの描き方を替える（手間 4・来月から。D-107）', () => {
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const select = () =>
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: '個人向けのページの描き方',
      });
    expect(select().value).toBe('ssr');
    fireEvent.change(select(), { target: { value: 'shell-api' } });
    expect(select().value).toBe('shell-api');
    advance(1);
    // 次の月の欄では、替えた描き方が「今」
    expect(select().value).toBe('shell-api');
    expect(
      within(select()).getByRole('option', { name: /（今）$/ }).textContent,
    ).toContain('S5');
  });

  it('W-12 始める画面のインフラの構成は、タブ・前後のボタン・カードで選べ、カードに構成図が出る（D-105）', () => {
    renderApp();
    fireEvent.click(screen.getByRole('radio', { name: /^記事コミュニティ/ }));
    fireEvent.click(
      screen.getByRole('radio', { name: /^Next\.js（App Router）/ }),
    );
    const stackRadios = () =>
      screen
        .getAllByRole<HTMLInputElement>('radio')
        .filter((r) => r.name === 'stack');
    const checked = () => stackRadios().find((r) => r.checked)!;
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    // 隠した構成（D-100）は出ず、どれにも推奨の印は無い
    expect(stackRadios().length).toBeGreaterThan(5);
    // タブで選ぶ
    fireEvent.click(screen.getByRole('radio', { name: /^Vercel Pro/ }));
    expect(checked().closest('label')!.textContent).toMatch(/^Vercel Pro/);
    expect(current().getAttribute('aria-label')).toMatch(/^Vercel Pro/);
    // 選んでいるカードに構成図（要約つきの図・凡例・読み上げ用の一覧）。Vercel と Supabase の枠に分かれる
    const diagram = within(current()).getByRole('img', { name: /^構成図: / });
    expect(diagram.querySelector('[data-group="vercel"]')).not.toBeNull();
    expect(diagram.querySelector('[data-group="supabase"]')).not.toBeNull();
    expect(
      within(current()).getByRole('list', { name: '構成図のつながり' })
        .textContent,
    ).toContain('閲覧者（ブラウザ） → Vercel CDN');
    const legend = within(current()).getByRole('list', {
      name: '構成図の流れの凡例',
    });
    const isr = within(legend).getByRole('button', { name: /^ISR のページ/ });
    expect(isr.textContent).toContain('記事のページ');
    fireEvent.click(isr);
    expect(isr.getAttribute('aria-pressed')).toBe('true');
    // 前後のボタンで選ぶ（フレームワークの欄の前後のボタンとは名前で分かれる）
    const before = checked().closest('label')!.textContent;
    fireEvent.click(screen.getByRole('button', { name: /^次の構成/ }));
    expect(checked().closest('label')!.textContent).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: /^前の構成/ }));
    // 選んでいないカード: ⓘ・凡例を押しても選ばれない
    const other = document.querySelector<HTMLElement>(
      'section[data-stack]:not([aria-current="true"])',
    )!;
    const otherName = other.getAttribute('aria-label')!.replace(/ の構成$/, '');
    const otherRadio = () =>
      stackRadios().find((r) => r.closest('label')!.textContent === otherName)!;
    expect(otherRadio().checked).toBe(false);
    fireEvent.click(within(other).getByRole('button', { name: /説明$/ }));
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.click(screen.queryByRole('tooltip')!);
    expect(otherRadio().checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(
        within(other).getByRole('list', { name: '構成図の流れの凡例' }),
      ).getAllByRole('button')[0]!,
    );
    expect(otherRadio().checked).toBe(false);
    // カードの文字を押すと選ぶ
    fireEvent.click(other.querySelector('p')!);
    expect(otherRadio().checked).toBe(true);
    expect(current()).toBe(other);
  });

  it('W-04 保存して読み込み直すと同じ月から再開する', () => {
    renderApp();
    startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(2);
    expectGameScreen(3);
    const before = historyText();
    // 画面を閉じて開き直す（保存は localStorage に残る）
    cleanup();
    renderApp();
    expectGameScreen(3);
    expect(monthHeading(3)).toBeDefined();
    expect(historyText()).toEqual(before);
    advance(1);
    expectGameScreen(4);
  });
});

const historyText = () =>
  within(
    screen
      .getByRole('heading', { name: 'これまでの運営' })
      .closest('.card-body') as HTMLElement,
  )
    .getAllByRole('row')
    .map((r) => r.textContent);
