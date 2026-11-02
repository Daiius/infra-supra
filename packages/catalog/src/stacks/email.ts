// アプリのメールの送信（パスワードの再設定・登録の確認・通知。D-95・prd/04 §3.10・prd/11 §20）。構成を組み終えた後に、
// 送信のノード（email-sender）を 1 つ足す。送る先は部品「メール送信」（スロット email）の選択と、土台の事業者・プランで決まる。
// - 構成の既定（default）: Cloudflare Paid は Email Service（Workers Paid）、Cloudflare Free は Resend Free（Email Service の送信は Free で使えない）、
//   AWS は Amazon SES、自前の送信のサービスを持たない事業者（Vercel・Netlify・Google Cloud・さくらの VPS）は Resend
//   （土台が無料のプランなら Free、有料なら Pro）。Supabase Auth の組み込みのメールはチームのメンバーにしか送れないので使わない。
// - 他の事業者の送信（CROSS_PAIRS で許した組）: AWS の SES（自前の送信を持たない事業者と Cloudflare から）・Resend Pro（Cloudflare・AWS から）。
import type { ArchitectureInput } from 'estimator';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** 土台が無料のプラン（Cloudflare Free・Vercel Hobby・Netlify Free）か。 */
const freeHostPlan = (plan: string) => plan === 'free' || plan === 'hobby';

type Sender = {
  label: string;
  accountId: string;
  provider: string;
  planId: string;
  meter: string;
};

const SES: Sender = {
  label: 'Amazon SES（メールの送信）',
  accountId: 'aws',
  provider: 'aws',
  planId: 'ses',
  meter: 'outbound',
};
const RESEND_FREE: Sender = {
  label: 'Resend Free（メールの送信）',
  accountId: 'resend',
  provider: 'resend',
  planId: 'free',
  meter: 'emails',
};
const RESEND_PRO: Sender = {
  ...RESEND_FREE,
  label: 'Resend Pro（メールの送信）',
  planId: 'pro',
};
const CF_EMAIL: Sender = {
  label: 'Email Service（メールの送信）',
  accountId: 'cloudflare',
  provider: 'cloudflare',
  planId: 'workers-paid',
  meter: 'email-sending',
};

/** 選択（省略は構成の既定）と土台の事業者・プランから、送る先のサービス。 */
export function emailSenderOf(
  platform: Platform,
  plan: string,
  choice: string | undefined,
): Sender {
  if (choice === 'ses') return SES;
  if (choice === 'resend-pro') return RESEND_PRO;
  switch (platform) {
    case 'cloudflare':
      return freeHostPlan(plan) ? RESEND_FREE : CF_EMAIL;
    case 'aws':
    case 'aws-opennext':
      return SES;
    default:
      return freeHostPlan(plan) ? RESEND_FREE : RESEND_PRO;
  }
}

/** 構成にメールの送信のノードを足す（D-95）。choice は部品の email（省略は構成の既定）。 */
export function withEmail(
  arch: ArchitectureInput,
  platform: Platform,
  plan: string,
  choice: string | undefined,
): ArchitectureInput {
  const s = emailSenderOf(platform, plan, choice);
  const node: ArchNodeIn = {
    id: 'email',
    label: s.label,
    config: { kind: 'email-sender' },
    billing: {
      accountId: s.accountId,
      provider: s.provider,
      planId: s.planId,
      meters: { emails: s.meter },
    },
  };
  return { ...arch, nodes: [...arch.nodes, node] };
}

/** 構成の既定の送信の説明（事業者ごと。何で送り、どこで止まる・払うか）。 */
const DEFAULT_EMAIL: Record<Platform, { label: string; note: string }> = {
  cloudflare: {
    label: '構成の既定（Email Service。Free は Resend Free）',
    note:
      'Cloudflare の Email Service（ベータ）で Worker から送る。Workers Paid は月 3,000 通まで込み、超えた分は 1,000 通 $0.35。' +
      'Workers Free では送信が使えない（確かめた宛先だけ）ので、Free の構成は Resend Free（1 日 100 通まで。超えるとその日は送れない）',
  },
  aws: {
    label: '構成の既定（Amazon SES）',
    note: 'Amazon SES で送る。1,000 通 $0.10 で、無料の通数は無い（同じ AWS のアカウント）',
  },
  'aws-opennext': {
    label: '構成の既定（Amazon SES）',
    note: 'Amazon SES で送る。1,000 通 $0.10 で、無料の通数は無い（同じ AWS のアカウント）',
  },
  vercel: {
    label: '構成の既定（Resend。Hobby は Free）',
    note:
      'Supabase Auth の組み込みのメールはチームのメンバーにしか送れない（1 時間 2 通）ので、本番は外の送信のサービスの SMTP・API を使う。ここでは Resend。' +
      'Hobby の構成は Resend Free（1 日 100 通まで。超えるとその日は送れない）、Pro の構成は Resend Pro（月 $20・5 万通まで込み）',
  },
  netlify: {
    label: '構成の既定（Resend。Free は Free）',
    note:
      'Supabase Auth の組み込みのメールはチームのメンバーにしか送れない（1 時間 2 通）ので、本番は外の送信のサービスの SMTP・API を使う。ここでは Resend。' +
      'Free の構成は Resend Free（1 日 100 通まで。超えるとその日は送れない）、Personal・Pro の構成は Resend Pro（月 $20・5 万通まで込み）',
  },
  gcp: {
    label: '構成の既定（Resend Pro）',
    note: 'Google Cloud に一般向けのメールの送信のサービスは無いので、外の送信のサービスを API で使う。ここでは Resend Pro（月 $20・5 万通まで込み）',
  },
  sakura: {
    label: '構成の既定（Resend Pro）',
    note: 'VPS から自分のメールサーバーで送る形は扱わない（届きやすさの手入れが要る）。外の送信のサービスを API で使う。ここでは Resend Pro（月 $20・5 万通まで込み）',
  },
};

const RESEND_REFS = [
  'pool:resend:free:free-daily',
  'pool:resend:pro:pro-emails',
];
const DEFAULT_REFS: Record<Platform, string[]> = {
  cloudflare: [
    'pool:cloudflare:workers-paid:paid-email-sending',
    'fact:cloudflare:workers-paid:email-beta',
    'pool:resend:free:free-daily',
  ],
  aws: [],
  'aws-opennext': [],
  vercel: RESEND_REFS,
  netlify: RESEND_REFS,
  gcp: ['pool:resend:pro:pro-emails'],
  sakura: ['pool:resend:pro:pro-emails'],
};

/** 部品「メール送信」（D-95）。構成の既定と、他の事業者の送信（CROSS_PAIRS）。 */
export const EMAIL_COMPONENTS: readonly ComponentOption[] = [
  ...(Object.keys(DEFAULT_EMAIL) as Platform[]).map((platform) => ({
    id: 'default',
    slot: 'email' as const,
    platform,
    label: DEFAULT_EMAIL[platform].label,
    note: DEFAULT_EMAIL[platform].note,
    premiseRefs: DEFAULT_REFS[platform],
  })),
  {
    id: 'ses',
    slot: 'email',
    platform: 'aws',
    hosts: ['cloudflare', 'vercel', 'netlify', 'gcp', 'sakura'],
    link: { via: 'http', as: 'ses' },
    label: 'AWS: Amazon SES で送る',
    note:
      'AWS の Amazon SES の API（か SMTP）で送る。1,000 通 $0.10 で、月の込みの通数も 1 日の上限の料金の段も無い。' +
      'AWS のアカウントが 1 つ増え（すでにあれば増えない）、送る元のドメインの認証（DNS のレコード）を設定する',
    premiseRefs: [],
  },
  {
    id: 'resend-pro',
    slot: 'email',
    platform: 'resend',
    hosts: ['cloudflare', 'aws', 'aws-opennext'],
    link: { via: 'http', as: 'resend-pro' },
    label: 'Resend: Pro で送る',
    note:
      'Resend の API で送る。月 $20 で 5 万通まで込み、超えた分は 1,000 通 $0.90。開発者向けの SDK・管理画面が使いやすい。' +
      'Resend のアカウントが 1 つ増え、請求が 2 つになる',
    premiseRefs: ['pool:resend:pro:pro-emails'],
  },
];
