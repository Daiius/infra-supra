// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 始める画面のシナリオの説明・インフラの構成のカード（タブ・前後・スワイプ）と ①② のタブ（App.smoke.test.tsx から分けた）。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useSmokeEnv,
  infoDialog,
  renderApp,
  getRadio,
  pickRadio,
  showPartsView,
  showStackTab,
  showFrameworkTab,
  ARTICLE,
  laneLegendOf,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

describe('ゲームモードの画面', () => {
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
    // 線の色の凡例は ⓘ の中（D-217）
    expect(
      laneLegendOf(current()).find((t) => /^ISR(?! の作り直し)/.test(t)),
    ).toContain('記事のページ');
    // 前後のボタンで選ぶ（フレームワークの欄の前後のボタンとは名前で分かれる）。カード（事業者）ごとに移る
    fireEvent.click(screen.getByRole('button', { name: /^次の構成/ }));
    expect(checked().getAttribute('aria-label')).toMatch(/^さくらの VPS 2GB/);
    fireEvent.click(screen.getByRole('button', { name: /^前の構成/ }));
    // 選んでいないカード: ⓘ を押しても選ばれない
    const other = document.querySelector<HTMLElement>(
      'section[data-stack]:not([aria-current="true"])',
    )!;
    const otherName = other.getAttribute('aria-label')!.replace(/ の構成$/, '');
    const otherRadio = () =>
      stackRadios().find((r) => r.getAttribute('aria-label') === otherName)!;
    expect(otherRadio().checked).toBe(false);
    fireEvent.click(within(other).getByRole('button', { name: /説明$/ }));
    expect(infoDialog()).not.toBeNull();
    fireEvent.click(infoDialog()!);
    expect(otherRadio().checked).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(otherRadio().checked).toBe(false);
    // カードの文字（名前）を押すと選ぶ
    fireEvent.click(other.querySelector('h4')!);
    expect(otherRadio().checked).toBe(true);
    expect(current()).toBe(other);
  });

  it('W-52b 始める画面: 選んでいないカードの中へ Tab でフォーカスが入るとそのカードを選ぶ（Tab でなければ選ばない）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const cards = [
      ...current()
        .closest('[data-card]')!
        .parentElement!.querySelectorAll<HTMLElement>('[data-card]'),
    ];
    const selected = current().closest<HTMLElement>('[data-card]')!;
    const other = cards.find((c) => c !== selected)!;
    // Tab でカードの中のフォーカスを受けるもの（ⓘ などのボタン）へ進む
    fireEvent.keyDown(document, { key: 'Tab' });
    const target = other.querySelector<HTMLElement>(
      'button, input, [tabindex]',
    )!;
    fireEvent.focus(target);
    expect(current().closest('[data-card]')).toBe(other);
    // 説明の中で Tab を押した直後に Escape で閉じて、選んでいないカードへフォーカスが戻っても選ばない（OCL-2B972F69）
    const third = cards.find((c) => c !== selected && c !== other)!;
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.focus(
      third.querySelector<HTMLElement>('button, input, [tabindex]')!,
    );
    expect(current().closest('[data-card]')).toBe(other);
    // Tab のあとのマウスの操作でも選ばない
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.pointerDown(document);
    fireEvent.focus(
      third.querySelector<HTMLElement>('button, input, [tabindex]')!,
    );
    expect(current().closest('[data-card]')).toBe(other);
    // Tab でないフォーカス（説明を閉じて戻ったときなど）では選ばない
    const back = selected.querySelector<HTMLElement>(
      'button, input, [tabindex]',
    )!;
    await new Promise((r) => setTimeout(r, 600));
    fireEvent.focus(back);
    expect(current().closest('[data-card]')).toBe(other);
  });

  it('W-52c 始める画面: カードを横にスワイプすると前後の構成を選び、端のカードからは外へ送らない', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const card = () => current().closest<HTMLElement>('[data-card]')!;
    const track = card().closest<HTMLElement>('.carousel')!;
    const cards = [...track.querySelectorAll<HTMLElement>('[data-card]')];
    const swipe = (dx: number, dy = 0) => {
      fireEvent.touchStart(card(), {
        touches: [{ clientX: 200, clientY: 300 }],
      });
      fireEvent.touchEnd(card(), {
        changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }],
      });
    };
    // 最初のカードへ
    fireEvent.click(
      document.querySelector(
        `input[name="stack"][value="${cards[0]!.querySelector<HTMLElement>('section[data-stack]')!.dataset.stack}"]`,
      )!,
    );
    swipe(80); // 右へ（前へ）: 端なので動かない
    expect(card()).toBe(cards[0]);
    swipe(-80); // 左へ（次へ）
    expect(card()).toBe(cards[1]);
    swipe(-30); // 短いスワイプは無視
    expect(card()).toBe(cards[1]);
    swipe(-60, 120); // 縦に大きい（縦のスクロール）は無視
    expect(card()).toBe(cards[1]);
    swipe(80);
    expect(card()).toBe(cards[0]);
    // カードの外（ポータルの説明など）で始めたスワイプは構成を替えない（OCL-A3158607）
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.touchStart(outside, {
      touches: [{ clientX: 200, clientY: 300 }],
    });
    fireEvent.touchEnd(outside, {
      changedTouches: [{ clientX: 100, clientY: 300 }],
    });
    expect(card()).toBe(cards[0]);
    outside.remove();
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
    // Free → Paid: 同じカード・同じ図の要素のまま、名前・構成が替わる（説明は ⓘ の中。D-217）。カルーセルは動かさない
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    expect(current()).toBe(card);
    expect(card.closest('[data-card]')).toBe(item);
    expect(card.dataset.stack).toBe('cloudflare-vinext-paid');
    expect(card.getAttribute('aria-label')).toMatch(/^Cloudflare Paid/);
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
    fireEvent.click(card.querySelector('h4')!);
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

  it('W-32 始める画面: シナリオの説明の出来事の詳細は畳んでボタンでダイアログに出し、遊び方と重なる説明は出さない（D-173）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    // 本文には要約だけ（出来事の一覧・改定の説明は出さない）
    expect(screen.getByText(/運営中にイベントが起きます/)).toBeDefined();
    expect(screen.queryByText(/Bot・クローラーが大量に来ます/)).toBeNull();
    expect(screen.queryByText(/実際に予告されている料金/)).toBeNull();
    const open = screen.getByRole('button', { name: 'イベントの詳しい説明' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: '運営中のイベント' });
    expect(dialog.textContent).toContain('Bot・クローラーが大量に来ます');
    expect(dialog.textContent).toContain('実際に予告されている料金');
    // 話題の出来事で登録の確認のメールが集中する（D-117）
    expect(dialog.textContent).toContain('登録の確認のメール');
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
    // 満足度・開発の手間の説明と前置き・料金の前提は遊び方に任せ、始める画面には出さない（D-173）
    expect(
      screen.queryByRole('button', { name: '開発の手間の内訳' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: '満足度の詳しい説明' }),
    ).toBeNull();
    expect(screen.queryByText(/開発の手間は毎月/)).toBeNull();
    expect(document.querySelector('[data-premise-note]')).toBeNull();
    expect(screen.queryByText(/2026-10-31 時点の公式の料金表/)).toBeNull();
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
      /^Astro はこの構成に載せられません.*選ぶとフレームワークは Next\.js（App Router） になります/,
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
      /には Astro を載せる公式のアダプターが無いので、フレームワークを Next\.js（App Router） にしました/,
    );
    // Astro は灰色で選べず、カードに理由が出る
    const astro = getRadio({
      name: /^Astro/,
    }) as HTMLInputElement;
    expect(astro.disabled).toBe(true);
    const astroCard = screen.getByRole('region', { name: 'Astro の説明' });
    expect(astroCard.getAttribute('aria-disabled')).toBe('true');
    expect(within(astroCard).getByRole('note').textContent).toMatch(
      /^選んでいる構成では選べない: 公式のアダプターが無く載せられません（Astro の AWS の手順は/,
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
    expect(stackTab!.getAttribute('title')).toContain(
      '部品をまだ選んでいません',
    );
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
});
