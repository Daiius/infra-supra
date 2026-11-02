// Resend（アプリのメールの送信。Free・Pro）。2026-11-02 に公式ページから取得（D-95・prd/11 §20）。USD・税抜。
// Pro は月 5 万通の段（$20）だけを持つ（同じ Pro の 10 万通 $35・Scale は基準プレイの規模で要らないので入れない）。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

const UPTIME = {
  status: 'none' as const,
  premise:
    'Resend の稼働率の SLA（99.99%）は Enterprise だけで、Free・Pro には無い',
  sourceIds: ['pricing'],
};
const MEMBERS = {
  pricing: 'not-stated' as const,
  premise: 'Resend のチームのメンバーの料金は、料金ページに書かれていない',
  sourceIds: ['pricing'],
};

export const resend: PriceBookInput = {
  schemaVersion: 1,
  provider: 'resend',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://resend.com/pricing'),
    quotas: src(
      'https://resend.com/docs/knowledge-base/account-quotas-and-limits',
    ),
  },
  allowancePools: [
    {
      id: 'free-daily',
      quantity: 100,
      unit: 'count',
      period: 'day',
      scope: 'account',
      premise:
        'Resend Free は 1 日 100 通・月 3,000 通まで（1 日は UTC の暦日で、0 時に戻る）。Free には超過の料金が無い',
      sourceIds: ['pricing', 'quotas'],
    },
    {
      id: 'pro-emails',
      quantity: 50_000,
      unit: 'count',
      period: 'month',
      scope: 'account',
      premise:
        'Resend Pro（月 $20）は月 5 万通まで込み、超えた分は 1,000 通 $0.90。1 日の上限は無い',
      sourceIds: ['pricing', 'quotas'],
    },
  ],
  plans: [
    {
      id: 'free',
      service: 'email',
      name: 'Free',
      sourceIds: ['pricing', 'quotas'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      notes: [
        '月 3,000 通の上限は 1 日 100 通 × 30 日とほぼ同じなので、1 日の上限（平日・休日・最も多い日）で判定する',
        'ドメインは 3 つまで・送ったメールの記録は 30 日',
      ],
      meters: [
        {
          id: 'emails',
          label: 'メールの送信（Resend: emails）',
          resource: 'emails',
          unit: 'count',
          allowancePool: 'free-daily',
          onExceed: 'block',
          premise:
            'Resend Free は 1 日 100 通を超えると、その日はそれ以上送れない（Free に超過の料金は無く、上げるには Pro）',
          interpretation: {
            adopted:
              '上限を超えた分は送れない（止まる）とみる。料金ページに Free の超過の料金が無く、FAQ は上限に当たると知らせて上のプランを勧めると書く',
            rejected: [
              {
                reading: '超えた分も遅れて送られる',
                reason: '公式に、上限を超えた分を後で送るという記載が無い',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['pricing', 'quotas'],
        },
      ],
      limits: [],
    },
    {
      id: 'pro',
      service: 'email',
      name: 'Pro（月 5 万通）',
      baseFee: {
        label: '基本料（Resend Pro）',
        amount: 20,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['pricing', 'quotas'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      notes: [
        '超過は込みの通数の 5 倍（25 万通）までで、そこで次の請求の期間まで送信が止まる',
        'ドメインは 10 まで・送ったメールの記録は 30 日',
      ],
      meters: [
        {
          id: 'emails',
          label: 'メールの送信（Resend: emails）',
          resource: 'emails',
          unit: 'count',
          allowancePool: 'pro-emails',
          premise:
            'Resend Pro は月 5 万通を超えた分が 1,000 通 $0.90（従量の超過を有効にした有料のプラン）',
          interpretation: {
            adopted:
              '従量の超過（pay-as-you-go）を有効にして、超えた分を払う（有料のプランの選択肢）',
            rejected: [
              {
                reading: '超えると送れなくなり、上のプランへの変更を求められる',
                reason:
                  '有料のプランは従量の超過を選べるので、止める側は運用の選択としては取らない',
              },
            ],
          },
          // 込みの 5 倍（25 万通）で送信が止まるので、込みの後の 20 万通まで課金し、その先は送れない（課金しない。上限は limits）
          pricing: {
            model: 'tiered',
            per: 1_000,
            tiers: [
              { upTo: 200_000, unitPrice: 0.9 },
              { upTo: null, unitPrice: 0 },
            ],
          },
          sourceIds: ['pricing', 'quotas'],
        },
      ],
      limits: [
        {
          id: 'monthly-cap',
          measure: 'emails-per-month',
          value: 250_000,
          unit: 'count',
          scope: 'month',
          onExceed: 'block',
          premise:
            'Resend Pro の超過は込みの通数の 5 倍（25 万通）までで、そこで次の請求の期間まで送信が止まる',
          sourceIds: ['quotas'],
        },
      ],
    },
  ],
  notes: ['税抜の USD（料金ページに税の記載は無い）'],
};
