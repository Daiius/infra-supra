// 所持金の見込み（D-42）: 直近 3 か月の月の利益の平均で最終月まで線形に伸ばす目安。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  cashProjectionOf,
  newGame,
  playMonth,
  playStrategy,
  type GameState,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const CF_PAID = 1;
const PRO = 3;

/** 何もしない方針で n か月進めた状態。 */
function after(n: number, stackIndex = CF_PAID, sc = ARTICLE_COMMUNITY) {
  let st: GameState = newGame(stackIndex, 42, sc);
  for (let i = 0; i < n && st.phase === 'playing'; i++) st = playMonth(st);
  return st;
}

describe('cashProjectionOf', () => {
  it('まだ進んでいなければ出さない', () => {
    expect(cashProjectionOf(newGame(CF_PAID, 42))).toBeUndefined();
  });

  it('1 か月目は開始時からの差分 1 か月分で伸ばす', () => {
    const st = after(1);
    const p = cashProjectionOf(st)!;
    const diff = st.cash - ARTICLE_COMMUNITY.startCash;
    expect(p.window).toBe(1);
    expect(p.perMonth).toBeCloseTo(diff);
    expect(p.final).toBeCloseTo(
      st.cash + diff * (ARTICLE_COMMUNITY.months - 1),
    );
    expect(p.projection[0]).toEqual({ month: 1, value: st.cash });
    expect(p.projection.at(-1)!.month).toBe(ARTICLE_COMMUNITY.months);
  });

  it('直近 3 か月の平均を使い、見込みの線は単調で最終月の見込みに着く', () => {
    const st = after(5);
    const p = cashProjectionOf(st)!;
    const c = st.history.map((r) => r.cash);
    expect(p.window).toBe(3);
    expect(p.perMonth).toBeCloseTo((c[4]! - c[1]!) / 3);
    const vs = p.projection.map((x) => x.value);
    const up = p.perMonth >= 0;
    vs.slice(1).forEach((v, i) =>
      up
        ? expect(v).toBeGreaterThanOrEqual(vs[i]!)
        : expect(v).toBeLessThanOrEqual(vs[i]!),
    );
    expect(vs.at(-1)).toBeCloseTo(p.final);
    expect(p.ratio).toBeCloseTo(p.final / ARTICLE_COMMUNITY.goal.cash);
  });

  it('最終月まで済めば実際の所持金と一致し、線は出さない', () => {
    for (const [i, won] of [
      [CF_PAID, true],
      [PRO, false],
    ] as const) {
      const st = playStrategy({ id: 'idle', label: 'x', stackIndex: i });
      const p = cashProjectionOf(st)!;
      expect(p.final).toBe(st.cash);
      expect(p.projection).toEqual([]);
      expect(p.onTrack).toBe(won);
    }
  });

  it('受託のシナリオでも同じ仕組み（目標は受託の値）', () => {
    const st = after(4, CF_PAID, CONTRACT_OPERATIONS);
    const p = cashProjectionOf(st)!;
    expect(p.goal).toBe(CONTRACT_OPERATIONS.goal.cash);
    expect(p.projection.at(-1)!.month).toBe(CONTRACT_OPERATIONS.months);
  });
});
