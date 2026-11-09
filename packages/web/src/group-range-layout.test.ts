// 比較の図（GroupHistogramChart。D-175）の配置の計算。jsdom では幅を測れないので、幅を渡して座標の関係を確かめる。
import { describe, expect, it } from 'vitest';
import {
  fitText,
  groupRangeLayout,
  RANGE_WIDE_MIN,
  type RangeChartRow,
} from './charts.tsx';

const bins = (n: number) =>
  Array.from({ length: 12 }, (_, i) => (i === n ? 3 : 1));
const rows: RangeChartRow[] = [
  {
    key: 'a',
    label: 'A',
    count: 30,
    stats: { median: 2000, bins: bins(8) },
    mine: true,
  },
  { key: 'b', label: 'B', count: 4, stats: null, mine: false },
  {
    key: 'c',
    label: 'C',
    count: 12,
    stats: { median: 200, bins: bins(1) },
    mine: false,
  },
];
/** 共通の区切り（100〜2500 を 12 等分）。 */
const edges = Array.from({ length: 13 }, (_, i) => 100 + 200 * i);

function checkCommon(width: number, value: number) {
  const L = groupRangeLayout(width, rows, value, edges);
  // 区切り・中央値・目盛り・自分の線が棒の列の中にある
  for (const v of [...edges, 2000, 200]) {
    expect(L.xOf(v)).toBeGreaterThanOrEqual(L.bandX0);
    expect(L.xOf(v)).toBeLessThanOrEqual(L.bandX1);
  }
  for (const t of L.ticks) {
    expect(t.x).toBeGreaterThanOrEqual(L.bandX0);
    expect(t.x).toBeLessThanOrEqual(L.bandX1);
  }
  expect(L.mineX).toBeGreaterThanOrEqual(L.bandX0);
  expect(L.mineX).toBeLessThanOrEqual(L.bandX1);
  expect(L.bandX1).toBeLessThanOrEqual(width);
  for (let i = 0; i < rows.length; i++) {
    // ヒストグラムは行の中: 上端 < 基線、中央値の印（基線の下）も次の行より上
    expect(L.histTop(i)).toBeGreaterThanOrEqual(L.rowTop(i));
    expect(L.baseY(i) - L.histTop(i)).toBeGreaterThanOrEqual(14);
    expect(L.baseY(i) + 6).toBeLessThanOrEqual(L.rowTop(i + 1));
  }
  return L;
}

describe('groupRangeLayout', () => {
  it('広い幅（結果の画面のカード 930px）: 名前 220px｜棒（残り全部）｜件数 60px の 3 列・1 行 28px', () => {
    const L = checkCommon(930, 2100);
    expect(L.wide).toBe(true);
    expect(L.nameW).toBe(220);
    expect(L.bandX0).toBe(228);
    expect(L.bandX1).toBe(930 - 60 - 8);
    expect(L.rowH).toBe(28);
    // 横の範囲は共通の区切りの両端（目盛りは両端と真ん中）
    expect(L.ticks.map((t) => t.v)).toEqual([100, 1300, 2500]);
    expect(L.ticks[0]!.x).toBeLessThan(L.bandX0 + 10);
    expect(L.ticks[2]!.x).toBeGreaterThan(L.bandX1 - 10);
  });

  it('狭い幅（360px の画面のカード 300px）: 名前と件数の段の下に棒を全幅で入れる 2 段組み', () => {
    expect(300).toBeLessThan(RANGE_WIDE_MIN);
    const L = checkCommon(300, 2100);
    expect(L.wide).toBe(false);
    expect(L.bandX0).toBe(0);
    expect(L.bandX1).toBe(300);
    // 棒は名前の文字の下
    for (let i = 0; i < rows.length; i++)
      expect(L.histTop(i)).toBeGreaterThan(L.textY(i));
  });

  it('自分の値が区切りの外でも、範囲を広げて棒の列の中に線を引く', () => {
    for (const v of [-500, 9999]) checkCommon(930, v);
    expect(groupRangeLayout(930, rows, 9999, edges).mineEnd).toBe(true);
    expect(groupRangeLayout(930, rows, -500, edges).mineEnd).toBe(false);
    // 行が無い（区切りが空）でも描ける
    const empty = groupRangeLayout(930, [], 50, []);
    expect(empty.ticks.map((t) => t.v)).toEqual([50]);
    expect(Number.isFinite(empty.mineX)).toBe(true);
  });

  it('名前は幅に収め、はみ出せば … で切る', () => {
    expect(fitText('Cloudflare Paid', 220)).toBe('Cloudflare Paid');
    const cut = fitText('Google Cloud（Cloud Run + Firebase Hosting）', 120);
    expect(cut.endsWith('…')).toBe(true);
    const w = [...cut].reduce(
      (n, c) => n + (c.charCodeAt(0) > 0xff ? 12 : 7),
      0,
    );
    expect(w).toBeLessThanOrEqual(120);
  });
});
