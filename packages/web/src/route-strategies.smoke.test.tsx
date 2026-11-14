// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: ページの描き方・見取り図・当たったルート（始める画面の ② のカード）（App.smoke.test.tsx から分けた）。
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useSmokeEnv,
  infoDialog,
  renderApp,
  getRadio,
  pickRadio,
  pickPart,
  showStackTab,
  showFrameworkTab,
  startGame,
  slotGroup,
  openSetupChange,
  changeItems,
  advance,
  ARTICLE,
  fwCard,
  pageOf,
  chosenOf,
  pickStrategy,
  showPage,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
  it('W-18 Astro × CF Free: 1 リクエストの CPU の上限に当たるルートを、始める画面と月の報告に出す（D-99。D-103 で記事のページも描き直しの閲覧が当たる）', async () => {
    const detail =
      '記事のページ（ISR の閲覧と作り直し・CPU 17 ms）・個人向けのページ（SSR・CPU 15 ms）が Workers Free の 1 リクエスト 10 ms を超えます';
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
      /記事のページ（ISR の閲覧と作り直し・CPU [\d.]+ ms）・個人向けのページ（SSR・CPU [\d.]+ ms）が Workers Free の 1 リクエスト 10 ms を超えます/,
    );
  });

  it('W-19 始める画面: 記事コミュニティの前提・ページの一覧と、フレームワークごとのページの描き方が出る（D-101）', async () => {
    await renderApp();
    const text = document.body.textContent ?? '';
    expect(text).toContain('別の CMS はありません');
    // ページの一覧の補足は「ページの見取り図」のダイアログの中（2026-11-14 から本文に出さない）
    expect(text).not.toContain(
      '一覧・トップのページは記事のページに含めて数えます',
    );
    fireEvent.click(screen.getByRole('button', { name: 'ページの見取り図' }));
    expect(document.body.textContent).toContain(
      '一覧・トップのページは記事のページに含めて数えます',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    // 中央のカードに、選んでいるフレームワークのページごとの描き方が出る（D-102 でカルーセルにした）。② はタブで開く（D-116 の補足）
    showFrameworkTab();
    const card = (fw: string) =>
      screen.getByRole('region', { name: `${fw} の説明` }).textContent ?? '';
    expect(card('Next.js（App Router）')).toContain('ISR（最初の閲覧で描いて');
    // ページはタブで 1 ページずつ出す（2026-11-14）: 始めは記事のページだけ、タブで個人向けのページへ
    const nextRegion = screen.getByRole('region', {
      name: 'Next.js（App Router） の説明',
    });
    const pageTabs = within(nextRegion).getAllByRole('tab');
    expect(pageTabs.map((t) => t.textContent)).toEqual([
      '記事のページ',
      '個人向けのページ',
    ]);
    expect(nextRegion.querySelectorAll('section[data-route]').length).toBe(1);
    expect(
      nextRegion.querySelector('section[data-route="article"]'),
    ).not.toBeNull();
    fireEvent.click(pageTabs[1]!);
    expect(
      nextRegion.querySelector('section[data-route="article"]'),
    ).toBeNull();
    expect(
      within(nextRegion)
        .getByRole('tab', { name: '個人向けのページ' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(pageTabs[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^次の選択肢/ }));
    fireEvent.click(getRadio({ name: /^Astro/ }));
    // ページはタブで 1 ページずつ（個人向けのページの説明は 2 つ目のタブ）
    showPage(
      screen.getByRole('region', { name: 'Astro の説明' }),
      '個人向けのページ',
    );
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
      showPage(current(), page);
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
    // 札は選んだフレームワークでの呼び名（D-193）
    expect(tag('記事のページ', '本文')).toBe('ISR');
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'Client-side data fetching',
    );
    expect(tag('個人向けのページ', '自分の下書き・記事の一覧')).toBe(
      'Dynamic rendering',
    );
    // コメントを記事のページに含めると、コメント欄は ISR のページの一部になる（D-82）。
    // 選ぶのはフレームワークのカードの記事のページの欄（ページの部品。D-109・D-112）
    showPage(current(), '記事のページ');
    const inPage = getRadio({ name: /^記事のページに含める/ });
    expect(
      inPage.closest('section[data-route]')?.getAttribute('data-route'),
    ).toBe('article');
    expect(current().contains(inPage)).toBe(true);
    pick(/^記事のページに含める/);
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe('ISR');
    pick(/^ブラウザで読み込む/);

    // Astro の記事は閲覧時に SSR + キャッシュ（投稿で消す。D-103）
    pick(/^Astro/);
    expect(tag('記事のページ', '本文')).toBe('Route caching');
    expect(tag('記事のページ', 'いいね')).toBe('Client Islands');
    expect(tag('個人向けのページ', '自分の下書き・記事の一覧')).toBe(
      'On-demand rendering',
    );
    showPage(current(), '記事のページ');
    pick(/^記事のページに含める/);
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'Route caching',
    );

    pick(/^Next\.js（静的書き出し）/);
    expect(tag('個人向けのページ', 'ヘッダー・ナビ')).toBe('Static Export');
    expect(tag('個人向けのページ', '通知')).toBe('Client-side data fetching');

    // SPA はコメントを含められない（設定が出ない）ので、コメント欄は API のまま
    pick(/^Vite（SPA）/);
    expect(tag('記事のページ', 'ヘッダー・ナビ')).toBe('SPA');
    expect(tag('記事のページ', 'コメント欄（読む・書く）')).toBe(
      'ブラウザが API で取る',
    );
    // 凡例は文字で出る（Vite の SPA の API で取る区画に呼び名は無いので、一般の言葉のまま。D-193）
    expect(
      within(
        within(current()).getByRole('list', { name: '見取り図の凡例' }),
      ).getByText('SPA'),
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
    showPage(current(), '個人向けのページ');
    expect(
      within(
        within(current()).getByRole('region', { name: '個人向けのページ' }),
      ).getByText(/^CPU: 閲覧ごとにサーバーが描く/),
    ).toBeDefined();

    // 受託: 業務の画面の 1 枚
    pick(/^受託先の業務アプリの運用/);
    pick(/^Next\.js（App Router）/);
    expect(tag('業務の画面', '一覧の表（申請・記録）')).toBe(
      'Dynamic rendering',
    );
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
        .getByRole('button', {
          name: '個人向けのページは On-demand rendering（選択中）',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    // 描き方の番号（S1〜S6）は出さない（D-112）
    expect(fwCard().textContent).not.toMatch(/\bS[1-7]\b/);
    // 選んでいないカードは既定の描き方を読むだけ（押して選ぶボタンは無い）
    const next = screen.getByRole('region', {
      name: 'Next.js（App Router） の説明',
    });
    showPage(next, '個人向けのページ');
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
        name: 'Route caching（invalidate）が使えない理由',
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
    // 描き方の名前は Astro の呼び名（D-193）
    pickStrategy('個人向けのページ', 'Client Islands');
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
        name: 'Client Islandsの説明',
      }),
    );
    expect(infoDialog()!.textContent).toContain('HTML は静的な枠');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(badges('personal')).not.toContain('CPU:');
    expect(badges('personal')).toContain('API: 1 PV あたり 1 回増える');
    // もとの描き方は選び直せるボタンとして残る
    expect(
      within(pageOf('personal'))
        .getByRole('button', {
          name: /^個人向けのページを On-demand rendering/,
        })
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
      const t = infoDialog()!.textContent ?? '';
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
    pickStrategy('記事のページ', 'On-demand rendering');
    expect(chosenOf('article')).toBe('ssr');
    expect(lines('article', '記事のページ')).toBe('');
    expect(chipInfo('article', 'On-demand rendering')).toContain(
      'リクエストのたびにサーバーが描きます',
    );
    expect(badges('article')).toContain('CPU: 閲覧ごとにサーバーが描く');
    expect(badges('article')).not.toContain('投稿・編集でキャッシュを消す');
    pickStrategy('記事のページ', 'Route caching（invalidate）');
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
        name: 'Cache Componentsの説明',
      }),
    );
    const tip = infoDialog()!.textContent ?? '';
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
    expect(infoDialog()!.textContent).toContain(
      '「On-demand revalidation」は投稿・編集でタグを消して作り直します',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
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
    // 表には 1 か月目の費用の差が出る（丸めると 0 の差は「±$0」で、「−$0」「+$0」にしない）。番号は出さない
    expect(table.textContent).toMatch(/[±+−]\$\d/);
    expect(table.textContent).not.toMatch(/[+−]\$0(?![\d,])/);
    expect(table.textContent).not.toMatch(/\bS[1-7]\b/);
    // 表の ⓘ の説明のダイアログは、比べるダイアログの中に描く（OCL-8E844E7C。D-129）
    fireEvent.click(
      within(
        table.querySelector<HTMLElement>('tr[data-route="personal"]')!,
      ).getAllByRole('button', { name: /の判定$/ })[0]!,
    );
    const tip = infoDialog();
    expect(tip).not.toBeNull();
    expect(dialog.contains(tip)).toBe(true);
    // Esc はまず説明のダイアログだけを閉じる
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(infoDialog()).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
    // 表で選んでも、カードのチップと見取り図に効く（ダイアログは開いたまま）
    fireEvent.click(
      within(
        table.querySelector<HTMLElement>('tr[data-route="personal"]')!,
      ).getByRole('button', {
        name: /^個人向けのページを Server islands/,
      }),
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
    pickStrategy('個人向けのページ', 'Server islands');
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
    expect(within(list).getAllByText('Server islands').length).toBeGreaterThan(
      0,
    );
    // 構成図の凡例に島の流れ（個人向けのページ）が出る（① のタブ）
    showStackTab();
    const legends = screen.getAllByRole('list', {
      name: '構成図の流れの凡例',
    });
    expect(legends.some((l) => within(l).queryByText(/^Server islands/))).toBe(
      true,
    );
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
    pickStrategy('個人向けのページ', 'Cache Components');
    expect(chosenOf('personal')).toBe('cache-components');
    expect(sources()).toContain('cc-dynamic');
    // ISR のキャッシュを「キャッシュしない」に: 行（チップ）は毎回描く、見取り図も同じ
    pickPart('キャッシュしない', slotGroup('ISR のキャッシュ'));
    expect(chosenOf('personal')).toBe('ssr');
    expect(sources()).not.toContain('cc-dynamic');
    expect(sources()).not.toContain('cc-cached');
    expect(sources()).toContain('ssr');
  });

  it('W-17 選んでいない構成のカードも、その構成で選べる描き方で描く（流れの凡例のページ。D-107 の補足・RS-15 の解除）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    // CF は Paid を選んでから離れる（選んでいない事業者のカードは最後に選んだプランを出す。D-105 の補足）
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    fireEvent.click(getRadio({ name: /^Vercel Pro \+ Supabase Pro/ }));
    pickStrategy('記事のページ', 'Prerendering');
    showStackTab();
    const lane = (stackId: string, label: string) =>
      within(
        within(
          document.querySelector<HTMLElement>(
            `section[data-stack="${stackId}"]`,
          )!,
        ).getByRole('list', { name: '構成図の流れの凡例' }),
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
    // 流れの名前は Next.js の呼び名（ISR。D-193）
    expect(lane('cloudflare-vinext-paid', 'ISR')).not.toContain('記事のページ');
  });

  it('W-16 構成・フレームワークを替える前に、既定に戻るページの描き方を知らせる（D-107 の補足）', async () => {
    await renderApp();
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      beforeStart: () => {
        pickStrategy('記事のページ', 'Prerendering');
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
          /^このフレームワークにすると、記事のページは「Prerendering」→「Route caching（invalidate）」（既定）に戻ります: /,
        );
      },
    });
    // ゲームの途中: 構成を変えるの欄（D-185）。② の作り直し先のカードに、替える前に出す
    const fold = openSetupChange();
    showFrameworkTab();
    const astro = within(fold).getByRole('region', { name: 'Astro の説明' });
    expect(within(astro).getByRole('note').textContent).toMatch(
      /^作り直すと、記事のページは「Prerendering」→「[^」]+」（既定）に戻ります: 済んだ翌月から、描き方は新しいフレームワークの既定で始まります/,
    );
    // 乗り換え: 内訳に手間（か月）が出て、描き方の知らせは出ない
    showStackTab();
    pickRadio('Cloudflare Paid + vinext', fold);
    const migrate = changeItems().find(
      (x) => x.getAttribute('data-change-kind') === 'migrate',
    )!;
    expect(migrate.textContent).toMatch(
      /^Cloudflare Paid \+ vinext.*へ乗り換える/,
    );
    expect(migrate.textContent).toContain('か月');
    expect(within(migrate).queryByRole('note')).toBeNull();
    // 作り直し: 内訳の行に、既定に戻る描き方の知らせ
    pickRadio('Vercel Pro + Supabase Pro', fold);
    showFrameworkTab();
    pickRadio('Astro', fold);
    const rewrite = changeItems().find(
      (x) => x.getAttribute('data-change-kind') === 'rewrite',
    )!;
    expect(rewrite.textContent).toMatch(/^Astro に作り直す/);
    expect(rewrite.textContent).toContain('か月');
    expect(within(rewrite).getByRole('note').textContent).toMatch(
      /^作り直すと、記事のページは「Prerendering」→/,
    );
  });

  it('W-30 始める画面: シナリオの説明の「ページの見取り図」のダイアログに、フレームワークに依らない見取り図（区画の要件の札）が出る（D-113。2026-11-14 からダイアログに畳む）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    // 本文にはページの一覧の箇条書きだけ。見取り図はダイアログを開いたときだけ描く
    expect(
      screen.queryByRole('list', { name: '記事のページの見取り図（要件）' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ページの見取り図' }));
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
    const info = infoDialog()!;
    expect(
      within(info).getByRole('list', { name: '記事のページの性質' })
        .textContent,
    ).toContain('SNS のカードが要る');
    expect(
      within(info).getByRole('list', { name: '要件の札の凡例' }).textContent,
    ).toContain('誰が見ても同じ中身');
    expect(info.textContent).toContain('見取り図はゲーム上の仮定');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(infoDialog()).toBeNull();
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
    expect(infoDialog()!.textContent).toContain('メール送信');
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
        // 既定は、今の部品（R2）でオンデマンドが選べるのでオンデマンド（On-demand revalidation。D-125）
        expect(chosenOf('article')).toBe('cached-purge');
        expect(selectedOf('ISR の再検証')).toBe('0');
        expect(setting('ISR の再検証').textContent).toContain(
          '上の 2 つの描き方は、この設定で切り替わります',
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
        pickStrategy('記事のページ', 'ISR');
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
          '「On-demand revalidation」は選べない',
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
});
