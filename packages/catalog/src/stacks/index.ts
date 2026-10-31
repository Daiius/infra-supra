// MVP の構成（prd/README のスコープ・prd/06 §4）。Next.js 系のアプリを 3 つのホストに載せた形。
// 振る舞いは estimator の ComponentKind、ここはノードの値と課金先のメーターの対応だけを持つ。
import type { ArchitectureInput } from 'estimator';

/** Cloudflare Workers + D1 + R2 + KV + Images に vinext で載せる（D-08）。 */
export function cloudflareVinext(plan: 'free' | 'paid'): ArchitectureInput {
  const workers = plan === 'free' ? 'workers-free' : 'workers-paid';
  const bill = (planId: string, meters: Record<string, string>) => ({
    accountId: 'cloudflare',
    provider: 'cloudflare',
    planId,
    meters,
  });
  return {
    id: `cloudflare-vinext-${plan}`,
    name: `Cloudflare ${plan === 'free' ? 'Free' : 'Paid'} + vinext`,
    nodes: [
      // 静的アセットは Workers を起動しないので無料・無制限（課金先なし）
      {
        id: 'assets',
        label: 'Workers 静的アセット',
        config: { kind: 'cdn', hitRate: { asset: 1, 'document-static': 1 } },
      },
      {
        id: 'worker',
        label: 'Worker（vinext）',
        config: {
          kind: 'function',
          // ⚠ 未確認: vinext の ISR の再生成は閲覧のリクエストの中で裏で走る（stale-while-revalidate）と仮定
          backgroundClasses: ['isr-revalidate'],
        },
        billing: bill(workers, { requests: 'requests', 'cpu-ms': 'cpu-ms' }),
      },
      {
        id: 'kv',
        label: 'KV（ISR のキャッシュ）',
        config: { kind: 'kv' },
        billing: bill(workers, {
          'kv-reads': 'kv-reads',
          'kv-writes': 'kv-writes',
        }),
      },
      {
        id: 'd1',
        label: 'D1',
        config: { kind: 'sql-db' },
        billing: bill(workers, {
          'rows-read': 'd1-rows-read',
          'rows-written': 'd1-rows-written',
          ...(plan === 'paid' ? { 'storage-gb-month': 'd1-storage' } : {}),
        }),
      },
      {
        id: 'r2-cache',
        label: 'R2 公開バケットのキャッシュ',
        config: { kind: 'cdn', hitRate: { 'image-read': 0.9 } },
      },
      {
        id: 'r2',
        label: 'R2',
        config: { kind: 'object-storage' },
        billing: bill('r2-standard', {
          'storage-gb-month': 'storage',
          'object-writes': 'class-a',
          'object-reads': 'class-b',
          'egress-gb': 'egress',
        }),
      },
      {
        id: 'images',
        label: 'Images（バインディング）',
        config: { kind: 'image-optimizer' },
        billing: bill(plan === 'free' ? 'images-free' : 'images-paid', {
          'image-transformations': 'transformations',
        }),
      },
    ],
    routes: {
      'document-static': ['assets'],
      asset: ['assets'],
      'document-ssr': ['worker', 'd1'],
      // vinext の ISR は KV のキャッシュハンドラ: 閲覧のたびに Worker が動き KV を読む（spike 所見 4）
      'document-isr': ['worker', 'kv'],
      'isr-revalidate': ['worker', 'kv', 'd1'],
      api: ['worker', 'd1'],
      'image-read': ['r2-cache', 'r2'],
      'image-write': ['worker', 'r2'],
      'image-transform': ['images'],
    },
  };
}

/** Vercel に Next.js をネイティブで載せ、DB は Supabase。 */
export function vercelSupabase(plan: 'hobby' | 'pro'): ArchitectureInput {
  const v = (meters: Record<string, string>) => ({
    accountId: 'vercel',
    provider: 'vercel',
    planId: plan,
    meters,
  });
  return {
    id: `vercel-supabase-${plan}`,
    name:
      plan === 'hobby'
        ? 'Vercel Hobby + Supabase Free'
        : 'Vercel Pro + Supabase Pro',
    nodes: [
      {
        id: 'cdn',
        label: 'Vercel CDN',
        config: {
          kind: 'cdn',
          hitRate: {
            asset: 1,
            'document-static': 1,
            'document-isr': 0.8,
            'image-read': 0.9,
          },
          // Fast Origin Transfer は Functions・Middleware・Blob・Data Cache（ISR）で発生（画像最適化は挙がっていない）
          originClasses: ['document-ssr', 'document-isr', 'api'],
        },
        billing: v({
          requests: 'cdn-requests',
          'egress-gb': 'fast-data-transfer',
          'origin-transfer-gb': 'fast-origin-transfer',
        }),
      },
      {
        id: 'fn',
        label: 'Vercel Functions（Fluid）',
        config: { kind: 'function', memoryGB: 2, concurrency: 1 },
        billing: v({
          invocations: 'invocations',
          'cpu-ms': 'active-cpu',
          'memory-gb-hours': 'provisioned-memory',
        }),
      },
      {
        id: 'isr',
        label: 'ISR の永続ストレージ',
        config: { kind: 'isr-store', unitKB: 8, changedRate: 0.1 },
        billing: v({ 'isr-reads': 'isr-reads', 'isr-writes': 'isr-writes' }),
      },
      {
        id: 'image',
        label: '画像の最適化',
        // CDN の miss だけが届くので、届いた読み取りはすべて共有キャッシュまで行く
        config: { kind: 'image-optimizer', unitKB: 8, cacheMissRate: 1 },
        billing: v({
          'image-transformations': 'image-transformations',
          'image-cache-reads': 'image-cache-reads',
          'image-cache-writes': 'image-cache-writes',
        }),
      },
      // 画像の原本の置き場所（Vercel Blob など）は料金を取得していない。課金先なしで残し、見積に「対応なし」として出す
      {
        id: 'blob',
        label: '画像の原本（置き場所は未定）',
        config: { kind: 'object-storage' },
      },
      {
        id: 'db',
        label: plan === 'hobby' ? 'Supabase Free' : 'Supabase Pro（Micro）',
        config: { kind: 'managed-db' },
        billing: {
          accountId: 'supabase',
          provider: 'supabase',
          planId: plan === 'hobby' ? 'free' : 'pro-micro',
          meters:
            plan === 'hobby'
              ? { 'egress-gb': 'egress' }
              : {
                  'instance-hours': 'compute',
                  'egress-gb': 'egress',
                  'storage-gb-month': 'disk',
                },
        },
      },
    ],
    routes: {
      'document-static': ['cdn'],
      asset: ['cdn'],
      'document-ssr': ['cdn', 'fn', 'db'],
      'document-isr': ['cdn', 'isr'],
      'isr-revalidate': ['fn', 'isr', 'db'],
      api: ['cdn', 'fn', 'db'],
      'image-read': ['cdn', 'image'],
      'image-write': ['fn', 'blob'],
      'image-transform': ['image'],
    },
  };
}

/** さくらの VPS 2GB に nginx・next start・MySQL を同居させる（D-13）。 */
export function sakuraVps(): ArchitectureInput {
  return {
    id: 'sakura-vps-2gb',
    name: 'さくらの VPS 2GB（東京）',
    nodes: [
      {
        id: 'vps',
        label: 'VPS（nginx + next start + MySQL）',
        config: {
          kind: 'host',
          vcpu: 3,
          memoryGB: 2,
          diskGB: 100,
          lineMbps: 100,
          residentMemoryGB: 1.35, // OS 0.3・MySQL 0.6・Node 0.4・nginx 0.05（仮定）
          dbCpuMsPerQuery: 0.3,
          imageTransformCpuMs: 150,
          otherDiskGB: 10,
        },
        billing: {
          accountId: 'sakura',
          provider: 'sakura-vps',
          planId: '2gb-tokyo',
          meters: { 'egress-gb': 'transfer' },
        },
      },
    ],
    routes: {
      'document-static': ['vps'],
      asset: ['vps'],
      'document-ssr': ['vps'],
      'document-isr': ['vps'],
      'isr-revalidate': ['vps'],
      api: ['vps'],
      'image-read': ['vps'],
      'image-write': ['vps'],
      'image-transform': ['vps'],
    },
  };
}

export const MVP_STACKS = [
  cloudflareVinext('free'),
  cloudflareVinext('paid'),
  vercelSupabase('hobby'),
  vercelSupabase('pro'),
  sakuraVps(),
];
