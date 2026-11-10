// @vitest-environment jsdom
// 見積モードの画面の描画テスト（D-86・prd/05 §7）。構成・フレームワーク・テンプレート・PV を切り替えても例外が無く、
// 月の費用・比較表・費用の曲線が出ることだけを見る（金額は model.test.ts と game のテストが持つ）。
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ensurePartsList,
  infoDialog,
  inSetupTabs,
  openSlot,
  renderApp,
  showSetupTab,
  useSmokeEnv,
  waitLoaded,
} from '../smoke.test-helpers.tsx';
import { usd } from '../format.ts';
import { Lines } from './estimate-mode.tsx';
import {
  fromQuery,
  normalizeInput,
  runEstimate,
  withStack,
  type LineView,
} from './model.ts';

useSmokeEnv();

const card = (title: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section')!;
const combo = (label: string) =>
  screen.getByRole('combobox', { name: new RegExp(`^${label}`) });
/** 部品の行（構成のカードのチップ。D-116）・設定のチップ（記事のページの行の描き方の設定・画像の行の設定。D-119）。名前は見出しの文字で始まる。 */
// 部品の行は「機能から選ぶ」の表示のチップ（D-116 の補足）なので、引く前にその表示にする
// ① ② はタブで片方だけ出す（D-116 の補足）ので、今の表示に無ければもう一方のタブを開いて引く
const queryGroup = (label: string) =>
  inSetupTabs(() => {
    ensurePartsList();
    return screen.queryByRole('group', { name: new RegExp(`^${label}`) });
  });
const group = (label: string) =>
  queryGroup(label) ??
  screen.getByRole('group', { name: new RegExp(`^${label}`) });
/** ① 構成・② フレームワークのカルーセルのラジオ（ゲームと共用。D-115）。その欄のタブを開いて引く。 */
const pickerRadios = (name: 'stack' | 'framework') => {
  showSetupTab(name);
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${name}"]`,
    ),
  ];
};
const pickerRadio = (name: 'stack' | 'framework', value: string) =>
  pickerRadios(name).find((r) => r.value === value)!;
/** 構成・フレームワークを選ぶ（タブのラジオを押す）。 */
const pick = (name: 'stack' | 'framework', value: string) => {
  const r = pickerRadio(name, value);
  expect(r.disabled).toBe(false);
  fireEvent.click(r);
  expect(r.checked).toBe(true);
};
/** 枠の中で選んでいる値（選択中のチップの値）。 */
const checked = (label: string) =>
  group(label)
    .querySelector('[data-selected="true"]')
    ?.getAttribute('data-option') ?? undefined;
/** 枠の中で値を選ぶ（チップを押す）。畳んだ部品の行は開いてから押す（D-116 の補足）。 */
const choose = (label: string, value: string) => {
  const chip = openSlot(group(label)).querySelector<HTMLElement>(
    `[data-option="${value}"]`,
  )!;
  fireEvent.click(within(chip).getByRole('button', { pressed: false }));
};

/** ① の選んでいる構成のカード（① のタブを開いて引く）。 */
const stackCard = () => {
  showSetupTab('stack');
  return document.querySelector<HTMLElement>(
    'section[data-stack][aria-current="true"]',
  )!;
};
/** ② の選んでいるフレームワークのカード（② のタブを開いて引く）。 */
const fwCard = () => {
  showSetupTab('framework');
  return document.querySelector<HTMLElement>(
    'section[data-framework][aria-current="true"]',
  )!;
};
/** ② のカードの「詳しく比べる」のダイアログ（閉じていれば開く。D-115 で下の表のカードの代わり）。 */
const routesDialog = () => {
  if (!screen.queryByRole('dialog'))
    fireEvent.click(
      within(fwCard()).getByRole('button', { name: '詳しく比べる' }),
    );
  const dialog = screen.getByRole('dialog', {
    name: /^ページの描き方を比べる/,
  });
  // 表の注記は見積用の文（ゲームの「1 か月目の基準の規模」を出さない。D-115）
  expect(dialog.textContent).toContain('費用の差は今の条件（月の PV）での目安');
  expect(dialog.textContent).not.toContain('1 か月目の基準の規模');
  return dialog;
};
const routesTable = () =>
  within(routesDialog()).getByRole('table', { name: 'ページごとの描き方' });
/** 構成図の流れの凡例（① の選んでいる構成のカード）。 */
const flowLegend = () =>
  within(stackCard()).getByRole('list', { name: '構成図の流れの凡例' })
    .textContent;

/** 月の費用・明細・比較表・費用の曲線が出ていることを見て、今の構成の名前を返す。 */
function expectEstimate(): string {
  const title = screen.getByRole('heading', { level: 2, name: /^月の費用: / });
  expect(
    within(card(/^月の費用: /)).getByText(/^\$[\d,]+\.\d\d$/),
  ).toBeDefined();
  expect(
    within(card('明細（事業者・メーターごと）')).getAllByRole('row').length,
  ).toBeGreaterThan(1);
  const compare = within(card('構成を比べる'));
  // 見出しの行 + 載せられる構成（2 つ以上）。今の構成の行が 1 つだけ印される
  expect(compare.getAllByRole('row').length).toBeGreaterThan(2);
  expect(
    compare
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'true'),
  ).toHaveLength(1);
  // 構成図（D-105）: ① の選んでいる構成のカードに今の構成の図が出る（下の構成図のカードは重複なので消した。D-115）。
  // 部品の表示を「機能から選ぶ」にしていれば、図の代わりにチップの一覧（D-116 の補足）
  if (stackCard().querySelector('[data-parts-view="list"]'))
    expect(stackCard().querySelector('section[data-parts]')).not.toBeNull();
  else
    expect(stackCard().querySelectorAll('[data-node]').length).toBeGreaterThan(
      1,
    );
  // ページごとの描き方（D-106）: ② の選んでいるカードにテンプレートのページごとの欄（下の表のカードは消した。D-115）
  expect(
    fwCard().querySelectorAll('section[data-route]').length,
  ).toBeGreaterThan(0);
  const curve = within(card('費用の曲線（月の PV を振る）'));
  const chart = curve.getByRole('img', {
    name: '月の PV ごとの月額（構成ごと）',
  });
  // 線の区間（止まる区間は薄い破線。D-180）
  expect(chart.querySelectorAll('[data-segment]').length).toBeGreaterThan(0);
  return title.textContent!.replace(/^月の費用: /, '');
}

describe('見積モードの画面', () => {
  it('W-05 見積を描き、構成・フレームワーク・テンプレート・PV を切り替える', async () => {
    await renderApp();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'モード' })).getByRole(
        'button',
        { name: '見積' },
      ),
    );
    await waitLoaded();
    const first = expectEstimate();

    // 構成を切り替える（ゲームと同じカルーセル。選べる構成をすべて回す。D-115）
    const stacks = pickerRadios('stack').map((r) => r.value);
    expect(stacks.length).toBeGreaterThan(5);
    const names = new Set([first]);
    for (const id of stacks) {
      pick('stack', id);
      names.add(expectEstimate());
      // 構成のカードに、その構成の月額が出る
      expect(
        document.querySelector(`[data-stack-total="${id}"]`)?.textContent,
      ).toMatch(/月 \$[\d,]+\.\d\d/);
    }
    expect(names.size).toBe(stacks.length);

    // 比較表の行を押すと、その構成の見積になり、カルーセルもその構成へ移る
    const compare = within(card('構成を比べる'));
    const other = compare
      .getAllByRole('button')
      .find(
        (b) => b.closest('td') && b.getAttribute('aria-current') !== 'true',
      )!;
    const picked = other.textContent;
    fireEvent.click(other);
    expectEstimate();
    const current = within(card('構成を比べる'))
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-current') === 'true')!;
    expect(current.textContent).toBe(picked);
    const stackId = new URLSearchParams(window.location.search).get('s')!;
    expect(pickerRadio('stack', stackId).checked).toBe(true);

    // フレームワーク・テンプレート・PV を切り替える
    for (const id of pickerRadios('framework')
      .filter((r) => !r.disabled)
      .map((r) => r.value)) {
      pick('framework', id);
      expectEstimate();
    }
    fireEvent.change(combo('テンプレート'), { target: { value: 'business' } });
    expectEstimate();
    fireEvent.click(screen.getByRole('button', { name: '10M' }));
    expectEstimate();

    // 入力は URL に残り、その URL で開き直すと同じ条件の見積になる（共有のため）
    expect(window.location.search).toContain('t=business');
    const name = expectEstimate();
    cleanup();
    await renderApp();
    expect((combo('テンプレート') as HTMLSelectElement).value).toBe('business');
    expect(expectEstimate()).toBe(name);
  });

  it('W-06 選んでも変わらない部品は出さない（D1 の構成に DB のバックアップの欄が無い。始める画面と同じ判定。D-94）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=cloudflare-vinext-paid&c.dbBackup=pitr',
    );
    await renderApp();
    expectEstimate();
    expect(queryGroup('DB のバックアップ')).toBe(null);
    // URL に残っていた値は無視して既定にする（URL からも消える）
    expect(window.location.search).not.toContain('dbBackup');

    // 選べば変わる DB（Supabase Pro）に替えると出る
    pick('stack', 'vercel-supabase-pro');
    expectEstimate();
    expect(checked('DB のバックアップ')).toBe('default');
  });

  it('W-08 Astro × CF Free: 1 リクエストの CPU の上限の前提に、当たるルートを添える（D-99。D-103 で記事のページも描き直しの閲覧が当たる）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-free',
    );
    await renderApp();
    expectEstimate();
    expect(
      screen.getByText(
        /^記事のページ（ISR の閲覧と作り直し・CPU [\d.]+ ms）・個人向けのページ（SSR・CPU [\d.]+ ms）が Workers Free の 1 リクエスト 10 ms を超えます$/,
      ),
    ).toBeDefined();
    // ページごとの描き方（D-107）: 個人向けを枠 + API にすると URL に残り、その行は CPU の制限に当たらない
    const routes = within(routesDialog());
    fireEvent.click(
      routes.getByRole('button', {
        name: /^個人向けのページを Client Islands/,
      }),
    );
    expect(window.location.search).toContain('rp.personal=shell-api');
    const row = routesTable().querySelector('tr[data-route="personal"]')!;
    expect(
      row.querySelector('[data-strategy]')!.getAttribute('data-strategy'),
    ).toBe('shell-api');
    expect(
      row.querySelector('[data-check="cpu"]')!.getAttribute('data-ok'),
    ).toBe('true');
    expectEstimate();
  });

  it('W-22 フレームワーク・構成を替えると、選んでいない再検証・記事のキャッシュは替えた先の既定になり、選べない描き方は URL から消える（D-103・D-107）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-paid&r=300',
    );
    await renderApp();
    expectEstimate();
    expect(checked('ISR の再検証')).toBe('300');
    // Astro の既定は、消せる置き場（Cloudflare）ではオンデマンド
    pick('framework', 'astro');
    expectEstimate();
    expect(checked('記事のキャッシュ')).toBe('0');
    expect(new URLSearchParams(window.location.search).get('r')).toBe('0');
    // 消せない置き場（Google Cloud）では 5 分
    pick('stack', 'gcp-cloud-run');
    expectEstimate();
    expect(checked('記事のキャッシュ')).toBe('300');
    // 選んだ値は、替えた先で選べるなら残る
    choose('記事のキャッシュ', '3600');
    pick('stack', 'cloudflare-vinext-paid');
    expectEstimate();
    expect(checked('記事のキャッシュ')).toBe('3600');

    // 記事を S1 にしてから vinext に替えても、rp.article は残る（vinext の S1 を出した。RS-15 の解除）。SPA（S1 が無い）に替えると消える
    cleanup();
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-free&rp.article=static-build&rp.personal=shell-api',
    );
    await renderApp();
    expectEstimate();
    expect(window.location.search).toContain('rp.article=static-build');
    pick('framework', 'nextjs');
    expectEstimate();
    expect(window.location.search).toContain('rp.article=static-build');
    expect(window.location.search).toContain('rp.personal=shell-api');
    pick('framework', 'vite-spa');
    expectEstimate();
    expect(window.location.search).not.toContain('rp.article');
  });

  it('W-23 個人向けのページを S6（枠 + サーバーの島）にすると URL に残り、構成図に島の流れが出る。使えない構成（vinext）に替えると消える（D-108）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    const routes = within(routesDialog());
    fireEvent.click(
      routes.getByRole('button', {
        name: /^個人向けのページを Partial Prerendering（PPR）/,
      }),
    );
    expect(window.location.search).toContain('rp.personal=server-island');
    const row = routesTable().querySelector('tr[data-route="personal"]')!;
    expect(
      row.querySelector('[data-strategy]')!.getAttribute('data-strategy'),
    ).toBe('server-island');
    // 描き方の列は選んでいるもの（S6）も含めて S1〜S6 の順に並び、S6 が選択中になる
    const chips = [...row.querySelectorAll('[data-alternative]')];
    const order = chips.map((x) => x.getAttribute('data-alternative'));
    expect(order).toContain('server-island');
    expect(order).toContain('ssr');
    expect(order.indexOf('ssr')).toBeLessThan(order.indexOf('server-island'));
    expect(
      chips
        .filter((x) => x.getAttribute('data-selected') === 'true')
        .map((x) => x.getAttribute('data-alternative')),
    ).toEqual(['server-island']);
    expect(
      within(row as HTMLElement)
        .getByRole('button', {
          name: '個人向けのページは Partial Prerendering（PPR）（選択中）',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expectEstimate();
    expect(flowLegend()).toContain('人ごとの部分（閲覧ごとにサーバーで描く）');
    // URL から開いても同じ。vinext（PPR が未完成）に替えると選べないので消える
    cleanup();
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro&rp.personal=server-island',
    );
    await renderApp();
    expectEstimate();
    expect(window.location.search).toContain('rp.personal=server-island');
    pick('stack', 'cloudflare-vinext-paid');
    expectEstimate();
    expect(window.location.search).not.toContain('rp.personal');
  });

  it('W-24 Vercel × Next.js の既定は部品ごとにキャッシュ（番号を出さない）。構成図に動的な穴の流れが出て、毎回描くを選ぶと URL に残る（D-111）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    const table = () => routesTable();
    const strategyOf = (route: string) =>
      table()
        .querySelector(`tr[data-route="${route}"] [data-strategy]`)!
        .getAttribute('data-strategy');
    expect(strategyOf('article')).toBe('cache-components');
    expect(strategyOf('personal')).toBe('cache-components');
    expect(table().textContent).toContain('Cache Components');
    // 描き方の番号（S1〜S6・文書の S7）は画面に出さない（D-112）
    expect(table().textContent).not.toMatch(/\bS[1-7]\b/);
    expect(window.location.search).not.toContain('rp.');
    expect(flowLegend()).toContain('閲覧ごとに描く部分');
    fireEvent.click(
      within(routesDialog()).getByRole('button', {
        name: /^個人向けのページを Dynamic rendering/,
      }),
    );
    expectEstimate();
    expect(window.location.search).toContain('rp.personal=ssr');
    expect(strategyOf('personal')).toBe('ssr');
    // VPS に替えると既定（毎回描く）と同じなので URL から消え、部品ごとにキャッシュは選べる側に並ぶ
    pick('stack', 'sakura-vps-2gb');
    expectEstimate();
    expect(window.location.search).not.toContain('rp.personal');
    expect(strategyOf('personal')).toBe('ssr');
    expect(
      within(routesDialog()).getByRole('button', {
        name: /^個人向けのページを Cache Componentsにする/,
      }),
    ).toBeTruthy();
  });

  it('W-56 ① 構成と ② フレームワークはタブで切り替え、見出しに今の選択と付け替えの印が出て、替えても選択は残る（D-116 の補足）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-paid',
    );
    await renderApp();
    const stackTab = screen.getByRole('tab', { name: /^① インフラの構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^② フレームワークと描き方/,
    });
    // 既定は ①。② のタブに今のフレームワーク、① のタブに今の構成
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    expect(fwTab.textContent).toContain('Astro');
    expect(stackTab.textContent).toContain('Cloudflare Paid');
    expect(
      screen.queryByRole('radiogroup', {
        name: '② アプリのフレームワークとページの描き方',
      }),
    ).toBeNull();
    // 部品を選んでから ② を開き、① に戻っても残る（URL にも残る）
    ensurePartsList();
    const row = document.querySelector<HTMLElement>(
      'section[data-parts] [data-slot]',
    )!;
    const slot = row.getAttribute('data-slot')!;
    const picked = () =>
      document
        .querySelector(
          `section[data-parts] [data-slot="${slot}"] [data-selected="true"]`,
        )
        ?.getAttribute('data-option');
    const other = [
      ...openSlot(row).querySelectorAll<HTMLElement>('[data-option]'),
    ].find((c) => c.getAttribute('data-selected') !== 'true')!;
    const chosen = other.getAttribute('data-option')!;
    fireEvent.click(within(other).getByRole('button', { pressed: false }));
    expect(picked()).toBe(chosen);
    expect(new URLSearchParams(window.location.search).get(`c.${slot}`)).toBe(
      chosen,
    );
    fireEvent.click(fwTab);
    expect(
      screen.queryByRole('radiogroup', { name: '① インフラの構成' }),
    ).toBeNull();
    expect(localStorage.getItem('infra-supra:setup-tab:estimate')).toBe(
      'framework',
    );
    // 欄の中の見出しは画面から隠し、radiogroup の名前には残す
    expect(
      screen.getByRole('heading', {
        name: '② アプリのフレームワークとページの描き方',
      }).className,
    ).toContain('sr-only');
    screen.getByRole('radiogroup', {
      name: '② アプリのフレームワークとページの描き方',
    });
    // ゲームの始める画面とは別に覚える
    expect(localStorage.getItem('infra-supra:setup-tab:game')).toBeNull();
    fireEvent.keyDown(fwTab, { key: 'ArrowRight' });
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    expect(picked()).toBe(chosen);
    // Astro を載せられない構成を選ぶと、② のタブに付け替えの印（① を開いたまま）
    expect(fwTab.querySelector('[data-setup-tab-warn]')).toBeNull();
    pick('stack', 'aws-amplify');
    expect(stackTab.getAttribute('aria-selected')).toBe('true');
    expect(fwTab.textContent).toContain('Next.js（App Router）');
    expect(fwTab.querySelector('[data-setup-tab-warn]')).not.toBeNull();
    expect(fwTab.getAttribute('title')).toMatch(/公式のアダプターが無いので/);
    // 隠れた ② の知らせはパネルの外の aria-live で読む（OCL-B12E7ACB）
    expect(
      document.querySelector('[data-setup-tab-live]')!.textContent,
    ).toMatch(/公式のアダプターが無いので/);
    // 載せられる構成へ戻すと知らせも印も消える
    pick('stack', 'cloudflare-vinext-paid');
    expect(fwTab.querySelector('[data-setup-tab-warn]')).toBeNull();
  });

  it('W-35 選択の欄はゲームと共用（D-115）: 構成が先で、載せられないフレームワークは灰色と理由。Astro で AWS を選ぶと Next.js に替えて知らせる', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-paid',
    );
    await renderApp();
    expectEstimate();
    // 順: ① インフラの構成（部品のチップはカードの中。D-116） → ② フレームワーク（描き方の設定は記事のページの行。D-119）。
    // タブで切り替え、タブの並びもこの順（D-116 の補足）
    const stackTab = screen.getByRole('tab', { name: /^① インフラの構成/ });
    const fwTab = screen.getByRole('tab', {
      name: /^② フレームワークと描き方/,
    });
    expect(
      stackTab.compareDocumentPosition(fwTab) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    showSetupTab('stack');
    screen.getByRole('radiogroup', { name: '① インフラの構成' });
    showSetupTab('framework');
    screen.getByRole('radiogroup', {
      name: '② アプリのフレームワークとページの描き方',
    });
    // Astro を載せられない構成も隠さず選べる。カードの月額は替わる先のフレームワークで数える
    expect(pickerRadio('stack', 'aws-amplify').disabled).toBe(false);
    expect(
      document.querySelector('[data-stack-total="aws-amplify"]')?.textContent,
    ).toContain('Next.js（App Router） にしたとき');
    pick('stack', 'aws-amplify');
    expectEstimate();
    expect(pickerRadio('framework', 'nextjs').checked).toBe(true);
    expect(new URLSearchParams(window.location.search).get('fw')).toBe(
      'nextjs',
    );
    expect(document.body.textContent).toMatch(
      /には Astro を載せる公式のアダプターが無いので、フレームワークを Next\.js（App Router） にしました/,
    );
    // Astro は灰色で選べず、カードに理由が出る
    expect(pickerRadio('framework', 'astro').disabled).toBe(true);
    const astroCard = screen.getByRole('region', { name: 'Astro の説明' });
    expect(astroCard.getAttribute('aria-disabled')).toBe('true');
    expect(within(astroCard).getByRole('note').textContent).toMatch(
      /^選んでいる構成では選べない: 公式のアダプターが無く載せられません/,
    );
    // 選んでいるフレームワークのカードに、ページの見取り図が出る
    const nextCard = screen.getByRole('region', {
      name: 'Next.js（App Router） の説明',
    });
    expect(
      nextCard.querySelectorAll('section[data-route]').length,
    ).toBeGreaterThan(0);
    // 載せられる構成へ戻すと Astro はまた選べ、知らせは消える
    pick('stack', 'cloudflare-vinext-paid');
    expect(pickerRadio('framework', 'astro').disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(
      /公式のアダプターが無いので、フレームワークを/,
    );
    // 選んでいるカードのチップで描き方を選ぶと、URL と下の表にも残る（同じ書き換え。D-112・D-115）
    fireEvent.click(
      within(
        screen.getByRole('region', { name: 'Next.js（App Router） の説明' }),
      ).getByRole('button', {
        name: /^個人向けのページを Client-side data fetching/,
      }),
    );
    expectEstimate();
    expect(window.location.search).toContain('rp.personal=shell-api');
    expect(
      routesTable()
        .querySelector('tr[data-route="personal"] [data-strategy]')!
        .getAttribute('data-strategy'),
    ).toBe('shell-api');
  });

  it('W-36 載せられない構成のカードは、選んだ後に残る描き方で注意を出す（見積は替えた先で選べる描き方を残す。OCL-00BB1F11）', async () => {
    const url =
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-paid&rp.article=static-build&rp.personal=shell-api';
    window.history.replaceState(null, '', url);
    await renderApp();
    expectEstimate();
    const cur = normalizeInput(fromQuery(url.slice(url.indexOf('?'))));
    const after = normalizeInput({ ...cur, ...withStack(cur, 'aws-amplify') });
    const chosen = Object.keys(cur.routes);
    expect(chosen.length).toBe(2);
    const dropped = chosen.filter((r) => after.routes[r] === undefined).length;
    showSetupTab('stack');
    const note = within(
      document.querySelector<HTMLElement>('section[data-stack="aws-amplify"]')!,
    ).getByRole('note').textContent!;
    if (dropped === 0) expect(note).not.toContain('既定に戻る');
    else if (dropped === chosen.length)
      expect(note).toContain('（選んだページの描き方は既定に戻る）');
    else expect(note).toContain('替えた先で選べないものは既定に戻る');
    // 選ぶと、カードの注意のとおりの描き方が URL に残る
    pick('stack', 'aws-amplify');
    expectEstimate();
    for (const r of chosen)
      expect(window.location.search.includes(`rp.${r}=`)).toBe(
        after.routes[r] !== undefined,
      );
  });

  it('W-07 見出しに ⓘ のある欄の入力は、見出しの文字だけを名前に持つ（ボタンの名前が混ざらない。D-94）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=business&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    // ⓘ のある条件の欄（月の PV・チームの人数）を、見出しの文字そのもので取れる
    expect(screen.getByRole('spinbutton', { name: '月の PV' }).tagName).toBe(
      'INPUT',
    );
    expect(
      screen.getByRole('spinbutton', {
        name: 'チームの人数（管理画面を使う人）',
      }).tagName,
    ).toBe('INPUT');
    // 部品（DB のバックアップ）はゲームと同じ、構成のカードのチップの行（D-115・D-116）
    expect(
      within(openSlot(group('DB のバックアップ'))).getAllByRole('button', {
        pressed: false,
      }).length,
    ).toBeGreaterThan(0);
  });
  it('W-38 DB を他の事業者に替えると、構成のカードの題・月の費用の見出しが実際の組になる（Neon は D-77・AWS は D-114 段 2）', async () => {
    for (const [db, name] of [
      ['dynamodb', 'Vercel Pro + AWS DynamoDB'],
      ['neon', 'Vercel Pro + Neon（Launch）'],
    ] as const) {
      window.history.replaceState(
        null,
        '',
        `/?mode=estimate&t=article&s=vercel-supabase-pro&c.db=${db}`,
      );
      await renderApp();
      expect(expectEstimate()).toContain(name);
      expect(stackCard().getAttribute('aria-label')).toBe(`${name} の構成`);
      cleanup();
    }
  });
  it('W-39 部品は構成図の箱か機能ごとのチップで選び、URL・月の費用・カードの題が替わる（D-116 とその補足）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    // 前の ③ 部品の欄は無く、部品は選んでいる構成のカードの中。最初は構成図の表示（チップの一覧は出さない）
    expect(screen.queryByRole('heading', { name: '③ 部品' })).toBeNull();
    expect(stackCard().querySelector('section[data-parts]')).toBeNull();
    // 見積は全部のスロットが埋まっていて、図の箱にも段の箱にも「未選択」の印は出ない（D-116 の補足）
    const diagram = stackCard().querySelector('[data-diagram="system"]')!;
    expect(diagram.querySelector('[data-swap-mark]')).not.toBeNull();
    expect(diagram.querySelector('[data-unselected-mark]')).toBeNull();
    // メールの送信は図の一番下の段の箱から選べる
    expect(
      diagram.querySelector('[data-diagram-band] [data-slots~="email"] button'),
    ).not.toBeNull();
    // 図の DB の箱（Supabase）を押して、吹き出しから Neon に替える
    const dbBox = () =>
      stackCard().querySelector<HTMLElement>(
        '[data-swappable][data-slots~="db"] button',
      )!;
    expect(dbBox().getAttribute('aria-label')).toMatch(/Supabase.*を替える$/);
    fireEvent.click(dbBox());
    const popover = screen.getByRole('dialog', { name: /を替える$/ });
    fireEvent.click(
      within(
        within(popover).getByRole('group', { name: 'DBを替える' }),
      ).getByRole('button', { name: /^Neon/, pressed: false }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('c.db')).toBe(
      'neon',
    );
    expect(expectEstimate()).toContain('Vercel Pro + Neon（Launch）');
    expect(stackCard().getAttribute('aria-label')).toBe(
      'Vercel Pro + Neon（Launch） の構成',
    );
    // focus は DB の今の箱（Neon）へ（元の Supabase の箱は消える。OCL-131BD89D）
    expect(document.activeElement).toBe(dbBox());
    expect(dbBox().getAttribute('aria-label')).toMatch(/Neon.*を替える$/);
    // 「機能から選ぶ」にすると、図の代わりにチップの一覧（全部の行が畳まれ、未選択は無い）
    fireEvent.click(
      within(stackCard()).getByRole('button', { name: '機能から選ぶ' }),
    );
    expect(stackCard().querySelector('[data-diagram="system"]')).toBeNull();
    const parts = stackCard().querySelector('section[data-parts]')!;
    expect(parts.querySelector('[data-unselected]')).toBeNull();
    // 名前は正規表現の頭（「DB のバックアップ」の行に当てない）
    const DB = 'DB(?! のバックアップ)';
    expect(checked(DB)).toBe('neon');
    // チップで DynamoDB にする
    choose(DB, 'dynamodb');
    expect(checked(DB)).toBe('dynamodb');
    expect(document.activeElement).toBe(
      group(DB).querySelector('[data-collapsed-toggle]'),
    );
    expect(new URLSearchParams(window.location.search).get('c.db')).toBe(
      'dynamodb',
    );
    expect(stackCard().getAttribute('aria-label')).toBe(
      'Vercel Pro + AWS DynamoDB の構成',
    );
  });

  it('W-40 Vercel Pro の $20 のクレジットは「超過」に数えず、消費として見せる（超えた分は従量で請求）', async () => {
    window.history.replaceState(
      null,
      '',
      // CDN の料金は従量（既定の Flat Rate CDN ではクレジットを超えない。D-120）
      '/?mode=estimate&t=article&pv=1300000&fw=nextjs&s=vercel-supabase-pro&c.cdnPlan=on-demand',
    );
    await renderApp();
    expectEstimate();
    const heading = screen.getByRole('heading', {
      level: 3,
      name: /^上限と課金の境目/,
    });
    // クレジットの消費の行は出る。「超過」の赤い印にはならず、見出しの超過の件数にも入らない
    const use = screen.getByText(
      /^\$20\.00 のクレジットのうち \$[\d.,]+ 分を使用（超えた分 \$[\d.,]+ は従量で請求）$/,
    );
    const row = use.closest('li')!;
    expect(within(row).getByText('付属クレジットの消費')).toBeDefined();
    expect(within(row).queryByText('超過')).toBeNull();
    expect(row.querySelector('.badge-error, .progress-error')).toBeNull();
    expect(heading.textContent).not.toMatch(/超過 [1-9]\d* 件/);
    // バー全体が使った額: クレジットの分（青）と超えた分（淡い色）の幅が比のとおり
    const w = (part: string) =>
      parseFloat(
        row.querySelector<HTMLElement>(`[data-part="${part}"]`)!.style.width,
      );
    const [limit, used] = [...use.textContent!.matchAll(/\$([\d.,]+)/g)].map(
      (m) => parseFloat(m[1]!.replace(/,/g, '')),
    ) as [number, number];
    expect(w('credit') + w('over')).toBeCloseTo(100, 5);
    expect(w('over')).toBeGreaterThan(w('credit'));
    expect(w('credit')).toBeCloseTo((limit / used) * 100, 1);
  });
  it('W-45 描き方の設定は ② のカードの記事のページの行、画像の形式・サイズ違いは ① の画像の行で選び、URL と月の費用が替わる（D-119）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-paid&r=300&c.isrCache=kv',
    );
    await renderApp();
    expectEstimate();
    const q = () => new URLSearchParams(window.location.search);
    // ③ 設定の欄は無い（画像の行のある構成では空になる）
    expect(screen.queryByRole('heading', { name: '③ 設定' })).toBeNull();
    const article = document.querySelector<HTMLElement>(
      'section[data-framework][aria-current="true"] section[data-route="article"]',
    )!;
    const isr = within(article).getByRole('group', { name: 'ISR の再検証' });
    expect(isr.getAttribute('data-setting')).toBe('isr');
    choose('ISR の再検証', '3600');
    expect(q().get('r')).toBe('3600');
    expect(checked('ISR の再検証')).toBe('3600');
    // ISR を KV に置くとオンデマンドは届かないので灰色（理由は ⓘ）。R2 にすると選べる
    expect(
      isr.querySelector('[data-option="0"]')!.getAttribute('data-available'),
    ).toBe('false');
    choose('ISR のキャッシュ', 'r2');
    expect(q().get('c.isrCache')).toBe('r2');
    // オンデマンドにすると記事のページは更新で消すになる（同じ設定）
    choose('ISR の再検証', '0');
    expect(q().get('r')).toBe('0');
    expect(
      article
        .querySelector('[data-alternative][data-selected="true"]')
        ?.getAttribute('data-alternative'),
    ).toBe('cached-purge');
    // 画像の形式・サイズ違いは画像の部品の行の中（畳んだ行を開くと出る。D-116 の補足）
    showSetupTab('stack');
    const images = document.querySelector<HTMLElement>(
      'section[data-parts] [data-slot="images"]',
    )!;
    expect(images.getAttribute('data-collapsed')).toBe('true');
    expect(
      within(images).queryByRole('group', { name: '画像の形式' }),
    ).toBeNull();
    openSlot(images);
    expect(
      within(images).getByRole('group', { name: '画像の形式' }),
    ).toBeDefined();
    const before = card(/^月の費用/).textContent;
    choose('画像の形式', 'avif');
    expect(q().get('img')).toBe('avif');
    choose('画像のサイズ違い', '1');
    expect(q().get('v')).toBe('1');
    expectEstimate();
    expect(card(/^月の費用/).textContent).not.toBe(before);
    // 構成図の表示では、画像の箱の吹き出しの中で選ぶ（D-116 の補足）
    fireEvent.click(
      within(stackCard()).getByRole('button', { name: '構成図から選ぶ' }),
    );
    fireEvent.click(
      stackCard().querySelector<HTMLElement>('[data-slots~="images"] button')!,
    );
    const popover = screen.getByRole('dialog', { name: /を替える$/ });
    within(popover).getByRole('group', { name: '画像を替える' });
    const format = within(popover).getByRole('group', { name: '画像の形式' });
    expect(
      format
        .querySelector('[data-selected="true"]')
        ?.getAttribute('data-option'),
    ).toBe('avif');
    fireEvent.click(
      within(
        format.querySelector<HTMLElement>('[data-option="webp"]')!,
      ).getByRole('button'),
    );
    expect(q().get('img')).toBe('webp');
    expectEstimate();
  });

  it('W-52 閲覧のときに形式を選ぶ画像の部品では、画像の形式の欄は選べず固定の形式と理由を出す（D-58 の補足）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro&img=avif',
    );
    await renderApp();
    group('画像(?!の)'); // 「機能から選ぶ」の表示にする
    // 画像の部品の行（畳んでいれば開く）の中の形式の欄
    const format = () =>
      within(
        openSlot(
          document.querySelector<HTMLElement>(
            'section[data-parts] [data-slot="images"]',
          )!,
        ),
      ).getByRole('group', { name: '画像の形式' });
    const selected = () =>
      format()
        .querySelector('[data-selected="true"]')
        ?.getAttribute('data-option');
    // next/image は WebP に固定（URL の AVIF は残るが、数えるのは WebP）
    expect(selected()).toBe('webp');
    expect(format().textContent).toContain('今は効かない');
    expect(format().textContent).toContain('next/image');
    for (const id of ['jpeg', 'avif'])
      expect(
        format()
          .querySelector(`[data-option="${id}"]`)!
          .getAttribute('data-available'),
      ).toBe('false');
    // 画像だけ Cloudflare（URL の format=auto）は AVIF に固定
    choose('画像(?!の)', 'cf-images');
    expect(selected()).toBe('avif');
    expect(format().textContent).toContain('format=auto');
    // 投稿のときに一律で縮める（S3）は選べる
    choose('画像(?!の)', 'aws-s3-resize');
    expect(format().textContent).not.toContain('今は効かない');
    expect(selected()).toBe('avif');
    expectEstimate();
  });

  it('W-105 同じ事業者のプランは部品の選択を共有し、今のプランで選べない部品は記憶に残して戻ると戻る。比較の表も同じ選択で数える（D-176）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-hobby',
    );
    await renderApp();
    const q = () => new URLSearchParams(window.location.search);
    const DB = 'DB(?! のバックアップ)';
    const CDN = 'CDN の料金のプラン';
    choose(DB, 'neon');
    pick('stack', 'vercel-supabase-pro');
    expect(checked(DB)).toBe('neon');
    expect(q().get('c.db')).toBe('neon');
    choose(CDN, 'on-demand');
    expect(q().get('c.cdnPlan')).toBe('on-demand');
    // Hobby には CDN の料金のプランが無い（URL にも出ない）
    pick('stack', 'vercel-supabase-hobby');
    expect(queryGroup(CDN)).toBeNull();
    expect(q().get('c.cdnPlan')).toBeNull();
    expect(checked(DB)).toBe('neon');
    // 選んでいない Pro のカードの月額・比較の表の行は、戻った後の見積と同じ
    const proRow = within(card('構成を比べる')).getByRole('row', {
      name: /Vercel Pro \+ Neon/,
    });
    const rowText = proRow.textContent;
    // Hobby でほかの部品を選んでも、Pro だけの記憶は消えない
    pick('stack', 'vercel-supabase-pro');
    expect(checked(CDN)).toBe('on-demand');
    expect(checked(DB)).toBe('neon');
    expect(rowText).toContain(
      within(card(/^月の費用: /)).getByText(/^\$[\d,]+\.\d\d$/).textContent,
    );
    // 別の組（Cloudflare）に替えて戻ると、それぞれの組の選択が戻る
    pick('stack', 'cloudflare-vinext-paid');
    choose(DB, 'dynamodb');
    pick('stack', 'vercel-supabase-hobby');
    expect(checked(DB)).toBe('neon');
    pick('stack', 'cloudflare-vinext-free');
    expect(checked(DB)).toBe('dynamodb');
    expectEstimate();
  });

  it('W-51 構成を替えても部品の選択は構成ごとに覚えていて、戻ると戻る。URL は今の構成の分だけ・フレームワークで選べなくなったものだけ落ちる（D-116 の補足）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-paid',
    );
    await renderApp();
    const q = () => new URLSearchParams(window.location.search);
    const DB = 'DB(?! のバックアップ)';
    choose(DB, 'dynamodb');
    choose('ISR のキャッシュ', 'r2');
    expect(q().get('c.db')).toBe('dynamodb');
    // 構成 B は既定の部品から（A の選択は混ざらず、URL も B の部品）
    pick('stack', 'vercel-supabase-pro');
    expect(checked(DB)).toBe('supabase');
    expect(q().get('c.db')).toBe('supabase');
    choose(DB, 'neon');
    // A に戻ると A の選択が戻る（B の Neon は混ざらない）
    pick('stack', 'cloudflare-vinext-paid');
    expect(checked(DB)).toBe('dynamodb');
    expect(checked('ISR のキャッシュ')).toBe('r2');
    expect(q().get('c.db')).toBe('dynamodb');
    // 選んでいない B のカードは覚えている部品（Neon）で題・月額を出し、比較の表の行も同じ（D-116 の補足）
    const bCard = document.querySelector<HTMLElement>(
      'section[data-stack="vercel-supabase-pro"]',
    )!;
    expect(bCard.getAttribute('aria-label')).toBe(
      'Vercel Pro + Neon（Launch） の構成',
    );
    expect(bCard.textContent).toContain('前にこの構成で選んだ部品');
    const bRow = within(card('構成を比べる')).getByRole('row', {
      name: /Vercel Pro \+ Neon/,
    });
    const rowText = bRow.textContent;
    pick('stack', 'vercel-supabase-pro');
    expect(rowText).toContain(
      within(card(/^月の費用: /)).getByText(/^\$[\d,]+\.\d\d$/).textContent,
    );
    pick('stack', 'cloudflare-vinext-paid');
    // B に戻ると B の選択が戻る
    pick('stack', 'vercel-supabase-pro');
    expect(checked(DB)).toBe('neon');
    expect(q().get('c.db')).toBe('neon');
    // B の上でフレームワークを Vite（ISR が無い）にしてから A に戻ると、A の ISR のキャッシュだけが落ち、DB は残る
    pick('framework', 'vite-spa');
    pick('stack', 'cloudflare-vinext-paid');
    expect(checked(DB)).toBe('dynamodb');
    expect(queryGroup('ページのキャッシュ')).toBeNull();
    expect(queryGroup('ISR のキャッシュ')).toBeNull();
    // Next.js に戻しても落ちた ISR のキャッシュは復活しない（既定の KV）
    pick('framework', 'nextjs');
    expect(checked('ISR のキャッシュ')).toBe('kv');
    expect(checked(DB)).toBe('dynamodb');
    expectEstimate();
  });

  it('W-60 税込の目安は合計の円の横に常に出し、事業者ごとの扱いと出典は ⓘ に出す。前の版の tax=0 の URL でも出る（D-177）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&s=aws-amplify&pv=1000000&tax=0',
    );
    await renderApp();
    expectEstimate();
    const total = within(card(/^月の費用: /));
    // チェックはもう無い
    expect(total.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/税込の目安（円）を出す/)).toBeNull();
    const tax = screen.getByTestId('tax-inclusive');
    expect(card(/^月の費用: /).contains(tax)).toBe(true);
    expect(tax.textContent).toMatch(/^税込 約 ¥[\d,]+/);
    // ⓘ のダイアログに事業者ごとの扱いと出典
    fireEvent.click(
      within(tax).getByRole('button', { name: '税込の目安の説明' }),
    );
    const dialog = infoDialog()!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('事業者ごとの消費税の扱い');
    expect(dialog.textContent).toContain('消費税 10% を足す');
    expect(
      within(dialog)
        .getAllByRole('link')
        .some((a) => /^出典（/.test(a.textContent ?? '')),
    ).toBe(true);
    // 比較の表の「税込の目安」の列は常に出る
    const compare = within(card('構成を比べる'));
    expect(
      compare.getByRole('columnheader', { name: '税込の目安' }),
    ).toBeDefined();
    // 古い tax=0 は URL に書き戻さない
    expect(new URLSearchParams(window.location.search).has('tax')).toBe(false);
  });

  it('W-61 ① の選んでいる構成のカードと ① のタブの「止まる」は、明細・上限の一覧と同じ赤（D-178）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-free&pv=30000000',
    );
    await renderApp();
    expectEstimate();
    const stop = stackCard().querySelector<HTMLElement>('[data-stack-stop]')!;
    expect(stop).not.toBeNull();
    expect(stop.textContent).toMatch(/止まる・プランの変更が要る上限 \d+ 件/);
    expect(stop.className).toContain('text-error');
    expect(stop.className).not.toContain('text-warning');
    const stackTab = screen.getByRole('tab', { name: /^① インフラの構成/ });
    const badge = stackTab.querySelector('[data-setup-tab-warn]')!;
    expect(badge.className).toContain('badge-error');
    // 下の上限の一覧の「超過」（止まる）も赤
    const over = within(card(/^月の費用: /)).getAllByText('超過');
    expect(over[0]!.className).toContain('badge-error');
  });

  it('W-62 費用の曲線の軸は既定で通常（等間隔・0 から）、対数を選ぶと 10 倍ごとの目盛りと注記が出て、選んだ表示を覚える（D-179）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&s=cloudflare-vinext-paid&pv=1000000',
    );
    await renderApp();
    expectEstimate();
    const curve = card('費用の曲線（月の PV を振る）');
    const fig = () => curve.querySelector<HTMLElement>('figure[data-scale]')!;
    const ticks = (axis: 'x' | 'y') =>
      [...fig().querySelectorAll(`[data-${axis}-tick]`)].map((e) =>
        Number(e.getAttribute(`data-${axis}-tick`)),
      );
    const scaleButton = (v: string) =>
      curve.querySelector<HTMLElement>(`[data-curve-scale="${v}"]`)!;
    // 既定は通常: 0 から等間隔、対数の注記は無い
    expect(fig().dataset.scale).toBe('linear');
    expect(scaleButton('linear').getAttribute('aria-pressed')).toBe('true');
    expect(ticks('x')[0]).toBe(0);
    expect(ticks('y')[0]).toBe(0);
    const step = ticks('x')[1]! - ticks('x')[0]!;
    expect(ticks('x').every((v, i) => v === i * step)).toBe(true);
    expect(fig().querySelector('[data-log-note]')).toBeNull();
    // 対数: 目盛りは 10 倍ごと、注記を出す
    fireEvent.click(scaleButton('log'));
    expect(fig().dataset.scale).toBe('log');
    expect(scaleButton('log').getAttribute('aria-pressed')).toBe('true');
    for (const axis of ['x', 'y'] as const) {
      const t = ticks(axis);
      expect(t.length).toBeGreaterThan(1);
      for (let i = 1; i < t.length; i++)
        expect(t[i]! / t[i - 1]!).toBeCloseTo(10, 9);
    }
    expect(fig().querySelector('[data-log-note]')!.textContent).toContain(
      '1 目盛りで 10 倍',
    );
    expect(localStorage.getItem('infra-supra:estimate-curve-scale')).toBe(
      'log',
    );
    // 開き直しても対数のまま
    cleanup();
    await renderApp();
    expect(
      card('費用の曲線（月の PV を振る）').querySelector<HTMLElement>(
        'figure[data-scale]',
      )!.dataset.scale,
    ).toBe('log');
  });

  it('W-63 費用の曲線: 止まるまでの区間は通常の線、上限に達して止まる区間は薄い破線で印を描かず、言葉で「止まります」と示す。通常・対数のどちらでも同じ（D-180）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=cloudflare-vinext-free&pv=10000',
    );
    await renderApp();
    expectEstimate();
    const curve = card('費用の曲線（月の PV を振る）');
    const free = () =>
      curve.querySelector<HTMLElement>(
        '[data-curve-legend="cloudflare-vinext-free"]',
      )!;
    // 凡例: 止まり始める PV を言葉で（実データの無料プランは在庫の上限でどの規模でも止まる。途中から止まる線は curve-chart の smoke）
    expect(free().textContent).toMatch(
      /(PV から|どの規模でも)止まります（上限）/,
    );
    expect(curve.querySelector('[data-stopped-key]')!.textContent).toContain(
      '上限に達して止まる区間',
    );
    for (const scale of ['linear', 'log'] as const) {
      fireEvent.click(
        curve.querySelector<HTMLElement>(`[data-curve-scale="${scale}"]`)!,
      );
      const svg = curve.querySelector('figure[data-scale] svg')!;
      const normal = [...svg.querySelectorAll('[data-segment="normal"]')];
      const stopped = [...svg.querySelectorAll('[data-segment="stopped"]')];
      // 止まらない区間（有料のプラン）も、止まる区間（無料のプラン）もある
      expect(normal.length, scale).toBeGreaterThan(0);
      expect(stopped.length, scale).toBeGreaterThan(0);
      for (const l of normal) {
        expect(l.getAttribute('stroke-dasharray')).toBeNull();
        expect(l.getAttribute('stroke-opacity')).toBe('1');
      }
      for (const l of stopped) {
        expect(l.getAttribute('stroke-dasharray')).not.toBeNull();
        expect(Number(l.getAttribute('stroke-opacity'))).toBeLessThan(1);
      }
    }
    // × を止まるの印に使っていない（グラフにも表にも凡例にも × の文字・印が無い）
    expect(curve.textContent).not.toContain('×');
    // 表で見る: 止まる点は言葉で
    const table = within(curve).getByRole('table');
    expect(
      within(table)
        .getAllByText('止まる')
        .every((e) => e.className.includes('text-error')),
    ).toBe(true);
  });

  it('W-64 席の料金の「記載なし」「未取得」の行は最後にまとめて既定で畳み、開けば中身がある。合計は変わらない（D-181）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro&seats=3',
    );
    await renderApp();
    expectEstimate();
    const total = card(/^月の費用: /);
    const folded = total.querySelector<HTMLDetailsElement>(
      'details[data-members-unknown]',
    )!;
    expect(folded).not.toBeNull();
    expect(folded.open).toBe(false);
    const view = runEstimate(normalizeInput(fromQuery(window.location.search)));
    const unknown = view.members.filter(
      (m) => m.pricing === 'not-stated' || m.pricing === 'unknown',
    );
    expect(unknown.length).toBeGreaterThan(0);
    expect(folded.querySelector('summary')!.textContent).toContain(
      `（${unknown.length} 件）`,
    );
    // 畳んだ中に今と同じ内容（記載なし・未取得の印と前提の文）
    const items = folded.querySelectorAll('li');
    expect(items).toHaveLength(unknown.length);
    expect(folded.textContent).toMatch(/記載なし|未取得/);
    expect(folded.textContent).toContain(unknown[0]!.premise);
    // 畳まない行（席ごとに課金など）が先、畳んだ行は最後
    const block = folded.parentElement!;
    expect(block.lastElementChild).toBe(folded);
    const open = block.querySelector(':scope > ul')!;
    expect(open.textContent).toContain('メンバー（席）ごとに課金');
    expect(open.textContent).not.toMatch(/記載なし|未取得/);
    // 合計は計算どおり（表示の並びだけを変えた）
    expect(within(total).getByText(/^\$[\d,]+\.\d\d$/).textContent).toBe(
      usd(view.totalUsd),
    );
  });

  it('W-65 明細の料金未取得の行は表の最後にまとめて既定で畳む（D-181）', () => {
    const line = (label: string, status: LineView['status']): LineView => ({
      kind: 'usage',
      label,
      quantity: 1,
      unit: 'GB',
      amount: status === 'unpriced' ? null : 1,
      currency: 'USD',
      status,
    });
    const { container } = render(
      <Lines
        lines={[
          line('A', 'priced'),
          line('B', 'unpriced'),
          line('C', 'priced'),
          line('D', 'unpriced'),
        ]}
      />,
    );
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    const firstRows = [...tables[0]!.querySelectorAll('tbody tr')].map(
      (r) => r.firstElementChild!.textContent,
    );
    expect(firstRows).toEqual(['A', 'C']);
    const folded = container.querySelector<HTMLDetailsElement>(
      'details[data-unpriced-lines]',
    )!;
    expect(folded.open).toBe(false);
    expect(folded.querySelector('summary')!.textContent).toContain('（2 件');
    expect(container.lastElementChild).toBe(folded);
    expect(folded.textContent).toContain('料金未取得');
    expect(
      [...folded.querySelectorAll('tbody tr')].map((r) =>
        r.firstElementChild!.textContent!.replace('料金未取得', ''),
      ),
    ).toEqual(['B', 'D']);
  });

  it('W-66 費用の曲線は条件の直下・① の構成のカードの上にあり、今の構成の線を強調する（D-182）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    const conditions = card('条件');
    const curve = card('費用の曲線（月の PV を振る）');
    const setup = document.querySelector('section[data-setup-card]')!;
    const total = card(/^月の費用: /);
    const before = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    // 条件 → 曲線 → ①② → 月の費用（DOM の順。狭い画面でも同じ並び）
    expect(before(conditions, curve)).toBe(true);
    expect(before(curve, setup)).toBe(true);
    expect(before(setup, total)).toBe(true);
    expect(setup.contains(stackCard())).toBe(true);
    // 曲線の説明・軸の切り替えも一緒
    expect(curve.querySelector('[data-curve-scale="log"]')).not.toBeNull();
    // 今の構成の線は強調（太い線）、凡例も太字
    const current = curve.querySelector('[data-series="vercel-supabase-pro"]')!;
    expect(current.getAttribute('data-emphasis')).toBe('strong');
    expect(
      current.querySelector('[data-segment]')!.getAttribute('stroke-width'),
    ).toBe('3.5');
    expect(
      curve.querySelector('[data-curve-legend="vercel-supabase-pro"] button')!
        .className,
    ).toContain('font-semibold');
  });

  it('W-67 費用の曲線は載せられる全構成を線にし、凡例を押すとその線を強調する。足し引きの UI は無い（D-183）', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro',
    );
    await renderApp();
    expectEstimate();
    const curve = card('費用の曲線（月の PV を振る）');
    const compareRows = within(card('構成を比べる'))
      .getAllByRole('row')
      .slice(1);
    const lines = curve.querySelectorAll('svg [data-series]');
    expect(lines.length).toBe(compareRows.length);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(curve.textContent).not.toContain('比べる構成を足す・外す');
    expect(curve.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const search = window.location.search;
    // 凡例を押すとその線を強調し、ほかを薄くする
    const pick = () =>
      curve.querySelector<HTMLButtonElement>(
        '[data-curve-legend="sakura-vps-2gb"] button',
      )!;
    fireEvent.click(pick());
    expect(pick().getAttribute('aria-pressed')).toBe('true');
    const emphasis = (id: string) =>
      curve
        .querySelector(`svg [data-series="${id}"]`)!
        .getAttribute('data-emphasis');
    expect(emphasis('sakura-vps-2gb')).toBe('strong');
    expect(emphasis('vercel-supabase-pro')).toBe('muted');
    expect(emphasis('cloudflare-vinext-paid')).toBe('muted');
    // もう一度押すと戻り、今の構成の強調に戻る
    fireEvent.click(pick());
    expect(pick().getAttribute('aria-pressed')).toBe('false');
    expect(emphasis('vercel-supabase-pro')).toBe('strong');
    expect(emphasis('sakura-vps-2gb')).toBe('normal');
    // 見方なので URL には残さない
    expect(window.location.search).toBe(search);
  });

  it('W-68 ① のカルーセルは開いた直後は滑らかにせず一度で中央へ寄せ、幅が後から替わっても寄せ直す（D-182 の後の退行）', async () => {
    // scrollLeft を書いた時点の scroll-behavior を記録する（jsdom はレイアウトをしないので、寄せ方の呼ばれ方で確かめる）
    const writes: { el: HTMLElement; left: number; behavior: string }[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() {
        return 0;
      },
      set(this: HTMLElement, v: number) {
        writes.push({ el: this, left: v, behavior: this.style.scrollBehavior });
      },
    });
    // ResizeObserver の通知を後から送れるように、観ている要素と callback を持つ
    const observers: { cb: ResizeObserverCallback; els: Element[] }[] = [];
    const prevRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      entry: { cb: ResizeObserverCallback; els: Element[] };
      constructor(cb: ResizeObserverCallback) {
        this.entry = { cb, els: [] };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.els.push(el);
      }
      unobserve() {}
      disconnect() {
        this.entry.els = [];
      }
    } as never;
    try {
      window.history.replaceState(
        null,
        '',
        '/?mode=estimate&t=article&fw=nextjs&s=vercel-supabase-pro',
      );
      await renderApp();
      const card = stackCard();
      const t = card.closest<HTMLElement>('.carousel')!;
      const first = writes.filter((w) => w.el === t);
      // 開いた直後の寄せは scroll-behavior: auto（smooth のアニメーションが途中で止まって外れたままにならない）
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((w) => w.behavior === 'auto')).toBe(true);
      expect(t.style.scrollBehavior).toBe('');
      // 幅が後から決まったら、選んでいるカードを中央へ寄せ直す
      const item = card.closest<HTMLElement>('[data-card]')!;
      Object.defineProperty(t, 'clientWidth', { value: 944 });
      Object.defineProperty(item, 'clientWidth', { value: 802 });
      Object.defineProperty(item, 'offsetLeft', { value: 873 });
      writes.length = 0;
      for (const o of observers)
        if (o.els.includes(t))
          o.cb([{ target: t } as never], {} as ResizeObserver);
      const again = writes.filter((w) => w.el === t);
      expect(again.length).toBeGreaterThan(0);
      expect(again.at(-1)!.left).toBe(873 - (944 - 802) / 2);
      expect(again.at(-1)!.behavior).toBe('auto');
      // 別の構成を選んだときは滑らかに動かす（CSS の scroll-behavior のまま）
      writes.length = 0;
      pick('stack', 'sakura-vps-2gb');
      const moved = writes.filter((w) => w.el === t && w.behavior === '');
      expect(moved.length).toBeGreaterThan(0);
    } finally {
      delete (HTMLElement.prototype as { scrollLeft?: number }).scrollLeft;
      globalThis.ResizeObserver = prevRO;
    }
  });
});
