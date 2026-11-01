// 事業者をまたぐ構成（D-52・prd/11 §2）: 許した組だけが選択肢に出る・課金が事業者ごとに分かれる。
import { describe, expect, it } from 'vitest';
import { articleCommunity } from '../templates/index.ts';
import { accountsOf, CROSS_COMPONENTS, CROSS_PAIRS, hostsOf } from './cross.ts';
import {
  applyComponentsToWorkload,
  COMPONENTS,
  componentsOf,
  composeStack,
  imagesBehavior,
  type Platform,
  type SlotId,
} from './index.ts';

const PLATFORMS: Platform[] = ['cloudflare', 'vercel', 'sakura', 'aws'];

describe('許した組（CROSS_PAIRS）', () => {
  it('他の事業者に差せる部品は、表で許した組だけ', () => {
    for (const c of COMPONENTS)
      for (const host of hostsOf(c)) {
        if (host === c.platform) continue;
        expect(
          CROSS_PAIRS.some(
            (p) =>
              p.host === host && p.slot === c.slot && p.provider === c.platform,
          ),
          `${host} × ${c.slot} × ${c.platform}:${c.id}`,
        ).toBe(true);
        expect(c.link, `${c.platform}:${c.id} の接続の形`).toBeDefined();
      }
  });

  it('表に無い組は選択肢に出ない（Cloudflare・VPS の画像に他の事業者の部品は出ない）', () => {
    const cross = (host: Platform, slot: SlotId) =>
      componentsOf(host, slot).filter((c) => c.platform !== host);
    for (const host of ['vercel', 'aws'] as const)
      expect(cross(host, 'images').map((c) => c.id)).toEqual([
        'cf-images',
        'cf-resize',
      ]);
    for (const p of PLATFORMS)
      for (const slot of ['isrCache', 'db', 'realtime', 'apiCache'] as const)
        expect(cross(p, slot)).toEqual([]);
    expect(cross('cloudflare', 'images')).toEqual([]);
    expect(cross('sakura', 'images')).toEqual([]);
  });

  it('部品の id は差せる土台の事業者のスロットの中で重ならない', () => {
    for (const host of PLATFORMS)
      for (const slot of new Set(COMPONENTS.map((c) => c.slot))) {
        const ids = componentsOf(host, slot).map((c) => c.id);
        expect(new Set(ids).size, `${host}:${slot}`).toBe(ids.length);
      }
  });

  it('根拠の出典は URL と取得日を持つ', () => {
    for (const p of CROSS_PAIRS) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(['2026-11-01', '2026-11-02']).toContain(s.retrievedAt);
      }
    }
  });

  it('他の事業者の部品の名前は事業者の名前で始まる', () => {
    const NAMES = { cloudflare: 'Cloudflare', aws: 'AWS' } as const;
    for (const c of CROSS_COMPONENTS)
      expect(
        c.label.startsWith(`${NAMES[c.platform as keyof typeof NAMES]}: `),
      ).toBe(true);
  });
});

describe('Vercel + 画像だけ Cloudflare', () => {
  const pro = (images: string, framework?: 'vite-spa') =>
    composeStack(
      'vercel-supabase-pro',
      { images },
      framework ? { framework } : {},
    );

  it('課金のアカウントに Cloudflare が加わる（既定は Vercel と Supabase）', () => {
    expect(accountsOf(composeStack('vercel-supabase-pro'))).toEqual([
      'vercel',
      'supabase',
    ]);
    expect(accountsOf(pro('cf-images'))).toEqual([
      'vercel',
      'supabase',
      'cloudflare',
    ]);
    expect(accountsOf(pro('cf-resize', 'vite-spa'))).toContain('cloudflare');
  });

  it('画像は Vercel の CDN・Blob・画像の最適化を通らず、R2 から配る', () => {
    for (const a of [pro('cf-images'), pro('cf-resize', 'vite-spa')]) {
      expect(a.routes['image-read']).toEqual(['cf-cache', 'cf-r2']);
      expect(a.routes['image-write']).toEqual(['fn', 'cf-r2']);
      expect(a.nodes.some((n) => n.id === 'blob' || n.id === 'image')).toBe(
        false,
      );
      const r2 = a.nodes.find((n) => n.id === 'cf-r2')!;
      expect(r2.billing).toMatchObject({
        accountId: 'cloudflare',
        planId: 'r2-standard',
      });
    }
    expect(pro('cf-images').routes['image-transform']).toEqual(['cf-images']);
    expect(pro('cf-resize').routes['image-transform']).toBeUndefined();
  });

  it('変換は Hobby なら Images Free・Pro なら Images Paid（仮定）', () => {
    const plan = (stack: string) =>
      composeStack(stack, { images: 'cf-images' }).nodes.find(
        (n) => n.id === 'cf-images',
      )!.billing!.planId;
    expect(plan('vercel-supabase-hobby')).toBe('images-free');
    expect(plan('vercel-supabase-pro')).toBe('images-paid');
  });

  it('Next.js だけ next/image のローダーの事実を前提に出す', () => {
    const facts = (a: ReturnType<typeof pro>) =>
      a.nodes.find((n) => n.id === 'cf-images')!.facts;
    expect(facts(pro('cf-images'))).toContain('next-loader');
    expect(facts(pro('cf-images', 'vite-spa'))).not.toContain('next-loader');
  });

  it('Workload は同じ振る舞いの部品として変わる（cf-resize は一律で縮める）', () => {
    expect(imagesBehavior('vercel', 'cf-resize')).toBe('resize');
    expect(imagesBehavior('vercel', 'cf-images')).toBe('images');
    expect(imagesBehavior('vercel', 'default')).toBe('default');
    const w = articleCommunity(300_000);
    expect(
      applyComponentsToWorkload(
        w,
        'vercel',
        { images: 'cf-resize' },
        { resizedImageKB: 400 },
      ).images,
    ).toEqual(
      applyComponentsToWorkload(
        w,
        'vercel',
        { images: 'resize' },
        { resizedImageKB: 400 },
      ).images,
    );
    expect(
      applyComponentsToWorkload(w, 'vercel', { images: 'cf-images' }).images,
    ).toEqual(w.images);
  });
});

describe('AWS + 画像だけ Cloudflare', () => {
  const aws = (images: string, framework?: 'vite-spa') =>
    composeStack('aws-amplify', { images }, framework ? { framework } : {});

  it('Amplify（Next.js）: 画像の最適化・画像だけの CloudFront・S3 が外れ、投稿は SSR から R2 へ（外への転送は数えない）', () => {
    const a = aws('cf-images');
    expect(accountsOf(a)).toEqual(['aws', 'cloudflare']);
    expect(a.nodes.some((n) => ['image', 'cf', 's3'].includes(n.id))).toBe(
      false,
    );
    expect(a.routes['image-read']).toEqual(['cf-cache', 'cf-r2']);
    expect(a.routes['image-write']).toEqual(['ssr', 'cf-r2']);
    expect(a.routes['image-transform']).toEqual(['cf-images']);
    expect(a.nodes.find((n) => n.id === 'cf-images')!.billing!.planId).toBe(
      'images-paid',
    );
  });

  it('SPA（S3 + CloudFront + Lambda）: CloudFront はシェルと API に残り、Lambda から R2 への転送を AWS のインターネットへの転送で数える', () => {
    const a = aws('cf-resize', 'vite-spa');
    expect(a.nodes.some((n) => n.id === 's3')).toBe(false);
    expect(a.nodes.some((n) => n.id === 'cf')).toBe(true);
    expect(a.routes['image-read']).toEqual(['cf-cache', 'cf-r2']);
    expect(a.routes['image-write']).toEqual([
      'apigw',
      'lambda',
      'aws-out',
      'cf-r2',
    ]);
    expect(a.nodes.find((n) => n.id === 'aws-out')!.billing).toMatchObject({
      accountId: 'aws',
      planId: 'data-transfer-out',
      meters: { 'egress-gb': 'internet-out' },
    });
    expect(a.routes['image-transform']).toBeUndefined();
  });

  it('既定の AWS の構成は変わらない', () => {
    expect(accountsOf(composeStack('aws-amplify'))).toEqual(['aws']);
    expect(composeStack('aws-amplify').routes['image-read']).toEqual([
      'cf',
      's3',
    ]);
  });
});

describe('AWS + 画像だけ Cloudflare × CloudFront の定額のプラン（D-61）', () => {
  it('前段の CloudFront は残り、定額のプランで課金し、画像は通らない', () => {
    const a = composeStack('aws-amplify', {
      images: 'cf-images',
      frontCdn: 'static',
      cdnPlan: 'flat-pro',
    });
    const front = a.nodes.find((n) => n.id === 'front')!;
    expect(front.billing!.planId).toBe('cloudfront-flat-pro');
    expect(a.routes['image-read']).toEqual(['cf-cache', 'cf-r2']);
    expect(a.nodes.some((n) => n.id === 'cf')).toBe(false);
  });

  it('前段が無い Amplify では CloudFront が無くなる（定額のプランは何にも当たらない）', () => {
    const a = composeStack('aws-amplify', {
      images: 'cf-resize',
      cdnPlan: 'flat-pro',
    });
    expect(
      a.nodes.some((n) => n.billing?.planId.startsWith('cloudfront')),
    ).toBe(false);
  });

  it('SPA の CloudFront はシェルと API に残り、定額のプランで課金する', () => {
    const a = composeStack(
      'aws-amplify',
      { images: 'cf-images', cdnPlan: 'flat-pro' },
      { framework: 'vite-spa' },
    );
    expect(a.nodes.find((n) => n.id === 'cf')!.billing!.planId).toBe(
      'cloudfront-flat-pro',
    );
    expect(a.routes.asset).toEqual(['cf']);
  });
});

describe('SPA の API の置き場（D-65）', () => {
  const spa = (stack: string, choices: Record<string, string>, standby = {}) =>
    composeStack(stack, choices, { framework: 'vite-spa', standby });
  const ids = (a: ReturnType<typeof spa>) => a.nodes.map((n) => n.id);

  it('選べる組は表で許したものだけ（SPA だけ。VPS・Next.js にはスロットが無い）', () => {
    const opts = (p: Platform, fw: 'nextjs' | 'vite-spa' = 'vite-spa') =>
      componentsOf(p, 'api', fw).map((c) => `${c.platform}:${c.id}`);
    expect(opts('vercel')).toEqual(['vercel:same', 'cloudflare:cf-workers']);
    expect(opts('aws')).toEqual(['aws:same', 'cloudflare:cf-workers']);
    expect(opts('cloudflare')).toEqual(['cloudflare:same', 'aws:aws-lambda']);
    expect(opts('sakura')).toEqual([]);
    for (const p of PLATFORMS) expect(opts(p, 'nextjs')).toEqual([]);
  });

  it('既定（同じ事業者）は今までの SPA の構成と同じ', () => {
    for (const s of [
      'cloudflare-vinext-paid',
      'vercel-supabase-pro',
      'aws-amplify',
    ])
      expect(spa(s, { api: 'same' })).toEqual(spa(s, {}));
  });

  it('Next.js では API の置き場の選択は効かない', () => {
    expect(composeStack('vercel-supabase-pro', { api: 'cf-workers' })).toEqual(
      composeStack('vercel-supabase-pro'),
    );
  });

  it('Vercel + Workers の API + D1: Supabase が外れ、API は Worker → D1。Blob への投稿は Vercel の関数に残る', () => {
    const a = spa('vercel-supabase-pro', { api: 'cf-workers' });
    expect(accountsOf(a)).toEqual(['vercel', 'cloudflare']);
    expect(ids(a)).not.toContain('db');
    expect(a.routes.api).toEqual(['cf-worker', 'cf-d1']);
    expect(a.routes['api-content']).toEqual(['cf-worker', 'cf-d1']);
    expect(a.routes['image-write']).toEqual(['fn', 'blob']);
    const worker = a.nodes.find((n) => n.id === 'cf-worker')!;
    expect(worker.billing!.planId).toBe('workers-paid');
    expect(worker.facts).toEqual([
      'custom-domain-origin',
      'cors-headers',
      'd1-binding',
    ]);
  });

  it('画像も Cloudflare なら投稿も Worker が R2 に書き、Vercel の関数は無くなる（OGP の前処理には残る）', () => {
    const a = spa('vercel-supabase-pro', {
      api: 'cf-workers',
      images: 'cf-resize',
    });
    expect(a.routes['image-write']).toEqual(['cf-worker', 'cf-r2']);
    expect(ids(a)).not.toContain('fn');
    const ogp = spa('vercel-supabase-pro', {
      api: 'cf-workers',
      images: 'cf-resize',
      ogp: 'prerender',
    });
    expect(ids(ogp)).toContain('fn');
  });

  it('Vercel Hobby の静的な配信は Hobby のまま（非商用の規約の対象）で、Worker は Workers Free', () => {
    const a = spa('vercel-supabase-hobby', { api: 'cf-workers' });
    expect(a.nodes.find((n) => n.id === 'cdn')!.billing!.planId).toBe('hobby');
    expect(a.nodes.find((n) => n.id === 'cf-worker')!.billing!.planId).toBe(
      'workers-free',
    );
  });

  it('AWS（S3 + CloudFront）+ Workers の API: API Gateway・Lambda・DynamoDB が外れ、投稿は Worker が S3 に書く', () => {
    const a = spa('aws-amplify', { api: 'cf-workers' });
    expect(accountsOf(a)).toEqual(['aws', 'cloudflare']);
    for (const id of ['apigw', 'lambda', 'dynamodb'])
      expect(ids(a)).not.toContain(id);
    expect(a.routes.asset).toEqual(['cf']);
    expect(a.routes.api).toEqual(['cf-worker', 'cf-d1']);
    expect(a.routes['image-write']).toEqual(['cf-worker', 's3']);
    const r2 = spa('aws-amplify', { api: 'cf-workers', images: 'cf-images' });
    expect(r2.routes['image-write']).toEqual(['cf-worker', 'cf-r2']);
    expect(ids(r2)).not.toContain('aws-out');
  });

  it('Cloudflare + AWS の API: Worker と D1 が外れ、応答は API Gateway から外へ（転送を数える）', () => {
    const a = spa('cloudflare-vinext-paid', { api: 'aws-lambda' });
    expect(accountsOf(a)).toEqual(['cloudflare', 'aws']);
    for (const id of ['worker', 'd1']) expect(ids(a)).not.toContain(id);
    expect(a.routes.api).toEqual(['aws-out', 'apigw', 'lambda', 'dynamodb']);
    expect(a.routes['image-write']).toEqual([
      'apigw',
      'lambda',
      'aws-out',
      'r2',
    ]);
    expect(a.routes.asset).toEqual(['assets']);
    expect(a.nodes.find((n) => n.id === 'aws-out')!.facts).toEqual([
      'api-gateway-out',
      'lambda-out',
    ]);
    const ogp = spa('cloudflare-vinext-paid', {
      api: 'aws-lambda',
      ogp: 'prerender',
    });
    expect(ids(ogp)).toContain('worker');
    expect(ogp.routes['document-static']).toEqual(['worker']);
  });

  it('移し替えの途中（standby）: 新しい置き場のノードを経路に載せずに足し、戻すときは土台の関数・DB を残す', () => {
    const to = spa('vercel-supabase-pro', {}, { api: 'cf-workers' });
    expect(ids(to)).toEqual(
      expect.arrayContaining(['fn', 'db', 'cf-worker', 'cf-d1']),
    );
    expect(to.routes.api).toEqual(['cdn', 'fn', 'db']);
    const back = spa(
      'vercel-supabase-pro',
      { api: 'cf-workers' },
      { api: 'same' },
    );
    expect(ids(back)).toEqual(
      expect.arrayContaining(['fn', 'db', 'cf-worker']),
    );
    expect(back.routes.api).toEqual(['cf-worker', 'cf-d1']);
  });
});
