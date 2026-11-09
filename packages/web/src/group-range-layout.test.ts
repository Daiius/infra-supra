// 比較の図（GroupRangeChart。D-175）の配置の計算。jsdom では幅を測れないので、幅を渡して座標の関係を確かめる。
import { describe, expect, it } from 'vitest';
import {
  fitText,
  groupRangeLayout,
  RANGE_WIDE_MIN,
  type RangeChartRow,
} from './charts.tsx';

const rows: RangeChartRow[] = [
  {
    key: 'a',
    label: 'A',
    count: 30,
    stats: { p25: 1500, median: 2000, p75: 2600 },
    mine: true,
  },
  { key: 'b', label: 'B', count: 4, stats: null, mine: false },
  {
    key: 'c',
    label: 'C',
    count: 12,
    stats: { p25: 100, median: 200, p75: 300 },
    mine: false,
  },
];

function checkCommon(width: number, value: number) {
  const L = groupRangeLayout(width, rows, value);
  // 帯・中央値・目盛り・自分の線が帯の列の中にある
  for (const r of rows.filter((x) => x.stats)) {
    for (const v of [r.stats!.p25, r.stats!.median, r.stats!.p75]) {
      expect(L.xOf(v)).toBeGreaterThanOrEqual(L.bandX0);
      expect(L.xOf(v)).toBeLessThanOrEqual(L.bandX1);
    }
  }
  for (const t of L.ticks) {
    expect(t.x).toBeGreaterThanOrEqual(L.bandX0);
    expect(t.x).toBeLessThanOrEqual(L.bandX1);
  }
  expect(L.mineX).toBeGreaterThanOrEqual(L.bandX0);
  expect(L.mineX).toBeLessThanOrEqual(L.bandX1);
  expect(L.bandX1).toBeLessThanOrEqual(width);
  return L;
}

describe('groupRangeLayout', () => {
  it('広い幅（結果の画面のカード 930px）: 名前 220px｜帯（残り全部）｜件数 60px の 3 列', () => {
    const L = checkCommon(930, 2100);
    expect(L.wide).toBe(true);
    expect(L.nameW).toBe(220);
    expect(L.bandX0).toBe(228);
    expect(L.bandX1).toBe(930 - 60 - 8);
    // 目盛りは帯の列の両端と真ん中
    expect(L.ticks[0]!.x).toBeLessThan(L.bandX0 + 40);
    expect(L.ticks[2]!.x).toBeGreaterThan(L.bandX1 - 40);
  });

  it('狭い幅（360px の画面のカード 300px）: 名前と件数の段の下に帯を全幅で入れる 2 段組み', () => {
    expect(300).toBeLessThan(RANGE_WIDE_MIN);
    const L = checkCommon(300, 2100);
    expect(L.wide).toBe(false);
    expect(L.bandX0).toBe(0);
    expect(L.bandX1).toBe(300);
    for (let i = 0; i < rows.length; i++) {
      // 帯は名前の文字の下、次の行より上
      expect(L.bandY(i)).toBeGreaterThan(L.textY(i));
      expect(L.bandY(i) + 9).toBeLessThanOrEqual(L.rowTop(i + 1));
    }
  });

  it('自分の値が分布より外でも、帯の列の中に線を引く（範囲に自分の値を含める）', () => {
    for (const v of [-500, 9999]) checkCommon(930, v);
    expect(groupRangeLayout(930, rows, 9999).mineEnd).toBe(true);
    expect(groupRangeLayout(930, rows, -500).mineEnd).toBe(false);
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
