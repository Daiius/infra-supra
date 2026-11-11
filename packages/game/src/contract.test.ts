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
    // D-96: ドメインの登録と DNS の費用で所持金が $2〜17 減る（結果は変わらない）
    // D-111: Vercel × Next.js の既定を部品ごとにキャッシュに。Vercel で遊ぶ行（vercel-pro・Vercel へ乗り換える cf-paid-accept）だけが $1〜6 増える
    // D-120: Vercel Pro の既定の Flat Rate CDN（受託の量は 2 か月目から $20 の段）と東京の単価。従量の CDN はクレジットに収まっていたので、
    //        Vercel で遊ぶ行は $204〜214 減る（vercel-pro）・$40 減る（乗り換えるまで Vercel の vercel-to-cf。シード 42 は won → goal）・
    //        $75〜93 減る（Vercel へ乗り換える cf-paid-accept。乗り換え中も前の月の段を払う。シード 42 は $12 減）。CF・VPS・AWS の行は変わらない
    // D-131: 合否をやめ、12 か月を走り切った行の終わり方は won・goal でなく completed（所持金・月は 1 セントも変わらない）
    // D-211: 転送の大きさを圧縮後に（HTML 40 → 6・API 8 → 2.5・帳票 30 → 9 kB）。転送の費用が減り、所持金は AWS（Amplify）が $38〜44・Vercel へ乗り換える
    //        cf-paid-accept は $19〜186・Vercel Pro は $1〜2 増える。CF・VPS・OpenNext の行は変わらない
    // D-212: App Router の文書の倍率（業務の画面の HTML 6 → 15 kB）。AWS（Amplify）は $7〜8・cf-paid-accept（シード 3）は $17 減る
    const r = (seed: number) =>
      Object.fromEntries(
        sc.baselines.map((b) => {
          const s = run(b.id, seed);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect(r(42)).toEqual({
      'cf-paid': ['1892.51', 'completed', 12],
      // D-93: PITR の依頼（D1 の Time Travel で満たす）を受け、乗り換えるまで上乗せ $20 / 月が入る（前は $1,589.92・goal）
      // D-95: メールの送信（CF Paid は Email Service・乗り換えた先は SES）の費用で $1,769.92・won → goal
      'cf-paid-accept': ['1676.81', 'completed', 12],
      vps: ['1701.46', 'completed', 12],
      'vps-care': ['1807.61', 'completed', 12],
      'vps-sla': ['1807.61', 'completed', 12],
      'vercel-pro': ['1256.46', 'completed', 12],
      'vercel-to-cf': ['1670.34', 'completed', 12],
      'vercel-hobby': ['174.43', 'policy', 2],
      'cf-free': ['230.48', 'outages', 3],
      'aws-amplify': ['1831.66', 'completed', 12],
      'aws-opennext': ['1946.08', 'completed', 12],
    });
    expect(r(11)).toEqual({
      'cf-paid': ['1959.64', 'completed', 12],
      'cf-paid-accept': ['1473.72', 'completed', 12],
      vps: ['1564.19', 'outages', 12],
      'vps-care': ['1880.26', 'completed', 12],
      'vps-sla': ['1988.19', 'completed', 12],
      'vercel-pro': ['1335.51', 'completed', 12],
      'vercel-to-cf': ['1730.52', 'completed', 12],
      'vercel-hobby': ['174.43', 'policy', 2],
      'cf-free': ['230.48', 'outages', 3],
      'aws-amplify': ['1883.58', 'completed', 12],
      'aws-opennext': ['2014.62', 'completed', 12],
    });
    expect(r(3)).toEqual({
      'cf-paid': ['1932.41', 'completed', 12],
      // D-46: 乗り換え先の Vercel で添付が Vercel Blob の課金になる
      'cf-paid-accept': ['1613.27', 'completed', 12],
      vps: ['1679.32', 'outages', 12],
      'vps-care': ['1783.73', 'completed', 12],
      'vps-sla': ['1783.73', 'completed', 12],
      'vercel-pro': ['1303.06', 'completed', 12],
      'vercel-to-cf': ['1707.14', 'completed', 12],
      'vercel-hobby': ['174.43', 'policy', 2],
      'cf-free': ['230.48', 'outages', 3],
      'aws-amplify': ['1862.28', 'completed', 12],
      'aws-opennext': ['1986.49', 'completed', 12],
    });
  });

  it('何もしない構成の差は所持金に出て、どのシードでも基準プレイの少なくとも 1 本が完走する（シード 1〜50・D-131）', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const play = (id: string) => run(id, seed);
      // 込み分の内で固定費の差だけが効く: Cloudflare Paid は完走し、Vercel Pro は完走しても所持金が少ない
      const cf = play('cf-paid');
      expect(cf.phase, `seed ${seed}`).toBe('completed');
      expect(play('vercel-pro').cash, `seed ${seed}`).toBeLessThan(cf.cash);
      // 構成に合った対策（D-64）: AWS は既定の部品のまま完走する
      expect(play('aws-amplify').phase, `seed ${seed}`).toBe('completed');
      expect(play('aws-opennext').phase, `seed ${seed}`).toBe('completed');
      // 受託の案件で非商用のプランは規約違反で終わる
      expect(play('vercel-hobby').end?.reason).toBe('policy');
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
    expect(componentSlots(s).map((x) => x.slot)).toEqual(['db', 'email']);
  });

  it('帳票の依頼の効果の要約', () => {
    const def = sc.events.find((e) => e.id === 'c-p-report')!;
    expect(def.accept!.effects.map(describeEffect)[0]).toBe(
      'API 1 回の CPU 15 ms・API 1 回の応答 9 kB',
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
