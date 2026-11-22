// バックエンドの長時間の処理（D-239・prd/17 §6 の出来事 7・PR-9）: VPS は空いている CPU で月をまたいで進み（追加の費用 0・プランが
// 大きいと速い）、サーバーレスは 1 か月で終わってその月に払う。普段の解析を滞留させず、保存から再生しても進み具合が残る。
// 出来事そのもの（文言・起きる月）は PR-10 なので、提案を受けた形をテストの中で作る。記事・受託の golden は game.test.ts・contract.test.ts が見る。
import { describe, expect, it } from 'vitest';
import { freeVcpuHoursOf } from './background-job.ts';
import {
  applyActions,
  DEFAULT_START_DATE,
  ESTIMATE_ONLY_SCENARIOS,
  newGame,
  newSave,
  playMonth,
  replaySave,
  SCENARIOS,
  STACKS,
  withTurn,
  type Action,
  type BackgroundJobDef,
  type GameState,
  type Scenario,
} from './index.ts';
import { KIFU_BACKGROUND_JOBS } from './scenarios/kifu-analysis.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const PRO = idx('vercel-supabase-pro');
const VPS2 = idx('sakura-vps-2gb');
const VPS4 = idx('sakura-vps-4gb');
const WORKERS = idx('cloudflare-vinext-paid');

/** 提案の id（テストの中だけ）。 */
const JOB_EVENT = 'k-job-test';

/** 棋譜解析（普段の月の規模 3 万 PV。D-238 の表と同じ）に、1 か月目に長時間の処理の提案が届く形を足したもの。 */
const scenarioWith = (job: BackgroundJobDef = KIFU_BACKGROUND_JOBS.strategy) =>
  ({
    ...ESTIMATE_ONLY_SCENARIOS['kifu-analysis']!,
    id: 'kifu-job-test',
    startCash: 1e9,
    scale: { startPV: 30_000 },
    events: [
      {
        id: JOB_EVENT,
        kind: 'proposal',
        tier: 'common',
        title: '長時間の処理（テスト）',
        text: 'テスト',
        when: { type: 'window', from: 1, to: 1 },
        premiseRefs: [],
        accept: {
          label: '始める',
          effects: [{ type: 'background-job', job }],
        },
      },
    ],
  }) satisfies Scenario;

const accept: Action = { type: 'respond', eventId: JOB_EVENT, accept: true };
const decline: Action = { type: 'respond', eventId: JOB_EVENT, accept: false };

/** months か月を遊ぶ（1 か月目の終わりに提案へ返事する）。 */
function play(
  stack: number,
  analysis: string,
  months: number,
  answer: Action = accept,
  sc: Scenario = scenarioWith(),
): GameState {
  let s = playMonth(
    newGame(stack, 1, sc, DEFAULT_START_DATE, 'nextjs', { analysis }),
  );
  expect(s.pendingProposals).toContain(JOB_EVENT);
  s = applyActions(s, [answer]);
  for (let m = 2; m <= months; m++) s = playMonth(s);
  return s;
}

/** 処理が終わった月（終わらなければ undefined）。 */
const finishedMonth = (s: GameState) =>
  s.history.find((r) => r.backgroundJobs?.some((j) => j.finished))?.month;

describe('VPS: 空いている CPU で月をまたいで進む', () => {
  it('worker の VPS は追加の費用 0 で、何か月かかけて終わる', () => {
    const on = play(PRO, 'worker-vps-4gb', 6);
    const off = play(PRO, 'worker-vps-4gb', 6, decline);
    const m2 = on.history[1]!.backgroundJobs![0]!;
    expect(m2.where).toBe('vps');
    expect(m2.nodeId).toBe('analysis-worker');
    expect(m2.usd).toBe(0);
    expect(m2.ran).toBeGreaterThan(0);
    expect(m2.ran).toBeLessThan(KIFU_BACKGROUND_JOBS.strategy.vcpuHours);
    expect(m2.finished).toBe(false);
    // 1 か月目の終わりに受け、2 か月目から進む（1 か月目は何もしない）
    expect(on.history[0]!.backgroundJobs).toBeUndefined();
    const done = finishedMonth(on)!;
    expect(done).toBeGreaterThan(2);
    // 毎月の費用は断ったゲームと同じ（VPS の月額の中）
    on.history.forEach((r, i) =>
      expect(r.infraCost).toBeCloseTo(off.history[i]!.infraCost, 9),
    );
    // 終わったら来月から持たない
    expect(on.backgroundJobs).toBeUndefined();
  });

  it('プランが大きいと空いている CPU が多く、速く終わる（worker 2GB・4GB、アプリの VPS 2GB・4GB）', () => {
    const w2 = play(PRO, 'worker-vps-2gb', 8);
    const w4 = play(PRO, 'worker-vps-4gb', 8);
    expect(w4.history[1]!.backgroundJobs![0]!.freeVcpuHours!).toBeGreaterThan(
      w2.history[1]!.backgroundJobs![0]!.freeVcpuHours!,
    );
    expect(finishedMonth(w4)!).toBeLessThan(finishedMonth(w2)!);
    const v2 = play(VPS2, 'same', 8).history[1]!.backgroundJobs![0]!;
    const v4 = play(VPS4, 'same', 8).history[1]!.backgroundJobs![0]!;
    expect(v2.nodeId).not.toBe('analysis-worker');
    expect(v4.ran).toBeGreaterThan(v2.ran);
  });

  it('空いている CPU = vCPU × 使用率の上限 × 月の時間 × (1 − 月の平均の比)。平均で埋まっていれば進まない', () => {
    const h = {
      nodeId: 'vps',
      vcpu: 4,
      cpuUtilMax: 0.7,
      peakHourFactor: 3,
    };
    expect(freeVcpuHoursOf({ ...h, peakRatio: 0 })).toBeCloseTo(4 * 0.7 * 730);
    expect(freeVcpuHoursOf({ ...h, peakRatio: 1.5 })).toBeCloseTo(
      4 * 0.7 * 730 * 0.5,
    );
    expect(freeVcpuHoursOf({ ...h, peakRatio: 3 })).toBe(0);
    expect(freeVcpuHoursOf({ ...h, peakRatio: 9 })).toBe(0);
  });

  it('端末・併用でもサーバー（アプリの VPS）で動かす', () => {
    for (const analysis of ['client', 'hybrid']) {
      const r = play(VPS4, analysis, 2).history[1]!.backgroundJobs![0]!;
      expect(r.where).toBe('vps');
      expect(r.nodeId).not.toBe('analysis-worker');
    }
  });

  it('普段の解析を滞留させない（ピークの比・解析の速さ・ページの速さは断ったゲームと同じ）', () => {
    for (const [stack, analysis] of [
      [PRO, 'worker-vps-2gb'],
      [VPS2, 'same'],
    ] as const) {
      const on = play(stack, analysis, 3).history[1]!;
      const off = play(stack, analysis, 3, decline).history[1]!;
      expect(on.backgroundJobs![0]!.ran).toBeGreaterThan(0);
      expect(on.satisfaction.stages).toEqual(off.satisfaction.stages);
      expect(on.satisfaction.reasons).toEqual(off.satisfaction.reasons);
      expect(on.premises.map((p) => [p.id, p.ratio])).toEqual(
        off.premises.map((p) => [p.id, p.ratio]),
      );
      expect(on.status).toBe(off.status);
    }
  });
});

describe('サーバーレス: 1 か月で終わり、その月に払う', () => {
  it('Vercel Functions・Workers は受けた翌月に終わり、追加の費用はその月の費用に入る', () => {
    for (const stack of [PRO, WORKERS]) {
      const on = play(stack, 'same', 3);
      const off = play(stack, 'same', 3, decline);
      const run = on.history[1]!.backgroundJobs![0]!;
      expect(run.where).toBe('serverless');
      expect(run.finished).toBe(true);
      expect(run.ran).toBe(KIFU_BACKGROUND_JOBS.strategy.vcpuHours);
      expect(run.usd).toBeGreaterThan(0);
      expect(on.history[1]!.infraCost).toBeCloseTo(
        off.history[1]!.infraCost + run.usd,
        6,
      );
      // 明細にも載る（同じメーターの行が増える）
      const sum = (r: GameState['history'][number]) =>
        r.lines.reduce((a, l) => a + (l.currency === 'USD' ? l.amount : 0), 0);
      expect(sum(on.history[1]!)).toBeGreaterThan(sum(off.history[1]!));
      // 翌月からは払わない
      expect(on.history[2]!.backgroundJobs).toBeUndefined();
      expect(on.history[2]!.infraCost).toBeCloseTo(
        off.history[2]!.infraCost,
        9,
      );
      // 1 件の上限・前提の判定は今月の見積のまま（小分けで流すとみなす）
      expect(on.history[1]!.premises).toEqual(off.history[1]!.premises);
      expect(on.history[1]!.satisfaction.stages).toEqual(
        off.history[1]!.satisfaction.stages,
      );
    }
  });

  it('処理を足すと込み分を超えて止まるプラン（Vercel Hobby）では動かせず、進まず払わない', () => {
    const HOBBY = idx('vercel-supabase-hobby');
    const on = play(HOBBY, 'client', 2);
    const off = play(HOBBY, 'client', 2, decline);
    const run = on.history[1]!.backgroundJobs![0]!;
    expect(run.blockedBy).toBeDefined();
    expect(run.ran).toBe(0);
    expect(run.finished).toBe(false);
    expect(on.history[1]!.infraCost).toBeCloseTo(off.history[1]!.infraCost, 9);
    expect(on.history[1]!.notes.join()).toMatch(
      /込み分を超えて止まるので動かせません/,
    );
  });

  it('処理の量に比例して払う', () => {
    const big = play(PRO, 'same', 2).history[1]!.backgroundJobs![0]!;
    const half = play(
      PRO,
      'same',
      2,
      accept,
      scenarioWith({
        ...KIFU_BACKGROUND_JOBS.strategy,
        vcpuHours: KIFU_BACKGROUND_JOBS.strategy.vcpuHours / 2,
      }),
    ).history[1]!.backgroundJobs![0]!;
    expect(half.usd).toBeCloseTo(big.usd / 2, 1);
  });
});

describe('終わったときの効果と状態', () => {
  it('終わった月の終わりに効果（機能 +4・成長 +2 ポイント × 3 か月）を当てる', () => {
    const on = play(PRO, 'same', 2);
    const off = play(PRO, 'same', 2, decline);
    expect(on.featurePoints).toBeCloseTo(off.featurePoints + 4);
    expect(on.growthBonus).toEqual([
      ...off.growthBonus,
      { add: 0.02, months: 3 },
    ]);
    expect(on.history[1]!.notes.join()).toMatch(
      /長時間の処理「戦法の分析の更新」が終わりました/,
    );
  });

  it('乱数の消費を変えない（受けても断っても同じシード）', () => {
    const on = play(VPS2, 'same', 6);
    const off = play(VPS2, 'same', 6, decline);
    expect(on.seed).toBe(off.seed);
    expect(on.schedule).toEqual(off.schedule);
    expect(on.history.map((r) => r.status)).toEqual(
      off.history.map((r) => r.status),
    );
  });

  it('始めていないゲームの状態は backgroundJobs を持たない（記事・受託も）', () => {
    for (const sc of [
      SCENARIOS['article-community']!,
      SCENARIOS['contract-operations']!,
      scenarioWith(),
    ]) {
      let s = playMonth(newGame(0, 1, sc));
      s = playMonth(applyActions(s, []));
      expect('backgroundJobs' in s).toBe(false);
      expect(s.history.every((r) => r.backgroundJobs === undefined)).toBe(true);
    }
  });

  it('保存して再開しても進み具合が残る（行動の列の再生で同じ状態）', () => {
    const sc = scenarioWith();
    const base = newSave({
      scenarioId: sc.id,
      stackIndex: PRO,
      seed: 1,
      startDate: DEFAULT_START_DATE,
      components: { analysis: 'worker-vps-2gb' },
    });
    const save = withTurn(withTurn(base, [accept]), []);
    const table = { [sc.id]: sc };
    const replayed = replaySave(save, table);
    const direct = play(PRO, 'worker-vps-2gb', 3, accept, sc);
    expect(replayed.backgroundJobs).toEqual(direct.backgroundJobs);
    expect(replayed.backgroundJobs![0]!.done).toBeGreaterThan(0);
    expect(replayed.history.map((r) => r.backgroundJobs)).toEqual(
      direct.history.map((r) => r.backgroundJobs),
    );
    // 途中の保存から続けても同じ
    const resumed = playMonth(replaySave(withTurn(base, [accept]), table));
    expect(resumed.backgroundJobs).toEqual(direct.backgroundJobs);
  });
});
