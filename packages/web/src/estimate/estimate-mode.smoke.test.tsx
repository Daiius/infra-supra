// @vitest-environment jsdom
// 見積モードの画面の描画テスト（D-86・prd/05 §7）。構成・フレームワーク・テンプレート・PV を切り替えても例外が無く、
// 月の費用・比較表・費用の曲線が出ることだけを見る（金額は model.test.ts と game のテストが持つ）。
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, useSmokeEnv, waitLoaded } from '../smoke.test-helpers.tsx';

useSmokeEnv();

const card = (title: string | RegExp) =>
  screen.getByRole('heading', { level: 2, name: title }).closest('section')!;
const combo = (label: string) =>
  screen.getByRole('combobox', { name: new RegExp(`^${label}`) });
/** ③ 部品・④ 設定の欄（ゲームと共用のラジオの枠。D-115）。名前は見出しの文字で始まる。 */
const group = (label: string) =>
  screen.getByRole('group', { name: new RegExp(`^${label}`) });
const queryGroup = (label: string) =>
  screen.queryByRole('group', { name: new RegExp(`^${label}`) });
/** ① 構成・② フレームワークのカルーセルのラジオ（ゲームと共用。D-115）。 */
const pickerRadios = (name: 'stack' | 'framework') => [
  ...document.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${name}"]`,
  ),
];
const pickerRadio = (name: 'stack' | 'framework', value: string) =>
  pickerRadios(name).find((r) => r.value === value)!;
/** 構成・フレームワークを選ぶ（タブのラジオを押す）。 */
const pick = (name: 'stack' | 'framework', value: string) => {
  const r = pickerRadio(name, value);
  expect(r.disabled).toBe(false);
  fireEvent.click(r);
  expect(r.checked).toBe(true);
};
/** 枠の中で選んでいるラジオの値。 */
const checked = (label: string) =>
  within(group(label))
    .getAllByRole<HTMLInputElement>('radio')
    .find((r) => r.checked)?.value;
/** 枠の中で値のラジオを選ぶ。 */
const choose = (label: string, value: string) =>
  fireEvent.click(
    within(group(label))
      .getAllByRole<HTMLInputElement>('radio')
      .find((r) => r.value === value)!,
  );

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
  // 構成図（D-105）: 今の構成の図が出る
  const diagram = within(card(/^構成図: /)).getByRole('img', {
    name: /^構成図: /,
  });
  expect(diagram.querySelectorAll('[data-node]').length).toBeGreaterThan(1);
  // ページごとの描き方（D-106）: テンプレートのページごとに 1 行
  expect(
    within(card('ページごとの描き方'))
      .getByRole('table', { name: 'ページごとの描き方' })
      .querySelectorAll('tr[data-route]').length,
  ).toBeGreaterThan(0);
  const curve = within(card('費用の曲線（月の PV を振る）'));
  const chart = curve.getByRole('img', {
    name: '月の PV ごとの月額（構成ごと）',
  });
  expect(chart.querySelectorAll('path').length).toBeGreaterThan(0);
  return title.textContent!.replace(/^月の費用: /, '');
}

describe('見積モードの画面', () => {
  it('W-05 見積を描き、構成・フレームワーク・テンプレート・PV を切り替える', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('tab', { name: '見積' }));
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
        /^記事のページ（ISR の閲覧と再生成・CPU [\d.]+ ms）・個人向けのページ（SSR・CPU [\d.]+ ms）が Workers Free の 1 リクエスト 10 ms を超える$/,
      ),
    ).toBeDefined();
    // ページごとの描き方（D-107）: 個人向けを枠 + API にすると URL に残り、その行は CPU の制限に当たらない
    const routes = within(card('ページごとの描き方'));
    fireEvent.click(
      routes.getByRole('button', {
        name: /^個人向けのページを 枠 \+ ブラウザが API で取る/,
      }),
    );
    expect(window.location.search).toContain('rp.personal=shell-api');
    const row = within(card('ページごとの描き方'))
      .getByRole('table', { name: 'ページごとの描き方' })
      .querySelector('tr[data-route="personal"]')!;
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
    const routes = within(card('ページごとの描き方'));
    fireEvent.click(
      routes.getByRole('button', {
        name: /^個人向けのページを 枠 \+ サーバーの島/,
      }),
    );
    expect(window.location.search).toContain('rp.personal=server-island');
    const row = within(card('ページごとの描き方'))
      .getByRole('table', { name: 'ページごとの描き方' })
      .querySelector('tr[data-route="personal"]')!;
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
          name: '個人向けのページは 枠 + サーバーの島（選択中）',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expectEstimate();
    expect(
      within(card(/^構成図: /)).getByRole('list', {
        name: '構成図の流れの凡例',
      }).textContent,
    ).toContain('サーバーの島（閲覧ごとに一部だけ描く）');
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
    const table = () =>
      within(card('ページごとの描き方')).getByRole('table', {
        name: 'ページごとの描き方',
      });
    const strategyOf = (route: string) =>
      table()
        .querySelector(`tr[data-route="${route}"] [data-strategy]`)!
        .getAttribute('data-strategy');
    expect(strategyOf('article')).toBe('cache-components');
    expect(strategyOf('personal')).toBe('cache-components');
    expect(table().textContent).toContain(
      '部品ごとにキャッシュ（Cache Components）',
    );
    // 描き方の番号（S1〜S6・文書の S7）は画面に出さない（D-112）
    expect(table().textContent).not.toMatch(/\bS[1-7]\b/);
    expect(window.location.search).not.toContain('rp.');
    expect(
      within(card(/^構成図: /)).getByRole('list', {
        name: '構成図の流れの凡例',
      }).textContent,
    ).toContain('動的な穴');
    fireEvent.click(
      within(card('ページごとの描き方')).getByRole('button', {
        name: /^個人向けのページを 毎回描く/,
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
      within(card('ページごとの描き方')).getByRole('button', {
        name: /^個人向けのページを 部品ごとにキャッシュ（Cache Components）にする/,
      }),
    ).toBeTruthy();
  });

  it('W-35 選択の欄はゲームと共用（D-115）: 構成が先で、載せられないフレームワークは灰色と理由。Astro で AWS を選ぶと Next.js に替えて知らせる', async () => {
    window.history.replaceState(
      null,
      '',
      '/?mode=estimate&t=article&fw=astro&s=cloudflare-vinext-paid',
    );
    await renderApp();
    expectEstimate();
    // 順: ① インフラの構成 → ② フレームワーク → ③ 部品 → ④ 設定
    const stackGroup = screen.getByRole('radiogroup', {
      name: '① インフラの構成',
    });
    const fwGroup = screen.getByRole('radiogroup', {
      name: '② アプリのフレームワークとページの描き方',
    });
    expect(
      stackGroup.compareDocumentPosition(fwGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
      /には Astro を載せる公式のアダプターが無いので、フレームワークを Next\.js（App Router） にした/,
    );
    // Astro は灰色で選べず、カードに理由が出る
    expect(pickerRadio('framework', 'astro').disabled).toBe(true);
    const astroCard = screen.getByRole('region', { name: 'Astro の説明' });
    expect(astroCard.getAttribute('aria-disabled')).toBe('true');
    expect(within(astroCard).getByRole('note').textContent).toMatch(
      /^選んでいる構成では選べない: 公式のアダプターが無く載せられない/,
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
        name: /^個人向けのページを 枠 \+ ブラウザが API で取る/,
      }),
    );
    expectEstimate();
    expect(window.location.search).toContain('rp.personal=shell-api');
    expect(
      within(card('ページごとの描き方'))
        .getByRole('table', { name: 'ページごとの描き方' })
        .querySelector('tr[data-route="personal"] [data-strategy]')!
        .getAttribute('data-strategy'),
    ).toBe('shell-api');
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
    // 部品の欄（DB のバックアップ）はゲームと同じラジオの枠（D-115）
    expect(
      within(group('DB のバックアップ')).getAllByRole('radio').length,
    ).toBeGreaterThan(1);
  });
});
