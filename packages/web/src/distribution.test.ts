// 分布の中での位置の数え方（D-162・D-163・D-166・D-168）。
import type { ResultAxes } from 'game';
import type { Distribution, Histogram } from 'stats';
import { describe, expect, it } from 'vitest';
import {
  distributionFireworkLevel,
  membershipOf,
  MIN_DISTRIBUTION_COUNT,
  parseMembership,
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

  it('全シードが少なければ few・同じシードだけ少なければ全シードで上位を見る', () => {
    const few = standingsOf(
      dist(() => ({
        seed: h(1, 0, 1),
        all: h(MIN_DISTRIBUTION_COUNT - 1, 0, 1),
      })),
      axes,
      true,
    );
    expect(few).toEqual({ status: 'few', count: MIN_DISTRIBUTION_COUNT - 1 });
    const v = standingsOf(
      dist(() => ({ seed: h(3, 2, 1), all: h(40, 0, 1) })),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    expect(v.view.axes[0]!.seed).toBeNull();
    expect(v.view.axes[0]!.seedCount).toBe(3);
    expect(v.view.axes[0]!.inTop).toBe(true);
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

  it('全シードの件数も軸ごとに見る: ④ だけ少なければその欄だけ出さない（OCL-22EC415E）', () => {
    const v = standingsOf(
      dist((id) =>
        id === 'totalCost'
          ? { seed: h(2, 0, 1), all: h(MIN_DISTRIBUTION_COUNT - 1, 0, 1) }
          : { seed: h(20, 19, 1), all: h(40, 39, 1) },
      ),
      axes,
      true,
    );
    if (v.status !== 'ready') throw new Error(v.status);
    const cost = v.view.axes.find((a) => a.id === 'totalCost')!;
    expect(cost).toMatchObject({
      all: null,
      allCount: MIN_DISTRIBUTION_COUNT - 1,
      seed: null,
      inTop: false,
    });
    expect(v.view.axes[0]!.all).not.toBeNull();
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
