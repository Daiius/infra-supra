// DB だけ Neon（従量の Postgres。D-77・prd/11 §15）: Vercel・Netlify の DB のスロットで Supabase の代わりに選べ、
// Neon のアカウントの手間がかかり、基本料の代わりに動いている時間の分だけ払う。基準プレイ（何もしない・シード 1〜20）。
import { describe, expect, it, vi } from 'vitest';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  componentFlavor,
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  stackName,
  STACKS,
  type FrameworkId,
} from './index.ts';
import type { Choices } from 'catalog';
import type { Scenario } from './scenario.ts';

// 基準プレイ（シード 1〜20 × 構成）を何本も回すので、CI の遅い実行環境では既定の 5 秒を超えうる
vi.setConfig({ testTimeout: 30_000 });

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VERCEL_PRO = idx('vercel-supabase-pro');
const NETLIFY_PRO = idx('netlify-supabase-pro');
const NETLIFY_PERSONAL = idx('netlify-supabase-personal');
const VERCEL_HOBBY = idx('vercel-supabase-hobby');
const CF_PAID = idx('cloudflare-vinext-paid');
const article = ARTICLE_COMMUNITY;
const contract = SCENARIOS['contract-operations']!;

/** 何もしない・シード 1〜20 の達成数と、12 か月の費用の平均（月）。 */
function run(
  sc: Scenario,
  stack: number,
  framework: FrameworkId,
  components: Choices = {},
) {
  let won = 0;
  let cost = 0;
  let months = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let s = playMonth(
      newGame(stack, seed, sc, DEFAULT_START_DATE, framework, components),
    );
    while (s.phase === 'playing') s = playMonth(s);
    if (s.phase === 'won') won++;
    cost += s.history.reduce((a, h) => a + h.infraCost, 0);
    months += s.history.length;
  }
  return { won, monthly: cost / months };
}

describe('DB だけ Neon', () => {
  it('始める画面（見積モードも同じ）: Vercel・Netlify の DB に Supabase と Neon が出る', () => {
    for (const stack of [VERCEL_PRO, NETLIFY_PRO])
      for (const fw of ['nextjs', 'vite-spa', 'astro'] as const) {
        const db = setupSlots(article, stack, fw).find((x) => x.slot === 'db')!;
        expect(db.options.map((o) => o.id)).toEqual(['supabase', 'neon']);
        for (const o of db.options) expect(componentFlavor(o)).toBeDefined();
      }
    // API を他の事業者に置くと DB のスロットは出ない（D-65）
    expect(
      setupSlots(article, VERCEL_PRO, 'vite-spa', { api: 'cf-workers' }).some(
        (x) => x.slot === 'db',
      ),
    ).toBe(false);
  });

  it('構成の名前は実際の組で出す（ゲーム中・見積モード。始める画面の一覧は今のまま）', () => {
    const neon = { db: 'neon' };
    expect(stackName(VERCEL_PRO, 'nextjs', true, neon)).toBe(
      'Vercel Pro + Neon（Launch）',
    );
    expect(stackName(VERCEL_HOBBY, 'vite-spa', true, neon)).toBe(
      'Vercel Hobby + Neon（Free）（Vite の SPA）',
    );
    expect(stackName(NETLIFY_PERSONAL, 'astro', true, neon)).toBe(
      'Netlify Personal + Neon（Launch）（Astro）',
    );
    expect(stackName(VERCEL_PRO, 'nextjs')).toBe('Vercel Pro + Supabase Pro');
    // API を他の事業者に置くと DB はその事業者の部品（D-65 の名前のまま）
    expect(
      stackName(VERCEL_PRO, 'vite-spa', true, { ...neon, api: 'cf-workers' }),
    ).not.toContain('Neon');
  });

  it('Neon のアカウントが増える（アカウントの手間。D-52）', () => {
    expect(addedAccounts(VERCEL_PRO, { db: 'neon' })).toEqual(['neon']);
    expect(addedAccounts(NETLIFY_PRO, { db: 'neon' }, 'vite-spa')).toEqual([
      'neon',
    ]);
  });

  it('Supabase Pro の基本料が消え、Neon の計算・保存の従量になる', () => {
    const s = playMonth(
      newGame(VERCEL_PRO, 1, article, DEFAULT_START_DATE, 'nextjs', {
        db: 'neon',
      }),
    );
    const lines = s.history[0]!.lines;
    expect(lines.some((l) => l.provider === 'supabase')).toBe(false);
    const compute = lines.find(
      (l) => l.provider === 'neon' && l.meterId === 'compute',
    )!;
    // ほぼ常に誰かが見ているので、0.25 CU × 730 時間 × $0.106 の近くまで動いている
    expect(compute.amount).toBeGreaterThan(15);
    expect(compute.amount).toBeLessThan(0.25 * 730 * 0.106 + 1e-9);
  });

  it('Neon Free（Vercel Hobby）は月 100 CU 時間を使い切ると止まる', () => {
    let s = playMonth(
      newGame(VERCEL_HOBBY, 1, article, DEFAULT_START_DATE, 'nextjs', {
        db: 'neon',
      }),
    );
    while (s.phase === 'playing') s = playMonth(s);
    const hit = s.history
      .flatMap((h) => h.premises)
      .find((p) => p.id.startsWith('pool:neon:free:free-compute'));
    expect(hit).toMatchObject({ hit: true, effect: 'block' });
  });

  it('ゲーム中に Supabase から Neon へ差し替えられる（データの移行の後に切り替わる）', () => {
    let s = playMonth(
      newGame(VERCEL_PRO, 1, article, DEFAULT_START_DATE, 'nextjs'),
    );
    s = playMonth(
      applyActions(s, [{ type: 'component', slot: 'db', option: 'neon' }]),
    );
    for (let i = 0; i < 6 && s.components.db !== 'neon'; i++)
      s = playMonth(applyActions(s, []));
    expect(s.components.db).toBe('neon');
    const last = s.history[s.history.length - 1]!;
    expect(last.lines.some((l) => l.provider === 'neon')).toBe(true);
  });
});

describe('基準プレイ（何もしない・シード 1〜20。prd/11 §15.3）', () => {
  it('CF Paid（目標の根拠）は変わらない', () => {
    expect(run(article, CF_PAID, 'nextjs').won).toBe(20);
    expect(run(contract, CF_PAID, 'nextjs').won).toBe(20);
  });

  it('記事コミュニティ: Neon で DB の月額は下がるが、Vercel Pro は画像を Cloudflare に出しても届かない', () => {
    const supa = run(article, VERCEL_PRO, 'nextjs');
    const neon = run(article, VERCEL_PRO, 'nextjs', { db: 'neon' });
    expect(neon.monthly).toBeLessThan(supa.monthly);
    expect(neon.won).toBe(0);
    expect(
      run(article, VERCEL_PRO, 'nextjs', { db: 'neon', images: 'cf-resize' })
        .won,
    ).toBe(0);
    // Netlify Pro × Next.js は Neon と画像だけ Cloudflare の組で一部のシードが届く
    expect(
      run(article, NETLIFY_PRO, 'nextjs', { db: 'neon', images: 'cf-resize' })
        .won,
    ).toBe(7);
  });

  it('受託: 夜間・休日に止まる分（D-90）で Neon の SPA は多くのシードが届き、Netlify Personal（Neon Launch）では全シードが届く', () => {
    expect(run(contract, VERCEL_PRO, 'vite-spa').won).toBe(0);
    expect(run(contract, VERCEL_PRO, 'vite-spa', { db: 'neon' }).won).toBe(18);
    expect(run(contract, VERCEL_PRO, 'nextjs', { db: 'neon' }).won).toBe(6);
    expect(
      run(contract, NETLIFY_PERSONAL, 'vite-spa', { db: 'neon' }).won,
    ).toBe(20);
  });

  it('止まる DB を時間帯で数える（D-90）: 受託は深夜・休日に止まって安くなり、記事は止まらない（12 か月の費用の平均 / 月）', () => {
    const AWS = idx('aws-amplify');
    const OPENNEXT = idx('aws-opennext');
    const fmt = (x: { won: number; monthly: number }) =>
      `${x.won}/20 $${x.monthly.toFixed(1)}`;
    const table = {
      contractAwsSpaAurora: fmt(
        run(contract, AWS, 'vite-spa', { db: 'aurora' }),
      ),
      contractAwsSpaPause: fmt(
        run(contract, AWS, 'vite-spa', { db: 'aurora-pause' }),
      ),
      contractOpenNextPause: fmt(
        run(contract, OPENNEXT, 'nextjs', { db: 'aurora-pause' }),
      ),
      articleAwsSpaAurora: fmt(run(article, AWS, 'vite-spa', { db: 'aurora' })),
      articleAwsSpaPause: fmt(
        run(article, AWS, 'vite-spa', { db: 'aurora-pause' }),
      ),
      contractVercelNext: fmt(
        run(contract, VERCEL_PRO, 'nextjs', { db: 'neon' }),
      ),
      contractVercelSpa: fmt(
        run(contract, VERCEL_PRO, 'vite-spa', { db: 'neon' }),
      ),
      contractNetlifyNext: fmt(
        run(contract, NETLIFY_PRO, 'nextjs', { db: 'neon' }),
      ),
      contractNetlifySpa: fmt(
        run(contract, NETLIFY_PRO, 'vite-spa', { db: 'neon' }),
      ),
      contractPersonalNext: fmt(
        run(contract, NETLIFY_PERSONAL, 'nextjs', { db: 'neon' }),
      ),
      contractPersonalSpa: fmt(
        run(contract, NETLIFY_PERSONAL, 'vite-spa', { db: 'neon' }),
      ),
      articleVercelNext: fmt(
        run(article, VERCEL_PRO, 'nextjs', { db: 'neon' }),
      ),
      articleNetlifyNextCf: fmt(
        run(article, NETLIFY_PRO, 'nextjs', {
          db: 'neon',
          images: 'cf-resize',
        }),
      ),
    };
    // 前（D-89 まで。月の平均の到着率）: 受託 × AWS × SPA の 0 ACU $76.1・OpenNext $73.7、受託 × Neon は Vercel Next 0/20・SPA 7/20・
    // Netlify Pro Next 0/20・SPA 7/20・Personal Next 0/20・SPA 20/20 $32.6、記事は Aurora の 0 ACU で $0.6 安かった
    expect(table).toEqual({
      contractAwsSpaAurora: '0/20 $76.5',
      contractAwsSpaPause: '0/20 $55.3',
      contractOpenNextPause: '0/20 $52.9',
      articleAwsSpaAurora: '0/20 $88.1',
      articleAwsSpaPause: '0/20 $88.1',
      contractVercelNext: '6/20 $36.2',
      contractVercelSpa: '18/20 $34.7',
      contractNetlifyNext: '14/20 $34.6',
      contractNetlifySpa: '18/20 $34.5',
      contractPersonalNext: '19/20 $31.8',
      contractPersonalSpa: '20/20 $27.1',
      articleVercelNext: '0/20 $118.1',
      articleNetlifyNextCf: '7/20 $52.4',
    });
  });
});
