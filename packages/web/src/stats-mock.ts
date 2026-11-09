// 開発用の架空の分布（D-164）。サーバーが無い環境で段 3 の画面（ヒストグラム・上位 %・花火の段）を確かめるためだけに使う。
// `pnpm dev` で VITE_STATS_MOCK=1 を立てたときだけ App.tsx が動的に読む（import.meta.env.DEV でない本番のビルドには入らない）。
// 🔒 値は遊んだ人の結果ではなく、自分の値の周りに散らした架空の値。画面に「開発用の架空の分布」と明記する。
import { RESULT_AXES, type ResultAxes, type ResultAxisId } from 'game';
import type { Distribution, Histogram } from 'stats';

/** 架空の分布の件数（全シード・同じシード）。 */
const MOCK_COUNTS = { all: 120, seed: 24 } as const;

/** シードから決まる乱数（mulberry32）。 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** packages/stats の histogramOf と同じ切り方（20 本）と中央値。 */
function bin(values: number[], value: number): Histogram {
  const position = {
    above: values.filter((v) => v > value).length,
    equal: values.filter((v) => v === value).length,
  };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const width = (max - min) / 20 || 1;
  const bins = Array.from({ length: 20 }, (_, i) => ({
    from: min + width * i,
    to: i === 19 ? max : min + width * (i + 1),
    count: 0,
  }));
  for (const v of values)
    bins[Math.min(19, Math.floor((v - min) / width))]!.count++;
  return { count: values.length, min, max, median, bins, position };
}

/** 自分の値の周りに散らした値（だいたい真ん中より少し上に自分が来る）。 */
function spread(
  axis: ResultAxisId,
  value: number,
  n: number,
  next: () => number,
): number[] {
  return Array.from({ length: n }, () => {
    const z = next() + next() + next() - 1.6; // 平均 -0.1・およそ ±1.5
    if (axis === 'totalCost')
      return Math.max(0, value + z * Math.max(value * 0.4, 10));
    if (axis === 'satisfaction')
      return Math.max(0, Math.min(1, value + z * 0.08));
    return value + z * Math.max(Math.abs(value) * 0.4, 10);
  });
}

/** 架空の分布（Distribution と同じ形。自分は含まない）。 */
export function mockDistribution(q: {
  scenarioId: string;
  seed: number;
  axes: ResultAxes;
}): Distribution {
  const next = rng(q.seed * 2654435761);
  const axes = Object.fromEntries(
    RESULT_AXES.map(({ id }) => {
      const v = q.axes[id];
      return [
        id,
        {
          seed: bin(spread(id, v, MOCK_COUNTS.seed, next), v),
          all: bin(spread(id, v, MOCK_COUNTS.all, next), v),
        },
      ];
    }),
  ) as Distribution['axes'];
  return { scenarioId: q.scenarioId, seed: q.seed, axes };
}
