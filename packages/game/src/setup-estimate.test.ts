// 始める画面の 1 か月目の費用の見込み（D-72）。全組み合わせとの一致は combo-sweep.test.ts。
import { describe, expect, it } from 'vitest';
import { ARTICLE_COMMUNITY, setupMonthOneEstimate } from './index.ts';

const CF_PAID = 1;
const sc = ARTICLE_COMMUNITY;

describe('1 か月目の費用の見込み（D-72）', () => {
  it('CF Paid × Next.js × 既定の部品では尽きない', () => {
    const e = setupMonthOneEstimate(sc, CF_PAID, 'nextjs', {});
    expect(e.startCash).toBe(sc.startCash);
    expect(e.costUsd).toBeGreaterThan(0);
    expect(e.revenueUsd).toBeGreaterThan(0);
    expect(e.short).toBe(false);
  });

  it('主な費用は金額の大きい順で 3 件まで', () => {
    const e = setupMonthOneEstimate(sc, CF_PAID, 'nextjs', {});
    expect(e.topLines.length).toBeLessThanOrEqual(3);
    const v = e.topLines.map((l) => l.usd);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(v.every((x) => x > 0)).toBe(true);
  });
});

describe('1 か月目に当たる上限と、当たるルート（D-99）', () => {
  const CF_FREE = 0;
  const cpu = (fw: 'astro' | 'nextjs') =>
    setupMonthOneEstimate(sc, CF_FREE, fw, {}).blocking.find((b) =>
      b.id.startsWith('limit:cloudflare:workers-free:cpu-ms-per-request'),
    );

  it('Astro × CF Free: 個人向けのページ（SSR）だけが当たり、記事のページは静的で Worker を通らない', () => {
    expect(cpu('astro')?.detail).toBe(
      '個人向けのページ（SSR・CPU 15 ms）が Workers Free の 1 リクエスト 10 ms を超える。記事のページは静的なので Worker を起動しない',
    );
  });

  it('Next.js × CF Free: 記事のページ（ISR の再生成）も当たり、静的なページの添え書きは無い', () => {
    const d = cpu('nextjs')?.detail ?? '';
    expect(d).toContain('記事のページ（ISR の閲覧と再生成・CPU 17 ms）');
    expect(d).toContain('個人向けのページ（SSR・CPU 15 ms）');
    expect(d).not.toContain('静的なので');
  });
});
