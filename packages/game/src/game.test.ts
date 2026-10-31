// ゲームの再現性（企画書 §10「同じシナリオ・同じシード・同じ行動なら同じ結果」）と、GD-2 の基準プレイの golden（prd/07 §9.7）。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  applyAction,
  applyActions,
  averageSatisfaction,
  BASELINES,
  EFFORT,
  effortAvailable,
  GAME,
  newGame,
  playMonth,
  playStrategy,
  policyStep,
  type Action,
  type GameState,
} from './index.ts';

function play(stackIndex: number, actions: Action[][], seed = 42): GameState {
  return playStrategy({ id: 't', label: 't', stackIndex, actions }, seed);
}
/** n か月進めた状態（各月の終わりに actions[i] を選ぶ）。 */
function playUntil(
  stackIndex: number,
  months: number,
  actions: Action[][] = [],
  seed = 42,
): GameState {
  let s = playMonth(newGame(stackIndex, seed));
  for (let i = 0; i < months - 1 && s.phase === 'playing'; i++)
    s = playMonth(applyActions(s, actions[i] ?? []));
  return s;
}

const CF_FREE = 0;
const CF_PAID = 1;
const HOBBY = 2;
const VERCEL_PRO = 3;
const VPS = 4;

describe('game', () => {
  it('同じシード・同じ行動なら同じ結果', () => {
    const a = play(VPS, [[{ type: 'optimize' }]], 3);
    const b = play(VPS, [[{ type: 'optimize' }]], 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('12 か月で終わる', () => {
    expect(play(CF_PAID, []).history).toHaveLength(12);
  });

  it('GD-2 の基準プレイ（golden。シード 42）', () => {
    // 旧（スパイクと同じルール）→ 新: CF Paid $8,870.72 → $8,867.76 / Vercel Pro $6,043.49 → $6,037.35 /
    // Vercel Pro・1 か月目に強く圧縮 $7,026.81 → $4,595.30 / VPS $8,259.75 → $4,992.60（prd/07 §9.6・PR 本文）
    const r = Object.fromEntries(
      BASELINES.map((b) => {
        const s = playStrategy(b);
        return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
      }),
    );
    expect(r).toEqual({
      'cf-paid': ['8867.76', 'won', 12],
      vps: ['4992.60', 'goal', 12],
      'vercel-pro': ['6037.35', 'goal', 12],
      'vercel-compress-late': ['6302.59', 'won', 12],
      'cf-free': ['94.24', 'outages', 3],
    });
    expect(
      play(VERCEL_PRO, [
        [{ type: 'set', key: 'compress', value: 70 }],
      ]).cash.toFixed(2),
    ).toBe('4595.30');
  });

  it('既定の構成・何もしないなら満足度は 0.9（評判も 0.9・成長 40%）', () => {
    const s = playUntil(CF_PAID, 3);
    const m = s.history[2]!.satisfaction;
    expect(m.score).toBeCloseTo(0.9);
    expect(m.reputation).toBeCloseTo(0.9);
    expect(m.growth).toBeCloseTo(0.4);
  });
});

describe('止まった月と規約違反（D-19）', () => {
  it('止まった月の上限（2 回）を超えた月でゲームオーバー', () => {
    const s = play(CF_FREE, []);
    expect(s.phase).toBe('lost');
    expect(s.end).toEqual({ reason: 'outages', month: 3 });
    expect(s.outages).toBe(GAME.goal.maxOutageMonths + 1);
  });

  it('止まった月は可用性が「悪い」で、純成長率が負', () => {
    const r = playUntil(CF_FREE, 1).history[0]!;
    expect(r.status).toBe('down');
    expect(r.satisfaction.stages.availability).toBe('bad');
    expect(r.satisfaction.growth).toBeLessThan(0);
  });

  it('規約違反は最初の月に指摘、翌月も違反したままならアカウント停止', () => {
    const first = playUntil(HOBBY, 1);
    expect(first.phase).toBe('playing');
    expect(first.history[0]!.policyWarning).toBe(true);
    const s = play(HOBBY, []);
    expect(s.end).toEqual({ reason: 'policy', month: 2 });
  });

  it('指摘の月にプラン変更すれば続けられる', () => {
    const s = play(HOBBY, [[{ type: 'plan', stackIndex: VERCEL_PRO }]]);
    expect(s.end?.reason).not.toBe('policy');
    expect(s.history).toHaveLength(12);
  });

  it('指摘の月に乗り換えを始めれば、乗り換えの期間中は停止されない', () => {
    // Hobby は画像の上限にも当たって止まるので、停止の上限で終わる（規約違反では終わらない）
    const s = play(HOBBY, [[{ type: 'migrate', stackIndex: CF_PAID }]]);
    expect(s.end?.reason).toBe('outages');
    expect(s.history[1]!.notes.join()).toContain('猶予中');
  });

  it('規約違反の判定（純粋関数）', () => {
    const base = { warnedMonth: null, violating: true, migrating: false };
    expect(policyStep({ ...base, month: 1 })).toEqual({
      warnedMonth: 1,
      outcome: 'warned',
    });
    expect(policyStep({ ...base, warnedMonth: 1, month: 2 }).outcome).toBe(
      'suspended',
    );
    expect(
      policyStep({ ...base, warnedMonth: 1, migrating: true, month: 2 })
        .outcome,
    ).toBe('grace');
    expect(
      policyStep({ ...base, warnedMonth: 1, violating: false, month: 2 }),
    ).toEqual({ warnedMonth: null, outcome: 'ok' });
  });
});

describe('開発の手間と行動', () => {
  it('VPS は毎月の機能開発が維持の分だけ少ない', () => {
    const cf = playUntil(CF_PAID, 2).history[1]!.effort;
    const vps = playUntil(VPS, 2).history[1]!.effort;
    expect(cf.feature - vps.feature).toBe(EFFORT.selfHostedUpkeep);
    expect(vps.upkeep).toBe(EFFORT.selfHostedUpkeep);
  });

  it('プラン変更は手間 0・翌月から。乗り換えは別の行動', () => {
    const s = playUntil(CF_FREE, 1);
    expect(actionEffort(s, { type: 'plan', stackIndex: CF_PAID })).toBe(0);
    expect(actionEffort(s, { type: 'migrate', stackIndex: CF_PAID })).toBe(
      null,
    );
    expect(actionEffort(s, { type: 'plan', stackIndex: VPS })).toBe(null);
    const next = playMonth(
      applyAction(s, { type: 'plan', stackIndex: CF_PAID }),
    );
    expect(next.history[1]!.stackName).toContain('Paid');
  });

  it('乗り換えは数か月かかり、期間中は新旧両方の費用を払う', () => {
    const acts: Action[][] = [[{ type: 'migrate', stackIndex: CF_PAID }]];
    const s = playUntil(VERCEL_PRO, 4, acts);
    const [m1, m2, m3, m4] = s.history;
    expect(m1!.parallelInfraCost).toBe(0);
    expect(m2!.migration).toBeDefined();
    expect(m2!.parallelInfraCost).toBeGreaterThan(0);
    expect(m2!.effort.migration).toBe(EFFORT.migrationPerMonth);
    expect(m3!.stackName).toContain('Vercel');
    // サーバーレス同士は 2 か月。4 か月目が切り替えの月（可用性は普通）
    expect(m4!.stackName).toContain('Cloudflare');
    expect(m4!.satisfaction.stages.availability).toBe('fair');
  });

  it('VPS への乗り換えは 3 か月', () => {
    const s = playUntil(CF_PAID, 5, [[{ type: 'migrate', stackIndex: VPS }]]);
    expect(s.history[3]!.stackName).toContain('Cloudflare');
    expect(s.history[4]!.stackName).toContain('VPS');
  });

  it('手間が足りない行動は選べない（状態を変えない）', () => {
    const s = playUntil(VPS, 1); // 維持 3 → 行動に 7
    expect(effortAvailable(s)).toBe(7);
    const once = applyAction(s, { type: 'optimize' });
    expect(effortAvailable(once)).toBe(3);
    expect(applyAction(once, { type: 'optimize' })).toBe(once);
  });

  it('設定は戻せる: 強く圧縮 → なしに戻すと画質が「良い」に戻る', () => {
    const s = playUntil(CF_PAID, 3, [
      [{ type: 'set', key: 'compress', value: 70 }],
      [{ type: 'set', key: 'compress', value: 150 }],
    ]);
    expect(s.history[1]!.satisfaction.stages.quality).toBe('bad');
    expect(s.history[2]!.satisfaction.stages.quality).toBe('good');
  });

  it('同じ設定への変更・同じ構成への乗り換えは何もしない', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(applyAction(s, { type: 'set', key: 'compress', value: 150 })).toBe(
      s,
    );
    expect(applyAction(s, { type: 'migrate', stackIndex: CF_PAID })).toBe(s);
  });

  it('機能開発が進むと SSR が重くなる', () => {
    const s = play(CF_PAID, []);
    expect(s.history[0]!.ssrCpuMs).toBe(GAME.baseSsrCpuMs);
    expect(s.history[11]!.ssrCpuMs).toBeGreaterThan(GAME.baseSsrCpuMs);
  });

  it('満足度は 0〜1 で、合否は平均と停止の回数も見る', () => {
    const s = play(VPS, [], 7);
    for (const r of s.history) {
      expect(r.satisfaction.score).toBeGreaterThanOrEqual(0);
      expect(r.satisfaction.score).toBeLessThanOrEqual(1);
    }
    expect(averageSatisfaction(s.history)).toBeLessThan(0.9);
  });
});
