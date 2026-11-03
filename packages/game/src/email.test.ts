// メール送信（D-95・prd/11 §20）をゲームで選べること。既定は Cloudflare Paid が Email Service・ほかは SES、
// Resend Free は 1 日 100 通で止まる。アカウントの手間（D-52）は構成の既定より増えた分だけ。
import { describe, expect, it } from 'vitest';
import {
  composeStack,
  loadPriceBooks,
  STACK_DEFS,
  withoutUnusedEmail,
} from 'catalog';
import { estimate, type WorkloadInput } from 'estimator';
import {
  addedAccounts,
  ARTICLE_COMMUNITY,
  checkAction,
  componentEffortLabel,
  componentFlavor,
  DEFAULT_START_DATE,
  meetsRequirement,
  newGame,
  playMonth,
  SCENARIOS,
  EMAIL_UNDELIVERED,
  estimateComponents,
  estimateWorkload,
  judgeStages,
  retryHintsOf,
  scenarioOffscreen,
  scenarioSendsEmail,
  setupMonthOneEstimate,
  setupSlots,
  STACKS,
} from './index.ts';
import type { Scenario } from './scenario.ts';
import { rollSchedule } from './scenario.ts';
import { workloadFor } from './workload.ts';
import { undeliveredShare } from './month/satisfaction.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_PAID = idx('cloudflare-vinext-paid');
const GCP = idx('gcp-cloud-run');
const VPS_4GB = idx('sakura-vps-4gb');
const contract = SCENARIOS['contract-operations']!;

describe('メール送信（D-95）', () => {
  it('始める画面で選び、どの選択肢にも説明がある', () => {
    for (const sc of [ARTICLE_COMMUNITY, contract])
      for (let i = 0; i < STACKS.length; i++) {
        const slot = setupSlots(sc, i, 'nextjs').find(
          (x) => x.slot === 'email',
        );
        expect(slot, STACKS[i]!.id).toBeDefined();
        expect(slot!.options[0]!.id).toBe('default');
        for (const o of slot!.options)
          expect(componentFlavor(o), `${STACKS[i]!.id} ${o.id}`).toBeDefined();
      }
  });

  it('既定の送り先はアカウントを増やさず、替えると増える（D-52）', () => {
    expect(addedAccounts(GCP)).toEqual([]);
    expect(addedAccounts(GCP, { email: 'resend-pro' })).toEqual(['resend']);
    expect(addedAccounts(CF_PAID, { email: 'ses' })).toEqual(['aws']);
    const s = playMonth(newGame(CF_PAID, 1, contract, DEFAULT_START_DATE));
    const a = {
      type: 'component',
      slot: 'email',
      option: 'resend-pro',
    } as const;
    expect(checkAction(s, a).ok).toBe(true);
    expect(componentEffortLabel('email', s, 'resend-pro').join(' ')).toContain(
      'Resend',
    );
  });

  it('SLA の要件はメールの送り先を見ない（VPS 4GB は Resend に替えても満たす）', () => {
    expect(meetsRequirement(VPS_4GB, 'uptime-sla')).toBe(true);
    expect(
      meetsRequirement(VPS_4GB, 'uptime-sla', { email: 'resend-pro' }),
    ).toBe(true);
  });

  it('Resend Free は受託の規模で 1 日 100 通に当たって送れなくなり（サイトは止まらない。D-117）、SES・Email Service は当たらない', () => {
    const first = (stack: number, email?: string) =>
      playMonth(
        newGame(
          stack,
          1,
          contract,
          DEFAULT_START_DATE,
          'nextjs',
          email ? { email } : {},
        ),
      ).history[0]!;
    const free = first(GCP, 'resend-free');
    expect(
      free.premises.find((p) => p.id === 'pool:resend:free:free-daily'),
    ).toMatchObject({ hit: true, effect: 'block' });
    expect(free.status).toBe('ok');
    expect(free.satisfaction.stages.feature).not.toBe('good');
    expect(first(GCP).status).toBe('ok');
    expect(first(CF_PAID).status).toBe('ok');
    expect(
      first(CF_PAID).lines.some((l) => l.meterId === 'email-sending'),
    ).toBe(true);
  });
});

// D-101: メールを送らないシナリオ（テンプレートに email が無い）では、部品「メール送信」も送信の費用・前提も出さない
describe('メールを送らないシナリオ（D-101）', () => {
  const noEmail = (sc: Scenario): Scenario => ({
    ...sc,
    id: `${sc.id}-no-email`,
    template: (pv: number) => {
      const { email: _, ...w } = sc.template(pv);
      return w as WorkloadInput;
    },
  });
  const mailLine = (l: { label: string; provider?: string }) =>
    l.label.startsWith('メールの送信') || l.provider === 'resend';

  it('今の 2 つのシナリオはメールを送る（部品も明細も出る）', () => {
    for (const sc of [ARTICLE_COMMUNITY, contract]) {
      expect(scenarioSendsEmail(sc)).toBe(true);
      const m = playMonth(newGame(CF_PAID, 1, sc, DEFAULT_START_DATE))
        .history[0]!;
      expect(m.lines.some(mailLine)).toBe(true);
    }
  });

  it('始める画面・ゲームの部品にメール送信が出ず、月の明細・前提にも出ない（Resend を指定しても）', () => {
    for (const base of [ARTICLE_COMMUNITY, contract]) {
      const sc = noEmail(base);
      expect(scenarioSendsEmail(sc)).toBe(false);
      for (const i of [CF_PAID, GCP, VPS_4GB]) {
        expect(
          setupSlots(sc, i, 'nextjs').some((x) => x.slot === 'email'),
          STACKS[i]!.id,
        ).toBe(false);
        const s = playMonth(
          newGame(i, 1, sc, DEFAULT_START_DATE, 'nextjs', {
            email: 'resend-pro',
          }),
        );
        expect(s.components.email).not.toBe('resend-pro');
        const m = s.history[0]!;
        expect(m.lines.some(mailLine), STACKS[i]!.id).toBe(false);
        expect(
          m.premises.some((p) => /email|resend/.test(p.id)),
          STACKS[i]!.id,
        ).toBe(false);
      }
    }
  });

  it('見積モードの組み立て（部品・構成）でも出ない', () => {
    const sc = noEmail(ARTICLE_COMMUNITY);
    const { components } = estimateComponents(sc, GCP, 'nextjs', {
      email: 'resend-pro',
    });
    expect(components.email).not.toBe('resend-pro');
    const workload = estimateWorkload(sc, {
      pv: sc.scale.startPV,
      stackIndex: GCP,
      framework: 'nextjs',
      components,
      settings: { imageKB: 150, variants: 3, revalidateSec: 300 },
    });
    // 見積モードの画面（web の model.ts）と同じ組み立て: 構成を組んでから送信のノードを外す
    const forced = composeStack(STACK_DEFS[GCP]!, { email: 'resend-pro' });
    const architecture = withoutUnusedEmail(forced, workload);
    expect(
      architecture.nodes.some((n) => n.config.kind === 'email-sender'),
    ).toBe(false);
    const r = estimate({ workload, architecture, books: loadPriceBooks() });
    expect(
      r.bill.lines.some(
        (l) => l.nodeIds.includes('email') || l.accountId === 'resend',
      ),
    ).toBe(false);
    // 送るシナリオではノードを外さない
    expect(
      withoutUnusedEmail(forced, ARTICLE_COMMUNITY.template(1)).nodes,
    ).toEqual(forced.nodes);
  });
});

// D-117: メールの送信の上限に当たってもサイトは止まらず、届かないメールの分だけ機能の満足度を下げる。話題の日は登録の確認が集中する
describe('メールの送信の上限とメールが届かない月（D-117）', () => {
  const play = (sc: Scenario, stack: number, seed: number, email?: string) => {
    let s = newGame(
      stack,
      seed,
      sc,
      DEFAULT_START_DATE,
      'nextjs',
      email ? { email } : {},
    );
    while (s.phase === 'playing') s = playMonth(s);
    return s;
  };
  const freeDaily = (r: {
    premises: { id: string; hit: boolean; ratio?: number }[];
  }) => r.premises.find((p) => p.id === 'pool:resend:free:free-daily');

  it('Resend Free の 1 日の上限に当たった月は止まった月に数えず、収益も減らさない。機能を下げ、理由に届かない割合を書く', () => {
    const s = play(ARTICLE_COMMUNITY, CF_PAID, 42, 'resend-free');
    const ses = play(ARTICLE_COMMUNITY, CF_PAID, 42, 'ses');
    expect(s.outages).toBe(0);
    expect(s.history.every((r) => r.status !== 'down')).toBe(true);
    const m1 = s.history[0]!;
    expect(freeDaily(m1)).toMatchObject({ hit: true });
    // 1 か月目は人の流量が同じなので、収益も同じ（止まった月の減りが掛からない）
    expect(m1.revenue).toBeCloseTo(ses.history[0]!.revenue);
    expect(m1.satisfaction.stages.feature).toBe('fair');
    expect(ses.history[0]!.satisfaction.stages.feature).toBe('good');
    expect(m1.satisfaction.reasons.feature).toContain('届かない日があった');
    expect(m1.satisfaction.reasons.feature).toMatch(/約 \d+% が届かない/);
    expect(m1.notes.join(' ')).toContain('サイトは動いている');
  });

  it('判定の日のメールの半分以上が届かない月は機能が「悪い」、それ未満は 1 段下げる（ゲーム上の仮定）', () => {
    expect(EMAIL_UNDELIVERED.badShare).toBe(0.5);
    expect(undeliveredShare([{ ratio: 1.25 }])).toBeCloseTo(0.2);
    expect(undeliveredShare([{ ratio: 0.9 }])).toBe(0);
    expect(undeliveredShare([{}])).toBe(1);
    const base = {
      blocked: false,
      degraded: false,
      ssrCpuMs: 5,
      imageKB: 100,
      variants: 3,
      revalidateSec: 60,
      featurePoints: 100,
      month: 1,
      premises: [],
    };
    expect(judgeStages(base).feature).toBe('good');
    expect(judgeStages({ ...base, emailUndeliveredShare: 0.2 }).feature).toBe(
      'fair',
    );
    expect(judgeStages({ ...base, emailUndeliveredShare: 0.5 }).feature).toBe(
      'bad',
    );
  });

  it('話題の月は登録の確認が話題の日に集中し、上限のある仕組みは大きく超える。上限の大きい仕組み（SES・Resend Pro）は当たらない', () => {
    const seed = 42;
    const buzz = rollSchedule(ARTICLE_COMMUNITY, seed).find(
      (x) => x.id === 'buzz',
    )!;
    const free = play(ARTICLE_COMMUNITY, CF_PAID, seed, 'resend-free');
    const at = free.history[buzz.month - 1]!;
    const before = free.history[buzz.month - 2]!;
    expect(freeDaily(at)!.ratio!).toBeGreaterThan(
      freeDaily(before)!.ratio! * 5,
    );
    expect(at.satisfaction.stages.feature).toBe('bad');
    // 話題の出来事に送信の上限の前提が出る
    const ev = at.events.find((e) => e.id === 'buzz')!;
    expect(
      ev.premises.some((p) => p.id === 'pool:resend:free:free-daily'),
    ).toBe(true);
    for (const email of ['ses', 'resend-pro', undefined]) {
      const r = play(ARTICLE_COMMUNITY, CF_PAID, seed, email).history[
        buzz.month - 1
      ]!;
      expect(r.satisfaction.stages.feature, String(email)).toBe('good');
    }
  });

  it('Bot の PV はメールの通数に数えない（通数・最も多い日とも人の流量だけ）', () => {
    const st = newGame(CF_PAID, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE);
    const parts = {
      pv: 1_000_000,
      settings: st.settings,
      ssrCpuMs: 15,
      mods: st.mods,
      stock: null,
      platform: 'cloudflare' as const,
      components: {},
      framework: 'nextjs' as const,
    };
    const human = workloadFor(ARTICLE_COMMUNITY, parts).email!;
    const withBot = workloadFor(ARTICLE_COMMUNITY, {
      ...parts,
      botPV: 500_000,
      spikes: [{ id: 'bot', extraPV: 500_000, days: 7, bot: true }],
    }).email!;
    expect(withBot.perMau).toBeCloseTo(human.perMau / 2);
    expect(withBot.perWrite).toBeCloseTo(human.perWrite / 2);
    expect(withBot.peakDayFactor).toBe(1);
    // Bot の無い月は今までどおり（流量の集中と同じ最も多い日）
    expect(human.peakDayFactor).toBeUndefined();
  });

  it('始める画面の 1 か月目の見込み: メールの上限は止まる前提に入れず、収益を減らさない', () => {
    const free = setupMonthOneEstimate(contract, GCP, 'nextjs', {
      email: 'resend-free',
    });
    const ses = setupMonthOneEstimate(contract, GCP, 'nextjs', {
      email: 'ses',
    });
    expect(free.undelivered.map((x) => x.id)).toEqual([
      'pool:resend:free:free-daily',
    ]);
    expect(free.blocking.some((x) => x.id.includes('resend'))).toBe(false);
    expect(free.revenueUsd).toBeCloseTo(ses.revenueUsd);
    expect(ses.undelivered).toEqual([]);
  });

  it('届かなかった月のある未達のプレイには、送信の仕組みのヒントが出る', () => {
    const s = play(contract, CF_PAID, 1, 'resend-free');
    expect(s.phase).toBe('lost');
    const hint = retryHintsOf(s).find((h) => h.kind === 'email');
    expect(hint?.what).toContain('Resend Free');
    expect(retryHintsOf(s).some((h) => h.kind === 'limit')).toBe(false);
    // 機能開発は期待に届いているので、手間の不足のヒントは出さない（OCL-7F0F6051）
    expect(
      s.history.every(
        (r) =>
          r.featurePoints /
            (contract.satisfaction.feature.expectedPerMonth * r.month) >=
          contract.satisfaction.feature.good,
      ),
    ).toBe(true);
    expect(
      retryHintsOf(s).some(
        (h) => h.kind === 'element' && h.what.startsWith('機能'),
      ),
    ).toBe(false);
  });

  it('見取り図の脇のメールのカードは、メールを送るシナリオだけに出る', () => {
    for (const sc of [ARTICLE_COMMUNITY, contract]) {
      const cards = scenarioOffscreen(sc);
      expect(cards.map((c) => c.kind)).toEqual(['email']);
      expect(cards[0]!.items.length).toBeGreaterThan(0);
    }
    const noEmail: Scenario = {
      ...ARTICLE_COMMUNITY,
      template: (pv: number) => {
        const { email: _, ...w } = ARTICLE_COMMUNITY.template(pv);
        return w as WorkloadInput;
      },
    };
    expect(scenarioOffscreen(noEmail)).toEqual([]);
  });
});
