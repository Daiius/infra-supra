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
  it('W-12 始める画面のインフラの構成は、事業者のタブとカードの中のプランで選び、カードに構成図が出る（D-105・D-221）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    showStackTab();
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    // 隠した構成（D-100）は出ず、タブは事業者 5 つ。カードは選んでいるものだけ（D-221）
    expect(
      screen
        .getAllByRole<HTMLInputElement>('radio')
        .filter((r) => r.name === 'stack'),
    ).toHaveLength(5);
    expect(document.querySelectorAll('section[data-stack]').length).toBe(1);
    // 事業者のタブとプランで選ぶ
    fireEvent.click(getRadio({ name: /^Vercel Pro/ }));
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
  });

  it('W-21 始める画面のインフラの構成のタブは事業者で、←/→ は事業者を順に移り、移った先の最初のプランを選ぶ（D-221）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    showStackTab();
    const group = screen.getByRole('radiogroup', { name: '① インフラの構成' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((r) => r.value)).toEqual([
      'cloudflare',
      'vercel',
      'sakura',
      'aws',
      'gcp',
    ]);
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    // プランはカードの中（何のプランかは 1 つだけの事業者でも出す）
    const plans = () =>
      within(current().querySelector<HTMLElement>('[data-plan-chips]')!)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label'));
    expect(plans()).toHaveLength(2);
    // Cloudflare Paid から → で Vercel（最初のプラン）、← で Cloudflare の最初のプランに戻る（前のプランは覚えない）
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(current().dataset.stack).toBe('vercel-supabase-hobby');
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1]!, { key: 'ArrowLeft' });
    expect(current().dataset.stack).toBe('cloudflare-vinext-free');
    fireEvent.click(radios[3]!);
    expect(plans()).toHaveLength(1);
  });

  it('W-26 始める画面のインフラの構成: カードの中のプランのチップはカードの要素を作り直さず中身を替える（D-221）', async () => {
    await renderApp();
    fireEvent.click(getRadio({ name: /^記事コミュニティ/ }));
    fireEvent.click(getRadio({ name: /^Next\.js（App Router）/ }));
    fireEvent.click(getRadio({ name: /^Cloudflare Free/ }));
    const current = () =>
      document.querySelector<HTMLElement>(
        'section[data-stack][aria-current="true"]',
      )!;
    const card = current();
    const diagram = within(card).getByRole('group', { name: /^構成図: / });
    // Free → Paid: 同じカード・同じ図の要素のまま、名前・構成が替わる
    fireEvent.click(getRadio({ name: /^Cloudflare Paid/ }));
    expect(current()).toBe(card);
    expect(card.dataset.stack).toBe('cloudflare-vinext-paid');
    expect(card.getAttribute('aria-label')).toMatch(/^Cloudflare Paid/);
    expect(within(card).getByRole('group', { name: /^構成図: / })).toBe(
      diagram,
    );
    // ほかの事業者を選ぶとその事業者の最初のプラン。戻ると最初のプラン（前に選んだプランは覚えない。D-221）
    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        'input[name="stack"][value="vercel"]',
      )!,
    );
    expect(current().dataset.stack).toBe('vercel-supabase-hobby');
    fireEvent.click(
      document.querySelector<HTMLInputElement>(
        'input[name="stack"][value="cloudflare"]',
      )!,
    );
    expect(current().dataset.stack).toBe('cloudflare-vinext-free');
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
    const stackTab = screen.getByRole('tab', { name: /^インフラ構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^フレームワーク/,
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
    // 印は事業者のタブに付く（D-221）
    showStackTab();
    const aws = within(
      screen.getByRole('radiogroup', { name: '① インフラの構成' }),
    ).getByRole<HTMLInputElement>('radio', { name: /^AWS/ });
    expect(aws.disabled).toBe(false);
    expect(aws.closest('label')?.textContent).toContain(
      'Astro を載せられない構成',
    );
    fireEvent.click(getRadio({ name: /^AWS（Amplify Hosting）/ }));
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
    // Astro は灰色で選べず、タブの印に理由が出る（選んでいないカードは描かない。D-221）
    const astro = getRadio({
      name: /^Astro/,
    }) as HTMLInputElement;
    expect(astro.disabled).toBe(true);
    expect(astro.closest('label')!.textContent).toMatch(
      /公式のアダプターが無く載せられません（Astro の AWS の手順は/,
    );
    // ←/→ でも Astro は飛ばす
    const fw = getRadio({ name: /^Next\.js（App Router）/ });
    for (let k = 0; k < 4; k++) {
      fireEvent.keyDown(fw, { key: 'ArrowRight' });
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
        .getByRole('tab', { name: /^フレームワーク/ })
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
    const stackTab = screen.getByRole('tab', { name: /^インフラ構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^フレームワーク/,
    });
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(fwTab);
    expect(fwTab.getAttribute('aria-selected')).toBe('true');
    screen.getByRole('radiogroup', { name: /^② アプリを何で作りましたか/ });
    fireEvent.keyDown(fwTab, { key: 'ArrowRight' });
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
  });
});
