// 機能開発の効き目の見せ方（D-122）: 来月の機能開発の見込みは playMonth と同じ配分で、行動・提案への返事で変わる。
import { describe, expect, it } from 'vitest';
import {
  acceptSummary,
  ARTICLE_COMMUNITY,
  checkAction,
  eventDef,
  featureOutlook,
  featureProgressOf,
  newGame,
  playMonth,
  type Action,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const sc = ARTICLE_COMMUNITY;
const ft = sc.satisfaction.feature;
const start = () => playMonth(newGame(CF_PAID, 42, sc, undefined, 'nextjs'));
const withProposal = (s: GameState, id: string): GameState => ({
  ...s,
  pendingProposals: [id],
});

describe('featureProgressOf', () => {
  it('期待は月の期待 × 経過月数で、段階は judgeStages の境目と同じ', () => {
    const e = ft.expectedPerMonth * 4;
    expect(featureProgressOf(sc, e * ft.good, 4)).toEqual({
      total: e * ft.good,
      expected: e,
      stage: 'good',
    });
    expect(featureProgressOf(sc, e * ft.fair, 4).stage).toBe('fair');
    expect(featureProgressOf(sc, e * ft.fair - 0.1, 4).stage).toBe('bad');
  });
});

describe('featureOutlook', () => {
  it('行動を選ばなければ、来月の機能開発は playMonth の配分と一致する', () => {
    const s = start();
    const o = featureOutlook(s, []);
    expect(o.change).toBe(0);
    expect(o.month).toBe(2);
    const next = playMonth(s);
    // 来月の出来事で対応の手間が増えていなければ一致する（シード 42 の 2 か月目は割り込みなし）
    expect(next.history[1]!.effort.feature).toBe(o.feature);
    expect(next.featurePoints).toBe(o.total);
    expect(o.expected).toBe(ft.expectedPerMonth * 2);
  });

  it('手間を使う行動を選ぶと、来月の機能開発がその分減る', () => {
    const s = start();
    const act: Action = { type: 'block-bots' };
    const cost = checkAction(s, act);
    expect(cost.ok).toBe(true);
    const o = featureOutlook(s, [act]);
    expect(o.change).toBe(-(cost.ok ? cost.cost : 0));
    expect(o.feature).toBe(featureOutlook(s, []).feature + o.change);
  });

  it('機能の追加の提案を受けると、作業は機能開発に数え、加点の按分の分だけ増える（D-29）', () => {
    const s = withProposal(start(), 'p-images');
    const o = featureOutlook(s, [
      { type: 'respond', eventId: 'p-images', accept: true },
    ]);
    // p-images: 加点 8 を作業の 2 か月に按分 → 来月 +4
    expect(o.change).toBe(4);
    const declined = featureOutlook(s, [
      { type: 'respond', eventId: 'p-images', accept: false },
    ]);
    expect(declined.change).toBe(0);
  });
});

describe('acceptSummary', () => {
  it('得（機能開発・PV の伸び）と、伴うこと（手間・使用量）をデータから組む', () => {
    const s = start();
    const sum = acceptSummary(s, eventDef(sc, 'p-images')!);
    expect(sum.gains).toEqual([
      '機能開発 +8（作業 3 × 2 か月も機能開発に数える）',
      'PV の月の伸び +3 ポイント（3 か月）',
    ]);
    expect(sum.costs).toContain('その間、行動に使える手間が 3 減る（2 か月）');
    expect(sum.costs.some((c) => c.startsWith('使用量・費用: '))).toBe(true);
  });

  it('機能開発に数えない対応の手間は、伴うことに出す', () => {
    const sum = acceptSummary(start(), eventDef(sc, 'p-archive')!);
    expect(sum.costs).toContain('対応の手間 4 × 1 か月（機能開発に数えない）');
    expect(sum.gains).toEqual([]);
  });
});
