// 組み合わせの総当たり（性質ベース。prd/05）: 2 シナリオ × フレームワーク × 構成（隠した構成を除く。D-100）のすべてと、
// 始める画面で選べる部品の pairwise の組み合わせ（どの 2 つのスロットの選択肢の組も、少なくとも 1 つの組み合わせに出る。D-114 CP-14）で、
// 何もしないで最後まで（終わるまで）回し、壊れていないことを確かめる。金額そのものは期待値に書かない（実在の料金のため）。
// 部品の直積は事業者をまたぐ部品（D-114）で桁で増えるので、2026-11-04 に直積から pairwise に切り替えた。構成ごとの既定の部品の組み合わせは必ず回す。
import type { Choices, SlotId } from 'catalog';
import { describe, expect, it, vi } from 'vitest';

// 1 群で数百の組を 12 か月回し、1 本で十数秒かかるので、パッケージの 30 秒（vitest.config.ts）より上げる（D-87・D-98）
vi.setConfig({ testTimeout: 120_000 });
import { pairwise, seedOf, type Combo } from './pairwise.test-helpers.ts';
import {
  applyAction,
  checkAction,
  commentsOf,
  componentConflict,
  frameworksOf,
  newGame,
  newSave,
  partsOfComments,
  playMonth,
  replaySave,
  SCENARIOS,
  setupProblem,
  setupCommentOptions,
  setupMonthOneEstimate,
  setupRevalidateOptions,
  setupSlots,
  STACKS,
  stackOffered,
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

/** 始める画面で選べる形に直す（今の選択で出るスロットだけ・どれも選択肢にあり・依存に当たらない）。選べなければ null。 */
function normalizeChoices(
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
  c: Choices,
): Choices | null {
  const platform = STACKS[stackIndex]!.provider;
  const visible = choosable(sc, stackIndex, fw, c);
  const d: Choices = {};
  for (const x of visible) {
    const v = c[x.slot];
    if (v === undefined || !x.options.some((o) => o.id === v)) return null;
    d[x.slot] = v;
  }
  return visible.every(
    (x) => componentConflict(platform, x.slot, d[x.slot]!, d, fw) === null,
  )
    ? d
    : null;
}

/**
 * スロットと選択肢の和（既定の選択で出るスロットと、1 つの選択で現れるスロット（DB で決まる DB のバックアップ。D-93））。
 */
function domainOf(sc: Scenario, stackIndex: number, fw: FrameworkId) {
  const slots = new Map<SlotId, string[]>();
  const addAll = (xs: ReturnType<typeof choosable>) => {
    for (const x of xs) {
      const os = slots.get(x.slot) ?? [];
      for (const o of x.options) if (!os.includes(o.id)) os.push(o.id);
      slots.set(x.slot, os);
    }
  };
  const base = choosable(sc, stackIndex, fw);
  addAll(base);
  for (const x of base)
    for (const o of x.options)
      addAll(choosable(sc, stackIndex, fw, { [x.slot]: o.id }));
  return [...slots].map(([slot, options]) => ({ slot, options }));
}

const pairwiseCache = new Map<string, ReturnType<typeof pairwise>>();

/**
 * 始める画面で選べる部品の組み合わせ（pairwise。D-114 CP-14）。どの 2 つのスロットの選択肢の組も、選べる組み合わせのどれかに出る
 * （選択で消えるスロットとの組・部品どうしの依存（componentConflict。画面で選べなくなる理由）に当たる組は作れないので除く）。
 * 先頭は構成の既定の部品。乱数のシードはグループの名前で決まる（決定論）。
 */
function pairwiseOf(sc: Scenario, stackIndex: number, fw: FrameworkId) {
  const key = `${sc.id}|${fw}|${STACKS[stackIndex]!.id}`;
  const hit = pairwiseCache.get(key);
  if (hit) return hit;
  const platform = STACKS[stackIndex]!.provider;
  const defaults = newGame(stackIndex, 0, sc, undefined, fw).components;
  const r = pairwise(
    domainOf(sc, stackIndex, fw),
    (c) => normalizeChoices(sc, stackIndex, fw, c) as Combo | null,
    seedOf(key),
    {
      base: [defaults as Combo],
      allowed: (slot, o, partial) =>
        componentConflict(platform, slot as SlotId, o, partial, fw) === null,
    },
  );
  pairwiseCache.set(key, r);
  return r;
}

const selectableCombos = (
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
): Choices[] => pairwiseOf(sc, stackIndex, fw).combos as Choices[];

/** 組み合わせ i のコメントの描き方（再検証の一巡ごとに替える。選べないなら undefined。D-82）。 */
const commentAt = (
  comments: readonly number[],
  i: number,
  revalidateCount: number,
): number | undefined =>
  comments.length
    ? comments[Math.floor(i / Math.max(1, revalidateCount)) % comments.length]
    : undefined;

type Group = { sc: Scenario; fw: FrameworkId; stackIndex: number };
const GROUPS: Group[] = Object.values(SCENARIOS).flatMap((sc) =>
  frameworksOf(sc).allowed.flatMap((fw) =>
    // 隠した構成（D-100）は始める画面に出ないので回さない
    STACKS.filter((s) => stackOffered(s.index, fw)).map((s) => ({
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
      const p = l.provider;
      byProvider.set(p, (byProvider.get(p) ?? 0) + toUsd(l.amount, l.currency));
    }
    for (const [p, v] of byProvider)
      if (v < -1e-9) out.push(`${m}: ${p} の金額が負 ${v}`);
  }
  return out;
}

describe('組み合わせの総当たり（2 シナリオ × フレームワーク × 構成 × 部品の pairwise）', () => {
  it('組み合わせは十分にある（列挙が空振りしていない）', () => {
    const n = GROUPS.reduce(
      (a, g) => a + selectableCombos(g.sc, g.stackIndex, g.fw).length,
      0,
    );
    expect(GROUPS.length).toBeGreaterThan(20);
    expect(n).toBeGreaterThan(500);
  });

  it('pairwise の組み合わせは、作れる 2 つの組をすべて覆い、作れない組には直接の理由がある（選択で消える・依存に当たる）', () => {
    const problems: string[] = [];
    for (const g of GROUPS) {
      const r = pairwiseOf(g.sc, g.stackIndex, g.fw);
      const platform = STACKS[g.stackIndex]!.provider;
      const id = `${g.sc.id} × ${g.fw} × ${STACKS[g.stackIndex]!.id}`;
      // 先頭は構成の既定の部品（土台の既定の総当たり）
      expect(r.combos[0]).toEqual(
        normalizeChoices(
          g.sc,
          g.stackIndex,
          g.fw,
          newGame(g.stackIndex, 0, g.sc, undefined, g.fw).components,
        ),
      );
      for (const p of r.infeasible) {
        const [[x, a], [y, b]] = p
          .split('&')
          .map((s) => s.split('=') as [SlotId, string]) as [
          [SlotId, string],
          [SlotId, string],
        ];
        const both: Choices = { [x]: a, [y]: b };
        const visible = choosable(g.sc, g.stackIndex, g.fw, both).map(
          (s) => s.slot,
        );
        const direct =
          !visible.includes(x) ||
          !visible.includes(y) ||
          componentConflict(platform, x, a, both, g.fw) !== null ||
          componentConflict(platform, y, b, both, g.fw) !== null;
        if (!direct)
          problems.push(`${id}: ${p} が作れない（直接の理由が無い）`);
      }
    }
    expect(problems).toEqual([]);
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
    const comments = setupCommentOptions(sc, fw).map((o) => o.value);
    const problems: string[] = [];
    combos.forEach((c, i) => {
      // 再検証の選択肢は組み合わせごとに順に回す。シードも組み合わせごとに変える（出来事の出方を散らす）
      const r = revalidate.length
        ? revalidate[i % revalidate.length]
        : undefined;
      // コメントの描き方（D-82）は再検証の一巡ごとに替える（再検証の各値と組む）
      const cm = commentAt(comments, i, revalidate.length);
      const seed = 1000 + i;
      const id = `${JSON.stringify(c)} r=${r} cm=${cm} seed=${seed}`;
      try {
        // 始める画面で選べた組み合わせは、始められて、newGame がそのまま受け付ける
        if (setupProblem(sc, stackIndex, fw, c) !== null)
          problems.push(
            `${id}: setupProblem ${setupProblem(sc, stackIndex, fw, c)}`,
          );
        expect(validSetupChoices(sc, stackIndex, fw, c)).toEqual(c);
        const g0 = newGame(
          stackIndex,
          seed,
          sc,
          undefined,
          fw,
          c,
          r,
          partsOfComments(sc, cm),
        );
        expect(g0.framework).toBe(fw);
        expect(g0.components).toMatchObject(c);
        if (r !== undefined) expect(g0.settings.revalidateSec).toBe(r);
        if (cm !== undefined) expect(commentsOf(sc, g0.routeParts)).toBe(cm);

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
            ...(cm !== undefined
              ? { routeParts: partsOfComments(sc, cm) ?? {} }
              : {}),
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

// アプリの作り直し（D-81）: 各組み合わせ（3 つに 1 つ）で 1 か月目の終わりに作り直しを始め、終わるまで回す。
// 作り直した後の部品は、新しいフレームワークの始める画面で選べる組み合わせになっている（死んだ選択・依存の崩れが無い）
describe('作り直しの総当たり（2 シナリオ × 構成 × 元と先のフレームワーク × 部品）', () => {
  const PAIRS = GROUPS.flatMap((g) =>
    frameworksOf(g.sc)
      .allowed.filter((to) => to !== g.fw)
      .map((to) => ({ ...g, to })),
  );
  let switchedAll = 0;
  it.each(
    PAIRS.map((p) => [
      `${p.sc.id} × ${STACKS[p.stackIndex]!.id} × ${p.fw} → ${p.to}`,
      p,
    ]),
  )('%s', (_, { sc, fw, to, stackIndex }) => {
    const platform = STACKS[stackIndex]!.provider;
    const supported = stackSupports(stackIndex, to);
    const problems: string[] = [];
    let switched = 0;
    selectableCombos(sc, stackIndex, fw).forEach((c, i) => {
      if (i % 3 !== 0) return;
      const seed = 2000 + i;
      const id = `${JSON.stringify(c)} seed=${seed}`;
      try {
        const m1 = playMonth(newGame(stackIndex, seed, sc, undefined, fw, c));
        if (m1.phase !== 'playing') return;
        const action = { type: 'rewrite', framework: to } as const;
        const check = checkAction(m1, action);
        // 載せられない組（Astro・静的書き出し × AWS など）は理由を付けて選べない
        if (!supported) {
          if (check.ok || check.reason !== 'unavailable')
            problems.push(`${id}: 載せられない組が選べる`);
          return;
        }
        if (!check.ok) {
          problems.push(`${id}: ${check.message}`);
          return;
        }
        let st = playMonth(applyAction(m1, action));
        while (st.phase === 'playing' && st.rewrite) st = playMonth(st);
        if (st.rewrite === null && st.framework !== to)
          problems.push(
            `${id}: 作り直しが済んだのにフレームワークが ${st.framework}`,
          );
        if (st.rewrite === null && st.framework === to) {
          switched++;
          // 作り直した後の部品は、新しいフレームワークの始める画面で選べる（提案で付く部品・既定の部品は除いて同じ）
          const valid = validSetupChoices(sc, stackIndex, to, st.components);
          for (const x of choosable(sc, stackIndex, to, st.components)) {
            const v = st.components[x.slot];
            if (v === undefined || valid[x.slot] !== v)
              problems.push(`${id}: 作り直した後の ${x.slot}=${v} が選べない`);
            else if (componentConflict(platform, x.slot, v, st.components, to))
              problems.push(
                `${id}: 作り直した後の ${x.slot}=${v} が依存に当たる`,
              );
          }
        }
        while (st.phase === 'playing') st = playMonth(st);
        for (const v of violations(st)) problems.push(`${id}: ${v}`);
        // 保存 → 再生で同じ最終状態（いくつかの組で。D-26）
        if (i % 30 === 0) {
          let save = withTurn(
            newSave({
              scenarioId: sc.id,
              stackIndex,
              framework: fw,
              seed,
              startDate: st.startDate,
              components: c,
              // 始める画面と同じく、始めたときの再検証を保存に書く（無い保存は D-125 より前の既定で読む）
              revalidateSec: m1.settings.revalidateSec,
            }),
            [action],
          );
          for (let t = 2; t < st.history.length; t++) save = withTurn(save, []);
          expect(replaySave(save)).toEqual(st);
        }
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    });
    expect(problems).toEqual([]);
    switchedAll += switched;
  });
  // 無料のプランなどは作り直しが済む前に終わる組もあるので、全体で十分な数が済むことを確かめる
  it('作り直しが済んだ組が十分にある', () => {
    expect(switchedAll).toBeGreaterThan(300);
  });
});

// 始める画面の 1 か月目の見込み（D-72）: 出来事の無い 1 か月目の実際の費用と一致し、所持金が尽きる組で警告が出る
describe('1 か月目の費用の見込み（D-72）', () => {
  it('出来事の無い 1 か月目の実際の費用・所持金切れと一致する（pairwise の全組み合わせ）', () => {
    const problems: string[] = [];
    let checked = 0;
    let short = 0;
    for (const { sc, fw, stackIndex } of GROUPS) {
      const revalidate = setupRevalidateOptions(sc, fw).map((o) => o.value);
      const comments = setupCommentOptions(sc, fw).map((o) => o.value);
      selectableCombos(sc, stackIndex, fw).forEach((c, i) => {
        const r = revalidate.length
          ? revalidate[i % revalidate.length]
          : undefined;
        const cm = commentAt(comments, i, revalidate.length);
        const id = `${sc.id} × ${fw} × ${STACKS[stackIndex]!.id} ${JSON.stringify(c)} r=${r} cm=${cm}`;
        const e = setupMonthOneEstimate(sc, stackIndex, fw, c, r, cm);
        // 出来事も障害も無い 1 か月目になるシードを探す
        for (let seed = 1; seed <= 30; seed++) {
          const s = playMonth(
            newGame(
              stackIndex,
              seed,
              sc,
              undefined,
              fw,
              c,
              r,
              partsOfComments(sc, cm),
            ),
          );
          const h = s.history[0]!;
          if (h.events.length > 0 || h.status === 'incident') continue;
          checked++;
          const near = (a: number, b: number) =>
            Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
          if (!near(e.costUsd, h.infraCost))
            problems.push(`${id}: 費用 ${e.costUsd} ≠ ${h.infraCost}`);
          if (!near(e.revenueUsd, h.revenue))
            problems.push(`${id}: 収益 ${e.revenueUsd} ≠ ${h.revenue}`);
          const ranOut = s.end?.reason === 'cash' && s.end.month === 1;
          if (e.short !== ranOut)
            problems.push(`${id}: 見込み ${e.short} ≠ 所持金切れ ${ranOut}`);
          if (e.short) {
            short++;
            if (e.topLines.length === 0) problems.push(`${id}: 主な費用が無い`);
          }
          break;
        }
      });
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(500);
    // 尽きる組は実際にある（網羅テスト #36 で約 390 組）
    expect(short).toBeGreaterThan(50);
  });
});
