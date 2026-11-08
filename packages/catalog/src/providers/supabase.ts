// Supabase（Free・Pro）。2026-10-31 に公式ページから取得（spikes/concept-2026-10-31）。USD・税抜。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

/**
 * Supabase の facts（構成のノードが facts で挙げたときだけ前提として出す。Free・Pro で同じ）。
 * Vercel・Netlify・Cloudflare の既定の Supabase のノードは挙げない（前提の文を変えない）。他の土台の DB の部品（D-114 段 2d）が挙げる。
 */
const FACTS = [
  {
    id: 'shared-pooler',
    premise:
      'Supabase の直接の接続は IPv6 だけ（IPv4 はアドオン）で、共有のプール（Supavisor）はどのプランでも IPv4 です。' +
      'サーバーレスの関数は共有のプールの transaction モード（6543）、VM・常駐のコンテナは直接の接続か、IPv4 だけの網からは共有のプールの session モード（5432）を使います',
    sourceIds: ['connecting'],
  },
  {
    id: 'pooler-egress',
    premise:
      '共有のプールを通した転送は「Shared Pooler Egress」として数え、DB の転送とは二重に数えません。転送の枠（Unified Egress Quota。Free 5 GB・Pro 250 GB）はサービスをまたいで共通です',
    interpretation: {
      adopted:
        'プール経由の転送を、DB の転送と同じ枠・同じ単価（uncached $0.09/GB）で数えます（料金の文はプールを名指ししていない）',
      rejected: [
        {
          reading: 'プール経由の転送を別の枠・別の単価で数える',
          reason: '公式の文書に別の枠・単価の記載がありません',
        },
      ],
    },
    sourceIds: ['egressPooler'],
  },
];

export const supabase: PriceBookInput = {
  schemaVersion: 1,
  provider: 'supabase',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://supabase.com/pricing'),
    // Auth の組み込みのメール（2026-11-02 取得。D-95）
    authSmtp: {
      url: 'https://supabase.com/docs/guides/auth/auth-smtp',
      retrievedAt: '2026-11-02',
    },
    billing: src(
      'https://supabase.com/docs/guides/platform/billing-on-supabase',
    ),
    compute: src('https://supabase.com/docs/guides/platform/compute-and-disk'),
    sla: src('https://supabase.com/sla'),
    egress: src(
      'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
    ),
    // バックアップ・PITR（2026-11-02 取得。D-93）
    backups: {
      url: 'https://supabase.com/docs/guides/platform/backups',
      retrievedAt: '2026-11-02',
    },
    pitr: {
      url: 'https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery',
      retrievedAt: '2026-11-02',
    },
    // 接続の口（共有のプール・IPv4）と、プール経由の転送の数え方（2026-11-04 取得。D-114 段 2d）
    connecting: {
      url: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
      retrievedAt: '2026-11-04',
    },
    egressPooler: {
      url: 'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
      retrievedAt: '2026-11-04',
    },
    computeSmall: {
      url: 'https://supabase.com/docs/guides/platform/compute-and-disk',
      retrievedAt: '2026-11-02',
    },
  },
  allowancePools: [
    {
      id: 'free-egress',
      quantity: 5,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise: 'Supabase Free の egress は月 5 GB まで',
      sourceIds: ['egress'],
    },
    {
      id: 'pro-egress',
      quantity: 250,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'Supabase Pro の egress は月 250 GB まで込み（アプリへの DB の応答も数える想定）',
      sourceIds: ['egress'],
    },
    {
      id: 'pro-disk',
      quantity: 8,
      unit: 'gb-month',
      period: 'month',
      scope: 'node',
      premise: 'Supabase Pro はディスク 8 GB まで込み、以降 $0.125/GB 月',
      sourceIds: ['pricing'],
    },
  ],
  plans: [
    {
      id: 'free',
      service: 'database',
      name: 'Free',
      sourceIds: ['pricing', 'billing', 'authSmtp'],
      uptimeSla: {
        status: 'none',
        premise:
          'Supabase の稼働率の SLA は Free・Pro・Team には含まれません（Enterprise だけ 99.9%）',
        sourceIds: ['pricing', 'sla'],
      },
      members: {
        pricing: 'included',
        premise:
          'Supabase はチームのメンバーが Free・Pro とも無制限（メンバーごとの料金なし）',
        sourceIds: ['pricing'],
      },
      facts: FACTS,
      notes: [
        '1 週間使われないとプロジェクトが一時停止します',
        '有効な無料プロジェクトは 2 つまで',
        'Auth の組み込みのメールはプロジェクトのチームのメンバーにしか送れず（他の宛先は「Email address not authorized」）、1 時間 2 通までです。公式は本番では自前の SMTP を設定するよう求めています。構成のメールは外の送信のサービス（Resend など）で数えます（D-95）',
      ],
      meters: [
        {
          id: 'egress',
          label: 'DB からの転送（Supabase: egress）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'free-egress',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['egress'],
        },
      ],
      limits: [
        {
          id: 'db-size',
          measure: 'storage-gb',
          value: 0.5,
          unit: 'gb',
          scope: 'node',
          onExceed: 'block',
          premise:
            'Supabase Free は DB 500 MB まで（1 週間使われないと一時停止）',
          sourceIds: ['pricing'],
        },
      ],
    },
    {
      id: 'pro-micro',
      service: 'database',
      name: 'Pro（Micro）',
      baseFee: {
        label: '基本料（Supabase Pro）',
        amount: 25,
        per: 'month',
        scope: 'account',
      },
      sourceIds: ['pricing', 'compute', 'authSmtp'],
      uptimeSla: {
        status: 'none',
        premise:
          'Supabase の稼働率の SLA は Free・Pro・Team には含まれません（Enterprise だけ 99.9%）',
        sourceIds: ['pricing', 'sla'],
      },
      members: {
        pricing: 'included',
        premise:
          'Supabase はチームのメンバーが Free・Pro とも無制限（メンバーごとの料金なし）',
        sourceIds: ['pricing'],
      },
      credits: [
        {
          id: 'compute-credit',
          label: 'Compute のクレジット（Supabase: Compute Credits）',
          amount: 10,
          appliesTo: { meterIds: ['compute'] },
          sourceIds: ['compute'],
        },
      ],
      facts: FACTS,
      notes: [
        'Pro は支出上限が既定で有効です。ただし Compute は上限の対象外です',
        'Compute は 1 時間単位で切り上げ',
        '日次のバックアップは 7 日分を残します（Pro に込み）。任意の時点への復元（PITR）はアドオンです（D-93）',
        'Auth の組み込みのメールはプロジェクトのチームのメンバーにしか送れず（他の宛先は「Email address not authorized」）、1 時間 2 通までです。公式は本番では自前の SMTP を設定するよう求めています。構成のメールは外の送信のサービス（Resend など）で数えます（D-95）',
      ],
      meters: [
        {
          id: 'compute',
          label: 'DB のサーバーの稼働（Supabase: Compute）',
          resource: 'instance-hours',
          unit: 'hour',
          rounding: { granularity: 1, scope: 'period' },
          premise:
            'Supabase の Compute は時間課金で、使われていなくても動いている間は課金されます',
          pricing: { model: 'flat', per: 1, unitPrice: 0.01344 },
          sourceIds: ['compute'],
        },
        {
          id: 'egress',
          label: 'DB からの転送（Supabase: egress）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'pro-egress',
          pricing: { model: 'flat', per: 1, unitPrice: 0.09 },
          sourceIds: ['egress'],
        },
        {
          id: 'disk',
          label: 'DB のディスク（Supabase: Disk Size）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'pro-disk',
          pricing: { model: 'flat', per: 1, unitPrice: 0.125 },
          sourceIds: ['pricing'],
        },
        {
          id: 'pitr',
          label:
            'PITR（Supabase: Point-in-Time Recovery 7 日 + Small の compute）',
          resource: 'backup-hours',
          unit: 'hour',
          rounding: { granularity: 1, scope: 'period' },
          premise:
            'Supabase の PITR（7 日）は 1 時間 $0.137（月 約 $100）のアドオンで、compute が Small 以上でないと付けられない（Small は 1 時間 $0.0206、Micro は $0.01344）。PITR を付けると日次のバックアップは取らなくなります',
          interpretation: {
            adopted:
              'PITR の $0.137 と、Micro から Small に上げる差額 $0.00716 を合わせた 1 時間 $0.14416 で、付けている時間に課金します（compute のメーターは Micro のまま。Small の pooler の接続 400 は数えず、Micro の 200 で判定する）',
            rejected: [
              {
                reading: 'Small を別のプランとして持つ',
                reason:
                  'PITR の前提として上げるだけで、他の判定（接続の上限）は Micro のまま見る方が高めの側に寄ります',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.14416 },
          sourceIds: ['pitr', 'backups', 'computeSmall'],
        },
      ],
      limits: [
        {
          id: 'pooler-connections',
          measure: 'peak-concurrency',
          value: 200,
          unit: 'count',
          scope: 'node',
          onExceed: 'block',
          premise:
            'Supabase Micro の pooler 接続は 200 まで（サーバーレスの同時実行がそのまま接続数になる）',
          sourceIds: ['compute'],
        },
      ],
    },
  ],
};
