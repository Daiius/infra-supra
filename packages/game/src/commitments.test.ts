// 確約（D-97・prd/07 §11.12）: 1 年の確約の割引・支払い・取り消せないこと・前払い・スケールアップの引き継ぎ。
// 金額そのものは期待値に書かず（実在の料金のため。prd/05 §1）、確約なしの同じプレイとの差で確かめる。
import { describe, expect, it } from 'vitest';
import {
  activeCommitments,
  applyAction,
  applyActions,
  checkAction,
  commitmentOffers,
  COMMITMENTS,
  commitmentLines,
  newGame,
  newSave,
  playMonth,
  replaySave,
  retryHintsOf,
  SCENARIOS,
  setupCommitments,
  STACKS,
  USD_JPY,
  withTurn,
  type GameState,
} from './index.ts';

const sc = SCENARIOS['article-community']!;
const idx = (id: string) => STACKS.find((s) => s.id === id)!.index;
const AWS = idx('aws-amplify');
const RDS_KEY = 'aws:rds-postgres-t4g-micro:reserved-instance';
const VPS2 = idx('sakura-vps-2gb');
const VPS4 = idx('sakura-vps-4gb');
const ANNUAL2 = 'sakura-vps:2gb-tokyo:annual';
const ANNUAL4 = 'sakura-vps:4gb-tokyo:annual';
const RUN = idx('gcp-cloud-run');
const CUD = 'gcp:cloud-run:flexible-cud';

const usdOf = (l: { amount: number; currency: string }) =>
  l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
const commitUsd = (s: GameState, month: number) =>
  s.history[month - 1]!.lines.filter((l) => l.kind === 'commitment').reduce(
    (a, l) => a + usdOf(l),
    0,
  );

/** 行動なしで最後まで回す（始めの確約つき）。 */
function playOut(
  stack: number,
  seed: number,
  components = {},
  commitments?: Parameters<typeof newGame>[8],
): GameState {
  let s = playMonth(
    newGame(
      stack,
      seed,
      sc,
      undefined,
      'nextjs',
      components,
      undefined,
      undefined,
      commitments,
    ),
  );
  while (s.phase === 'playing') s = playMonth(s);
  return s;
}

describe('確約（D-97）', () => {
  it('確約しなければ明細・費用は今までどおり（確約の行が無い）', () => {
    const s = playOut(AWS, 1, { db: 'rds' });
    for (const r of s.history) {
      expect(r.lines.some((l) => l.kind === 'commitment')).toBe(false);
      expect(r.commitmentNet).toBeUndefined();
      expect(r.commitmentEligible?.[RDS_KEY]).toBeGreaterThan(0);
    }
  });

  it('始める画面: 台数の予約は前払いなしだけ（全額前払い・さくらの年額は始めの所持金を超える）。時間あたりの額の確約は出ない', () => {
    const rds = setupCommitments(sc, AWS, 'nextjs', { db: 'rds' });
    expect(rds.map((o) => `${o.key}:${o.payment}`)).toEqual([
      `${RDS_KEY}:no-upfront`,
    ]);
    expect(setupCommitments(sc, AWS, 'nextjs', {})).toEqual([]);
    expect(setupCommitments(sc, VPS2, 'nextjs', {})).toEqual([]);
    expect(setupCommitments(sc, RUN, 'nextjs', { minInstances: '1' })).toEqual(
      [],
    );
  });

  it('RDS のリザーブドインスタンス（前払いなし）: 毎月、時間の料金を割り引き、確約の支払いを足す。差は確約の行の合計と一致する', () => {
    const base = playOut(AWS, 1, { db: 'rds' });
    const ri = playOut(AWS, 1, { db: 'rds' }, [
      { key: RDS_KEY, payment: 'no-upfront' },
    ]);
    expect(ri.history.length).toBe(base.history.length);
    for (const [i, r] of ri.history.entries()) {
      const net = commitUsd(ri, i + 1);
      expect(net).toBeLessThan(0);
      expect(r.commitmentNet).toBeCloseTo(-net, 9);
      expect(r.infraCost - base.history[i]!.infraCost).toBeCloseTo(net, 9);
    }
    expect(ri.cash).toBeGreaterThan(base.cash);
  });

  it('取り消せない: DB を差し替えて RDS を使わなくなっても、確約の支払いは残り、割引は無くなる', () => {
    let s = playMonth(
      newGame(
        AWS,
        1,
        sc,
        undefined,
        'nextjs',
        { db: 'rds' },
        undefined,
        undefined,
        [{ key: RDS_KEY, payment: 'no-upfront' }],
      ),
    );
    s = playMonth(
      applyAction(s, { type: 'component', slot: 'db', option: 'dynamodb' }),
    );
    while (s.componentSwap && s.phase === 'playing') s = playMonth(s);
    s = playMonth(s);
    const r = s.history[s.history.length - 1]!;
    expect(r.commitmentEligible?.[RDS_KEY]).toBeUndefined();
    const lines = r.lines.filter((l) => l.kind === 'commitment');
    expect(lines.length).toBe(1);
    expect(lines[0]!.amount).toBeGreaterThan(0);
  });

  it('来月からの確約: 対象の使用がある月だけ・結んだら同じ確約は選べない・前払いが所持金を超えると選べない', () => {
    let s = playMonth(newGame(AWS, 1, sc, undefined, 'nextjs', {}));
    expect(
      checkAction(s, { type: 'commit', key: RDS_KEY, payment: 'no-upfront' }),
    ).toMatchObject({ ok: false, reason: 'unavailable' });
    s = playMonth(newGame(AWS, 1, sc, undefined, 'nextjs', { db: 'rds' }));
    // 1 か月目の終わりの所持金では全額前払いに届かない
    expect(
      checkAction(s, { type: 'commit', key: RDS_KEY, payment: 'all-upfront' }),
    ).toMatchObject({ ok: false, reason: 'limit' });
    s = applyAction(s, { type: 'commit', key: RDS_KEY, payment: 'no-upfront' });
    expect(
      activeCommitments(s).map((c) => [c.key, c.startMonth, c.endMonth]),
    ).toEqual([[RDS_KEY, 2, 13]]);
    expect(
      checkAction(s, { type: 'commit', key: RDS_KEY, payment: 'all-upfront' }),
    ).toMatchObject({ ok: false, reason: 'same' });
  });

  it('全額前払いは、結んだ月に 1 年分のうちゲームの残りの月数の分を所持金から一度に引き、以後は時間の料金を払わない', () => {
    let s = playMonth(newGame(AWS, 2, sc, undefined, 'nextjs', { db: 'rds' }));
    while (
      s.phase === 'playing' &&
      !checkAction(s, { type: 'commit', key: RDS_KEY, payment: 'all-upfront' })
        .ok
    )
      s = playMonth(s);
    expect(s.phase).toBe('playing');
    const offer = commitmentOffers(s).find(
      (o) => o.key === RDS_KEY && o.payment === 'all-upfront',
    )!;
    const left = sc.months - s.history.length;
    expect(offer.months).toBe(Math.min(12, left));
    expect(offer.upfront).toBeCloseTo(
      (offer.upfrontYear * offer.months) / 12,
      9,
    );
    s = playMonth(
      applyAction(s, { type: 'commit', key: RDS_KEY, payment: 'all-upfront' }),
    );
    const first = s.history[s.history.length - 1]!;
    const paid = first.lines.filter(
      (l) => l.kind === 'commitment' && l.amount > 0,
    );
    expect(paid.map((l) => l.amount)).toEqual([offer.upfront]);
    if (s.phase === 'playing') {
      s = playMonth(s);
      const next = s.history[s.history.length - 1]!.lines.filter(
        (l) => l.kind === 'commitment',
      );
      expect(next.every((l) => l.amount < 0)).toBe(true);
    }
  });

  it('時間あたりの額の確約（Cloud Run の CUD）は今月の対象の額で結び、来月は確約の額までを割り引く', () => {
    let s = playMonth(
      newGame(RUN, 1, sc, undefined, 'nextjs', { minInstances: '1' }),
    );
    const spend = s.history[0]!.commitmentEligible![CUD]!;
    expect(spend).toBeGreaterThan(0);
    const offer = commitmentOffers(s).find((o) => o.key === CUD)!;
    expect(offer.covers).toBe(spend);
    s = playMonth(
      applyAction(s, { type: 'commit', key: CUD, payment: 'no-upfront' }),
    );
    const r = s.history[1]!;
    const credit = r.lines.find(
      (l) => l.kind === 'commitment' && l.amount < 0,
    )!;
    expect(-credit.amount).toBeCloseTo(
      Math.min(spend, r.commitmentEligible![CUD]!),
      9,
    );
  });

  it('さくらの年額: スケールアップすると上位のプランの年額から使っていない分を引いて払い、上位のプランの年額に引き継ぐ', () => {
    let s = playMonth(newGame(VPS2, 1, sc, undefined, 'nextjs', {}));
    while (
      s.phase === 'playing' &&
      !checkAction(s, { type: 'commit', key: ANNUAL2, payment: 'all-upfront' })
        .ok
    )
      s = playMonth(s);
    s = playMonth(
      applyAction(s, { type: 'commit', key: ANNUAL2, payment: 'all-upfront' }),
    );
    const old = activeCommitments(s).find((c) => c.key === ANNUAL2)!;
    const month = s.history.length;
    s = applyAction(s, { type: 'plan', stackIndex: VPS4 });
    const now = activeCommitments(s);
    expect(now.map((c) => c.key)).toEqual([ANNUAL4]);
    const next = now[0]!;
    const def4 = COMMITMENTS.find((d) => d.key === ANNUAL4)!;
    const year4 = def4.commitment.payments[0]!.upfront!;
    const left = sc.months - month;
    const usedEnd = old.startMonth + (old.months ?? 12) - 1;
    const unused = (old.upfront * (usedEnd - month)) / (old.months ?? 12);
    expect(next.startMonth).toBe(month + 1);
    expect(next.upfront).toBeCloseTo((year4 * left) / 12 - unused, 6);
    s = playMonth(s);
    const r = s.history[s.history.length - 1]!;
    // 4GB の基本料は年額で覆い、2GB の年額は終わっている
    expect(
      r.lines.filter((l) => l.kind === 'commitment').map((l) => l.label),
    ).toEqual([expect.stringContaining('4GB'), expect.stringContaining('4GB')]);
  });

  it('次のプレイへのヒント: 確約できた使用が続いて所持金が届かなかったら、確約の割引を補足に出す（受託 × AWS × RDS）', () => {
    const contract = SCENARIOS['contract-operations']!;
    let s = playMonth(
      newGame(AWS, 1, contract, undefined, 'nextjs', { db: 'rds' }),
    );
    while (s.phase === 'playing') s = playMonth(s);
    expect(s.end?.reason).toBe('goal');
    const hint = retryHintsOf(s).find((h) => h.kind === 'commitment');
    expect(hint?.what).toContain('リザーブドインスタンス');
    expect(hint?.next).toContain('取り消せず');
  });

  it('同じ月に年額を結んでスケールアップすると、払っていない 2GB の年額は差し引かず、4GB の年額を残りの月数の分だけ払う（OCL-17D1B88E）', () => {
    let s = playMonth(newGame(VPS2, 1, sc, undefined, 'nextjs', {}));
    while (s.phase === 'playing' && s.cash < 400) s = playMonth(s);
    expect(s.phase).toBe('playing');
    s = applyAction(s, {
      type: 'commit',
      key: ANNUAL2,
      payment: 'all-upfront',
    });
    s = applyAction(s, { type: 'plan', stackIndex: VPS4 });
    expect(s.stackIndex).toBe(VPS4);
    const def4 = COMMITMENTS.find((d) => d.key === ANNUAL4)!;
    const left = Math.min(12, sc.months - s.history.length);
    expect(activeCommitments(s).map((c) => [c.key, c.upfront])).toEqual([
      [ANNUAL4, (def4.commitment.payments[0]!.upfront! * left) / 12],
    ]);
    s = playMonth(s);
    const paid = s.history[s.history.length - 1]!.lines.filter(
      (l) => l.kind === 'commitment' && l.amount > 0,
    );
    expect(paid.map((l) => l.label)).toEqual([expect.stringContaining('4GB')]);
  });

  it('所持金の検査は、同じ月に選んだ前払いと年額のままのスケールアップの差額を合わせて見る（OCL-C32E39AF）', () => {
    let s = playMonth(newGame(AWS, 2, sc, undefined, 'nextjs', { db: 'rds' }));
    const au = {
      type: 'commit',
      key: RDS_KEY,
      payment: 'all-upfront',
    } as const;
    while (s.phase === 'playing' && !checkAction(s, au).ok) s = playMonth(s);
    expect(s.phase).toBe('playing');
    // 来月に払う前払いがすでに所持金を使っていれば、単独なら選べる前払いも選べない
    const reserved: GameState = {
      ...s,
      commitments: [
        {
          key: ANNUAL2,
          label: '年額',
          currency: 'USD',
          payment: 'all-upfront',
          startMonth: s.history.length + 1,
          endMonth: s.history.length + 12,
          covers: 1,
          monthly: 0,
          upfront: s.cash,
          months: 12,
        },
      ],
    };
    expect(checkAction(reserved, au)).toMatchObject({
      ok: false,
      reason: 'limit',
    });
    // 年額のまま 4GB へ: 差額が所持金より多いとプラン変更を選べない
    let v = playMonth(newGame(VPS2, 1, sc, undefined, 'nextjs', {}));
    const annual = {
      type: 'commit',
      key: ANNUAL2,
      payment: 'all-upfront',
    } as const;
    while (v.phase === 'playing' && !checkAction(v, annual).ok)
      v = playMonth(v);
    v = applyAction(v, annual);
    const poor: GameState = { ...v, cash: 1 };
    expect(checkAction(poor, { type: 'plan', stackIndex: VPS4 })).toMatchObject(
      { ok: false, reason: 'limit' },
    );
  });

  it('同じ対象に確約が 2 つあっても、割引の合計は対象の明細の額まで（OCL-A2DA7939）', () => {
    const c = {
      key: ANNUAL4,
      label: '年額',
      currency: 'JPY' as const,
      payment: 'all-upfront' as const,
      startMonth: 1,
      endMonth: 12,
      covers: 3_960,
      monthly: 0,
      upfront: 0,
      months: 12,
    };
    const lines = commitmentLines([c, { ...c }], { [ANNUAL4]: 3_960 }, 2);
    expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(-3_960);
  });

  it('保存: 始める画面の確約と月の確約の行動を再生すると同じ状態になる', () => {
    let save = newSave({
      scenarioId: sc.id,
      stackIndex: AWS,
      seed: 3,
      startDate: '2026-10-31',
      components: { db: 'rds' },
      commitments: [{ key: RDS_KEY, payment: 'no-upfront' }],
    });
    let s = replaySave(save);
    for (let i = 0; i < 3; i++) {
      save = withTurn(save, []);
      s = playMonth(applyActions(s, []));
    }
    expect(replaySave(save).cash).toBe(s.cash);
    expect(replaySave(save).commitments).toEqual(s.commitments);
  });
});
