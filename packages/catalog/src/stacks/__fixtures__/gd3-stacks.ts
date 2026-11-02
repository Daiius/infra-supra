// GD-3 までの完成品の構成（組み立てる形にする前の値）。既定の選択で組み立てた構成が、これと同じであることを確かめる（prd/07 §11.7）。
export const GD3_STACKS: unknown[] = [
  {
    id: 'cloudflare-vinext-free',
    name: 'Cloudflare Free + vinext',
    nodes: [
      {
        id: 'assets',
        label: 'Workers 静的アセット',
        config: {
          kind: 'cdn',
          hitRate: {
            asset: 1,
            'document-static': 1,
          },
        },
      },
      {
        id: 'worker',
        label: 'Worker（vinext）',
        config: {
          kind: 'function',
          backgroundClasses: ['isr-revalidate'],
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-free',
          meters: {
            requests: 'requests',
            'cpu-ms': 'cpu-ms',
          },
        },
      },
      {
        id: 'kv',
        label: 'KV（ISR のキャッシュ）',
        config: {
          kind: 'kv',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-free',
          meters: {
            'kv-reads': 'kv-reads',
            'kv-writes': 'kv-writes',
          },
        },
      },
      {
        id: 'd1',
        label: 'D1',
        config: {
          kind: 'sql-db',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-free',
          meters: {
            'rows-read': 'd1-rows-read',
            'rows-written': 'd1-rows-written',
          },
        },
      },
      {
        id: 'r2-cache',
        label: 'R2 公開バケットのキャッシュ',
        config: {
          kind: 'cdn',
          hitRate: {
            'image-read': 0.9,
          },
        },
      },
      {
        id: 'r2',
        label: 'R2',
        config: {
          kind: 'object-storage',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'r2-standard',
          meters: {
            'storage-gb-month': 'storage',
            'object-writes': 'class-a',
            'object-reads': 'class-b',
            'egress-gb': 'egress',
          },
        },
      },
      {
        id: 'images',
        label: 'Images（バインディング）',
        config: {
          kind: 'image-optimizer',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'images-free',
          meters: {
            'image-transformations': 'transformations',
          },
        },
      },
      // メールの送信（D-95）
      {
        id: 'email',
        label: 'Amazon SES（メールの送信）',
        config: { kind: 'email-sender' },
        billing: {
          accountId: 'aws',
          provider: 'aws',
          planId: 'ses',
          meters: { emails: 'outbound' },
        },
      },
    ],
    routes: {
      'document-static': ['assets'],
      asset: ['assets'],
      'document-ssr': ['worker', 'd1'],
      'document-isr': ['worker', 'kv'],
      'isr-revalidate': ['worker', 'kv', 'd1'],
      api: ['worker', 'd1'],
      'image-read': ['r2-cache', 'r2'],
      'image-write': ['worker', 'r2'],
      'image-transform': ['images'],
    },
  },
  {
    id: 'cloudflare-vinext-paid',
    name: 'Cloudflare Paid + vinext',
    nodes: [
      {
        id: 'assets',
        label: 'Workers 静的アセット',
        config: {
          kind: 'cdn',
          hitRate: {
            asset: 1,
            'document-static': 1,
          },
        },
      },
      {
        id: 'worker',
        label: 'Worker（vinext）',
        config: {
          kind: 'function',
          backgroundClasses: ['isr-revalidate'],
          // Workers Logs（D-92）・Cloudflare Observability の量と保存（D-94）
          logs: {
            eventsPerInvocation: 2,
            kbPerInvocation: 1.5,
            retentionDays: 7,
          },
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-paid',
          meters: {
            requests: 'requests',
            'cpu-ms': 'cpu-ms',
            'log-events': 'workers-logs',
            'log-gb': 'observability-ingest',
            'log-gb-month': 'observability-storage',
          },
        },
      },
      {
        id: 'kv',
        label: 'KV（ISR のキャッシュ）',
        config: {
          kind: 'kv',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-paid',
          meters: {
            'kv-reads': 'kv-reads',
            'kv-writes': 'kv-writes',
          },
        },
      },
      {
        id: 'd1',
        label: 'D1',
        config: {
          kind: 'sql-db',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-paid',
          meters: {
            'rows-read': 'd1-rows-read',
            'rows-written': 'd1-rows-written',
            'storage-gb-month': 'd1-storage',
          },
        },
      },
      {
        id: 'r2-cache',
        label: 'R2 公開バケットのキャッシュ',
        config: {
          kind: 'cdn',
          hitRate: {
            'image-read': 0.9,
          },
        },
      },
      {
        id: 'r2',
        label: 'R2',
        config: {
          kind: 'object-storage',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'r2-standard',
          meters: {
            'storage-gb-month': 'storage',
            'object-writes': 'class-a',
            'object-reads': 'class-b',
            'egress-gb': 'egress',
          },
        },
      },
      {
        id: 'images',
        label: 'Images（バインディング）',
        config: {
          kind: 'image-optimizer',
        },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'images-paid',
          meters: {
            'image-transformations': 'transformations',
          },
        },
      },
      // メールの送信（D-95）
      {
        id: 'email',
        label: 'Email Service（メールの送信）',
        config: { kind: 'email-sender' },
        billing: {
          accountId: 'cloudflare',
          provider: 'cloudflare',
          planId: 'workers-paid',
          meters: { emails: 'email-sending' },
        },
      },
    ],
    routes: {
      'document-static': ['assets'],
      asset: ['assets'],
      'document-ssr': ['worker', 'd1'],
      'document-isr': ['worker', 'kv'],
      'isr-revalidate': ['worker', 'kv', 'd1'],
      api: ['worker', 'd1'],
      'image-read': ['r2-cache', 'r2'],
      'image-write': ['worker', 'r2'],
      'image-transform': ['images'],
    },
  },
  {
    id: 'vercel-supabase-hobby',
    name: 'Vercel Hobby + Supabase Free',
    nodes: [
      {
        id: 'cdn',
        label: 'Vercel CDN',
        config: {
          kind: 'cdn',
          hitRate: {
            asset: 1,
            'document-static': 1,
            'image-read': 0.9,
          },
          // D-37: ISR のページのヒット率は固定の 0.8 をやめ、再生成の数と同じ式（閲覧の密度 × 再検証の間隔）から出す
          ttlClasses: ['document-isr'],
          originClasses: ['document-ssr', 'document-isr', 'api'],
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'hobby',
          meters: {
            requests: 'cdn-requests',
            'egress-gb': 'fast-data-transfer',
            'origin-transfer-gb': 'fast-origin-transfer',
          },
        },
      },
      {
        id: 'fn',
        label: 'Vercel Functions（Fluid）',
        config: {
          kind: 'function',
          memoryGB: 2,
          concurrency: 1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'hobby',
          meters: {
            invocations: 'invocations',
            'cpu-ms': 'active-cpu',
            'memory-gb-hours': 'provisioned-memory',
          },
        },
      },
      {
        id: 'isr',
        label: 'ISR の永続ストレージ',
        config: {
          kind: 'isr-store',
          unitKB: 8,
          changedRate: 0.1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'hobby',
          meters: {
            'isr-reads': 'isr-reads',
            'isr-writes': 'isr-writes',
          },
        },
      },
      {
        id: 'image',
        label: '画像の最適化',
        config: {
          kind: 'image-optimizer',
          unitKB: 8,
          cacheMissRate: 1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'hobby',
          meters: {
            'image-transformations': 'image-transformations',
            'image-cache-reads': 'image-cache-reads',
            'image-cache-writes': 'image-cache-writes',
          },
        },
      },
      // D-46: 置き場所が未定（課金先なし）だった画像の原本を Vercel Blob にした
      {
        id: 'blob',
        label: 'Vercel Blob（画像の原本）',
        // OCL-2AE853BD: Blob の URL から直接配信する（CDN のヒット率で操作と origin への転送を数える）
        config: {
          kind: 'object-storage',
          cdnHitRate: 0.9,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'hobby',
          meters: {
            'storage-gb-month': 'blob-storage',
            'object-writes': 'blob-advanced-operations',
            'object-reads': 'blob-simple-operations',
            'egress-gb': 'blob-data-transfer',
            requests: 'cdn-requests',
            'origin-transfer-gb': 'fast-origin-transfer',
          },
        },
      },
      {
        id: 'db',
        label: 'Supabase Free',
        config: {
          kind: 'managed-db',
        },
        billing: {
          accountId: 'supabase',
          provider: 'supabase',
          planId: 'free',
          meters: {
            'egress-gb': 'egress',
          },
        },
      },
      // メールの送信（D-95）
      {
        id: 'email',
        label: 'Amazon SES（メールの送信）',
        config: { kind: 'email-sender' },
        billing: {
          accountId: 'aws',
          provider: 'aws',
          planId: 'ses',
          meters: { emails: 'outbound' },
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
  },
  {
    id: 'vercel-supabase-pro',
    name: 'Vercel Pro + Supabase Pro',
    nodes: [
      {
        id: 'cdn',
        label: 'Vercel CDN',
        config: {
          kind: 'cdn',
          hitRate: {
            asset: 1,
            'document-static': 1,
            'image-read': 0.9,
          },
          // D-37: ISR のページのヒット率は固定の 0.8 をやめ、再生成の数と同じ式（閲覧の密度 × 再検証の間隔）から出す
          ttlClasses: ['document-isr'],
          originClasses: ['document-ssr', 'document-isr', 'api'],
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            requests: 'cdn-requests',
            'egress-gb': 'fast-data-transfer',
            'origin-transfer-gb': 'fast-origin-transfer',
          },
        },
      },
      {
        id: 'fn',
        label: 'Vercel Functions（Fluid）',
        config: {
          kind: 'function',
          memoryGB: 2,
          concurrency: 1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            invocations: 'invocations',
            'cpu-ms': 'active-cpu',
            'memory-gb-hours': 'provisioned-memory',
          },
        },
      },
      {
        id: 'isr',
        label: 'ISR の永続ストレージ',
        config: {
          kind: 'isr-store',
          unitKB: 8,
          changedRate: 0.1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            'isr-reads': 'isr-reads',
            'isr-writes': 'isr-writes',
          },
        },
      },
      {
        id: 'image',
        label: '画像の最適化',
        config: {
          kind: 'image-optimizer',
          unitKB: 8,
          cacheMissRate: 1,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            'image-transformations': 'image-transformations',
            'image-cache-reads': 'image-cache-reads',
            'image-cache-writes': 'image-cache-writes',
          },
        },
      },
      // D-46: 置き場所が未定（課金先なし）だった画像の原本を Vercel Blob にした
      {
        id: 'blob',
        label: 'Vercel Blob（画像の原本）',
        // OCL-2AE853BD: Blob の URL から直接配信する（CDN のヒット率で操作と origin への転送を数える）
        config: {
          kind: 'object-storage',
          cdnHitRate: 0.9,
        },
        billing: {
          accountId: 'vercel',
          provider: 'vercel',
          planId: 'pro',
          meters: {
            'storage-gb-month': 'blob-storage',
            'object-writes': 'blob-advanced-operations',
            'object-reads': 'blob-simple-operations',
            'egress-gb': 'blob-data-transfer',
            requests: 'cdn-requests',
            'origin-transfer-gb': 'fast-origin-transfer',
          },
        },
      },
      {
        id: 'db',
        label: 'Supabase Pro（Micro）',
        config: {
          kind: 'managed-db',
        },
        billing: {
          accountId: 'supabase',
          provider: 'supabase',
          planId: 'pro-micro',
          meters: {
            'instance-hours': 'compute',
            'egress-gb': 'egress',
            'storage-gb-month': 'disk',
          },
        },
      },
      // メールの送信（D-95）
      {
        id: 'email',
        label: 'Amazon SES（メールの送信）',
        config: { kind: 'email-sender' },
        billing: {
          accountId: 'aws',
          provider: 'aws',
          planId: 'ses',
          meters: { emails: 'outbound' },
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
  },
  {
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
          residentMemoryGB: 1.35,
          dbCpuMsPerQuery: 0.3,
          imageTransformCpuMs: 150,
          otherDiskGB: 10,
          // D-31 で足した仮定（nginx の 1 リクエストあたりの CPU）。GD-3 からの意図した差
          proxyCpuMsPerRequest: 0.3,
        },
        billing: {
          accountId: 'sakura',
          provider: 'sakura-vps',
          planId: '2gb-tokyo',
          meters: {
            'egress-gb': 'transfer',
          },
        },
      },
      // メールの送信（D-95）
      {
        id: 'email',
        label: 'Amazon SES（メールの送信）',
        config: { kind: 'email-sender' },
        billing: {
          accountId: 'aws',
          provider: 'aws',
          planId: 'ses',
          meters: { emails: 'outbound' },
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
  },
];
