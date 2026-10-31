// SPA のルートの件数（prd/10 F-01・prd/04 §2）。値はすべて架空。
import { describe, expect, it } from 'vitest';
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

describe('SPA のルート', () => {
  const spa = resolveWorkload(
    base([
      {
        id: 'app',
        rendering: 'spa',
        share: 1,
        pages: 1,
        processing,
        shellKB: 3,
      },
    ]),
  );

  it('シェルは入口だけ（PV ÷ ページ/セッション）で、HTML の生成はない', () => {
    expect(spa.classes['document-static'].count).toBeCloseTo(25_000);
    expect(spa.classes['document-static'].perRequest.kb).toBe(3);
    expect(spa.classes['document-ssr'].count).toBe(0);
    expect(spa.classes['document-isr'].count).toBe(0);
    expect(spa.classes['isr-revalidate'].count).toBe(0);
  });

  it('中身はページごとのデータの API（既存の API と件数で重み付けしてまとめる）', () => {
    const api = spa.classes.api;
    expect(api.count).toBeCloseTo(200_000);
    expect(api.perRequest.cpuMs).toBeCloseTo((2 + 10) / 2);
    expect(api.perRequest.queries).toBeCloseTo((1 + 2) / 2);
  });

  it('JS・CSS は入口だけ読む', () => {
    expect(spa.classes.asset.count).toBeCloseTo(25_000 * 10 * 0.5);
  });

  it('SPA でないルートの件数は変わらない', () => {
    const ssr = resolveWorkload(
      base([{ id: 'app', rendering: 'ssr', share: 1, pages: 1, processing }]),
    );
    expect(ssr.classes.asset.count).toBeCloseTo(100_000 * 10 * 0.5);
    expect(ssr.classes.api.count).toBeCloseTo(100_000);
    expect(ssr.classes['document-ssr'].count).toBeCloseTo(100_000);
  });

  it('SPA のルートには shellKB が要る', () => {
    expect(() =>
      resolveWorkload(
        base([{ id: 'app', rendering: 'spa', share: 1, pages: 1, processing }]),
      ),
    ).toThrow();
  });
});
