// 話題・Bot の予告の有無（D-28）。予告は 50%。無ければ今月起きて、対処は来月から。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  ARTICLE_COMMUNITY,
  BOT_BLOCK,
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

describe('Bot を遮断済みなら、Bot の出来事の文を遮断済みの文に替える（2026-11-04）', () => {
  const bot = ARTICLE_COMMUNITY.events.find((e) => e.id === 'bot')!;
  // blockAt: この月数を終えた後に遮断する（0 は 1 か月目の前）
  const play = (months: number, seed: number, blockAt?: number) => {
    let s = newGame(CF_PAID, seed);
    while (s.history.length < months && s.phase === 'playing') {
      if (s.history.length === blockAt)
        s = applyActions(s, [{ type: 'block-bots' }]);
      s = playMonth(s);
    }
    return s;
  };
  const textIn = (s: GameState, month: number, phase: string) =>
    s.history[month - 1]!.events.find(
      (e) => e.id === 'bot' && e.phase === phase,
    )!.text;

  it('予告なしで起きた月: 遮断済みなら遮断済みの文と注記、未遮断なら従来の文', () => {
    // シード 42 は Bot に予告がない
    const m = newGame(CF_PAID, 42).schedule.find((x) => x.id === 'bot')!.month;
    const open = play(m, 42);
    const blocked = play(m, 42, 1);
    expect(blocked.botBlocked).toBe(true);
    expect(textIn(open, m, 'occurred')).toBe(bot.surpriseText);
    expect(textIn(blocked, m, 'occurred')).toBe(bot.blockedSurpriseText);
    expect(open.history[m - 1]!.trafficNote).not.toContain('遮断で半分');
    expect(blocked.history[m - 1]!.trafficNote).toContain(
      '（Bot は収益にならない・遮断で半分）',
    );
    // 効果の要約は実際の倍率と遮断の印（未遮断は従来の × 2）
    const ev = (s: GameState) =>
      s.history[m - 1]!.events.find(
        (e) => e.id === 'bot' && e.phase === 'occurred',
      )!;
    expect(ev(blocked).effects).toEqual([
      'Bot のPV × 1.5（遮断で半分・2 か月・収益なし）',
    ]);
    expect(ev(blocked).botBlocked).toBe(true);
    expect(ev(open).effects).toEqual(['Bot のPV × 2（2 か月・収益なし）']);
    expect(ev(open).botBlocked).toBeUndefined();
    // 計算は従来どおり（遮断すれば上乗せは半分）
    const r = (s: GameState) =>
      s.history[m - 1]!.botPV / s.history[m - 1]!.humanPV;
    expect(r(blocked) / r(open)).toBeCloseTo(BOT_BLOCK.remaining);
  });

  it('予告どおり起きた月: 予告の前に遮断していれば予告も本文も遮断済みの文', () => {
    // シード 4 は Bot に予告がある
    const x = newGame(CF_PAID, 4).schedule.find((e) => e.id === 'bot')!;
    const s = play(x.month, 4, x.noticeMonth! - 1);
    expect(textIn(s, x.noticeMonth!, 'notice')).toBe(bot.notice!.blockedText);
    expect(textIn(s, x.month, 'occurred')).toBe(bot.blockedText);
    // 予告にも起きた月にも遮断済みの印（画面は「🛡 対策済み」を添える）
    const flag = (st: GameState, month: number, phase: string) =>
      st.history[month - 1]!.events.find(
        (e) => e.id === 'bot' && e.phase === phase,
      )!.botBlocked;
    expect(flag(s, x.noticeMonth!, 'notice')).toBe(true);
    expect(flag(s, x.month, 'occurred')).toBe(true);
    const open = play(x.month, 4);
    expect(textIn(open, x.noticeMonth!, 'notice')).toBe(bot.notice!.text);
    expect(textIn(open, x.month, 'occurred')).toBe(bot.text);
    expect(flag(open, x.noticeMonth!, 'notice')).toBeUndefined();
    expect(flag(open, x.month, 'occurred')).toBeUndefined();
  });

  it('遮断した月より前の報告の文は変わらない（報告はその月の状態で作る）', () => {
    const x = newGame(CF_PAID, 4).schedule.find((e) => e.id === 'bot')!;
    // 予告を見てから遮断: 予告の月の文は従来のまま、起きた月は遮断済み
    const s = play(x.month, 4, x.noticeMonth!);
    expect(textIn(s, x.noticeMonth!, 'notice')).toBe(bot.notice!.text);
    expect(textIn(s, x.month, 'occurred')).toBe(bot.blockedText);
    // 起きた後に遮断: 起きた月の文と注記は従来のまま、翌月の注記は遮断済み
    const late = play(x.month + 1, 4, x.month);
    expect(late.botBlocked).toBe(true);
    expect(textIn(late, x.month, 'occurred')).toBe(bot.text);
    const lateEv = late.history[x.month - 1]!.events.find(
      (e) => e.id === 'bot' && e.phase === 'occurred',
    )!;
    expect(lateEv.botBlocked).toBeUndefined();
    expect(lateEv.effects).toEqual(['Bot のPV × 2（2 か月・収益なし）']);
    expect(late.history[x.month - 1]!.trafficNote).not.toContain('遮断');
    expect(late.history[x.month]!.trafficNote).toContain('遮断で半分');
  });
});
