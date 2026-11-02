// メール送信（D-95・prd/11 §20）をゲームで選べること。既定は Cloudflare Paid が Email Service・ほかは SES、
// Resend Free は 1 日 100 通で止まる。アカウントの手間（D-52）は構成の既定より増えた分だけ。
import { describe, expect, it } from 'vitest';
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
  setupSlots,
  STACKS,
} from './index.ts';

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
