// 満足度の要素「解析の速さ」「解析の正確さ」（prd/17 §5.5・D-238）: 置き場・区切り方・候補の数・ピークの滞留で速さと正確さが
// どう動くか。解析のあるシナリオ（棋譜解析）だけで判定し、記事・受託では段階を持たない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import {
  KIFU_ANALYSIS_JOB,
  KIFU_GAMES_PER_MAU,
  KIFU_PV_PER_MAU,
  type AnalysisSettings,
} from 'catalog';
import {
  analysisOnlyThrottle,
  analysisSatisfactionScore,
  judgeAnalysis,
  speedValueOfSec,
  serverRunSec,
  stallOf,
} from './analysis-satisfaction.ts';
import {
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  STACKS,
  type GameState,
  type Scenario,
} from './index.ts';
import { ELEMENTS, satisfactionScore } from './rules.ts';
import {
  KIFU_ANALYSIS_SATISFACTION as RULES,
  KIFU_SATISFACTION_WEIGHTS,
} from './scenarios/kifu-analysis.ts';

const shape = KIFU_ANALYSIS_JOB;
const settings = (
  unit: 'position' | 'game' | 'resumable',
  candidates = 3,
): AnalysisSettings => ({
  unit,
  candidates,
});
const judge = (
  placement: string,
  s = settings('position'),
  host?: { vcpu: number; peakRatio: number; peakHourFactor?: number },
) =>
  judgeAnalysis({
    rules: RULES,
    shape,
    settings: s,
    placement,
    host: host && {
      nodeId: 'vps',
      peakHourFactor: 3,
      ...host,
    },
  });

describe('解析の速さ（1 局が見えるまで）', () => {
  it('サーバーレスは局面ごとを並べて動かすので 1 件の時間で見え、1 局まとめて・小分けは 1 局ぶんかかる', () => {
    // 1 件 = 起動の CPU 1 秒 + 局面 × 4 秒 + 読み込みの待ち 1 秒 + DB の待ち 20 ms（D-236）
    expect(serverRunSec(shape, 'position', Infinity)).toBeCloseTo(6.02);
    expect(serverRunSec(shape, 'game', Infinity)).toBeCloseTo(402.02);
    // 小分けは 10 塊を続きから順に解く
    expect(serverRunSec(shape, 'resumable', Infinity)).toBeCloseTo(420.2);
    expect(judge('same').analysisSpeed).toBe('good');
    expect(judge('same', settings('game')).analysisSpeed).toBe('fair');
    expect(judge('same', settings('resumable')).analysisSpeed).toBe('fair');
  });

  it('VPS は局面ごとを vCPU の数まで並べる（多いほど速い）', () => {
    expect(serverRunSec(shape, 'position', 3)).toBeCloseTo((100 / 3) * 6.02);
    expect(serverRunSec(shape, 'position', 4)).toBeCloseTo(25 * 6.02);
    expect(
      judge('worker-vps-2gb', settings('position'), { vcpu: 3, peakRatio: 0.5 })
        .analysisSpeed,
    ).toBe('good');
  });

  it('ピークの比が 1 を超えると超えた分 × 30 分の待ちが延び、月の平均でも追いつかなければ悪い', () => {
    expect(stallOf({ peakRatio: 0.9, peakHourFactor: 3 }, RULES)).toEqual({
      waitSec: 0,
      backlog: false,
    });
    expect(
      stallOf({ peakRatio: 1.5, peakHourFactor: 3 }, RULES).waitSec,
    ).toBeCloseTo(900);
    const near = judge('worker-vps-2gb', settings('position'), {
      vcpu: 3,
      peakRatio: 1.1,
    });
    expect(near.waitSec).toBeCloseTo(180);
    expect(near.analysisSpeed).toBe('fair');
    const over = judge('worker-vps-2gb', settings('position'), {
      vcpu: 3,
      peakRatio: 3,
    });
    expect(over.backlog).toBe(true);
    expect(over.analysisSpeed).toBe('bad');
    expect(over.visibleSec).toBe(Infinity);
  });

  it('端末はふつうの端末で開いている間に終わるが、遅い端末の差で 1 段下がる', () => {
    const j = judge('client', settings('position', 1));
    expect(j.clientSec).toBeCloseTo(200);
    expect(j.clientSlowSec).toBeCloseTo(600);
    expect(j.analysisSpeed).toBe('fair');
    // 端末は区切り方によらない（ブラウザが 1 局を順に解く）
    expect(judge('client', settings('game', 1)).clientSec).toBeCloseTo(200);
  });

  it('併用は端末の簡易解析とサーバーの詳細解析の早いほう（VPS が滞っても簡易解析で普通に保つ）', () => {
    expect(judge('hybrid').analysisSpeed).toBe('good');
    const stalled = judge('hybrid', settings('position'), {
      vcpu: 3,
      peakRatio: 3,
    });
    expect(stalled.analysisSpeed).toBe('fair');
    expect(stalled.visibleSec).toBeCloseTo(200);
  });

  it('候補の数は速さに効かない（B-7）', () => {
    expect(judge('same', settings('game', 1)).serverSec).toBe(
      judge('same', settings('game', 3)).serverSec,
    );
  });
});

describe('解析の正確さ', () => {
  it('候補 3 つで良い・1 つで普通（サーバーの評価関数）', () => {
    expect(judge('same').analysisAccuracy).toBe('good');
    expect(judge('same', settings('position', 1)).analysisAccuracy).toBe(
      'fair',
    );
    expect(
      judge('worker-vps-4gb', settings('position', 3), {
        vcpu: 4,
        peakRatio: 3,
      }).analysisAccuracy,
    ).toBe('good');
  });

  it('端末は候補が 1 つなので普通（評価関数と読みの量では下げない。D-244）', () => {
    expect(judge('client', settings('position', 1)).analysisAccuracy).toBe(
      'fair',
    );
  });

  it('併用の正確さは詳細解析の届き方で決まる: 待てる時間のうちなら詳細の正確さ・遅れるほど簡易解析の正確さへ・たまり続けるなら簡易解析の正確さ（D-250）', () => {
    // 待てる時間（1 時間）のうちに届く
    const onTime = judge('hybrid');
    expect(onTime.detailDelivery).toBe(1);
    expect(onTime.analysisAccuracyValue).toBe(1);
    expect(onTime.analysisAccuracy).toBe('good');
    // ピークの比 9（月の平均の比 0.9 で追いつく）: 待ち約 4 時間 → 届き方 約 1/4 → 簡易解析（0.5）寄り
    const late = judge('hybrid', settings('position'), {
      vcpu: 3,
      peakRatio: 9,
      peakHourFactor: 10,
    });
    expect(late.backlog).toBeUndefined();
    expect(late.detailDelivery!).toBeCloseTo(
      RULES.hybrid.detailToleranceSec / late.serverSec!,
      9,
    );
    expect(late.analysisAccuracyValue).toBeGreaterThan(0.5);
    expect(late.analysisAccuracyValue).toBeLessThan(0.75);
    expect(late.analysisAccuracy).toBe('fair');
    // たまり続ける（月の平均の比も 1 以上）: 簡易解析の正確さ
    const backlog = judge('hybrid', settings('position'), {
      vcpu: 3,
      peakRatio: 3,
    });
    expect(backlog.backlog).toBe(true);
    expect(backlog.detailDelivery).toBe(0);
    expect(backlog.analysisAccuracyValue).toBe(0.5);
  });

  it('詳細解析が希望した棋譜だけなら、待てる時間を長くとる（その日のうち。D-246・D-250）', () => {
    const host = { vcpu: 3, peakRatio: 9, peakHourFactor: 10 };
    const asked = judge(
      'hybrid',
      { ...settings('position'), scope: 'requested' },
      host,
    );
    const all = judge('hybrid', settings('position'), host);
    expect(asked.analysisAccuracyValue).toBeGreaterThan(
      all.analysisAccuracyValue,
    );
    expect(asked.analysisAccuracy).toBe('good');
    // 速さは範囲によらない（端末の簡易解析と詳細解析の早いほう）
    expect(asked.analysisSpeedValue).toBe(all.analysisSpeedValue);
    expect(asked.visibleSec).toBe(all.visibleSec);
  });

  it('併用の速さは簡易解析が担保し、詳細解析の遅れでは下げない（D-250）', () => {
    const slow = judge('hybrid', settings('position'), {
      vcpu: 3,
      peakRatio: 9,
      peakHourFactor: 10,
    });
    const client = judge('client', settings('position', 1));
    expect(slow.analysisSpeedValue).toBe(client.analysisSpeedValue);
  });
});

describe('解析の速さの値（連続。D-250）と満足度の柱', () => {
  it('見えるまでの時間から: 5 分で 1・15 分で 0.5・それより長いと 0 に近づく', () => {
    expect(speedValueOfSec(RULES.speed.goodSec, RULES)).toBe(1);
    expect(speedValueOfSec(RULES.speed.fairSec, RULES)).toBe(0.5);
    expect(speedValueOfSec(4.5 * 3600, RULES)).toBeLessThan(0.05);
    expect(speedValueOfSec(Infinity, RULES)).toBe(0);
  });

  it('ピークの比 1.5 と 10 で解析の速さの値と満足度に差が出る（段階はどちらも悪いでも）', () => {
    const mild = judge('worker-vps-4gb', settings('position'), {
      vcpu: 4,
      peakRatio: 1.5,
      peakHourFactor: 12,
    });
    const heavy = judge('worker-vps-4gb', settings('position'), {
      vcpu: 4,
      peakRatio: 10,
      peakHourFactor: 12,
    });
    expect(mild.analysisSpeedValue).toBeGreaterThan(heavy.analysisSpeedValue);
    expect(heavy.analysisSpeedValue).toBeLessThan(0.05);
    const stages = (j: ReturnType<typeof judge>) => ({
      availability: 'good' as const,
      speed: 'good' as const,
      feature: 'good' as const,
      freshness: 'good' as const,
      quality: 'good' as const,
      analysisSpeed: j.analysisSpeed,
      analysisAccuracy: j.analysisAccuracy,
    });
    const sMild = analysisSatisfactionScore(
      stages(mild),
      KIFU_SATISFACTION_WEIGHTS,
      mild,
      RULES,
    );
    const sHeavy = analysisSatisfactionScore(
      stages(heavy),
      KIFU_SATISFACTION_WEIGHTS,
      heavy,
      RULES,
    );
    expect(sMild.score).toBeGreaterThan(sHeavy.score);
  });

  it('満足度は Web の柱と解析の柱の幾何平均（補い合わない）', () => {
    const stages = {
      availability: 'good' as const,
      speed: 'bad' as const,
      feature: 'good' as const,
      freshness: 'good' as const,
      quality: 'good' as const,
      analysisSpeed: 'good' as const,
      analysisAccuracy: 'good' as const,
    };
    const w = KIFU_SATISFACTION_WEIGHTS;
    const r = analysisSatisfactionScore(
      stages,
      w,
      { analysisSpeedValue: 0.2, analysisAccuracyValue: 1 },
      RULES,
    );
    // Web の柱は重みの比（反映スピード・画質は重み 0 なので入らない）
    const web =
      (w.availability + w.feature) / (w.availability + w.speed + w.feature);
    expect(r.web).toBeCloseTo(web, 12);
    expect(r.analysis).toBeCloseTo(
      RULES.pillar.speed * 0.2 + RULES.pillar.accuracy * 1,
      12,
    );
    expect(r.score).toBeCloseTo(Math.sqrt(r.web * r.analysis), 12);
  });
});

// ---- ゲームの月（playMonth）----

const kifu = {
  ...SCENARIOS['kifu-analysis']!,
  startCash: 1e9,
};
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const PRO = idx('vercel-supabase-pro');
const VPS = idx('sakura-vps-2gb');
/**
 * 月の局数から PV を出す（1 人 月 KIFU_GAMES_PER_MAU 局・KIFU_PV_PER_MAU PV）。worker の VPS の段階が普段の月とイベントの月で
 * 分かれるのを見るため、シナリオの規模（12 万 PV・月 9 万局。worker の VPS は普段から CPU が足りない）ではなく、
 * D-242 のときの普段の月の局数（利用者 1,000 人 × 月 4 局 = 4,000 局。worker の VPS 4GB のピークの比 0.82）で動かす。
 */
const pvOfGames = (games: number) =>
  (games / KIFU_GAMES_PER_MAU) * KIFU_PV_PER_MAU;
const SMALL = pvOfGames(4_000);
/** 普段の月の規模と、大きな対局イベントの月（PV × 1.5・ピーク × 3。仮定）。 */
const at = (pv: number, peak = false): Scenario => ({
  ...kifu,
  scale: { ...kifu.scale, startPV: pv },
  events: peak
    ? [
        {
          id: 'k-big-test',
          kind: 'script',
          tier: 'common',
          title: '大きな対局イベント（テスト）',
          text: 'テスト',
          when: { type: 'window', from: 1, to: 1 },
          premiseRefs: [],
          effects: [
            {
              type: 'traffic',
              factor: 1.5,
              peakFactor: 3,
              earnsRevenue: true,
              months: 1,
            },
          ],
        },
      ]
    : [],
});
const play = (
  sc: Scenario,
  stack: number,
  analysis: string,
  s: Partial<GameState['settings']> = {},
) => {
  const g = newGame(stack, 1, sc, DEFAULT_START_DATE, 'nextjs', { analysis });
  return playMonth({ ...g, settings: { ...g.settings, ...s } }).history[0]!;
};

describe('ゲームの月の満足度', () => {
  it('棋譜解析の重みは合計 1 で、解析の速さは正確さより重い（KF-10）', () => {
    const sum = ELEMENTS.reduce(
      (a, e) => a + (KIFU_SATISFACTION_WEIGHTS[e] ?? 0),
      0,
    );
    expect(sum).toBeCloseTo(1);
    expect(KIFU_SATISFACTION_WEIGHTS.analysisSpeed!).toBeGreaterThan(
      KIFU_SATISFACTION_WEIGHTS.analysisAccuracy!,
    );
  });

  it('棋譜解析の月は解析の 2 つの段階を持ち、満足度の点に入る', () => {
    const r = play(kifu, PRO, 'same');
    expect(r.satisfaction.stages.analysisSpeed).toBe('good');
    expect(r.satisfaction.stages.analysisAccuracy).toBe('good');
    // 満足度は Web の柱と解析の柱の幾何平均（D-250）
    const p = r.satisfaction.pillars!;
    expect(r.satisfaction.score).toBeCloseTo(Math.sqrt(p.web * p.analysis), 12);
    const one = play(kifu, PRO, 'same', { candidates: 1 });
    expect(one.satisfaction.stages.analysisAccuracy).toBe('fair');
    // 候補 1 つは正確さの値が 0.5 になり、解析の柱が正確さの重み × 0.5 だけ下がる
    expect(one.satisfaction.pillars!.analysis).toBeCloseTo(
      p.analysis - RULES.pillar.accuracy * 0.5,
      12,
    );
    expect(one.satisfaction.score).toBeLessThan(r.satisfaction.score);
  });

  it('記事・受託の月は解析の段階を持たない', () => {
    for (const sc of [
      SCENARIOS['article-community']!,
      SCENARIOS['contract-operations']!,
    ]) {
      const r = playMonth(newGame(0, 1, sc)).history[0]!;
      expect(Object.keys(r.satisfaction.stages).sort()).toEqual(
        ['availability', 'feature', 'freshness', 'quality', 'speed'].sort(),
      );
    }
  });

  it('worker の VPS は普段の月に開いている間に終わり（4GB）、大きな対局イベントの月に滞る', () => {
    const normal = play(at(SMALL), PRO, 'worker-vps-4gb');
    expect(normal.satisfaction.stages.analysisSpeed).toBe('good');
    const peak = play(at(SMALL, true), PRO, 'worker-vps-4gb');
    expect(peak.satisfaction.stages.analysisSpeed).toBe('bad');
    expect(peak.satisfaction.reasons.analysisSpeed).toMatch(
      /ピークの時間帯の滞留の待ち/,
    );
    // worker が混んでもページは遅くならない（ページの速さ・収益の減りには数えない）
    expect(
      peak.premises.some((p) => p.hit && p.id === 'host:cpu:analysis-worker'),
    ).toBe(true);
    expect(peak.satisfaction.stages.speed).not.toBe('bad');
    expect(peak.status).not.toBe('slow');
  });

  it('併用はイベントの月にアプリの VPS が滞っても簡易解析で速さを保ち、詳細解析が遅れた分だけ正確さが下がる（D-250）', () => {
    const r = play(at(SMALL, true), VPS, 'hybrid');
    expect(r.satisfaction.stages.analysisSpeed).toBe('fair');
    expect(r.satisfaction.stages.analysisAccuracy).toBe('fair');
    expect(r.satisfaction.reasons.analysisAccuracy).toMatch(
      /詳細解析が(届くまで|たまり続けて)/,
    );
    // 同じ実行環境（アプリの VPS）はページも解析も遅くなる
    const same = play(at(SMALL, true), VPS, 'same');
    expect(same.satisfaction.stages.analysisSpeed).toBe('bad');
    expect(same.satisfaction.stages.speed).toBe('bad');
  });

  it('サーバーレスは滞留せず、区切り方で速さが替わる', () => {
    expect(
      play(at(SMALL, true), PRO, 'same').satisfaction.stages.analysisSpeed,
    ).toBe('good');
    expect(
      play(at(SMALL), PRO, 'same', { analysisUnit: 1 }).satisfaction.stages
        .analysisSpeed,
    ).toBe('fair');
  });

  it('別の事業者のサーバーレス（D-245）は滞留せず、VPS の構成でもアプリの VPS は受けて書くだけ', () => {
    // イベントの月: VPS の同じ実行環境は滞るが、Lambda に出すとサーバーレスの速さ（局面ごとは良い）になる
    const fn = play(at(SMALL, true), VPS, 'fn-lambda');
    expect(fn.satisfaction.stages.analysisSpeed).toBe('good');
    expect(fn.satisfaction.stages.speed).not.toBe('bad');
    // 併用の worker（hybrid-worker-vps-4gb）は worker の滞留を簡易解析で隠し、詳細解析が遅れた分だけ正確さの値が下がる（D-250）
    const hw = play(at(SMALL, true), PRO, 'hybrid-worker-vps-4gb');
    expect(hw.satisfaction.stages.analysisSpeed).toBe('fair');
    const hwNormal = play(at(SMALL), PRO, 'hybrid-worker-vps-4gb');
    expect(hw.satisfaction.pillars!.analysis).toBeLessThan(
      hwNormal.satisfaction.pillars!.analysis,
    );
    expect(hw.satisfaction.reasons.analysisSpeed).toMatch(
      /ピークの時間帯の滞留の待ち|追いつかず/,
    );
  });

  it('台で借りるマシン（D-247）は worker の滞留で判定し、Fargate は滞留しない', () => {
    // EC2・Compute Engine のマシンは worker の箱（host）で、ピークの比から滞留を判定する（VPS の worker と同じ式）
    const ec2 = play(at(SMALL, true), PRO, 'ec2-c7g-2xlarge');
    expect(ec2.satisfaction.stages.analysisSpeed).not.toBe('good');
    expect(ec2.satisfaction.reasons.analysisSpeed).toMatch(
      /ピークの時間帯の滞留の待ち|追いつかず/,
    );
    // Fargate は増やし減らすので滞留せず、局面ごとはサーバーレスと同じ速さ
    expect(
      play(at(SMALL, true), PRO, 'fargate-arm').satisfaction.stages
        .analysisSpeed,
    ).toBe('good');
  });

  it('速さの係数（D-247）: 1 件の CPU の分だけを割り、待ちは変えない', () => {
    const base = serverRunSec(shape, 'game', Infinity);
    const fast = serverRunSec(shape, 'game', Infinity, 2);
    const cpuSec =
      (shape.startupCpuMs + shape.itemsPerBatch * shape.itemCpuMs) / 1000;
    expect(base - fast).toBeCloseTo(cpuSec / 2, 9);
    // 物理コアの x86 のマシンは、同じ実行環境（基準）より 1 局が早く見える
    expect(
      judge('ec2-c7a-2xlarge', settings('game'), { vcpu: 8, peakRatio: 0 })
        .serverSec!,
    ).toBeLessThan(
      judge('worker-vps-4gb', settings('game'), { vcpu: 8, peakRatio: 0 })
        .serverSec!,
    );
  });

  it('解析の worker だけの遅くなる前提を見分ける', () => {
    expect(
      analysisOnlyThrottle({
        effect: 'throttle',
        nodeIds: ['analysis-worker'],
      }),
    ).toBe(true);
    expect(analysisOnlyThrottle({ effect: 'throttle', nodeIds: ['vps'] })).toBe(
      false,
    );
    expect(
      analysisOnlyThrottle({ effect: 'block', nodeIds: ['analysis-worker'] }),
    ).toBe(false);
  });
});
