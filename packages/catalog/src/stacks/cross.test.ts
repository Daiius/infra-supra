// 事業者をまたぐ構成（D-52・prd/11 §2）: 許した組だけが選択肢に出る・課金が事業者ごとに分かれる。
import { describe, expect, it } from 'vitest';
import { resolveWorkload, simulateResources } from 'estimator';
import { toAstro, toSpa, type FrameworkId } from '../frameworks/index.ts';
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

/** 段 2（D-114・CP-15）で足した組。移し替える前の組にこれだけが加わる。 */
const PAIRS_ADDED_STAGE2 = ['vercel × db × aws'];

/** 段 2b（D-114・2026-11-04）で足した組: Cloudflare の DB に Neon・AWS（Postgres は Hyperdrive 経由・DynamoDB は直接）。 */
const PAIRS_ADDED_STAGE3 = ['cloudflare × db × aws', 'cloudflare × db × neon'];

/**
 * 段 2c（D-114・2026-11-04）で足した組: 画像だけ AWS（S3 + CloudFront）を Vercel・Netlify・Google Cloud に。
 * 原本だけ R2・変換は Vercel の画像の最適化（cf-r2-origin）は、今の「vercel × images × cloudflare」の組の中の部品。
 */
const PAIRS_ADDED_STAGE2C = [
  'gcp × images × aws',
  'netlify × images × aws',
  'vercel × images × aws',
];

/**
 * 段 2d（D-114・2026-11-04）で足した組: 公開の口へ出られる土台の処理 → 公開の口を持つ DB を規則で一括に開いた
 * （さくらの VPS・Google Cloud・AWS・OpenNext に Neon・Supabase、さくらの VPS・Google Cloud・Netlify に AWS の DB）。
 */
const PAIRS_ADDED_STAGE2D = [
  'aws × db × neon',
  'aws × db × supabase',
  'aws-opennext × db × neon',
  'aws-opennext × db × supabase',
  'gcp × db × aws',
  'gcp × db × neon',
  'gcp × db × supabase',
  'netlify × db × aws',
  'sakura × db × aws',
  'sakura × db × neon',
  'sakura × db × supabase',
];

/** 移し替える前の、他の事業者の部品ごとの差せる土台とフレームワーク（部品の順のまま）。 */
const COMPONENTS_BEFORE_RULES = [
  'images cloudflare:cf-images → aws,aws-opennext,gcp,netlify,vercel',
  'images cloudflare:cf-resize → aws,aws-opennext,gcp,netlify,vercel',
  'images bunny:bunny-images → aws,aws-opennext,gcp,netlify,vercel',
  'images bunny:bunny-resize → aws,aws-opennext,gcp,netlify,vercel',
  // 段 2c（D-114）で足した部品。S3 + CloudFront は土台ごとに書き方（OIDC・アクセスキー）の文が違うので別の選択肢
  'images cloudflare:cf-r2-origin → vercel [nextjs,vite-spa,astro]',
  'images aws:aws-s3-resize → vercel',
  'images aws:aws-s3-resize → gcp,netlify',
  'frontCdn bunny:bunny → aws [nextjs]',
  'frontCdn bunny:bunny → sakura',
  'api cloudflare:cf-workers → aws,netlify,vercel [vite-spa,nextjs-export]',
  'api aws:aws-lambda → cloudflare [vite-spa,nextjs-export]',
  'api cloudflare:cf-workers-server → aws,aws-opennext,netlify,vercel [nextjs]',
  'api cloudflare:cf-workers-astro → netlify,sakura,vercel [astro]',
  // 段 2b（D-114）で Cloudflare（Hyperdrive 経由）を足した。土台ごとのつなぎ方の文が違うので別の選択肢
  'db neon:neon → cloudflare',
  'db neon:neon → netlify,vercel',
  // 段 2d（D-114）: 公開の口の規則で開いた土台（TCP で接続のプールへ）
  'db neon:neon → aws,aws-opennext,gcp,sakura',
  'db supabase:supabase → aws,aws-opennext,gcp,sakura',
  // 段 2（D-114）で足した部品。段 2b で Cloudflare（DynamoDB は直接・Aurora・RDS は Hyperdrive 経由）
  'db aws:dynamodb → cloudflare',
  'db aws:dynamodb → vercel',
  'db aws:dynamodb → gcp,netlify,sakura',
  'db aws:aurora → cloudflare',
  'db aws:aurora → vercel',
  'db aws:aurora → gcp,netlify,sakura',
  'db aws:aurora-pause → cloudflare',
  'db aws:aurora-pause → vercel',
  'db aws:aurora-pause → gcp,netlify,sakura',
  'db aws:rds → cloudflare',
  'db aws:rds → gcp,netlify,sakura',
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
  it('規則から導いた組は、移し替える前の組（CROSS_PAIRS）と段 2 で足した組に一致する', () => {
    const pairs = new Set(
      crossOptions().flatMap((c) =>
        hostsOf(c)
          .filter((h) => h !== c.platform)
          .map((h) => `${h} × ${c.slot} × ${c.platform}`),
      ),
    );
    expect([...pairs].sort()).toEqual(
      [
        ...PAIRS_BEFORE_RULES,
        ...PAIRS_ADDED_STAGE2,
        ...PAIRS_ADDED_STAGE3,
        ...PAIRS_ADDED_STAGE2C,
        ...PAIRS_ADDED_STAGE2D,
      ].sort(),
    );
  });

  it('部品ごとの差せる土台とフレームワークも、移し替える前（と段 2 で足した部品）と一致する', () => {
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
    expect(cross('aws', 'images').map((c) => c.id)).toEqual([
      'cf-images',
      'cf-resize',
      'bunny-images',
      'bunny-resize',
    ]);
    // 段 2c（D-114）: Vercel に原本だけ R2（変換は Vercel の画像の最適化）と S3 + CloudFront
    expect(cross('vercel', 'images').map((c) => c.id)).toEqual([
      'cf-images',
      'cf-resize',
      'bunny-images',
      'bunny-resize',
      'cf-r2-origin',
      'aws-s3-resize',
    ]);
    for (const p of PLATFORMS)
      for (const slot of ['isrCache', 'realtime', 'apiCache'] as const)
        expect(cross(p, slot)).toEqual([]);
    // DB に他の事業者の部品を差せるのは Vercel・Netlify の Neon（D-77）と、Vercel の AWS の DynamoDB・Aurora（D-114 段 2）、
    // Cloudflare の Neon・AWS の DynamoDB・Aurora・RDS（段 2b）、公開の口の規則で開いた土台（段 2d）。
    // 土台の事業者自身の DB（AWS・OpenNext の AWS の DB・Vercel・Netlify の Supabase）は他の事業者の部品として出ない
    const awsDbs = ['dynamodb', 'aurora', 'aurora-pause', 'rds'];
    for (const p of [...PLATFORMS, 'aws-opennext', 'netlify'] as const)
      expect(cross(p, 'db').map((c) => c.id)).toEqual(
        p === 'vercel'
          ? ['neon', 'dynamodb', 'aurora', 'aurora-pause']
          : p === 'netlify'
            ? ['neon', ...awsDbs]
            : p === 'cloudflare'
              ? ['neon', ...awsDbs]
              : p === 'aws' || p === 'aws-opennext'
                ? ['neon', 'supabase']
                : ['neon', 'supabase', ...awsDbs],
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

  it('規則・送り出し・受け取りの項目の出典は URL と取得日を持つ（移し替える前の取得日のまま。段 2b で足した分は 2026-11-04）', () => {
    for (const x of [...CONNECTION_RULES, ...OUTBOUND, ...INBOUND]) {
      expect(x.sources.length).toBeGreaterThan(0);
      for (const s of x.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect([
          '2026-11-01',
          '2026-11-02',
          '2026-11-03',
          '2026-11-04',
        ]).toContain(s.retrievedAt);
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
      supabase: 'Supabase',
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

describe('Vercel + 原本だけ R2・変換は Vercel の画像の最適化（D-114 段 2c）', () => {
  const pro = (images: string, framework?: FrameworkId) =>
    composeStack(
      'vercel-supabase-pro',
      { images },
      framework ? { framework } : {},
    );
  const base = composeStack('vercel-supabase-pro');

  it('Blob だけを R2 に替え、CDN → 画像の最適化の配信と変換はそのまま。投稿は関数が R2 に書く', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const) {
      const a = pro('cf-r2-origin', fw);
      const b = composeStack('vercel-supabase-pro', {}, { framework: fw });
      expect(a.routes['image-read'], fw).toEqual(b.routes['image-read']);
      expect(a.routes['image-read'], fw).toEqual(['cdn', 'image']);
      expect(a.routes['image-transform'], fw).toEqual(['image']);
      expect(a.routes['image-write'], fw).toEqual(['fn', 'cf-r2']);
      expect(
        a.nodes.some((n) => n.id === 'blob'),
        fw,
      ).toBe(false);
      expect(
        a.nodes.find((n) => n.id === 'image'),
        fw,
      ).toEqual(b.nodes.find((n) => n.id === 'image'));
      const r2 = a.nodes.find((n) => n.id === 'cf-r2')!;
      expect(r2.label).toBe('Cloudflare R2（画像の原本）');
      expect(r2.role).toBe('object-store');
      expect(r2.billing).toMatchObject({
        accountId: 'cloudflare',
        planId: 'r2-standard',
      });
      // R2 は受け取りに課金せず、Vercel の関数の送り出しは項目が無い（転送のノードを作らない）
      expect(a.nodes.filter(isTransferNode), fw).toEqual([]);
    }
    expect(accountsOf(pro('cf-r2-origin'))).toEqual([
      'vercel',
      'supabase',
      'cloudflare',
      'aws',
    ]);
    // 構成の名前は画像の部品で変えない（他の画像の部品と同じ）
    expect(pro('cf-r2-origin').name).toBe(base.name);
  });

  it('差せるのは Vercel の、画像の最適化を使える形だけ（Next.js の静的書き出しは既定のローダーが使えない）', () => {
    const on = (host: Platform, fw?: FrameworkId) =>
      componentsOf(host, 'images', fw).some((c) => c.id === 'cf-r2-origin');
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
      expect(on('vercel', fw), fw).toBe(true);
    expect(on('vercel', 'nextjs-export')).toBe(false);
    for (const host of [
      'aws',
      'aws-opennext',
      'netlify',
      'gcp',
      'cloudflare',
      'sakura',
    ] as const)
      expect(on(host), host).toBe(false);
    const part = CROSS_PARTS.find((p) => p.id === 'cf-r2-origin')!;
    expect(rulesFor('vercel', part).map((x) => x.id)).toEqual([
      'vercel-image-r2-origin',
    ]);
  });

  it('振る舞いは土台の画像の最適化と同じ（Workload を変えない）', () => {
    expect(imagesBehavior('vercel', 'cf-r2-origin')).toBe('default');
    const w = articleCommunity(300_000);
    expect(
      applyComponentsToWorkload(w, 'vercel', { images: 'cf-r2-origin' }),
    ).toEqual(applyComponentsToWorkload(w, 'vercel', { images: 'default' }));
  });

  it('変換・キャッシュの読み書き・CDN の配信は既定（Blob）と同じ量で、Blob の保存と書き込みが R2 に替わる', () => {
    const w = applyComponentsToWorkload(
      articleCommunity(300_000),
      'vercel',
      {},
    );
    const usage = (a: ReturnType<typeof pro>) =>
      simulateResources(resolveWorkload(w), a).nodes;
    const r = usage(pro('cf-r2-origin'));
    const b = usage(base);
    for (const id of ['cdn', 'image', 'fn'])
      expect(r[id]!.resources, id).toEqual(b[id]!.resources);
    expect(r['cf-r2']!.resources['storage-gb-month']).toBe(
      b['blob']!.resources['storage-gb-month'],
    );
    expect(r['cf-r2']!.resources['object-writes']).toBe(
      b['blob']!.resources['object-writes'],
    );
  });
});

describe('画像だけ AWS（S3 + CloudFront。D-114 段 2c）', () => {
  const on = (stack: string, framework?: FrameworkId) =>
    composeStack(
      stack,
      { images: 'aws-s3-resize' },
      framework ? { framework } : {},
    );

  it('Vercel: CDN の画像・Blob・画像の最適化が外れ、CloudFront → S3 から配る。投稿は関数が S3 に書く（転送は数えない）', () => {
    for (const fw of [
      'nextjs',
      'vite-spa',
      'astro',
      'nextjs-export',
    ] as const) {
      const a = on('vercel-supabase-pro', fw);
      expect(a.routes['image-read'], fw).toEqual(['aws-img-cf', 'aws-s3']);
      expect(a.routes['image-write'], fw).toEqual(['fn', 'aws-s3']);
      expect(a.routes['image-transform'], fw).toBeUndefined();
      expect(
        a.nodes.some((n) => n.id === 'blob' || n.id === 'image'),
        fw,
      ).toBe(false);
      expect(a.nodes.filter(isTransferNode), fw).toEqual([]);
      const cf = a.nodes.find((n) => n.id === 'aws-img-cf')!;
      expect(cf.label).toBe('CloudFront（画像）');
      expect(cf.role).toBe('edge-cdn');
      expect(cf.billing).toMatchObject({
        accountId: 'aws',
        planId: 'cloudfront',
      });
      const s3 = a.nodes.find((n) => n.id === 'aws-s3')!;
      expect(s3.role).toBe('object-store');
      expect(s3.billing).toMatchObject({
        accountId: 'aws',
        planId: 's3-standard',
      });
    }
    // AWS のアカウントは既定のメールの送信（SES）と同じ
    expect(accountsOf(on('vercel-supabase-pro')).sort()).toEqual(
      accountsOf(composeStack('vercel-supabase-pro')).sort(),
    );
  });

  it('Netlify・Google Cloud: 投稿の送るデータは土台の送り出しの項目で数える（Netlify の転送量・Cloud Run の Premium Tier）', () => {
    for (const [stack, out] of [
      ['netlify-supabase-pro', 'netlify-out'],
      ['gcp-cloud-run', 'gcp-out'],
    ] as const) {
      const a = on(stack);
      expect(a.routes['image-read'], stack).toEqual(['aws-img-cf', 'aws-s3']);
      expect(a.routes['image-write']!.slice(-2), stack).toEqual([
        out,
        'aws-s3',
      ]);
      expect(a.nodes.find((n) => n.id === out)!.label).toContain(
        'S3 への書き込み',
      );
    }
  });

  it('差せるのは Vercel・Netlify・Google Cloud（AWS・OpenNext は自分の S3 を持つ）。振る舞いは「投稿のときに一律で縮める」', () => {
    const offered = (host: Platform) =>
      componentsOf(host, 'images').some((c) => c.id === 'aws-s3-resize');
    for (const host of ['vercel', 'netlify', 'gcp'] as const)
      expect(offered(host), host).toBe(true);
    for (const host of ['aws', 'aws-opennext', 'cloudflare', 'sakura'] as const)
      expect(offered(host), host).toBe(false);
    expect(imagesBehavior('vercel', 'aws-s3-resize')).toBe('resize');
    const w = articleCommunity(300_000);
    const wl = (images: string) =>
      applyComponentsToWorkload(
        w,
        'vercel',
        { images },
        { resizedImageKB: 400 },
      );
    expect(wl('aws-s3-resize')).toEqual(wl('resize'));
  });

  it('S3 と CloudFront は AWS の構成の「投稿のときに一律で縮めて置く」と同じ課金（id と名前だけ違う）', () => {
    const own = composeStack('aws-amplify', { images: 'resize' });
    const a = on('vercel-supabase-pro');
    const strip = (n: (typeof a.nodes)[number] | undefined) => {
      const { id: _i, label: _l, ...rest } = n!;
      return rest;
    };
    expect(strip(a.nodes.find((n) => n.id === 'aws-s3'))).toEqual(
      strip(own.nodes.find((n) => n.id === 's3')),
    );
    expect(strip(a.nodes.find((n) => n.id === 'aws-img-cf')).billing).toEqual(
      strip(own.nodes.find((n) => n.id === 'cf')).billing,
    );
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

describe('DB だけ AWS（Vercel × DynamoDB・Aurora。D-114 段 2）', () => {
  const withDb = (db: string, stack = 'vercel-supabase-pro', options = {}) =>
    composeStack(stack, { db }, options);
  const node = (a: ReturnType<typeof withDb>, id: string) =>
    a.nodes.find((n) => n.id === id);

  it('Supabase のノードを AWS の DB に差し替え（id は db のまま）、経路の DB の手前に応答の転送を置く', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
      for (const [db, planId] of [
        ['dynamodb', 'dynamodb-on-demand'],
        ['aurora', 'aurora-serverless-v2-io'],
        ['aurora-pause', 'aurora-serverless-v2-io'],
      ] as const) {
        const base = composeStack('vercel-supabase-pro', {}, { framework: fw });
        const a = withDb(db, 'vercel-supabase-pro', { framework: fw });
        expect(node(a, 'db')).toMatchObject({
          role: 'sql-db',
          billing: { accountId: 'aws', provider: 'aws', planId },
        });
        expect(accountsOf(a)).not.toContain('supabase');
        // AWS のアカウントは既定のメールの送信（SES）で既にある（増えない）
        expect(accountsOf(base)).toContain('aws');
        // 経路は DB の手前に転送のノードが入るだけ
        const strip = (r: typeof a.routes) =>
          Object.fromEntries(
            Object.entries(r).map(([k, p]) => [
              k,
              p!.filter((id) => id !== 'aws-db-out'),
            ]),
          );
        expect(strip(a.routes)).toEqual(base.routes);
        for (const p of Object.values(a.routes))
          p!.forEach((id, i) => {
            if (id === 'db') expect(p![i - 1]).toBe('aws-db-out');
          });
        expect(isTransferNode(node(a, 'aws-db-out')!)).toBe(true);
        expect(node(a, 'aws-db-out')).toMatchObject({
          config: { kind: 'cdn', egressPerQuery: true },
          facts: [db === 'dynamodb' ? 'dynamodb-out' : 'aurora-out'],
          billing: {
            provider: 'aws',
            planId: 'data-transfer-out',
            meters: { 'egress-gb': 'internet-out' },
          },
        });
        // 受け手（Vercel の関数）には受け取りの項目が無い根拠を添える
        expect(node(a, 'fn')!.facts).toContain('function-inbound');
      }
    expect(withDb('dynamodb').name).toBe('Vercel Pro + AWS DynamoDB');
    expect(withDb('aurora', 'vercel-supabase-hobby').name).toBe(
      'Vercel Hobby + AWS Aurora Serverless v2',
    );
    expect(node(withDb('aurora-pause'), 'db')!.config).toMatchObject({
      kind: 'managed-db',
      pauseAfterIdleSeconds: 300,
    });
  });

  it('応答の転送は問い合わせの数 × 応答の大きさ（Supabase の egress と同じ量）', () => {
    const w = resolveWorkload(articleCommunity(300_000));
    const supa = simulateResources(w, composeStack('vercel-supabase-pro')).nodes
      .db!.resources['egress-gb']!;
    expect(supa).toBeGreaterThan(0);
    for (const db of ['dynamodb', 'aurora']) {
      const u = simulateResources(w, withDb(db)).nodes['aws-db-out']!;
      expect(u.resources['egress-gb']).toBeCloseTo(supa, 9);
    }
  });

  it('Vercel の規則（Marketplace・OIDC）は他の土台に効かない（Netlify は段 2d の公開の口の規則で、同じリージョンの扱いを持たない）', () => {
    const a = composeStack('netlify-supabase-pro', { db: 'dynamodb' });
    expect(node(a, 'db')!.billing!.provider).toBe('aws');
    expect(node(a, 'aws-db-out')!.facts).toEqual(['db-out-internet']);
    expect(
      componentsOf('netlify', 'db').find((c) => c.id === 'dynamodb')!.note,
    ).not.toContain('OIDC');
  });

  it('差し替えの途中は移す先の DB を経路に載せずに足し、転送のノードは今の DB の分だけ', () => {
    const to = composeStack(
      'vercel-supabase-pro',
      {},
      { standby: { db: 'dynamodb' } },
    );
    expect(node(to, 'db')!.billing!.provider).toBe('supabase');
    expect(node(to, 'db-next')!.billing!.planId).toBe('dynamodb-on-demand');
    expect(node(to, 'aws-db-out')).toBeUndefined();
    expect(Object.values(to.routes).flat()).not.toContain('db-next');
    const back = composeStack(
      'vercel-supabase-pro',
      { db: 'aurora' },
      { standby: { db: 'supabase' } },
    );
    expect(node(back, 'db')!.billing!.provider).toBe('aws');
    expect(node(back, 'db-next')!.billing!.provider).toBe('supabase');
    expect(node(back, 'aws-db-out')).toBeDefined();
  });

  it('DB のバックアップは AWS の DB の既定・PITR になる', () => {
    const pitr = composeStack('vercel-supabase-pro', {
      db: 'dynamodb',
      dbBackup: 'pitr',
    });
    expect(
      pitr.nodes.find((n) => n.config.kind === 'db-backup')!.billing,
    ).toMatchObject({ provider: 'aws', planId: 'dynamodb-on-demand' });
  });

  it('API を他の事業者に置くと、DB のノードと応答の転送は外れる', () => {
    const a = composeStack(
      'vercel-supabase-pro',
      { db: 'dynamodb', api: 'cf-workers-server' },
      { framework: 'nextjs' },
    );
    expect(node(a, 'db')).toBeUndefined();
    expect(node(a, 'aws-db-out')).toBeUndefined();
  });
});

describe('Cloudflare の DB に他の事業者（Neon・AWS。D-114 段 2b）', () => {
  const node = (a: ReturnType<typeof composeStack>, id: string) =>
    a.nodes.find((n) => n.id === id);
  const POSTGRES = [
    ['neon', 'neon', 'launch'],
    ['aurora', 'aws', 'aurora-serverless-v2-io'],
    ['aurora-pause', 'aws', 'aurora-serverless-v2-io'],
    ['rds', 'aws', 'rds-postgres-t4g-micro'],
  ] as const;
  /** D1 の構成の経路の D1 を、ids に替えたもの。 */
  const swapD1 = (r: Record<string, string[] | undefined>, ids: string[]) =>
    Object.fromEntries(
      Object.entries(r).map(([k, p]) => [
        k,
        p!.flatMap((id) => (id === 'd1' ? ids : [id])),
      ]),
    );

  it('Postgres（Neon・Aurora・RDS）は Hyperdrive を中継に自動で足し、経路は D1 の位置に Hyperdrive → 転送 → DB', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro', 'nextjs-export'] as const)
      for (const [db, provider, planId] of POSTGRES) {
        const base = composeStack(
          'cloudflare-vinext-paid',
          {},
          { framework: fw },
        );
        const a = composeStack(
          'cloudflare-vinext-paid',
          { db },
          { framework: fw },
        );
        const out = provider === 'aws' ? ['aws-db-out'] : [];
        expect(a.routes).toEqual(
          swapD1(base.routes, ['hyperdrive', ...out, 'db']),
        );
        expect(node(a, 'd1')).toBeUndefined();
        expect(node(a, 'db')).toMatchObject({
          role: 'sql-db',
          billing: { provider, planId },
        });
        expect(node(a, 'hyperdrive')).toMatchObject({
          role: 'db-proxy',
          config: { kind: 'db-proxy' },
          facts: ['origin-db', 'idle-connections'],
          billing: {
            provider: 'cloudflare',
            planId: 'hyperdrive-paid',
            meters: { queries: 'queries' },
          },
        });
        if (provider === 'aws')
          expect(node(a, 'aws-db-out')).toMatchObject({
            config: { kind: 'cdn', egressPerQuery: true },
            facts: ['db-out-internet'],
            billing: { provider: 'aws', planId: 'data-transfer-out' },
          });
        else expect(node(a, 'aws-db-out')).toBeUndefined();
      }
  });

  it('Neon は Hyperdrive を通すので serverless driver の事実を出さず、Free の土台なら Neon Free・Hyperdrive Free', () => {
    const paid = composeStack('cloudflare-vinext-paid', { db: 'neon' });
    expect(node(paid, 'db')!.facts).not.toContain('serverless-driver');
    const free = composeStack('cloudflare-vinext-free', { db: 'neon' });
    expect(node(free, 'db')!.billing!.planId).toBe('free');
    expect(node(free, 'hyperdrive')!.billing!.planId).toBe('hyperdrive-free');
    expect(accountsOf(free)).toContain('neon');
  });

  it('DynamoDB は中継なしで Worker から直接（HTTPS）。応答はインターネットへの転送', () => {
    const base = composeStack('cloudflare-vinext-paid');
    const a = composeStack('cloudflare-vinext-paid', { db: 'dynamodb' });
    expect(a.routes).toEqual(swapD1(base.routes, ['aws-db-out', 'db']));
    expect(node(a, 'hyperdrive')).toBeUndefined();
    expect(node(a, 'db')!.billing!.planId).toBe('dynamodb-on-demand');
    expect(node(a, 'aws-db-out')!.facts).toEqual(['db-out-internet']);
    // Cloudflare Paid の既定のメールは Cloudflare なので AWS のアカウントが増え、Free は SES で既にある
    expect(accountsOf(base)).not.toContain('aws');
    expect(accountsOf(a)).toContain('aws');
    expect(accountsOf(composeStack('cloudflare-vinext-free'))).toContain('aws');
  });

  it('応答の転送は問い合わせの数 × 応答の大きさ（Hyperdrive 経由の Supabase の egress と同じ量）', () => {
    const w = resolveWorkload(articleCommunity(300_000));
    const supa = simulateResources(
      w,
      composeStack('cloudflare-vinext-paid', { db: 'hyperdrive' }),
    ).nodes.supabase!.resources['egress-gb']!;
    expect(supa).toBeGreaterThan(0);
    for (const db of ['dynamodb', 'aurora', 'rds']) {
      const u = simulateResources(
        w,
        composeStack('cloudflare-vinext-paid', { db }),
      ).nodes['aws-db-out']!;
      expect(u.resources['egress-gb']).toBeCloseTo(supa, 9);
    }
  });

  it('構成の名前は「+ vinext」の後ろに中継と DB（Astro・SPA は vinext を外す）', () => {
    const name = (id: string, db: string, framework?: 'astro' | 'vite-spa') =>
      composeStack(id, { db }, framework ? { framework } : {}).name;
    expect(name('cloudflare-vinext-paid', 'neon')).toBe(
      'Cloudflare Paid + vinext + Hyperdrive + Neon（Launch）',
    );
    expect(name('cloudflare-vinext-free', 'neon')).toBe(
      'Cloudflare Free + vinext + Hyperdrive + Neon（Free）',
    );
    expect(name('cloudflare-vinext-paid', 'dynamodb')).toBe(
      'Cloudflare Paid + vinext + AWS DynamoDB',
    );
    expect(name('cloudflare-vinext-paid', 'rds', 'astro')).toBe(
      'Cloudflare Paid + Hyperdrive + AWS RDS for PostgreSQL（Astro）',
    );
    expect(name('cloudflare-vinext-paid', 'aurora', 'vite-spa')).toBe(
      'Cloudflare Paid + Hyperdrive + AWS Aurora Serverless v2（Vite の SPA）',
    );
    // 既存の Hyperdrive 経由の Supabase と D1 の名前は変えない
    expect(name('cloudflare-vinext-paid', 'hyperdrive')).toBe(
      'Cloudflare Paid + vinext',
    );
    expect(name('cloudflare-vinext-paid', 'd1')).toBe(
      'Cloudflare Paid + vinext',
    );
  });

  it('既存の「Hyperdrive 経由で Supabase」は中継の事実を添えない（ノードは同じ組み立て）', () => {
    const a = composeStack('cloudflare-vinext-paid', { db: 'hyperdrive' });
    expect(node(a, 'hyperdrive')!.facts).toBeUndefined();
    expect(node(a, 'supabase')!.billing!.planId).toBe('pro-micro');
    expect(node(a, 'db')).toBeUndefined();
  });

  it('差し替えの途中: 移す先の DB（と中継）を経路に載せずに足し、D1 へ戻すときは土台の組み立てが D1 を足す', () => {
    const to = composeStack(
      'cloudflare-vinext-paid',
      {},
      { standby: { db: 'aurora' } },
    );
    expect(Object.values(to.routes).flat()).not.toContain('d1-next');
    expect(node(to, 'd1-next')!.billing!.planId).toBe(
      'aurora-serverless-v2-io',
    );
    expect(node(to, 'hyperdrive')).toBeDefined();
    expect(Object.values(to.routes).flat()).not.toContain('hyperdrive');
    expect(node(to, 'aws-db-out')).toBeUndefined();
    const back = composeStack(
      'cloudflare-vinext-paid',
      { db: 'neon' },
      { standby: { db: 'd1' } },
    );
    expect(node(back, 'db')!.billing!.provider).toBe('neon');
    expect(node(back, 'd1')!.billing!.planId).toBe('workers-paid');
    expect(node(back, 'db-next')).toBeUndefined();
    expect(Object.values(back.routes).flat()).not.toContain('d1');
    // Hyperdrive 経由の Supabase から Neon へ: 中継は 1 つ（同じ Hyperdrive）
    const swap = composeStack(
      'cloudflare-vinext-paid',
      { db: 'hyperdrive' },
      { standby: { db: 'neon' } },
    );
    expect(swap.nodes.filter((n) => n.id === 'hyperdrive')).toHaveLength(1);
    expect(node(swap, 'supabase-next')!.billing!.provider).toBe('neon');
  });

  it('画像を D1 に置くと、D1 は画像だけを持ち、DB は部品', () => {
    const a = composeStack('cloudflare-vinext-paid', {
      images: 'd1',
      db: 'neon',
    });
    expect(node(a, 'd1')!.config).toMatchObject({
      storesImages: true,
      storesDb: false,
    });
    expect(node(a, 'db')!.billing!.provider).toBe('neon');
  });

  it('API を他の事業者に置くと、DB・中継・応答の転送は外れ、API の列は 1 回だけ', () => {
    for (const api of ['aws-lambda', 'sakura-vps-2gb'])
      for (const db of ['aurora', 'neon', 'dynamodb']) {
        const a = composeStack(
          'cloudflare-vinext-paid',
          { db, api },
          { framework: 'vite-spa' },
        );
        const ids = Object.values(a.routes).flat();
        for (const x of ['db', 'hyperdrive', 'aws-db-out'])
          expect(ids, `${api} ${db} ${x}`).not.toContain(x);
        const plain = composeStack(
          'cloudflare-vinext-paid',
          { api },
          { framework: 'vite-spa' },
        );
        expect(a.routes).toEqual(plain.routes);
      }
  });

  it('DB のバックアップは部品の DB の既定・PITR になる', () => {
    const pitr = composeStack('cloudflare-vinext-paid', {
      db: 'rds',
      dbBackup: 'pitr',
    });
    expect(
      pitr.nodes.find((n) => n.config.kind === 'db-backup')!.billing,
    ).toMatchObject({ provider: 'aws', planId: 'rds-postgres-t4g-micro' });
  });

  it('部品の説明は土台によらない文に、土台ごとのつなぎ方（規則の partNote）を足す', () => {
    const on = (host: Platform, id: string) =>
      componentsOf(host, 'db').find((c) => c.id === id)!;
    expect(on('cloudflare', 'neon').note).toContain('Hyperdrive');
    expect(on('cloudflare', 'neon').note).not.toContain('serverless driver');
    expect(on('vercel', 'neon').note).toContain('serverless driver');
    expect(on('vercel', 'dynamodb').note).toContain('OIDC');
    expect(on('cloudflare', 'dynamodb').note).not.toContain('OIDC');
    expect(on('cloudflare', 'aurora').premiseRefs).toContain(
      'fact:aws:data-transfer-out:db-out-internet',
    );
    expect(on('vercel', 'aurora').premiseRefs).toContain(
      'fact:aws:data-transfer-out:aurora-out',
    );
    // 公開の RDS は Vercel の Marketplace に無いので、Vercel には出さない（規則の to.parts）
    expect(componentsOf('vercel', 'db').map((c) => c.id)).not.toContain('rds');
  });
});
