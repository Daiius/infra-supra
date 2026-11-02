// アプリのメールの送信（D-95・prd/11 §20）。構成の既定の送り先・選択肢・料金の数え方。
import { describe, expect, it } from 'vitest';
import { estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { businessApp } from '../templates/index.ts';
import { accountsOf } from './cross.ts';
import { emailSenderOf } from './email.ts';
import { componentsOf, composeStack, STACK_DEFS } from './index.ts';

const books = loadPriceBooks();
const sender = (stack: string, email?: string) =>
  composeStack(stack, email ? { email } : {}).nodes.find(
    (n) => n.id === 'email',
  )!;

describe('メール送信（D-95）', () => {
  it('構成の既定: Cloudflare Paid は Email Service、ほかはどれも Amazon SES（止まる上限が無い・いちばん安い従量）', () => {
    for (const d of STACK_DEFS) {
      const b = sender(d.id).billing!;
      const want =
        d.platform === 'cloudflare' && d.plan === 'paid'
          ? 'cloudflare/workers-paid'
          : 'aws/ses';
      expect(`${b.provider}/${b.planId}`, d.id).toBe(want);
    }
  });

  it('選択肢: Resend Free・Pro はどの事業者でも、SES は Cloudflare（既定が SES でない）でだけ別に出す', () => {
    const ids = (p: Parameters<typeof componentsOf>[0]) =>
      componentsOf(p, 'email').map((c) => c.id);
    expect(ids('cloudflare')).toEqual([
      'default',
      'ses',
      'resend-free',
      'resend-pro',
    ]);
    for (const p of [
      'vercel',
      'sakura',
      'aws',
      'aws-opennext',
      'netlify',
      'gcp',
    ] as const)
      expect(ids(p)).toEqual(['default', 'resend-free', 'resend-pro']);
    expect(emailSenderOf('gcp', 'pay-as-you-go', 'resend-pro').planId).toBe(
      'pro',
    );
  });

  it('既定の送り先のアカウントは構成のアカウントに入り、Resend に替えると Resend が増える', () => {
    expect(accountsOf(composeStack('gcp-cloud-run'))).toEqual(['gcp', 'aws']);
    expect(
      accountsOf(composeStack('gcp-cloud-run', { email: 'resend-pro' })),
    ).toEqual(['gcp', 'resend']);
    expect(
      accountsOf(composeStack('cloudflare-vinext-paid', { email: 'ses' })),
    ).toEqual(['cloudflare', 'aws']);
  });

  it('料金: SES は 1,000 通 $0.10、Email Service は月 3,000 通の後 $0.35、Resend Pro は $20 + 5 万通の後 $0.90、Free は 1 日 100 通で止まる', () => {
    // 受託・30 万 PV: 利用者 1,500 人 × 月 10 通 = 1.5 万通
    const w = businessApp(300_000);
    const lines = (stack: string, email?: string) =>
      estimate({
        workload: w,
        architecture: composeStack(stack, email ? { email } : {}),
        books,
      }).bill.lines.filter(
        (l) => l.nodeIds.includes('email') && l.kind !== 'base-fee',
      );
    const sum = (ls: ReturnType<typeof lines>) =>
      ls.reduce((a, l) => a + (l.amount ?? 0), 0);
    expect(sum(lines('gcp-cloud-run'))).toBeCloseTo(1.5, 9);
    expect(sum(lines('cloudflare-vinext-paid'))).toBeCloseTo(
      (12_000 * 0.35) / 1000,
      9,
    );
    // 基本料を除いた従量（Resend Pro は込みの中で 0）
    expect(sum(lines('gcp-cloud-run', 'resend-pro'))).toBe(0);
    const free = estimate({
      workload: w,
      architecture: composeStack('gcp-cloud-run', { email: 'resend-free' }),
      books,
    });
    expect(
      free.premises.find((p) => p.id === 'pool:resend:free:free-daily'),
    ).toMatchObject({ hit: true, effect: 'block' });
  });

  it('Resend Pro は込みの 5 倍（25 万通）で止まり、超えた分は送れないので課金しない（OCL-F37D88E8）', () => {
    const at = (pv: number) => {
      const r = estimate({
        workload: businessApp(pv),
        architecture: composeStack('gcp-cloud-run', { email: 'resend-pro' }),
        books,
      });
      const meter = r.bill.lines.find(
        (l) => l.priceRef.meterId === 'emails' && l.kind !== 'base-fee',
      )!;
      const cap = r.premises.find(
        (p) => p.id === 'limit:resend:pro:monthly-cap:email',
      )!;
      return { amount: meter.amount, cap };
    };
    // 1,000 万 PV: 利用者 5 万人 × 月 10 通 = 50 万通。込み 5 万 + 課金 20 万 × $0.90 / 1,000 で頭打ち
    const big = at(10_000_000);
    expect(big.amount).toBeCloseTo((200_000 * 0.9) / 1000, 9);
    expect(big.cap).toMatchObject({ hit: true, effect: 'block' });
    // 400 万 PV（20 万通）: 上限の中で、込みを超えた 15 万通を課金する
    const mid = at(4_000_000);
    expect(mid.amount).toBeCloseTo((150_000 * 0.9) / 1000, 9);
    expect(mid.cap).toMatchObject({ hit: false, effect: 'block' });
  });
});
