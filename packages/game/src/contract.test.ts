// 受託先の業務アプリの運用のシナリオ（prd/09・D-33）。基準プレイの golden と、データで足した仕組みの性質。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  componentSlots,
  DEFAULT_START_DATE,
  describeEffect,
  newGame,
  playMonth,
  playStrategy,
  type GameState,
} from './index.ts';
import { parseSave, newSave, replaySave } from './save.ts';
import { CONTRACT_OPERATIONS as sc } from './scenarios/contract-operations.ts';

const CF_PAID = 1;
const VPS = 4;

const play = (stackIndex: number, seed = 42) => {
  let s = playMonth(newGame(stackIndex, seed, sc, DEFAULT_START_DATE));
  while (s.phase === 'playing') s = playMonth(applyActions(s, []));
  return s;
};
const baseline = (id: string) => sc.baselines.find((b) => b.id === id)!;
const run = (id: string, seed: number): GameState =>
  playStrategy(baseline(id), seed, sc, DEFAULT_START_DATE);

describe('受託先の業務アプリの運用', () => {
  it('基準プレイ（golden。シード 42・SLA の打診が来るシード 11・全社展開の打診が来るシード 3）', () => {
    // D-48: Vercel Pro のクレジットがすべての従量に当たる形に（込み分なし）。使用量は月 $10〜25 で、9 か月目ごろからクレジットを超える分だけ所持金が減る
    const r = (seed: number) =>
      Object.fromEntries(
        sc.baselines.map((b) => {
          const s = run(b.id, seed);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect(r(42)).toEqual({
      'cf-paid': ['1988.27', 'won', 12],
      'cf-paid-accept': ['1589.92', 'goal', 12],
      vps: ['1737.44', 'goal', 12],
      'vps-care': ['1844.57', 'won', 12],
      'vps-sla': ['1844.57', 'won', 12],
      'vercel-pro': ['1507.07', 'goal', 12],
      'vercel-to-cf': ['1800.47', 'won', 12],
      'vercel-hobby': ['179.19', 'policy', 2],
      'cf-free': ['237.47', 'outages', 3],
      'aws-amplify': ['1842.60', 'won', 12],
      'aws-opennext': ['1988.68', 'won', 12],
    });
    expect(r(11)).toEqual({
      'cf-paid': ['2069.97', 'won', 12],
      'cf-paid-accept': ['1581.77', 'goal', 12],
      vps: ['1603.33', 'outages', 12],
      'vps-care': ['1921.04', 'won', 12],
      'vps-sla': ['2028.98', 'won', 12],
      'vercel-pro': ['1578.94', 'goal', 12],
      'vercel-to-cf': ['1874.23', 'won', 12],
      'vercel-hobby': ['179.19', 'policy', 2],
      'cf-free': ['237.47', 'outages', 3],
      'aws-amplify': ['1893.60', 'won', 12],
      'aws-opennext': ['2060.99', 'won', 12],
    });
    expect(r(3)).toEqual({
      'cf-paid': ['2036.76', 'won', 12],
      // D-46: 乗り換え先の Vercel で添付が Vercel Blob の課金になる
      'cf-paid-accept': ['1726.18', 'won', 12],
      vps: ['1715.59', 'outages', 12],
      'vps-care': ['1821.02', 'won', 12],
      'vps-sla': ['1821.02', 'won', 12],
      'vercel-pro': ['1545.47', 'goal', 12],
      'vercel-to-cf': ['1845.17', 'won', 12],
      'vercel-hobby': ['179.19', 'policy', 2],
      'cf-free': ['237.47', 'outages', 3],
      'aws-amplify': ['1872.68', 'won', 12],
      'aws-opennext': ['2031.30', 'won', 12],
    });
  });

  it('何もしない構成の差が合否を分け、どのシードでも基準プレイの少なくとも 1 本が合格する（シード 1〜50）', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const won = (id: string) => run(id, seed).phase === 'won';
      // 込み分の内で固定費の差だけが効く: Cloudflare Paid は届き、Vercel Pro は届かない
      expect(won('cf-paid'), `seed ${seed}`).toBe(true);
      expect(won('vercel-pro'), `seed ${seed}`).toBe(false);
      // 構成に合った対策（D-64）: AWS は既定の部品のまま届く
      expect(won('aws-amplify'), `seed ${seed}`).toBe(true);
      expect(won('aws-opennext'), `seed ${seed}`).toBe(true);
      // 受託の案件で非商用のプランは規約違反で終わる
      expect(run('vercel-hobby', seed).end?.reason).toBe('policy');
    }
  });

  it('収益は固定の月額 + 従量（1 か月目は 30 万 PV）', () => {
    const s = playMonth(newGame(CF_PAID, 42, sc, DEFAULT_START_DATE));
    const r = s.history[0]!;
    expect(r.revenue).toBeCloseTo(
      sc.revenue.fixedUsdPerMonth! + (r.humanPV / 1000) * 0.1,
      9,
    );
  });

  it('繁忙期の月はピークの係数が上がり、ピークで決まる前提の使用率が流量以上に上がる', () => {
    const s = play(VPS, 42);
    const busy = s.schedule.find((x) => x.id === 'c-busy')!.month;
    const ratio = (m: number) =>
      s.history[m - 1]!.snapshots.find((x) => x.id.startsWith('host:cpu:'))!
        .ratio;
    // 流量 × 1.5・ピーク × 2 なので、前の月の 3 倍近く（成長の分だけずれる）
    expect(ratio(busy) / ratio(busy - 1)).toBeGreaterThan(2.5);
    expect(ratio(busy + 1) / ratio(busy - 1)).toBeLessThan(1.5);
  });

  it('添付ファイルは変換しない（画像の変換の明細が出ない）', () => {
    const s = play(CF_PAID, 42);
    for (const r of s.history)
      expect(r.lines.some((l) => /transformation/.test(l.label))).toBe(false);
  });

  it('このシナリオで効かない部品のスロットは出さない', () => {
    const s = playMonth(newGame(CF_PAID, 42, sc, DEFAULT_START_DATE));
    expect(componentSlots(s).map((x) => x.slot)).toEqual(['db']);
  });

  it('帳票の依頼の効果の要約', () => {
    const def = sc.events.find((e) => e.id === 'c-p-report')!;
    expect(def.accept!.effects.map(describeEffect)[0]).toBe(
      'API 1 回の CPU 15 ms・API 1 回の応答 30 KB',
    );
  });

  it('保存と再生（シナリオの id を持つ）', () => {
    const save = newSave({
      scenarioId: sc.id,
      stackIndex: VPS,
      seed: 7,
      startDate: DEFAULT_START_DATE,
    });
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
    expect(replaySave(save).scenarioId).toBe(sc.id);
  });

  it('重みの合計は 1', () => {
    const w = Object.values(sc.satisfaction.weights).reduce((a, b) => a + b);
    expect(w).toBeCloseTo(1, 12);
  });
});
