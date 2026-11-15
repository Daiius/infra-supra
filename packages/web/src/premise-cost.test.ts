// 上限・制限の行の超えた分の費用（premiseCostOf）。明細の行と前提を事業者・プラン・メーター・ノードで結ぶ（D-222 の補足・OCL-3407CD6A）。
import type { PlatformPremise } from 'estimator';
import type { MonthReport } from 'game';
import { describe, expect, it } from 'vitest';
import { premiseCostOf } from './premise-view.ts';

type Line = MonthReport['lines'][number];

const premise = (over: Partial<PlatformPremise> = {}): PlatformPremise =>
  ({
    id: 'pool:p:workers:requests',
    text: '前提',
    effect: 'cost',
    nodeIds: ['api'],
    provider: 'p',
    planId: 'workers',
    meterIds: ['requests'],
    hit: true,
    ...over,
  }) as PlatformPremise;

const line = (over: Partial<Line> = {}): Line => ({
  label: '行',
  provider: 'p',
  kind: 'usage',
  meterId: 'requests',
  planId: 'workers',
  nodeIds: ['api'],
  amount: 1.5,
  currency: 'USD',
  ...over,
});

describe('premiseCostOf', () => {
  it('同じ事業者・プラン・メーター・ノードの行を足す', () => {
    expect(premiseCostOf(premise(), [line(), line({ amount: 0.5 })])).toBe(
      '$2.00',
    );
  });

  it('同じ事業者の別のプラン（別のサービス）の同名のメーターは混ぜない', () => {
    // Workers と Durable Objects はどちらも requests を持つ
    const lines = [line(), line({ planId: 'durable-objects', amount: 9 })];
    expect(premiseCostOf(premise(), lines)).toBe('$1.50');
    expect(
      premiseCostOf(
        premise({ id: 'pool:p:do:requests', planId: 'durable-objects' }),
        lines,
      ),
    ).toBe('$9.00');
  });

  it('前提の外のノードも数えた行は分けられないので、費用を出さない', () => {
    expect(
      premiseCostOf(premise(), [line({ nodeIds: ['api', 'other'] })]),
    ).toBeUndefined();
  });

  it('プランの無い行（前の保存）・メーターの無い前提には費用を出さない', () => {
    const { planId: _, ...old } = line();
    expect(premiseCostOf(premise(), [old])).toBeUndefined();
    const { meterIds: __, ...noMeters } = premise();
    expect(premiseCostOf(noMeters, [line()])).toBeUndefined();
  });

  it('円の行は円で出す', () => {
    expect(
      premiseCostOf(premise(), [line({ currency: 'JPY', amount: 1234.4 })]),
    ).toBe('1,234 円');
  });
});
