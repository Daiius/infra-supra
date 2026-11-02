// ページごとの描き方の表（D-106・段 2。読むだけ）: 行の描き方が workloadFor の当てるものと食い違わないこと、代表の組の中身。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  frameworksOf,
  newGame,
  ON_DEMAND_REVALIDATE,
  routePlanOf,
  routePlanRows,
  SCENARIOS,
  STACKS,
  stackSupports,
  workloadFor,
  type FrameworkId,
} from './index.ts';

const stack = (id: string) => STACKS.find((s) => s.id === id)!.index;
const settings = (revalidateSec = 300, comments = COMMENTS_IN_BROWSER) => ({
  revalidateSec,
  comments,
});
const rows = (
  fw: FrameworkId,
  stackId: string,
  s = settings(),
  components = {},
) =>
  routePlanRows(ARTICLE_COMMUNITY, {
    framework: fw,
    stackIndex: stack(stackId),
    settings: s,
    components,
  });
const strategies = (r: ReturnType<typeof rows>) =>
  Object.fromEntries(r.map((x) => [x.route, x.strategy]));

/** 描き方 → workloadFor が出すルートの描き方（Workload の rendering）。 */
const RENDERING = {
  'static-build': 'static',
  'cached-ttl': 'isr',
  'cached-purge': 'isr',
  ssr: 'ssr',
  'shell-api': 'spa',
} as const;

describe('ページごとの描き方の表（D-106）', () => {
  it('行の描き方は、workloadFor が当てた Workload のルートと一致する（全シナリオ × フレームワーク × 構成 × 主な設定・部品）', () => {
    let n = 0;
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed)
        for (const s of STACKS) {
          if (!stackSupports(s.index, fw)) continue;
          for (const revalidateSec of [ON_DEMAND_REVALIDATE, 300])
            for (const components of [{}, { isrCache: 'none' }]) {
              const st = { revalidateSec, comments: COMMENTS_IN_BROWSER };
              const plan = routePlanRows(sc, {
                framework: fw,
                stackIndex: s.index,
                settings: st,
                components,
              });
              const w = workloadFor(sc, {
                pv: 100_000,
                settings: {
                  ...st,
                  imageKB: 150,
                  variants: 3,
                  ssrOptimizations: 0,
                },
                ssrCpuMs: 15,
                mods: {},
                stock: null,
                platform: s.provider,
                components,
                framework: fw,
              });
              for (const row of plan) {
                const r = w.routes.find((x) => x.id === row.route)!;
                const key = `${sc.id} × ${fw} × ${s.id} × ${row.route}`;
                expect(r.rendering, key).toBe(
                  RENDERING[row.strategy as keyof typeof RENDERING],
                );
                // 期限かオンデマンドか（S2 / S3）は、ルートの値と一致する
                if (row.strategy === 'cached-purge')
                  expect(r, key).toHaveProperty('onDemandUpdatesPerMonth');
                if (row.strategy === 'cached-ttl')
                  expect(r, key).toHaveProperty('revalidateSeconds');
                n++;
              }
            }
        }
    expect(n).toBeGreaterThan(200);
  });

  it('記事コミュニティ × Astro × Cloudflare: 記事は S3（投稿で消す）・個人向けは S4。使い回す描き方は個人向けで灰色', () => {
    const r = rows('astro', 'cloudflare-vinext-free', settings(0));
    expect(strategies(r)).toEqual({ article: 'cached-purge', personal: 'ssr' });
    const personal = r.find((x) => x.route === 'personal')!;
    const s3 = personal.alternatives.find(
      (a) => a.strategy === 'cached-purge',
    )!;
    expect(s3.available).toBe(false);
    expect(s3.reason).toContain('他の人に見え');
    expect(
      personal.alternatives.find((a) => a.strategy === 'shell-api')!.available,
    ).toBe(true);
    // 確かめていない S6 は出さない（RS-04）
    expect(
      personal.alternatives.some((a) => a.strategy === 'server-island'),
    ).toBe(false);
  });

  it('Astro × Google Cloud: 記事は S2（期限）で、S3 は Hosting の CDN で消せない理由つきの灰色', () => {
    const r = rows('astro', 'gcp-cloud-run', settings(300));
    const article = r.find((x) => x.route === 'article')!;
    expect(article.strategy).toBe('cached-ttl');
    expect(article.detail).toContain('期限 5 分');
    const s3 = article.alternatives.find((a) => a.strategy === 'cached-purge')!;
    expect(s3.available).toBe(false);
    expect(s3.reason).toContain('Hosting');
  });

  it('Next.js × Cloudflare（KV）: 記事は S2、S3 は今の部品（KV）で使えない。R2 なら使える', () => {
    const kv = rows('nextjs', 'cloudflare-vinext-paid');
    const a = kv.find((x) => x.route === 'article')!;
    expect(a.strategy).toBe('cached-ttl');
    const s3 = a.alternatives.find((x) => x.strategy === 'cached-purge')!;
    expect(s3.available).toBe(false);
    expect(s3.reason).toContain('KV');
    // vinext の S1 は README を出典に出す（開発中の注つき。RS-15 の解除）
    const s1 = a.alternatives.find((x) => x.strategy === 'static-build')!;
    expect(s1.available).toBe(true);
    expect(s1.basis).toBe('source');
    expect(s1.reason).toContain('vinext は開発中（README）');
    const r2 = rows('nextjs', 'cloudflare-vinext-paid', settings(), {
      isrCache: 'r2',
    });
    expect(
      r2[0]!.alternatives.find((x) => x.strategy === 'cached-purge')!.available,
    ).toBe(true);
  });

  it('Next.js で ISR のキャッシュの部品が「キャッシュしない」なら、記事は S4 で理由を添える', () => {
    const r = rows('nextjs', 'vercel-supabase-pro', settings(), {
      isrCache: 'none',
    });
    expect(r[0]!.strategy).toBe('ssr');
    expect(r[0]!.overriddenBy).toContain('キャッシュしない');
  });

  it('静的書き出しは S1/S5、SPA は S5/S5（API の応答のキャッシュの期間を添える）', () => {
    expect(strategies(rows('nextjs-export', 'vercel-supabase-pro'))).toEqual({
      article: 'static-build',
      personal: 'shell-api',
    });
    const spa = rows('vite-spa', 'cloudflare-vinext-paid', settings(3600), {
      apiCache: 'cache-api',
    });
    expect(strategies(spa)).toEqual({
      article: 'shell-api',
      personal: 'shell-api',
    });
    expect(spa[0]!.detail.join()).toContain('期間 1 時間');
    expect(spa[1]!.detail.join()).not.toContain('期間');
  });

  it('コメントの描き方を記事の行に出す（D-82）', () => {
    const r = rows(
      'nextjs',
      'vercel-supabase-pro',
      settings(300, COMMENTS_IN_PAGE),
    );
    expect(r[0]!.detail.join()).toContain('HTML に含める');
    expect(r[1]!.detail.join()).not.toContain('コメント');
  });

  it('受託の業務アプリは業務の画面 1 行（人ごとに違う）', () => {
    const sc = Object.values(SCENARIOS).find((x) => x !== ARTICLE_COMMUNITY)!;
    const r = routePlanRows(sc, {
      framework: 'nextjs',
      stackIndex: stack('vercel-supabase-pro'),
      settings: settings(),
      components: {},
    });
    expect(r.map((x) => [x.route, x.audience, x.strategy])).toEqual([
      ['app', 'personal', 'ssr'],
    ]);
  });

  it('ゲームの状態から引ける（routePlanOf）', () => {
    const s = newGame(
      stack('cloudflare-vinext-paid'),
      1,
      ARTICLE_COMMUNITY,
      undefined,
      'astro',
    );
    expect(strategies(routePlanOf(s))).toEqual({
      article: 'cached-purge',
      personal: 'ssr',
    });
  });
});
