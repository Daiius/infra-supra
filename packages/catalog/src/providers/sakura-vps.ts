// さくらの VPS。2GB（東京）（D-13）と、SLA の出来事のための 4GB（東京）（D-24）。2026-10-31 に公式ページから取得。JPY・税込。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

type PlanInput = PriceBookInput['plans'][number];

const MEMBERS: PlanInput['members'] = {
  pricing: 'not-stated',
  premise:
    'さくらの VPS の仕様のページに、メンバー（複数ユーザー）の料金の記載なし',
  sourceIds: ['spec'],
};

const TRANSFER: PlanInput['meters'][number] = {
  id: 'transfer',
  label: '転送量（さくらの VPS: 転送量無制限）',
  resource: 'egress-gb',
  unit: 'gb',
  premise:
    'さくらの VPS は転送量無制限（ただし回線は 100 Mbps の共有）。転送の大きさは圧縮後で数えます（D-211）。nginx の gzip は既定で off（gzip_types の既定も text/html だけ）なので、JS・CSS・JSON も圧縮して配る設定にしている前提です。next start は既定で gzip で圧縮します。@astrojs/node が自分で圧縮するかは未確認です',
  pricing: { model: 'flat', per: 1, unitPrice: 0 },
  sourceIds: ['spec', 'nginxGzip', 'nextCompress'],
};

/** 年額（12 か月一括。月額の 11 か月分）の支払い（D-97）。 */
const annual = (
  plan: string,
  upfront: number,
): NonNullable<PlanInput['commitments']>[number] => ({
  id: 'annual',
  label: `年額（さくらの VPS ${plan}・12 か月一括）`,
  kind: 'prepay',
  termMonths: 12,
  payments: [{ payment: 'all-upfront', upfront }],
  premise: `さくらの VPS ${plan} は 12 か月一括で払うと年額 ${upfront.toLocaleString('en-US')} 円です（税込。月額の約 11 か月分）。12 か月一括のままスケールアップすると、上位のプランの 1 年分から今のプランの使っていない分を引いた額を払います`,
  interpretation: {
    adopted:
      '途中で解約・乗り換えても払った年額は戻らないとみます。スケールアップは月の単位で使っていない分を引きます（公式は日割り・税抜の年額 / 契約日数）',
    rejected: [
      {
        reading: '解約すると使っていない月の分が戻る',
        reason:
          '仕様・マニュアルに返金の記載がありません（確かめられない分は戻らない側に置いた）',
      },
    ],
  },
  sourceIds: ['specAnnual', 'scaleupAnnual'],
});

/**
 * 解析の worker に使う大きいプラン（東京・月額・税込。仕様のページ 2026-11-25。D-247）。年額（12 か月一括）は確かめていないので
 * 確約は入れない。
 */
export const SAKURA_LARGE = [
  { plan: '8gb', vcpu: 6, memoryGB: 8, diskGB: 400, monthly: 7_920 },
  { plan: '16gb', vcpu: 8, memoryGB: 16, diskGB: 800, monthly: 15_400 },
  { plan: '32gb', vcpu: 10, memoryGB: 32, diskGB: 1_600, monthly: 30_800 },
] as const;

export const sakuraVps: PriceBookInput = {
  schemaVersion: 1,
  provider: 'sakura-vps',
  version: R,
  status: 'official',
  currency: 'JPY',
  taxIncluded: true,
  retrievedAt: R,
  sources: {
    spec: src('https://vps.sakura.ad.jp/specification/'),
    // 大きいプラン（8GB・16GB・32GB）の月額と仮想コアの数（2026-11-25 に確認。D-247。2GB・4GB の月額も同じ値だった）
    specLarge: {
      url: 'https://vps.sakura.ad.jp/specification/',
      retrievedAt: '2026-11-25',
    },
    // 圧縮の既定（2026-11-11 に原文で確認。D-211）: nginx の gzip は「Default: gzip off;」、next start は既定で gzip
    nginxGzip: {
      url: 'https://nginx.org/en/docs/http/ngx_http_gzip_module.html',
      retrievedAt: '2026-11-11',
    },
    nextCompress: {
      url: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/compress',
      retrievedAt: '2026-11-11',
    },
    // Astro の記事を Node のメモリにキャッシュする形（2026-11-03 に原文で確認。D-103）
    astroCaching: {
      url: 'https://docs.astro.build/en/guides/caching/',
      retrievedAt: '2026-11-03',
    },
    flow: src('https://vps.sakura.ad.jp/flow/'),
    sla: src('https://vps.sakura.ad.jp/sla/'),
    // プランの変更（2026-11-01 に原文で確認。D-27）
    scaleup: {
      url: 'https://manual.sakura.ad.jp/vps/server/scaleup.html',
      retrievedAt: '2026-11-01',
    },
    diskExpansion: {
      url: 'https://manual.sakura.ad.jp/vps/server/disk-expansion/index.html',
      retrievedAt: '2026-11-01',
    },
    // ストレージ変更オプション（2026-11-01 に原文で確認。D-30）
    storageOption: {
      url: 'https://vps.sakura.ad.jp/functions/storage-change-option/',
      retrievedAt: '2026-11-01',
    },
    // Next.js のセルフホストのキャッシュ（さくらの文書ではないが、VPS の前提として一緒に持つ。D-32）
    nextSelfHosting: {
      url: 'https://nextjs.org/docs/app/guides/self-hosting',
      retrievedAt: '2026-11-01',
    },
    storageOptionManual: {
      url: 'https://manual.sakura.ad.jp/vps/server/storage-change-option.html',
      retrievedAt: '2026-11-01',
    },
    // バックアップ（2026-11-02 取得。D-93）。VPS にバックアップの機能は無く、自前でオブジェクトストレージに送る
    vpsBackupFaq: {
      url: 'https://manual.sakura.ad.jp/vps/support/others.html',
      retrievedAt: '2026-11-02',
    },
    // 年額（12 か月一括）の料金と、12 か月一括のスケールアップの差額（2026-11-02 に原文で確認。D-97）
    specAnnual: {
      url: 'https://vps.sakura.ad.jp/specification/',
      retrievedAt: '2026-11-02',
    },
    scaleupAnnual: {
      url: 'https://manual.sakura.ad.jp/vps/server/scaleup.html',
      retrievedAt: '2026-11-02',
    },
    objectStorage: {
      url: 'https://cloud.sakura.ad.jp/products/object-storage/',
      retrievedAt: '2026-11-02',
    },
  },
  allowancePools: [
    {
      id: 'object-storage-included',
      quantity: 100,
      unit: 'gb-month',
      period: 'month',
      scope: 'node',
      premise:
        'さくらのオブジェクトストレージ（標準プラン）は月額 495 円に保存 100 GiB まで込み（バケットごと）',
      sourceIds: ['objectStorage'],
    },
  ],
  plans: [
    {
      // さくらのクラウドのオブジェクトストレージ（標準プラン・バケットごと）。VPS の DB のバックアップの置き場（D-93）
      id: 'object-storage',
      service: 'object-storage',
      name: 'オブジェクトストレージ（標準プラン）',
      baseFee: {
        label: '月額料金（さくらのオブジェクトストレージ: 標準プラン）',
        amount: 495,
        per: 'month',
        scope: 'node',
      },
      sourceIds: ['objectStorage'],
      notes: [
        '標準プランはバケットごとに月 495 円（税込）で、保存 100 GiB・転送 10 GiB・リクエスト 10 万・オブジェクト 10 万まで込み',
        'バックアップを送る（書き込み）だけなら転送の課金はありません（課金はさくらの外への GET だけ）。リクエスト・オブジェクトの数は 1 日数件で、込みの分に収まるので数えません',
      ],
      meters: [
        {
          id: 'storage',
          label: '保存（さくらのオブジェクトストレージ: 追加の容量）',
          resource: 'backup-gb-month',
          unit: 'gb-month',
          allowancePool: 'object-storage-included',
          premise:
            'さくらのオブジェクトストレージ（標準プラン）は 100 GiB まで込みで、超えると 10 GiB ごとに 49.5 円（税込）',
          interpretation: {
            adopted:
              '10 GiB 49.5 円を 1 GB 4.95 円の比例で数え、GiB を GB で数えます（10 GiB の区切りの切り上げは数えない）',
            rejected: [],
          },
          pricing: { model: 'flat', per: 1, unitPrice: 4.95 },
          sourceIds: ['objectStorage'],
        },
      ],
    },
    {
      id: '2gb-tokyo',
      service: 'vps',
      name: '2GB（東京）',
      baseFee: {
        label: '月額料金（さくらの VPS 2GB）',
        amount: 1_958,
        per: 'month',
        scope: 'node',
      },
      sourceIds: ['spec'],
      commitments: [annual('2GB', 21_538)],
      members: MEMBERS,
      uptimeSla: {
        status: 'none',
        premise:
          'さくらの VPS 2GB は SLA の対象外（対象はメモリ 4 GB 以上かつ V5 以上の Linux のプラン）',
        sourceIds: ['spec', 'sla'],
      },
      meters: [TRANSFER],
      facts: [
        {
          // WebSocket（D-240）
          id: 'websocket-resident',
          premise:
            'さくらの VPS は月額の定額なので、WebSocket の接続を常駐のプロセスで保っても追加の料金はかかりません。接続は時間で切られず、盤面はプロセスのメモリに置けます。代わりに、同時接続の数とメモリ・CPU は VPS の大きさで頭打ちになり、VPS が止まるとつながっている全員が切れます',
          sourceIds: ['spec'],
        },
        {
          id: 'next-fs-cache',
          premise:
            'Next.js の ISR のキャッシュは、next start 1 台・永続ディスクなら自動で動きます（CDN を前に置くときや複数台では設定が要る）',
          sourceIds: ['nextSelfHosting'],
        },
        {
          id: 'astro-memory-cache',
          premise:
            'Astro の route caching（astro@7.0.0）は Node 向けにメモリのキャッシュ（memoryCache()）を組み込みで持ち、cache.invalidate でタグ・パス（完全一致）を消せます。1 台の Node のメモリなので、再起動で消えます',
          sourceIds: ['astroCaching'],
        },
        {
          id: 'scale-up',
          premise:
            'さくらの VPS の上位プランへの変更（スケールアップ）はサーバーを停止して行い、増えたディスクを OS に認識させる作業は利用者が行います（growpart・resize2fs など）',
          sourceIds: ['scaleup', 'diskExpansion'],
        },
      ],
      addons: [
        {
          id: 'storage-change',
          label:
            'ストレージ変更の手数料（さくらの VPS: ストレージ変更オプション・一度だけ）',
          name: 'ストレージ変更オプション',
          oneTimeFee: 2_200,
          premise:
            'さくらの VPS のストレージ変更オプションは、変更手数料 2,200 円（税込）を一度だけ払い、月額はそのままでストレージを 100 GB から 200 GB に永続的に増やします（利用中のサーバーはスケールアップから申し込む。性能差が出る場合があると記載）',
          interpretation: {
            adopted:
              '戻せない（「永続的に増加させる」とあり、解約・戻す手順の記載なし）',
            rejected: [
              {
                reading: '後から外せる',
                reason: '外す・戻す方法の記載がありません',
              },
            ],
          },
          sourceIds: ['storageOption', 'storageOptionManual'],
        },
      ],
      notes: [
        '3 vCPU・メモリ 2 GB・SSD 100 GB・回線 100 Mbps 共有',
        '最低利用期間 3 か月。月払いは前払いで、初回に 2 か月分を請求',
      ],
    },
    {
      id: '4gb-tokyo',
      service: 'vps',
      name: '4GB（東京）',
      baseFee: {
        label: '月額料金（さくらの VPS 4GB）',
        amount: 3_960,
        per: 'month',
        scope: 'node',
      },
      sourceIds: ['spec'],
      commitments: [annual('4GB', 43_560)],
      members: MEMBERS,
      uptimeSla: {
        status: 'offered',
        percent: 99.95,
        premise:
          'さくらの VPS 4GB は月の稼働率 99.95% の SLA の対象（満たさない分の利用料金を減額。仮想マシン単位の障害は対象外）',
        sourceIds: ['spec', 'sla'],
      },
      meters: [TRANSFER],
      facts: [
        {
          // WebSocket（D-240）
          id: 'websocket-resident',
          premise:
            'さくらの VPS は月額の定額なので、WebSocket の接続を常駐のプロセスで保っても追加の料金はかかりません。接続は時間で切られず、盤面はプロセスのメモリに置けます。代わりに、同時接続の数とメモリ・CPU は VPS の大きさで頭打ちになり、VPS が止まるとつながっている全員が切れます',
          sourceIds: ['spec'],
        },
        {
          id: 'next-fs-cache',
          premise:
            'Next.js の ISR のキャッシュは、next start 1 台・永続ディスクなら自動で動きます（CDN を前に置くときや複数台では設定が要る）',
          sourceIds: ['nextSelfHosting'],
        },
        {
          id: 'astro-memory-cache',
          premise:
            'Astro の route caching（astro@7.0.0）は Node 向けにメモリのキャッシュ（memoryCache()）を組み込みで持ち、cache.invalidate でタグ・パス（完全一致）を消せます。1 台の Node のメモリなので、再起動で消えます',
          sourceIds: ['astroCaching'],
        },
        {
          id: 'no-smaller-disk',
          premise:
            'さくらの VPS は、今よりディスク容量が少ないプランへは変更できません（下位のプランにするには契約し直してデータを移す）',
          sourceIds: ['scaleup'],
        },
      ],
      addons: [
        {
          id: 'storage-change',
          label:
            'ストレージ変更の手数料（さくらの VPS: ストレージ変更オプション・一度だけ）',
          name: 'ストレージ変更オプション',
          oneTimeFee: 4_400,
          premise:
            'さくらの VPS のストレージ変更オプションは、変更手数料 4,400 円（税込）を一度だけ払い、月額はそのままでストレージを 200 GB から 400 GB に永続的に増やします（利用中のサーバーはスケールアップから申し込む。性能差が出る場合があると記載）',
          interpretation: {
            adopted:
              '戻せない（「永続的に増加させる」とあり、解約・戻す手順の記載なし）',
            rejected: [
              {
                reading: '後から外せる',
                reason: '外す・戻す方法の記載がありません',
              },
            ],
          },
          sourceIds: ['storageOption', 'storageOptionManual'],
        },
      ],
      notes: [
        '4 vCPU・メモリ 4 GB・SSD 200 GB（400 GB に変更可）・回線 100 Mbps 共有',
        '最低利用期間 3 か月（さくらの VPS 全体）',
      ],
    },
    // ---- 解析の worker に使う大きいプラン（棋譜解析。D-247・prd/17 §5.6） ----
    ...SAKURA_LARGE.map((l): PlanInput => ({
      id: `${l.plan}-tokyo`,
      service: 'vps',
      name: `${l.plan.toUpperCase()}（東京）`,
      baseFee: {
        label: `月額料金（さくらの VPS ${l.plan.toUpperCase()}）`,
        amount: l.monthly,
        per: 'month',
        scope: 'node',
      },
      sourceIds: ['specLarge'],
      members: MEMBERS,
      uptimeSla: {
        status: 'offered',
        percent: 99.95,
        premise: `さくらの VPS ${l.plan.toUpperCase()} は月の稼働率 99.95% の SLA の対象（メモリ 4 GB 以上のプラン。満たさない分の利用料金を減額。仮想マシン単位の障害は対象外）`,
        sourceIds: ['specLarge', 'sla'],
      },
      meters: [TRANSFER],
      notes: [
        `仮想 ${l.vcpu} コア・メモリ ${l.memoryGB} GB・SSD ${l.diskGB} GB・回線 100 Mbps 共有`,
        '年額（12 か月一括）は確かめていないので、確約は入れていません',
      ],
    })),
  ],
};
