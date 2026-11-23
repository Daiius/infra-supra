// 満足度の要素「解析の速さ」「解析の正確さ」（prd/17 §5.5・D-238）: 置き場・区切り方・候補の数・ピークの滞留で速さと正確さが
// どう動くか。解析のあるシナリオ（棋譜解析）だけで判定し、記事・受託では段階を持たない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import {
  KIFU_ANALYSIS_JOB,
  KIFU_GAMES_PER_MAU,
  KIFU_PV_PER_MAU,
} from 'catalog';
import {
  analysisOnlyThrottle,
  judgeAnalysis,
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
const settings = (unit: 'position' | 'game' | 'resumable', candidates = 3) => ({
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

  it('併用は端末の速報とサーバーの本解析の早いほう（VPS が滞っても速報で普通に保つ）', () => {
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

  it('併用は本解析で戻るが、本解析が利用者の離れた後に届くなら 1 段下がる', () => {
    expect(judge('hybrid').analysisAccuracy).toBe('good');
    const late = judge('hybrid', settings('position'), {
      vcpu: 3,
      peakRatio: 3,
    });
    expect(late.lateAccurate).toBe(true);
    expect(late.analysisAccuracy).toBe('fair');
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
    expect(r.satisfaction.score).toBeCloseTo(
      satisfactionScore(r.satisfaction.stages, KIFU_SATISFACTION_WEIGHTS),
    );
    const one = play(kifu, PRO, 'same', { candidates: 1 });
    expect(one.satisfaction.stages.analysisAccuracy).toBe('fair');
    expect(one.satisfaction.score).toBeCloseTo(
      r.satisfaction.score - KIFU_SATISFACTION_WEIGHTS.analysisAccuracy! / 2,
    );
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

  it('併用はイベントの月にアプリの VPS が滞っても速報で速さを保ち、正確さが下がる', () => {
    const r = play(at(SMALL, true), VPS, 'hybrid');
    expect(r.satisfaction.stages.analysisSpeed).toBe('fair');
    expect(r.satisfaction.stages.analysisAccuracy).toBe('fair');
    expect(r.satisfaction.reasons.analysisAccuracy).toMatch(
      /本解析が届くのは利用者がページを離れた後/,
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
