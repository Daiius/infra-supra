// 研究会の共同検討（prd/17 §6 の出来事 6・D-240）の土台: 棋譜解析では全構成（隠した構成を除く）でリアルタイムの部品を受けられ、
// 記事コミュニティのチャット（W-1）は Cloudflare だけのまま（X-5）。出来事そのもの（文言・起きる月）は PR-10 なので、提案を受けた形を
// テストの中で作る。記事・受託の golden は game.test.ts・contract.test.ts が見る。
import { describe, expect, it } from 'vitest';
import { KIFU_STUDY_REALTIME, REALTIME_OPTION } from 'catalog';
import {
  applyActions,
  DEFAULT_START_DATE,
  SCENARIOS,
  newGame,
  playMonth,
  realtimeOptionFor,
  realtimeSessionOf,
  realtimeSupported,
  scenarioComponentsOf,
  STACKS,
  type Action,
  type GameState,
  type Scenario,
} from './index.ts';
import { componentsAfterMigration } from './stacks.ts';
import { booksAt } from './core.ts';
import { monthEstimate } from './setup/estimates.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';

// 棋譜解析から研究会の出来事を外した（D-252）ので、全構成のリアルタイムを持つシナリオは今は無い。仕組みを確かめるため、
// 棋譜解析に realtimeAllPlatforms を付けた形をテストの中で作る
const KIFU: Scenario = {
  ...SCENARIOS['kifu-analysis']!,
  realtimeAllPlatforms: true,
};
const ARTICLE = ARTICLE_COMMUNITY;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VISIBLE = STACKS.filter(
  (s) => s.provider !== 'netlify' && s.provider !== 'aws-opennext',
);

/** 提案の id（テストの中だけ）。 */
const STUDY = 'k-study-test';

/** 棋譜解析（3 万 PV）に、1 か月目に研究会の提案が届く形。受けるとその構成のリアルタイムの部品が付く。 */
const scenarioFor = (stackIndex: number): Scenario => {
  const option = realtimeOptionFor(STACKS[stackIndex]!.provider, KIFU)!;
  return {
    ...KIFU,
    id: 'kifu-study-test',
    startCash: 1e9,
    scale: { startPV: 30_000 },
    events: [
      {
        id: STUDY,
        kind: 'proposal',
        tier: 'common',
        title: '研究会（テスト）',
        text: 'テスト',
        when: { type: 'window', from: 1, to: 1 },
        premiseRefs: [],
        accept: {
          label: '受ける',
          effects: [
            { type: 'workload', mods: { realtime: KIFU_STUDY_REALTIME } },
            { type: 'component', slot: 'realtime', option },
          ],
        },
      },
    ],
  };
};

/** 2 か月遊ぶ（1 か月目の終わりに研究会の提案へ返事する）。 */
function play(stackIndex: number, accept: boolean): GameState {
  const sc = scenarioFor(stackIndex);
  let s = playMonth(
    newGame(stackIndex, 1, sc, DEFAULT_START_DATE, 'nextjs', {
      analysis: 'same',
    }),
  );
  expect(s.pendingProposals).toContain(STUDY);
  const answer: Action = { type: 'respond', eventId: STUDY, accept };
  s = applyActions(s, [answer]);
  return playMonth(s);
}

describe('どのシナリオで、どの構成が受けられるか', () => {
  it('棋譜解析は隠した構成を除く全構成で、記事コミュニティは Cloudflare だけ（X-5）', () => {
    for (const s of VISIBLE) {
      expect(realtimeSupported(s.provider, KIFU), s.id).toBe(true);
      expect(realtimeSupported(s.provider, ARTICLE), s.id).toBe(
        s.provider === 'cloudflare',
      );
    }
    for (const p of ['netlify', 'aws-opennext'] as const)
      expect(realtimeSupported(p, KIFU)).toBe(false);
  });

  it('部品の選択肢: 棋譜解析だけ Cloudflare 以外にも出る', () => {
    expect(
      scenarioComponentsOf(KIFU, 'vercel', 'realtime').map((o) => o.id),
    ).toEqual(['none', REALTIME_OPTION.vercel]);
    expect(scenarioComponentsOf(ARTICLE, 'vercel', 'realtime')).toEqual([]);
  });

  it('乗り換え先にリアルタイムの部品を付ける（記事コミュニティは Cloudflare だけ）', () => {
    const mods = { realtime: KIFU_STUDY_REALTIME };
    const to = idx('sakura-vps-2gb');
    expect(componentsAfterMigration(to, mods, 'nextjs', KIFU).realtime).toBe(
      REALTIME_OPTION.sakura,
    );
    expect(
      componentsAfterMigration(to, mods, 'nextjs', ARTICLE).realtime,
    ).toBeUndefined();
  });
});

describe('セッションを保てるか（判定の材料）', () => {
  it('Durable Objects と VPS は 90 分のセッションを保ち、サーバーレスは保てない（つなぎ直す・盤面を外に置く）', () => {
    const at = (id: string) =>
      realtimeSessionOf(
        idx(id),
        KIFU,
        KIFU_STUDY_REALTIME.minutesPerConnection,
      )!;
    expect(at('cloudflare-vinext-paid').keepsSession).toBe(true);
    expect(at('sakura-vps-2gb').keepsSession).toBe(true);
    expect(at('vercel-supabase-hobby').reconnectsPerSession).toBe(18);
    expect(at('vercel-supabase-pro').reconnectsPerSession).toBe(7);
    expect(at('gcp-cloud-run').reconnectsPerSession).toBe(2);
    // API Gateway は 2 時間までつなげるが、Lambda は状態を持てないので盤面は DB
    expect(at('aws-amplify').reconnectsPerSession).toBe(1);
    for (const id of [
      'vercel-supabase-hobby',
      'vercel-supabase-pro',
      'gcp-cloud-run',
      'aws-amplify',
    ])
      expect(at(id).keepsSession, id).toBe(false);
  });

  it('隠した構成と、記事コミュニティの Cloudflare 以外は手段が無い（受けるには構成の変更が要る）', () => {
    expect(realtimeSessionOf(idx('netlify-supabase-pro'), KIFU, 90)).toBe(
      undefined,
    );
    expect(realtimeSessionOf(idx('vercel-supabase-pro'), ARTICLE, 90)).toBe(
      undefined,
    );
  });
});

describe('研究会を受けた月の費用', () => {
  it.each(VISIBLE.map((s) => [s.id]))(
    '%s: 部品が付き、費用は断ったゲーム以上で、VPS と込み分の内の構成は変わらない',
    (id) => {
      const on = play(idx(id), true);
      const off = play(idx(id), false);
      expect(on.components.realtime).toBe(
        REALTIME_OPTION[STACKS[idx(id)]!.provider],
      );
      expect(on.mods.realtime).toEqual(KIFU_STUDY_REALTIME);
      const d = on.history[1]!.infraCost - off.history[1]!.infraCost;
      expect(d).toBeGreaterThanOrEqual(-1e-9);
      if (STACKS[idx(id)]!.provider === 'sakura') expect(d).toBeCloseTo(0, 9);
    },
  );

  it('サーバーレスの従量は、つないでいる間の課金で費用が増える（Vercel Pro・Cloud Run・AWS）', () => {
    for (const id of ['vercel-supabase-pro', 'gcp-cloud-run', 'aws-amplify']) {
      const d =
        play(idx(id), true).history[1]!.infraCost -
        play(idx(id), false).history[1]!.infraCost;
      expect(d, id).toBeGreaterThan(0);
    }
  });

  it('前提の文に、構成ごとのセッションの事実が出る', () => {
    const premises = (id: string) => {
      const s = play(idx(id), true);
      return monthEstimate(s.scenario, s, {
        books: booksAt(s, s.history.length + 1),
      }).premises.map((p) => p.id);
    };
    expect(premises('vercel-supabase-pro')).toContain(
      'fact:vercel:pro:websocket-max-duration',
    );
    expect(premises('gcp-cloud-run')).toContain(
      'fact:gcp:cloud-run:websocket-timeout',
    );
    expect(premises('aws-amplify')).toContain(
      'fact:aws:api-gateway-websocket:websocket-state',
    );
    expect(premises('sakura-vps-2gb')).toContain(
      'fact:sakura-vps:2gb-tokyo:websocket-resident',
    );
  });
});
