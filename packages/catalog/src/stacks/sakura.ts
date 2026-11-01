// さくらの VPS のホストのノード（D-13・D-24）。構成（index.ts の composeSakura）と、SPA の API を VPS に置く部品
// （cross.ts。D-67）で共有する。index.ts とは型だけを共有する（cross.ts から値を読むので、循環させない）。
import type { ArchitectureInput } from 'estimator';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** さくらの VPS の仕様。storageOptionDiskGB はストレージ変更オプションを付けたときのディスク（D-30・機能ページの表）。 */
export const SAKURA_HOST = {
  '2gb': { vcpu: 3, memoryGB: 2, diskGB: 100, storageOptionDiskGB: 200 },
  '4gb': { vcpu: 4, memoryGB: 4, diskGB: 200, storageOptionDiskGB: 400 },
} as const;

/** VPS（nginx・Node・MySQL を同居させる 1 台）。課金は月額の固定費で、使用量は容量の判定に使う。 */
export function vpsNode(
  plan: '2gb' | '4gb',
  storageOption: boolean,
  label: string,
  /** 画像もディスクに置くか（API だけを置く VPS は画像を Cloudflare の R2 に置く。D-67）。 */
  storesImages = true,
): ArchNodeIn {
  const { storageOptionDiskGB, ...spec } = SAKURA_HOST[plan];
  return {
    id: 'vps',
    label,
    config: {
      kind: 'host',
      ...spec,
      ...(storageOption ? { diskGB: storageOptionDiskGB } : {}),
      lineMbps: 100,
      residentMemoryGB: 1.35, // OS 0.3・MySQL 0.6・Node 0.4・nginx 0.05（仮定）
      dbCpuMsPerQuery: 0.3,
      imageTransformCpuMs: 150,
      otherDiskGB: 10,
      // nginx の TLS・転送の 1 リクエストあたりの CPU（仮定。D-31）
      proxyCpuMsPerRequest: 0.3,
      ...(storesImages ? {} : { storesImages: false }),
    },
    billing: {
      accountId: 'sakura',
      provider: 'sakura-vps',
      planId: `${plan}-tokyo`,
      meters: { 'egress-gb': 'transfer' },
    },
  };
}
