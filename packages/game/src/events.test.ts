// 出来事の仕組み（prd/07 §10.2・§10.5）。値に依存しない性質を、テスト用のシナリオで確かめる。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyAction,
  effortAvailable,
  newGame,
  playMonth,
  rollSchedule,
  type EventDef,
  type GameState,
  type Scenario,
} from './index.ts';

const proposal: EventDef = {
  id: 'test-proposal',
  kind: 'proposal',
  tier: 'occasional',
  title: 'テストの提案',
  text: '機能を足すか',
  when: { type: 'window', from: 3, to: 5 },
  premiseRefs: [],
  accept: {
    label: '受ける',
    effects: [
      { type: 'workload', mods: { imagesPerPage: 8 } },
      { type: 'interrupt', points: 2, months: 2 },
      { type: 'feature', points: 5 },
    ],
  },
};
const rare: EventDef = {
  id: 'test-rare',
  kind: 'script',
  tier: 'rare',
  title: 'まれな出来事',
  text: 'まれ',
  when: { type: 'rare', weight: 1 },
  notice: {
    monthsAhead: 1,
    title: 'まれな出来事が来そう',
    text: '来月まれな出来事',
  },
  premiseRefs: [],
  effects: [],
};
const TEST: Scenario = {
  ...ARTICLE_COMMUNITY,
  id: 'test',
  rare: { perGame: 0.25, from: 5, to: 9 },
  events: [...ARTICLE_COMMUNITY.events, proposal, rare],
};

function until(s: GameState, month: number): GameState {
  let st = s.history.length ? s : playMonth(s);
  while (st.history.length < month && st.phase === 'playing')
    st = playMonth(st);
  return st;
}

describe('台本の表', () => {
  it('同じシードなら同じ表・構成によらない', () => {
    expect(newGame(1, 7, TEST).schedule).toEqual(newGame(4, 7, TEST).schedule);
    expect(rollSchedule(TEST, 7)).toEqual(rollSchedule(TEST, 7));
  });

  it('出来事を足しても、他の出来事の時期は変わらない', () => {
    const fewer: Scenario = {
      ...TEST,
      events: [...ARTICLE_COMMUNITY.events, proposal],
    };
    for (let seed = 1; seed <= 30; seed++) {
      const a = rollSchedule(fewer, seed).find((x) => x.id === proposal.id);
      const b = rollSchedule(TEST, seed).find((x) => x.id === proposal.id);
      expect(a).toEqual(b);
    }
  });

  it('時期は幅の中・まれな出来事は高々 1 回で、予告は 1 か月前', () => {
    let rareCount = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const s = rollSchedule(TEST, seed);
      const p = s.find((x) => x.id === proposal.id)!;
      expect(p.month).toBeGreaterThanOrEqual(3);
      expect(p.month).toBeLessThanOrEqual(5);
      const r = s.filter((x) => x.id === rare.id || x.id === 'p-archive');
      expect(r.length).toBeLessThanOrEqual(1);
      if (r[0]) {
        rareCount++;
        expect(r[0].month).toBeGreaterThanOrEqual(5);
        expect(r[0].month).toBeLessThanOrEqual(9);
        expect(r[0].noticeMonth).toBe(r[0].month - 1);
      }
    }
    expect(rareCount / N).toBeGreaterThan(0.21);
    expect(rareCount / N).toBeLessThan(0.29);
  });

  it('出来事を足しても、偶発的な障害の列は変わらない', () => {
    const a = until(newGame(4, 7), 12);
    const b = until(newGame(4, 7, TEST), 12);
    expect(b.history.map((r) => r.status === 'incident')).toEqual(
      a.history.map((r) => r.status === 'incident'),
    );
  });
});

describe('提案', () => {
  const arrival = (seed: number) =>
    rollSchedule(TEST, seed).find((x) => x.id === proposal.id)!.month;

  it('届いた月に返事を待ち、断ると何も変わらない（罰はない）', () => {
    const m = arrival(42);
    const s = until(newGame(1, 42, TEST), m);
    expect(s.pendingProposals).toEqual([proposal.id]);
    expect(s.history[m - 1]!.events.some((e) => e.phase === 'proposal')).toBe(
      true,
    );
    const declined = applyAction(s, {
      type: 'respond',
      eventId: proposal.id,
      accept: false,
    });
    expect(declined.mods).toEqual({});
    expect(declined.interrupts).toEqual([]);
    // 返事をしなくても断ったことになる
    const next = playMonth(s);
    expect(next.responses[proposal.id]).toBe('declined');
    expect(next.mods).toEqual({});
  });

  it('受けると Workload・手間・機能が変わる（翌月から）', () => {
    const m = arrival(42);
    const s = until(newGame(1, 42, TEST), m);
    const before = effortAvailable(s);
    const a = applyAction(s, {
      type: 'respond',
      eventId: proposal.id,
      accept: true,
    });
    expect(a.mods.imagesPerPage).toBe(8);
    expect(effortAvailable(a)).toBe(before - 2);
    expect(a.featurePoints).toBe(s.featurePoints + 5);
    const next = playMonth(a);
    expect(next.history[m]!.effort.interrupt).toBe(2);
    expect(playMonth(next).history[m + 1]!.effort.interrupt).toBe(2);
  });

  it('待っていない提案には返事できない', () => {
    const s = until(newGame(1, 42, TEST), 1);
    expect(
      applyAction(s, { type: 'respond', eventId: proposal.id, accept: true }),
    ).toBe(s);
  });
});
