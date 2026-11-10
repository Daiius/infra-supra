// 分布の中での位置の数え方（D-162・D-163・D-166・D-168・D-198）。
import type { ResultAxes } from 'game';
import type { Distribution, Histogram } from 'stats';
import { describe, expect, it } from 'vitest';
import {
  axisStandingsOf,
  DEFAULT_BREAKDOWN_PREFS,
  distributionFireworkLevel,
  filterParams,
  groupRowsOf,
  parseBreakdownPrefs,
  membershipOf,
  MIN_DRAWN_COUNT,
  MIN_RANKED_COUNT,
  parseMembership,
  rankBasisOf,
  STATS_MEMBERSHIP_LIMIT,
  withMembership,
  standingsOf,
  topPercentOf,
} from './distribution.ts';

const h = (count: number, above: number, equal: number): Histogram => ({
  count,
  min: 0,
  max: 1,
  median: 0.5,
  bins: [{ from: 0, to: 1, count }],
  position: { above, equal },
});

const axes: ResultAxes = {
  cash: 1,
  satisfaction: 1,
  featurePoints: 1,
  totalCost: 1,
};

function dist(
  per: (id: keyof ResultAxes) => { seed: Histogram; all: Histogram },
): Distribution {
  return {
    scenarioId: 'article-community',
    seed: 1,
    stack: null,
    framework: null,
    axes: {
      cash: per('cash'),
      satisfaction: per('satisfaction'),
      featurePoints: per('featurePoints'),
      totalCost: per('totalCost'),
    },
  };
}

describe('topPercentOf', () => {
  it('自分以上の件数 ÷ 件数を百分率の整数にし、1〜100 に収める', () => {
    expect(topPercentOf(100, 1)).toBe(1);
    expect(topPercentOf(1000, 1)).toBe(1);
    expect(topPercentOf(40, 10)).toBe(25);
    expect(topPercentOf(10, 10)).toBe(100);
    expect(topPercentOf(0, 0)).toBe(100);
  });
});

describe('standingsOf', () => {
  it('自分を含む分布では同じ値の自分を 1 回だけ数え、含まない分布では自分を 1 件足す', () => {
    const inc = standingsOf(
      dist(() => ({ seed: h(20, 4, 1), all: h(20, 4, 1) })),
      axes,
      true,
    );
    if (inc.status !== 'ready') throw new Error(inc.status);
    expect(inc.view.axes[0]!.all).toMatchObject({
      n: 20,
      topPercent: 25,
      inTop: true,
    });
    // 最後の桁の差で equal が 0 でも、自分は 1 件として数える
    const zero = standingsOf(
      dist(() => ({ seed: h(20, 4, 0), all: h(20, 4, 0) })),
      axes,
      true,
    );
    if (zero.status !== 'ready') throw new Error(zero.status);
    expect(zero.view.axes[0]!.all!.topPercent).toBe(25);
    const exc = standingsOf(
      dist(() => ({ seed: h(19, 4, 0), all: h(19, 4, 0) })),
      axes,
      false,
    );
    if (exc.status !== 'ready') throw new Error(exc.status);
    expect(exc.view.axes[0]!.all).toMatchObject({ n: 20, topPercent: 25 });
    expect(exc.view.included).toBe(false);
  });

  it('下限は 2 つ: 上位の判定は 10 件・描くのは 1 件から（D-198）', () => {
    expect(MIN_RANKED_COUNT).toBe(10);
    expect(MIN_DRAWN_COUNT).toBe(1);
  });

  it('全シードが少なければ few・同じシードだけ少なければ描くが、上位は全シードで見る（D-163・D-198）', () => {
    const few = standingsOf(
      dist(() => ({
        seed: h(1, 0, 1),
        all: h(MIN_RANKED_COUNT - 1, 0, 1),
      })),
      axes,
      true,
    );
    expect(few).toEqual({ status: 'few', count: MIN_RANKED_COUNT - 1 });
    const v = standingsOf(
      dist(() => ({ seed: h(3, 2, 1), all: h(40, 0, 1) })),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    const a = v.view.axes[0]!;
    // 同じシードは 3 件でも描く（上位の判定には使わない）
    expect(a.seed).toMatchObject({ n: 3, ranked: false, inTop: false });
    expect(a.seedCount).toBe(3);
    expect(a.all).toMatchObject({ n: 40, ranked: true, inTop: true });
    expect(rankBasisOf(a)).toBe(a.all);
    expect(a.inTop).toBe(true);
  });

  it('同じシードが 10 件未満で上の方にいても、上位には数えない（全シードで見る。D-198）', () => {
    const v = standingsOf(
      dist(() => ({ seed: h(5, 0, 1), all: h(40, 39, 1) })),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    const a = v.view.axes[0]!;
    expect(a.seed).toMatchObject({ n: 5, topPercent: 20, ranked: false });
    expect(a.inTop).toBe(false);
    expect(distributionFireworkLevel(v.view)).toBe(1);
  });

  it('同じシードが見せられればそちらで上位を見る・花火の段は向きのある 3 軸の上位の数（0 → 1・1〜2 → 2・3 → 3。D-168）', () => {
    const level = (tops: number) => {
      // ④ 費用の合計は最後に置き、上位の位置でも数えない
      const ids = ['cash', 'satisfaction', 'featurePoints', 'totalCost'];
      const v = standingsOf(
        dist((id) => ({
          // 全シードは全部上位だが、同じシードの上位は tops 本だけ
          seed: ids.indexOf(id) < tops ? h(20, 0, 1) : h(20, 19, 1),
          all: h(40, 0, 1),
        })),
        axes,
        true,
      );
      if (v.status !== 'ready') throw new Error(v.status);
      return distributionFireworkLevel(v.view);
    };
    expect([0, 1, 2, 3, 4].map(level)).toEqual([1, 2, 2, 3, 3]);
  });

  it('全シードの件数も軸ごとに見る: ④ だけ少なければその欄だけ上位を数えずに描き、0 件なら出さない（OCL-22EC415E・D-198）', () => {
    const v = standingsOf(
      dist((id) =>
        id === 'totalCost'
          ? { seed: h(2, 0, 1), all: h(MIN_RANKED_COUNT - 1, 0, 1) }
          : id === 'featurePoints'
            ? { seed: h(0, 0, 0), all: h(0, 0, 0) }
            : { seed: h(20, 19, 1), all: h(40, 39, 1) },
      ),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    const cost = v.view.axes.find((a) => a.id === 'totalCost')!;
    expect(cost).toMatchObject({
      all: { n: MIN_RANKED_COUNT - 1, ranked: false },
      allCount: MIN_RANKED_COUNT - 1,
      seed: { n: 2, ranked: false },
      inTop: false,
    });
    const fp = v.view.axes.find((a) => a.id === 'featurePoints')!;
    expect(fp).toMatchObject({ all: null, seed: null, inTop: false });
    expect(v.view.axes[0]!.all).toMatchObject({ ranked: true });
  });

  it('④ 費用の合計は向きを持たないので、分布の上の方にいても上位に数えない（D-166）', () => {
    const v = standingsOf(
      dist((id) =>
        id === 'totalCost'
          ? { seed: h(20, 0, 1), all: h(40, 0, 1) }
          : { seed: h(20, 19, 1), all: h(40, 39, 1) },
      ),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    const cost = v.view.axes.find((a) => a.id === 'totalCost')!;
    expect(cost).toMatchObject({ directed: false, inTop: false });
    expect(distributionFireworkLevel(v.view)).toBe(1);
  });
});

describe('送ったプレイが分布に入ったかの記録', () => {
  it('足す・置き換える・上限で古いものを落とす・壊れた値を捨てる', () => {
    let m = parseMembership(null);
    m = withMembership(m, 'a', false);
    m = withMembership(m, 'b', true);
    m = withMembership(m, 'a', true);
    expect(m.entries).toEqual([
      ['a', true],
      ['b', true],
    ]);
    expect(membershipOf(m, 'a')).toBe(true);
    expect(membershipOf(m, 'z')).toBeUndefined();
    for (let i = 0; i < STATS_MEMBERSHIP_LIMIT + 5; i++)
      m = withMembership(m, `x${i}`, false);
    expect(m.entries).toHaveLength(STATS_MEMBERSHIP_LIMIT);
    expect(membershipOf(m, 'a')).toBeUndefined();
    expect(parseMembership({ version: 2, entries: [] }).entries).toEqual([]);
    expect(
      parseMembership({ version: 1, entries: [['a', true], ['b', 'x'], 3] })
        .entries,
    ).toEqual([['a', true]]);
  });
});

describe('構成・フレームワークごとの分布（ST-11・D-175）', () => {
  it('絞った分布は全体の件数で段 1 に戻さず、1 件から描く（10 件未満は上位の判定に使わない。D-198）', () => {
    const d = dist(() => ({ seed: h(3, 0, 1), all: h(9, 0, 1) }));
    expect(standingsOf(d, axes, true)).toEqual({ status: 'few', count: 9 });
    const v = axisStandingsOf(d, axes, true);
    expect(
      v.axes.map((a) => [
        a.seed?.n,
        a.seed?.ranked,
        a.all?.n,
        a.all?.ranked,
        a.inTop,
      ]),
    ).toEqual(Array(4).fill([3, false, 9, false, false]));
    // 入っていなければ自分を 1 件足す（10 件になれば上位の判定に使う）
    const out = axisStandingsOf(d, axes, false);
    expect(out.axes[0]!.all).toMatchObject({
      n: MIN_RANKED_COUNT,
      ranked: true,
    });
    // 1 件でも描く・0 件なら描かない（自分を足す分は数えない）
    const one = axisStandingsOf(
      dist(() => ({ seed: h(0, 0, 0), all: h(1, 0, 1) })),
      axes,
      false,
    );
    expect(one.axes[0]).toMatchObject({
      seed: null,
      seedCount: 1,
      all: { n: 2, ranked: false, inTop: false },
      inTop: false,
    });
  });

  it('チップから絞りの引数を作る（同じインフラ・同じフレームワーク・両方）', () => {
    const own = { stackId: 'sakura-vps-2gb', framework: 'astro' };
    expect(filterParams('all', own)).toEqual({});
    expect(filterParams('stack', own)).toEqual({ stack: 'sakura-vps-2gb' });
    expect(filterParams('framework', own)).toEqual({ framework: 'astro' });
    expect(filterParams('both', own)).toEqual({
      stack: 'sakura-vps-2gb',
      framework: 'astro',
    });
  });

  it('覚えた選択は形が違う欄だけ既定に戻す', () => {
    expect(parseBreakdownPrefs(null)).toEqual(DEFAULT_BREAKDOWN_PREFS);
    expect(
      parseBreakdownPrefs({ filter: 'both', by: 'nope', axis: 'totalCost' }),
    ).toEqual({ filter: 'both', by: 'stack', axis: 'totalCost' });
  });

  it('要約を出す行に写す: 並びは keys のまま・0 件の鍵（自分の構成でも）と keys に無い鍵は出さない・1〜9 件も同じ形で描く（D-198・D-199）', () => {
    const rows = groupRowsOf(
      [
        { key: 'b', count: 12, p25: 1, median: 2, p75: 3, bins: [9, 3] },
        { key: 'a', count: 1, p25: 4, median: 4, p75: 4, bins: [0, 1] },
        { key: 'hidden', count: 99, p25: 1, median: 2, p75: 3, bins: [9, 3] },
        { key: 'd', count: 0, p25: 0, median: 0, p75: 0, bins: [0, 0] },
      ],
      [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
        { key: 'd', label: 'D' },
      ],
      'b',
    );
    expect(rows).toEqual([
      {
        key: 'a',
        label: 'A',
        count: 1,
        stats: { p25: 4, median: 4, p75: 4, bins: [0, 1] },
        mine: false,
      },
      {
        key: 'b',
        label: 'B',
        count: 12,
        stats: { p25: 1, median: 2, p75: 3, bins: [9, 3] },
        mine: true,
      },
    ]);
    // 自分の構成でも 0 件なら行を出さない・全部 0 件なら空
    const keys = [
      { key: 'a', label: 'A' },
      { key: 'c', label: 'C' },
    ];
    const one = [
      { key: 'a', count: 2, p25: 1, median: 1.5, p75: 2, bins: [1, 1] },
    ];
    expect(groupRowsOf(one, keys, 'c').map((r) => [r.key, r.mine])).toEqual([
      ['a', false],
    ]);
    expect(groupRowsOf([], keys, 'a')).toEqual([]);
  });
});
