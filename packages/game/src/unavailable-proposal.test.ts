// 今の構成では受けられない提案は、返事を待たない知らせにして断ったことにする（D-201）。台本の月・乱数は変えない（golden は game.test.ts）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  newGame,
  playMonth,
  type GameState,
  type Scenario,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const last = (s: GameState) => s.history[s.history.length - 1]!;

describe('受けられない提案は知らせにする（D-201）', () => {
  /** その出来事が起きる月まで進めた状態（行動なし）。 */
  function untilEvent(stackIndex: number, id: string, sc: Scenario): GameState {
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(stackIndex, seed, sc);
      const x = g.schedule.find((y) => y.id === id);
      if (!x) continue;
      let s = playMonth(g);
      while (s.history.length < x.month && s.phase === 'playing')
        s = playMonth(s);
      if (s.phase === 'playing' && s.history.length === x.month) return s;
    }
    throw new Error(`${id} が起きるシードが無い`);
  }

  it.each([
    ['p-sla', 'article-community', CF_PAID],
    ['p-sla', 'article-community', VERCEL_PRO],
    ['c-p-sla', 'contract-operations', CF_PAID],
    ['c-p-sla', 'contract-operations', VERCEL_PRO],
  ] as const)(
    '%s（%s・構成 %i）は返事を待たず、断ったことになる',
    (id, _, stackIndex) => {
      const s = untilEvent(
        stackIndex,
        id,
        id === 'p-sla' ? ARTICLE_COMMUNITY : CONTRACT_OPERATIONS,
      );
      expect(s.pendingProposals).not.toContain(id);
      expect(s.responses[id]).toBe('declined');
      const e = last(s).events.find((x) => x.id === id)!;
      expect(e.phase).toBe('occurred');
      expect(e.unavailable).toBeDefined();
      expect(e.text).toContain(`今の構成では受けられません: ${e.unavailable}`);
      expect(e.accept).toBeUndefined();
      // 予告にも、受けられない見込みを添える
      const notice = s.history
        .flatMap((r) => r.events)
        .find((x) => x.id === id && x.phase === 'notice');
      if (notice) expect(notice.text).toContain('来ても受けられない見込みです');
    },
  );

  it.each([
    ['p-sla', ARTICLE_COMMUNITY],
    ['c-p-sla', CONTRACT_OPERATIONS],
  ] as const)('VPS 2GB の %s は今までどおり返事を待つ', (id, sc) => {
    const s = untilEvent(VPS, id, sc);
    expect(s.pendingProposals).toContain(id);
    expect(s.responses[id]).toBeUndefined();
    const e = last(s).events.find((x) => x.id === id)!;
    expect(e.phase).toBe('proposal');
    expect(e.unavailable).toBeUndefined();
    expect(e.accept).toBeDefined();
    const notice = s.history
      .flatMap((r) => r.events)
      .find((x) => x.id === id && x.phase === 'notice');
    if (notice)
      expect(notice.text).not.toContain('来ても受けられない見込みです');
  });
});
