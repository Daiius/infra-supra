// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

/** 選んでいるフレームワークのカード（前後のカードも同じ中身で並ぶ。構成のカードより前にある）。 */
const fwCard = () =>
  document.querySelector<HTMLElement>('section[aria-current="true"]')!;
/** 選んでいるフレームワークのカードの、ページの欄（見取り図・描き方のチップ・札。D-112）。 */
const pageOf = (route: string) =>
  fwCard().querySelector<HTMLElement>(`section[data-route="${route}"]`)!;
/** ページの欄で選んでいる描き方。 */
const chosenOf = (route: string) =>
  pageOf(route)
    .querySelector('[data-selected="true"]')!
    .getAttribute('data-alternative');
/** ページの欄の描き方のチップを押す（名前は描き方の名前の前方一致。番号は出さない。D-112）。 */
const pickStrategy = (page: string, strategy: string) =>
  fireEvent.click(
    within(fwCard()).getByRole('button', {
      name: (n) => n.startsWith(`${page}を ${strategy}`),
    }),
  );

describe('ゲームモードの画面', () => {
  it('W-01 記事コミュニティ × Next.js × CF Paid で始めて 3 か月進める', async () => {
    await renderApp();
    // 始める画面: シナリオ・フレームワーク・構成・部品の選択肢が出る
    expect(screen.getAllByRole('radio', { name: /^Cloudflare/ }).length).toBe(
      2,
    );
    await startGame({
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
  it.each(combos)('W-02 %s で始めて 1 か月進める', async (_, setup) => {
    await renderApp();
    await startGame(setup);
    expectGameScreen(1);
    advance(1);
    expectGameScreen(2);
  });

  // 前は Astro × Netlify Personal（3 か月目に尽きる）。Netlify は隠した（D-100）ので、1 か月目に尽きる組にした
  it('W-03 所持金が尽きる組（静的書き出し × Vercel Pro・画像を最適化しない）で結果の画面とヒントが出る', async () => {
    await renderApp();
    await startGame({
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

  it('W-18 Astro × CF Free: 1 リクエストの CPU の上限に当たるルートを、始める画面と月の報告に出す（D-99。D-103 で記事のページも描き直しの閲覧が当たる）', async () => {
    const detail =
      '記事のページ（ISR の閲覧と再生成・CPU 17 ms）・個人向けのページ（SSR・CPU 15 ms）が Workers Free の 1 リクエスト 10 ms を超える';
    await renderApp();
    await startGame({
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

  it('W-19 始める画面: 記事コミュニティの前提・ページの一覧と、フレームワークごとのページの描き方が出る（D-101）', async () => {
    await renderApp();
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

  it('W-20 始める画面: ページの見取り図の札が、フレームワークとコメントの描き方で変わる（D-102）', async () => {
    await renderApp();
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
    // ロゴ（D-102）: simple-icons にあるものは SVG、無いもの（AWS・さくら）は頭文字のバッジ。構成は事業者の組の頭に出す（D-105 の補足）
    const labelOf = (name: RegExp) => {
      const r = screen.getByRole('radio', { name });
      return (r.closest('[data-tab-group]') ?? r.closest('label'))!;
    };
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
    // コメントを記事のページに含めると、コメント欄は ISR のページの一部になる（D-82）。
    // 選ぶのはフレームワークのカードの記事のページの欄（ページの部品。D-109・D-112）
    const inPage = screen.getByRole('radio', { name: /^記事のページに含める/ });
    expect(
      inPage.closest('section[data-route]')?.getAttribute('data-route'),
    ).toBe('article');
    expect(current().contains(inPage)).toBe(true);
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

  it('W-13 始める画面: フレームワークのカードのページの欄で描き方を選び、要件の札・隣の見取り図が変わる（D-106・D-107・D-112）', async () => {
    await renderApp();
    const pick = (name: RegExp) =>
      fireEvent.click(screen.getByRole('radio', { name }));
    const alternative = (route: string, s: string) =>
      pageOf(route).querySelector(`[data-alternative="${s}"]`);
    const check = (route: string, c: string) =>
      pageOf(route)
        .querySelector(`[data-check="${c}"]`)
        ?.getAttribute('data-ok');
    /** ページの欄の見取り図の作られ方。 */
    const sources = (route: string, label: string) =>
      [
        ...within(pageOf(route))
          .getByRole('list', { name: `${label}の見取り図` })
          .querySelectorAll('[data-source]'),
      ].map((x) => x.getAttribute('data-source'));
    pick(/^記事コミュニティ/);
    pick(/^Astro/);
    pick(/^Cloudflare Free/);
    // 始める画面には別の「ページの描き方」の欄（表）を置かない（D-112）
    expect(screen.queryByRole('region', { name: 'ページの描き方' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(chosenOf('article')).toBe('cached-purge');
    expect(chosenOf('personal')).toBe('ssr');
    // ページごとの組（名前つき）に、選んでいるものも含めて並び、選んでいるものは aria-pressed
    const group = within(pageOf('personal')).getByRole('group', {
      name: '個人向けのページの描き方',
    });
    expect(
      within(group)
        .getByRole('button', { name: '個人向けのページは 毎回描く（選択中）' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    // 描き方の番号（S1〜S6）は出さない（D-112）
    expect(fwCard().textContent).not.toMatch(/\bS[1-7]\b/);
    // 選んでいないカードは既定の描き方を読むだけ（押して選ぶボタンは無い）
    const next = screen.getByRole('region', {
      name: 'Next.js（App Router） の説明',
    });
    const nextGroup = within(next).getByRole('group', {
      name: '個人向けのページの描き方',
    });
    expect(
      within(nextGroup).queryAllByRole('button', { pressed: false }),
    ).toEqual([]);
    expect(nextGroup.querySelectorAll('[data-alternative]').length).toBe(1);
    // 要件の札: CF Free は 1 リクエスト 10 ms に、記事（再生成）も個人向けも当たる
    expect(check('article', 'cpu')).toBe('false');
    expect(check('personal', 'cpu')).toBe('false');
    expect(check('article', 'ogp')).toBe('true');
    // 個人向けのページに使い回す描き方は灰色（理由は ⓘ）、枠 + API・枠 + サーバーの島は選べる（D-108）
    expect(
      alternative('personal', 'cached-purge')?.getAttribute('data-available'),
    ).toBe('false');
    expect(
      within(pageOf('personal')).getByRole('button', {
        name: 'サーバーで描いてキャッシュ（更新で消す）が使えない理由',
      }),
    ).toBeDefined();
    expect(
      alternative('personal', 'server-island')?.getAttribute('data-available'),
    ).toBe('true');
    // 個人向けを枠 + API にすると、隣の見取り図が枠 + API になり、その行は CPU の制限に当たらない
    expect(sources('personal', '個人向けのページ')).toContain('ssr');
    pickStrategy('個人向けのページ', '枠 + ブラウザが API で取る');
    expect(chosenOf('personal')).toBe('shell-api');
    expect(sources('personal', '個人向けのページ')).toContain('api');
    expect(sources('personal', '個人向けのページ')).not.toContain('ssr');
    expect(check('personal', 'cpu')).toBe('true');
    // もとの描き方は選び直せるボタンとして残る
    expect(
      within(pageOf('personal'))
        .getByRole('button', { name: /^個人向けのページを 毎回描く/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      within(pageOf('personal')).getByText(/既定から変わっている/),
    ).toBeDefined();
    // Google Cloud（Hosting の CDN）では消せないので、記事は期限で取り直す（選んだ個人向けの枠 + API は残る）
    pick(/^Google Cloud/);
    expect(chosenOf('article')).toBe('cached-ttl');
    expect(chosenOf('personal')).toBe('shell-api');
    expect(
      alternative('article', 'cached-purge')?.getAttribute('data-available'),
    ).toBe('false');
    // フレームワークを替えると既定に戻る。静的書き出しは静的 / 枠 + API、SPA は枠 + API
    pick(/^Next\.js（静的書き出し）/);
    expect(chosenOf('article')).toBe('static-build');
    expect(chosenOf('personal')).toBe('shell-api');
    pick(/^Vite（SPA）/);
    expect(chosenOf('article')).toBe('shell-api');
  });

  it('W-27 始める画面: 「詳しく比べる」のダイアログに表を出し、表で選んでもカードに効く。閉じるとボタンへ戻る（D-112）', async () => {
    await renderApp();
    const pick = (name: RegExp) =>
      fireEvent.click(screen.getByRole('radio', { name }));
    pick(/^記事コミュニティ/);
    pick(/^Astro/);
    pick(/^Cloudflare Free/);
    expect(screen.queryByRole('dialog')).toBeNull();
    const open = within(fwCard()).getByRole('button', { name: '詳しく比べる' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', {
      name: 'ページの描き方を比べる（Astro）',
    });
    const table = within(dialog).getByRole('table', {
      name: 'ページごとの描き方',
    });
    expect(
      within(table).getByRole('columnheader', {
        name: '描き方（この構成で選べるもの）',
      }),
    ).toBeDefined();
    // 表には 1 か月目の費用の差が出る。番号は出さない
    expect(table.textContent).toMatch(/[+−]\$\d/);
    expect(table.textContent).not.toMatch(/\bS[1-7]\b/);
    // 表で選んでも、カードのチップと見取り図に効く（ダイアログは開いたまま）
    fireEvent.click(
      within(
        table.querySelector<HTMLElement>('tr[data-route="personal"]')!,
      ).getByRole('button', { name: /^個人向けのページを 枠 \+ サーバーの島/ }),
    );
    expect(chosenOf('personal')).toBe('server-island');
    expect(screen.getByRole('dialog')).toBe(dialog);
    // 閉じる（Esc は showModal のブラウザの動き。jsdom では閉じるのボタンで確かめる）
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      within(fwCard()).getByRole('button', { name: '詳しく比べる' }),
    );
  });

  it('W-24 始める画面: 個人向けのページを枠 + サーバーの島にすると、見取り図に島・構成図に島の流れが出る（D-108）', async () => {
    await renderApp();
    const pick = (name: RegExp) =>
      fireEvent.click(screen.getByRole('radio', { name }));
    pick(/^記事コミュニティ/);
    pick(/^Astro/);
    pick(/^Cloudflare Paid/);
    pickStrategy('個人向けのページ', '枠 + サーバーの島');
    expect(chosenOf('personal')).toBe('server-island');
    // 見取り図: 人ごとに違う区画は島、ほかは枠
    const list = within(pageOf('personal')).getByRole('list', {
      name: '個人向けのページの見取り図',
    });
    const sources = [...list.querySelectorAll('[data-source]')].map((x) =>
      x.getAttribute('data-source'),
    );
    expect(sources).toContain('server-island');
    expect(sources).toContain('island-shell');
    expect(sources).not.toContain('ssr');
    expect(
      within(list).getAllByText('サーバーの島（閲覧ごとに一部だけ描く）')
        .length,
    ).toBeGreaterThan(0);
    // 構成図の凡例に島の流れ（個人向けのページ）が出る
    const legends = screen.getAllByRole('list', {
      name: '構成図の流れの凡例',
    });
    expect(
      legends.some((l) =>
        within(l).queryByText(/^サーバーの島（閲覧ごとに一部だけ描く）/),
      ),
    ).toBe(true);
  });

  it('W-14 ゲームの途中で個人向けのページの描き方を替える（手間 4・来月から。D-107）', async () => {
    await renderApp();
    await startGame({
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
    ).toBe('枠 + ブラウザが API で取る（今）');
  });

  it('W-25 ゲームの途中で記事のページのコメント欄を替える（記事の行の部品・手間 2・来月から。D-109）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const part = () =>
      document.querySelector<HTMLElement>(
        '[data-route="article"] fieldset[data-part="comments"]',
      )!;
    const left = () =>
      screen.getByText(/来月の手間の残り/).textContent!.match(/(\d+) \//)![1];
    const before = Number(left());
    expect(
      within(part()).getByRole('radio', { name: /^ブラウザで読み込む（今）/ }),
    ).toBeDefined();
    fireEvent.click(
      within(part()).getByRole('radio', { name: /^記事のページに含める/ }),
    );
    expect(Number(left())).toBe(before - 2);
    advance(1);
    expect(
      within(part()).getByRole('radio', {
        name: /^記事のページに含める（今）/,
      }),
    ).toBeDefined();
  });

  it('W-15 ゲーム中の「今の構成図」も選んだ描き方で描く（記事を静的にしたビルドのノード。OCL-C9CD8783）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      beforeStart: () => pickStrategy('記事のページ', '静的（ビルドし直し）'),
    });
    const summary = screen.getByText('今の構成図');
    fireEvent.click(summary);
    const details = summary.closest('details')!;
    expect(details.querySelector('[data-side-node="build"]')).not.toBeNull();
  });

  it('W-16 構成・フレームワークを替える前に、既定に戻るページの描き方を知らせる（D-107 の補足）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      beforeStart: () => {
        pickStrategy('記事のページ', '静的（ビルドし直し）');
        // 始める画面: 選べる構成（さくらの VPS・vinext の S1 も出した CF。RS-15 の解除）のカードには出さない。
        // 選んでいない事業者のカードは、その事業者の最初のプランを出す（事業者ごとに 1 枚。D-105 の補足）
        for (const id of ['sakura-vps-2gb', 'cloudflare-vinext-free']) {
          const card = document.querySelector<HTMLElement>(
            `section[data-stack="${id}"]`,
          )!;
          expect(within(card).queryByRole('note')).toBeNull();
        }
        // フレームワークを替えると、選んだ描き方は既定に戻る
        const astro = screen.getByRole('region', { name: 'Astro の説明' });
        expect(within(astro).getByRole('note').textContent).toMatch(
          /^このフレームワークにすると、記事のページは「静的（ビルドし直し）」→「サーバーで描いてキャッシュ（更新で消す）」（既定）に戻る: /,
        );
      },
    });
    // ゲームの途中: 乗り換え・作り直しの選択肢に、替える前に出す。手間の表示は今までどおり
    const option = (re: RegExp) =>
      [...document.querySelectorAll('label')].find((l) =>
        re.test(l.textContent ?? ''),
      )!;
    const migrate = option(/^Cloudflare Paid \+ vinext.*へ乗り換える/);
    expect(within(migrate).queryByRole('note')).toBeNull();
    expect(migrate.textContent).toContain('か月');
    const rewrite = option(/^Astro に作り直す/);
    expect(within(rewrite).getByRole('note').textContent).toMatch(
      /^作り直すと、記事のページは「静的（ビルドし直し）」→「[^」]+」（既定）に戻る: 済んだ翌月から、描き方は新しいフレームワークの既定で始まる/,
    );
  });

  it('W-17 選んでいない構成のカードも、その構成で選べる描き方で描く（流れの凡例のページ。D-107 の補足・RS-15 の解除）', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: /^記事コミュニティ/ }));
    fireEvent.click(
      screen.getByRole('radio', { name: /^Next\.js（App Router）/ }),
    );
    // CF は Paid を選んでから離れる（選んでいない事業者のカードは最後に選んだプランを出す。D-105 の補足）
    fireEvent.click(screen.getByRole('radio', { name: /^Cloudflare Paid/ }));
    fireEvent.click(
      screen.getByRole('radio', { name: /^Vercel Pro \+ Supabase Pro/ }),
    );
    pickStrategy('記事のページ', '静的（ビルドし直し）');
    const lane = (stackId: string, label: string) =>
      within(
        document.querySelector<HTMLElement>(
          `section[data-stack="${stackId}"]`,
        )!,
      )
        .getAllByRole('button')
        .find((b) => b.textContent?.startsWith(label))?.textContent ?? '';
    // 選べる構成（Vercel）は S1 のまま: 記事のページは静的なページの流れ
    expect(lane('vercel-supabase-pro', '静的なページ')).toContain(
      '記事のページ',
    );
    // vinext でも S1 を選べるので、CF のカードも記事のページを静的なページの流れで描く（Worker を通る）
    expect(lane('cloudflare-vinext-paid', '静的なページ')).toContain(
      '記事のページ',
    );
    expect(lane('cloudflare-vinext-paid', 'ISR のページ')).not.toContain(
      '記事のページ',
    );
  });

  it('W-12 始める画面のインフラの構成は、タブ・前後のボタン・カードで選べ、カードに構成図が出る（D-105）', async () => {
    await renderApp();
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
    // カードは事業者ごとに 1 枚（D-105 の補足）
    expect(document.querySelectorAll('section[data-stack]').length).toBe(5);
    // タブで選ぶ
    fireEvent.click(screen.getByRole('radio', { name: /^Vercel Pro/ }));
    expect(checked().getAttribute('aria-label')).toMatch(/^Vercel Pro/);
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
    // 前後のボタンで選ぶ（フレームワークの欄の前後のボタンとは名前で分かれる）。カード（事業者）ごとに移る
    fireEvent.click(screen.getByRole('button', { name: /^次の構成/ }));
    expect(checked().getAttribute('aria-label')).toMatch(/^さくらの VPS 2GB/);
    fireEvent.click(screen.getByRole('button', { name: /^前の構成/ }));
    // 選んでいないカード: ⓘ・凡例を押しても選ばれない
    const other = document.querySelector<HTMLElement>(
      'section[data-stack]:not([aria-current="true"])',
    )!;
    const otherName = other.getAttribute('aria-label')!.replace(/ の構成$/, '');
    const otherRadio = () =>
      stackRadios().find((r) => r.getAttribute('aria-label') === otherName)!;
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

  it('W-21 始める画面のインフラの構成のタブは事業者ごとにまとまり、←/→ は組をまたいで全部の構成を順に移る（D-105 の補足）', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: /^記事コミュニティ/ }));
    fireEvent.click(
      screen.getByRole('radio', { name: /^Next\.js（App Router）/ }),
    );
    const group = screen.getByRole('radiogroup', { name: 'インフラの構成' });
    // 組ごとに、組の名前とプランのチップ（並びは構成の一覧の順）。1 つだけの事業者は事業者の名前だけ
    // ロゴ（aria-hidden）を除いた文字
    const text = (el: Element) => {
      const c = el.cloneNode(true) as Element;
      c.querySelectorAll('[aria-hidden]').forEach((h) => h.remove());
      return c.textContent;
    };
    const tabs = [
      ...group.querySelectorAll<HTMLElement>('[data-tab-group]'),
    ].map((g) => {
      // 1 つだけの事業者は枠で囲まず、チップ（label）そのものが組（枠とチップの線が二重にならない）
      if (g.tagName === 'LABEL') return [text(g), []];
      const chips = [...g.querySelectorAll('label')].map(text);
      expect(g.getAttribute('aria-label')).not.toBe(null);
      return [g.getAttribute('aria-label'), chips];
    });
    expect(tabs).toEqual([
      ['Cloudflare', ['Free', 'Paid']],
      ['Vercel', ['Hobby', 'Pro']],
      ['さくらインターネット', ['2GB', '4GB']],
      ['AWS', []],
      ['Google Cloud', []],
    ]);
    // 組の中の 2 つ以上のチップは名前つきの組で、ラジオは構成の名前で読める
    expect(
      within(screen.getByRole('group', { name: 'Vercel' }))
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Vercel Hobby + Supabase Free', 'Vercel Pro + Supabase Pro']);
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    const order = radios.map((r) => r.getAttribute('aria-label'));
    const checked = () =>
      radios.find((r) => r.checked)?.getAttribute('aria-label');
    const press = (key: string) => {
      fireEvent.keyDown(document.activeElement!, { key });
      // 選んだ構成にフォーカスが移り、中央のカードも替わる
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        checked(),
      );
      expect(
        document
          .querySelector('section[data-stack][aria-current="true"]')!
          .getAttribute('aria-label'),
      ).toBe(`${checked()} の構成`);
    };
    // Cloudflare Paid → → は組をまたいで Vercel Hobby、← で戻る
    fireEvent.click(screen.getByRole('radio', { name: /^Cloudflare Paid/ }));
    radios[1]!.focus();
    press('ArrowRight');
    expect(checked()).toBe('Vercel Hobby + Supabase Free');
    press('ArrowLeft');
    expect(checked()).toBe(order[1]);
    // 全部を → で順に移り、最後から最初に戻る
    const seen = [checked()];
    for (let i = 1; i < order.length; i++) {
      press('ArrowRight');
      seen.push(checked());
    }
    expect(seen).toEqual([...order.slice(1), order[0]]);
  });

  it('W-26 始める画面のインフラの構成: プランのチップはカードを動かさず中身を替え、事業者は最後に選んだプランで出る（D-105 の補足）', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: /^記事コミュニティ/ }));
    fireEvent.click(
      screen.getByRole('radio', { name: /^Next\.js（App Router）/ }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /^Cloudflare Free/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const card = current();
    const item = card.closest<HTMLElement>('[data-card]')!;
    expect(item.dataset.card).toBe('cloudflare');
    const diagram = within(card).getByRole('img', { name: /^構成図: / });
    // カルーセルの位置を動かしたかを数える（jsdom はレイアウトしないので scrollLeft の代入を見る）
    const track = item.closest<HTMLElement>('.carousel')!;
    let scrolls = 0;
    Object.defineProperty(track, 'scrollLeft', {
      configurable: true,
      get: () => 0,
      set: () => {
        scrolls++;
      },
    });
    const flavor = card.querySelector('p')!.textContent;
    // Free → Paid: 同じカード・同じ図の要素のまま、名前・説明・構成が替わる。カルーセルは動かさない
    fireEvent.click(screen.getByRole('radio', { name: /^Cloudflare Paid/ }));
    expect(current()).toBe(card);
    expect(card.closest('[data-card]')).toBe(item);
    expect(card.dataset.stack).toBe('cloudflare-vinext-paid');
    expect(card.getAttribute('aria-label')).toMatch(/^Cloudflare Paid/);
    expect(card.querySelector('p')!.textContent).not.toBe(flavor);
    expect(within(card).getByRole('img', { name: /^構成図: / })).toBe(diagram);
    expect(scrolls).toBe(0);
    // ほかの事業者へ移るとカルーセルが動き、CF のカードは最後に選んだ Paid のまま薄く出る
    fireEvent.click(screen.getByRole('radio', { name: /^Vercel Hobby/ }));
    expect(scrolls).toBe(1);
    expect(card.getAttribute('aria-current')).toBeNull();
    expect(card.dataset.stack).toBe('cloudflare-vinext-paid');
    // 選んでいない事業者のカードを押すと、そのカードに出ているプランを選ぶ
    fireEvent.click(card.querySelector('p')!);
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: /^Cloudflare Paid/ })
        .checked,
    ).toBe(true);
    // 前後のボタンは事業者ごとに移り、移った先の最後に選んだプランを選ぶ
    expect(
      screen
        .getByRole('button', { name: /^次の構成/ })
        .getAttribute('aria-label'),
    ).toMatch(/^次の構成（Vercel Hobby/);
    // 組の名前を押しても、その事業者の最後に選んだプランを選ぶ
    const sakura = screen.getByRole('group', { name: 'さくらインターネット' });
    fireEvent.click(sakura.querySelector('span[aria-hidden]')!);
    expect(current().dataset.stack).toBe('sakura-vps-2gb');
    // 説明（要約）に結ぶのは、カードに出ているプランのラジオだけ（出ていない要約の id を指さない）
    for (const r of screen
      .getAllByRole<HTMLInputElement>('radio')
      .filter((x) => x.name === 'stack')) {
      const d = r.getAttribute('aria-describedby');
      if (d) expect(document.getElementById(d)).not.toBeNull();
    }
  });

  it('W-04 保存して読み込み直すと同じ月から再開する', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(2);
    expectGameScreen(3);
    const before = historyText();
    // 画面を閉じて開き直す（保存は localStorage に残る）
    cleanup();
    await renderApp();
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
