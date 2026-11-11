// @vitest-environment jsdom
// 狭い画面（sm 未満）の描画テスト。見た目は確かめず、推移のグラフ（D-186）の高さ・目盛りの数・推移のタイルの行の形と、
// 満足度の要素（D-189）の並べ方のクラスと、ヘッダーのボタン（D-206）の名前・狭い画面の形を見る。
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineChart } from './charts.tsx';
import {
  advance,
  renderApp,
  startGame,
  useSmokeEnv,
} from './smoke.test-helpers.tsx';

useSmokeEnv();

/** matchMedia を差し替える。narrow なら sm 未満（max-width の問い合わせに合う）。動きは常に減らす。 */
function stubScreen(narrow: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches:
        query.includes('prefers-reduced-motion') ||
        (narrow && query.includes('max-width')),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

const chart = () => (
  <LineChart
    title="所持金"
    months={12}
    format={(v) => String(Math.round(v))}
    series={[
      {
        id: 'cash',
        label: '所持金',
        color: 'var(--series-1)',
        values: [100, 200, 300, 400, 500],
      },
    ]}
  />
);

const svgOf = () =>
  screen.getByRole('img', { name: /^所持金。/ }) as unknown as SVGSVGElement;
// 縦の目盛りの数字は textAnchor="end"、月の数字は middle
const yTicks = (svg: SVGSVGElement) =>
  svg.querySelectorAll('text[text-anchor="end"]').length;
const monthLabels = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('text[text-anchor="middle"]')].map(
    (t) => t.textContent,
  );

describe('狭い画面の推移のグラフ（D-186）', () => {
  afterEach(() => stubScreen(false));

  it('W-186a 広い画面は高さ 180・月の目盛りは 12 本', () => {
    stubScreen(false);
    render(chart());
    const svg = svgOf();
    expect(svg.getAttribute('height')).toBe('180');
    expect(svg.closest('figure')!.hasAttribute('data-narrow')).toBe(false);
    expect(monthLabels(svg)).toHaveLength(12);
  });

  it('W-186b 狭い画面は高さを縮め、縦の目盛りと月の目盛りを減らす', () => {
    stubScreen(true);
    render(chart());
    const svg = svgOf();
    expect(Number(svg.getAttribute('height'))).toBeLessThanOrEqual(100);
    expect(svg.closest('figure')!.hasAttribute('data-narrow')).toBe(true);
    expect(monthLabels(svg)).toEqual(['1', '3', '6', '9', '12']);
    expect(yTicks(svg)).toBeLessThanOrEqual(3);
  });
});

describe('狭い画面の推移のタイル（D-186）', () => {
  beforeEach(() => stubScreen(true));
  afterEach(() => stubScreen(false));

  it('W-186c タイルは 1 列の細い行（名前・値・前月比・小さな推移を横に並べ、sm 以上は元のカード）', async () => {
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const grid = document.querySelector<HTMLElement>('[data-trend-tiles]')!;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('sm:grid-cols-2');
    const tiles = grid.querySelectorAll<HTMLElement>('[data-trend-tile]');
    expect(tiles).toHaveLength(5);
    for (const t of tiles) {
      expect(t.className).toContain('flex');
      expect(t.className).toContain('sm:block');
      const spark = t.querySelector('svg')!;
      expect(spark.getAttribute('width')).toBe('64');
    }
  });
});

describe('狭い画面の満足度の要素（D-189）', () => {
  it('W-189 満足度の 5 要素は折り返して横に並べ（flex-wrap）、sm 以上は 1 要素 1 行', async () => {
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const list = document.querySelector<HTMLElement>(
      '[data-satisfaction-elements]',
    )!;
    expect(list.tagName).toBe('UL');
    for (const c of ['flex', 'flex-wrap', 'sm:block'])
      expect(list.className.split(' ')).toContain(c);
    const items = list.querySelectorAll('[data-satisfaction-element]');
    expect(items).toHaveLength(5);
    // 各要素は名前と段階の印を 1 つの項目にまとめる
    for (const li of items) {
      expect(li.parentElement).toBe(list);
      expect(li.querySelector('.badge')).not.toBeNull();
    }
  });
});

describe('狭い画面のヘッダー（D-206・D-210）', () => {
  afterEach(() => vi.unstubAllEnvs());

  const setup = async () => {
    // 統計のタブも出る、いちばん混んだ形（開発用の架空の分布なら取りに行かない）
    vi.stubEnv('VITE_STATS_MOCK', '1');
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    const header = screen.getByRole('banner');
    const nav = within(header).getByRole('navigation', { name: 'モード' });
    const right = nav.nextElementSibling as HTMLElement;
    return { header, nav, right };
  };
  const trigger = (header: HTMLElement) =>
    within(header).getByRole('button', { name: 'ゲームの操作' });

  it('W-206 右端は sm 未満で「ゲームの操作」のメニュー・遊び方・設定のアイコンだけになり、sm 以上は文字つきのボタンを並べる。見積・統計のヘッダーは設定だけ', async () => {
    const { header, nav, right } = await setup();
    advance(1);
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['ゲーム', '見積', '統計']);
    expect(right.className.split(' ')).toContain('gap-0');
    // jsdom は CSS を当てないので、狭い画面用（メニュー）と広い画面用（文字つき）の両方が並ぶ
    expect(
      within(right)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'ゲームの操作',
      '過去の月に戻る…',
      '新しいゲーム',
      '遊び方',
      '設定',
    ]);
    // メニューは sm 未満だけ、文字つきのボタンは sm 以上だけ
    const menuBox = right.querySelector('[data-game-menu]')!;
    expect(menuBox.className.split(' ')).toEqual(['sm:hidden']);
    expect(menuBox.contains(trigger(header))).toBe(true);
    const wide = right.querySelector('[data-game-buttons]') as HTMLElement;
    expect(wide.className.split(' ')).toEqual(['hidden', 'sm:contents']);
    for (const [name, text] of [
      // 「戻る…」だけではブラウザの戻ると紛らわしいので、見える文字もメニューと同じ（D-210）
      ['過去の月に戻る…', '過去の月に戻る…'],
      ['新しいゲーム', '新しいゲーム'],
    ] as const) {
      const b = within(wide).getByRole('button', { name });
      expect(b.textContent).toBe(text);
      expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
    // 遊び方は sm 未満で設定と同じ 32px の正方形、文字は sm 以上でだけ見せる
    const howto = within(header).getByRole('button', { name: '遊び方' });
    for (const c of ['w-8', 'px-0', 'sm:w-auto'])
      expect(howto.className.split(' ')).toContain(c);
    const label = [...howto.querySelectorAll('span')].find(
      (s) => s.textContent === '遊び方',
    )!;
    expect(label.className.split(' ')).toEqual(['hidden', 'sm:inline']);
    expect(
      within(header).getByRole('button', { name: '設定' }).className,
    ).toContain('btn-square');
    // 見積・統計のヘッダーは設定だけ（ゲームのボタンもメニューも出さない）
    for (const m of ['見積', '統計']) {
      fireEvent.click(within(nav).getByRole('button', { name: m }));
      expect(
        within(right)
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label')),
      ).toEqual(['設定']);
    }
  });

  it('W-210 「ゲームの操作」はメニューを開閉する（ボタン・Esc・外側のクリック）。開くボタンはアイコン 2 つ（戻る + 下向きの三角）で、項目は右揃え・高さ 40px 以上', async () => {
    const { header } = await setup();
    const t = trigger(header);
    expect(t.getAttribute('aria-haspopup')).toBe('menu');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.queryByRole('menu')).toBeNull();
    // 開く: 最初の項目にフォーカスが行く
    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'ゲームの操作' });
    expect(t.getAttribute('aria-controls')).toBe(menu.id);
    for (const c of ['absolute', 'right-0', 'top-full'])
      expect(menu.className.split(' ')).toContain(c);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      '過去の月に戻る…戻れる月はまだありません',
      '新しいゲーム',
    ]);
    for (const i of items) expect(i.className.split(' ')).toContain('min-h-10');
    expect(document.activeElement).toBe(items[0]);
    // 矢印で項目を移る（端で回る）
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    // Esc で閉じて開くボタンに戻る
    fireEvent.keyDown(items[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(t);
    // もう一度押すと閉じる
    fireEvent.click(t);
    fireEvent.click(t);
    expect(screen.queryByRole('menu')).toBeNull();
    // 外側を押すと閉じる
    fireEvent.click(t);
    expect(screen.getByRole('menu')).toBeDefined();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('W-210b 1 か月目は「過去の月に戻る…」を押せない形で見せ、2 か月目からは押すと戻るダイアログ、「新しいゲーム」は確認のダイアログを開く', async () => {
    const { header } = await setup();
    const t = trigger(header);
    // 1 か月目: 戻れる月が無いので押せない（理由の短い文つき）
    fireEvent.click(t);
    let rewindItem = screen.getByRole('menuitem', { name: '過去の月に戻る…' });
    expect(rewindItem.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(
      rewindItem.getAttribute('aria-describedby')!,
    )!;
    expect(reason.textContent).toBe('戻れる月はまだありません');
    fireEvent.click(rewindItem);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 「新しいゲーム」: メニューを閉じて確認のダイアログを開く（やめれば続き）
    fireEvent.click(screen.getByRole('menuitem', { name: '新しいゲーム' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const restart = screen.getByRole('dialog', {
      name: '新しいゲームを始めますか？',
    });
    fireEvent.click(within(restart).getByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // 2 か月目: 押すと過去の月に戻るダイアログ
    advance(1);
    fireEvent.click(t);
    rewindItem = screen.getByRole('menuitem', { name: '過去の月に戻る…' });
    expect(rewindItem.getAttribute('aria-disabled')).toBeNull();
    expect(rewindItem.getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(rewindItem);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.getByRole('dialog', { name: '過去の月に戻る' }),
    ).toBeDefined();
  });

  it('W-210c 始める前（ゲームの状態が無い）は「ゲームの操作」を出さない', async () => {
    await renderApp();
    expect(screen.queryByRole('button', { name: 'ゲームの操作' })).toBeNull();
  });
});
