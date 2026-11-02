// Google Cloud（Cloud Run + Firebase Hosting・Cloud Storage・Firestore・Cloud SQL）。2026-11-02 に公式の料金ページから取得（D-88・prd/11 §16）。
// USD・税抜。リージョンは東京（asia-northeast1）。Cloud Run の東京は Tier 1（料金ページの「Regional price tiers」）で、
// 表の既定（Iowa）と同じ単価。Firestore・Cloud SQL・Cloud Storage・インターネットへの転送は、料金ページの地域を東京にした表の値。
// Firebase Hosting の Blaze は Google Cloud の請求先アカウントで払う（同じ請求）。Cloud Run は請求先アカウントが要るので、
// Firebase のプロジェクトは Blaze になる（Spark のまま Cloud Run へ書き換える形は無い）。
import type { PriceBookInput } from 'estimator';

const R = '2026-11-02';
const src = (url: string) => ({ url, retrievedAt: R });

const members = {
  pricing: 'not-stated' as const,
  premise:
    'Google Cloud のプロジェクトのメンバー（IAM のユーザー）の料金は、読んだ料金表に書かれていない（記載なし）',
  sourceIds: ['runPricing'],
};
const uptimeSla = {
  status: 'not-stated' as const,
  premise:
    'Google Cloud の稼働率の SLA はサービスごとのページにあり、まだ取得していない（このゲームでは SLA の要件を満たせない扱い）',
  sourceIds: ['runPricing'],
};
const common = { members, uptimeSla };

/** Cloud Run（リクエストで課金・東京 Tier 1）の単価。 */
const RUN = {
  activeCpuPerVcpuSecond: 0.000024,
  activeMemoryPerGiBSecond: 0.0000025,
  idleCpuPerVcpuSecond: 0.0000025,
  idleMemoryPerGiBSecond: 0.0000025,
  requestsPerMillion: 0.4,
} as const;

export const gcp: PriceBookInput = {
  schemaVersion: 1,
  provider: 'gcp',
  version: R,
  status: 'official',
  currency: 'USD',
  taxIncluded: false,
  retrievedAt: R,
  sources: {
    runPricing: src('https://cloud.google.com/run/pricing'),
    runMinInstances: src(
      'https://cloud.google.com/run/docs/configuring/min-instances',
    ),
    runConcurrency: src('https://cloud.google.com/run/docs/about-concurrency'),
    runAutoscaling: src(
      'https://cloud.google.com/run/docs/about-instance-autoscaling',
    ),
    hostingPricing: src('https://firebase.google.com/pricing'),
    hostingUsage: src(
      'https://firebase.google.com/docs/hosting/usage-quotas-pricing',
    ),
    hostingCloudRun: src('https://firebase.google.com/docs/hosting/cloud-run'),
    hostingCache: src('https://firebase.google.com/docs/hosting/manage-cache'),
    nextSelfHosting: src('https://nextjs.org/docs/app/guides/self-hosting'),
    storagePricing: src('https://cloud.google.com/storage/pricing'),
    firestorePricing: src('https://cloud.google.com/firestore/pricing'),
    sqlPricing: src('https://cloud.google.com/sql/pricing'),
    networkPricing: src('https://cloud.google.com/vpc/network-pricing'),
    // Cloud Logging（2026-11-02 取得。D-92）
    loggingPricing: src('https://cloud.google.com/stackdriver/pricing'),
    runLogging: src('https://cloud.google.com/run/docs/logging'),
    // DB のバックアップ・PITR（2026-11-02 取得。D-93）
    sqlBackups: src(
      'https://cloud.google.com/sql/docs/postgres/backup-recovery/backups',
    ),
    sqlBackingUp: src(
      'https://cloud.google.com/sql/docs/postgres/backup-recovery/backing-up',
    ),
    sqlPitr: src(
      'https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr',
    ),
    firestorePitr: src('https://cloud.google.com/firestore/docs/pitr'),
    // Cloud DNS（2026-11-02 取得。D-96）
    dnsPricing: src('https://cloud.google.com/dns/pricing'),
    hostingDomain: src(
      'https://firebase.google.com/docs/hosting/custom-domain',
    ),
  },
  allowancePools: [
    {
      id: 'run-free-cpu',
      quantity: 180_000,
      unit: 'second',
      period: 'month',
      scope: 'account',
      premise:
        'Cloud Run（リクエストで課金）は月 18 万 vCPU 秒まで無料（請求先アカウントごと・Tier 1 の単価での金額の割引）',
      sourceIds: ['runPricing'],
    },
    {
      id: 'run-free-memory',
      quantity: 360_000,
      unit: 'gb-second',
      period: 'month',
      scope: 'account',
      premise: 'Cloud Run（リクエストで課金）は月 36 万 GiB 秒まで無料',
      sourceIds: ['runPricing'],
    },
    {
      id: 'run-free-requests',
      quantity: 2_000_000,
      unit: 'request',
      period: 'month',
      scope: 'account',
      premise: 'Cloud Run（リクエストで課金）は月 200 万リクエストまで無料',
      sourceIds: ['runPricing'],
    },
    {
      id: 'logging-free',
      quantity: 50,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'Cloud Logging はログの取り込み（ログバケットへの保存）が月 50 GiB まで無料（プロジェクトごと）',
      sourceIds: ['loggingPricing'],
    },
    {
      id: 'hosting-free-transfer',
      quantity: 10,
      unit: 'gb',
      period: 'month',
      scope: 'account',
      premise:
        'Firebase Hosting の転送は月 10 GB まで無料（Blaze でも Spark の分が込み。CDN のヒットも外れも数える）',
      sourceIds: ['hostingUsage', 'hostingPricing'],
    },
    {
      id: 'firestore-free-reads',
      quantity: 50_000,
      unit: 'operation',
      period: 'day',
      scope: 'account',
      premise:
        'Firestore（Standard）はドキュメントの読み取りが 1 日 5 万まで無料（1 プロジェクトに 1 つの DB だけ）',
      sourceIds: ['firestorePricing'],
    },
    {
      id: 'firestore-free-writes',
      quantity: 20_000,
      unit: 'operation',
      period: 'day',
      scope: 'account',
      premise:
        'Firestore（Standard）はドキュメントの書き込みが 1 日 2 万まで無料',
      sourceIds: ['firestorePricing'],
    },
    {
      id: 'firestore-free-storage',
      quantity: 1,
      unit: 'gb-month',
      period: 'month',
      scope: 'account',
      premise: 'Firestore（Standard）は保存が 1 GiB まで無料',
      sourceIds: ['firestorePricing'],
    },
  ],
  plans: [
    {
      id: 'cloud-run',
      service: 'cloud-run',
      ...common,
      name: 'Cloud Run（リクエストで課金・東京）',
      sourceIds: ['runPricing'],
      facts: [
        {
          id: 'request-billing',
          premise:
            'Cloud Run のリクエストで課金する設定（既定）は、インスタンスが起動・終了している間と 1 件以上のリクエストを処理している間だけ CPU とメモリを課金する。1 つのインスタンスが同時に複数のリクエストをさばき（既定の上限は 80）、同時に処理している分は 1 回分の時間しか数えない',
          interpretation: {
            adopted:
              '月のアクティブな時間を、リクエストの到着をポアソンとみた「1 件以上を処理している時間の割合」（1 − e^(−同時に処理している件数の平均)）で出し、同時実行の上限と CPU を使い切る分で下から抑える。インスタンスの時間の 100 ms の切り上げと起動・終了の時間は数えない',
            rejected: [
              {
                reading:
                  'リクエストごとの壁時計時間を同時実行の上限（80）で割る',
                reason:
                  '閲覧が薄い時間帯はリクエストが重ならず、1 件ごとにインスタンスの時間が数えられる。80 で割ると一番うまく詰まった場合の下限になり、安く出すぎる',
              },
            ],
          },
          sourceIds: ['runPricing', 'runConcurrency'],
        },
        {
          id: 'min-instances',
          premise:
            'Cloud Run の最小インスタンス数を 1 以上にすると、その数のインスタンスを温めておき、リクエストを処理していない間も安い待機（idle）の単価で課金する（CPU は 1 vCPU 秒 $0.0000025）。0 なら待機は課金されず、インスタンスが無いときに届いたリクエストは起動を待つ',
          interpretation: {
            adopted:
              '月の無料の vCPU 秒・GiB 秒は、アクティブな時間にだけ当てる（待機の分には当てない）',
            rejected: [
              {
                reading: '無料の分は金額の割引なので、待機の分にも当たる',
                reason:
                  '料金ページの無料の分は「us-central1 のアクティブの単価に基づく」と書かれ、待機に当たるかは書かれていない（費用の高い側を採る）',
              },
            ],
          },
          sourceIds: ['runPricing', 'runMinInstances'],
        },
        {
          id: 'idle-timeout',
          premise:
            'Cloud Run はリクエストの無いインスタンスを減らし、残す分も 15 分の待機の後に止める。止まった後に届いたリクエストはコンテナの起動を待つ（冷えた起動）',
          sourceIds: ['runAutoscaling'],
        },
        {
          id: 'cpu-outside-requests',
          premise:
            'リクエストで課金する設定では、リクエストを処理していない間の CPU は割り当てられない。応答の後に裏で処理を続けるなら（Next.js の ISR の作り直しなど）、最小インスタンスを 1 以上にするか、インスタンスで課金する設定にするよう公式は勧める',
          interpretation: {
            adopted:
              '裏の作り直しの時間も、アクティブな時間として課金に数える（作り直しが遅れる・止まる分は表さない）',
            rejected: [
              {
                reading: '裏の作り直しは課金されない',
                reason:
                  '作り直しが終わるにはどこかで CPU を使う。数えないと安く出すぎる',
              },
            ],
          },
          sourceIds: ['runAutoscaling', 'runMinInstances'],
        },
        {
          id: 'next-local-cache',
          premise:
            "Next.js を output: 'standalone' のコンテナで動かすと、ISR のキャッシュは既定でインスタンスごとのローカル（ディスク・メモリ）に置かれ、複数のインスタンスで共有されない。共有するには自分で cacheHandler（Redis・オブジェクトストレージなど）を書く。revalidatePath・revalidateTag は受けたインスタンスのキャッシュだけを消す",
          sourceIds: ['nextSelfHosting'],
        },
        {
          id: 'next-image',
          premise:
            'Next.js の next/image の画像の最適化は、next start（standalone のサーバー）でそのまま動き、コンテナの CPU で変換する',
          sourceIds: ['nextSelfHosting'],
        },
      ],
      meters: [
        {
          id: 'requests',
          label: 'リクエスト（Cloud Run: requests）',
          resource: 'requests',
          unit: 'request',
          allowancePool: 'run-free-requests',
          pricing: {
            model: 'flat',
            per: 1_000_000,
            unitPrice: RUN.requestsPerMillion,
          },
          sourceIds: ['runPricing'],
        },
        {
          id: 'cpu',
          label: 'CPU（アクティブ）（Cloud Run: CPU active time）',
          resource: 'cpu-hours',
          unit: 'second',
          allowancePool: 'run-free-cpu',
          pricing: {
            model: 'flat',
            per: 1,
            unitPrice: RUN.activeCpuPerVcpuSecond,
          },
          sourceIds: ['runPricing'],
        },
        {
          id: 'memory',
          label: 'メモリ（アクティブ）（Cloud Run: memory active time）',
          resource: 'memory-gb-hours',
          unit: 'gb-second',
          allowancePool: 'run-free-memory',
          pricing: {
            model: 'flat',
            per: 1,
            unitPrice: RUN.activeMemoryPerGiBSecond,
          },
          sourceIds: ['runPricing'],
        },
        {
          id: 'idle-cpu',
          label: 'CPU（最小インスタンスの待機）（Cloud Run: CPU idle time）',
          resource: 'idle-cpu-hours',
          unit: 'second',
          pricing: {
            model: 'flat',
            per: 1,
            unitPrice: RUN.idleCpuPerVcpuSecond,
          },
          sourceIds: ['runPricing'],
        },
        {
          id: 'idle-memory',
          label:
            'メモリ（最小インスタンスの待機）（Cloud Run: memory idle time）',
          resource: 'idle-memory-gb-hours',
          unit: 'gb-second',
          pricing: {
            model: 'flat',
            per: 1,
            unitPrice: RUN.idleMemoryPerGiBSecond,
          },
          sourceIds: ['runPricing'],
        },
        {
          id: 'logs',
          label: 'ログの取り込み（Cloud Logging: Cloud Run のログ）',
          resource: 'log-gb',
          unit: 'gb',
          allowancePool: 'logging-free',
          premise:
            'Cloud Run は要求ごとの要求ログ（request log）を自動で作り、コンテナの stdout・stderr と一緒に Cloud Logging に送る（Cloud Run の側では止められず、除外のフィルタで減らす）。取り込みは月 50 GiB を超えた分が $0.50 / GiB で、30 日の保存を含む。_Default のログバケットの保持は既定で 30 日なので、保持の費用はかからない（30 日を超えて残すと $0.01 / GiB 月）',
          interpretation: {
            adopted:
              'GiB の単価を GB（10^9 バイト）の量に当てる（量は 2 進より約 7% 多く数え、高めの側）',
            rejected: [
              {
                reading: '保持の設定を部品の選択肢にする',
                reason:
                  '既定の 30 日は無料で、延ばすのは利用者の判断（$0.01 / GiB 月は取り込みの 2%）。部品にするほどの差にならない',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.5 },
          sourceIds: ['loggingPricing', 'runLogging'],
        },
      ],
      notes: [
        '東京（asia-northeast1）は Tier 1。表の単価は us-central1 と同じ',
        'インスタンスで課金する設定（CPU $0.000018 / vCPU 秒・メモリ $0.000002 / GiB 秒。リクエストの料金なし・起動から終了まで課金）と確約の割引（CUD）は扱わない',
        'インスタンスの時間は 100 ms 単位で切り上げる（料金ページ）。このモデルは月の時間を連続の値で出し、切り上げは数えない',
      ],
    },
    {
      id: 'firebase-hosting',
      service: 'firebase-hosting',
      ...common,
      name: 'Firebase Hosting（Blaze）',
      sourceIds: ['hostingPricing', 'hostingUsage'],
      facts: [
        {
          id: 'cloud-run-rewrite',
          premise:
            'Firebase Hosting は書き換え（rewrites）で Cloud Run のサービスへリクエストを渡せ、東京（asia-northeast1）の Cloud Run にも対応する。Cloud Run を使うには請求先アカウントが要り、プロジェクトは Blaze になる。Hosting から Cloud Run への要求は 60 秒で打ち切られる',
          sourceIds: ['hostingCloudRun'],
        },
        {
          id: 'dynamic-cache',
          premise:
            'Cloud Run が返す動的な応答は、既定では CDN にキャッシュされない（Hosting が Cache-Control を private にする）。Cache-Control に public と s-maxage を付けると CDN がその秒数だけキャッシュする。Next.js は ISR のページに s-maxage を付ける',
          sourceIds: ['hostingCache', 'nextSelfHosting'],
        },
        {
          id: 'cache-cleared-on-deploy',
          premise:
            'Firebase Hosting の CDN のキャッシュは、サイトを新しくデプロイすると全体が消える。パスやタグを指定して消す方法は文書に無い（オンデマンドの再検証は CDN に届かない）',
          sourceIds: ['hostingCache'],
        },
        {
          id: 'session-cookie',
          premise:
            'Firebase Hosting から Cloud Run へ渡すリクエストは Cookie が外され、__session という名前の Cookie だけが通る（キャッシュの鍵にも入る）。ログインの Cookie はこの名前にする',
          sourceIds: ['hostingCache'],
        },
        {
          id: 'transfer-from-run',
          premise:
            'Cloud Run の料金ページは Cloud CDN・Media CDN・Cloud Load Balancing への転送を無料と書くが、Firebase Hosting への転送は挙げていない',
          interpretation: {
            adopted:
              'Cloud Run から Hosting への応答は Cloud Run のインターネットへの転送に数えない（利用者への転送は Hosting の転送として数える）',
            rejected: [
              {
                reading:
                  'Cloud Run から Hosting への応答もインターネットへの転送として課金される',
                reason:
                  'Hosting は Google の CDN で、応答は Google のネットワークの中で渡る。料金ページの「インターネットへの転送」に当たるとは書かれていない（確かめられない。安い側を採った）',
              },
            ],
          },
          sourceIds: ['runPricing', 'hostingCloudRun'],
        },
      ],
      meters: [
        {
          id: 'transfer',
          label: '転送（Firebase Hosting: data transfer）',
          resource: 'egress-gb',
          unit: 'gb',
          allowancePool: 'hosting-free-transfer',
          pricing: { model: 'flat', per: 1, unitPrice: 0.15 },
          sourceIds: ['hostingUsage', 'hostingPricing'],
        },
      ],
      notes: [
        '保存は 10 GB まで無料・以降 $0.026 / GB（デプロイした版も数える）。このモデルは静的なファイルの保存量を数えない',
        'リクエストの件数には料金が無い',
      ],
    },
    {
      id: 'cloud-storage-standard',
      service: 'cloud-storage',
      ...common,
      name: 'Cloud Storage（Standard・東京）',
      sourceIds: ['storagePricing'],
      facts: [],
      meters: [
        {
          id: 'storage',
          label: '保存（Cloud Storage: Standard storage）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: { model: 'flat', per: 1, unitPrice: 0.023 },
          sourceIds: ['storagePricing'],
        },
        {
          id: 'class-a',
          label: '書き込みの操作（Cloud Storage: Class A operations）',
          resource: 'object-writes',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.005 },
          sourceIds: ['storagePricing'],
        },
        {
          id: 'class-b',
          label: '読み取りの操作（Cloud Storage: Class B operations）',
          resource: 'object-reads',
          unit: 'operation',
          pricing: { model: 'flat', per: 1_000, unitPrice: 0.0004 },
          sourceIds: ['storagePricing'],
        },
      ],
      notes: [
        '常に無料の分（5 GB 月など）は米国のリージョンだけで、東京には当たらない',
        '同じリージョンの Google Cloud のサービス（Cloud Run）への転送は無料',
      ],
    },
    {
      id: 'firestore-standard',
      service: 'firestore',
      ...common,
      name: 'Firestore（Standard・東京）',
      sourceIds: ['firestorePricing'],
      facts: [
        {
          id: 'document-reads',
          premise:
            'Firestore はドキュメントの読み取り・書き込み・削除の件数と保存で課金し、問い合わせは返したドキュメントの数だけ読み取りに数える（結果が 0 件でも 1 件分）。同じリージョンの Cloud Run からの通信は無料',
          interpretation: {
            adopted:
              '1 回の問い合わせで返すドキュメントの数を、応答の大きさ ÷ 1 ドキュメントの大きさ（1 KB と仮定）の切り上げで数え、書く行 1 行を 1 回の書き込みと数える',
            rejected: [
              {
                reading: 'SQL の DB のように、走査した行の数だけ読み取る',
                reason:
                  'Firestore の問い合わせはインデックスで返したドキュメントだけを数える（料金ページ）',
              },
            ],
          },
          sourceIds: ['firestorePricing'],
        },
      ],
      meters: [
        {
          id: 'reads',
          label: 'ドキュメントの読み取り（Firestore: document reads）',
          resource: 'read-request-units',
          unit: 'operation',
          allowancePool: 'firestore-free-reads',
          pricing: { model: 'flat', per: 100_000, unitPrice: 0.038 },
          sourceIds: ['firestorePricing'],
        },
        {
          id: 'writes',
          label: 'ドキュメントの書き込み（Firestore: document writes）',
          resource: 'write-request-units',
          unit: 'operation',
          allowancePool: 'firestore-free-writes',
          pricing: { model: 'flat', per: 100_000, unitPrice: 0.115 },
          sourceIds: ['firestorePricing'],
        },
        {
          id: 'storage',
          label: '保存（Firestore: stored data）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          allowancePool: 'firestore-free-storage',
          pricing: { model: 'flat', per: 1, unitPrice: 0.115 },
          sourceIds: ['firestorePricing'],
        },
        {
          id: 'pitr',
          label: 'PITR（Firestore: PITR data）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          premise:
            'Firestore の PITR（直近 7 日の任意の時点に戻す）は既定で無効。有効にすると、DB の大きさに $0.000267123 / GiB 時（月 約 $0.195 / GiB。東京・無料の分なし）で課金する',
          interpretation: {
            adopted:
              '時間の単価 × 730 時間 = $0.195 / GiB 月を、DB の大きさ（GB）に当てる（GiB を GB で数え、量は約 7% 多めの側）',
            rejected: [],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.195 },
          sourceIds: ['firestorePricing', 'firestorePitr'],
        },
      ],
      notes: [
        '削除（10 万件 $0.013）・日次 / 週次のバックアップ（$0.038 / GiB 月）は数えない。PITR はバックアップの部品で選ぶ（D-93）',
        '無料の分は 1 日ごと（太平洋時間の真夜中にリセット）',
      ],
    },
    {
      id: 'cloud-sql-f1-micro',
      service: 'cloud-sql',
      ...common,
      name: 'Cloud SQL for PostgreSQL（db-f1-micro・東京）',
      sourceIds: ['sqlPricing'],
      facts: [
        {
          id: 'shared-core',
          premise:
            'Cloud SQL の db-f1-micro は共有の vCPU・メモリ 0.6 GiB の最小のインスタンスで、Cloud SQL の SLA の対象外。動いている秒ごとに課金し、問い合わせが無くても止まらない。同じリージョンへの転送は無料',
          interpretation: {
            adopted: '時間の単価（東京 $0.0122 / 時間）× 730 時間で数える',
            rejected: [
              {
                reading: '料金ページの月額の表示（$10.22 / 月）で数える',
                reason:
                  '同じページの時間の表示と月額の表示が 730 時間で合わない（$0.0122 × 730 = $8.91）。課金は秒ごとなので、時間の単価を採った',
              },
            ],
          },
          sourceIds: ['sqlPricing'],
        },
      ],
      meters: [
        {
          id: 'instance',
          label: 'インスタンス（Cloud SQL: db-f1-micro）',
          resource: 'instance-hours',
          unit: 'hour',
          pricing: { model: 'flat', per: 1, unitPrice: 0.0122 },
          sourceIds: ['sqlPricing'],
        },
        {
          id: 'storage',
          label: '保存（Cloud SQL: SSD storage capacity）',
          resource: 'storage-gb-month',
          unit: 'gb-month',
          pricing: { model: 'flat', per: 1, unitPrice: 0.221 },
          sourceIds: ['sqlPricing'],
        },
        {
          id: 'backup',
          label: 'バックアップ（Cloud SQL: backups used）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          premise:
            'Cloud SQL の自動バックアップは既定で 7 つ（1 日 1 つ）を残し、最初の 1 つは全体・以降は差分。使った量に $0.000142466 / GiB 時（月 約 $0.104 / GiB。東京）で課金する。コンソールで作った Enterprise のインスタンスは PITR も既定で有効（ログの保持 7 日）',
          interpretation: {
            adopted:
              'コンソールで作った既定（自動バックアップ 7 つ・PITR 有効）とみる。量は全体 1 つ + 7 日分の差分。PITR のログはインスタンスのディスクに置かれ、その分の大きさは数えない（ログの量の課金の記載が料金ページに無い）',
            rejected: [
              {
                reading: 'バックアップを数えない（前の扱い）',
                reason: '既定で有効で、使った量に課金される（D-93）',
              },
            ],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 0.104 },
          sourceIds: ['sqlPricing', 'sqlBackups', 'sqlBackingUp', 'sqlPitr'],
        },
      ],
      notes: [
        '保存は割り当てた量で課金する（自動で増やせるが減らせない）。最小の割り当ての量は確かめていない（使用量で数える）',
        '高可用性（HA は 2 倍）は数えない',
      ],
    },
    {
      id: 'internet-egress',
      service: 'networking',
      ...common,
      name: 'インターネットへの転送（Premium Tier・東京 → アジア）',
      sourceIds: ['networkPricing', 'runPricing'],
      facts: [
        {
          id: 'run-outbound',
          premise:
            'Cloud Run からインターネットへ送るデータは Premium Tier のネットワークの料金（東京 → アジアは 1 TiB まで $0.12 / GiB）で課金する。受け取るデータは無料',
          sourceIds: ['networkPricing', 'runPricing'],
        },
      ],
      meters: [
        {
          id: 'transfer',
          label: 'インターネットへの転送（Premium Tier: data transfer out）',
          resource: 'egress-gb',
          unit: 'gb',
          pricing: {
            model: 'tiered',
            per: 1,
            tiers: [
              { upTo: 1_024, unitPrice: 0.12 },
              { upTo: 10_240, unitPrice: 0.11 },
              { upTo: null, unitPrice: 0.085 },
            ],
          },
          sourceIds: ['networkPricing'],
        },
      ],
      notes: [
        '送り先はアジア（Cloudflare の東京の拠点）とみる。北米への 1 GiB の無料の分は当たらない',
      ],
    },
    // Cloud DNS（構成の DNS。D-96・prd/11 §21）
    {
      id: 'cloud-dns',
      service: 'cloud-dns',
      ...common,
      name: 'Cloud DNS',
      sourceIds: ['dnsPricing'],
      baseFee: {
        label: 'DNS のゾーン（Cloud DNS: managed zone）',
        amount: 0.000273973,
        per: 'hour',
        scope: 'node',
      },
      facts: [
        {
          id: 'no-free-tier',
          premise:
            'Cloud DNS に無料の分は無い。ゾーンは使っていなくても時間で課金される（1 アカウントで 25 ゾーンまで 1 時間 $0.000273973 = 月 約 $0.20）',
          sourceIds: ['dnsPricing'],
        },
        {
          id: 'hosting-no-dns',
          premise:
            'Firebase Hosting は DNS を持たない。独自のドメインは、使っている DNS の事業者に A・TXT のレコードを足してつなぐ',
          sourceIds: ['hostingDomain'],
        },
      ],
      meters: [
        {
          id: 'queries',
          label: 'DNS の問い合わせ（Cloud DNS: regular queries）',
          resource: 'dns-queries',
          unit: 'count',
          premise:
            'Cloud DNS の問い合わせは 100 万件 $0.40（月 10 億件まで）、それを超えた分は 100 万件 $0.20',
          pricing: {
            model: 'tiered',
            per: 1_000_000,
            tiers: [
              { upTo: 1_000_000_000, unitPrice: 0.4 },
              { upTo: null, unitPrice: 0.2 },
            ],
          },
          sourceIds: ['dnsPricing'],
        },
      ],
    },
  ],
  notes: [
    'Firebase Hosting・Firestore の無料の分はプロジェクトごと。このモデルはプロジェクトを 1 つとみて、アカウントで数える',
    '日本の利用者の Google Cloud の利用には消費税 10% がかかる（tax/japan.ts）',
    'GiB で書かれた単価をそのまま GB の量に当てる（他の事業者と同じ。差は 7%）',
  ],
};
