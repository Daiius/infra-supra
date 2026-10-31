// 話題・Bot の予告の有無（D-28）。予告は 50%。無ければ今月起きて、対処は来月から。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  newGame,
  playMonth,
  rollSchedule,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const until = (months: number, seed: number): GameState => {
  let s = playMonth(newGame(CF_PAID, seed));
  while (s.history.length < months && s.phase === 'playing') s = playMonth(s);
  return s;
};
const eventIn = (s: GameState, month: number, id: string) =>
  s.history[month - 1]!.events.find(
    (e) => e.id === id && e.phase === 'occurred',
  )!;

describe('予告の有無（D-28）', () => {
  it('話題も Bot も、予告の有無はおよそ半分ずつ。月は予告の有無によらない', () => {
    const N = 1000;
    for (const id of ['buzz', 'bot']) {
      let noticed = 0;
      for (let seed = 1; seed <= N; seed++) {
        const x = rollSchedule(ARTICLE_COMMUNITY, seed).find(
          (e) => e.id === id,
        )!;
        if (x.noticeMonth !== undefined) {
          noticed++;
          expect(x.noticeMonth).toBe(x.month - 1);
          expect(x.noticeMonth).toBeGreaterThanOrEqual(3);
        }
      }
      expect(noticed / N).toBeGreaterThan(0.35);
      expect(noticed / N).toBeLessThan(0.6);
    }
  });

  it('予告なしで起きた月は、予告なしの文と印（announced: false）', () => {
    // シード 42 は話題も Bot も予告なし
    const g = newGame(CF_PAID, 42);
    const buzz = g.schedule.find((x) => x.id === 'buzz')!;
    expect(buzz.noticeMonth).toBeUndefined();
    const s = until(buzz.month, 42);
    const e = eventIn(s, buzz.month, 'buzz');
    expect(e.announced).toBe(false);
    expect(e.text).toContain('前兆はなかった');
    expect(s.history[buzz.month - 2]!.events.some((x) => x.id === 'buzz')).toBe(
      false,
    );
  });

  it('予告どおり起きた月は announced: true。Bot の前兆は収益にならない', () => {
    // シード 4 は Bot に予告がある（10 か月目に Bot・9 か月目に予告）
    const g = newGame(CF_PAID, 4);
    const bot = g.schedule.find((x) => x.id === 'bot')!;
    expect(bot.noticeMonth).toBe(bot.month - 1);
    const s = until(bot.month, 4);
    const notice = s.history[bot.noticeMonth! - 1]!;
    expect(
      notice.events.some((e) => e.id === 'bot' && e.phase === 'notice'),
    ).toBe(true);
    expect(notice.botPV).toBeGreaterThan(0);
    expect(eventIn(s, bot.month, 'bot').announced).toBe(true);
  });
});
