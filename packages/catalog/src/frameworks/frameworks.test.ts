// フレームワークの分岐（prd/10）。構成の形・経路・当たる前提を確かめる（金額の golden は持たない）。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate } from 'estimator';
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
