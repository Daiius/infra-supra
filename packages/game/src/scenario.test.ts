// 記事コミュニティのシナリオと出来事の性質（prd/07 §10.3〜10.8・D-20）。
import { describe, expect, it } from 'vitest';
import { parsePriceBook, type PriceBook } from 'estimator';
import {
  applyRevisions,
  ARTICLE_COMMUNITY,
  applyAction,
  BASELINES,
  BOT_BLOCK,
  newGame,
  playMonth,
  playStrategy,
  rollSchedule,
  SCENARIOS,
  SCHEDULED_CHANGES,
  STACKS,
  surprisesOf,
  upkeepOf,
  type Action,
  type GameState,
  EFFORT,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

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
  it('予告の見出しは、起きた出来事の見出しと違う（予告が起きたように読めない）', () => {
    for (const def of sc.events)
      if (def.notice) {
        expect(def.notice.title).not.toBe(def.title);
        expect(def.notice.title).toMatch(/そう$/);
      }
  });

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

  it('目標の決め方（D-64・prd/07 §10.8）: CF Paid と構成に合った対策の 3 構成はまれな出来事の無いシードで全部届き、Vercel Pro・何もしないと原本のまま配るは届かない', () => {
    const rare = new Set(
      sc.events.filter((e) => e.tier === 'rare').map((e) => e.id),
    );
    const baseline = (id: string) => BASELINES.find((b) => b.id === id)!;
    const originals = {
      id: 'cf-paid-originals',
      label: 'Cloudflare Paid・画像を原本のまま配る（D-47 の明らかな誤り）',
      stackIndex: CF_PAID,
      actions: [[{ type: 'component', slot: 'images', option: 'none' }]],
    } satisfies Parameters<typeof playStrategy>[0];
    for (let seed = 1; seed <= 50; seed++) {
      const won = (b: Parameters<typeof playStrategy>[0]) =>
        playStrategy(b, seed).phase === 'won';
      if (!rollSchedule(sc, seed).some((x) => rare.has(x.id)))
        for (const id of ['cf-paid', 'aws-amplify-cdn', 'aws-opennext-images'])
          expect(won(baseline(id)), `${id} seed ${seed}`).toBe(true);
      expect(won(baseline('vercel-pro')), `seed ${seed}`).toBe(false);
      expect(won(originals), `seed ${seed}`).toBe(false);
    }
  });
});

describe('出来事（シード 42。話題の予告はシード 4）', () => {
  it('話題の前の月に前兆（PV × 1.2）が出て、話題の月は PV × 3', () => {
    // シード 4 は話題に予告がある（D-28: 予告は 50%）
    const buzz = at(4, 'buzz')!;
    expect(buzz.noticeMonth).toBe(buzz.month - 1);
    const s = until(CF_PAID, buzz.month, 4);
    const notice = month(s, buzz.noticeMonth!);
    const n = notice.events.find(
      (e) => e.id === 'buzz' && e.phase === 'notice',
    )!;
    expect(n.title).toBe('SNS で話題になりそう');
    expect(
      month(s, buzz.month).events.find((e) => e.id === 'buzz')!.title,
    ).toBe('SNS で話題になった！');
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

  it('見込みが外れた理由: 受託の Vercel Pro は繁忙期の月に月のクレジットを超え、理由は繁忙期（シード 8。D-48）', () => {
    const s = playStrategy(
      CONTRACT_OPERATIONS.baselines.find((b) => b.id === 'vercel-pro')!,
      8,
      CONTRACT_OPERATIONS,
    );
    const sp = surprisesOf(s);
    expect(sp).toHaveLength(1);
    expect(sp[0]!.premiseId).toBe('credit:vercel:pro:usage-credit');
    expect(sp[0]!.month).toBe(
      rollSchedule(CONTRACT_OPERATIONS, 8).find((x) => x.id === 'c-busy')!
        .month,
    );
    expect(sp[0]!.cause).toMatchObject({
      kind: 'event',
      title: '繁忙期（年度末の締め）',
    });
  });
});

describe('実際に予告されている改定の出来事（D-21）', () => {
  const ids = SCHEDULED_CHANGES.map((c) => c.id);

  it('始めた日が施行日より前なら、3 か月目以降のシードで決まる月に出る', () => {
    const g = newGame(CF_PAID, 42, sc, '2026-10-31');
    expect(g.revisions.map((r) => r.id).sort()).toEqual([...ids].sort());
    const s = until(CF_PAID, 12, 42);
    for (const rv of g.revisions) {
      expect(rv.month).toBeGreaterThanOrEqual(3);
      const ev = month(s, rv.month).events.find((e) => e.id === rv.id)!;
      expect(ev.text).toContain('実際に予告されている改定');
      expect(ev.text).toContain('このモデルの計算への影響: なし');
      expect(ev.text).not.toContain('料金と制限は変わる');
    }
  });

  it('施行日を過ぎた日に始めると出ない。その間の日なら、まだ先の予告だけが出る', () => {
    expect(newGame(CF_PAID, 42, sc, '2026-12-01').revisions).toEqual([]);
    expect(
      newGame(CF_PAID, 42, sc, '2026-11-10').revisions.map((r) => r.id),
    ).toEqual(['revision:cloudflare:2026-12-01']);
  });

  it('改定後の料金が無い予告は計算を変えない（施行日の後に始めたゲームと同じ結果）', () => {
    for (const b of BASELINES) {
      const before = playStrategy(b, 42, sc, '2026-10-31');
      const after = playStrategy(b, 42, sc, '2027-01-01');
      expect(before.cash).toBe(after.cash);
      expect(before.history.map((r) => r.infraCost)).toEqual(
        after.history.map((r) => r.infraCost),
      );
    }
  });

  it('同じシード・同じ開始日なら同じ結果', () => {
    const a = playStrategy(BASELINES[0]!, 7, sc, '2026-10-31');
    const b = playStrategy(BASELINES[0]!, 7, sc, '2026-10-31');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('改定後の料金を持つ予告は、起きた月からそのメーターの料金を差し替える（架空のデータで確かめる）', () => {
    const book = parsePriceBook(
      {
        schemaVersion: 1,
        provider: 'fictional-host',
        version: '2000-01-01',
        status: 'fictional',
        currency: 'USD',
        taxIncluded: false,
        retrievedAt: '2000-01-01',
        plans: [
          {
            id: 'plan',
            service: 'svc',
            name: 'Plan',
            meters: [
              {
                id: 'requests',
                resource: 'requests',
                unit: 'request',
                pricing: { model: 'flat', per: 1, unitPrice: 1 },
              },
            ],
          },
        ],
      },
      { allowFictional: true },
    );
    const change = {
      id: 'revision:fictional-host:2000-02-01',
      provider: 'fictional-host',
      effectiveFrom: '2000-02-01',
      description: '架空の値上げ',
      kind: 'pricing' as const,
      revisedMeters: [
        {
          planId: 'plan',
          meterId: 'requests',
          pricing: { model: 'flat' as const, per: 1, unitPrice: 2 },
        },
      ],
      sourceIds: [],
    };
    const price = (bs: PriceBook[]) => {
      const p = bs[0]!.plans[0]!.meters[0]!.pricing;
      return p.model === 'flat' ? p.unitPrice : NaN;
    };
    const rv = [{ id: change.id, month: 5 }];
    expect(price(applyRevisions([book], [change], rv, 4))).toBe(1);
    expect(price(applyRevisions([book], [change], rv, 5))).toBe(2);
    expect(price(applyRevisions([book], [change], [], 12))).toBe(1);

    // 同じメーターの改定が 2 つあれば、後に起きたほうで上書きする（並び順によらない）
    const later = {
      ...change,
      id: 'revision:fictional-host:2000-06-01',
      effectiveFrom: '2000-06-01',
      revisedMeters: [
        {
          planId: 'plan',
          meterId: 'requests',
          pricing: { model: 'flat' as const, per: 1, unitPrice: 3 },
        },
      ],
    };
    const both = [
      { id: change.id, month: 3 },
      { id: later.id, month: 6 },
    ];
    for (const changes of [
      [change, later],
      [later, change],
    ]) {
      expect(price(applyRevisions([book], changes, both, 5))).toBe(2);
      expect(price(applyRevisions([book], changes, both, 6))).toBe(3);
      expect(price(applyRevisions([book], changes, both, 12))).toBe(3);
    }
  });
});

// まれな出来事の候補に SLA の打診（p-sla）を足したので、記事の引き取りが起きるシードは 3 から 11 に変わった（D-24）
const ARCHIVE_SEED = 31;

describe('まれな出来事（シード 31: 記事の引き取り → D1 の 10 GB）', () => {
  const archive = at(ARCHIVE_SEED, 'p-archive')!;

  it('予告が 1 か月前に出て、提案として来る', () => {
    const s = until(CF_PAID, archive.month, ARCHIVE_SEED);
    const n = month(s, archive.month - 1).events.find(
      (e) => e.id === 'p-archive' && e.phase === 'notice',
    )!;
    expect(n.title).toBe('記事の引き取りの打診が来そう');
    expect(s.pendingProposals).toContain('p-archive');
  });

  it('断れば何も変わらない', () => {
    const declined = until(CF_PAID, 12, ARCHIVE_SEED);
    expect(declined.phase).toBe('won');
    expect(
      declined.history.some((r) => r.events.some((e) => e.id === 's-d1-limit')),
    ).toBe(false);
  });

  it('受けると D1 が 10 GB に近づいた通知が出て、乗り換えなければ止まる', () => {
    const s = until(CF_PAID, 12, ARCHIVE_SEED, acceptAll);
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

describe('構成ごとの維持の手間（始める画面の手間のバー。D-36）', () => {
  it('自前運用の構成はシナリオの維持の手間、自分で組む構成は EFFORT.assembledUpkeep がかかり、1 か月目の配分と一致する（D-63）', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      for (const st of STACKS) {
        const u = upkeepOf(scenario, st.index);
        expect(u).toBe(
          st.selfHosted
            ? scenario.effort.selfHostedUpkeep
            : st.assembled
              ? EFFORT.assembledUpkeep
              : 0,
        );
        const s = playMonth(newGame(st.index, 42, scenario));
        expect(s.history[0]!.effort.upkeep).toBe(u);
      }
    }
  });
});
