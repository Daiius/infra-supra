// フレームワークの分岐（prd/10）。構成の形・経路・当たる前提を確かめる（金額の golden は持たない）。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate, resolveWorkload } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import {
  ARTICLE_COMMUNITY_ASTRO,
  ARTICLE_COMMUNITY_SPA,
  BUSINESS_APP_ASTRO,
  articleCommunity,
  businessApp,
} from '../templates/index.ts';
import {
  componentsOf,
  composeStack,
  MVP_STACKS,
  STACK_DEFS,
} from '../stacks/index.ts';
import {
  DEPLOY_TARGETS,
  FRAMEWORKS,
  deployTarget,
  frameworkSupported,
  toAstro,
  toNextExport,
  toSpa,
} from './index.ts';

const books = loadPriceBooks();

describe('フレームワークと載せ方の表', () => {
  it('どのフレームワークも 3 事業者に載せ方がある', () => {
    for (const f of Object.keys(FRAMEWORKS) as (keyof typeof FRAMEWORKS)[])
      for (const p of ['cloudflare', 'vercel', 'sakura'] as const)
        expect(deployTarget(f, p)?.support).toBe('native');
    expect(DEPLOY_TARGETS.every((d) => d.sources.length > 0)).toBe(true);
  });
});

describe('Vite の SPA の構成', () => {
  it('Next.js（既定）の構成は変わらない', () => {
    STACK_DEFS.forEach((d, i) =>
      expect(composeStack(d, {}, { framework: 'nextjs' })).toStrictEqual(
        MVP_STACKS[i],
      ),
    );
  });

  it('SPA の構成はスキーマを満たし、ISR・SSR の経路と ISR のキャッシュを持たない', () => {
    for (const d of STACK_DEFS) {
      const a = composeStack(d, {}, { framework: 'vite-spa' });
      expect(() => ArchitectureSchema.parse(a)).not.toThrow();
      expect(a.routes['document-ssr']).toBeUndefined();
      expect(a.routes['document-isr']).toBeUndefined();
      expect(a.nodes.some((n) => n.id === 'kv' || n.id === 'isr')).toBe(false);
    }
  });

  it('ISR のキャッシュの部品は SPA では選べず、OGP の前処理は SPA だけ', () => {
    expect(componentsOf('cloudflare', 'isrCache', 'vite-spa')).toEqual([]);
    expect(componentsOf('cloudflare', 'ogp', 'nextjs')).toEqual([]);
    expect(
      componentsOf('cloudflare', 'ogp', 'vite-spa').map((c) => c.id),
    ).toEqual(['none', 'prerender']);
    // さくらの VPS の前段の CDN の「HTML も」は SPA ではシェルをキャッシュする（D-91）
    expect(
      componentsOf('sakura', 'frontCdn', 'vite-spa').map((c) => c.id),
    ).toContain('html');
  });

  it('Cloudflare: シェルは静的アセット（Worker を起動しない）。OGP の前処理を付けると Worker を通る', () => {
    const w = toSpa(articleCommunity(3_000_000), ARTICLE_COMMUNITY_SPA);
    const plain = composeStack(
      'cloudflare-vinext-paid',
      {},
      { framework: 'vite-spa' },
    );
    const pre = composeStack(
      'cloudflare-vinext-paid',
      { ogp: 'prerender' },
      { framework: 'vite-spa' },
    );
    expect(plain.routes['document-static']).toEqual(['assets']);
    expect(pre.routes['document-static']).toEqual(['worker']);
    const req = (a: typeof plain) =>
      estimate({ workload: w, architecture: a, books }).usage.find(
        (u) => u.nodeId === 'worker' && u.meterId === 'requests',
      )?.quantity ?? 0;
    // 前処理は入口（PV ÷ 2）の分だけ Worker の起動が増える
    expect(req(pre) - req(plain)).toBeCloseTo(1_500_000, -3);
    const facts = estimate({ workload: w, architecture: pre, books })
      .premises.map((p) => p.id)
      .filter((id) => id.startsWith('fact:'));
    expect(facts).toContain('fact:cloudflare:workers-paid:run-worker-first');
  });

  it('Cloudflare Free: SPA の API の重さの仮定しだいで 1 リクエスト CPU 10 ms に当たる（prd/10 B-5）', () => {
    const cpuHit = (factor: number) =>
      estimate({
        workload: toSpa(articleCommunity(300_000), {
          ...ARTICLE_COMMUNITY_SPA,
          dataCpuFactor: factor,
        }),
        architecture: composeStack(
          'cloudflare-vinext-free',
          {},
          { framework: 'vite-spa' },
        ),
        books,
      }).premises.some(
        (p) =>
          p.id.startsWith('limit:cloudflare:workers-free:cpu-ms-per-request') &&
          p.hit,
      );
    expect(cpuHit(ARTICLE_COMMUNITY_SPA.dataCpuFactor)).toBe(false);
    expect(cpuHit(1)).toBe(true);
  });

  it('Vercel: OGP の前処理を付けるとシェルが CDN から返らず関数に届く', () => {
    const w = toSpa(articleCommunity(1_000_000), ARTICLE_COMMUNITY_SPA);
    const inv = (choices: { ogp?: string }) =>
      estimate({
        workload: w,
        architecture: composeStack('vercel-supabase-pro', choices, {
          framework: 'vite-spa',
        }),
        books,
      }).usage.find((u) => u.nodeId === 'fn' && u.meterId === 'invocations')
        ?.quantity ?? 0;
    expect(inv({ ogp: 'prerender' }) - inv({})).toBeCloseTo(500_000, -3);
  });
});

describe('SPA の API の応答のキャッシュ（D-37）', () => {
  // 記事コミュニティ 30 万 PV。キャッシュの期間は ISR の間隔（1 時間にする）をそのまま使う
  const app = articleCommunity(300_000);
  app.routes = app.routes.map((r) =>
    r.rendering === 'isr' ? { ...r, revalidateSeconds: 3600 } : r,
  );
  const plainW = toSpa(app, ARTICLE_COMMUNITY_SPA);
  const cachedW = toSpa(app, ARTICLE_COMMUNITY_SPA, { cacheContent: true });
  const sim = (
    stack: string,
    choices: Record<string, string>,
    cached: boolean,
  ) =>
    estimate({
      workload: cached ? cachedW : plainW,
      architecture: composeStack(stack, choices, { framework: 'vite-spa' }),
      books,
    }).simulation;
  const res = (s: ReturnType<typeof sim>, node: string, key: string): number =>
    (s.nodes[node]?.resources as Record<string, number>)[key] ?? 0;

  it('部品は SPA だけで、Next.js では選べない', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura'] as const) {
      expect(componentsOf(p, 'apiCache', 'nextjs')).toEqual([]);
      expect(componentsOf(p, 'apiCache', 'vite-spa')[0]?.id).toBe('none');
    }
    expect(
      componentsOf('cloudflare', 'apiCache', 'vite-spa').map((c) => c.id),
    ).toEqual(['none', 'cdn', 'cache-api']);
  });

  it('対象は記事の中身だけ（個人化された中身ともともとの API は毎回届く）', () => {
    const hit = resolveWorkload(cachedW).cacheHitRate['api-content']!;
    // 記事 2,000 ページ・閲覧 18 万/月・1 時間 → λT ≈ 0.123
    const lambdaT = (180_000 / 2_000) * (3600 / (730 * 3600));
    expect(hit).toBeCloseTo(lambdaT / (1 + lambdaT), 9);
    expect(resolveWorkload(cachedW).classes.api.count).toBeCloseTo(
      300_000 + 120_000,
    );
  });

  it('Vercel: CDN のキャッシュで関数の起動と Fast Origin Transfer が減り、CDN Requests は変わらない', () => {
    const off = sim('vercel-supabase-pro', {}, false);
    const on = sim('vercel-supabase-pro', { apiCache: 'cdn' }, true);
    const hits =
      180_000 * resolveWorkload(cachedW).cacheHitRate['api-content']!;
    expect(
      res(off, 'fn', 'invocations') - res(on, 'fn', 'invocations'),
    ).toBeCloseTo(hits, 3);
    expect(res(on, 'cdn', 'origin-transfer-gb')).toBeLessThan(
      res(off, 'cdn', 'origin-transfer-gb'),
    );
    expect(res(on, 'cdn', 'requests')).toBeCloseTo(
      res(off, 'cdn', 'requests'),
      6,
    );
  });

  it('Cloudflare: Cache API では Worker のリクエストは減らず、CPU と D1 の読み取りが減る', () => {
    const off = sim('cloudflare-vinext-paid', {}, false);
    const on = sim('cloudflare-vinext-paid', { apiCache: 'cache-api' }, true);
    expect(res(on, 'worker', 'requests')).toBeCloseTo(
      res(off, 'worker', 'requests'),
      6,
    );
    expect(res(on, 'worker', 'cpu-ms')).toBeLessThan(
      res(off, 'worker', 'cpu-ms'),
    );
    expect(res(on, 'd1', 'rows-read')).toBeLessThan(
      res(off, 'd1', 'rows-read'),
    );
  });

  it('Cloudflare: Workers Cache ではヒットに CPU がかからず、静的アセットへのリクエストも課金される', () => {
    const api = sim('cloudflare-vinext-paid', { apiCache: 'cache-api' }, true);
    const front = sim('cloudflare-vinext-paid', { apiCache: 'cdn' }, true);
    expect(res(front, 'worker', 'cpu-ms')).toBeLessThan(
      res(api, 'worker', 'cpu-ms'),
    );
    expect(res(front, 'd1', 'rows-read')).toBeCloseTo(
      res(api, 'd1', 'rows-read'),
      6,
    );
    expect(res(front, 'worker', 'requests')).toBeCloseTo(
      res(api, 'worker', 'requests'),
      6,
    );
    const assets = composeStack(
      'cloudflare-vinext-paid',
      { apiCache: 'cdn' },
      { framework: 'vite-spa' },
    ).nodes.find((n) => n.id === 'assets');
    expect(assets?.billing?.meters).toEqual({ requests: 'requests' });
    expect(res(front, 'assets', 'requests')).toBeGreaterThan(0);
  });

  it('VPS: 前段の CDN + キャッシュで VPS の CPU が減る。前段の CDN が無いと効かない', () => {
    const cores = (s: ReturnType<typeof sim>) => s.nodes.vps!.host!.peakCores;
    const off = sim('sakura-vps-2gb', { frontCdn: 'static' }, false);
    const on = sim(
      'sakura-vps-2gb',
      { frontCdn: 'static', apiCache: 'cdn' },
      true,
    );
    expect(cores(on)).toBeLessThan(cores(off));
    const noCdn = sim('sakura-vps-2gb', { apiCache: 'cdn' }, true);
    const noCdnPlain = sim('sakura-vps-2gb', {}, false);
    expect(cores(noCdn)).toBeCloseTo(cores(noCdnPlain), 9);
  });
});

describe('Astro（D-68・D-103: 記事は閲覧のときに描いてキャッシュし、投稿・編集で消す）', () => {
  const pv = 300_000;
  // 内容の更新（ゲームの記事コミュニティと同じ数え方: PV × API × 書き込み × 記事の投稿・編集 0.01 = 月 300 回。D-70）
  const updates = pv * 0.1 * 0.01;
  /** オンデマンド（投稿・編集で消す）の記事のルート。 */
  const w = () => {
    const a = toAstro(articleCommunity(pv), ARTICLE_COMMUNITY_ASTRO);
    return {
      ...a,
      routes: a.routes.map((r) => {
        if (r.rendering !== 'isr') return r;
        const { revalidateSeconds: _, ...rest } = r;
        return {
          ...rest,
          onDemandUpdatesPerMonth: updates,
          onDemandMaxAgeSeconds: 86_400,
          onDemandPagesPerUpdate: 2,
        };
      }),
    };
  };
  const est = (id: string) =>
    estimate({
      workload: w(),
      architecture: composeStack(id, {}, { framework: 'astro' }),
      books,
    });

  it('載せ方: Cloudflare・Vercel・VPS はアダプターで載り、AWS は公式のアダプターが無いので載せない', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura'] as const)
      expect(frameworkSupported('astro', p)).toBe(true);
    for (const p of ['aws', 'aws-opennext'] as const) {
      expect(deployTarget('astro', p)?.support).toBe('unsupported');
      expect(frameworkSupported('astro', p)).toBe(false);
    }
    expect(frameworkSupported('nextjs', 'aws')).toBe(true);
  });

  it('記事のキャッシュの置き場: 投稿・編集で消せるのは Cloudflare・Vercel・VPS・Netlify。Google Cloud の Hosting の CDN は消せない。出典は Astro の route caching ほか', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura', 'netlify'] as const)
      expect(deployTarget('astro', p)?.pageCache?.onDemand).toBe(true);
    expect(deployTarget('astro', 'gcp')?.pageCache?.onDemand).toBe(false);
    for (const p of ['cloudflare', 'sakura', 'netlify'] as const)
      expect(deployTarget('astro', p)?.sources.map((x) => x.url)).toContain(
        'https://docs.astro.build/en/guides/caching/',
      );
    expect(
      deployTarget('astro', 'vercel')?.sources.map((x) => x.url),
    ).toContain('https://vercel.com/docs/incremental-static-regeneration');
    expect(FRAMEWORKS.astro.renderingModes).toContain('isr');
  });

  it('記事（ISR）はそのまま（新しい種類は足さない・RS-05）、個人化（SSR）もそのまま。JS・CSS はアイランドの分だけ。記事のためのビルドは無い', () => {
    const a = toAstro(articleCommunity(pv), ARTICLE_COMMUNITY_ASTRO);
    expect(a.routes.map((r) => r.rendering)).toEqual(['isr', 'ssr']);
    expect(a.perPage.assets).toBeCloseTo(10 * 0.3, 12);
    expect(a.build).toBeUndefined();
    const b = toAstro(businessApp(100_000), BUSINESS_APP_ASTRO);
    expect(b.build).toBeUndefined();
  });

  it('構成: どの事業者も記事の ISR の経路（閲覧・描き直し）を持ち、ビルドのノードは無い', () => {
    for (const d of STACK_DEFS) {
      if (!frameworkSupported('astro', d.platform)) continue;
      const a = composeStack(d, {}, { framework: 'astro' });
      expect(() => ArchitectureSchema.parse(a)).not.toThrow();
      expect(a.routes['document-isr']).toBeDefined();
      expect(a.routes['isr-revalidate']).toBeDefined();
      expect(a.routes['document-ssr']).toBeDefined();
      expect(a.nodes.some((n) => n.id === 'build')).toBe(false);
      // KV の ISR のキャッシュ（vinext）は使わない
      expect(a.nodes.some((n) => n.id === 'kv')).toBe(false);
      expect(a.name).toContain('（Astro）');
      expect(a.name).not.toContain('vinext');
    }
    // Next.js で選んでいた「キャッシュしない」も Astro には効かない（置き場は事業者で決まる）
    const none = composeStack(
      'vercel-supabase-pro',
      { isrCache: 'none' },
      { framework: 'astro' },
    );
    expect(none.nodes.some((n) => n.id === 'isr')).toBe(true);
  });

  it('Cloudflare: 記事は Worker の前の Workers Cache。ヒットは CPU 0、すべての閲覧と静的アセットを Workers のリクエストで数え、消した後の閲覧は描画の全部を待つ', () => {
    const a = composeStack(
      'cloudflare-vinext-paid',
      {},
      { framework: 'astro' },
    );
    const worker = a.nodes.find((n) => n.id === 'worker')!;
    expect(worker.config).toMatchObject({
      kind: 'function',
      backgroundClasses: ['isr-revalidate'],
      cache: { classes: ['document-isr'], hitCpuMs: 0 },
    });
    expect(worker.facts).toEqual(
      expect.arrayContaining([
        'astro-route-cache',
        'workers-cache-front',
        'workers-cache-purge',
      ]),
    );
    expect(worker.facts).not.toContain('workers-cache');
    expect(a.routes['document-isr']).toEqual(['worker']);
    const assets = a.nodes.find((n) => n.id === 'assets')!;
    expect(assets.billing?.meters).toEqual({ requests: 'requests' });

    const e = est('cloudflare-vinext-paid');
    const u = (node: string, meter: string) =>
      e.usage.find((x) => x.nodeId === node && x.meterId === meter)?.quantity ??
      0;
    const cls = e.simulation.workload.classes;
    // Worker のリクエスト = 記事の閲覧（ヒットも）+ マイページ + API（描き直しは同じリクエストの中）
    expect(u('worker', 'requests')).toBeCloseTo(
      cls['document-isr'].count +
        cls['document-ssr'].count +
        cls.api.count +
        (cls['image-write']?.count ?? 0),
      3,
    );
    expect(u('assets', 'requests')).toBeGreaterThan(0);
    // 1 リクエストの CPU の最大は、消した後の閲覧（キャッシュから返す CPU + 描画）。Free の 10 ms を超える
    const free = est('cloudflare-vinext-free');
    expect(
      free.premises.some(
        (p) =>
          p.id.startsWith('limit:cloudflare:workers-free:cpu-ms-per-request') &&
          p.hit,
      ),
    ).toBe(true);
    expect(
      free.simulation.nodes.worker!.cpuSources.some(
        (s) => s.requestClass === 'isr-revalidate' && s.cpuMs >= 15,
      ),
    ).toBe(true);
  });

  it('Vercel: @astrojs/vercel の isr で Next.js と同じ CDN と ISR の永続ストレージを通る', () => {
    const a = composeStack('vercel-supabase-pro', {}, { framework: 'astro' });
    expect(a.routes['document-isr']).toEqual(['cdn', 'isr']);
    expect(a.routes['isr-revalidate']).toEqual(['fn', 'isr', 'db']);
    expect(a.nodes.find((n) => n.id === 'fn')?.facts).toContain('astro-isr');
    const e = est('vercel-supabase-pro');
    expect(e.usage.some((x) => x.meterId === 'isr-writes')).toBe(true);
  });

  it('VPS: Node のメモリにキャッシュ（前段の Cloudflare で HTML もキャッシュできる）。Google Cloud: Hosting の CDN（s-maxage）', () => {
    const vps = composeStack('sakura-vps-2gb', {}, { framework: 'astro' });
    expect(vps.routes['document-isr']).toEqual(['vps']);
    expect(vps.nodes.find((n) => n.id === 'vps')?.facts).toContain(
      'astro-memory-cache',
    );
    const front = composeStack(
      'sakura-vps-2gb',
      { frontCdn: 'html' },
      { framework: 'astro' },
    );
    const cf = front.nodes.find((n) => n.id === 'cf-cdn')!;
    expect(cf.config.kind === 'cdn' && cf.config.ttlClasses).toEqual([
      'document-isr',
    ]);
    const gcp = composeStack('gcp-cloud-run', {}, { framework: 'astro' });
    const cdn = gcp.nodes.find((n) => n.id === 'cdn')!;
    expect(cdn.config.kind === 'cdn' && cdn.config.ttlClasses).toEqual([
      'document-isr',
    ]);
    expect(gcp.nodes.find((n) => n.id === 'run')?.facts).not.toContain(
      'next-local-cache',
    );
  });
});

describe('Next.js の静的書き出し（D-80）', () => {
  const pv = 300_000;
  const updates = pv * 0.1 * 0.01;
  const w = () =>
    toNextExport(
      articleCommunity(pv),
      ARTICLE_COMMUNITY_SPA,
      ARTICLE_COMMUNITY_ASTRO.minutesPerBuild,
      { updatesPerMonth: updates, intervalSeconds: 300 },
    );
  const est = (id: string, choices = {}) =>
    estimate({
      workload: w(),
      architecture: composeStack(id, choices, { framework: 'nextjs-export' }),
      books,
    });

  it('載せ方: 静的な配信のある事業者（Cloudflare・Vercel・VPS・S3 + CloudFront・Netlify）に載り、OpenNext は使わない。出典は公式の静的書き出しの文書', () => {
    for (const p of [
      'cloudflare',
      'vercel',
      'sakura',
      'aws',
      'netlify',
    ] as const) {
      expect(frameworkSupported('nextjs-export', p)).toBe(true);
      expect(
        deployTarget('nextjs-export', p)?.sources.map((x) => x.url),
      ).toContain('https://nextjs.org/docs/app/guides/static-exports');
    }
    expect(deployTarget('nextjs-export', 'aws-opennext')?.support).toBe(
      'unsupported',
    );
    expect(FRAMEWORKS['nextjs-export'].renderingModes).toEqual([
      'static',
      'spa',
    ]);
  });

  it('記事（ISR）は静的なページにしてビルドし直し、個人化（SSR）はブラウザが API で取る。JS・CSS は Next.js のまま', () => {
    const a = w();
    expect(a.routes.map((r) => r.rendering)).toEqual(['static', 'spa']);
    expect(a.perPage.assets).toBe(articleCommunity(pv).perPage.assets);
    expect(a.build).toEqual({
      updatesPerMonth: updates,
      intervalSeconds: 300,
      minutesPerBuild: 2,
    });
    // 業務アプリは静的なページが無いので、SPA と同じ形でビルドし直しが無い
    const b = toNextExport(
      businessApp(100_000),
      ARTICLE_COMMUNITY_SPA,
      ARTICLE_COMMUNITY_ASTRO.minutesPerBuild,
      { updatesPerMonth: 1000 },
    );
    expect(b.build).toBeUndefined();
    expect(b.routes.every((r) => r.rendering !== 'ssr')).toBe(true);
  });

  it('構成: SPA と同じ形（ISR・SSR の経路なし・API）で、Cloudflare・Vercel・Netlify はビルドのノードを持つ', () => {
    for (const d of STACK_DEFS) {
      if (!frameworkSupported('nextjs-export', d.platform)) continue;
      const a = composeStack(d, {}, { framework: 'nextjs-export' });
      expect(() => ArchitectureSchema.parse(a)).not.toThrow();
      expect(a.routes['document-isr']).toBeUndefined();
      expect(a.routes['document-ssr']).toBeUndefined();
      expect(a.routes.api).toBeDefined();
      expect(a.nodes.some((n) => n.id === 'build')).toBe(
        ['cloudflare', 'vercel', 'netlify'].includes(d.platform),
      );
      expect(a.name).toContain('（Next.js の静的書き出し）');
      expect(a.name).not.toContain('vinext');
    }
  });

  it('Cloudflare: 記事もマイページの HTML も静的アセット（Worker を起動しない）。Worker はマイページの中身の API の分だけ増える', () => {
    const a = composeStack(
      'cloudflare-vinext-paid',
      {},
      { framework: 'nextjs-export' },
    );
    expect(a.routes['document-static']).toEqual(['assets']);
    const next = estimate({
      workload: articleCommunity(pv),
      architecture: composeStack('cloudflare-vinext-paid'),
      books,
    });
    const req = (e: typeof next) =>
      e.usage.find((u) => u.nodeId === 'worker' && u.meterId === 'requests')
        ?.quantity ?? 0;
    // Next.js の HTML（PV）が消え、マイページ（PV × 0.4）の中身の API が足される
    expect(req(next) - req(est('cloudflare-vinext-paid'))).toBeCloseTo(
      pv * 0.6,
      -1,
    );
  });

  it('画像: 既定のローダーが使えないので、Vercel の画像の最適化・VPS のホストでの変換は選べない（Cloudflare Images・Netlify Image CDN は URL のローダーで選べる）', () => {
    const ids = (p: Parameters<typeof componentsOf>[0]) =>
      componentsOf(p, 'images', 'nextjs-export').map((o) => o.id);
    expect(ids('vercel')).not.toContain('default');
    expect(ids('sakura')).not.toContain('default');
    expect(ids('vercel')).toEqual(
      expect.arrayContaining(['resize', 'none', 'cf-images', 'cf-resize']),
    );
    expect(ids('cloudflare')).toContain('images');
    expect(ids('netlify')).toContain('default');
    // Next.js・SPA・Astro では今までどおり選べる
    for (const f of ['nextjs', 'vite-spa', 'astro'] as const)
      expect(componentsOf('vercel', 'images', f).map((o) => o.id)).toContain(
        'default',
      );
  });

  it('API の置き場は SPA と同じ組（ブラウザから呼ぶ）。OGP の前処理・API の応答のキャッシュは出さない', () => {
    const api = (p: Parameters<typeof componentsOf>[0]) =>
      componentsOf(p, 'api', 'nextjs-export').map((o) => o.id);
    expect(api('vercel')).toEqual(['same', 'cf-workers']);
    expect(api('cloudflare')).toEqual([
      'same',
      'aws-lambda',
      'sakura-vps-2gb',
      'sakura-vps-4gb',
    ]);
    expect(componentsOf('cloudflare', 'ogp', 'nextjs-export')).toEqual([]);
    expect(componentsOf('cloudflare', 'apiCache', 'nextjs-export')).toEqual([]);
    const a = composeStack(
      'vercel-supabase-pro',
      { api: 'cf-workers', images: 'resize' },
      { framework: 'nextjs-export' },
    );
    expect(a.routes.api).toEqual(['cf-worker', 'cf-d1']);
    expect(a.nodes.some((n) => n.id === 'db')).toBe(false);
  });

  it('Vercel Pro はビルドの CPU minute を数える（Astro と同じ）', () => {
    const e = est('vercel-supabase-pro', { images: 'resize' });
    expect(
      e.usage.find(
        (u) => u.nodeId === 'build' && u.meterId === 'build-cpu-minutes',
      )?.quantity,
    ).toBeGreaterThan(0);
  });
});
