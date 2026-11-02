// さくらの VPS の前段の CDN（D-31・D-91）。Cloudflare のプロキシ（Free）を前に置く。
import { describe, expect, it } from 'vitest';
import { composeStack, loadPriceBooks } from 'catalog';
import { estimate } from 'estimator';
import {
  applyAction,
  ARTICLE_COMMUNITY,
  checkAction,
  DEFAULT_START_DATE,
  EFFORT,
  FRONT_CDN_DELAY_FACTOR,
  meetsRequirement,
  newGame,
  playMonth,
  setupSlots,
  STACKS,
  workloadFor,
  type GameState,
} from './index.ts';

const VPS = 4;
const VPS_4GB = 5;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const ratio = (s: GameState, prefix: string) =>
  last(s).snapshots.find((p) => p.id.startsWith(prefix))?.ratio ?? 0;
const cdn = (option: string) =>
  ({ type: 'component', slot: 'frontCdn', option }) as const;

describe('前段の CDN', () => {
  it('静的と画像だけ: VPS の回線と CPU の使用率が下がり、費用は増えない', () => {
    const s = playMonth(newGame(VPS));
    expect(checkAction(s, cdn('static'))).toEqual({
      ok: true,
      // Cloudflare のアカウントが増えるので、差すときの一度きりの手間が付く（D-52）
      cost: EFFORT.component.frontCdn + EFFORT.accountSetup,
    });
    const withCdn = playMonth(applyAction(s, cdn('static')));
    const plain = playMonth(s);
    expect(ratio(withCdn, 'host:line:')).toBeLessThan(
      ratio(plain, 'host:line:'),
    );
    expect(ratio(withCdn, 'host:cpu:')).toBeLessThan(ratio(plain, 'host:cpu:'));
    expect(last(withCdn).infraCost).toBeCloseTo(last(plain).infraCost, 6);
    expect(last(withCdn).satisfaction.stages.freshness).toBe(
      last(plain).satisfaction.stages.freshness,
    );
  });

  it('HTML も・時間の再検証: 更新は最大で間隔の約 2 倍遅れる（5 分 → 10 分で鮮度が 1 段下がる。D-91）', () => {
    const s = playMonth(newGame(VPS));
    const html = playMonth(applyAction(s, cdn('html')));
    expect(last(html).satisfaction.stages.freshness).toBe('fair');
    expect(last(html).satisfaction.reasons.freshness).toContain(
      '間隔の約 2 倍',
    );
    // 1 分なら 2 分の遅れで「良い」のまま
    const oneMin = playMonth(
      newGame(
        VPS,
        42,
        ARTICLE_COMMUNITY,
        DEFAULT_START_DATE,
        'nextjs',
        {
          frontCdn: 'html',
        },
        60,
      ),
    );
    expect(last(oneMin).satisfaction.stages.freshness).toBe('good');
    expect(FRONT_CDN_DELAY_FACTOR).toBe(2);
  });

  it('HTML も・オンデマンド: 再検証のたびに purge で消すので遅れず、VPS の回線と CPU が静的と画像だけより下がる（D-91）', () => {
    const start = (option: string) =>
      playMonth(
        newGame(
          VPS,
          42,
          ARTICLE_COMMUNITY,
          DEFAULT_START_DATE,
          'nextjs',
          {
            frontCdn: option,
          },
          0,
        ),
      );
    const html = start('html');
    const stat = start('static');
    expect(last(html).satisfaction.stages.freshness).toBe('good');
    expect(ratio(html, 'host:line:')).toBeLessThan(ratio(stat, 'host:line:'));
    expect(ratio(html, 'host:cpu:')).toBeLessThan(ratio(stat, 'host:cpu:'));
    expect(last(html).infraCost).toBeCloseTo(last(stat).infraCost, 6);
  });

  it('HTML も: SPA はシェル、Astro は記事の静的なページを CDN が返す（鮮度は変わらない。D-91）', () => {
    for (const fw of ['vite-spa', 'astro'] as const) {
      const start = (option: string) =>
        playMonth(
          newGame(VPS, 42, ARTICLE_COMMUNITY, DEFAULT_START_DATE, fw, {
            frontCdn: option,
          }),
        );
      const html = start('html');
      const stat = start('static');
      expect(html.components.frontCdn).toBe('html');
      expect(ratio(html, 'host:line:')).toBeLessThan(ratio(stat, 'host:line:'));
      expect(last(html).satisfaction.stages.freshness).toBe(
        last(stat).satisfaction.stages.freshness,
      );
    }
  });

  it('HTML も・オンデマンド: 再検証のたびにページを 1 回消し（Free の purge は課金なし）、記事のページの閲覧は CDN を外れた分だけ VPS に届く（D-91）', () => {
    const g = newGame(
      VPS,
      42,
      ARTICLE_COMMUNITY,
      DEFAULT_START_DATE,
      'nextjs',
      {
        frontCdn: 'html',
      },
      0,
    );
    const workload = workloadFor(ARTICLE_COMMUNITY, {
      pv: 300_000,
      settings: g.settings,
      ssrCpuMs: 15,
      mods: g.mods,
      stock: null,
      platform: 'sakura',
      components: g.components,
      framework: 'nextjs',
    });
    const r = estimate({
      workload,
      architecture: composeStack(STACKS[VPS]!.id, g.components),
      books: loadPriceBooks(),
    });
    const w = r.simulation.workload;
    const cdnNode = r.simulation.nodes['cf-cdn']!;
    expect(cdnNode.resources['invalidation-paths']).toBeCloseTo(
      w.onDemandPageRevalidations,
      6,
    );
    // 月 300 回の更新は、Free の prefix の purge（1 分 5 回・1 回 100 件）に十分収まる
    expect(w.onDemandPageRevalidations).toBeLessThan(5 * 60 * 24 * 30);
    expect(r.bill.lines.some((l) => l.nodeIds.includes('cf-cdn'))).toBe(false);
    const hit = w.cacheHitRate['document-isr']!;
    expect(hit).toBeGreaterThan(0);
    expect(r.simulation.nodes.vps!.resources.requests).toBeLessThan(
      cdnNode.resources.requests!,
    );
  });

  it('始める画面・見積モード（setupSlots）: どのフレームワークでも なし / 静的と画像だけ / HTML も を選べる（D-91）', () => {
    for (const fw of ['nextjs', 'vite-spa', 'astro', 'nextjs-export'] as const)
      expect(
        setupSlots(ARTICLE_COMMUNITY, VPS, fw)
          .find((x) => x.slot === 'frontCdn')
          ?.options.map((o) => o.id),
      ).toEqual(['none', 'static', 'html']);
  });

  it('CDN（Free）に SLA は無いので、前に置くと SLA の要件を満たさない', () => {
    expect(meetsRequirement(VPS_4GB, 'uptime-sla')).toBe(true);
    expect(
      meetsRequirement(VPS_4GB, 'uptime-sla', { frontCdn: 'static' }),
    ).toBe(false);
  });
});
