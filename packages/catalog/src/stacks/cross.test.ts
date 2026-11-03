// 事業者をまたぐ構成（D-52・prd/11 §2）: 許した組だけが選択肢に出る・課金が事業者ごとに分かれる。
import { describe, expect, it } from 'vitest';
import { resolveWorkload, simulateResources } from 'estimator';
import { toAstro, toSpa } from '../frameworks/index.ts';
import {
  ARTICLE_COMMUNITY_ASTRO,
  ARTICLE_COMMUNITY_SPA,
  articleCommunity,
} from '../templates/index.ts';
import {
  accountsOf,
  CROSS_COMPONENTS,
  CROSS_PARTS,
  hostsOf,
  NEON_MIN_CU,
  NEON_SUSPEND_SECONDS,
  SERVER_API_REQUEST_KB,
  SERVER_API_WORKER_CPU_MS,
  VPS_RESIDENT_WITHOUT_DB_GB,
} from './cross.ts';
import {
  applyComponentsToWorkload,
  COMPONENTS,
  componentsOf,
  composeStack,
  imagesBehavior,
  STACK_DEFS,
  type Choices,
  type Platform,
  type SlotId,
} from './index.ts';
import {
  CONNECTION_RULES,
  INBOUND,
  isTransferNode,
  OUTBOUND,
  outboundOf,
  partFrameworksOn,
  partOptions,
  rulesFor,
  transferNodes,
  type ConnectionRule,
} from './connections.ts';
import { EMAIL_PARTS } from './email.ts';

const PLATFORMS: Platform[] = ['cloudflare', 'vercel', 'sakura', 'aws'];

/** 移し替える前（CROSS_PAIRS・2026-11-03）に許していた組。規則から導く組がこれと一致する（D-114 の段 1）。 */
const PAIRS_BEFORE_RULES = [
  'aws × api × cloudflare',
  'aws × email × resend',
  'aws × frontCdn × bunny',
  'aws × images × bunny',
  'aws × images × cloudflare',
  'aws-opennext × api × cloudflare',
  'aws-opennext × email × resend',
  'aws-opennext × images × bunny',
  'aws-opennext × images × cloudflare',
  'cloudflare × api × aws',
  'cloudflare × api × sakura',
  'cloudflare × email × aws',
  'cloudflare × email × resend',
  'gcp × email × resend',
  'gcp × images × bunny',
  'gcp × images × cloudflare',
  'netlify × api × cloudflare',
  'netlify × db × neon',
  'netlify × email × resend',
  'netlify × images × bunny',
  'netlify × images × cloudflare',
  'sakura × api × cloudflare',
  'sakura × email × resend',
  'sakura × frontCdn × bunny',
  'vercel × api × cloudflare',
  'vercel × db × neon',
  'vercel × email × resend',
  'vercel × images × bunny',
  'vercel × images × cloudflare',
];

/** 移し替える前の、他の事業者の部品ごとの差せる土台とフレームワーク（部品の順のまま）。 */
const COMPONENTS_BEFORE_RULES = [
  'images cloudflare:cf-images → aws,aws-opennext,gcp,netlify,vercel',
  'images cloudflare:cf-resize → aws,aws-opennext,gcp,netlify,vercel',
  'images bunny:bunny-images → aws,aws-opennext,gcp,netlify,vercel',
  'images bunny:bunny-resize → aws,aws-opennext,gcp,netlify,vercel',
  'frontCdn bunny:bunny → aws [nextjs]',
  'frontCdn bunny:bunny → sakura',
  'api cloudflare:cf-workers → aws,netlify,vercel [vite-spa,nextjs-export]',
  'api aws:aws-lambda → cloudflare [vite-spa,nextjs-export]',
  'api cloudflare:cf-workers-server → aws,aws-opennext,netlify,vercel [nextjs]',
  'api cloudflare:cf-workers-astro → netlify,sakura,vercel [astro]',
  'db neon:neon → netlify,vercel',
  'api sakura:sakura-vps-2gb → cloudflare [vite-spa,astro,nextjs-export]',
  'api sakura:sakura-vps-4gb → cloudflare [vite-spa,astro,nextjs-export]',
  'email aws:ses → cloudflare',
  'email resend:resend-free → aws,aws-opennext,cloudflare,gcp,netlify,sakura,vercel',
  'email resend:resend-pro → aws,aws-opennext,cloudflare,gcp,netlify,sakura,vercel',
  'email resend:resend-pro-100k → aws,aws-opennext,cloudflare,gcp,netlify,sakura,vercel',
];

/** 他の事業者の部品（土台の事業者と違う土台に差せるもの）。 */
const crossOptions = () =>
  COMPONENTS.filter((c) => hostsOf(c).some((h) => h !== c.platform));

describe('許した組（接続の規則から導く。D-114）', () => {
  it('規則から導いた組は、移し替える前の組（CROSS_PAIRS）と一致する', () => {
    const pairs = new Set(
      crossOptions().flatMap((c) =>
        hostsOf(c)
          .filter((h) => h !== c.platform)
          .map((h) => `${h} × ${c.slot} × ${c.platform}`),
      ),
    );
    expect([...pairs].sort()).toEqual(PAIRS_BEFORE_RULES);
  });

  it('部品ごとの差せる土台とフレームワークも、移し替える前と一致する', () => {
    expect(
      crossOptions().map(
        (c) =>
          `${c.slot} ${c.platform}:${c.id} → ${[...hostsOf(c)].sort().join(',')}` +
          (c.frameworks ? ` [${c.frameworks.join(',')}]` : ''),
      ),
    ).toEqual(COMPONENTS_BEFORE_RULES);
  });

  it('他の事業者に差せる部品は、規則で許した組だけで、部品の役割と口を持つ', () => {
    for (const c of crossOptions())
      expect(c.link, `${c.platform}:${c.id} の接続の形`).toBeDefined();
    for (const part of [...CROSS_PARTS, ...EMAIL_PARTS])
      for (const o of partOptions(part))
        for (const host of hostsOf(o) as Platform[])
          expect(
            rulesFor(host, part).length,
            `${host} × ${part.slot} × ${part.platform}:${part.id}`,
          ).toBeGreaterThan(0);
  });

  it('規則に無い組は選択肢に出ない（Cloudflare・VPS の画像に他の事業者の部品は出ない）', () => {
    const cross = (host: Platform, slot: SlotId) =>
      componentsOf(host, slot).filter((c) => c.platform !== host);
    for (const host of ['vercel', 'aws'] as const)
      expect(cross(host, 'images').map((c) => c.id)).toEqual([
        'cf-images',
        'cf-resize',
        'bunny-images',
        'bunny-resize',
      ]);
    for (const p of PLATFORMS)
      for (const slot of ['isrCache', 'realtime', 'apiCache'] as const)
        expect(cross(p, slot)).toEqual([]);
    // DB に他の事業者の部品を差せるのは Vercel・Netlify の Neon だけ（D-77）
    for (const p of [...PLATFORMS, 'aws-opennext', 'netlify'] as const)
      expect(cross(p, 'db').map((c) => c.id)).toEqual(
        p === 'vercel' || p === 'netlify' ? ['neon'] : [],
      );
    expect(cross('cloudflare', 'images')).toEqual([]);
    expect(cross('sakura', 'images')).toEqual([]);
  });

  it('部品の id は差せる土台の事業者のスロットの中で重ならない（フレームワークごと。API の置き場の同居は SPA と Next.js で別の説明）', () => {
    for (const host of [...PLATFORMS, 'aws-opennext'] as const)
      for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
        for (const slot of new Set(COMPONENTS.map((c) => c.slot))) {
          const ids = componentsOf(host, slot, fw).map((c) => c.id);
          expect(new Set(ids).size, `${host}:${slot}:${fw}`).toBe(ids.length);
        }
  });

  it('規則・送り出し・受け取りの項目の出典は URL と取得日を持つ（移し替える前の取得日のまま）', () => {
    for (const x of [...CONNECTION_RULES, ...OUTBOUND, ...INBOUND]) {
      expect(x.sources.length).toBeGreaterThan(0);
      for (const s of x.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(['2026-11-01', '2026-11-02', '2026-11-03']).toContain(
          s.retrievedAt,
        );
      }
    }
    expect(new Set(CONNECTION_RULES.map((r) => r.id)).size).toBe(
      CONNECTION_RULES.length,
    );
  });

  it('他の事業者の部品の名前は事業者の名前で始まる', () => {
    const NAMES = {
      cloudflare: 'Cloudflare',
      aws: 'AWS',
      sakura: 'さくらの VPS',
      neon: 'Neon',
      bunny: 'Bunny',
    } as const;
    for (const c of CROSS_COMPONENTS)
      expect(
        c.label.startsWith(`${NAMES[c.platform as keyof typeof NAMES]}: `),
      ).toBe(true);
  });
});

// 規則の単体（CP-14。架空の事業者で、口の組ごとの判定を確かめる。実在の料金を使わない）
describe('接続の規則の判定（架空の事業者）', () => {
  const host = 'fictional-host' as Platform;
  const other = 'fictional-other' as Platform;
  const part = {
    slot: 'images' as const,
    platform: 'fictional-store' as Platform,
    role: 'object-store' as const,
    accepts: ['https-api'] as const,
    attachesTo: ['compute'] as const,
  };
  const rule = (over: Partial<ConnectionRule> = {}): ConnectionRule => ({
    id: 'fictional',
    slot: 'images',
    from: { providers: [host], role: 'compute' },
    to: {
      providers: [part.platform],
      role: 'object-store',
      port: 'https-api',
    },
    verdict: 'ok',
    basis: '架空',
    sources: [],
    ...over,
  });

  it('呼ぶ側の土台・役割と、受ける側の事業者・役割・口がそろえば差せる', () => {
    expect(partFrameworksOn(part, host, [rule()])).toBeUndefined();
    expect(partFrameworksOn(part, other, [rule()])).toBeNull();
    // 口が合わない・役割が合わない・スロットが違う・blocked は差せない
    expect(
      partFrameworksOn(part, host, [
        rule({ to: { ...rule().to, port: 'tcp-sql' } }),
      ]),
    ).toBeNull();
    expect(
      partFrameworksOn(part, host, [
        rule({ from: { providers: [host], role: 'static-host' } }),
      ]),
    ).toBeNull();
    expect(partFrameworksOn(part, host, [rule({ slot: 'db' })])).toBeNull();
    expect(
      partFrameworksOn(part, host, [rule({ verdict: 'blocked' })]),
    ).toBeNull();
    // 中継が要る組（needs-relay）は差せる（中継は段 3 で自動で足す）
    expect(
      partFrameworksOn(part, host, [rule({ verdict: 'needs-relay' })]),
    ).toBeUndefined();
  });

  it('部品が土台を呼ぶ規則（前段の CDN が土台をオリジンにする）でも差せる', () => {
    const cdn = {
      ...part,
      role: 'edge-cdn' as const,
      accepts: ['public-url'] as const,
      attachesTo: ['edge-cdn'] as const,
    };
    const pull = rule({
      from: { providers: [part.platform], role: 'edge-cdn' },
      to: { providers: [host], role: 'edge-cdn', port: 'public-url' },
    });
    expect(partFrameworksOn(cdn, host, [pull])).toBeUndefined();
    // 土台の側の役割が部品のつながる役割と違えば差せない
    expect(
      partFrameworksOn({ ...cdn, attachesTo: ['compute'] }, host, [pull]),
    ).toBeNull();
  });

  it('フレームワークは規則の和と部品の条件の積', () => {
    const rules = [
      rule({ id: 'a', frameworks: ['nextjs'] }),
      rule({ id: 'b', frameworks: ['astro'] }),
    ];
    expect(partFrameworksOn(part, host, rules)).toEqual(['nextjs', 'astro']);
    expect(
      partFrameworksOn(
        { ...part, frameworks: ['astro', 'vite-spa'] },
        host,
        rules,
      ),
    ).toEqual(['astro']);
    expect(
      partFrameworksOn({ ...part, frameworks: ['vite-spa'] }, host, rules),
    ).toBeNull();
  });

  it('転送は送り手の送り出しと受け手の受け取りの項目をそれぞれ数え、項目が無い側は課金しない（CP-06）', () => {
    const meter = (idPrefix: string, provider: string) => ({
      idPrefix,
      name: idPrefix,
      facts: [],
      billing: (planId: string) => ({
        accountId: provider,
        provider,
        planId,
        meters: { 'egress-gb': 'transfer' },
      }),
    });
    const sender = {
      id: 'fn',
      label: '処理',
      role: 'compute' as const,
      config: { kind: 'function' as const },
      billing: {
        accountId: 'fictional-host',
        provider: 'fictional-host',
        planId: 'p',
        meters: {},
      },
    };
    const outbound = [
      {
        provider: 'fictional-host',
        meter: meter('fh', 'fictional-host'),
        basis: '架空',
        sources: [],
      },
    ];
    const inbound = [
      {
        provider: 'fictional-store',
        planIds: ['q'],
        meter: meter('fs', 'fictional-store'),
        basis: '架空',
        sources: [],
      },
    ];
    const both = transferNodes(
      sender,
      'fictional-store',
      '書き込み',
      undefined,
      {
        outbound,
        inbound,
      },
    );
    expect(both.map((n) => [n.id, n.billing?.planId])).toEqual([
      ['fh-out', 'p'],
      ['fs-in', 'q'],
    ]);
    expect(both.every(isTransferNode)).toBe(true);
    // 受け手に項目が無い・送り手に項目が無い・同じ事業者の中は、その側のノードを作らない
    expect(
      transferNodes(sender, 'fictional-store', '書き込み', undefined, {
        outbound,
        inbound: [],
      }).map((n) => n.id),
    ).toEqual(['fh-out']);
    expect(
      transferNodes(sender, 'fictional-store', '書き込み', undefined, {
        outbound: [],
        inbound,
      }).map((n) => n.id),
    ).toEqual(['fs-in']);
    expect(
      transferNodes(sender, 'fictional-host', '書き込み', undefined, {
        outbound,
        inbound,
      }),
    ).toEqual([]);
  });
});

describe('役割の印（D-114）', () => {
  /** 役割を持たない、経路の上のノード（転送を数えるだけのノードと、10 の役割に当てはまらない OpenNext の SQS）。 */
  const exempt = (n: { billing?: { planId: string } | undefined }) =>
    n.billing?.planId === 'sqs-fifo';

  it('経路にあるノードは役割の印を持つ（転送を数えるだけのノードを除く）', () => {
    const missing = new Set<string>();
    for (const def of STACK_DEFS)
      for (const fw of [
        'nextjs',
        'vite-spa',
        'astro',
        'nextjs-export',
      ] as const) {
        const variants: Choices[] = [{}];
        for (const slot of new Set(COMPONENTS.map((c) => c.slot)))
          for (const c of componentsOf(def.platform, slot, fw))
            variants.push({ [slot]: c.id });
        for (const choices of variants) {
          const a = composeStack(def, choices, { framework: fw });
          const used = new Set(Object.values(a.routes).flat());
          for (const n of a.nodes)
            if (
              used.has(n.id) &&
              n.role === undefined &&
              !isTransferNode(n) &&
              !exempt(n)
            )
              missing.add(`${def.id}:${n.id}`);
        }
      }
    expect([...missing]).toEqual([]);
  });

  it('転送を数えるだけのノードは、送り出しの項目のある処理の後ろにだけある', () => {
    for (const def of STACK_DEFS)
      for (const images of ['cf-images', 'bunny-resize'])
        for (const fw of ['nextjs', 'vite-spa'] as const) {
          const a = composeStack(def, { images }, { framework: fw });
          const path = a.routes['image-write'] ?? [];
          path.forEach((id, i) => {
            const n = a.nodes.find((x) => x.id === id)!;
            if (!isTransferNode(n)) return;
            const prev = a.nodes.find((x) => x.id === path[i - 1])!;
            expect(prev.role, `${def.id}:${id}`).toBe('compute');
            expect(
              outboundOf(prev)?.meter,
              `${def.id}:${prev.id}`,
            ).toBeDefined();
          });
        }
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
    // メールの送信（D-95）の既定の Amazon SES の AWS も構成の既定のアカウント
    expect(accountsOf(composeStack('vercel-supabase-pro'))).toEqual([
      'vercel',
      'supabase',
      'aws',
    ]);
    expect(accountsOf(pro('cf-images'))).toEqual([
      'vercel',
      'supabase',
      'cloudflare',
      'aws',
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

  it('選べる組は表で許したものだけ（VPS の構成にはスロットが無い。Next.js は D-67）', () => {
    const opts = (p: Platform, fw: 'nextjs' | 'vite-spa' = 'vite-spa') =>
      componentsOf(p, 'api', fw).map((c) => `${c.platform}:${c.id}`);
    expect(opts('vercel')).toEqual(['vercel:same', 'cloudflare:cf-workers']);
    expect(opts('aws')).toEqual(['aws:same', 'cloudflare:cf-workers']);
    expect(opts('cloudflare')).toEqual([
      'cloudflare:same',
      'aws:aws-lambda',
      'sakura:sakura-vps-2gb',
      'sakura:sakura-vps-4gb',
    ]);
    expect(opts('sakura')).toEqual([]);
    expect(opts('aws-opennext')).toEqual([]);
    for (const p of ['vercel', 'aws', 'aws-opennext'] as const)
      expect(opts(p, 'nextjs')).toEqual([
        `${p}:same`,
        'cloudflare:cf-workers-server',
      ]);
    for (const p of ['cloudflare', 'sakura'] as const)
      expect(opts(p, 'nextjs')).toEqual([]);
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
    expect(accountsOf(a)).toEqual(['vercel', 'cloudflare', 'aws']);
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

describe('Next.js のサーバーから別の事業者の API を呼ぶ（F-14・D-67）', () => {
  const next = (stack: string, choices: Record<string, string>, standby = {}) =>
    composeStack(stack, choices, { framework: 'nextjs', standby });
  const ids = (a: ReturnType<typeof next>) => a.nodes.map((n) => n.id);
  const api = { api: 'cf-workers-server' };

  it('既定（同じ事業者）は今までの Next.js の構成と同じ', () => {
    for (const s of ['vercel-supabase-pro', 'aws-amplify', 'aws-opennext'])
      expect(next(s, { api: 'same' })).toEqual(next(s, {}));
  });

  it('SPA の部品（cf-workers）は Next.js では効かず、Next.js の部品は SPA では効かない', () => {
    expect(next('vercel-supabase-pro', { api: 'cf-workers' })).toEqual(
      next('vercel-supabase-pro', {}),
    );
    const spa = (c: Record<string, string>) =>
      composeStack('vercel-supabase-pro', c, { framework: 'vite-spa' });
    expect(spa(api)).toEqual(spa({}));
  });

  it('Vercel: Supabase が外れ、SSR・ISR の作り直し・API の経路の DB が Worker → D1 になる（CDN と関数は残る）', () => {
    const a = next('vercel-supabase-pro', api);
    expect(accountsOf(a)).toEqual(['vercel', 'cloudflare', 'aws']);
    expect(ids(a)).not.toContain('db');
    expect(a.routes['document-ssr']).toEqual([
      'cdn',
      'fn',
      'cf-worker',
      'cf-d1',
    ]);
    expect(a.routes['isr-revalidate']).toEqual([
      'fn',
      'isr',
      'cf-worker',
      'cf-d1',
    ]);
    expect(a.routes.api).toEqual(['cdn', 'fn', 'cf-worker', 'cf-d1']);
    expect(a.routes['document-isr']).toEqual(['cdn', 'isr']);
    const worker = a.nodes.find((n) => n.id === 'cf-worker')!;
    expect(worker.billing!.planId).toBe('workers-paid');
    expect(worker.facts).toContain('server-fetch');
    // 関数から外への通信は数えない（事実の文で出す）
    expect(a.nodes.find((n) => n.id === 'fn')!.facts).toContain(
      'function-outbound',
    );
    expect(
      next('vercel-supabase-hobby', api).nodes.find(
        (n) => n.id === 'cf-worker',
      )!.billing!.planId,
    ).toBe('workers-free');
  });

  it('Worker の CPU は API の処理だけ（HTML の描画は Next.js のサーバーに残る）', () => {
    const w = resolveWorkload(articleCommunity(100_000));
    const sim = simulateResources(w, next('vercel-supabase-pro', api));
    const ssr = w.classes['document-ssr'];
    const rev = w.classes['isr-revalidate'];
    const apiCls = w.classes.api;
    expect(sim.nodes['cf-worker']!.resources['cpu-ms']).toBeCloseTo(
      (ssr.count + rev.count) * SERVER_API_WORKER_CPU_MS +
        apiCls.count * apiCls.perRequest.cpuMs,
    );
    // API を呼ぶたびに Worker のリクエスト
    expect(sim.nodes['cf-worker']!.resources.requests).toBeCloseTo(
      ssr.count + rev.count + apiCls.count,
    );
  });

  it('Amplify: DB が外れ、SSR から外への通信は数えない（事実の文で出す）', () => {
    const a = next('aws-amplify', api);
    expect(accountsOf(a)).toEqual(['aws', 'cloudflare']);
    expect(ids(a)).not.toContain('dynamodb');
    expect(ids(a)).not.toContain('aws-out-api');
    expect(a.routes['document-ssr']).toEqual([
      'cdn',
      'ssr',
      'cf-worker',
      'cf-d1',
    ]);
    expect(a.nodes.find((n) => n.id === 'ssr')!.facts).toContain(
      'ssr-outbound',
    );
  });

  it('OpenNext: Lambda から外へ送る問い合わせを 1 回 1 KB（仮定）として AWS のデータ転送で数える', () => {
    const a = next('aws-opennext', api);
    expect(ids(a)).not.toContain('dynamodb');
    expect(ids(a)).toContain('tags'); // ISR のタグの表は OpenNext の仕組みなので残る
    expect(a.routes['document-ssr']).toEqual([
      'cf',
      'server',
      'aws-out-api',
      'cf-worker',
      'cf-d1',
    ]);
    const out = a.nodes.find((n) => n.id === 'aws-out-api')!;
    expect(out.billing!.planId).toBe('data-transfer-out');
    const w = resolveWorkload(articleCommunity(100_000));
    const sim = simulateResources(w, a);
    const calls = sim.nodes['cf-worker']!.resources.requests!;
    expect(sim.nodes['aws-out-api']!.resources['egress-gb']).toBeCloseTo(
      (calls * SERVER_API_REQUEST_KB * 1000) / 1e9,
    );
  });

  it('移し替えの途中（standby）: Worker と D1 を経路に載せずに足す', () => {
    const to = next('vercel-supabase-pro', {}, api);
    expect(ids(to)).toEqual(expect.arrayContaining(['db', 'cf-worker']));
    expect(to.routes['document-ssr']).toEqual(['cdn', 'fn', 'db']);
  });
});

describe('Cloudflare の静的 + さくらの VPS の API（D-67）', () => {
  const spa = (c: Record<string, string>) =>
    composeStack('cloudflare-vinext-paid', c, { framework: 'vite-spa' });
  const a = spa({ api: 'sakura-vps-2gb' });

  it('Worker と D1 が外れ、API は VPS に直接（CDN を通らない）。投稿の画像は VPS が R2 に書く', () => {
    expect(accountsOf(a)).toEqual(['cloudflare', 'sakura']);
    for (const id of ['worker', 'd1'])
      expect(a.nodes.map((n) => n.id)).not.toContain(id);
    expect(a.routes.api).toEqual(['vps']);
    expect(a.routes['api-content']).toEqual(['vps']);
    expect(a.routes['image-write']).toEqual(['vps', 'r2']);
    expect(a.routes.asset).toEqual(['assets']);
    const vps = a.nodes.find((n) => n.id === 'vps')!;
    expect(vps.config).toMatchObject({ kind: 'host', vcpu: 3, lineMbps: 100 });
    expect(vps.billing!.planId).toBe('2gb-tokyo');
  });

  it('VPS の回線と CPU に届くのは API の分だけ（静的・画像の閲覧は Cloudflare）', () => {
    const w = resolveWorkload(
      toSpa(articleCommunity(100_000), ARTICLE_COMMUNITY_SPA),
    );
    const sim = simulateResources(w, a);
    const apiReqs = w.classes.api.count + w.classes['api-content'].count;
    expect(sim.nodes.vps!.resources.requests).toBeCloseTo(
      apiReqs + w.classes['image-write'].count,
    );
  });
});

describe('Astro の API の置き場（D-69）', () => {
  const astro = (stack: string, c: Record<string, string>, standby = {}) =>
    composeStack(stack, c, { framework: 'astro', standby });
  const ids = (a: ReturnType<typeof astro>) => a.nodes.map((n) => n.id);
  const w = () =>
    resolveWorkload(
      toAstro(articleCommunity(100_000), ARTICLE_COMMUNITY_ASTRO),
    );

  it('選べる組は Vercel・VPS の Astro + Workers・D1 と、Cloudflare の Astro + VPS の API だけ（AWS には Astro を載せない）', () => {
    const opts = (host: Platform) =>
      componentsOf(host, 'api', 'astro').map((c) => c.id);
    expect(opts('cloudflare')).toEqual([
      'same',
      'sakura-vps-2gb',
      'sakura-vps-4gb',
    ]);
    expect(opts('vercel')).toEqual(['same', 'cf-workers-astro']);
    expect(opts('sakura')).toEqual(['same', 'cf-workers-astro']);
    // Next.js・SPA の部品は Astro に出ず、Astro の部品は Next.js・SPA に出ない
    for (const fw of ['nextjs', 'vite-spa'] as const)
      for (const host of ['vercel', 'sakura'] as const)
        expect(componentsOf(host, 'api', fw).map((c) => c.id)).not.toContain(
          'cf-workers-astro',
        );
  });

  it('既定（同じ事業者）は今までの Astro の構成と同じ。Next.js の部品を渡しても変わらない', () => {
    for (const s of [
      'cloudflare-vinext-paid',
      'vercel-supabase-pro',
      'sakura-vps-2gb',
    ]) {
      expect(astro(s, { api: 'same' })).toEqual(astro(s, {}));
      expect(astro(s, { api: 'cf-workers-server' })).toEqual(astro(s, {}));
    }
  });

  it('Vercel: Supabase が外れ、マイページ・記事の描き直し・API の DB が Worker → D1 になる（D-103: 記事は ISR でキャッシュ・ビルドは無い）', () => {
    const a = astro('vercel-supabase-pro', { api: 'cf-workers-astro' });
    expect(accountsOf(a)).toEqual(['vercel', 'cloudflare', 'aws']);
    expect(ids(a)).not.toContain('db');
    expect(ids(a)).not.toContain('build');
    expect(a.routes['isr-revalidate']).toEqual([
      'fn',
      'isr',
      'cf-worker',
      'cf-d1',
    ]);
    expect(a.routes['document-ssr']).toEqual([
      'cdn',
      'fn',
      'cf-worker',
      'cf-d1',
    ]);
    expect(a.routes.api).toEqual(['cdn', 'fn', 'cf-worker', 'cf-d1']);
    expect(a.routes['document-static']).toEqual(['cdn']);
    const worker = a.nodes.find((n) => n.id === 'cf-worker')!;
    expect(worker.label).toContain('Astro');
    expect(worker.facts).toContain('astro-server-fetch');
    expect(a.nodes.find((n) => n.id === 'fn')!.facts).toContain(
      'function-outbound',
    );
    expect(
      astro('vercel-supabase-hobby', {
        api: 'cf-workers-astro',
      }).nodes.find((n) => n.id === 'cf-worker')!.billing!.planId,
    ).toBe('workers-free');
  });

  it('VPS: マイページ・API の VPS の後に Worker → D1。VPS は MySQL を動かさず、ディスクに DB を置かない', () => {
    const a = astro('sakura-vps-2gb', { api: 'cf-workers-astro' });
    expect(accountsOf(a)).toEqual(['sakura', 'cloudflare', 'aws']);
    expect(a.routes['document-ssr']).toEqual(['vps', 'cf-worker', 'cf-d1']);
    expect(a.routes.api).toEqual(['vps', 'cf-worker', 'cf-d1']);
    expect(a.routes['document-static']).toEqual(['vps']);
    expect(a.routes['image-read']).toEqual(['vps']);
    const vps = a.nodes.find((n) => n.id === 'vps')!;
    expect(vps.config).toMatchObject({
      kind: 'host',
      residentMemoryGB: VPS_RESIDENT_WITHOUT_DB_GB,
      dbCpuMsPerQuery: 0,
      storesDb: false,
    });
    expect(a.nodes.find((n) => n.id === 'cf-worker')!.billing!.planId).toBe(
      'workers-paid',
    );
    const sim = simulateResources(w(), a);
    const same = simulateResources(w(), astro('sakura-vps-2gb', {}));
    expect(sim.nodes.vps!.host!.diskGB).toBeLessThan(
      same.nodes.vps!.host!.diskGB,
    );
    expect(sim.nodes.vps!.host!.memoryGB).toBe(VPS_RESIDENT_WITHOUT_DB_GB);
  });

  it('VPS の移し替えの途中（standby）は MySQL を残し、Worker と D1 を経路に載せずに足す', () => {
    const to = astro('sakura-vps-2gb', {}, { api: 'cf-workers-astro' });
    expect(ids(to)).toEqual(expect.arrayContaining(['vps', 'cf-worker']));
    expect(to.routes['document-ssr']).toEqual(['vps']);
    expect(to.nodes.find((n) => n.id === 'vps')!.config).toMatchObject({
      residentMemoryGB: 1.35,
    });
    const back = astro(
      'sakura-vps-2gb',
      { api: 'cf-workers-astro' },
      { api: 'same' },
    );
    expect(back.nodes.find((n) => n.id === 'vps')!.config).toMatchObject({
      residentMemoryGB: 1.35,
    });
  });

  it('Cloudflare: D1 が外れ、ブラウザの API・投稿は VPS に直接。マイページと記事を描く Worker は残り、VPS の API を呼ぶ', () => {
    const a = astro('cloudflare-vinext-paid', { api: 'sakura-vps-2gb' });
    expect(accountsOf(a)).toEqual(['cloudflare', 'sakura']);
    expect(ids(a)).not.toContain('d1');
    expect(ids(a)).toContain('worker');
    expect(ids(a)).not.toContain('build');
    expect(a.routes['document-ssr']).toEqual(['worker', 'vps']);
    expect(a.routes['isr-revalidate']).toEqual(['worker', 'vps']);
    expect(a.routes.api).toEqual(['vps']);
    expect(a.routes['image-write']).toEqual(['vps', 'r2']);
    expect(a.routes['document-static']).toEqual(['assets']);
    const worker = a.nodes.find((n) => n.id === 'worker')!;
    expect(worker.facts).toEqual(
      expect.arrayContaining(['astro-server-fetch', 'worker-outbound']),
    );
    // Images は Worker が残るので binding のまま（URL での変換に替えない）
    expect(a.nodes.find((n) => n.id === 'images')!.facts ?? []).not.toContain(
      'transform-url',
    );
    // Hyperdrive + Supabase を選んでいても、VPS に 1 回だけ差し替える
    const h = astro('cloudflare-vinext-paid', {
      api: 'sakura-vps-2gb',
      db: 'hyperdrive',
    });
    expect(h.routes['document-ssr']).toEqual(['worker', 'vps']);
  });

  it('Cloudflare + VPS の API: マイページの描画の CPU は Worker に残り、VPS は API の 1 回として数える（OCL-4D1F5201）', () => {
    const a = astro('cloudflare-vinext-paid', { api: 'sakura-vps-2gb' });
    const r = w();
    const doc = r.classes['document-ssr'];
    const heavy = {
      ...r,
      classes: {
        ...r.classes,
        'document-ssr': {
          ...doc,
          perRequest: { ...doc.perRequest, cpuMs: doc.perRequest.cpuMs * 3 },
        },
      },
    };
    const sim = simulateResources(r, a);
    const sim3 = simulateResources(heavy, a);
    // VPS の CPU・回線は描画の重さで変わらない
    expect(sim3.nodes.vps!.host!.peakCores).toBeCloseTo(
      sim.nodes.vps!.host!.peakCores,
    );
    expect(sim3.nodes.vps!.host!.peakMbps).toBeCloseTo(
      sim.nodes.vps!.host!.peakMbps,
    );
    expect(sim3.nodes.worker!.resources['cpu-ms']!).toBeGreaterThan(
      sim.nodes.worker!.resources['cpu-ms']!,
    );
    // 1 回は API の 1 件と同じ（同じ数の API を直接受けた VPS と等しい）
    const ssr = r.classes['document-ssr'];
    const apiCls = r.classes.api;
    const vps = a.nodes.find((n) => n.id === 'vps')!;
    expect(vps.config).toMatchObject({
      serverApiClasses: ['document-ssr', 'isr-revalidate'],
    });
    const rev = r.classes['isr-revalidate'].count;
    expect(sim.nodes.vps!.resources['egress-gb']).toBeCloseTo(
      ((ssr.count + rev + apiCls.count) * apiCls.perRequest.kb +
        r.classes['image-write'].count *
          r.classes['image-write'].perRequest.kb) /
        1e6,
    );
  });

  it('Cloudflare + VPS の API: VPS に届くのはマイページ・記事の描き直しの問い合わせ・API・投稿だけ', () => {
    const a = astro('cloudflare-vinext-paid', { api: 'sakura-vps-2gb' });
    const r = w();
    const sim = simulateResources(r, a);
    expect(sim.nodes.vps!.resources.requests).toBeCloseTo(
      r.classes['document-ssr'].count +
        r.classes['isr-revalidate'].count +
        r.classes.api.count +
        r.classes['image-write'].count,
    );
  });
});

describe('DB だけ Neon（D-77）', () => {
  const neon = (stack: string, choices = {}, options = {}) =>
    composeStack(stack, { db: 'neon', ...choices }, options);
  const dbNode = (a: ReturnType<typeof neon>, id = 'db') =>
    a.nodes.find((n) => n.id === id);

  it('Supabase のノードを Neon に差し替え、経路は変えない（Pro・Personal は Launch、Hobby・Free は Free）', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
      for (const stack of ['vercel-supabase-pro', 'netlify-supabase-pro']) {
        const base = composeStack(stack, {}, { framework: fw });
        const a = neon(stack, {}, { framework: fw });
        expect(a.routes).toEqual(base.routes);
        expect(accountsOf(a)).not.toContain('supabase');
        expect(accountsOf(a)).toContain('neon');
        expect(dbNode(a)).toMatchObject({
          config: {
            kind: 'managed-db',
            capacityUnits: NEON_MIN_CU,
            pauseAfterIdleSeconds: NEON_SUSPEND_SECONDS,
          },
          billing: { provider: 'neon', planId: 'launch' },
        });
      }
    expect(neon('vercel-supabase-pro').name).toBe(
      'Vercel Pro + Neon（Launch）',
    );
    expect(neon('vercel-supabase-hobby').name).toBe(
      'Vercel Hobby + Neon（Free）',
    );
    expect(dbNode(neon('netlify-supabase-personal'))!.billing!.planId).toBe(
      'launch',
    );
    expect(dbNode(neon('netlify-supabase-free'))!.billing!.planId).toBe('free');
    // 既定は Supabase のまま（完成品の構成は変わらない）
    expect(dbNode(composeStack('vercel-supabase-pro'))!.billing!.provider).toBe(
      'supabase',
    );
  });

  it('東京が無いこと・serverless driver・止まる仕組みを前提に出す', () => {
    expect(dbNode(neon('vercel-supabase-pro'))!.facts).toEqual([
      'region',
      'serverless-driver',
      'scale-to-zero',
      'compute-size',
    ]);
  });

  it('動いている割合は DB に届く件数から出す（閲覧が少ないと止まる時間が増える）', () => {
    const awake = (pv: number) =>
      simulateResources(
        resolveWorkload(articleCommunity(pv)),
        neon('vercel-supabase-pro'),
      ).nodes.db!;
    const small = awake(1_000);
    const big = awake(1_000_000);
    expect(small.awakeShare!).toBeLessThan(big.awakeShare!);
    expect(big.awakeShare!).toBeLessThanOrEqual(1);
    expect(big.resources['instance-hours']).toBeCloseTo(
      730 * NEON_MIN_CU * big.awakeShare!,
    );
  });

  it('差し替えの途中は移す先の DB を経路に載せずに足す（新旧の両方の費用）', () => {
    const toNeon = composeStack(
      'vercel-supabase-pro',
      {},
      { standby: { db: 'neon' } },
    );
    expect(dbNode(toNeon)!.billing!.provider).toBe('supabase');
    expect(dbNode(toNeon, 'db-next')!.billing!.provider).toBe('neon');
    expect(Object.values(toNeon.routes).flat()).not.toContain('db-next');
    const back = neon(
      'netlify-supabase-pro',
      {},
      { standby: { db: 'supabase' } },
    );
    expect(dbNode(back)!.billing!.provider).toBe('neon');
    expect(dbNode(back, 'db-next')!.billing!.provider).toBe('supabase');
  });

  it('API を他の事業者に置くと、DB のノード（Neon）は外れる', () => {
    const a = neon(
      'vercel-supabase-pro',
      { api: 'cf-workers' },
      { framework: 'vite-spa' },
    );
    expect(accountsOf(a)).toEqual(['vercel', 'cloudflare', 'aws']);
  });
});
