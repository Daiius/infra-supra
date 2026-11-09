// @vitest-environment jsdom
// 狭い画面（sm 未満）の推移のグラフ（D-186）の描画テスト。見た目は確かめず、高さ・目盛りの数・推移のタイルの行の形を見る。
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineChart } from './charts.tsx';
import { renderApp, startGame, useSmokeEnv } from './smoke.test-helpers.tsx';

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
  screen.getByRole('img', { name: '所持金' }) as unknown as SVGSVGElement;
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
