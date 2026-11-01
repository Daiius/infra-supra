// 次のプレイへのヒント（D-40）: 何もしない方針で負けるケースで、原因が実際の負けの理由と合うか。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  playStrategy,
  retryHintsOf,
  SCENARIOS,
  STACKS,
  type FrameworkId,
  type Scenario,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const idle = (
  stackIndex: number,
  sc: Scenario = ARTICLE_COMMUNITY,
  framework?: FrameworkId,
) =>
  playStrategy(
    { id: 'idle', label: '何もしない', stackIndex, actions: [] },
    42,
    sc,
    undefined,
    framework,
  );
const CF_FREE = 0;
const CF_PAID = 1;
const HOBBY = 2;
const PRO = 3;
const VPS_2GB = 4;
const VPS_4GB = 5;

describe('retryHintsOf', () => {
  it('達成したとき・遊んでいる途中は出さない', () => {
    const won = idle(CF_PAID);
    expect(won.phase).toBe('won');
    expect(retryHintsOf(won)).toEqual([]);
  });

  it('Cloudflare Free: 込みの上限に当たって止まった月が最初に出る', () => {
    const st = idle(CF_FREE);
    expect(st.end?.reason).toBe('outages');
    const hints = retryHintsOf(st);
    expect(hints[0]!.kind).toBe('limit');
    expect(hints[0]!.what).toMatch(/1〜3 か月目に止まった/);
    expect(hints[0]!.what).toContain('Free');
    expect(hints[0]!.next).toContain('上限の大きいプラン・部品');
  });

  it('Vercel Hobby: 規約違反の指摘と停止が最初に出る', () => {
    const st = idle(HOBBY);
    expect(st.end?.reason).toBe('policy');
    const hints = retryHintsOf(st);
    expect(hints[0]!.kind).toBe('policy');
    expect(hints[0]!.what).toContain('1 か月目');
    expect(hints[0]!.what).toContain('非商用');
    expect(hints.slice(1).every((x) => x.kind === 'limit')).toBe(true);
  });

  it('Vercel Pro: 所持金が足りず、費用の大きい基本料が出る', () => {
    const st = idle(PRO);
    expect(st.end?.reason).toBe('goal');
    const hints = retryHintsOf(st);
    expect(hints[0]!.kind).toBe('cost');
    expect(hints[0]!.what).toMatch(/目標 \$1,730 に \$\d+ 足りない/);
    expect(hints[0]!.what).toContain('vercel pro 基本料');
    // 込み分を超えて請求が付いた前提も挙がる
    expect(hints.some((x) => x.kind === 'overage')).toBe(true);
  });

  it('さくらの VPS 4GB: 費用は小さく、維持の手間で機能が伸びなかったことが出る', () => {
    const st = idle(VPS_4GB);
    expect(st.end?.reason).toBe('goal');
    const hints = retryHintsOf(st);
    expect(hints[0]!.kind).toBe('cost');
    expect(hints[0]!.next).toContain('収益（PV の伸び）');
    const feature = hints.find((x) => x.what.startsWith('機能'));
    expect(feature?.what).toContain('維持の手間 計 36');
  });

  it('受託・Cloudflare Free: DB の容量（ためていく量）と CPU の上限を分けて出す', () => {
    const st = idle(CF_FREE, CONTRACT_OPERATIONS);
    expect(st.end?.reason).toBe('outages');
    const hints = retryHintsOf(st);
    expect(hints.map((x) => x.kind)).toEqual(['limit', 'limit']);
    expect(hints[0]!.what).toContain('D1 Free');
    expect(hints[0]!.next).toContain('ためていく量');
    expect(hints[1]!.what).toContain('CPU 10 ms');
  });

  it('受託・さくらの VPS 2GB: 満足度が届かず、機能・速さとディスクの上限が出る', () => {
    const st = idle(VPS_2GB, CONTRACT_OPERATIONS);
    expect(st.end?.reason).toBe('goal');
    expect(st.cash).toBeGreaterThanOrEqual(CONTRACT_OPERATIONS.goal.cash);
    const hints = retryHintsOf(st);
    expect(hints.map((x) => x.kind)).toEqual(['element', 'element', 'limit']);
    expect(hints[2]!.what).toContain('12 か月目');
    expect(hints[2]!.what).toContain('ディスク');
  });

  it('負けたすべての何もしない方針で 1〜3 個。対策の方向に構成の名前を出さない', () => {
    const names = STACKS.map((s) => s.name.replace(/（.*）/, ''));
    for (const sc of Object.values(SCENARIOS))
      for (const fw of ['nextjs', 'vite-spa'] as const)
        for (const s of STACKS) {
          const st = idle(s.index, sc, fw);
          const hints = retryHintsOf(st);
          if (st.phase === 'won') {
            expect(hints).toEqual([]);
            continue;
          }
          expect(hints.length).toBeGreaterThanOrEqual(1);
          expect(hints.length).toBeLessThanOrEqual(3);
          for (const x of hints)
            for (const name of names) expect(x.next).not.toContain(name);
        }
  });
});
