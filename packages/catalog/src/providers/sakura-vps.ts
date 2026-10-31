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
  resource: 'egress-gb',
  unit: 'gb',
  premise: 'さくらの VPS は転送量無制限（ただし回線は 100 Mbps の共有）',
  pricing: { model: 'flat', per: 1, unitPrice: 0 },
  sourceIds: ['spec'],
};

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
    storageOptionManual: {
      url: 'https://manual.sakura.ad.jp/vps/server/storage-change-option.html',
      retrievedAt: '2026-11-01',
    },
  },
  plans: [
    {
      id: '2gb-tokyo',
      service: 'vps',
      name: '2GB（東京）',
      baseFee: { amount: 1_958, per: 'month', scope: 'node' },
      sourceIds: ['spec'],
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
          id: 'scale-up',
          premise:
            'さくらの VPS の上位プランへの変更（スケールアップ）はサーバーを停止して行い、増えたディスクを OS に認識させる作業は利用者が行う（growpart・resize2fs など）',
          sourceIds: ['scaleup', 'diskExpansion'],
        },
      ],
      addons: [
        {
          id: 'storage-change',
          name: 'ストレージ変更オプション',
          oneTimeFee: 2_200,
          premise:
            'さくらの VPS のストレージ変更オプションは、変更手数料 2,200 円（税込）を一度だけ払い、月額はそのままでストレージを 100 GB から 200 GB に永続的に増やす（利用中のサーバーはスケールアップから申し込む。性能差が出る場合があると記載）',
          interpretation: {
            adopted:
              '戻せない（「永続的に増加させる」とあり、解約・戻す手順の記載なし）',
            rejected: [
              {
                reading: '後から外せる',
                reason: '外す・戻す方法の記載が無い',
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
      baseFee: { amount: 3_960, per: 'month', scope: 'node' },
      sourceIds: ['spec'],
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
          id: 'no-smaller-disk',
          premise:
            'さくらの VPS は、今よりディスク容量が少ないプランへは変更できない（下位のプランにするには契約し直してデータを移す）',
          sourceIds: ['scaleup'],
        },
      ],
      addons: [
        {
          id: 'storage-change',
          name: 'ストレージ変更オプション',
          oneTimeFee: 4_400,
          premise:
            'さくらの VPS のストレージ変更オプションは、変更手数料 4,400 円（税込）を一度だけ払い、月額はそのままでストレージを 200 GB から 400 GB に永続的に増やす（利用中のサーバーはスケールアップから申し込む。性能差が出る場合があると記載）',
          interpretation: {
            adopted:
              '戻せない（「永続的に増加させる」とあり、解約・戻す手順の記載なし）',
            rejected: [
              {
                reading: '後から外せる',
                reason: '外す・戻す方法の記載が無い',
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
  ],
};
