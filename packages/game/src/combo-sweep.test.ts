// 組み合わせの総当たり（性質ベース。prd/05）: 2 シナリオ × フレームワーク × 構成 × 始める画面で選べる部品のすべての組み合わせで、
// 何もしないで最後まで（終わるまで）回し、壊れていないことを確かめる。金額そのものは期待値に書かない（実在の料金のため）。
// 組み合わせは全部で約 2,000（全部回して数秒）。増えて遅くなったら、各スロットの各選択肢が 1 回は出る組（pairwise）に絞る。
import type { Choices, SlotId } from 'catalog';
import { describe, expect, it } from 'vitest';
import {
  componentConflict,
  frameworksOf,
  newGame,
  newSave,
  playMonth,
  replaySave,
  SCENARIOS,
  setupProblem,
  setupRevalidateOptions,
  setupSlots,
  STACKS,
  stackSupports,
  USD_JPY,
  validSetupChoices,
  withTurn,
  type GameState,
  type FrameworkId,
  type Scenario,
} from './index.ts';

/** 選ぶスロット（固定・ファイルの置き場を除く）。 */
const choosable = (
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
  choices: Choices = {},
) =>
  setupSlots(sc, stackIndex, fw, choices).filter(
    (x): x is typeof x & { slot: SlotId } => !x.fixed && x.slot !== 'files',
  );

/**
 * 始める画面で選べる部品の組み合わせ（すべて）。各スロットの選択肢の直積から、今の選択で出ないスロット（API を他の事業者に
 * 置いたときの DB）を落とし、どの選択も部品どうしの依存（componentConflict。画面で選べなくなる理由）に当たらないものだけを残す。
 */
function selectableCombos(
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
): Choices[] {
  const platform = STACKS[stackIndex]!.provider;
  let raw: Choices[] = [{}];
  for (const x of choosable(sc, stackIndex, fw))
    raw = raw.flatMap((c) => x.options.map((o) => ({ ...c, [x.slot]: o.id })));
  const out = new Map<string, Choices>();
  for (const c of raw) {
    const visible = choosable(sc, stackIndex, fw, c);
    const d: Choices = {};
    for (const x of visible) {
      const v = c[x.slot];
      if (v !== undefined) d[x.slot] = v;
    }
    if (
      visible.every(
        (x) =>
          x.options.some((o) => o.id === d[x.slot]) &&
          componentConflict(platform, x.slot, d[x.slot]!, d, fw) === null,
      )
    )
      out.set(JSON.stringify(d), d);
  }
  return [...out.values()];
}

type Group = { sc: Scenario; fw: FrameworkId; stackIndex: number };
const GROUPS: Group[] = Object.values(SCENARIOS).flatMap((sc) =>
  frameworksOf(sc).allowed.flatMap((fw) =>
    STACKS.filter((s) => stackSupports(s.index, fw)).map((s) => ({
      sc,
      fw,
      stackIndex: s.index,
    })),
  ),
);

const playToEnd = (s: GameState): GameState => {
  let st = playMonth(s);
  while (st.phase === 'playing') st = playMonth(st);
  return st;
};

/** 状態の中の有限でない数（シナリオの定義は入力なので見ない）。 */
function nonFinite(x: unknown, path: string, out: string[]): void {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) out.push(`${path} = ${x}`);
  } else if (x && typeof x === 'object' && !path.endsWith('.scenario'))
    for (const [k, v] of Object.entries(x)) nonFinite(v, `${path}.${k}`, out);
}

const toUsd = (amount: number, currency: string) =>
  currency === 'JPY' ? amount / USD_JPY : amount;

/** 終わった状態の月ごとの性質。破れた性質を文で返す（空なら通る）。 */
function violations(s: GameState): string[] {
  const out: string[] = [];
  nonFinite(s, 's', out);
  if (s.phase === 'playing') out.push('終わっていない');
  for (const h of s.history) {
    const m = `${h.month} か月目`;
    if (h.infraCost < 0) out.push(`${m}: 費用が負 ${h.infraCost}`);
    if (!(h.satisfaction.score >= 0 && h.satisfaction.score <= 1))
      out.push(`${m}: 満足度が範囲外 ${h.satisfaction.score}`);
    if (h.pv < 0 || h.revenue < 0) out.push(`${m}: PV・収益が負`);
    // 明細の合計 = 月の費用（クレジットは負の明細として入る）
    const sum = h.lines.reduce((a, l) => a + toUsd(l.amount, l.currency), 0);
    if (Math.abs(sum - h.infraCost) > 1e-9 * Math.max(1, h.infraCost))
      out.push(`${m}: 明細の合計 ${sum} ≠ 費用 ${h.infraCost}`);
    // クレジットを当てたあとも、事業者ごとの金額は負にならない（対象外のメーターに当たらない・余りを繰り越さない）
    const byProvider = new Map<string, number>();
    for (const l of h.lines) {
      const p = l.label.split(' ')[0]!;
      byProvider.set(p, (byProvider.get(p) ?? 0) + toUsd(l.amount, l.currency));
    }
    for (const [p, v] of byProvider)
      if (v < -1e-9) out.push(`${m}: ${p} の金額が負 ${v}`);
  }
  return out;
}

describe('組み合わせの総当たり（2 シナリオ × フレームワーク × 構成 × 部品）', () => {
  it('組み合わせは十分にある（列挙が空振りしていない）', () => {
    const n = GROUPS.reduce(
      (a, g) => a + selectableCombos(g.sc, g.stackIndex, g.fw).length,
      0,
    );
    expect(GROUPS.length).toBeGreaterThan(20);
    expect(n).toBeGreaterThan(500);
  });

  it.each(
    GROUPS.map((g) => [
      `${g.sc.id} × ${g.fw} × ${STACKS[g.stackIndex]!.id}`,
      g,
    ]),
  )('%s', (_, { sc, fw, stackIndex }) => {
    const combos = selectableCombos(sc, stackIndex, fw);
    expect(combos.length).toBeGreaterThan(0);

    // 始める画面に出る選択肢は、どれも少なくとも 1 つの組み合わせで選べる（選べない死んだ選択肢が無い）
    for (const x of choosable(sc, stackIndex, fw))
      for (const o of x.options)
        expect(
          combos.some((c) => c[x.slot] === o.id),
          `${x.slot}:${o.id}`,
        ).toBe(true);

    const revalidate = setupRevalidateOptions(sc, fw).map((o) => o.value);
    const problems: string[] = [];
    combos.forEach((c, i) => {
      // 再検証の選択肢は組み合わせごとに順に回す。シードも組み合わせごとに変える（出来事の出方を散らす）
      const r = revalidate.length
        ? revalidate[i % revalidate.length]
        : undefined;
      const seed = 1000 + i;
      const id = `${JSON.stringify(c)} r=${r} seed=${seed}`;
      try {
        // 始める画面で選べた組み合わせは、始められて、newGame がそのまま受け付ける
        if (setupProblem(sc, stackIndex, fw, c) !== null)
          problems.push(
            `${id}: setupProblem ${setupProblem(sc, stackIndex, fw, c)}`,
          );
        expect(validSetupChoices(sc, stackIndex, fw, c)).toEqual(c);
        const g0 = newGame(stackIndex, seed, sc, undefined, fw, c, r);
        expect(g0.framework).toBe(fw);
        expect(g0.components).toMatchObject(c);
        if (r !== undefined) expect(g0.settings.revalidateSec).toBe(r);

        const end = playToEnd(g0);
        for (const v of violations(end)) problems.push(`${id}: ${v}`);

        // 保存 → 再生で同じ最終状態（いくつかの組で）
        if (i % 10 === 0) {
          let save = newSave({
            scenarioId: sc.id,
            stackIndex,
            framework: fw,
            seed,
            startDate: end.startDate,
            components: c,
            ...(r !== undefined ? { revalidateSec: r } : {}),
          });
          for (let t = 1; t < end.history.length; t++)
            save = withTurn(save, []);
          expect(replaySave(save)).toEqual(end);
        }
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    });
    expect(problems).toEqual([]);
  });
});
