// フレームワークの分岐（prd/10）。構成の形・経路・当たる前提を確かめる（金額の golden は持たない）。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate, resolveWorkload } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { ARTICLE_COMMUNITY_SPA, articleCommunity } from '../templates/index.ts';
import {
  componentsOf,
  composeStack,
  MVP_STACKS,
  STACK_DEFS,
} from '../stacks/index.ts';
import { DEPLOY_TARGETS, FRAMEWORKS, deployTarget, toSpa } from './index.ts';

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
