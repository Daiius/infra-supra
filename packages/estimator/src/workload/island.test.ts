// 枠 + サーバーの島（描き方 S6。D-108・prd/13 §8）の数え方。値はすべて架空。
import { describe, expect, it } from 'vitest';
import { cpuSourceText } from '../premises.ts';
import { simulateResources } from '../simulate/simulate.ts';
import { resolveWorkload } from './resolve.ts';
import type { WorkloadInput } from './schema.ts';

const processing = {
  cpuMs: 10,
  ioWaitMs: 30,
  queries: 2,
  rowsReadPerQuery: 5,
  responseKB: 50,
};

const base = (routes: WorkloadInput['routes']): WorkloadInput => ({
  commercial: true,
  traffic: {
    mau: 1_000,
    dauPerMau: 0.5,
    sessionsPerDau: 1,
    pagesPerSession: 4,
    weekdayToWeekend: 1,
    peakHourFactor: 2,
    monthlyPageViewsOverride: 100_000,
  },
  routes,
  perPage: { apiCalls: 1, assets: 10, images: 0 },
  api: {
    cpuMs: 2,
    ioWaitMs: 10,
    queries: 1,
    rowsReadPerQuery: 1,
    responseKB: 5,
    writesPerCall: 0,
    rowsWrittenPerWrite: 0,
  },
  assets: { sizeKB: 20, browserReuse: 0.5 },
  images: {
    sizeKB: 100,
    browserReuse: 0.5,
    distinct: 10,
    variants: 2,
    storedGB: 1,
    uploadsPerMau: 0,
  },
  db: { sizeGB: 1, responseKBPerQuery: 1 },
});

const shell = { ...processing, cpuMs: 6, queries: 0, ioWaitMs: 0 };
const island = { ...processing, cpuMs: 4, responseKB: 20 };
const astro = base([
  {
    id: 'mine',
    label: '個人向けのページ',
    rendering: 'isr',
    share: 1,
    pages: 1,
    revalidateSeconds: 86_400,
    cachedServeCpuMs: 2,
    processing: shell,
    island: { request: island },
  },
]);

describe('サーバーの島（S6。D-108）', () => {
  it('別のリクエストの島（Astro）: 閲覧ごとに document-ssr を 1 件足し、枠は ISR の経路（キャッシュ）で数える', () => {
    const r = resolveWorkload(astro);
    expect(r.classes['document-isr'].count).toBeCloseTo(100_000, 6);
    expect(r.classes['document-ssr'].count).toBeCloseTo(100_000, 6);
    expect(r.classes['document-ssr'].perRequest).toMatchObject({
      cpuMs: 4,
      wallMs: 4 + island.ioWaitMs,
      queries: 2,
      kb: 20,
    });
    // 枠は 1 日の期限・1 ページなので、取り直しはわずか（DB を読まない）
    expect(r.classes['isr-revalidate'].count).toBeLessThan(100);
    expect(r.classes['isr-revalidate'].perRequest.queries).toBe(0);
    expect(r.sources['document-ssr']).toEqual([
      {
        routeId: 'mine',
        label: '個人向けのページ',
        rendering: 'isr',
        count: 100_000,
        cpuMs: 4,
        island: true,
      },
    ]);
    expect(r.sources['document-isr']![0]).toMatchObject({ islandShell: true });
  });

  it('同じ応答の中の島（Next.js の PPR）: 数え方は ssr のまま、内訳に島の印', () => {
    const r = resolveWorkload(
      base([
        {
          id: 'mine',
          rendering: 'ssr',
          share: 1,
          pages: 1,
          processing: island,
          island: {},
        },
      ]),
    );
    expect(r.classes['document-ssr'].count).toBeCloseTo(100_000, 6);
    expect(r.classes['document-isr'].count).toBe(0);
    expect(r.sources['document-ssr']![0]).toMatchObject({ island: true });
  });

  it('届け方とルートの描き方が合わないものは弾く', () => {
    expect(() =>
      resolveWorkload(
        base([
          {
            id: 'x',
            rendering: 'ssr',
            share: 1,
            pages: 1,
            processing,
            island: { request: island },
          },
        ]),
      ),
    ).toThrow();
    expect(() =>
      resolveWorkload(
        base([
          {
            id: 'x',
            rendering: 'isr',
            share: 1,
            pages: 1,
            revalidateSeconds: 60,
            processing,
            island: {},
          },
        ]),
      ),
    ).toThrow();
  });

  it('1 リクエストの CPU の内訳: 島は枠と別に「サーバーの島」と出る', () => {
    const sim = simulateResources(resolveWorkload(astro), {
      id: 'a',
      name: 'a',
      nodes: [
        {
          id: 'fn',
          label: 'fn',
          config: {
            kind: 'function',
            backgroundClasses: ['isr-revalidate'],
            cache: { classes: ['document-isr'], hitCpuMs: 0 },
          },
        },
        { id: 'db', label: 'db', config: { kind: 'sql-db' } },
      ],
      routes: {
        'document-isr': ['fn'],
        'isr-revalidate': ['fn'],
        'document-ssr': ['fn', 'db'],
      },
    });
    const src = sim.nodes.fn!.cpuSources.find((s) => s.island)!;
    expect(src).toMatchObject({ requestClass: 'document-ssr', cpuMs: 4 });
    expect(cpuSourceText(src)).toBe(
      '個人向けのページ（サーバーの島・CPU 4 ms）',
    );
    // 枠の取り直し（キャッシュから返す 2 ms + 枠を描く 6 ms）は別の内訳
    const shellSrc = sim.nodes.fn!.cpuSources.find(
      (s) => s.routeId === 'mine' && s.islandShell && s.cpuMs === 8,
    )!;
    expect(cpuSourceText(shellSrc)).toBe(
      '個人向けのページ（島の枠の閲覧と描き直し・CPU 8 ms）',
    );
    // 島のリクエストは関数のリクエストに数える（閲覧 + 島）
    expect(sim.nodes.fn!.resources.requests).toBeCloseTo(200_000, 6);
  });
});
