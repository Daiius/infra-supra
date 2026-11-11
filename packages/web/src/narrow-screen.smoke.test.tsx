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

describe('狭い画面のヘッダー（D-206）', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('W-206 右端のボタンは sm 未満でアイコンだけの 32px の正方形になり、名前（アクセシブルネーム）は保つ。見積・統計のヘッダーも同じ', async () => {
    // 統計のタブも出る、いちばん混んだ形（開発用の架空の分布なら取りに行かない）
    vi.stubEnv('VITE_STATS_MOCK', '1');
    await renderApp();
    await startGame({
      scenario: '記事コミュニティ',
      framework: 'Next.js（App Router）',
      stack: 'Cloudflare Paid + vinext',
    });
    advance(1);
    const header = screen.getByRole('banner');
    const nav = within(header).getByRole('navigation', { name: 'モード' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['ゲーム', '見積', '統計']);
    const right = nav.nextElementSibling as HTMLElement;
    expect(right.className.split(' ')).toContain('gap-0');
    const buttons = within(right).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '過去の月に戻る…',
      '新しいゲーム',
      '遊び方',
      '設定',
    ]);
    for (const [name, text] of [
      ['過去の月に戻る…', '戻る…'],
      ['新しいゲーム', '新しいゲーム'],
      ['遊び方', '遊び方'],
    ] as const) {
      const b = within(header).getByRole('button', { name });
      const cls = b.className.split(' ');
      // sm 未満は設定と同じ 32px の正方形、sm 以上は文字つきの幅
      for (const c of ['w-8', 'px-0', 'sm:w-auto']) expect(cls).toContain(c);
      // 文字は sm 以上でだけ見せる（アイコンは飾り）
      const label = [...b.querySelectorAll('span')].find(
        (s) => s.textContent === text,
      )!;
      expect(label.className.split(' ')).toEqual(['hidden', 'sm:inline']);
      expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(
      within(header).getByRole('button', { name: '設定' }).className,
    ).toContain('btn-square');
    // 見積・統計のヘッダーは設定だけ（ゲームのボタンは出さない）
    for (const m of ['見積', '統計']) {
      fireEvent.click(within(nav).getByRole('button', { name: m }));
      expect(
        within(right)
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label')),
      ).toEqual(['設定']);
    }
  });
});
