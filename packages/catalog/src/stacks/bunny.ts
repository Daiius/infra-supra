// Bunny（bunny.net）のノード（D-98・prd/11 §23）。画像のドメイン（cross.ts）と前段の CDN（aws.ts・index.ts のさくらの VPS）で共通。
// 値は estimator の型だけに依存する（stacks の他のファイルを読まないので、循環しない）。
import type { ArchitectureInput, RequestClass } from 'estimator';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** Bunny CDN の画像のキャッシュのヒット率（仮定。Cloudflare の画像のドメイン・土台の CDN と同じ値）。 */
export const BUNNY_IMAGE_HIT_RATE = 0.9;

/** Bunny の課金先（standard: CDN + Storage・optimizer: Optimizer の月額）。 */
export const bunnyBill = (
  planId: 'standard' | 'optimizer',
  meters: Record<string, string>,
) => ({
  accountId: 'bunny',
  provider: 'bunny',
  planId,
  meters,
});

/** Bunny CDN の Pull Zone のノード（画像のドメイン・前段の CDN で共通）。 */
export function bunnyCdnNode(
  id: string,
  label: string,
  hitRate: Partial<Record<RequestClass, number>>,
): ArchNodeIn {
  return {
    id,
    label,
    config: { kind: 'cdn', hitRate },
    facts: ['pull-zone-origin', 'asia-rate', 'monthly-minimum'],
    billing: bunnyBill('standard', { 'egress-gb': 'bandwidth' }),
  };
}
