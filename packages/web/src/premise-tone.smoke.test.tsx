// @vitest-environment jsdom
// 当たった前提の印の色を効き方で分ける（D-188）。止まる・プランの変更が要るは赤、遅くなる・課金・調整は黄。
import { render } from '@testing-library/react';
import type { PlatformPremise } from 'estimator';
import type { MonthEvent } from 'game';
import { describe, expect, it } from 'vitest';
import { EventCard } from './game-screen.tsx';
import { hitLabel, hitTone } from './premise-view.ts';
import { useSmokeEnv } from './smoke.test-helpers.tsx';

useSmokeEnv();

const EFFECTS: [PlatformPremise['effect'], 'error' | 'warning'][] = [
  ['block', 'error'],
  ['upgrade-required', 'error'],
  ['policy', 'error'],
  ['throttle', 'warning'],
  ['cost', 'warning'],
  ['adjust', 'warning'],
  ['info', 'warning'],
];

const premise = (
  id: string,
  effect: PlatformPremise['effect'],
): PlatformPremise => ({
  id,
  text: `前提 ${id}`,
  kind: 'threshold',
  effect,
  nodeIds: [],
  ratio: 1.5,
  hit: true,
});

const event = (premises: MonthEvent['premises']): MonthEvent => ({
  id: 'buzz',
  kind: 'state',
  tier: 'occasional',
  phase: 'occurred',
  title: 'SNS で話題',
  text: '記事が SNS で話題になりました',
  effects: ['PV × 3'],
  premises,
});

describe('当たった前提の色（D-188）', () => {
  it('W-188a 効き方ごとの色: 止まる・プランの変更が要る・規約は赤、遅くなる・課金・調整・情報は黄', () => {
    for (const [effect, tone] of EFFECTS) expect(hitTone(effect)).toBe(tone);
    expect(hitLabel('cost')).toBe('超過（課金）');
    expect(hitLabel('throttle')).toBe('上限に達した（遅くなる）');
    // 推移の効き方は string。知らない値は黄・「上限に達した」
    expect(hitLabel('unknown')).toBe('上限に達した');
  });

  it('W-188b 出来事の前提の印は、同じ月の前提の効き方で色と文言を分ける（課金の境目は黄、止まるは赤）', () => {
    const { container } = render(
      <EventCard
        event={event([
          ...EFFECTS.map(([effect]) => ({
            id: `p-${effect}`,
            text: `前提 ${effect}`,
            hit: true,
            ratio: 1.5,
          })),
          // 効き方が引けない前提は今までどおり赤
          { id: 'p-missing', text: '前提 missing', hit: true },
          // 当たっていない前提は色を付けない
          { id: 'p-cost-near', text: '前提 near', hit: false, ratio: 0.8 },
        ])}
        premises={[
          ...EFFECTS.map(([effect]) => premise(`p-${effect}`, effect)),
          premise('p-cost-near', 'cost'),
        ]}
      />,
    );
    const badgeOf = (text: string) =>
      [...container.querySelectorAll('li')]
        .find((li) => li.textContent!.includes(text))!
        .querySelector('.badge')!;
    for (const [effect, tone] of EFFECTS) {
      const b = badgeOf(`前提 ${effect}`);
      expect(b.className, effect).toContain(`badge-${tone}`);
      expect(b.className, effect).not.toContain(
        `badge-${tone === 'error' ? 'warning' : 'error'}`,
      );
      expect(b.textContent).toContain(hitLabel(effect));
    }
    expect(badgeOf('前提 cost').textContent).toBe('● 超過（課金）');
    expect(badgeOf('前提 block').textContent).toBe('✗ 上限に達した');
    expect(badgeOf('前提 missing').className).toContain('badge-error');
    const near = badgeOf('前提 near');
    expect(near.className).toContain('badge-ghost');
    expect(near.textContent).toBe('○ 達する可能性のある上限');
  });
});
