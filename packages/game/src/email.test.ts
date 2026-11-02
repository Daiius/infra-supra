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
  estimateComponents,
  estimateWorkload,
  scenarioSendsEmail,
  setupSlots,
  STACKS,
} from './index.ts';
import type { Scenario } from './scenario.ts';

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

  it('Resend Free は受託の規模で 1 日 100 通に当たって止まり、SES・Email Service は止まらない', () => {
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
    expect(free.status).toBe('down');
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
