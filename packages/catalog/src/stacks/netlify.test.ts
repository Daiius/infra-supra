// Netlify の構成（D-71）: フレームワークごとの経路と、他の事業者の部品を差したときの Netlify から外へ送るデータ。
import { describe, expect, it } from 'vitest';
import { loadPriceBooks } from '../index.ts';
import { composeStack } from './index.ts';

const ids = (a: ReturnType<typeof composeStack>) => a.nodes.map((n) => n.id);

describe('Netlify の構成', () => {
  it('Next.js: ISR は CDN の期限つきのキャッシュ、miss と作り直しは関数。画像は Image CDN、原本は Blobs', () => {
    const a = composeStack('netlify-supabase-pro');
    expect(ids(a)).toEqual(['cdn', 'fn', 'image', 'blob', 'db']);
    expect(a.routes['document-isr']).toEqual(['cdn', 'fn']);
    expect(a.routes['isr-revalidate']).toEqual(['fn', 'db']);
    expect(a.routes['image-read']).toEqual(['cdn', 'image']);
    const cdn = a.nodes.find((n) => n.id === 'cdn')!;
    expect(cdn.config).toMatchObject({ ttlClasses: ['document-isr'] });
  });

  it('SPA: OGP の前処理でシェルが関数を通り、API の応答のキャッシュは CDN の期限つき', () => {
    const a = composeStack(
      'netlify-supabase-pro',
      { ogp: 'prerender', apiCache: 'cdn' },
      { framework: 'vite-spa' },
    );
    expect(a.routes['document-static']).toEqual(['cdn', 'fn']);
    expect(a.routes['api-content']).toEqual(['cdn', 'fn', 'db']);
    expect(a.routes['document-isr']).toBeUndefined();
    const cdn = a.nodes.find((n) => n.id === 'cdn')!;
    expect(cdn.config).toMatchObject({ ttlClasses: ['api-content'] });
  });

  it('Astro: ビルドし直しを本番のデプロイ（クレジット）で数える', () => {
    const a = composeStack('netlify-supabase-free', {}, { framework: 'astro' });
    const build = a.nodes.find((n) => n.id === 'build')!;
    expect(build.billing?.meters).toEqual({ deploys: 'production-deploys' });
    expect(a.routes['document-isr']).toBeUndefined();
  });

  it('画像だけ Cloudflare: Image CDN・Blobs を外し、R2 への書き込みを Netlify の転送量で数える', () => {
    const a = composeStack('netlify-supabase-personal', {
      images: 'cf-images',
    });
    expect(ids(a)).not.toContain('image');
    expect(ids(a)).not.toContain('blob');
    expect(a.routes['image-write']).toEqual(['fn', 'netlify-out', 'cf-r2']);
    expect(a.nodes.find((n) => n.id === 'netlify-out')!.billing).toMatchObject({
      planId: 'personal',
      meters: { 'egress-gb': 'bandwidth' },
    });
  });

  it('Next.js・Astro のサーバーから Workers の API: Supabase を外し、問い合わせを Netlify の転送量で数える', () => {
    for (const [framework, api] of [
      ['nextjs', 'cf-workers-server'],
      ['astro', 'cf-workers-astro'],
    ] as const) {
      const a = composeStack('netlify-supabase-pro', { api }, { framework });
      expect(ids(a)).not.toContain('db');
      expect(a.routes['document-ssr']).toEqual([
        'cdn',
        'fn',
        'netlify-out-api',
        'cf-worker',
        'cf-d1',
      ]);
    }
  });

  it('メーターの単価はクレジットを補充の単価で直したもの（Pro は 1,500 クレジット $10）', () => {
    const pro = loadPriceBooks()
      .find((b) => b.provider === 'netlify')!
      .plans.find((p) => p.id === 'pro')!;
    const price = (id: string) => {
      const p = pro.meters.find((m) => m.id === id)!.pricing;
      return p.model === 'flat' ? p.unitPrice / p.per : NaN;
    };
    expect(price('bandwidth')).toBeCloseTo((20 * 10) / 1500, 12);
    expect(price('compute')).toBeCloseTo((10 * 10) / 1500, 12);
    expect(price('production-deploys')).toBeCloseTo((15 * 10) / 1500, 12);
    expect(price('web-requests') * 10_000).toBeCloseTo((2 * 10) / 1500, 12);
    expect(pro.credits[0]!.amount).toBeCloseTo(20, 12);
  });
});
