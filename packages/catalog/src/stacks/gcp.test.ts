// Google Cloud の構成（D-88）: フレームワークごとの経路・Cloud Run のコンテナの設定・DB の差し替え・画像だけ Cloudflare。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { composeStack } from './index.ts';

const ids = (a: ReturnType<typeof composeStack>) => a.nodes.map((n) => n.id);
const run = (a: ReturnType<typeof composeStack>) =>
  a.nodes.find((n) => n.id === 'run')!;

describe('Google Cloud の構成', () => {
  it('Next.js: ISR は Hosting の CDN の期限つきのキャッシュ、外れと作り直しは Cloud Run（作り直しは裏でリクエストに数えない）', () => {
    const a = composeStack('gcp-cloud-run');
    expect(() => ArchitectureSchema.parse(a)).not.toThrow();
    expect(ids(a)).toEqual(['cdn', 'run', 'gcs', 'firestore', 'email']);
    expect(a.routes['document-isr']).toEqual(['cdn', 'run']);
    expect(a.routes['isr-revalidate']).toEqual(['run', 'firestore']);
    expect(a.routes['image-read']).toEqual(['cdn', 'run', 'gcs']);
    // 投稿は Hosting を通さない（投稿の大きさを Hosting の転送に数えない）
    expect(a.routes['image-write']).toEqual(['run', 'gcs']);
    expect(a.nodes[0]!.config).toMatchObject({ ttlClasses: ['document-isr'] });
    expect(run(a).config).toMatchObject({
      kind: 'container',
      vcpu: 1,
      memoryGB: 0.5,
      concurrency: 80,
      minInstances: 0,
      idleKeepSeconds: 900,
      backgroundClasses: ['isr-revalidate', 'image-transform'],
    });
    expect(run(a).facts).toContain('next-local-cache');
  });

  it('最小インスタンス数・Cloud SQL・差し替えの途中の DB', () => {
    const a = composeStack('gcp-cloud-run', {
      minInstances: '1',
      db: 'cloud-sql',
    });
    expect(run(a).config).toMatchObject({ minInstances: 1 });
    expect(a.routes.api).toEqual(['cdn', 'run', 'cloud-sql']);
    const swap = composeStack(
      'gcp-cloud-run',
      { db: 'firestore' },
      { standby: { db: 'cloud-sql' } },
    );
    expect(ids(swap)).toEqual([
      'cdn',
      'run',
      'gcs',
      'firestore',
      'cloud-sql',
      'email',
    ]);
    expect(Object.values(swap.routes).flat()).not.toContain('cloud-sql');
  });

  it('SPA・静的書き出し・Astro: Hosting から静的に配り、API（Astro はマイページも）を Cloud Run。ビルドの費用は数えない', () => {
    for (const framework of ['vite-spa', 'nextjs-export', 'astro'] as const) {
      const a = composeStack('gcp-cloud-run', {}, { framework });
      expect(() => ArchitectureSchema.parse(a)).not.toThrow();
      expect(a.routes['document-isr']).toBeUndefined();
      expect(a.routes['document-static']).toEqual(['cdn']);
      expect(a.routes.api).toEqual(['cdn', 'run', 'firestore']);
      expect(ids(a)).not.toContain('build');
    }
    const spa = composeStack(
      'gcp-cloud-run',
      { ogp: 'prerender', apiCache: 'cdn' },
      { framework: 'vite-spa' },
    );
    expect(spa.routes['document-static']).toEqual(['cdn', 'run']);
    expect(spa.nodes[0]!.config).toMatchObject({ ttlClasses: ['api-content'] });
    expect(
      composeStack('gcp-cloud-run', {}, { framework: 'astro' }).routes[
        'document-ssr'
      ],
    ).toEqual(['cdn', 'run', 'firestore']);
  });

  it('画像だけ Cloudflare: Cloud Storage を外し、R2 への書き込みを Premium Tier のインターネットへの転送で数える', () => {
    const a = composeStack('gcp-cloud-run', { images: 'cf-resize' });
    expect(ids(a)).not.toContain('gcs');
    expect(a.routes['image-read']).toEqual(['cf-cache', 'cf-r2']);
    expect(a.routes['image-write']).toEqual(['run', 'gcp-out', 'cf-r2']);
    expect(a.nodes.find((n) => n.id === 'gcp-out')!.billing).toMatchObject({
      planId: 'internet-egress',
      meters: { 'egress-gb': 'transfer' },
    });
  });

  it('料金データ: 東京（Tier 1）の Cloud Run・Hosting・Firestore・Cloud SQL の単価と無料の分', () => {
    const gcp = loadPriceBooks().find((b) => b.provider === 'gcp')!;
    const price = (plan: string, meter: string) => {
      const p = gcp.plans
        .find((x) => x.id === plan)!
        .meters.find((m) => m.id === meter)!.pricing;
      return p.model === 'flat' ? p.unitPrice / p.per : NaN;
    };
    expect(price('cloud-run', 'cpu')).toBe(0.000024);
    expect(price('cloud-run', 'memory')).toBe(0.0000025);
    expect(price('cloud-run', 'idle-cpu')).toBe(0.0000025);
    expect(price('cloud-run', 'requests') * 1e6).toBeCloseTo(0.4, 12);
    expect(price('firebase-hosting', 'transfer')).toBe(0.15);
    expect(price('firestore-standard', 'reads') * 1e5).toBeCloseTo(0.038, 12);
    expect(price('cloud-sql-f1-micro', 'instance')).toBe(0.0122);
    const pool = (id: string) =>
      gcp.allowancePools.find((p) => p.id === id)!.quantity;
    expect(pool('run-free-cpu')).toBe(180_000);
    expect(pool('run-free-memory')).toBe(360_000);
    expect(pool('run-free-requests')).toBe(2_000_000);
    expect(pool('firestore-free-reads')).toBe(50_000);
  });
});
