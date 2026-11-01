// ゲームの再現性（企画書 §10「同じシナリオ・同じシード・同じ行動なら同じ結果」）と、GD-2 の基準プレイの golden（prd/07 §9.7）。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  applyAction,
  applyActions,
  averageSatisfaction,
  BASELINES,
  comparisonRows,
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

  it('GD-4 の基準プレイ（golden。シード 42・SLA の打診が来るシード 3・記事の引き取りが来るシード 31）', () => {
    // GD-2 → GD-3 の差は規模の見直し（30 万 PV・月 12%・話題 × 3）と出来事（prd/07 §10.6・§10.8・PR 本文）。
    // GD-3 → GD-4 の差はチャットの提案（全部受ける ② が受ける）と、まれな出来事の候補に SLA の打診を足したこと（prd/07 §11.7）
    // D-32: 即時反映の提案（全部受ける ② が受け、KV の ISR では満たせず鮮度が下がる）
    // D-28: 話題と Bot は 50% で予告なし（話題の前兆 PV × 1.2 が無いシード・Bot の前兆が増えたシードで値が変わる。月は変わらない）
    // D-47 追記: 速さが「悪い」月は PV の伸びが 3% 下がる（VPS は話題の月の回線の詰まり・KV を DB に はキーの書き込みで遅い月）
    // D-47: 記事のデザインの刷新の提案（シード 42 は 7 か月目・3 は 10 か月目・31 は無し）を断り、2 か月画質が下がる（所持金だけ下がる）
    // D-44: 話題（2 日）・Bot（7 日）の上乗せが短い期間に集中し、VPS の回線・KV の同じキーへの書き込みが話題の月に詰まる（課金は同じ）
    // D-37: Vercel の CDN の ISR のページのヒット率を固定の 0.8 から再生成の数と同じ式に（ISR の読み取りと FOT が増え、Vercel の構成の所持金が減る。結果は変わらない）
    // D-46: Vercel の画像の原本を Vercel Blob に（保存量・アップロード・転送の課金。Vercel の構成と乗り換え先が Vercel の基準プレイの所持金が数ドル減る。結果は変わらない）
    // D-48: Vercel Pro の込み分（CDN Requests 1,000 万・Fast Data Transfer 1 TB）をやめ、$20 のクレジットがすべての従量に当たる形に。
    //       Vercel Pro・何もしないは Fast Data Transfer の課金で所持金が約 $900 減る。Vercel で始めて乗り換える基準プレイは、乗り換えまでの 3 か月分が減り、シード 3・31 で合格 → 不合格
    const r = (seed: number) =>
      Object.fromEntries(
        BASELINES.map((b) => {
          const s = playStrategy(b, seed);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect(r(42)).toEqual({
      'cf-paid': ['2124.10', 'won', 12],
      'cf-paid-accept': ['2223.52', 'won', 12],
      'vps-images': ['1782.41', 'won', 12],
      'vercel-pro': ['771.88', 'goal', 12],
      'vercel-to-cf': ['1610.20', 'goal', 12],
      'cf-free': ['142.89', 'outages', 3],
      'cf-paid-kvdb': ['1882.01', 'won', 12],
      'cf-paid-chat': ['2154.01', 'won', 12],
      'vps-sla': ['1731.82', 'won', 12],
    });
    expect(r(3)).toEqual({
      'cf-paid': ['2151.55', 'won', 12],
      'cf-paid-accept': ['2197.12', 'won', 12],
      'vps-images': ['1689.33', 'goal', 12],
      'vercel-pro': ['613.60', 'goal', 12],
      'vercel-to-cf': ['1711.88', 'goal', 12],
      'cf-free': ['142.89', 'outages', 3],
      'cf-paid-kvdb': ['1907.89', 'won', 12],
      'cf-paid-chat': ['2181.80', 'won', 12],
      'vps-sla': ['1801.47', 'won', 12],
    });
    expect(r(31)).toEqual({
      'cf-paid': ['2163.40', 'won', 12],
      'cf-paid-accept': ['609.30', 'goal', 12],
      'vps-images': ['1693.43', 'goal', 12],
      'vercel-pro': ['640.26', 'goal', 12],
      'vercel-to-cf': ['1682.18', 'goal', 12],
      'cf-free': ['142.89', 'outages', 3],
      'cf-paid-kvdb': ['1878.88', 'won', 12],
      'cf-paid-chat': ['2188.13', 'won', 12],
      'vps-sla': ['1665.79', 'goal', 12],
    });
  });

  it('既定の構成・何もしないなら満足度は 0.9（評判も 0.9・成長 12%）', () => {
    const s = playUntil(CF_PAID, 3);
    const m = s.history[2]!.satisfaction;
    expect(m.score).toBeCloseTo(0.9);
    expect(m.reputation).toBeCloseTo(0.9);
    expect(m.growth).toBeCloseTo(0.12);
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

describe('結果の比較の表', () => {
  it('行の名前は「あなた」と基準プレイの短い名前', () => {
    const rows = comparisonRows(play(CF_PAID, []));
    expect(rows.map((r) => r.name)).toEqual([
      'あなた',
      'CF Paid・何もしない',
      'CF Paid・提案を受ける',
      'VPS・画像の提案を受ける',
      'Vercel Pro・何もしない',
      'Vercel Pro → CF Paid',
      'CF Free・何もしない',
      'CF Paid・KV を DB 代わり',
      'CF Paid・チャットを受ける',
      'VPS・SLA に応える',
    ]);
    expect(rows[5]!.description).toBe(BASELINES[4]!.label);
  });
});
