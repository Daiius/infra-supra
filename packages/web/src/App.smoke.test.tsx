// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { LAST_SETUP_KEY } from './last-setup.ts';
import { ARTICLE_COMMUNITY, rollSchedule } from 'game';
import { describe, expect, it, vi } from 'vitest';
import {
  advance,
  closeEventsDialog,
  eventPosition,
  expectGameScreen,
  monthHeading,
  openSlot,
  pickPart,
  pickRadio,
  renderApp,
  showFrameworkTab,
  showPartsView,
  showStackTab,
  slotGroup,
  startGame,
  useSmokeEnv,
  waitLoaded,
  type Setup,
  getRadio,
  readEventPages,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

const ARTICLE = '記事コミュニティ';
/** 「前回の構成を選ぶ」（D-127）。出ていなければ null。 */
const lastButton = () =>
  document.querySelector<HTMLButtonElement>('[data-last-setup] button');
const CONTRACT = '受託先の業務アプリの運用';

/** 選んでいるフレームワークのカード（前後のカードも同じ中身で並ぶ。D-113 で構成のカードの後ろに移した）。 */
const fwCard = () => {
  // ② はタブで出す（D-116 の補足）ので、開いてから引く
  showFrameworkTab();
  return document.querySelector<HTMLElement>(
    'section[data-framework][aria-current="true"]',
  )!;
};
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
  it('W-46 Vercel Pro の ① の部品に「CDN の料金のプラン」（Flat Rate CDN・On-demand CDN）が出て、Hobby には出ない（D-120）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    pickRadio('Vercel Pro + Supabase Pro');
    const row = slotGroup('CDN の料金のプラン');
    expect(
      within(row).getAllByRole('button', {
        name: /^Flat Rate CDN（段の定額・既定）/,
      }).length,
    ).toBeGreaterThan(0);
    pickPart('On-demand CDN（従量）', row);
    pickRadio('Vercel Hobby + Supabase Free');
    expect(
      document.querySelector('section[data-parts] [data-slot="cdnPlan"]'),
    ).toBeNull();
  });

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
      // 画像の原本の配信（Blob Data Transfer）を従量で払う（既定の Flat Rate CDN では段に込み。D-120）
      parts: { 'CDN の料金のプラン': 'On-demand CDN（従量）' },
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
    // 中央のカードに、選んでいるフレームワークのページごとの描き方が出る（D-102 でカルーセルにした）。② はタブで開く（D-116 の補足）
    showFrameworkTab();
    const card = (fw: string) =>
      screen.getByRole('region', { name: `${fw} の説明` }).textContent ?? '';
    expect(card('Next.js（App Router）')).toContain('ISR（最初の閲覧で描いて');
    fireEvent.click(screen.getByRole('button', { name: /^次の選択肢/ }));
    fireEvent.click(getRadio({ name: /^Astro/ }));
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
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    /** 見取り図の区画の札（区画の名前 → 作られ方の札の文字）。 */
    /** 選んでいるカード（前後のカードも同じ中身で並ぶので、選んでいるものに絞る）。 */
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-framework][aria-current="true"]',
      )!;
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
      const r = getRadio({ name });
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
    showFrameworkTab();
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
    const inPage = getRadio({ name: /^記事のページに含める/ });
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
    expect((getRadio({ name: /^Astro/ }) as HTMLInputElement).checked).toBe(
      true,
    );
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
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
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
    /** ページの欄の説明の行と札（描き方に合わせる。D-112）。 */
    const lines = (route: string, label: string) =>
      within(pageOf(route)).getByRole('list', { name: `${label}の説明` })
        .textContent ?? '';
    const badges = (route: string) =>
      within(pageOf(route)).getByRole('list', { name: 'ページの札' })
        .textContent ?? '';
    // 既定のままはフレームワークの説明
    expect(lines('personal', '個人向けのページ')).toContain('アダプターで SSR');
    expect(badges('personal')).toContain('CPU: 閲覧ごとにサーバーが描く');
    // 個人向けを枠 + API にすると、隣の見取り図が枠 + API になり、その行は CPU の制限に当たらない
    expect(sources('personal', '個人向けのページ')).toContain('ssr');
    pickStrategy('個人向けのページ', '枠 + ブラウザが API で取る');
    expect(chosenOf('personal')).toBe('shell-api');
    expect(sources('personal', '個人向けのページ')).toContain('api');
    expect(sources('personal', '個人向けのページ')).not.toContain('ssr');
    expect(check('personal', 'cpu')).toBe('true');
    // 本文のフレームワークの説明の行は消え、描き方の説明は選んだチップの ⓘ に畳む（D-125）。札も選んだ描き方のものになる
    expect(
      within(pageOf('personal')).queryByRole('list', {
        name: '個人向けのページの説明',
      }),
    ).toBeNull();
    fireEvent.click(
      within(pageOf('personal')).getByRole('button', {
        name: '枠 + ブラウザが API で取るの説明',
      }),
    );
    expect(screen.getByRole('tooltip').textContent).toContain(
      'HTML は静的な枠',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(badges('personal')).not.toContain('CPU:');
    expect(badges('personal')).toContain('API: 1 PV あたり 1 回増える');
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

  it('W-28 始める画面: ページの欄の説明の行と札は、選んだ描き方に合わせる（借りる図の無い記事の毎回描くも。描き方の説明はチップの ⓘ。D-112・D-125）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    const lines = (route: string, label: string) =>
      within(pageOf(route)).queryByRole('list', { name: `${label}の説明` })
        ?.textContent ?? '';
    /** 選んでいる描き方のチップの ⓘ の文。 */
    const chipInfo = (route: string, strategy: string) => {
      fireEvent.click(
        within(pageOf(route)).getByRole('button', {
          name: `${strategy}の説明`,
        }),
      );
      const t = screen.getByRole('tooltip').textContent ?? '';
      fireEvent.keyDown(document, { key: 'Escape' });
      return t;
    };
    const badges = (route: string) =>
      within(pageOf(route)).getByRole('list', { name: 'ページの札' })
        .textContent ?? '';
    pick(/^記事コミュニティ/);
    pick(/^Astro/);
    pick(/^Cloudflare Paid/);
    // 記事を毎回描くにすると（借りる図の無い描き方）、記事の説明と札も毎回描くものになる。戻すとフレームワークの説明
    expect(lines('article', '記事のページ')).toContain(
      '閲覧時に SSR + キャッシュ',
    );
    pickStrategy('記事のページ', '毎回描く');
    expect(chosenOf('article')).toBe('ssr');
    expect(lines('article', '記事のページ')).toBe('');
    expect(chipInfo('article', '毎回描く')).toContain(
      'リクエストのたびにサーバーが描く',
    );
    expect(badges('article')).toContain('CPU: 閲覧ごとにサーバーが描く');
    expect(badges('article')).not.toContain('投稿・編集でキャッシュを消す');
    pickStrategy('記事のページ', 'サーバーで描いてキャッシュ（更新で消す）');
    expect(chosenOf('article')).toBe('cached-purge');
    expect(lines('article', '記事のページ')).toContain(
      '閲覧時に SSR + キャッシュ',
    );
  });

  it('W-58 始める画面: 部品ごとにキャッシュ（Cache Components）の説明は本文に出さず、チップと設定の見出しの ⓘ に畳む（D-125）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    pickRadio('Vercel Pro + Supabase Pro');
    showFrameworkTab();
    // Vercel × Next.js の既定（D-111）。本文に描き方の説明の行・部品の作り直しの関係の行は出ない
    expect(chosenOf('article')).toBe('cache-components');
    expect(
      within(pageOf('article')).queryByRole('list', {
        name: '記事のページの説明',
      }),
    ).toBeNull();
    expect(pageOf('article').textContent).not.toContain('同じ応答で流す');
    expect(pageOf('article').textContent).not.toContain('時間は部品の期限');
    // 選んでいるチップの ⓘ: 描き方の説明・要件に応える理由・値
    fireEvent.click(
      within(pageOf('article')).getByRole('button', {
        name: '部品ごとにキャッシュ（Cache Components）の説明',
      }),
    );
    const tip = screen.getByRole('tooltip').textContent ?? '';
    expect(tip).toContain('cacheComponents: true');
    expect(tip).toContain('数え方は ISR と同じ');
    expect(tip).toMatch(/部品をタグで作り直す|部品の期限/);
    fireEvent.keyDown(document, { key: 'Escape' });
    // 設定の見出しの ⓘ に時間とタグの意味
    fireEvent.click(
      within(pageOf('article')).getByRole('button', {
        name: '部品の作り直し（cacheLife・タグ）の説明',
      }),
    );
    expect(screen.getByRole('tooltip').textContent).toContain(
      'オンデマンドは投稿・編集でタグを消して作り直す',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it('W-59 始める画面: 部品を選び残したら、名前を押すと ① のそのスロットへ移り、残りをダイアログで選べ、残りを既定にもできる（D-125）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    pickRadio('Cloudflare Paid + vinext');
    const start = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' });
    const missing = () =>
      document.querySelector<HTMLElement>('[data-missing-parts]');
    expect(start().disabled).toBe(true);
    expect(missing()!.textContent).toContain(
      '部品をまだ選んでいない: ISR のキャッシュ・画像・DB・メール送信',
    );
    // ジャンプ: ② を開いていても、DB を押すと ① を開き、構成図の DB の箱にフォーカスする
    showFrameworkTab();
    const jump = (slot: string) =>
      fireEvent.click(
        missing()!.querySelector<HTMLElement>(`[data-missing-slot="${slot}"]`)!,
      );
    jump('db');
    expect(
      document
        .querySelector('[data-setup-tab-button="stack"]')!
        .getAttribute('aria-selected'),
    ).toBe('true');
    const card = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    expect(card().contains(document.activeElement)).toBe(true);
    expect(
      document.activeElement!.closest('[data-slots~="db"]'),
    ).not.toBeNull();
    // 「機能から選ぶ」の表示では、そのスロットのチップの行へ
    showPartsView('list');
    showFrameworkTab();
    jump('email');
    expect(
      document.activeElement!.closest('[data-parts] [data-slot="email"]'),
    ).not.toBeNull();
    // ダイアログ: 未選択のスロットだけを並べ、その場で選ぶ（選んだ行は畳んで残る）
    fireEvent.click(screen.getByRole('button', { name: '残りを選ぶ' }));
    const dialog = screen.getByRole('dialog', { name: '残りの部品を選ぶ' });
    const rows = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'section[data-parts] [data-slot]',
        ),
      ].map((r) => r.getAttribute('data-slot'));
    expect(rows()).toEqual(['db', 'images', 'isrCache', 'email']);
    expect(within(dialog).getByRole('status').textContent).toBe('残り 4 個');
    const db = dialog.querySelector<HTMLElement>('[data-slot="db"]')!;
    fireEvent.click(
      within(db).getByRole('button', { name: /^D1/, pressed: false }),
    );
    expect(rows()).toEqual(['db', 'images', 'isrCache', 'email']);
    expect(
      dialog.querySelector('[data-slot="db"]')!.getAttribute('data-collapsed'),
    ).toBe('true');
    expect(within(dialog).getByRole('status').textContent).toBe('残り 3 個');
    // 部品の ⓘ の比較のダイアログだけを閉じても、残りを選ぶダイアログは開いたまま（OCL-763C2E15）
    fireEvent.click(
      within(
        dialog.querySelector<HTMLElement>('[data-slot="images"]')!,
      ).getAllByRole('button', { name: /の説明$/ })[0]!,
    );
    const cmp = document.querySelector<HTMLDialogElement>(
      'dialog[data-slot-compare-dialog]',
    )!;
    expect(cmp.open).toBe(true);
    fireEvent.click(within(cmp).getByRole('button', { name: '閉じる' }));
    expect(
      document.querySelector('dialog[data-slot-compare-dialog]'),
    ).toBeNull();
    expect(screen.getByRole('dialog', { name: '残りの部品を選ぶ' })).toBe(
      dialog,
    );
    // ダイアログの中でも残りを既定にでき、閉じると「運営を始める」が押せてフォーカスが移る
    fireEvent.click(
      within(dialog).getByRole('button', { name: '残りを既定にする' }),
    );
    expect(within(dialog).getByRole('status').textContent).toContain(
      'すべて選んだ',
    );
    fireEvent.click(
      within(dialog)
        .getAllByRole('button', { name: '閉じる' })
        .find((b) => b.textContent === '閉じる')!,
    );
    expect(
      screen.queryByRole('dialog', { name: '残りの部品を選ぶ' }),
    ).toBeNull();
    expect(missing()).toBeNull();
    expect(start().disabled).toBe(false);
    expect(document.activeElement).toBe(start());
    // 選んだ DB は既定で上書きしない
    expect(
      document
        .querySelector(
          'section[data-parts] [data-slot="db"] [data-selected="true"]',
        )!
        .getAttribute('data-option'),
    ).toBe('d1');
  });

  it('W-60 始める画面: 「残りを既定にする」で未選択のスロットを既定の部品で埋め、すぐ「運営を始める」を押せる（D-125）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    pickRadio('Vercel Pro + Supabase Pro');
    const start = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' });
    expect(start().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '残りを既定にする' }));
    expect(document.querySelector('[data-missing-parts]')).toBeNull();
    expect(start().disabled).toBe(false);
    expect(document.activeElement).toBe(start());
    fireEvent.click(start());
    await waitLoaded();
    expectGameScreen(1);
  });

  it('W-64 始める画面: 始めたあと最初からに戻ると「前回の構成を選ぶ」に構成とフレームワークが出て、押すと構成・部品が戻る（D-127）', async () => {
    await renderApp();
    // 前回が無ければ出ない
    expect(lastButton()).toBeNull();
    await startGame({
      scenario: ARTICLE,
      stack: 'Vercel Pro + Supabase Pro',
      framework: 'Vite（SPA）+ API',
      parts: { 'CDN の料金のプラン': 'On-demand CDN（従量）' },
    });
    fireEvent.click(screen.getByRole('button', { name: '最初から' }));
    const b = lastButton()!;
    expect(b.textContent).toBe(
      '前回の構成を選ぶ（Vercel Pro + Supabase Pro・Vite（SPA）+ API）',
    );
    expect(b.disabled).toBe(false);
    // 既定（一覧の 1 番目）から、前回の構成・フレームワーク・部品に戻る
    expect(
      (getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    fireEvent.click(b);
    expect(
      (getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (getRadio({ name: /^Vite（SPA）\+ API/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      slotGroup('CDN の料金のプラン').querySelector('[data-selected="true"]')!
        .textContent,
    ).toMatch(/On-demand CDN（従量）/);
    expect(document.querySelector('[data-missing-parts]')).toBeNull();
    // 戻せないものは無いので知らせは出ない。今は前回と同じなので押せない
    expect(
      document.querySelector('[data-last-setup] [role="status"]'),
    ).toBeNull();
    expect(lastButton()!.disabled).toBe(true);
    expect(document.querySelector('[data-last-setup]')!.textContent).toContain(
      '前回と同じ',
    );
    // 1 つ替えるとまた押せる
    pickPart('Flat Rate CDN', slotGroup('CDN の料金のプラン'));
    expect(lastButton()!.disabled).toBe(false);
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' }),
    );
    await waitLoaded();
    expectGameScreen(1);
  });

  it('W-65 始める画面: 前回はシナリオごとに持ち、そのシナリオの前回が無ければボタンを出さない（D-127）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      stack: 'Cloudflare Paid + vinext',
      framework: 'Next.js（App Router）',
    });
    fireEvent.click(screen.getByRole('button', { name: '最初から' }));
    pickRadio(CONTRACT);
    expect(lastButton()).toBeNull();
    pickRadio(ARTICLE);
    expect(lastButton()!.textContent).toBe(
      '前回の構成を選ぶ（Cloudflare Paid + vinext・Next.js（App Router））',
    );
  });

  it('W-66 始める画面: 前回の中身が壊れている・版が違う・localStorage が使えないときはボタンを出さず、画面は落ちない（D-127）', async () => {
    for (const raw of [
      '{壊れた',
      JSON.stringify({ version: 999, scenarios: { 'article-community': {} } }),
      JSON.stringify({
        version: 1,
        scenarios: { 'article-community': { stackId: 3 } },
      }),
    ]) {
      localStorage.setItem(LAST_SETUP_KEY, raw);
      await renderApp();
      pickRadio(ARTICLE);
      expect(lastButton()).toBeNull();
      cleanup();
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    await renderApp();
    pickRadio(ARTICLE);
    expect(lastButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '残りを既定にする' }));
    fireEvent.click(screen.getByRole('button', { name: '運営を始める' }));
    await waitLoaded();
    expectGameScreen(1);
  });

  it('W-67 始める画面: 前回の部品が今は選べなければ、その部品だけ未選択にして知らせる（D-127）', async () => {
    localStorage.setItem(
      LAST_SETUP_KEY,
      JSON.stringify({
        version: 1,
        scenarios: {
          'article-community': {
            stackId: 'cloudflare-vinext-paid',
            framework: 'nextjs',
            components: {
              isrCache: 'kv',
              images: 'images',
              db: 'no-such-db',
              email: 'default',
            },
          },
        },
      }),
    );
    await renderApp();
    pickRadio(ARTICLE);
    fireEvent.click(lastButton()!);
    expect(
      (getRadio({ name: /^Cloudflare Paid \+ vinext/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      document.querySelector('[data-last-setup] [role="status"]')!.textContent,
    ).toBe('前回の DB（no-such-db）は今は選べないので選び直してください。');
    expect(slotGroup('DB').getAttribute('data-unselected')).toBe('true');
    expect(
      slotGroup('ISR のキャッシュ').querySelector('[data-selected="true"]')!
        .textContent,
    ).toMatch(/:KV/);
    expect(
      document.querySelector('[data-missing-parts]')!.textContent,
    ).toContain('部品をまだ選んでいない: DB');
    // 今の選択は前回を戻した結果と同じなので押せない（押しても同じ）
    expect(lastButton()!.disabled).toBe(true);
  });

  it('W-29 始める画面: 「詳しく比べる」のダイアログに表を出し、表で選んでもカードに効く。閉じるとボタンへ戻る（D-112）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
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
    // 表の ⓘ の吹き出しはダイアログの中に描く（body だと top layer のダイアログの後ろに隠れる。OCL-8E844E7C）
    fireEvent.click(
      within(
        table.querySelector<HTMLElement>('tr[data-route="personal"]')!,
      ).getAllByRole('button', { name: /の判定$/ })[0]!,
    );
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(dialog.contains(tip)).toBe(true);
    // Esc はまず吹き出しだけを閉じる
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
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
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
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
    // 構成図の凡例に島の流れ（個人向けのページ）が出る（① のタブ）
    showStackTab();
    const legends = screen.getAllByRole('list', {
      name: '構成図の流れの凡例',
    });
    expect(
      legends.some((l) =>
        within(l).queryByText(/^サーバーの島（閲覧ごとに一部だけ描く）/),
      ),
    ).toBe(true);
  });

  it('W-27 始める画面: Google Cloud × Next.js で部品ごとにキャッシュを選び ISR のキャッシュを「キャッシュしない」にすると、表と同じく見取り図も毎回描くになる（D-111・OCL-CD192A98）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    const sources = () =>
      [
        ...within(pageOf('personal'))
          .getByRole('list', { name: '個人向けのページの見取り図' })
          .querySelectorAll('[data-source]'),
      ].map((x) => x.getAttribute('data-source'));
    pick(/^記事コミュニティ/);
    pick(/^Next\.js（App Router）/);
    pick(/^Google Cloud/);
    // 描き方はカードのページの欄のチップで選ぶ（D-112）
    pickStrategy('個人向けのページ', '部品ごとにキャッシュ');
    expect(chosenOf('personal')).toBe('cache-components');
    expect(sources()).toContain('cc-dynamic');
    // ISR のキャッシュを「キャッシュしない」に: 行（チップ）は毎回描く、見取り図も同じ
    pickPart('キャッシュしない', slotGroup('ISR のキャッシュ'));
    expect(chosenOf('personal')).toBe('ssr');
    expect(sources()).not.toContain('cc-dynamic');
    expect(sources()).not.toContain('cc-cached');
    expect(sources()).toContain('ssr');
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
        showStackTab();
        // 始める画面: 選べる構成（さくらの VPS・vinext の S1 も出した CF。RS-15 の解除）のカードには出さない。
        // 選んでいない事業者のカードは、その事業者の最初のプランを出す（事業者ごとに 1 枚。D-105 の補足）
        for (const id of ['sakura-vps-2gb', 'cloudflare-vinext-free']) {
          const card = document.querySelector<HTMLElement>(
            `section[data-stack="${id}"]`,
          )!;
          expect(within(card).queryByRole('note')).toBeNull();
        }
        // フレームワークを替えると、選んだ描き方は既定に戻る
        showFrameworkTab();
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

  it('W-57 行動の欄の構成の乗り換え・作り直しは畳んで出し、見出しに件数と選んだものを出す。次の月はまた畳む', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
    });
    const fold = (title: string) => screen.getByText(title).closest('details')!;
    const stack = () => fold('構成の乗り換え・プラン変更');
    expect(stack().open).toBe(false);
    expect(fold('アプリの作り直し（フレームワークを替える）').open).toBe(false);
    expect(stack().querySelector('summary')!.textContent).toMatch(/（\d+ 件）/);
    // 開いて選ぶと、畳み直しても見出しに選んだものが出る
    fireEvent.click(stack().querySelector('summary')!);
    expect(stack().open).toBe(true);
    const migrate = [...stack().querySelectorAll('label')].find((l) =>
      /^Cloudflare Paid \+ vinext.*へ乗り換える/.test(l.textContent ?? ''),
    )!;
    fireEvent.click(within(migrate).getByRole('radio'));
    expect(stack().open).toBe(true);
    expect(stack().querySelector('summary')!.textContent).toMatch(
      /選んだもの: Cloudflare Paid \+ vinext.*へ乗り換える/,
    );
    // 開いた欄も、次の月は畳んだ状態から。乗り換え中は畳まずに進み具合を出す
    fireEvent.click(
      fold('アプリの作り直し（フレームワークを替える）').querySelector(
        'summary',
      )!,
    );
    expect(fold('アプリの作り直し（フレームワークを替える）').open).toBe(true);
    advance(1);
    expect(screen.queryByText('構成の乗り換え・プラン変更')).toBeNull();
    expect(screen.getByText(/へ乗り換え中（/)).toBeDefined();
    expect(fold('アプリの作り直し（フレームワークを替える）').open).toBe(false);
  });

  it('W-17 選んでいない構成のカードも、その構成で選べる描き方で描く（流れの凡例のページ。D-107 の補足・RS-15 の解除）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    // CF は Paid を選んでから離れる（選んでいない事業者のカードは最後に選んだプランを出す。D-105 の補足）
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    fireEvent.click(getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }));
    pickStrategy('記事のページ', '静的（ビルドし直し）');
    showStackTab();
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
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    showStackTab();
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
    fireEvent.click(getRadio({ name: /^Vercel Pro/ }));
    expect(checked().getAttribute('aria-label')).toMatch(/^Vercel Pro/);
    expect(current().getAttribute('aria-label')).toMatch(/^Vercel Pro/);
    // 選んでいるカードに構成図（要約つきの図・凡例・読み上げ用の一覧）。Vercel と Supabase の枠に分かれる。
    // 箱から部品を差し替えられるので、図は img でなく group（D-116）
    const diagram = within(current()).getByRole('group', { name: /^構成図: / });
    expect(diagram.querySelector('[data-group="vercel"]')).not.toBeNull();
    expect(diagram.querySelector('[data-group="supabase"]')).not.toBeNull();
    expect(
      within(current()).getByRole('list', { name: '構成図のつながり' })
        .textContent,
    ).toContain('ブラウザ → Vercel CDN');
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

  it('W-52 始める画面: 狭い画面の前後のカードの帯の三角を押すと前後の構成を選び、帯の無い端では出ない。三角は読み上げに出ない', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const carousel = () =>
      current().closest('[data-card]')!.parentElement!.parentElement!;
    const arrow = (d: 'prev' | 'next') =>
      carousel().querySelector<HTMLElement>(`[data-edge-arrow="${d}"]`);
    const cards = [...carousel().querySelectorAll<HTMLElement>('[data-card]')];
    const stackOf = (card: HTMLElement) =>
      card.querySelector<HTMLElement>('section[data-stack]')!.dataset.stack!;
    // 最初のカードを選ぶと、前の帯が無いので左の三角は出ない
    fireEvent.click(
      document.querySelector(
        `input[name="stack"][value="${stackOf(cards[0]!)}"]`,
      )!,
    );
    expect(arrow('prev')).toBeNull();
    expect(arrow('next')).not.toBeNull();
    // 三角は読み上げに出ず、フォーカスも受けない（前後のボタンが担う）
    expect(arrow('next')!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(arrow('next')!.tabIndex).toBe(-1);
    expect(screen.getAllByRole('button', { name: /^次の構成/ }).length).toBe(1);
    // 押すと次のカードを選び、前の三角も出る
    fireEvent.click(arrow('next')!);
    expect(current().closest('[data-card]')).toBe(cards[1]);
    expect(arrow('prev')).not.toBeNull();
    fireEvent.click(arrow('prev')!);
    expect(current().closest('[data-card]')).toBe(cards[0]);
    // 最後のカードでは右の三角は出ない
    fireEvent.click(
      document.querySelector(
        `input[name="stack"][value="${stackOf(cards.at(-1)!)}"]`,
      )!,
    );
    expect(arrow('next')).toBeNull();
    expect(arrow('prev')).not.toBeNull();
  });

  it('W-21 始める画面のインフラの構成のタブは事業者ごとにまとまり、←/→ は組をまたいで全部の構成を順に移る（D-105 の補足）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    showStackTab();
    const group = screen.getByRole('radiogroup', { name: '① インフラの構成' });
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
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
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
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    fireEvent.click(getRadio({ name: /^Cloudflare Free/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const card = current();
    const item = card.closest<HTMLElement>('[data-card]')!;
    expect(item.dataset.card).toBe('cloudflare');
    const diagram = within(card).getByRole('group', { name: /^構成図: / });
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
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    expect(current()).toBe(card);
    expect(card.closest('[data-card]')).toBe(item);
    expect(card.dataset.stack).toBe('cloudflare-vinext-paid');
    expect(card.getAttribute('aria-label')).toMatch(/^Cloudflare Paid/);
    expect(card.querySelector('p')!.textContent).not.toBe(flavor);
    expect(within(card).getByRole('group', { name: /^構成図: / })).toBe(
      diagram,
    );
    expect(scrolls).toBe(0);
    // ほかの事業者へ移るとカルーセルが動き、CF のカードは最後に選んだ Paid のまま薄く出る
    fireEvent.click(getRadio({ name: /^Vercel Hobby/ }));
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

  it('W-30 始める画面: シナリオの説明に、フレームワークに依らない見取り図（区画の要件の札）が出る（D-113）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    /** シナリオの見取り図の区画の札（区画の名前 → 要件の札の文字）。 */
    const needs = (page: string, region: string) => {
      const list = screen.getByRole('list', {
        name: `${page}の見取り図（要件）`,
      });
      return (
        within(list).getByText(region).closest('li')?.textContent ?? ''
      ).replace(region, '');
    };
    expect(needs('記事のページ', '本文')).toContain('全員に同じ');
    expect(needs('記事のページ', '本文')).toContain('すぐ見えてほしい');
    expect(needs('記事のページ', '記事のタイトル・著者')).toContain(
      'SNS のカードが要る',
    );
    expect(needs('記事のページ', 'いいね')).toContain('閲覧ごとに変わる');
    expect(needs('個人向けのページ', 'プロフィール')).toContain('人ごとに違う');
    // 作られ方（フレームワークで変わる札）は出さない
    const scenarioPage = screen.getByRole('region', {
      name: '記事のページ（シナリオ）',
    });
    expect(scenarioPage.textContent).not.toMatch(/ISR|SSR|ビルドで静的/);
    // ページ名の横には見る人の札だけを出す。性質（RS-17）・札の凡例・注記は見出しの横の ⓘ に畳む（D-113 の補足）
    expect(scenarioPage.querySelector('[data-audience]')?.textContent).toBe(
      '全員に同じ中身',
    );
    expect(
      screen
        .getByRole('region', { name: '個人向けのページ（シナリオ）' })
        .querySelector('[data-audience]')?.textContent,
    ).toBe('人ごとに違う中身');
    expect(
      screen.queryByRole('list', { name: '記事のページの性質' }),
    ).toBeNull();
    expect(screen.queryByRole('list', { name: '要件の札の凡例' })).toBeNull();
    expect(screen.queryByText(/見取り図はゲーム上の仮定。作り方/)).toBeNull();
    // 札の意味は凡例を開かなくても、札の読み上げ（sr-only）と title で分かる
    const bodyTag = within(
      screen.getByRole('list', { name: '記事のページの見取り図（要件）' }),
    )
      .getByText('本文')
      .closest('li')!
      .querySelector('[title="誰が見ても同じ中身"]');
    expect(bodyTag?.textContent).toContain('（誰が見ても同じ中身）');
    fireEvent.click(
      screen.getByRole('button', { name: 'ページの見取り図の説明' }),
    );
    const info = screen.getByRole('tooltip');
    expect(
      within(info).getByRole('list', { name: '記事のページの性質' })
        .textContent,
    ).toContain('SNS のカードが要る');
    expect(
      within(info).getByRole('list', { name: '要件の札の凡例' }).textContent,
    ).toContain('誰が見ても同じ中身');
    expect(info.textContent).toContain('見取り図はゲーム上の仮定');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    // 区画は種類ごとのスケルトンで描く（飾りなので aria-hidden。D-113 の追記）
    /** 見取り図の区画の id → スケルトンの種類。 */
    const kinds = (page: string) =>
      Object.fromEntries(
        [
          ...screen
            .getByRole('list', { name: `${page}の見取り図（要件）` })
            .querySelectorAll('li[data-region]'),
        ].map((li) => {
          const sk = li.querySelector('[data-kind]');
          expect(sk?.getAttribute('aria-hidden')).toBe('true');
          return [
            li.getAttribute('data-region'),
            sk?.getAttribute('data-kind'),
          ];
        }),
      );
    expect(kinds('記事のページ')).toMatchObject({
      header: 'header',
      title: 'title',
      body: 'body',
      images: 'image',
      likes: 'likes',
      comments: 'comments',
    });
    expect(kinds('個人向けのページ')).toMatchObject({
      profile: 'profile',
      notifications: 'notifications',
    });
    // メールはページの外の要素として、見取り図の脇に封筒の 1 行で出す（区画・要件の札・作られ方の色ではない。D-117）。
    // 何が効くか（note）は ⓘ に畳む（D-117 の補足）
    const mail = screen.getByRole('region', { name: 'メール（ページの外）' });
    expect(mail.getAttribute('data-offscreen')).toBe('email');
    expect(mail.textContent).toContain('登録の確認');
    expect(mail.textContent).not.toContain('メール送信');
    expect(mail.closest('li[data-region]')).toBeNull();
    fireEvent.click(
      within(mail).getByRole('button', { name: 'メール（ページの外）の説明' }),
    );
    expect(screen.getByRole('tooltip').textContent).toContain('メール送信');
    fireEvent.keyDown(document, { key: 'Escape' });
    // 受託のシナリオも同じ形で出る
    fireEvent.click(getRadio({ name: /^受託先の業務アプリの運用/ }));
    expect(needs('業務の画面', '一覧の表（申請・記録）')).toContain(
      '人ごとに違う',
    );
    expect(kinds('業務の画面')).toMatchObject({
      menu: 'menu',
      search: 'search',
      table: 'table',
      form: 'form',
    });
  });

  it('W-32 始める画面: シナリオの説明の出来事の詳細と開発の手間の内訳は畳み、ボタンでダイアログに出す', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    // 本文には要約だけ（出来事の一覧・改定の説明は出さない）
    expect(screen.getByText(/運営中に出来事が起きる/)).toBeDefined();
    expect(screen.queryByText(/Bot が大量に来る/)).toBeNull();
    expect(screen.queryByText(/実際に予告されている料金/)).toBeNull();
    const open = screen.getByRole('button', { name: '出来事の詳しい説明' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: '運営中の出来事' });
    expect(dialog.textContent).toContain('Bot が大量に来る');
    expect(dialog.textContent).toContain('実際に予告されている料金');
    // 話題の出来事で登録の確認のメールが集中する（D-117）
    expect(dialog.textContent).toContain('登録の確認のメール');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
    // 開発の手間の内訳
    fireEvent.click(screen.getByRole('button', { name: '開発の手間の内訳' }));
    const effort = screen.getByRole('dialog', { name: '開発の手間の内訳' });
    expect(effort.textContent).toContain('自前運用の維持');
    fireEvent.click(within(effort).getByRole('button', { name: '閉じる' }));
    // 満足度は先頭の文だけを本文に出し、残りはダイアログ（2026-11-05）
    expect(
      screen.getByText(/満足度は可用性・速さ・機能・鮮度・画質/),
    ).toBeDefined();
    expect(screen.queryByText(/離脱や検索からの流入/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '満足度の詳しい説明' }));
    const sat = screen.getByRole('dialog', { name: '満足度' });
    expect(sat.textContent).toContain('離脱や検索からの流入');
    fireEvent.click(within(sat).getByRole('button', { name: '閉じる' }));
    // アプリの形は見出しの 1 行だけ。箇条書きはダイアログ（2026-11-05）
    expect(screen.queryByText(/本文の画像 5 枚/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '3 項目を見る' }));
    const app = screen.getByRole('dialog', {
      name: 'アプリの形（コストに効く判断ポイント）',
    });
    expect(app.textContent).toContain('本文の画像 5 枚');
    expect(app.textContent).toContain('フレームワークで変わる点');
  });

  it('W-31 始める画面: インフラの構成を先に選び、載せられないフレームワークは選べない。選んでいたら載せられるものに戻して知らせる（D-113）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    // 順: ① インフラの構成 → ② フレームワーク（タブの並び。既定は ①。D-116 の補足）
    const stackTab = screen.getByRole('tab', { name: /^① インフラの構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^② フレームワークと描き方/,
    });
    expect(
      stackTab.compareDocumentPosition(fwTab) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    screen.getByRole('radiogroup', { name: '① インフラの構成' });
    showFrameworkTab();
    screen.getByRole('radiogroup', { name: /^② アプリを何で作りましたか/ });
    fireEvent.click(getRadio({ name: /^Astro/ }));
    // Astro を載せられない構成も隠さず、印を添える（選べる）
    const amplify = getRadio({
      name: /^AWS（Amplify Hosting）/,
    }) as HTMLInputElement;
    expect(amplify.disabled).toBe(false);
    expect(amplify.closest('label')?.textContent).toContain(
      'Astro を載せられない構成',
    );
    expect(
      within(
        document.querySelector<HTMLElement>(
          'section[data-stack="aws-amplify"]',
        )!,
      ).getByRole('note').textContent,
    ).toMatch(
      /^Astro はこの構成に載せられない.*選ぶとフレームワークは Next\.js（App Router） になる/,
    );
    fireEvent.click(amplify);
    // Astro を選んでいたので、載せられる最初のフレームワークに戻して知らせる
    expect(
      (
        getRadio({
          name: /^Next\.js（App Router）/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(document.body.textContent).toMatch(
      /には Astro を載せる公式のアダプターが無いので、フレームワークを Next\.js（App Router） にした/,
    );
    // Astro は灰色で選べず、カードに理由が出る
    const astro = getRadio({
      name: /^Astro/,
    }) as HTMLInputElement;
    expect(astro.disabled).toBe(true);
    const astroCard = screen.getByRole('region', { name: 'Astro の説明' });
    expect(astroCard.getAttribute('aria-disabled')).toBe('true');
    expect(within(astroCard).getByRole('note').textContent).toMatch(
      /^選んでいる構成では選べない: 公式のアダプターが無く載せられない（Astro の AWS の手順は/,
    );
    // 前後のボタン・カードを押しても Astro は選ばない
    fireEvent.click(astroCard);
    expect(astro.checked).toBe(false);
    for (let k = 0; k < 4; k++) {
      fireEvent.click(screen.getByRole('button', { name: /^次の選択肢/ }));
      expect(astro.checked).toBe(false);
    }
    // 載せられる構成に戻すと、また選べる（知らせは消える）
    fireEvent.click(getRadio({ name: /^Cloudflare Free/ }));
    expect((getRadio({ name: /^Astro/ }) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(document.body.textContent).not.toMatch(/公式のアダプターが無いので/);
  });

  it('W-39 始める画面: 部品は構成図の箱か機能ごとのチップで選び、未選択・他の事業者の部品も見分けられる（D-116 とその補足）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    pick(/^受託先の業務アプリの運用/);
    pick(/^Vercel Pro/);
    pick(/^Next\.js（App Router）/);
    showStackTab();
    // 前の ③ 部品の欄は無く、部品は選んでいる構成のカードの中。最初は構成図の表示で、チップの一覧は出さない
    expect(screen.queryByRole('heading', { name: '③ 部品' })).toBeNull();
    const tabs = within(current()).getByRole('group', {
      name: '部品の選び方',
    });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((t) => [t.textContent, t.getAttribute('aria-pressed')]),
    ).toEqual([
      ['構成図から選ぶ', 'true'],
      ['機能から選ぶ', 'false'],
    ]);
    expect(
      document.querySelectorAll('[role="group"][aria-label="部品の選び方"]')
        .length,
      '選んでいないカードには出さない',
    ).toBe(1);
    expect(document.querySelector('section[data-parts]')).toBeNull();
    // 構成図の DB の箱に「未選択」の印（既定の部品の名前で描くので、選び済みに見えないように。D-116 の補足）
    const dbBox = () =>
      within(current()).queryByRole('button', {
        name: /（DB、未選択）を替える$/,
      });
    expect(dbBox()!.querySelector('[data-unselected-mark]')).not.toBeNull();
    expect(dbBox()!.querySelector('[data-swap-mark]')).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: '運営を始める' })
        .disabled,
    ).toBe(true);
    // 経路に載らないメールの送信は、図の一番下の段の箱から選ぶ（未選択の印も）
    const band = current().querySelector<HTMLElement>('[data-diagram-band]')!;
    const email = band.querySelector<HTMLElement>('[data-slots~="email"]')!;
    expect(email.getAttribute('data-unselected')).toBe('true');
    // 「! 未選択」は名前と同じ文の流れ（狭い幅で名前が折り返しても、印が別の列に立たない）
    const mark = email.querySelector('[data-unselected-mark]')!;
    expect(mark.parentElement!.classList).toContain('text-left');
    expect(mark.parentElement!.textContent).toMatch(/.+! 未選択$/);
    // 1 択のファイルの置き場は押せない箱
    const files = band.querySelector<HTMLElement>('[data-loose-slot="files"]')!;
    expect(files.textContent).toContain('（1 択）');
    expect(files.querySelector('button')).toBeNull();
    // DB の箱を押すと選択肢の吹き出しが出て、focus が移る（キーボードで続けて選べる）。同じ事業者の部品が先、他の事業者はロゴ付き
    fireEvent.click(dbBox()!);
    let popover = screen.getByRole('dialog', { name: /を替える$/ });
    expect(document.activeElement).toBe(popover);
    let swap = within(popover).getByRole('group', { name: 'DBを替える' });
    const options = within(swap).getAllByRole('button');
    expect(options[0]!.textContent).toMatch(/^Supabase/);
    expect(
      options
        .find((b) => /AWS: DynamoDB/.test(b.textContent ?? ''))!
        .querySelector('[data-brand="aws"]'),
    ).not.toBeNull();
    fireEvent.click(
      within(swap).getByRole('button', { name: /^AWS: DynamoDB/ }),
    );
    // 選ぶと吹き出しは閉じ、カードの題（実際の組）と図が替わる。未選択の印も消える
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dbBox()).toBeNull();
    expect(current().getAttribute('aria-label')).toBe(
      'Vercel Pro + AWS DynamoDB の構成',
    );
    expect(
      within(current()).getByRole('list', { name: '構成図の部品' }).textContent,
    ).toContain('DynamoDB');
    // 元の箱は差し替えで消えるので、focus は DB の今の箱（DynamoDB）へ移る（OCL-131BD89D）
    const box = within(current()).getByRole('button', {
      name: /DynamoDB.*を替える$/,
    });
    expect(document.activeElement).toBe(box);
    expect(box.closest('[data-swappable="true"]')).not.toBeNull();
    expect(box.querySelector('[data-swap-mark]')).not.toBeNull();
    // Esc で閉じると箱に focus が戻る
    fireEvent.click(box);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(box);
    // 箱の吹き出しには、その箱の役割のスロットだけ（DB の箱に画像・API の置き場は出さない）
    fireEvent.click(box);
    popover = screen.getByRole('dialog', { name: /DynamoDB.*を替える$/ });
    swap = within(popover).getByRole('group', { name: 'DBを替える' });
    expect(
      within(popover)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['DBを替える']);
    expect(
      within(swap).getByRole('button', { pressed: true }).textContent,
    ).toMatch(/AWS: DynamoDB/);
    fireEvent.click(
      within(swap).getByRole('button', { name: /^Supabase/, pressed: false }),
    );
    expect(current().getAttribute('aria-label')).toBe(
      'Vercel Pro + Supabase Pro の構成',
    );
    // focus は DB のスロットの今の箱（Supabase）へ
    expect(
      document
        .activeElement!.closest('[data-slots]')!
        .getAttribute('data-slots'),
    ).toMatch(/\bdb\b/);
    expect(document.activeElement!.getAttribute('aria-label')).toMatch(
      /Supabase.*を替える$/,
    );

    // 「機能から選ぶ」にすると、構成図は出さずにチップの一覧だけ（縦の量を減らす）
    fireEvent.click(within(tabs).getByRole('button', { name: '機能から選ぶ' }));
    expect(current().querySelector('[data-diagram="system"]')).toBeNull();
    const parts = current().querySelector('section[data-parts]')!;
    expect(parts).not.toBeNull();
    expect(document.querySelectorAll('section[data-parts]').length).toBe(1);
    // 図で選んだ DB は畳んだ行（「DB: 選んだ部品」）。まだ選んでいないメール送信の行は警告の枠で開いたまま
    const db = () => slotGroup('DB');
    expect(db().getAttribute('aria-label')).toBe('DB');
    expect(db().getAttribute('data-collapsed')).toBe('true');
    expect(slotGroup('メール送信').getAttribute('aria-label')).toBe(
      'メール送信（未選択）',
    );
    const toggle = () =>
      within(db()).getByRole('button', {
        name: /^DB: Supabase.*（押すと選択肢が開く）$/,
        expanded: false,
      });
    // 選び済みの行は畳んで「DB: 選んだ部品」のチップだけ。押すとその行だけ開き、見出しを押すとまた畳む
    expect(db().querySelector('li[data-option]')).toBeNull();
    // 名前は切り詰めず折り返し、ⓘ は名前の最後の語と離さない（狭い幅で ⓘ が文字に重ならない）
    expect(db().querySelector('.truncate')).toBeNull();
    expect(
      within(db())
        .getByRole('button', { name: /の説明$/ })
        .closest('.whitespace-nowrap')!.textContent,
    ).toMatch(/^（Postgres）▾/);
    fireEvent.click(toggle());
    expect(db().hasAttribute('data-collapsed')).toBe(false);
    const chips = [...db().querySelectorAll<HTMLElement>('li[data-option]')];
    expect(chips[0]!.textContent).toMatch(/^Supabase/);
    expect(
      chips
        .find((c) => /AWS: DynamoDB/.test(c.textContent ?? ''))!
        .querySelector('[data-brand="aws"]'),
    ).not.toBeNull();
    fireEvent.click(within(db()).getByRole('button', { expanded: true }));
    expect(db().getAttribute('data-collapsed')).toBe('true');
    // 開いた行でチップを選ぶと畳まれ、focus は畳んだボタンへ。カードの題も替わる
    pickPart('AWS: DynamoDB（オンデマンド）', db());
    expect(document.activeElement).toBe(
      within(db()).getByRole('button', {
        name: /^DB: AWS: DynamoDB.*（押すと選択肢が開く）$/,
      }),
    );
    expect(current().getAttribute('aria-label')).toBe(
      'Vercel Pro + AWS DynamoDB の構成',
    );
    // 畳んだ並びの上に、押すと開く旨の説明
    expect(parts.textContent).toContain('押すと選択肢が開く');

    // 選んだ表示は覚える（開き直しても、見積モードでも「機能から選ぶ」のまま）
    cleanup();
    await renderApp();
    pick(/^受託先の業務アプリの運用/);
    expect(
      within(current())
        .getByRole('button', { name: '機能から選ぶ' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(current().querySelector('[data-diagram="system"]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '見積' }));
    await waitLoaded();
    expect(current().querySelector('section[data-parts]')).not.toBeNull();
    // 構成図に戻すと、チップの一覧は消える
    fireEvent.click(
      within(current()).getByRole('button', { name: '構成図から選ぶ' }),
    );
    expect(current().querySelector('section[data-parts]')).toBeNull();
    expect(current().querySelector('[data-diagram="system"]')).not.toBeNull();
  });

  it('W-51 始める画面: 構成を替えても部品の選択は構成ごとに覚えていて、戻ると戻る。フレームワークで選べなくなったものだけ落ちる（D-116 の補足）', async () => {
    await renderApp();
    const CF = 'Cloudflare Paid';
    const VERCEL = 'Vercel Pro + Supabase Pro';
    /** 行で選んでいる部品の名前（畳んだチップの「スロット名:」の後ろ。未選択なら null）。 */
    const chosen = (slot: string) =>
      slotGroup(slot)
        .querySelector('[data-selected="true"]')
        ?.textContent?.replace(/^[^:]*:/, '') ?? null;
    const isrRow = () =>
      document.querySelector('section[data-parts] [data-slot="isrCache"]');
    pickRadio(ARTICLE);
    pickRadio(CF);
    pickRadio('Next.js（App Router）');
    pickPart('D1', slotGroup('DB'));
    pickPart('最適化しない', slotGroup('画像'));
    pickPart('R2', slotGroup('ISR のキャッシュ'));
    // 構成 B では A の選択が混ざらず、B で選んだものは B だけに残る
    pickRadio(VERCEL);
    expect(slotGroup('DB').hasAttribute('data-unselected')).toBe(true);
    expect(slotGroup('画像').hasAttribute('data-unselected')).toBe(true);
    pickPart('AWS: DynamoDB', slotGroup('DB'));
    // A に戻ると A の選択が戻る（B の DynamoDB は混ざらない）
    pickRadio(CF);
    expect(chosen('DB')).toMatch(/^D1/);
    expect(chosen('画像')).toMatch(/^最適化しない/);
    expect(chosen('ISR のキャッシュ')).toMatch(/^R2/);
    // 選んでいない B のカードは覚えている部品で描く（題も実際の組。D-116 の補足）
    expect(
      document
        .querySelector('section[data-stack="vercel-supabase-pro"]')!
        .getAttribute('aria-label'),
    ).toBe('Vercel Pro + AWS DynamoDB の構成');
    // B に戻ると B の選択が戻る
    pickRadio(VERCEL);
    expect(chosen('DB')).toMatch(/DynamoDB/);
    // B の上でフレームワークを Vite（ISR が無い）にしてから A に戻ると、A の ISR のキャッシュだけが落ち、DB・画像は残る
    pickRadio('Vite（SPA）+ API');
    pickRadio(CF);
    expect(chosen('DB')).toMatch(/^D1/);
    expect(chosen('画像')).toMatch(/^最適化しない/);
    expect(isrRow()).toBeNull();
    // Next.js に戻しても落ちた ISR のキャッシュは復活しない（OCL-09D12A43）
    pickRadio('Next.js（App Router）');
    expect(slotGroup('ISR のキャッシュ').hasAttribute('data-unselected')).toBe(
      true,
    );
    expect(chosen('DB')).toMatch(/^D1/);
  });

  it('W-48 始める画面: どちらの表示でも全部のスロットに届く（構成図は経路の箱か一番下の段の箱、一覧はチップの行。選んだ後の組でも。D-116 の補足）', async () => {
    await renderApp();
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    let band = 0;
    /** 一覧の行のスロットが、構成図の箱か段の箱にもれなくあることを確かめ、スロットの一覧を返す。 */
    const check = (tag: string): string[] => {
      showPartsView('list');
      const rows = [
        ...current().querySelectorAll<HTMLElement>(
          'section[data-parts] [data-slot]',
        ),
      ].map((r) => ({
        slot: r.getAttribute('data-slot')!,
        // 1 択の行は押せるボタンを持たない
        pressable:
          r.querySelector('button[aria-pressed], [data-collapsed-toggle]') !==
          null,
      }));
      expect(rows.length, tag).toBeGreaterThan(0);
      showPartsView('diagram');
      const diagram = current().querySelector<HTMLElement>(
        '[data-diagram="system"]',
      )!;
      for (const { slot, pressable } of rows) {
        const places = [
          ...diagram.querySelectorAll<HTMLElement>(`[data-slots~="${slot}"]`),
        ];
        expect(places.length, `${tag} ${slot}`).toBeGreaterThan(0);
        // 選べるスロットは押せる箱（吹き出しで選ぶ）、1 択は押せない段の箱
        expect(
          places.some((p) => p.querySelector('button') !== null),
          `${tag} ${slot}`,
        ).toBe(pressable);
        if (places.some((p) => p.closest('[data-diagram-band]'))) band++;
      }
      return rows.map((r) => r.slot);
    };
    // API の置き場を替えると DB のスロットが出入りする組がある（選んだ後の組でも、もれなく届く）
    let dbMoved = false;
    for (const scenario of [ARTICLE, CONTRACT]) {
      pickRadio(scenario);
      const stacks = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="radio"][name="stack"]',
        ),
      ].map((r) => r.value);
      expect(stacks.length).toBeGreaterThan(4);
      for (const id of stacks) {
        fireEvent.click(
          document.querySelector(
            `input[type="radio"][name="stack"][value="${id}"]`,
          )!,
        );
        const base = check(`${scenario} ${id}`);
        if (!base.includes('api')) continue;
        showPartsView('list');
        const options = [
          ...openSlot(slotGroup('api', 'slot')).querySelectorAll<HTMLElement>(
            'li[data-option]',
          ),
        ].map((li) => li.getAttribute('data-option')!);
        for (const o of options) {
          showPartsView('list');
          const b = openSlot(
            slotGroup('api', 'slot'),
          ).querySelector<HTMLButtonElement>(
            `li[data-option="${o}"] button[aria-pressed="false"]`,
          );
          if (!b || b.disabled) continue;
          fireEvent.click(b);
          const after = check(`${scenario} ${id} api=${o}`);
          if (after.includes('db') !== base.includes('db')) dbMoved = true;
        }
      }
    }
    expect(dbMoved).toBe(true);
    // 経路に載らないメールの送信・1 択のファイルの置き場などは段に出る
    expect(band).toBeGreaterThan(0);
  });

  it('W-50 始める画面: localStorage が使えない環境でも、既定の構成図で始まり、表示を切り替えられる（D-116 の補足）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    await renderApp();
    pickRadio(ARTICLE);
    const group = screen.getByRole('group', { name: '部品の選び方' });
    expect(
      within(group)
        .getByRole('button', { name: '構成図から選ぶ' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    showPartsView('list');
    showPartsView('diagram');
  });

  it('W-54 始める画面: ① 構成と ② フレームワークはタブで切り替え、見出しに今の選択と注意の印が出て、替えても選択は残る（D-116 の補足）', async () => {
    await renderApp();
    pickRadio(ARTICLE);
    const tablist = screen.getByRole('tablist', { name: '選ぶもの' });
    const [stackTab, fwTab] = within(tablist).getAllByRole('tab');
    // 既定は ①。② の欄は隠れ（hidden）、タブは ② の今の選択を出す
    expect(stackTab!.getAttribute('aria-selected')).toBe('true');
    expect(fwTab!.getAttribute('aria-selected')).toBe('false');
    expect(fwTab!.getAttribute('tabindex')).toBe('-1');
    const panel = (tab: HTMLElement) =>
      document.getElementById(tab.getAttribute('aria-controls')!)!;
    expect(panel(stackTab!).getAttribute('role')).toBe('tabpanel');
    expect(panel(fwTab!).hidden).toBe(true);
    expect(
      screen.queryByRole('radiogroup', { name: /^② アプリを何で作りましたか/ }),
    ).toBeNull();
    expect(fwTab!.textContent).toContain('Next.js（App Router）');
    // 欄の中の見出しはタブと重なるので画面から隠す（読み上げと radiogroup の名前には残る）
    expect(
      screen.getByRole('heading', { name: '① インフラの構成' }).className,
    ).toContain('sr-only');
    screen.getByRole('radiogroup', { name: '① インフラの構成' });
    // 部品がまだ選ばれていないので、① に注意の印（文は名前と title）
    expect(stackTab!.querySelector('[data-setup-tab-warn]')).not.toBeNull();
    expect(stackTab!.getAttribute('title')).toContain('部品をまだ選んでいない');
    expect(fwTab!.querySelector('[data-setup-tab-warn]')).toBeNull();
    // ① で構成と部品を 1 つ選ぶ
    pickRadio('Vercel Pro + Supabase Pro');
    expect(stackTab!.textContent).toContain('Vercel Pro + Supabase Pro');
    showPartsView('list');
    const row = document.querySelector<HTMLElement>(
      'section[data-parts] [data-slot][data-unselected]',
    )!;
    const slot = row.getAttribute('data-slot')!;
    fireEvent.click(within(row).getAllByRole('button', { pressed: false })[0]!);
    const picked = () =>
      document
        .querySelector(
          `section[data-parts] [data-slot="${slot}"] [data-selected="true"]`,
        )
        ?.getAttribute('data-option');
    const chosen = picked();
    expect(chosen).toBeDefined();
    // ② に替えると ① の欄は隠れ、① のタブが選んだ構成を出す。選んだタブは画面ごとに覚える
    fireEvent.click(fwTab!);
    expect(fwTab!.getAttribute('aria-selected')).toBe('true');
    expect(panel(stackTab!).hidden).toBe(true);
    expect(
      screen.queryByRole('radiogroup', { name: '① インフラの構成' }),
    ).toBeNull();
    screen.getByRole('radiogroup', { name: /^② アプリを何で作りましたか/ });
    expect(localStorage.getItem('infra-supra:setup-tab:game')).toBe(
      'framework',
    );
    pickRadio('Astro');
    expect(fwTab!.textContent).toContain('Astro');
    // ←（キーボード）で ① に戻る。構成と部品の選択は残っている
    fireEvent.keyDown(fwTab!, { key: 'ArrowLeft' });
    expect(stackTab!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(stackTab);
    expect(
      (getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(picked()).toBe(chosen);
    // Astro を載せられない構成を選ぶと、② のタブに付け替えの知らせの印が出る（① を開いたままでも分かる）
    pickRadio('AWS（Amplify Hosting）');
    expect(stackTab!.getAttribute('aria-selected')).toBe('true');
    expect(fwTab!.textContent).toContain('Next.js（App Router）');
    expect(fwTab!.querySelector('[data-setup-tab-warn]')).not.toBeNull();
    expect(fwTab!.getAttribute('title')).toMatch(/公式のアダプターが無いので/);
    // ② の欄は隠れているので、知らせはパネルの外の常設の aria-live で読む（OCL-B12E7ACB）。② を開くと欄の中の aria-live に任せる
    const live = document.querySelector('[data-setup-tab-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.closest('[hidden]')).toBeNull();
    expect(live.textContent).toMatch(/公式のアダプターが無いので/);
    fireEvent.click(fwTab!);
    expect(live.textContent).toBe('');
    fireEvent.click(stackTab!);
    // End / Home でも移る
    fireEvent.keyDown(stackTab!, { key: 'End' });
    expect(fwTab!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(fwTab!, { key: 'Home' });
    expect(stackTab!.getAttribute('aria-selected')).toBe('true');
  });

  it('W-55 始める画面: 選んだタブを開き直しても覚えていて、localStorage が使えない環境でもタブを切り替えられる（D-116 の補足）', async () => {
    localStorage.setItem('infra-supra:setup-tab:game', 'framework');
    await renderApp();
    expect(
      screen
        .getByRole('tab', { name: /^② フレームワークと描き方/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    cleanup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない');
    });
    await renderApp();
    const stackTab = screen.getByRole('tab', { name: /^① インフラの構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^② フレームワークと描き方/,
    });
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(fwTab);
    expect(fwTab.getAttribute('aria-selected')).toBe('true');
    screen.getByRole('radiogroup', { name: /^② アプリを何で作りましたか/ });
    fireEvent.keyDown(fwTab, { key: 'ArrowRight' });
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
  });

  it('W-40 始める画面: 部品どうしの依存で選べない部品のチップは灰色で、理由をツールチップと ⓘ に出す（D-116）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    pick(/^記事コミュニティ/);
    pick(/^さくらの VPS 2GB/);
    pick(/^Vite（SPA）/);
    const apiCache = () => slotGroup('API の応答のキャッシュ');
    const chip = () =>
      [...apiCache().querySelectorAll<HTMLElement>('li[data-option]')].find(
        (c) => /^前段の CDN でキャッシュ/.test(c.textContent ?? ''),
      )!;
    expect(chip().getAttribute('data-available')).toBe('false');
    expect(chip().getAttribute('title')).toMatch(
      /^前段の CDN でキャッシュ.*（.+）$/,
    );
    expect(
      within(chip()).getByRole<HTMLButtonElement>('button', {
        name: /^前段の CDN でキャッシュ/,
        pressed: false,
      }).disabled,
    ).toBe(true);
    // ⓘ はスロットの比較のダイアログを開き、選べない行に理由を添えて薄く出す（D-124）
    fireEvent.click(
      within(chip()).getByRole('button', { name: /が選べない理由$/ }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'API の応答のキャッシュを比べる',
    });
    const row = dialog.querySelector<HTMLElement>(
      `tbody[data-option="${chip().getAttribute('data-option')}"]`,
    )!;
    expect(row.textContent).toMatch(/選べない: .+/);
    expect(row.querySelector('details')!.open).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    // 前段の CDN を置くと選べる
    pickPart('Cloudflare（静的と画像だけ）', slotGroup('前段の CDN'));
    expect(chip().getAttribute('data-available')).toBe('true');
  });
  it('W-56 部品の ⓘ は、選択肢の比較の表と今の規模での月額の横棒をダイアログに出す（ゲームの行動の欄・始める画面のチップと箱の吹き出し。D-124）', async () => {
    await renderApp();
    // 始める画面: DB の箱の吹き出しの「表と月額で比べる」
    pickRadio(ARTICLE);
    showStackTab();
    pickRadio('Vercel Pro + Supabase Pro');
    showPartsView('diagram');
    const card = document.querySelector<HTMLElement>(
      'section[data-stack][aria-current="true"]',
    )!;
    const dbBox = within(card).getByRole('button', {
      name: /（DB、未選択）を替える$/,
    });
    fireEvent.click(dbBox);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /を替える$/ })).getByRole(
        'button',
        { name: '表と月額で比べる' },
      ),
    );
    let dialog = screen.getByRole('dialog', { name: 'DBを比べる' });
    expect(within(dialog).getByRole('table')).toBeDefined();
    expect(
      within(dialog).getByRole('columnheader', { name: '部品' }),
    ).toBeDefined();
    // Aurora（最小 0.5 ACU）の棒に月額の数値のラベル
    expect(dialog.querySelector('[data-bar="aurora"]')!.textContent).toMatch(
      /\$\d[\d,.]*\/月/,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(dbBox);

    // ゲームの行動の欄: DB の ⓘ（未選択のスロットは startGame が埋める）
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      parts: { DB: 'Supabase（Postgres）' },
    });
    const select = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'DB',
    });
    fireEvent.click(
      within(select.parentElement!).getByRole('button', { name: 'DBの説明' }),
    );
    dialog = screen.getByRole('dialog', { name: 'DBを比べる' });
    const rows = dialog.querySelectorAll('tbody[data-option]');
    expect(rows.length).toBe(select.options.length);
    // 今の部品に「今」の印、棒は選択肢の数だけ（今の部品は基準で、他は差を添える）
    expect(
      dialog.querySelector('tbody[data-current="true"]')!.textContent,
    ).toContain('今');
    expect(dialog.querySelectorAll('[data-bar]').length).toBe(rows.length);
    expect(dialog.querySelector('[data-bar="aurora"]')!.textContent).toMatch(
      /[+−]\$/,
    );
    // DB の差し替えの注記は表の下に残す
    expect(dialog.textContent).toContain('データの移行');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('W-37 始める画面: Vercel の DB に AWS の部品が短い名前で出て、選ぶと構成のカードの題が実際の組になる（D-114 段 2）', async () => {
    await renderApp();
    await startGame({
      scenario: CONTRACT,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      beforeStart: () => {
        const db = openSlot(slotGroup('DB'));
        const names = [...db.querySelectorAll('li[data-option]')].map(
          (li) => li.textContent ?? '',
        );
        for (const n of [
          'AWS: DynamoDB（オンデマンド）',
          'AWS: Aurora Serverless v2（最小 0.5 ACU）',
          'AWS: Aurora Serverless v2（0 ACU まで縮める）',
        ])
          expect(names.some((x) => x.includes(n))).toBe(true);
        // 名前に Marketplace を入れない（説明文の側。折り返しで右端に離れないように）
        expect(names.some((x) => x.includes('Vercel の Marketplace）'))).toBe(
          false,
        );
        pickPart('AWS: DynamoDB（オンデマンド）', db);
        expect(
          document
            .querySelector<HTMLElement>(
              'section[data-stack][aria-current="true"]',
            )!
            .getAttribute('aria-label'),
        ).toBe('Vercel Pro + AWS DynamoDB の構成');
      },
    });
  });

  it('W-43 始める画面: 再検証の間隔などの描き方の設定は、② のカードの記事のページの行で選ぶ（S2 と S3 は同じ設定。D-119。既定はオンデマンドが選べればオンデマンド。D-125）', async () => {
    await renderApp();
    /** 記事のページの行の設定のチップ（名前は設定の見出し）。 */
    const setting = (label: string) =>
      within(pageOf('article')).getByRole('group', { name: label });
    const selectedOf = (label: string) =>
      setting(label)
        .querySelector('[data-selected="true"]')
        ?.getAttribute('data-option');
    const chip = (label: string, value: string) =>
      setting(label).querySelector<HTMLElement>(`[data-option="${value}"]`)!;
    const choose = (label: string, value: string) =>
      fireEvent.click(
        within(chip(label, value)).getByRole('button', { pressed: false }),
      );
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
      parts: { 'ISR のキャッシュ': 'R2', DB: 'D1' },
      beforeStart: () => {
        // ③ 設定の欄は無く、記事のページの行（描き方のチップの下）に出る。個人向けのページの行には出ない
        expect(screen.queryByRole('heading', { name: '③ 設定' })).toBeNull();
        expect(
          within(pageOf('personal')).queryByRole('group', {
            name: 'ISR の再検証',
          }),
        ).toBeNull();
        // 既定は、今の部品（R2）でオンデマンドが選べるのでオンデマンド（更新で消す。D-125）
        expect(chosenOf('article')).toBe('cached-purge');
        expect(selectedOf('ISR の再検証')).toBe('0');
        expect(setting('ISR の再検証').textContent).toContain(
          '上の 2 つの描き方は、この設定で切り替わる',
        );
        // 選んでいない間は部品に付いて替わる: KV（消す呼び出しが届かない）は 5 分、R2 に戻すとオンデマンド
        pickPart('KV', slotGroup('ISR のキャッシュ'));
        expect(selectedOf('ISR の再検証')).toBe('300');
        expect(chosenOf('article')).toBe('cached-ttl');
        pickPart('R2', slotGroup('ISR のキャッシュ'));
        expect(selectedOf('ISR の再検証')).toBe('0');
        // 時間にすると描き方は時間で取り直す。時間を替えても時間で取り直すのまま。オンデマンドにすると更新で消すになる
        choose('ISR の再検証', '300');
        expect(chosenOf('article')).toBe('cached-ttl');
        choose('ISR の再検証', '3600');
        expect(selectedOf('ISR の再検証')).toBe('3600');
        expect(chosenOf('article')).toBe('cached-ttl');
        choose('ISR の再検証', '0');
        expect(chosenOf('article')).toBe('cached-purge');
        // 描き方のチップで時間で取り直すに戻すと、設定も 5 分に戻る（同じ設定）
        pickStrategy(
          '記事のページ',
          'サーバーで描いてキャッシュ（時間で取り直す）',
        );
        expect(selectedOf('ISR の再検証')).toBe('300');
        choose('ISR の再検証', '3600');
        // ISR を KV に置くとオンデマンドは届かないので、灰色で理由を ⓘ に出す
        pickPart('KV', slotGroup('ISR のキャッシュ'));
        expect(chip('ISR の再検証', '0').getAttribute('data-available')).toBe(
          'false',
        );
        expect(
          within(setting('ISR の再検証')).getByRole('button', {
            name: /が選べない理由$/,
          }),
        ).toBeDefined();
        expect(setting('ISR の再検証').textContent).toContain(
          'オンデマンドは選べない',
        );
        expect(selectedOf('ISR の再検証')).toBe('3600');
      },
    });
    // 選んだ値で始まる
    const save = JSON.parse(localStorage.getItem('infra-supra:game-save')!);
    expect(save.revalidateSec).toBe(3600);
  });

  it('W-44 始める画面: Astro の記事のキャッシュ・静的書き出しのビルドの間隔も記事のページの行で選ぶ（D-119）', async () => {
    await renderApp();
    const pick = (name: RegExp) => fireEvent.click(getRadio({ name }));
    const setting = (label: string) =>
      within(pageOf('article')).queryByRole('group', { name: label });
    pick(/^記事コミュニティ/);
    pick(/^Cloudflare Free/);
    pick(/^Astro/);
    // 消せる置き場（Cloudflare）では既定がオンデマンド
    expect(
      setting('記事のキャッシュ')
        ?.querySelector('[data-selected="true"]')
        ?.getAttribute('data-option'),
    ).toBe('0');
    // 消せない置き場（Google Cloud の Hosting の CDN）ではオンデマンドが灰色
    pick(/^Google Cloud/);
    expect(
      setting('記事のキャッシュ')
        ?.querySelector('[data-option="0"]')
        ?.getAttribute('data-available'),
    ).toBe('false');
    // 静的書き出しはビルドの間隔
    pick(/^Next\.js（静的書き出し）/);
    expect(chosenOf('article')).toBe('static-build');
    expect(setting('ビルドの間隔')).not.toBeNull();
    // SPA は始める画面では選ばない（記事は枠 + API で、期限の設定は無い）
    pick(/^Vite（SPA）/);
    expect(pageOf('article').querySelector('[data-setting]')).toBeNull();
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

  it('W-54 手間の欄に機能開発の累計・期待と来月の見込みが出て、行動を選ぶと見込みが変わる。提案には受けたときの得を出す（D-122）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    // 月の報告の手間の棒の下: 今の累計と期待と段階（良いのときも出す）
    expect(screen.getByText(/^機能開発の累計 \d+ \/ 期待 8 →/)).toBeDefined();
    const outlook = () => screen.getByTestId('feature-outlook').textContent!;
    const feature = () =>
      Number(outlook().match(/来月の機能開発 ([\d.]+)/)![1]);
    expect(outlook()).toContain('来月の機能開発の累計');
    expect(outlook()).toContain('/ 期待 16');
    expect(outlook()).not.toContain('行動で');
    const before = feature();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(feature()).toBeLessThan(before);
    expect(outlook()).toMatch(/（行動で −\d/);
    // シード 42 は 6 か月目に個人向けのページの提案が届く
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    advance(m - 1);
    expectGameScreen(m);
    const card =
      screen.getByText('届いた提案（選ばなければ断る）').parentElement!;
    expect(card.textContent).toContain(
      '受けると: 機能開発 +6（作業 4 × 1 か月も機能開発に数える）',
    );
    expect(card.textContent).toContain(
      '伴うこと: 来月、行動に使える手間が 4 減る・使用量・費用: SSR の割合 60%',
    );
    expect(card.textContent).toContain('断る（何も変わらない）');
    // 7 か月目に記事のデザインの刷新の提案が届く。機能の加点が無くても、得と断ったときの損を出す
    advance(1);
    const months = ARTICLE_COMMUNITY.imageRedesign!.declineMonths;
    const proposals =
      screen.getByText('届いた提案（選ばなければ断る）').parentElement!
        .textContent!;
    expect(proposals).toContain(
      `受けると: 画質の評価を保つ（断ると ${months} か月、画質が 1 段下がる）`,
    );
    expect(proposals).toContain(
      `断る（${months} か月、画質の評価が 1 段下がる）`,
    );
  });

  it('W-55 手間の輪を、月の報告の手間の棒の下と行動の欄の 2 か所に常に出し、行動を選ぶと中央の数と区分が変わる（D-122）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const rings = () =>
      document.querySelectorAll<HTMLElement>('[data-feature-ring]');
    expect(rings()).toHaveLength(2);
    // 月の報告の側は、その月の手間と累計
    expect(
      rings()[0]!.querySelector('svg[role="img"]')!.getAttribute('aria-label'),
    ).toMatch(/^1 か月目の機能開発 [\d.]+ \/ 期待 8・累計/);
    const ring = () => rings()[1]!;
    const label = () =>
      ring().querySelector('svg[role="img"]')!.getAttribute('aria-label')!;
    expect(label()).toMatch(/^来月の機能開発 [\d.]+ \/ 期待 8・累計/);
    expect(ring().textContent).not.toContain('行動で');
    // 値が 0 の区分は凡例に出さない（機能開発と、行動の欄の行動は常に出す）
    const legend = () =>
      [...ring().querySelectorAll('li')].map((li) => li.textContent);
    expect(legend().some((t) => t!.startsWith('機能開発'))).toBe(true);
    expect(legend().some((t) => t!.startsWith('行動0'))).toBe(true);
    expect(legend().some((t) => t!.startsWith('出来事への対応0'))).toBe(false);
    const before = label();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    expect(label()).not.toBe(before);
    expect(ring().textContent).toMatch(/行動で −\d/);
    expect(legend().some((t) => t!.startsWith('行動0'))).toBe(false);
  });

  it('W-61 出来事のある月は出来事のダイアログが開き、1 件ずつ前後に移れて、最後のページで「閉じる」が出る（D-126）', async () => {
    // シード 42 は 6 か月目に 3 件（話題・個人向けのページの提案・料金の改定）
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.getByRole('dialog', {
      name: new RegExp(`^${m} か月目の出来事（\\d+ 件）`),
    });
    const n = Number(
      within(dialog)
        .getByRole('heading')
        .textContent!.match(/（(\d+) 件）/)![1],
    );
    expect(n).toBeGreaterThanOrEqual(2);
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    const page = () => dialog.querySelector('[data-events-page]')!.textContent!;
    const first = page();
    // ナビ（前へ・位置・次へ・件数ぶんの印）は本文の上にあり、× とは別の行（D-126）
    const nav = within(dialog).getByRole('navigation', {
      name: '出来事のページ',
    });
    const body = dialog.querySelector('[data-events-page]')!;
    // 2 件以上の月は高さを一定にして、ページを替えても上端・ナビが動かない（見た目は画面で確かめる）
    expect(dialog.querySelector('[data-events-fixed-height]')).not.toBeNull();
    expect(
      nav.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nav.contains(
        within(dialog).getByRole('button', { name: 'ダイアログを閉じる' }),
      ),
    ).toBe(false);
    // 件数はページ送りの点で示す。今のページは横長、未読は塗り、既読は輪郭だけ
    const dots = within(nav).getAllByRole('button', { name: /^\d+ 件目（/ });
    expect(dots).toHaveLength(n);
    const dotStates = () => dots.map((d) => d.getAttribute('data-dot'));
    expect(dots[0]!.getAttribute('aria-current')).toBe('step');
    expect(dotStates()).toEqual(['current', ...Array(n - 1).fill('unread')]);
    // 見出しの近くに未読の数（開いたページは既読）、未読だったカードの角に NEW
    const unread = () =>
      dialog.querySelector('[data-events-unread]')!.textContent;
    const isNew = () => dialog.querySelector('[data-events-new]') !== null;
    expect(unread()).toBe(`未読 ${n - 1}`);
    expect(isNew()).toBe(true);
    // 読み上げにも位置と未読の数を伝える
    expect(dialog.querySelector('[aria-live="polite"]')!.textContent).toBe(
      `${n} 件中 1 件目。未読 ${n - 1} 件`,
    );
    // 1 ページ目: 前へは押せず、次へ・あとで見る・× がある。最後でないので「閉じる」は無い
    const prev = () =>
      within(dialog).getByRole<HTMLButtonElement>('button', {
        name: /^← 前へ/,
      });
    expect(prev().disabled).toBe(true);
    within(dialog).getByRole('button', { name: 'あとで見る（閉じる）' });
    within(dialog).getByRole('button', { name: 'ダイアログを閉じる' });
    expect(within(dialog).queryByRole('button', { name: '閉じる' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    expect(eventPosition(dialog)).toBe(`2 / ${n}`);
    expect(page()).not.toBe(first);
    expect(unread()).toBe(`未読 ${n - 2}`);
    expect(isNew()).toBe(true);
    expect(dotStates().slice(0, 2)).toEqual(['read', 'current']);
    fireEvent.click(prev());
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    expect(page()).toContain(first.replace(/^NEW/, ''));
    // 読んだページに戻ると NEW は出ず、未読の数も減らない
    expect(isNew()).toBe(false);
    expect(unread()).toBe(`未読 ${n - 2}`);
    // 点を押すとそのページへ移る
    const proposalDot = dots.find((b) =>
      b.getAttribute('aria-label')!.includes('会員向けの個人化'),
    )!;
    fireEvent.click(proposalDot);
    expect(page()).toContain('◆ 提案');
    expect(proposalDot.getAttribute('aria-current')).toBe('step');
    fireEvent.click(dots[0]!);
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    // 左右の矢印キーでも移る
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(eventPosition(dialog)).toBe(`2 / ${n}`);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(eventPosition(dialog)).toBe(`1 / ${n}`);
    // 各ページに出来事の印（一覧と同じ文言）と題が出る。提案のページには行動の欄で選ぶ案内
    const pages = readEventPages(dialog);
    expect(pages).toHaveLength(n);
    const proposal = pages.find((t) => t.includes('◆ 提案'))!;
    expect(proposal).toContain('会員向けの個人化');
    expect(proposal).toContain('行動の欄で受けるか断るかを選ぶ');
    expect(pages.some((t) => t.includes('⚡ 今月発生'))).toBe(true);
    // 最後のページ: 「閉じる」が主ボタン。次へは位置を動かさず押せなくなり、あとで見るは無い。全部読んだ
    expect(eventPosition(dialog)).toBe(`${n} / ${n}`);
    expect(unread()).toBe('✓ すべて既読');
    expect(dotStates().filter((x) => x === 'unread')).toHaveLength(0);
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: /^次へ/ })
        .disabled,
    ).toBe(true);
    expect(
      within(dialog).queryByRole('button', { name: 'あとで見る（閉じる）' }),
    ).toBeNull();
    const close = within(dialog).getByRole('button', { name: '閉じる' });
    expect(close.classList.contains('btn-primary')).toBe(true);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 閉じても月のカードに出来事の一覧が残り、そこから 1 ページ目で開き直せる
    expect(screen.getAllByText('◆ 提案').length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole('button', { name: `出来事を 1 件ずつ見る（${n} 件）` }),
    );
    const again = screen.getByRole('dialog');
    expect(eventPosition(again)).toBe(`1 / ${n}`);
    // 既読は開いている間だけ。開き直すと初めから（D-126）
    expect(again.querySelector('[data-events-unread]')!.textContent).toBe(
      `未読 ${n - 1}`,
    );
    closeEventsDialog(again);
  });

  it('W-62 出来事のダイアログは途中のページでも閉じられ、同じ月では再び自動では開かない（D-126）', async () => {
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(m - 2);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    // 途中のページで「あとで見る（閉じる）」
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'あとで見る（閉じる）' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // × でも閉じる（一覧のボタンで開き直してから）
    fireEvent.click(
      screen.getByRole('button', { name: /^出来事を 1 件ずつ見る/ }),
    );
    dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'ダイアログを閉じる' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // 見積の画面へ移って戻ると、運営中の画面は作り直されるが、同じ月の出来事は自動では開かない
    fireEvent.click(screen.getByRole('tab', { name: '見積' }));
    await waitLoaded();
    fireEvent.click(screen.getByRole('tab', { name: 'ゲーム' }));
    await waitLoaded();
    monthHeading(m);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 次の出来事のある月はまた開く
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    within(screen.getByRole('dialog')).getByRole('heading', {
      name: new RegExp(`^${m + 1} か月目の出来事`),
    });
  });

  it('W-63 行動の欄の機能追加の提案の選択肢に、出来事と同じ「◆ 提案」の印と primary の枠が付く（D-126）', async () => {
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'p-personal',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    expect(document.querySelector('[data-proposal-choice]')).toBeNull();
    advance(m - 1);
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[data-proposal-choice]'),
    ];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.textContent).toContain('会員向けの個人化');
    expect(row.classList.contains('border-primary')).toBe(true);
    const badge = within(row).getByText('◆ 提案');
    expect(badge.classList.contains('badge-primary')).toBe(true);
    // 月のカードの出来事の一覧の印と同じ文言・色
    const listed = screen
      .getAllByText('◆ 提案')
      .find((el) => !row.contains(el))!;
    expect(listed.className).toContain('badge-primary');
    // 受ける・断るの選択肢はこの行の中にある
    expect(within(row).getAllByRole('radio')).toHaveLength(2);
  });

  it('W-53 Bot を遮断してから Bot が来ると、出来事の欄に遮断済みの文が出る（2026-11-04）', async () => {
    // 既定のシード 42 は Bot が予告なしで来る
    const bot = ARTICLE_COMMUNITY.events.find((e) => e.id === 'bot')!;
    const m = rollSchedule(ARTICLE_COMMUNITY, 42).find(
      (x) => x.id === 'bot',
    )!.month;
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Bot を遮断するルールを入れる/ }),
    );
    // 始めた時点で 1 か月目の報告が出ている。m - 1 か月目まで進めてから次の月へ
    advance(m - 2);
    expectGameScreen(m - 1);
    fireEvent.click(screen.getByRole('button', { name: '次の月へ' }));
    const dialog = screen.getByRole('dialog');
    within(dialog).getByRole('heading', {
      name: new RegExp(`^${m} か月目の出来事`),
    });
    // 出来事は 1 件ずつ出る（D-126）。Bot のページまで送る
    for (let i = 0; i < 10 && !dialog.textContent!.includes(bot.title); i++)
      fireEvent.click(within(dialog).getByRole('button', { name: /^次へ/ }));
    expect(dialog.textContent).toContain(bot.blockedSurpriseText);
    expect(dialog.textContent).not.toContain(bot.surpriseText);
    // 効果の行は実際の倍率、予告なしの印の説明も遮断済みの文
    expect(dialog.textContent).toContain(
      '効果: Bot のPV × 1.5（遮断で半分・2 か月・収益なし）',
    );
    expect(dialog.textContent).toContain(
      '今月の費用・満足度に効いている（遮断済みで半分）',
    );
    expect(dialog.textContent).not.toContain('対処は来月から');
    // 緑の印（文字つき）を添える。閉じた後の月の報告の一覧にも出る
    expect(
      within(dialog)
        .getByText('🛡 対策済み')
        .classList.contains('badge-success'),
    ).toBe(true);
    closeEventsDialog(dialog);
    expect(screen.getAllByText('🛡 対策済み').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/🛡 対策済み）: Bot・クローラーの大量アクセス/),
    ).toBeDefined();
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
