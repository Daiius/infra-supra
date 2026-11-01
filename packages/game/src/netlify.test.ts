// Netlify の構成（D-71・prd/11 §14）をゲームで選べること。クレジットを使い切ると止まる（Free）・補充で請求が増える（Personal・Pro）、
// Astro のビルドし直しは本番のデプロイ 1 回ごとにクレジットを使う、他の事業者の部品を差せる。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
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
import type { Choices } from 'catalog';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const FREE = idx('netlify-supabase-free');
const PERSONAL = idx('netlify-supabase-personal');
const PRO = idx('netlify-supabase-pro');

function doNothing(
  stack: number,
  seed: number,
  framework: FrameworkId = 'nextjs',
  sc: Scenario = ARTICLE_COMMUNITY,
  components: Choices = {},
) {
  let s = playMonth(
    newGame(stack, seed, sc, DEFAULT_START_DATE, framework, components),
  );
  while (s.phase === 'playing') s = playMonth(applyActions(s, []));
  return s;
}

describe('Netlify の構成', () => {
  it('既存の構成の後ろに足している（保存と基準プレイの添字を変えない）', () => {
    expect([FREE, PERSONAL, PRO]).toEqual([8, 9, 10]);
    for (const i of [FREE, PERSONAL, PRO]) {
      expect(STACKS[i]!.provider).toBe('netlify');
      expect(stackFlavor(i)).toBeDefined();
      for (const fw of ['nextjs', 'vite-spa', 'astro'] as const)
        expect(stackSupports(i, fw)).toBe(true);
    }
  });

  it('始める画面: Next.js は ISR・画像（Cloudflare の部品も）・API の置き場を選び、ファイルの置き場（Netlify Blobs）は固定', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, PRO, 'nextjs');
    expect(slots.map((x) => [x.slot, x.fixed])).toEqual([
      ['isrCache', false],
      ['images', false],
      ['api', false],
      ['files', true],
    ]);
    expect(
      slots.find((x) => x.slot === 'images')!.options.map((o) => o.id),
    ).toEqual(['default', 'none', 'resize', 'cf-images', 'cf-resize']);
    expect(
      slots.find((x) => x.slot === 'api')!.options.map((o) => o.id),
    ).toEqual(['same', 'cf-workers-server']);
  });

  it('マネージドなので維持の手間は 0。即時反映は満たせ、SLA は無い', () => {
    for (const sc of Object.values(SCENARIOS))
      expect(upkeepOf(sc, PRO)).toBe(0);
    expect(meetsRequirement(PRO, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(PRO, 'uptime-sla')).toBe(false);
  });

  it('Free は記事コミュニティで 1 か月目にクレジットを使い切って止まる（請求は 0）', () => {
    const s = doNothing(FREE, 1);
    expect(s.history[0]!.status).toBe('down');
    expect(s.history[0]!.infraCost).toBe(0);
    expect(
      s.history[0]!.premises.find(
        (p) => p.id === 'credit:netlify:free:monthly-credits',
      ),
    ).toMatchObject({ hit: true, effect: 'block' });
  });

  it('Pro は使い切っても止まらず、補充の分だけ請求が増える（Vercel Pro より安い）', () => {
    const s = doNothing(PRO, 1);
    expect(s.history.every((h) => h.status !== 'down')).toBe(true);
    const credit = s.history[0]!.premises.find(
      (p) => p.id === 'credit:netlify:pro:monthly-credits',
    )!;
    expect(credit).toMatchObject({ effect: 'cost', hit: true });
    const total = (st: ReturnType<typeof doNothing>) =>
      st.history.reduce((a, h) => a + h.infraCost, 0);
    expect(total(s)).toBeLessThan(
      total(doNothing(idx('vercel-supabase-pro'), 1)),
    );
  });

  it('Astro: 記事のビルドし直しが本番のデプロイ（クレジット）になり、Next.js より高くつく', () => {
    const astro = doNothing(PRO, 1, 'astro');
    expect(
      astro.history[0]!.lines.some((l) => l.meterId === 'production-deploys'),
    ).toBe(true);
    const next = doNothing(PRO, 1, 'nextjs');
    expect(astro.history[0]!.infraCost).toBeGreaterThan(
      next.history[0]!.infraCost,
    );
  });

  it('受託: Pro は月 $45（Netlify $20 + Supabase $25）のまま、クレジットに収まる', () => {
    const s = doNothing(PRO, 1, 'nextjs', SCENARIOS['contract-operations']!);
    expect(s.history[0]!.infraCost).toBeCloseTo(45, 6);
    expect(s.history.every((h) => h.status === 'ok')).toBe(true);
  });

  it('他の事業者の部品（画像だけ Cloudflare・Workers の API）を差すと Cloudflare のアカウントが増える', () => {
    expect(addedAccounts(PRO, { images: 'cf-images' })).toEqual(['cloudflare']);
    expect(addedAccounts(PRO, { api: 'cf-workers-server' }, 'nextjs')).toEqual([
      'cloudflare',
    ]);
    expect(addedAccounts(PRO, { api: 'cf-workers' }, 'vite-spa')).toEqual([
      'cloudflare',
    ]);
    expect(addedAccounts(PRO, { api: 'cf-workers-astro' }, 'astro')).toEqual([
      'cloudflare',
    ]);
  });
});
