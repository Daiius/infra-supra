// Neon（従量の Postgres。Free・Launch）。2026-11-02 に公式ページから取得（D-77・prd/11 §15）。USD・税抜。
// 2025 年の改定で有料のプランは月の最低額の無い従量制（CU 時間・保存・転送）。Scale（$0.222/CU 時間・SLA あり）は
// 構成に組んでいない（Launch で足りる規模を扱う）。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

/** Neon の facts（構成のノードが facts で挙げたときだけ前提として出す）。Free・Launch で同じ。 */
const FACTS = [
  {
    id: 'region',
    premise:
      'Neon の AWS のリージョンに東京は無く、アジアはシンガポール（aws-ap-southeast-1）とシドニーだけ。関数を東京に置くと DB との往復がシンガポールまで延びる（往復の遅延は計算していない）',
    sourceIds: ['regions'],
  },
  {
    id: 'serverless-driver',
    premise:
      '関数からは Neon の serverless driver で HTTP（既定）か WebSocket で問い合わせる。TCP で直接つなぐ場合は接続のプール（PgBouncer。クライアントの接続は 10,000 まで）を使うのが公式の推奨',
    sourceIds: ['driver', 'pooling'],
  },
  {
    id: 'scale-to-zero',
    premise:
      'Neon の DB は問い合わせが 5 分無いと止まり（scale to zero）、数百 ms で再開する。止まっている間は CU 時間に数えない。Free は止める設定を外せず、Launch は外せる',
    interpretation: {
      adopted:
        '止める設定のまま運営し、動いている割合は DB に届く件数の到着率から出す（Aurora Serverless v2 の 0 ACU と同じ式。夜間に減る分は入れない）',
      rejected: [
        {
          reading: '常に動かしておく（止める設定を外す）',
          reason:
            '従量の Postgres を選ぶ理由が閲覧の途切れで止まることなので、既定の 5 分のままとみる',
        },
      ],
    },
    sourceIds: ['scaleToZero', 'lifecycle', 'plans'],
  },
  {
    id: 'compute-size',
    premise:
      'Neon の計算の大きさは 0.25 CU（約 1 GB の RAM）から。CU 時間 = 大きさ × 動いている時間（0.25 CU を 4 時間で 1 CU 時間）',
    interpretation: {
      adopted:
        '最小の 0.25 CU に固定する（負荷で自動で大きくなる分は計算しない）',
      rejected: [
        {
          reading: '自動の拡大（autoscaling）で負荷に合わせて大きくなる',
          reason:
            '負荷と CU の関係が公式に無く、比べている他の DB（Supabase の Micro）と同じ程度の最小の大きさで見る',
        },
      ],
    },
    sourceIds: ['computes', 'plans'],
  },
];

const UPTIME = {
  status: 'none' as const,
  premise: 'Neon の稼働率の SLA は Scale だけ（Free・Launch には無い）',
  sourceIds: ['pricing'],
};
const MEMBERS = {
  pricing: 'included' as const,
  premise:
    'Neon は組織のメンバーが Free・Launch とも無制限（メンバーごとの料金の記載なし）',
  sourceIds: ['pricing'],
};

export const neon: PriceBookInput = {
  schemaVersion: 1,
  provider: 'neon',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    pricing: src('https://neon.com/pricing'),
    plans: src('https://neon.com/docs/introduction/plans'),
    regions: src('https://neon.com/docs/introduction/regions'),
    scaleToZero: src('https://neon.com/docs/introduction/scale-to-zero'),
    lifecycle: src('https://neon.com/docs/introduction/compute-lifecycle'),
    computes: src('https://neon.com/docs/manage/computes'),
    driver: src('https://neon.com/docs/serverless/serverless-driver'),
    pooling: src('https://neon.com/docs/connect/connection-pooling'),
  },
  allowancePools: [
    {
      id: 'free-compute',
      quantity: 100,
      unit: 'hour',
      period: 'month',
      scope: 'node',
      premise:
        'Neon Free は 1 プロジェクト月 100 CU 時間まで（0.25 CU なら 400 時間）。使い切ると次の月まで DB が止まる',
      sourceIds: ['pricing', 'plans'],
    },
    {
      id: 'free-transfer',
      quantity: 5,
      unit: 'gb',
      period: 'month',
      scope: 'node',
      premise:
        'Neon Free の公開の転送は 1 プロジェクト月 5 GB まで。使い切ると次の月まで DB が止まる',
      sourceIds: ['pricing', 'plans'],
    },
    {
      id: 'paid-transfer',
      quantity: 500,
      unit: 'gb',
      period: 'month',
      scope: 'node',
      premise:
        'Neon Launch の公開の転送は 1 プロジェクト月 500 GB まで込み、以降 $0.10/GB（アプリへの DB の応答を数える想定）',
      sourceIds: ['pricing', 'plans'],
    },
  ],
  plans: [
    {
      id: 'free',
      service: 'database',
      name: 'Free',
      sourceIds: ['pricing', 'plans'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      facts: FACTS,
      notes: [
        '保存は 1 プロジェクト 1 GB・アカウント全体で 20 GB まで（超えると保存を増やす書き込みが失敗する）',
        'DB は 5 分使われないと止まり、止める設定は外せない',
        'プロジェクトは 100 まで。上限に当たってもデータは消えず、Launch に上げるとすぐ外れる',
      ],
      meters: [
        {
          id: 'compute',
          label: 'DB の計算（Neon: compute）',
          resource: 'instance-hours',
          unit: 'hour',
          allowancePool: 'free-compute',
          onExceed: 'block',
          premise:
            'Neon の計算は CU 時間（大きさ × 動いている時間）で数え、止まっている間は数えない',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['plans'],
        },
        {
          id: 'transfer',
          label: 'DB からの転送（Neon: public network transfer）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'free-transfer',
          onExceed: 'block',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['plans'],
        },
      ],
      limits: [
        {
          id: 'db-size',
          measure: 'storage-gb',
          value: 1,
          unit: 'gb',
          scope: 'node',
          onExceed: 'block',
          premise:
            'Neon Free は 1 プロジェクト 1 GB まで（超えると保存を増やす書き込みが失敗する）',
          sourceIds: ['pricing', 'plans'],
        },
      ],
    },
    {
      id: 'launch',
      service: 'database',
      name: 'Launch',
      sourceIds: ['pricing', 'plans'],
      uptimeSla: UPTIME,
      members: MEMBERS,
      facts: FACTS,
      notes: [
        '月の最低額は無く、使った分だけの請求（$0.50 未満の請求は取り立てない）',
        '支出の上限は無く、設定した額の 80%・100% でメールが届くだけ',
        '過去の時点に戻す履歴（instant restore。最長 7 日）は $0.20/GB 月だが、変更の量に依るので数えていない',
      ],
      meters: [
        {
          id: 'compute',
          label: 'DB の計算（Neon: compute）',
          resource: 'instance-hours',
          unit: 'hour',
          premise:
            'Neon の計算は CU 時間（大きさ × 動いている時間）で数え、止まっている間は数えない',
          pricing: { model: 'flat', per: 1, unitPrice: 0.106 },
          sourceIds: ['pricing', 'plans'],
        },
        {
          id: 'storage',
          label: 'DB の保存（Neon: storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: { model: 'flat', per: 1, unitPrice: 0.35 },
          sourceIds: ['pricing', 'plans'],
        },
        {
          id: 'transfer',
          label: 'DB からの転送（Neon: public network transfer）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'paid-transfer',
          pricing: { model: 'flat', per: 1, unitPrice: 0.1 },
          sourceIds: ['pricing', 'plans'],
        },
      ],
    },
  ],
};
