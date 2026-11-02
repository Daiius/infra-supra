// DB のバックアップ・PITR（D-93・prd/09 §3.2・prd/11 §19）。要件 db-pitr・部品の手間・受託の依頼の性質。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  applyActions,
  componentSlots,
  DEFAULT_START_DATE,
  EFFORT,
  meetsRequirement,
  newGame,
  playMonth,
  requirementReachable,
  requirementStatus,
  rollSchedule,
  STACKS,
  upkeepOf,
  type GameState,
} from './index.ts';
import { CONTRACT_OPERATIONS as sc } from './scenarios/contract-operations.ts';

const at = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_PAID = at('cloudflare-vinext-paid');
const VERCEL_HOBBY = at('vercel-supabase-hobby');
const VERCEL_PRO = at('vercel-supabase-pro');
const VPS = at('sakura-vps-2gb');
const AWS = at('aws-amplify');

describe('要件「直近 7 日の任意の時点に戻せる」（db-pitr）', () => {
  it('D1 は既定で満たし、Supabase Pro・DynamoDB・VPS は部品で満たす。Hobby はプラン変更で満たせる', () => {
    expect(meetsRequirement(CF_PAID, 'db-pitr')).toBe(true);
    expect(meetsRequirement(CF_PAID, 'db-pitr', { db: 'kv' })).toBe(false);
    for (const i of [VERCEL_PRO, AWS, VPS]) {
      expect(meetsRequirement(i, 'db-pitr')).toBe(false);
      expect(meetsRequirement(i, 'db-pitr', { dbBackup: 'pitr' })).toBe(true);
      expect(requirementReachable(i, 'db-pitr')).toBe(true);
    }
    expect(
      meetsRequirement(VERCEL_HOBBY, 'db-pitr', { dbBackup: 'pitr' }),
    ).toBe(false);
    expect(requirementReachable(VERCEL_HOBBY, 'db-pitr')).toBe(true);
    expect(
      meetsRequirement(AWS, 'db-pitr', { db: 'dsql', dbBackup: 'pitr' }),
    ).toBe(false);
  });

  it('カードには DB のバックアップの選択肢ごとに満たせるかを出す', () => {
    const st = requirementStatus(VERCEL_PRO, {}, 'db-pitr');
    expect(st.map((x) => [x.ok, x.current])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('既定で足りる D1 ではスロットを出さず、VPS では出す', () => {
    const slots = (i: number) =>
      componentSlots(playMonth(newGame(i, 42, sc, DEFAULT_START_DATE))).map(
        (x) => x.slot,
      );
    expect(slots(CF_PAID)).not.toContain('dbBackup');
    expect(slots(VPS)).toContain('dbBackup');
    expect(slots(VERCEL_PRO)).toContain('dbBackup');
  });

  it('VPS の自前のバックアップは仕組みを作る手間と毎月の維持がかかり、マネージドの DB は設定だけ', () => {
    const s = playMonth(newGame(VPS, 42, sc, DEFAULT_START_DATE));
    const act = {
      type: 'component',
      slot: 'dbBackup',
      option: 'pitr',
    } as const;
    expect(actionEffort(s, act)).toBe(EFFORT.selfBackup.setup);
    expect(upkeepOf(sc, VPS, { dbBackup: 'pitr' })).toBe(
      sc.effort.selfHostedUpkeep + EFFORT.selfBackup.upkeep,
    );
    const p = playMonth(newGame(VERCEL_PRO, 42, sc, DEFAULT_START_DATE));
    expect(actionEffort(p, act)).toBe(EFFORT.component.dbBackup);
    expect(upkeepOf(sc, VERCEL_PRO, { dbBackup: 'pitr' })).toBe(0);
  });
});

describe('受託の依頼（c-p-backup）', () => {
  const seed = Array.from({ length: 50 }, (_, i) => i + 1).find((x) =>
    rollSchedule(sc, x).some((e) => e.id === 'c-p-backup'),
  )!;
  const month = rollSchedule(sc, seed).find(
    (e) => e.id === 'c-p-backup',
  )!.month;

  it('窓の出来事で、約半分のシードで起き、他の出来事の月を変えない', () => {
    const n = Array.from({ length: 200 }, (_, i) => i + 1).filter((x) =>
      rollSchedule(sc, x).some((e) => e.id === 'c-p-backup'),
    ).length;
    expect(n).toBeGreaterThan(70);
    expect(n).toBeLessThan(130);
    expect(month).toBeGreaterThanOrEqual(3);
    expect(month).toBeLessThanOrEqual(10);
  });

  const play = (stackIndex: number): GameState => {
    let s = playMonth(newGame(stackIndex, seed, sc, DEFAULT_START_DATE));
    while (s.phase === 'playing')
      s = playMonth(
        applyActions(
          s,
          s.pendingProposals.map((eventId) => ({
            type: 'respond' as const,
            eventId,
            accept: eventId === 'c-p-backup',
          })),
        ),
      );
    return s;
  };

  it('受けると、満たす構成（D1）の月だけ契約の上乗せが入り、満たさない構成（Supabase Pro の既定）では入らない', () => {
    const cf = play(CF_PAID);
    const paid = cf.history.filter((h) => h.contractRevenue > 0);
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((h) => h.contractRevenue === 20)).toBe(true);
    const pro = play(VERCEL_PRO);
    expect(pro.history.every((h) => h.contractRevenue === 0)).toBe(true);
    expect(
      pro.history.some((h) =>
        h.notes.some((n) => n.includes('契約の収益が入らなかった')),
      ),
    ).toBe(true);
  });
});
