// @vitest-environment jsdom
// ゲームモードの画面の描画テスト（D-86・prd/05 §7）。画面を描いて操作し、例外が出ない・描ける・選択肢と結果が出ることだけを見る。
// 値（金額・満足度）は game のテストが持つので、ここでは確かめない。
// このファイルで見るもの: 始める画面の部品の選択（構成図の箱・機能ごとのチップ・残りの部品・ⓘ の比較）（App.smoke.test.tsx から分けた）。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useSmokeEnv,
  expectFixedChrome,
  waitLoaded,
  renderApp,
  getRadio,
  pickRadio,
  pickPart,
  showPartsView,
  showStackTab,
  showFrameworkTab,
  openSlot,
  startGame,
  slotGroup,
  openSetupChange,
  expectGameScreen,
  ARTICLE,
  CONTRACT,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

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
      '部品をまだ選んでいません: ISR のキャッシュ・画像・DB・メール送信',
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
    // 見出し・× と下のボタンは固定し、部品の一覧だけスクロールする（D-208）
    expectFixedChrome(dialog);
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
    // 比較のダイアログも見出しと × を固定し、表だけスクロールする（D-208）
    expectFixedChrome(cmp);
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
      'すべて選びました',
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
        name: /^DB：.*、未選択）を替える$/,
      });
    // 印はボタンの外（箱の右上の SVG。foreignObject の中に位置指定の要素を置かない。D-213）
    const dbG = dbBox()!.closest('[data-box]')!;
    expect(dbG.querySelector('[data-unselected-mark]')).not.toBeNull();
    expect(dbG.querySelector('[data-swap-mark]')).toBeNull();
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
    expect(
      box.closest('[data-swappable="true"]')!.querySelector('[data-swap-mark]'),
    ).not.toBeNull();
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
    // 箱のボタンの名前は中身から取る（見えている文字で始める。D-196）
    expect(document.activeElement!.textContent).toMatch(/Supabase.*を替える/);

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
    pickPart('AWS: DynamoDB（リクエスト課金）', db());
    expect(document.activeElement).toBe(
      within(db()).getByRole('button', {
        name: /^DB: AWS: DynamoDB.*（押すと選択肢が開く）$/,
      }),
    );
    expect(current().getAttribute('aria-label')).toBe(
      'Vercel Pro + AWS DynamoDB の構成',
    );
    // 畳んだ並びの上に、押すと開く旨の説明
    expect(parts.textContent).toContain('押すと選択肢が開きます');

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
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'モード' })).getByRole(
        'button',
        { name: '見積' },
      ),
    );
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

  it('W-104 始める画面: 同じ事業者のプランは部品の選択を共有し、今のプランで選べない部品は未選択にして記憶に残し、戻ると戻る（D-176）', async () => {
    await renderApp();
    const HOBBY = 'Vercel Hobby + Supabase Free';
    const PRO = 'Vercel Pro + Supabase Pro';
    const chosen = (slot: string) =>
      slotGroup(slot)
        .querySelector('[data-selected="true"]')
        ?.textContent?.replace(/^[^:]*:/, '')
        .trim() ?? null;
    const cdnRow = () =>
      document.querySelector('section[data-parts] [data-slot="cdnPlan"]');
    pickRadio(ARTICLE);
    pickRadio(HOBBY);
    pickRadio('Next.js（App Router）');
    // Hobby で選んだ部品は Pro でも選ばれている
    pickPart('Neon', slotGroup('DB'));
    pickRadio(PRO);
    expect(chosen('DB')).toMatch(/^Neon/);
    // Pro でだけ選べる部品（CDN の料金のプラン）は、Hobby では出ず、Pro に戻すと戻る
    pickPart('On-demand CDN（従量）', slotGroup('CDN の料金のプラン'));
    pickRadio(HOBBY);
    expect(cdnRow()).toBeNull();
    expect(chosen('DB')).toMatch(/^Neon/);
    // Hobby でほかの部品を選んでも、Pro だけの記憶は消えない
    pickPart('最適化しない', slotGroup('画像'));
    pickRadio(PRO);
    expect(chosen('CDN の料金のプラン')).toMatch(/^On-demand CDN/);
    expect(chosen('画像')).toMatch(/^最適化しない/);
    // 別の組（Cloudflare）に替えて戻ると、それぞれの組の選択が戻る
    pickRadio('Cloudflare Paid');
    expect(slotGroup('DB').hasAttribute('data-unselected')).toBe(true);
    pickPart('D1', slotGroup('DB'));
    pickRadio(HOBBY);
    expect(chosen('DB')).toMatch(/^Neon/);
    pickRadio('Cloudflare Free');
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
      name: /^DB：.*、未選択）を替える$/,
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

    // ゲームの行動の欄: 構成を変えるの欄（D-185）の DB のチップの ⓘ（未選択のスロットは startGame が埋める）
    await startGame({
      scenario: ARTICLE,
      framework: 'Next.js（App Router）',
      stack: 'Vercel Pro + Supabase Pro',
      parts: { DB: 'Supabase（Postgres）' },
    });
    openSetupChange();
    const row = openSlot(slotGroup('DB'));
    const chip = row.querySelector<HTMLElement>('li')!;
    fireEvent.click(within(chip).getByRole('button', { name: /説明$/ }));
    dialog = screen.getByRole('dialog', { name: 'DBを比べる' });
    const rows = dialog.querySelectorAll('tbody[data-option]');
    expect(rows.length).toBeGreaterThan(1);
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
          'AWS: DynamoDB（リクエスト課金）',
          'AWS: Aurora Serverless v2（最小 0.5 ACU）',
          'AWS: Aurora Serverless v2（0 ACU まで縮める）',
        ])
          expect(names.some((x) => x.includes(n))).toBe(true);
        // 名前に Marketplace を入れない（説明文の側。折り返しで右端に離れないように）
        expect(names.some((x) => x.includes('Vercel の Marketplace）'))).toBe(
          false,
        );
        pickPart('AWS: DynamoDB（リクエスト課金）', db);
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
});
