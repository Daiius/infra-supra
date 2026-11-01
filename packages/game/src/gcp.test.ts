// Google Cloud（Cloud Run + Firebase Hosting。D-88・prd/11 §16）をゲームで選べること。最小インスタンス数・DB（Firestore・Cloud SQL）・
// 画像だけ Cloudflare を選べ、コンテナの維持の手間が少しかかる。基準プレイ（何もしない・シード 1〜20）。
import { describe, expect, it } from 'vitest';
import { composeStack, loadPriceBooks, type Choices } from 'catalog';
import { estimate } from 'estimator';
import {
  addedAccounts,
  coldStartViewShare,
  COLD_START,
  IMAGE_FORMAT_KB,
  workloadFor,
  ARTICLE_COMMUNITY,
  componentFlavor,
  DEFAULT_START_DATE,
  EFFORT,
  meetsRequirement,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  stackFlavor,
  STACKS,
  stackSupports,
  upkeepOf,
  type FrameworkId,
} from './index.ts';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const GCP = idx('gcp-cloud-run');
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
  return { won, monthly: Math.round((cost / months) * 10) / 10 };
}

const slotsOf = (sc: Scenario, fw: FrameworkId) =>
  setupSlots(sc, GCP, fw).map((x) => [x.slot, x.options.map((o) => o.id)]);

describe('Google Cloud の構成', () => {
  it('既存の構成の後ろに足している（保存と基準プレイの添字を変えない）', () => {
    expect(GCP).toBe(11);
    expect(STACKS[GCP]!.provider).toBe('gcp');
    expect(stackFlavor(GCP)).toBeDefined();
    for (const fw of ['nextjs', 'vite-spa', 'astro', 'nextjs-export'] as const)
      expect(stackSupports(GCP, fw)).toBe(true);
  });

  it('始める画面: ISR・画像（Cloudflare の部品も）・DB・最小インスタンス数を選び、ファイルの置き場（Cloud Storage）は固定', () => {
    expect(slotsOf(article, 'nextjs')).toEqual([
      ['isrCache', ['default', 'none']],
      ['images', ['default', 'none', 'resize', 'cf-images', 'cf-resize']],
      ['db', ['firestore', 'cloud-sql']],
      ['minInstances', ['0', '1']],
      ['files', ['gcs']],
    ]);
    // 静的書き出しは next/image の既定のローダーが使えないので、変換の部品が無い
    expect(slotsOf(article, 'nextjs-export')[0]).toEqual([
      'images',
      ['none', 'resize', 'cf-images', 'cf-resize'],
    ]);
    // 受託は画像のスロットを出さない
    expect(slotsOf(contract, 'nextjs').map(([slot]) => slot)).toEqual([
      'db',
      'minInstances',
      'files',
    ]);
    for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
      for (const x of setupSlots(article, GCP, fw))
        for (const o of x.options)
          if (x.slot !== 'files') expect(componentFlavor(o)).toBeDefined();
  });

  it('コンテナのビルドとデプロイの管理で維持の手間 0.5（OpenNext の 1 より小さい）。即時反映は満たせず、SLA は無い', () => {
    for (const sc of Object.values(SCENARIOS))
      expect(upkeepOf(sc, GCP)).toBe(EFFORT.containerUpkeep);
    expect(EFFORT.containerUpkeep).toBeLessThan(EFFORT.assembledUpkeep);
    expect(meetsRequirement(GCP, 'on-demand-isr')).toBe(false);
    expect(meetsRequirement(GCP, 'uptime-sla')).toBe(false);
  });

  it('最小インスタンス 1 は待機の費用（idle）の明細が出て、0 では出ない', () => {
    const lines = (c: Choices) =>
      playMonth(
        newGame(GCP, 1, article, DEFAULT_START_DATE, 'nextjs', c),
      ).history[0]!.lines.map((l) => l.meterId);
    expect(lines({})).not.toContain('idle-cpu');
    expect(lines({ minInstances: '1' })).toContain('idle-cpu');
    expect(lines({ db: 'cloud-sql' })).toContain('instance');
  });

  it('画像だけ Cloudflare を差すと Cloudflare のアカウントが増える', () => {
    expect(addedAccounts(GCP, { images: 'cf-resize' })).toEqual(['cloudflare']);
    expect(addedAccounts(GCP, { db: 'cloud-sql' })).toEqual([]);
  });

  it('基準プレイ（何もしない・シード 1〜20。達成数・12 か月の費用の平均 / 月）', () => {
    const table = {
      articleNext: run(article, GCP, 'nextjs'),
      articleNextMin1: run(article, GCP, 'nextjs', { minInstances: '1' }),
      articleNextSql: run(article, GCP, 'nextjs', { db: 'cloud-sql' }),
      articleNextCfResize: run(article, GCP, 'nextjs', { images: 'cf-resize' }),
      articleSpa: run(article, GCP, 'vite-spa'),
      articleSpaCfResize: run(article, GCP, 'vite-spa', {
        images: 'cf-resize',
      }),
      contractNext: run(contract, GCP, 'nextjs'),
      contractNextMin1: run(contract, GCP, 'nextjs', { minInstances: '1' }),
      contractNextSql: run(contract, GCP, 'nextjs', { db: 'cloud-sql' }),
      contractSpa: run(contract, GCP, 'vite-spa'),
      contractSpaSql: run(contract, GCP, 'vite-spa', { db: 'cloud-sql' }),
    };
    expect(table).toEqual({
      articleNext: { won: 0, monthly: 62.1 },
      articleNextMin1: { won: 0, monthly: 71.4 },
      articleNextSql: { won: 0, monthly: 69 },
      articleNextCfResize: { won: 20, monthly: 26 },
      articleSpa: { won: 0, monthly: 54.2 },
      articleSpaCfResize: { won: 20, monthly: 9.7 },
      contractNext: { won: 20, monthly: 12.2 },
      contractNextMin1: { won: 20, monthly: 21.6 },
      contractNextSql: { won: 20, monthly: 16.7 },
      contractSpa: { won: 20, monthly: 8.7 },
      contractSpaSql: { won: 20, monthly: 12.7 },
    });
    // 目標の根拠（CF Paid × Next.js）は不変
    expect(run(article, CF_PAID, 'nextjs')).toEqual({ won: 20, monthly: 15.2 });
    expect(run(contract, CF_PAID, 'nextjs')).toEqual({ won: 20, monthly: 5.7 });
  });

  /** 1 か月目の部品・設定で、PV と画像の大きさだけを替えた見積（Cloud Run の構成）。 */
  const monthOne = (pv: number, imageKB: number, components: Choices = {}) => {
    const g = newGame(
      GCP,
      1,
      article,
      DEFAULT_START_DATE,
      'nextjs',
      components,
    );
    const parts = {
      pv,
      settings: { ...g.settings, imageKB },
      ssrCpuMs: 15,
      mods: g.mods,
      stock: null,
      platform: 'gcp' as const,
      components: g.components,
      framework: 'nextjs' as const,
    };
    const workload = workloadFor(article, parts);
    const r = estimate({
      workload,
      architecture: composeStack(STACKS[GCP]!.id, g.components),
      books: loadPriceBooks(),
    });
    return { workload, r };
  };

  it('next/image の AVIF: Cloud Run の変換の CPU が WebP の 1.5 倍になり、サイズ違いの数は増えない（OCL-CDDD26AB）', () => {
    const webp = monthOne(300_000, IMAGE_FORMAT_KB.webp);
    const avif = monthOne(300_000, IMAGE_FORMAT_KB.avif);
    expect(avif.workload.images.variants).toBe(webp.workload.images.variants);
    expect(avif.workload.images.transformWorkFactor).toBe(1.5);
    expect(webp.workload.images.transformWorkFactor ?? 1).toBe(1);
    // Cloud Run に届く画像の閲覧（CDN の外れ）ごとの変換 150 ms が 225 ms になる。他のクラスの CPU は同じ
    const cpu = (x: typeof webp) =>
      x.r.simulation.nodes.run!.resources['cpu-ms']!;
    const misses = webp.r.simulation.workload.classes['image-read'].count * 0.1;
    expect(cpu(avif) - cpu(webp)).toBeCloseTo(misses * 150 * 0.5, 3);
  });

  it('冷えた起動は閲覧全体の割合に直して閾値と比べる（閲覧 1 件あたりの要求数を掛けて 1 で頭打ち・投稿は数えない。OCL-554477DF）', () => {
    const at = (pv: number, components: Choices = {}) => {
      const { r } = monthOne(pv, IMAGE_FORMAT_KB.webp, components);
      const u = r.simulation.nodes.run!;
      const w = r.simulation.workload;
      const view = (u.resources.requests ?? 0) - w.classes['image-write'].count;
      const expected =
        u.coldStartShare! * Math.min(1, view / w.monthlyPageViews);
      expect(coldStartViewShare(r)).toBeCloseTo(expected, 12);
      // 要求の割合より大きくはならない（閲覧 1 件あたり 1 件未満しか届かなければ小さくなる）
      expect(coldStartViewShare(r)).toBeLessThanOrEqual(u.coldStartShare!);
      return coldStartViewShare(r);
    };
    // 到着率の低い入力では効き、PV を増やすと効かなくなる（境目は月 3,000〜1 万 PV の間。3,000 PV で約 10%・1 万 PV で約 0.04%）
    const pvs = [100, 1_000, 3_000, 10_000, 300_000];
    const shares = pvs.map((pv) => at(pv));
    for (let i = 1; i < shares.length; i++)
      expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]!);
    expect(shares[0]!).toBeGreaterThanOrEqual(COLD_START.heavyShare);
    expect(shares[4]!).toBeLessThan(COLD_START.heavyShare);
    const edge = pvs.findIndex((_, i) => shares[i]! < COLD_START.heavyShare);
    expect(pvs[edge]).toBe(10_000);
    // 最小インスタンス 1 なら低い PV でも 0
    expect(at(100, { minInstances: '1' })).toBe(0);
  });
});
