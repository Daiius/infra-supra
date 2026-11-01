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
    expect(p.growth).toBe(1); // 比がまだ無い
    expect(p.nextProfit).toBeCloseTo(diff);
    expect(p.final).toBeCloseTo(
      st.cash + diff * (ARTICLE_COMMUNITY.months - 1),
    );
    expect(p.projection[0]).toEqual({ month: 1, value: st.cash });
    expect(p.projection.at(-1)!.month).toBe(ARTICLE_COMMUNITY.months);
  });

  it('月の利益の前月比（中央値・クランプ）で伸ばし、一時的に流量が増えた月は除く', () => {
    const st = after(5);
    // 3・4 か月目は Bot の大量アクセス（見えている出来事）。基準にも比にも使わない
    expect(st.history[2]!.trafficNote).toBeDefined();
    expect(st.history[3]!.trafficNote).toBeDefined();
    const p = cashProjectionOf(st)!;
    const c = [ARTICLE_COMMUNITY.startCash, ...st.history.map((r) => r.cash)];
    const pr = (m: number) => c[m]! - c[m - 1]!;
    // 飛んだ月をはさむ比は 1 か月あたりに直す。2 つの比の中央値は平均
    const ratios = [pr(2) / pr(1), Math.cbrt(pr(5) / pr(2))];
    const med = (ratios[0]! + ratios[1]!) / 2;
    expect(p.method).toBe('growth');
    expect(p.skipped).toBe(2);
    expect(p.growth).toBeCloseTo(Math.min(1.2, Math.max(0.8, med)));
    expect(p.nextProfit).toBeCloseTo(pr(5) * p.growth);
    // 単調に増え、最終月の見込みに着く
    const vs = p.projection.map((x) => x.value);
    vs.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(vs[i]!));
    expect(vs.at(-1)).toBeCloseTo(p.final);
    expect(p.ratio).toBeCloseTo(p.final / ARTICLE_COMMUNITY.goal.cash);
  });

  it('何もしなくても達成する Cloudflare Paid を「届かなそう」と言わない', () => {
    // 線形では 5 か月目に $1,139（66%）で「届かなそう」と出ていた（D-42 の改定）
    for (const m of [3, 5, 6, 7, 9])
      expect(cashProjectionOf(after(m))!.outlook).not.toBe('behind');
    expect(cashProjectionOf(after(7))!.outlook).toBe('ahead');
  });

  it('月の利益が 0 以下なら伸びを入れず、直近 3 か月の平均で線形に伸ばす', () => {
    const st = after(4);
    const cash = [100, 90, 80, 70];
    const h = st.history.map((r, i) => ({ ...r, cash: cash[i]! }));
    const p = cashProjectionOf({ ...st, history: h })!;
    expect(p.method).toBe('linear');
    expect(p.growth).toBe(1);
    expect(p.nextProfit).toBeCloseTo(-10);
    expect(p.final).toBeCloseTo(70 - 10 * 8);
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
