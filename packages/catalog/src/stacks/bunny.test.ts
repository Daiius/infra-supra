// Bunny（D-98・prd/11 §23）: 画像を Bunny で配る・前段の CDN を Bunny にする。転送・保存・最低額・Optimizer の月額。
import { describe, expect, it } from 'vitest';
import { estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { articleCommunity, businessApp } from '../templates/index.ts';
import { accountsOf, CROSS_COMPONENTS, hostsOf } from './cross.ts';
import { componentsOf, composeStack, imagesBehavior } from './index.ts';

const books = loadPriceBooks();

/** Bunny のアカウントの明細の合計（基本料・クレジットを含む）。 */
const bunnyTotal = (r: ReturnType<typeof estimate>) =>
  r.bill.lines
    .filter((l) => l.accountId === 'bunny')
    .reduce((a, l) => a + (l.amount ?? 0), 0);

describe('Bunny の組（接続の規則から導く。D-114）', () => {
  it('画像は Vercel・AWS・OpenNext・Netlify・Google Cloud、前段の CDN は Amplify・VPS', () => {
    const hosts = (slot: string) =>
      [
        ...new Set(
          CROSS_COMPONENTS.filter(
            (c) => c.platform === 'bunny' && c.slot === slot,
          ).flatMap((c) => hostsOf(c)),
        ),
      ].sort();
    expect(hosts('images')).toEqual(
      ['aws', 'aws-opennext', 'gcp', 'netlify', 'vercel'].sort(),
    );
    expect(hosts('frontCdn')).toEqual(['aws', 'sakura']);
    // Amplify の前段は Next.js だけ（SPA は最初から CloudFront）、VPS はすべてのフレームワーク
    expect(
      componentsOf('aws', 'frontCdn', 'vite-spa').map((c) => c.id),
    ).not.toContain('bunny');
    expect(
      componentsOf('aws', 'frontCdn', 'nextjs').map((c) => c.id),
    ).toContain('bunny');
    expect(
      componentsOf('sakura', 'frontCdn', 'vite-spa').map((c) => c.id),
    ).toContain('bunny');
    expect(componentsOf('cloudflare', 'images').map((c) => c.id)).not.toContain(
      'bunny-images',
    );
  });

  it('振る舞いは Cloudflare の画像と同じ（変換する・投稿のときに縮める）', () => {
    expect(imagesBehavior('vercel', 'bunny-images')).toBe('images');
    expect(imagesBehavior('gcp', 'bunny-resize')).toBe('resize');
  });
});

describe('画像を Bunny で配る', () => {
  it('Vercel: 画像は Bunny CDN → Storage、投稿は関数が Storage に書き、変換は Optimizer', () => {
    const a = composeStack('vercel-supabase-pro', { images: 'bunny-images' });
    expect(accountsOf(a)).toContain('bunny');
    expect(a.routes['image-read']).toEqual(['bunny-img', 'bunny-storage']);
    expect(a.routes['image-write']).toEqual(['fn', 'bunny-storage']);
    expect(a.routes['image-transform']).toEqual(['bunny-optimizer']);
    expect(a.nodes.some((n) => n.id === 'blob' || n.id === 'image')).toBe(
      false,
    );
    const r = composeStack('vercel-supabase-pro', { images: 'bunny-resize' });
    expect(r.routes['image-transform']).toBeUndefined();
    expect(r.nodes.some((n) => n.id === 'bunny-optimizer')).toBe(false);
  });

  it('Amplify（Next.js）: 画像は Amplify の CDN・CloudFront・S3 を通らない（二重に数えない）。投稿は SSR から（外への転送は数えない）', () => {
    const a = composeStack('aws-amplify', { images: 'bunny-resize' });
    expect(a.nodes.some((n) => ['image', 'cf', 's3'].includes(n.id))).toBe(
      false,
    );
    expect(a.routes['image-read']).toEqual(['bunny-img', 'bunny-storage']);
    expect(a.routes['image-write']).toEqual(['ssr', 'bunny-storage']);
    const r = estimate({
      workload: articleCommunity(1_000_000),
      architecture: a,
      books,
    });
    // Amplify の配信の転送は Bunny なしの構成と同じ（画像を含まない）。CloudFront の転送の行は無く、画像の転送は Bunny の bandwidth だけ
    const amplifyOut = (x: ReturnType<typeof estimate>) =>
      x.bill.lines.find((l) => l.priceRef.meterId === 'amplify-transfer-out')!
        .amount;
    const base = estimate({
      workload: articleCommunity(1_000_000),
      architecture: composeStack('aws-amplify', { images: 'resize' }),
      books,
    });
    expect(amplifyOut(r)).toBeCloseTo(amplifyOut(base)!, 9);
    expect(
      r.bill.lines.filter((l) => l.priceRef.meterId?.includes('transfer'))
        .length,
    ).toBe(1);
  });

  it('AWS（SPA）・Google Cloud: 投稿の Storage への書き込みは土台の外への転送で数える', () => {
    const spa = composeStack(
      'aws-amplify',
      { images: 'bunny-resize' },
      { framework: 'vite-spa' },
    );
    expect(spa.routes['image-write']).toEqual([
      'apigw',
      'lambda',
      'aws-out',
      'bunny-storage',
    ]);
    expect(spa.nodes.find((n) => n.id === 'aws-out')!.label).toContain(
      'Bunny Storage',
    );
    const gcp = composeStack('gcp-cloud-run', { images: 'bunny-images' });
    expect(gcp.routes['image-write']).toEqual([
      'run',
      'gcp-out',
      'bunny-storage',
    ]);
  });

  it('料金: 転送 $0.03/GB・保存 $0.01/GB 月・Optimizer は月 $9.50 で変換は無制限', () => {
    const w = articleCommunity(1_000_000);
    const run = (images: string) =>
      estimate({
        workload: w,
        architecture: composeStack('vercel-supabase-pro', { images }),
        books,
      });
    const r = run('bunny-images');
    const line = (meterId: string) =>
      r.bill.lines.find(
        (l) => l.accountId === 'bunny' && l.priceRef.meterId === meterId,
      )!;
    const res = r.simulation.nodes;
    const gb = res['bunny-img']!.resources['egress-gb']!;
    expect(gb).toBeGreaterThan(0);
    expect(line('bandwidth').amount).toBeCloseTo(gb * 0.03, 6);
    expect(line('storage').amount).toBeCloseTo(
      res['bunny-storage']!.resources['storage-gb-month']! * 0.01,
      6,
    );
    expect(line('transformations').amount).toBe(0);
    // 基本料 $1（最低額）+ Optimizer $9.50 − 最低額のクレジット（従量が $1 を超えるので $1 全部が当たる）
    expect(bunnyTotal(r)).toBeCloseTo(
      line('bandwidth').amount! + line('storage').amount! + 9.5,
      6,
    );
  });

  it('月の最低額: 従量が $1 に満たない月も $1（縮めて置くだけ・小さな規模）', () => {
    const r = estimate({
      workload: businessApp(10_000),
      architecture: composeStack('gcp-cloud-run', { images: 'bunny-resize' }),
      books,
    });
    expect(bunnyTotal(r)).toBeCloseTo(1, 9);
    expect(
      r.premises.some((p) => p.id === 'fact:bunny:standard:monthly-minimum'),
    ).toBe(true);
  });
});

describe('前段の CDN を Bunny にする', () => {
  it('Amplify: 前段は Bunny の課金で、Amplify の CDN は素通し（自前の CloudFront の前段と同じ形）', () => {
    const cf = composeStack('aws-amplify', {
      frontCdn: 'static',
      images: 'default',
    });
    const bn = composeStack('aws-amplify', {
      frontCdn: 'bunny',
      images: 'default',
    });
    expect(bn.routes).toEqual(cf.routes);
    const front = bn.nodes.find((n) => n.id === 'front')!;
    expect(front.billing).toMatchObject({
      accountId: 'bunny',
      planId: 'standard',
    });
    expect(front.config).toEqual(
      cf.nodes.find((n) => n.id === 'front')!.config,
    );
    expect(accountsOf(bn)).toContain('bunny');
  });

  it('VPS: Cloudflare の「静的と画像だけ」と同じヒット率で、VPS に届く量も同じ。転送は Bunny で課金', () => {
    const w = articleCommunity(1_000_000);
    const run = (frontCdn: string) =>
      estimate({
        workload: w,
        architecture: composeStack('sakura-vps-2gb', { frontCdn }),
        books,
      });
    const cf = run('static');
    const bn = run('bunny');
    expect(bn.simulation.nodes.vps!.resources).toEqual(
      cf.simulation.nodes.vps!.resources,
    );
    const gb = bn.simulation.nodes['bunny-cdn']!.resources['egress-gb']!;
    expect(bunnyTotal(bn)).toBeCloseTo(Math.max(1, gb * 0.03), 6);
  });
});
