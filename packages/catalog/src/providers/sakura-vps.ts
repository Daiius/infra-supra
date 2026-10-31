// さくらの VPS。MVP は 2GB（東京）の 1 プランに固定（D-13）。2026-10-31 に公式ページから取得。JPY・税込。
import type { PriceBookInput } from 'estimator';

const R = '2026-10-31';
const src = (url: string) => ({ url, retrievedAt: R });

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
  },
  plans: [
    {
      id: '2gb-tokyo',
      service: 'vps',
      name: '2GB（東京）',
      baseFee: { amount: 1_958, per: 'month', scope: 'node' },
      sourceIds: ['spec'],
      members: {
        pricing: 'not-stated',
        premise:
          'さくらの VPS の仕様のページに、メンバー（複数ユーザー）の料金の記載なし',
        sourceIds: ['spec'],
      },
      meters: [
        {
          id: 'transfer',
          resource: 'egress-gb',
          unit: 'gb',
          premise:
            'さくらの VPS は転送量無制限（ただし回線は 100 Mbps の共有）',
          pricing: { model: 'flat', per: 1, unitPrice: 0 },
          sourceIds: ['spec'],
        },
      ],
      notes: [
        '3 vCPU・メモリ 2 GB・SSD 100 GB・回線 100 Mbps 共有',
        '2GB プランは SLA 非対応（4GB 以上が対応）',
        '最低利用期間 3 か月。月払いは前払いで、初回に 2 か月分を請求',
      ],
    },
  ],
};
