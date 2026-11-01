// 推移と見込み（prd/07 §5・GD-1）。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GAME,
  newGame,
  playMonth,
  type GameState,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';
import {
  extrapolate,
  premiseTrends,
  selectTrends,
  type PremiseSnapshot,
} from './trends.ts';

const snap = (
  id: string,
  ratio: number,
  accumulates = false,
): PremiseSnapshot => ({
  id,
  text: id,
  effect: 'cost',
  ratio,
  hit: ratio > 1,
  accumulates,
});

describe('extrapolate', () => {
  it('流量は月ごとの倍率の平均で伸ばす', () => {
    const v = extrapolate([0.25, 0.5], false, 2);
    expect(v).toEqual([1, 2]);
  });

  it('ためていく量は月ごとの増分の平均で伸ばす', () => {
    const v = extrapolate([0.2, 0.3, 0.4], true, 2);
    expect(v[0]).toBeCloseTo(0.5, 12);
    expect(v[1]).toBeCloseTo(0.6, 12);
  });

  it('記録が 1 か月しかなければ見込まない', () => {
    expect(extrapolate([0.5], false, 3)).toEqual([]);
  });
});

describe('premiseTrends', () => {
  it('残りの期間内に超えるなら、何か月後かを出す', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12)[0]!;
    expect(t.monthsUntil).toBe(2); // 0.5 → 1.0（超えない）→ 2.0
  });

  it('見込みの線は今月から始まり、境目を越える最初の月で止まる', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12)[0]!;
    expect(t.projection.map((p) => p.month)).toEqual([2, 3, 4]);
    expect(t.projection[t.projection.length - 1]!.ratio).toBeGreaterThan(1);
  });

  it('見込みを出さない理由があれば、見込みを出さずに理由を残す（話題になった月など）', () => {
    const t = premiseTrends([[snap('a', 0.25)], [snap('a', 0.5)]], 12, {
      skipProjection: '話題の月',
    })[0]!;
    expect(t.monthsUntil).toBeNull();
    expect(t.projection).toEqual([]);
    expect(t.projectionNote).toBe('話題の月');
  });

  it('残りの期間を過ぎてから超えるなら出さない', () => {
    const t = premiseTrends([[snap('a', 0.1)], [snap('a', 0.11)]], 3)[0]!;
    expect(t.monthsUntil).toBeNull();
  });

  it('下がっている・すでに超えているなら見込まない', () => {
    expect(
      premiseTrends([[snap('a', 0.6)], [snap('a', 0.5)]], 12)[0]!.monthsUntil,
    ).toBeNull();
    expect(
      premiseTrends([[snap('a', 1.2)], [snap('a', 1.5)]], 12)[0]!.monthsUntil,
    ).toBeNull();
  });

  it('前の月の見込みより早く超えたら印を付ける（急増など）', () => {
    // 2 か月目までの見込みでは 12 か月以内に超えない（0.1 → 0.11）が、3 か月目に急増して超えた
    const t = premiseTrends(
      [[snap('a', 0.1)], [snap('a', 0.11)], [snap('a', 1.5)]],
      12,
    )[0]!;
    expect(t.hitNow).toBe(true);
    expect(t.earlierThanProjected).toBe(true);
  });

  it('構成を乗り換えて途切れた前提は、途切れた後の記録だけで見込む', () => {
    const t = premiseTrends([[snap('a', 0.4)], [], [snap('a', 0.45)]], 12)[0]!;
    expect(t.ratios).toEqual([0.4, null, 0.45]);
    expect(t.monthsUntil).toBeNull(); // 連続した記録が 1 か月だけ
  });
});

describe('selectTrends', () => {
  it('止まる前提 → 見込みで超える → 課金の前提 → 近い順に、上位だけ出す', () => {
    const block: PremiseSnapshot = { ...snap('block', 2), effect: 'block' };
    const trends = premiseTrends(
      [
        [
          snap('far', 0.1),
          snap('near', 0.8),
          snap('cost-hit', 1.5),
          block,
          snap('soon', 0.3),
        ],
        [
          snap('far', 0.1),
          snap('near', 0.8),
          snap('cost-hit', 1.6),
          block,
          snap('soon', 0.6),
        ],
      ],
      12,
    );
    expect(selectTrends(trends).map((t) => t.id)).toEqual([
      'block',
      'soon',
      'cost-hit',
      'near',
    ]);
  });
});

describe('ゲームの記録', () => {
  function playN(n: number): GameState {
    let s = playMonth(newGame(3));
    for (let i = 1; i < n; i++) s = playMonth(applyAction(s, { type: 'none' }));
    return s;
  }

  it('毎月、量の境目がある前提をすべて記録する', () => {
    const s = playN(3);
    for (const m of s.history) {
      expect(m.snapshots.length).toBeGreaterThan(0);
      expect(m.snapshots.every((p) => Number.isFinite(p.ratio))).toBe(true);
    }
  });

  it('Vercel Pro は月のクレジットの使用率を記録し、超える前に見込みが出る（受託・シード 2。D-48）', () => {
    let s = playMonth(newGame(3, 2, CONTRACT_OPERATIONS));
    for (let i = 1; i < 5; i++) s = playMonth(applyAction(s, { type: 'none' }));
    const trends = premiseTrends(
      s.history.map((m) => m.snapshots),
      CONTRACT_OPERATIONS.months,
    );
    const credit = trends.find(
      (t) => t.id === 'credit:vercel:pro:usage-credit',
    )!;
    // 止まらず請求が増える前提で、流量として伸び率で見込む
    expect(credit.effect).toBe('cost');
    expect(credit.accumulates).toBe(false);
    expect(credit.ratios.every((r) => r !== null && r > 0)).toBe(true);
    expect(credit.hitNow).toBe(false);
    expect(credit.monthsUntil).not.toBeNull();
  });

  it('記事コミュニティの Vercel Pro は 1 か月目からクレジットを超え、超えた分が請求される（D-48）', () => {
    const s = playN(1);
    const p = s.history[0]!.snapshots.find(
      (x) => x.id === 'credit:vercel:pro:usage-credit',
    )!;
    expect(p.hit).toBe(true);
    expect(p.effect).toBe('cost');
    expect(s.phase).toBe('playing');
  });
});
