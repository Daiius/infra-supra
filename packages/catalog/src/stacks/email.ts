// アプリのメールの送信（パスワードの再設定・登録の確認・通知。D-95・prd/04 §3.10・prd/11 §20）。構成を組み終えた後に、
// 送信のノード（email-sender）を 1 つ足す。送る先は部品「メール送信」（スロット email）の選択と、土台の事業者・プランで決まる。
// - 構成の既定（default）: Cloudflare Paid は自前の Email Service（Workers Paid）。それ以外はどの構成も Amazon SES
//   （いちばん安い従量・止まる上限が無い）。Cloudflare Free は Email Service の送信が使えず、Resend Free は基準プレイの規模で
//   1 日 100 通に当たって止まるので、既定にしない。Supabase Auth の組み込みのメールはチームのメンバーにしか送れないので使わない。
// - 他の事業者の送信（CROSS_PAIRS で許した組）: Resend Free・Pro（どの事業者からも）・SES（Cloudflare から）。
import type { ArchitectureInput } from 'estimator';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

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
  if (choice === 'resend-free') return RESEND_FREE;
  if (choice === 'resend-pro') return RESEND_PRO;
  // 構成の既定: Cloudflare Paid だけ自前の Email Service、ほかは SES
  return platform === 'cloudflare' && plan !== 'free' ? CF_EMAIL : SES;
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

const SES_NOTE =
  'Amazon SES の API（か SMTP）で送る。1,000 通 $0.10 で、無料の通数も 1 日の上限の料金の段も無い。送る元のドメインの認証（DNS のレコード）を設定する';
const NO_OWN =
  'Supabase Auth の組み込みのメールはチームのメンバーにしか送れない（1 時間 2 通）ので、本番は外の送信のサービスを使う。';

/** 構成の既定の送信の説明（事業者ごと。何で送り、どこで止まる・払うか）。 */
const DEFAULT_EMAIL: Record<Platform, { label: string; note: string }> = {
  cloudflare: {
    label: '構成の既定（Email Service。Free は Amazon SES）',
    note:
      'Cloudflare の Email Service（ベータ）で Worker から送る。Workers Paid は月 3,000 通まで込み、超えた分は 1,000 通 $0.35。' +
      'Workers Free では送信が使えない（確かめた宛先だけ）ので、Free の構成は Amazon SES（1,000 通 $0.10）で送る',
  },
  aws: {
    label: '構成の既定（Amazon SES）',
    note: `同じ AWS のアカウントで送る。${SES_NOTE}`,
  },
  'aws-opennext': {
    label: '構成の既定（Amazon SES）',
    note: `同じ AWS のアカウントで送る。${SES_NOTE}`,
  },
  vercel: {
    label: '構成の既定（Amazon SES）',
    note: `${NO_OWN}ここでは ${SES_NOTE}`,
  },
  netlify: {
    label: '構成の既定（Amazon SES）',
    note: `${NO_OWN}ここでは ${SES_NOTE}`,
  },
  gcp: {
    label: '構成の既定（Amazon SES）',
    note: `Google Cloud に一般向けのメールの送信のサービスは無いので、外の送信のサービスを使う。ここでは ${SES_NOTE}`,
  },
  sakura: {
    label: '構成の既定（Amazon SES）',
    note: `VPS から自分のメールサーバーで送る形は扱わない（届きやすさの手入れが要る）。ここでは ${SES_NOTE}`,
  },
};

const DEFAULT_REFS: Record<Platform, string[]> = {
  cloudflare: [
    'pool:cloudflare:workers-paid:paid-email-sending',
    'fact:cloudflare:workers-paid:email-beta',
  ],
  aws: [],
  'aws-opennext': [],
  vercel: [],
  netlify: [],
  gcp: [],
  sakura: [],
};

const ALL_HOSTS: Platform[] = [
  'cloudflare',
  'vercel',
  'sakura',
  'aws',
  'aws-opennext',
  'netlify',
  'gcp',
];

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
    hosts: ['cloudflare'],
    link: { via: 'http', as: 'ses' },
    label: 'AWS: Amazon SES で送る',
    note:
      `${SES_NOTE}。AWS のアカウントが 1 つ増え（すでにあれば増えない）、請求が 2 つになる。` +
      'Cloudflare Free の構成では既定と同じ',
    premiseRefs: [],
  },
  {
    id: 'resend-free',
    slot: 'email',
    platform: 'resend',
    hosts: ALL_HOSTS,
    link: { via: 'http', as: 'resend-free' },
    label: 'Resend: Free で送る',
    note:
      'Resend の API で送る。費用はかからないが、1 日 100 通・月 3,000 通まで。超えるとその日はそれ以上送れない（登録の確認・パスワードの再設定も届かない）。' +
      'Resend のアカウントが 1 つ増える',
    premiseRefs: ['pool:resend:free:free-daily'],
  },
  {
    id: 'resend-pro',
    slot: 'email',
    platform: 'resend',
    hosts: ALL_HOSTS,
    link: { via: 'http', as: 'resend-pro' },
    label: 'Resend: Pro で送る',
    note:
      'Resend の API で送る。月 $20 で 5 万通まで込み、超えた分は 1,000 通 $0.90。1 日の上限は無い。' +
      'Resend のアカウントが 1 つ増え、請求が 1 つ増える',
    premiseRefs: ['pool:resend:pro:pro-emails'],
  },
];
