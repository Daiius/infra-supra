// @vitest-environment jsdom
// 費用の曲線の折れ線（charts.tsx の CurveChart）の描画テスト。止まる区間の描き方（D-180）と軸の目盛り（D-179）を、
// 途中から止まる系列（無料枠の範囲では止まらない構成）で確かめる。実データの見積は estimate-mode.smoke.test.tsx。
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurveChart, type CurveChartSeries } from './charts.tsx';
import { useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

const XS = [10_000, 30_000, 100_000, 300_000, 1_000_000] as const;
const STOP = ['Free は月 5,000 回まで'];
/** 3 点目（10 万）から止まる系列と、止まらない系列。 */
const SERIES: CurveChartSeries[] = [
  {
    id: 'free',
    label: 'Free',
    color: 'var(--series-1)',
    shape: 'circle',
    points: [
      { y: 0, flags: [] },
      { y: 0, flags: [] },
      { y: 5, flags: STOP },
      { y: 20, flags: STOP },
      { y: 80, flags: STOP },
    ],
  },
  {
    id: 'paid',
    label: 'Paid',
    color: 'var(--series-2)',
    shape: 'square',
    points: XS.map((x) => ({ y: 5 + x / 10_000, flags: [] })),
  },
];

function draw(scale: 'linear' | 'log') {
  const { container } = render(
    <CurveChart
      series={SERIES}
      xs={XS}
      formatX={(v) => `${v / 1000}K`}
      formatY={(v) => `$${v}`}
      formatValue={(v) => `$${v}`}
      scale={scale}
      label="曲線"
    />,
  );
  return container;
}

describe('費用の曲線の折れ線（CurveChart）', () => {
  for (const scale of ['linear', 'log'] as const)
    it(`${scale}: 止まるまでは通常の線と印、止まる区間は薄い破線で印を描かない（D-180）`, () => {
      const c = draw(scale);
      const free = c.querySelector<SVGGElement>('[data-series="free"]')!;
      const segs = [...free.querySelectorAll('[data-segment]')].map((l) =>
        l.getAttribute('data-segment'),
      );
      // 10K→30K は通常、30K→100K（止まる点に入る）から先は止まる区間
      expect(segs).toEqual(['normal', 'stopped', 'stopped', 'stopped']);
      const normal = free.querySelector('[data-segment="normal"]')!;
      expect(normal.getAttribute('stroke-dasharray')).toBeNull();
      expect(normal.getAttribute('stroke-opacity')).toBe('1');
      for (const l of free.querySelectorAll('[data-segment="stopped"]')) {
        expect(l.getAttribute('stroke-dasharray')).not.toBeNull();
        expect(Number(l.getAttribute('stroke-opacity'))).toBeLessThan(1);
      }
      // 印は止まらない 2 点だけ（止まる点に × などの印を描かない）
      expect(free.querySelectorAll('circle')).toHaveLength(2);
      expect(free.querySelectorAll('path')).toHaveLength(0);
      // 止まらない系列は全部通常の線
      const paid = c.querySelector('[data-series="paid"]')!;
      expect(paid.querySelectorAll('[data-segment="stopped"]')).toHaveLength(0);
      // 対数だけ、10 倍ごとの目盛りの注記
      expect(c.querySelector('[data-log-note]') !== null).toBe(scale === 'log');
    });
});
