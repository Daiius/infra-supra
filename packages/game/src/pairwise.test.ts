// pairwise の組み合わせの作り方（D-114 CP-14・combo-sweep.test.ts が使う）。架空のスロットで、2 つの組を全部覆うこと・決定論・依存の扱いを確かめる。
import { describe, expect, it } from 'vitest';
import { pairwise, type Combo, type Domain } from './pairwise.test-helpers.ts';

const DOMAIN: Domain = ['a', 'b', 'c', 'd', 'e'].map((slot) => ({
  slot,
  options: ['1', '2', '3', '4'],
}));

/** 組み合わせが覆う 2 つの組。 */
const covered = (cs: readonly Combo[]) =>
  new Set(
    cs.flatMap((c) => {
      const e = Object.entries(c);
      return e.flatMap(([x, a], i) =>
        e
          .slice(i + 1)
          .map(([y, b]) => [`${x}=${a}`, `${y}=${b}`].sort().join('&')),
      );
    }),
  );

describe('pairwise の組み合わせ', () => {
  it('依存が無ければ、2 つの組をすべて覆い、直積よりずっと少ない', () => {
    const r = pairwise(DOMAIN, (c) => c, 1);
    expect(r.infeasible).toEqual([]);
    // 5 スロット × 4 択の組は 10 × 16 = 160
    expect(r.pairs).toBe(160);
    expect(covered(r.combos).size).toBe(160);
    // 直積は 4^5 = 1,024。2 つの組の下限は 4 × 4 = 16
    expect(r.combos.length).toBeGreaterThanOrEqual(16);
    expect(r.combos.length).toBeLessThan(40);
  });

  it('同じシードなら同じ組み合わせ（決定論）', () => {
    expect(pairwise(DOMAIN, (c) => c, 7)).toEqual(
      pairwise(DOMAIN, (c) => c, 7),
    );
  });

  it('base は先に入る。選択で消えるスロット・依存に当たる組は、作れない組として外す', () => {
    // a=1 のとき b は効かない（出さない）。c=4 と d=4 は一緒に選べない
    const normalize = (c: Combo): Combo | null => {
      if (c.c === '4' && c.d === '4') return null;
      if (c.a !== '1') return c;
      const { b: _b, ...rest } = c;
      void _b;
      return rest;
    };
    const base = { a: '2', b: '2', c: '2', d: '2', e: '2' };
    const r = pairwise(DOMAIN, normalize, 3, {
      base: [base],
      allowed: (slot, o, p) =>
        !(slot === 'd' && o === '4' && p.c === '4') &&
        !(slot === 'c' && o === '4' && p.d === '4'),
    });
    expect(r.combos[0]).toEqual(base);
    expect(r.infeasible.sort()).toEqual(
      ['a=1&b=1', 'a=1&b=2', 'a=1&b=3', 'a=1&b=4', 'c=4&d=4'].sort(),
    );
    for (const c of r.combos) expect(normalize(c)).toEqual(c);
    expect(covered(r.combos).size).toBe(r.pairs - r.infeasible.length);
  });
});
