// 記事コミュニティのシナリオと出来事の性質（prd/07 §10.3〜10.8・D-20）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyAction,
  BASELINES,
  BOT_BLOCK,
  newGame,
  playMonth,
  playStrategy,
  rollSchedule,
  surprisesOf,
  type Action,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const sc = ARTICLE_COMMUNITY;

/** 毎月の終わりに decide で行動を選び、month か月目まで進める。 */
function until(
  stackIndex: number,
  month: number,
  seed: number,
  decide: (s: GameState) => Action[] = () => [],
): GameState {
  let s = playMonth(newGame(stackIndex, seed));
  while (s.history.length < month && s.phase === 'playing') {
    let next = s;
    for (const a of decide(s)) next = applyAction(next, a);
    s = playMonth(next);
  }
  return s;
}
const acceptAll = (s: GameState): Action[] =>
  s.pendingProposals.map((eventId) => ({
    type: 'respond',
    eventId,
    accept: true,
  }));
const month = (s: GameState, m: number) => s.history[m - 1]!;
const at = (seed: number, id: string) =>
  rollSchedule(sc, seed).find((x) => x.id === id);

describe('シナリオのデータ', () => {
  it('満足度の重みの合計は 1', () => {
    const sum = Object.values(sc.satisfaction.weights).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeCloseTo(1);
  });

  it('1〜2 か月目は台本・提案を出さない（V-12）', () => {
    for (let seed = 1; seed <= 300; seed++)
      for (const x of rollSchedule(sc, seed)) {
        expect(x.month).toBeGreaterThanOrEqual(3);
        if (x.noticeMonth !== undefined)
          expect(x.noticeMonth).toBeGreaterThanOrEqual(3);
      }
  });

  it('詰まない: シード 1〜50 のどれでも、基準プレイの少なくとも 1 本が合格する', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const won = BASELINES.some((b) => playStrategy(b, seed).phase === 'won');
      expect(won, `seed ${seed}`).toBe(true);
    }
  });
});

describe('出来事（シード 42）', () => {
  it('話題の前の月に前兆（PV × 1.2）が出て、話題の月は PV × 3', () => {
    const buzz = at(42, 'buzz')!;
    const s = until(CF_PAID, buzz.month, 42);
    const notice = month(s, buzz.noticeMonth!);
    expect(
      notice.events.some((e) => e.id === 'buzz' && e.phase === 'notice'),
    ).toBe(true);
    expect(notice.humanPV / notice.basePV).toBeCloseTo(1.2);
    const b = month(s, buzz.month);
    expect(b.buzz).toBe(true);
    expect(b.humanPV / b.basePV).toBeCloseTo(3);
  });

  it('Bot は収益にならず 2 か月続く。遮断すると翌月から半分', () => {
    const bot = at(42, 'bot')!;
    const s = until(CF_PAID, bot.month + 1, 42);
    const m1 = month(s, bot.month);
    expect(m1.botPV).toBeCloseTo(m1.humanPV);
    expect(m1.revenue).toBeCloseTo(
      (m1.humanPV / 1000) * sc.revenue.adsUsdPer1000PV,
    );
    expect(month(s, bot.month + 1).botPV).toBeGreaterThan(0);
    const blocked = until(CF_PAID, bot.month + 1, 42, (st) =>
      st.history.length === bot.month ? [{ type: 'block-bots' }] : [],
    );
    const m2 = month(blocked, bot.month + 1);
    expect(m2.botPV / m2.humanPV).toBeCloseTo(BOT_BLOCK.remaining);
  });

  it('チームが増えると手間が増え、Vercel Pro は席の基本料が増える（Supabase は無制限）', () => {
    const team = at(42, 'team')!;
    const v = until(VERCEL_PRO, team.month, 42);
    expect(month(v, team.month).effort.total).toBe(20);
    expect(month(v, team.month).seats).toBe(1);
    const ev = month(v, team.month).events.find((e) => e.id === 'team')!;
    expect(ev.members!.join()).toContain('席');
    expect(ev.members!.join()).toContain('無制限');
    // 席の分（$20）だけ基本料が増える
    const fees = (m: number) =>
      month(v, m)
        .lines.filter((l) => l.label === 'vercel pro 基本料')
        .reduce((a, l) => a + l.amount, 0);
    expect(fees(team.month) - fees(team.month - 1)).toBeCloseTo(20);
  });

  it('料金データの施行日つきの予告が通知だけで出る（3・4 か月目）', () => {
    const s = until(VPS, 4, 42);
    expect(month(s, 3).events.some((e) => e.id.startsWith('calendar:'))).toBe(
      true,
    );
    expect(month(s, 4).events.some((e) => e.id.startsWith('calendar:'))).toBe(
      true,
    );
  });

  it('画像の提案を受けると、VPS のディスクがたまっていき、70% を超えた月に通知が出る', () => {
    const s = until(VPS, 12, 42, (st) =>
      st.pendingProposals.map((eventId) => ({
        type: 'respond',
        eventId,
        accept: eventId === 'p-images',
      })),
    );
    for (let m = 2; m <= 12; m++)
      expect(month(s, m).stock.imagesGB).toBeGreaterThan(
        month(s, m - 1).stock.imagesGB,
      );
    const fired = s.history.filter((r) =>
      r.events.some((e) => e.id === 's-image-storage'),
    );
    expect(fired).toHaveLength(1);
    const disk = fired[0]!.snapshots.find((p) =>
      p.id.startsWith('host:disk:'),
    )!;
    expect(disk.accumulates).toBe(true);
    expect(disk.ratio).toBeGreaterThanOrEqual(0.7);
  });

  it('見込みが外れた理由: Vercel Pro は話題の月に CDN Requests の込み分を超え、理由は話題', () => {
    const s = playStrategy(
      BASELINES.find((b) => b.id === 'vercel-pro')!,
      42,
    );
    const sp = surprisesOf(s);
    expect(sp).toHaveLength(1);
    expect(sp[0]!.premiseId).toBe('pool:vercel:pro:pro-cdn-requests');
    expect(sp[0]!.month).toBe(at(42, 'buzz')!.month);
    expect(sp[0]!.cause).toMatchObject({
      kind: 'event',
      title: 'SNS で話題になった！',
    });
  });
});

describe('まれな出来事（シード 3: 記事の引き取り → D1 の 10 GB）', () => {
  const archive = at(3, 'p-archive')!;

  it('予告が 1 か月前に出て、提案として来る', () => {
    const s = until(CF_PAID, archive.month, 3);
    expect(
      month(s, archive.month - 1).events.some(
        (e) => e.id === 'p-archive' && e.phase === 'notice',
      ),
    ).toBe(true);
    expect(s.pendingProposals).toContain('p-archive');
  });

  it('断れば何も変わらない', () => {
    const declined = until(CF_PAID, 12, 3);
    expect(declined.phase).toBe('won');
    expect(
      declined.history.some((r) => r.events.some((e) => e.id === 's-d1-limit')),
    ).toBe(false);
  });

  it('受けると D1 が 10 GB に近づいた通知が出て、乗り換えなければ止まる', () => {
    const s = until(CF_PAID, 12, 3, acceptAll);
    const notice = s.history.find((r) =>
      r.events.some((e) => e.id === 's-d1-limit'),
    )!;
    expect(notice.month).toBe(archive.month + 1);
    const d1 = notice.snapshots.find((p) =>
      p.id.startsWith('limit:cloudflare:workers-paid:d1-db-size'),
    )!;
    expect(d1.ratio).toBeGreaterThanOrEqual(0.7);
    expect(d1.ratio).toBeLessThan(1);
    expect(s.phase).toBe('lost');
    expect(s.end?.reason).toBe('outages');
  });
});
