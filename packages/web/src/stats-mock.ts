// 開発用の架空の分布（D-164）。サーバーが無い環境で段 3 の画面（ヒストグラム・上位 %・花火の段）を確かめるためだけに使う。
// `pnpm dev` で VITE_STATS_MOCK=1 を立てたときだけ App.tsx が動的に読む（import.meta.env.DEV でない本番のビルドには入らない）。
// 🔒 値は遊んだ人の結果ではなく、自分の値の周りに散らした架空の値。画面に「開発用の架空の分布」と明記する。
import { RESULT_AXES, type ResultAxes, type ResultAxisId } from 'game';
import type { Distribution, GroupStat, Histogram } from 'stats';
import { STATS_FILTERS, type StatsFilter } from './distribution.ts';

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

/**
 * 絞り込みごとの架空の件数（D-175）。同じインフラ・同じ組み合わせでは同じシードが 10 件未満になり、「まだ n 件です」も
 * 確かめられる。同じ組み合わせは全シードも 10 件未満。
 */
const MOCK_FILTER_COUNTS: Record<
  Exclude<StatsFilter, 'all'>,
  { all: number; seed: number }
> = {
  stack: { all: 36, seed: 7 },
  framework: { all: 64, seed: 13 },
  both: { all: 8, seed: 2 },
};

/** 架空の分布（Distribution と同じ形。自分は含まない）。filter を付けると件数を減らし、別の乱数で散らす。 */
export function mockDistribution(
  q: {
    scenarioId: string;
    seed: number;
    axes: ResultAxes;
  },
  filter: StatsFilter = 'all',
): Distribution {
  const counts = filter === 'all' ? MOCK_COUNTS : MOCK_FILTER_COUNTS[filter];
  const next = rng(q.seed * 2654435761 + STATS_FILTERS.indexOf(filter));
  const axes = Object.fromEntries(
    RESULT_AXES.map(({ id }) => {
      const v = q.axes[id];
      return [
        id,
        {
          seed: bin(spread(id, v, counts.seed, next), v),
          all: bin(spread(id, v, counts.all, next), v),
        },
      ];
    }),
  ) as Distribution['axes'];
  return {
    scenarioId: q.scenarioId,
    seed: q.seed,
    // 架空の値なので、どの構成に絞ったかは持たない（画面は使わない）
    stack: null,
    framework: null,
    axes,
  };
}

/**
 * 架空の構成ごと（フレームワークごと）の要約（GET /api/results/groups と同じ形。D-175）。鍵ごとに件数と、自分の値の周りに
 * ずらした 25%・中央値・75% を作る。3 つ目ごとの鍵は 10 件未満にして「まだ n 件です」の行も出す。シードと鍵から決まる。
 */
export function mockGroups(q: {
  seed: number;
  axis: ResultAxisId;
  value: number;
  keys: readonly string[];
}): GroupStat[] {
  return q.keys.map((key, i) => {
    let h = q.seed >>> 0;
    for (const c of `${q.axis}:${key}`)
      h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const next = rng(h);
    const count =
      i % 3 === 2 ? Math.floor(next() * 10) : 10 + Math.floor(next() * 80);
    const [a, b, c] = spread(q.axis, q.value, 3, next).sort((x, y) => x - y);
    const width =
      Math.abs(c! - a!) / 2 + (q.axis === 'satisfaction' ? 0.02 : 5);
    const median = b!;
    const clamp = (x: number) =>
      q.axis === 'satisfaction'
        ? Math.max(0, Math.min(1, x))
        : q.axis === 'totalCost'
          ? Math.max(0, x)
          : x;
    return {
      key,
      count,
      p25: clamp(median - width * (0.5 + next() * 0.5)),
      median: clamp(median),
      p75: clamp(median + width * (0.5 + next() * 0.5)),
    };
  });
}
