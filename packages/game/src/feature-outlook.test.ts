// 機能開発の効き目の見せ方（D-122）: 来月の機能開発の見込みは playMonth と同じ配分で、行動・提案への返事で変わる。
import { describe, expect, it } from 'vitest';
import {
  acceptSummary,
  ARTICLE_COMMUNITY,
  checkAction,
  eventDef,
  featureOutlook,
  featureProgressOf,
  IMAGE_REDESIGN_ID,
  newGame,
  playMonth,
  SCENARIOS,
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
      fairAt: e * ft.fair,
      goodAt: e * ft.good,
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

  it('来月の配分の見込み（effort）は、来月の機能開発と同じ配分', () => {
    const o = featureOutlook(start(), [{ type: 'block-bots' }]);
    expect(o.effort.feature).toBe(o.feature);
    expect(o.effort.actions).toBeGreaterThan(0);
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
    // 基準の PV が増える分は、PV に比例する収益を得に出す
    expect(sum.gains).toEqual([
      `基準の PV × 1.5（以降ずっと）・収益は 1,000 PV あたり $${sc.revenue.adsUsdPer1000PV}`,
    ]);
  });
});

describe('acceptSummary の得と断ったときの損', () => {
  it('どのシナリオのどの提案も、受けたときの得が空でない', () => {
    for (const s of Object.values(SCENARIOS)) {
      const state = playMonth(newGame(CF_PAID, 42, s, undefined, 'nextjs'));
      for (const def of s.events.filter((e) => e.kind === 'proposal'))
        expect(
          acceptSummary(state, def).gains,
          `${s.id} ${def.id}`,
        ).not.toEqual([]);
    }
  });

  it('記事のデザインの刷新: 得と断ったときの損を declineMonths から組む。原本を配っていれば断っても下がらない', () => {
    const def = eventDef(sc, IMAGE_REDESIGN_ID)!;
    const months = sc.imageRedesign!.declineMonths;
    const s = start();
    const sum = acceptSummary(s, def);
    expect(sum.gains).toEqual([
      `画質の評価を保つ（断ると ${months} か月、画質が 1 段下がる）`,
    ]);
    expect(sum.declineLoss).toBe(`${months} か月、画質の評価が 1 段下がる`);
    const original = acceptSummary(
      { ...s, components: { ...s.components, images: 'none' } },
      def,
    );
    expect(original.declineLoss).toBeUndefined();
    expect(original.gains[0]).toContain('断っても画質の評価は下がらない');
    // 原本の無い粗い画像が多いと、受けても下がる
    const coarse = acceptSummary(
      {
        ...s,
        stock: { ...s.stock, images: 100 },
        coarseImages: 100 * sc.imageRedesign!.coarseShare,
      },
      def,
    );
    expect(coarse.declineLoss).toBeDefined();
    expect(
      coarse.costs.some((c) => c.includes('受けても画質の評価が 1 段下がる')),
    ).toBe(true);
  });

  it('基準の PV を増やす提案は、PV に比例する収益を得に、使用量・費用を伴うことに出す', () => {
    const contract = SCENARIOS['contract-operations']!;
    const s = playMonth(newGame(CF_PAID, 42, contract, undefined, 'nextjs'));
    const sum = acceptSummary(s, eventDef(contract, 'c-p-rollout')!);
    expect(sum.gains).toEqual([
      `基準の PV × 3（以降ずっと）・収益は 1,000 PV あたり $${contract.revenue.adsUsdPer1000PV}`,
    ]);
    expect(sum.costs).toContain('使用量・費用: PV に比例して増える');
    expect(sum.declineLoss).toBeUndefined();
  });
});
