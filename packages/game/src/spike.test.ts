// 話題・Bot の上乗せが短い期間に集中する（D-44）。容量の判定（ピークの時間帯）だけに効き、課金は月の総量のまま。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_START_DATE,
  playStrategy,
  SCENARIOS,
  spikePeakFactor,
  type Action,
  type GameState,
  type MonthReport,
} from './index.ts';
import type { Scenario } from './scenario.ts';

const article = SCENARIOS['article-community']!;
const VPS = 4;
const CF_PAID = 1;
const VERCEL_PRO = 3;

/** 集中を外した同じシナリオ（比較用）。 */
const flat: Scenario = {
  ...article,
  id: 't-flat',
  events: article.events.map((e) => ({
    ...e,
    effects: (e.effects ?? []).map((x) => {
      if (x.type !== 'traffic') return x;
      const { spikeDays: _, ...rest } = x;
      return rest;
    }),
  })),
};

const play = (sc: Scenario, stack: number, acts: Action[] = [], seed = 42) =>
  playStrategy(
    { id: 't', label: 't', stackIndex: stack, actions: [acts] },
    seed,
    sc,
    DEFAULT_START_DATE,
  );
const ratio = (h: MonthReport, prefix: string) =>
  h.snapshots.find((p) => p.id.startsWith(prefix))?.ratio ?? 0;
const buzzMonth = (s: GameState) => s.history.findIndex((h) => h.buzz);

describe('話題・Bot の集中（D-44）', () => {
  it('ピークの倍率: 集中が無ければ 1。話題 3 倍を 2 日に集めると約 10 倍', () => {
    expect(spikePeakFactor(100, [])).toBe(1);
    const f = spikePeakFactor(300, [{ id: 'buzz', extraPV: 200, days: 2 }]);
    expect(f).toBeCloseTo((100 + 200 * (730 / 24 / 2)) / 300, 9);
    expect(f).toBeGreaterThan(10);
  });

  it('PV と上乗せを同じ割合で縮めれば倍率は変わらず、PV だけ縮めると過大になる（反実仮想で両方縮める理由。OCL-37A91830）', () => {
    const spikes = [{ id: 'buzz', extraPV: 200, days: 2 }];
    const f = spikePeakFactor(300, spikes);
    expect(spikePeakFactor(150, [{ ...spikes[0]!, extraPV: 100 }])).toBeCloseTo(
      f,
      12,
    );
    expect(spikePeakFactor(150, spikes)).toBeGreaterThan(f);
  });

  it('話題の月だけピークが上がる（VPS の回線の比率が、PV の伸びより大きく跳ねる）', () => {
    const s = play(article, VPS);
    const f = play(flat, VPS);
    const m = buzzMonth(s);
    expect(m).toBeGreaterThan(0);
    // 話題の月は集中の分だけ大きく、前の月は同じ
    expect(ratio(s.history[m]!, 'host:line')).toBeGreaterThan(
      5 * ratio(f.history[m]!, 'host:line'),
    );
    expect(ratio(s.history[m - 1]!, 'host:line')).toBeCloseTo(
      ratio(f.history[m - 1]!, 'host:line'),
      9,
    );
  });

  it('課金は変わらない（どの月のインフラ費も、集中が無いときと同じ）', () => {
    for (const stack of [CF_PAID, VERCEL_PRO]) {
      const s = play(article, stack);
      const f = play(flat, stack);
      expect(s.history.map((h) => h.infraCost)).toEqual(
        f.history.map((h) => h.infraCost),
      );
    }
  });

  it('前段の CDN で、話題の月の VPS の回線・CPU のピークが下がり、詰まらない', () => {
    const s = play(article, VPS);
    const c = play(article, VPS, [
      { type: 'component', slot: 'frontCdn', option: 'static' },
    ]);
    const m = buzzMonth(s);
    expect(ratio(s.history[m]!, 'host:line')).toBeGreaterThan(1);
    expect(ratio(c.history[m]!, 'host:line')).toBeLessThan(1);
    expect(ratio(c.history[m]!, 'host:cpu')).toBeLessThan(
      ratio(s.history[m]!, 'host:cpu'),
    );
  });
});
