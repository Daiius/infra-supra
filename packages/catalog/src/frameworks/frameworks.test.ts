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
    expect(
      componentsOf('sakura', 'frontCdn', 'vite-spa').map((c) => c.id),
    ).not.toContain('html');
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

describe('Astro（D-68）', () => {
  const pv = 300_000;
  // 内容の更新（ゲームの記事コミュニティと同じ数え方: PV × API × 書き込み × 記事の投稿・編集 0.01 = 月 300 回。D-70）
  const updates = pv * 0.1 * 0.01;
  const w = (intervalSeconds?: number) =>
    toAstro(articleCommunity(pv), ARTICLE_COMMUNITY_ASTRO, {
      updatesPerMonth: updates,
      ...(intervalSeconds ? { intervalSeconds } : {}),
    });
  const est = (id: string, intervalSeconds?: number) =>
    estimate({
      workload: w(intervalSeconds),
      architecture: composeStack(id, {}, { framework: 'astro' }),
      books,
    });
  const build = (e: ReturnType<typeof est>) =>
    e.usage.find((u) => u.nodeId === 'build');

  it('載せ方: Cloudflare・Vercel・VPS はアダプターで載り、AWS は公式のアダプターが無いので載せない', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura'] as const)
      expect(frameworkSupported('astro', p)).toBe(true);
    for (const p of ['aws', 'aws-opennext'] as const) {
      expect(deployTarget('astro', p)?.support).toBe('unsupported');
      expect(frameworkSupported('astro', p)).toBe(false);
    }
    expect(frameworkSupported('nextjs', 'aws')).toBe(true);
  });

  it('記事（ISR）は静的なページに、個人化（SSR）はそのまま。JS・CSS はアイランドの分だけ。ビルドは記事のページ数で長くなる', () => {
    const a = w(300);
    expect(a.routes.map((r) => r.rendering)).toEqual(['static', 'ssr']);
    expect(a.perPage.assets).toBeCloseTo(10 * 0.3, 12);
    expect(a.build).toEqual({
      updatesPerMonth: updates,
      intervalSeconds: 300,
      minutesPerBuild: 2,
    });
    // 業務アプリは静的なページが無いのでビルドし直しが無い
    const b = toAstro(businessApp(100_000), BUSINESS_APP_ASTRO, {
      updatesPerMonth: 1000,
    });
    expect(b.build).toBeUndefined();
  });

  it('構成: ISR の経路とキャッシュを持たず、Cloudflare・Vercel はビルドのノードを持つ（VPS は同じホストでビルド）', () => {
    for (const d of STACK_DEFS) {
      if (!frameworkSupported('astro', d.platform)) continue;
      const a = composeStack(d, {}, { framework: 'astro' });
      expect(() => ArchitectureSchema.parse(a)).not.toThrow();
      expect(a.routes['document-isr']).toBeUndefined();
      expect(a.routes['document-ssr']).toBeDefined();
      expect(a.nodes.some((n) => n.id === 'kv' || n.id === 'isr')).toBe(false);
      expect(a.nodes.some((n) => n.id === 'build')).toBe(
        d.platform !== 'sakura',
      );
      expect(a.name).toContain('（Astro）');
      expect(a.name).not.toContain('vinext');
    }
  });

  it('Cloudflare: 記事は静的アセット（Worker を起動しない）。Next.js より記事の閲覧の分（PV × 0.6）だけ Worker のリクエストが減る', () => {
    const astro = est('cloudflare-vinext-paid', 300);
    const next = estimate({
      workload: articleCommunity(pv),
      architecture: composeStack('cloudflare-vinext-paid'),
      books,
    });
    const req = (e: typeof astro) =>
      e.usage.find((u) => u.nodeId === 'worker' && u.meterId === 'requests')
        ?.quantity ?? 0;
    expect(req(next) - req(astro)).toBeCloseTo(pv * 0.6, -1);
  });

  it('ビルドの時間: Workers Paid は月 6,000 分まで込み・以降 $0.005、Free は 3,000 分を超えると上位のプランが要る', () => {
    // 更新のたび（1 回 2 分の枠）。1,000 万 PV で記事の更新は月 1 万回
    const big = (id: string, intervalSeconds?: number) =>
      estimate({
        workload: toAstro(
          articleCommunity(10_000_000),
          ARTICLE_COMMUNITY_ASTRO,
          {
            updatesPerMonth: 10_000_000 * 0.1 * 0.01,
            ...(intervalSeconds ? { intervalSeconds } : {}),
          },
        ),
        architecture: composeStack(id, {}, { framework: 'astro' }),
        books,
      });
    const paid = big('cloudflare-vinext-paid');
    const minutes = build(paid)!.quantity;
    const slots = (730 * 3600) / 120;
    expect(minutes).toBeCloseTo(slots * (1 - Math.exp(-10_000 / slots)) * 2, 6);
    const line = paid.bill.lines.find(
      (l) => l.priceRef.meterId === 'build-minutes',
    );
    expect(line?.amount).toBeCloseTo((minutes - 6000) * 0.005, 6);
    const hit = (e: ReturnType<typeof big>) =>
      e.premises.find(
        (x) => x.id === 'pool:cloudflare:workers-free:free-build-minutes',
      );
    expect(hit(big('cloudflare-vinext-free'))?.hit).toBe(true);
    expect(hit(big('cloudflare-vinext-free'))?.effect).toBe('upgrade-required');
    // 1 時間ごとにまとめると Free の 3,000 分に収まる（730 回 × 2 分）
    expect(hit(big('cloudflare-vinext-free', 3600))?.hit).toBe(false);
    // 30 万 PV・5 分ごと（記事の更新は月 300 回）なら Free にも収まる
    expect(hit(est('cloudflare-vinext-free', 300))?.hit).toBe(false);
  });

  it('Vercel Pro はビルドの分 × 4 vCPU の CPU minute を $0.0035 で数え、Hobby は込み', () => {
    const pro = est('vercel-supabase-pro', 3600);
    const u = pro.usage.find(
      (x) => x.nodeId === 'build' && x.meterId === 'build-cpu-minutes',
    )!;
    const minutes = pro.simulation.workload.builds.minutes;
    expect(u.quantity).toBeCloseTo(minutes * 4, 6);
    const hobby = est('vercel-supabase-hobby', 3600);
    expect(hobby.usage.some((x) => x.nodeId === 'build')).toBe(false);
  });
});
