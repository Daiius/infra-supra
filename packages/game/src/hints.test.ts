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

  it('規約違反を一度解消して再び違反したときは、最後の指摘の月と停止の月を出す（OCL-7A142E66）', () => {
    // 1 か月目に指摘 → Pro に変えて解消 → Hobby に戻して 3 か月目に再び指摘 → 4 か月目に停止
    const st = playStrategy(
      {
        id: 'back',
        label: 'Hobby に戻す',
        stackIndex: HOBBY,
        actions: [
          [{ type: 'plan', stackIndex: PRO }],
          [{ type: 'plan', stackIndex: HOBBY }],
        ],
      },
      42,
    );
    expect(st.end).toEqual({ reason: 'policy', month: 4 });
    expect(
      st.history.filter((r) => r.policyWarning).map((r) => r.month),
    ).toEqual([1, 3]);
    const policy = retryHintsOf(st).find((x) => x.kind === 'policy')!;
    expect(policy.what).toMatch(/^3 か月目に運営元から規約違反の指摘/);
    expect(policy.what).toContain('4 か月目も違反したまま');
  });

  it('受けた提案で上限を越えたときは、一時的な流量の出来事と言わない（OCL-7878F16B）', () => {
    // 受託・VPS 2GB の 12 か月目のディスクの超過を、受けた提案が原因だったことにする
    const st = idle(VPS_2GB, CONTRACT_OPERATIONS);
    const last = st.history.at(-1)!;
    const disk = last.premises.find(
      (p) => p.hit && p.text.includes('ディスク'),
    )!;
    const withCause = (eventId: string, title: string) =>
      retryHintsOf({
        ...st,
        history: [
          ...st.history.slice(0, -1),
          {
            ...last,
            crossings: [
              {
                premiseId: disk.id,
                text: disk.text,
                causes: [{ eventId, title, ratioWithout: 0.9 }],
              },
            ],
          },
        ],
      }).find((x) => x.kind === 'limit')!;
    const proposal = withCause('c-p-attachments', '添付ファイルの提案');
    expect(proposal.what).toContain(
      '「添付ファイルの提案」が無ければ越えなかった',
    );
    expect(proposal.next).toContain('受けた提案で保存量が増え');
    expect(proposal.next).not.toContain('一時的');
    // 流量の出来事なら従来どおり
    expect(withCause('c-busy', '繁忙期').next).toContain(
      '一時的に流量が増える',
    );
  });

  describe('SPA で OGP の前処理なしに話題を迎えた（D-43）', () => {
    // D-44 の話題の集中を外した同じシナリオ。前処理で話題が × 3 に戻ると VPS は話題の月に回線が詰まり、
    // カードの効きと回線の詰まりが混ざるので、見積もり（カードの効きだけ）と比べるときは集中を外す
    const SC: Scenario = {
      ...ARTICLE_COMMUNITY,
      events: ARTICLE_COMMUNITY.events.map((e) => ({
        ...e,
        effects: (e.effects ?? []).map((x) => {
          if (x.type !== 'traffic') return x;
          const { spikeDays: _, ...rest } = x;
          return rest;
        }),
      })),
    };
    const withOgp = (seed: number) =>
      playStrategy(
        {
          id: 'ogp',
          label: 'OGP の前処理を付ける',
          stackIndex: VPS_2GB,
          actions: [[{ type: 'component', slot: 'ogp', option: 'prerender' }]],
        },
        seed,
        SC,
        undefined,
        'vite-spa',
      );
    const revenue = (st: { history: { revenue: number }[] }) =>
      st.history.reduce((a, r) => a + r.revenue, 0);

    it.each([1, 2, 3, 42])(
      'VPS 2GB・何もしない（シード %i）: 所持金で落ち、最初に OGP のヒント。見積もりは前処理ありのプレイの収益の差と合う',
      (seed) => {
        const st = playStrategy(
          { id: 'idle', label: '何もしない', stackIndex: VPS_2GB },
          seed,
          SC,
          undefined,
          'vite-spa',
        );
        expect(st.end?.reason).toBe('goal');
        expect(st.cash).toBeLessThan(ARTICLE_COMMUNITY.goal.cash);
        const hint = retryHintsOf(st)[0]!;
        expect(hint.kind).toBe('ogp');
        expect(hint.what).toMatch(
          /^\d+ か月目の話題で、記事ごとの SNS のカードが出ないため/,
        );
        expect(hint.what).toContain('× 3 → × 2');
        expect(hint.next).toContain('OGP の前処理');
        // VPS で前段の CDN が無いと、話題の月に回線が詰まりうる（D-44）
        expect(hint.what).toContain('回線が詰まりうる');
        expect(hint.next).toContain('前段の CDN');
        // 前処理を付けたプレイとの収益の差（VPS は固定費なので所持金の差も同じ）
        const diff = revenue(withOgp(seed)) - revenue(st);
        const est = Number(
          hint.what.match(/約 \+\$([\d,]+)/)![1]!.replace(',', ''),
        );
        expect(Math.abs(est - diff)).toBeLessThanOrEqual(2);
      },
    );

    it('前段の CDN があれば、回線の詰まりの但し書きは付けない（D-44）', () => {
      const st = playStrategy(
        {
          id: 'cdn',
          label: '前段の CDN',
          stackIndex: VPS_2GB,
          actions: [
            [{ type: 'component', slot: 'frontCdn', option: 'static' }],
          ],
        },
        42,
        ARTICLE_COMMUNITY,
        undefined,
        'vite-spa',
      );
      const hint = retryHintsOf(st).find((x) => x.kind === 'ogp');
      expect(hint).toBeDefined();
      expect(hint!.what).not.toContain('回線');
    });

    it('前処理を付けたプレイ・Next.js では出さない', () => {
      expect(retryHintsOf(withOgp(42)).some((x) => x.kind === 'ogp')).toBe(
        false,
      );
      for (const s of [VPS_2GB, VPS_4GB, PRO]) {
        const st = idle(s, ARTICLE_COMMUNITY, 'nextjs');
        expect(retryHintsOf(st).some((x) => x.kind === 'ogp')).toBe(false);
      }
      // 受託はカードが効かない（socialCardFactor 1）
      const contract = idle(VPS_2GB, CONTRACT_OPERATIONS, 'vite-spa');
      expect(retryHintsOf(contract).some((x) => x.kind === 'ogp')).toBe(false);
    });
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
