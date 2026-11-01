// SPA のルートの件数（prd/10 F-01・prd/04 §2）。値はすべて架空。
import { describe, expect, it } from 'vitest';
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

describe('オンデマンドの再検証（D-49・prd/04 §2）', () => {
  const isr = (extra: Partial<WorkloadInput['routes'][number]>) =>
    base([
      {
        id: 'article',
        rendering: 'isr',
        share: 1,
        pages: 1_000,
        processing,
        cachedServeCpuMs: 1,
        ...extra,
      },
    ]);

  it('再生成は 更新 × 閲覧 / (更新 + 閲覧)。更新が閲覧よりずっと少なければ更新の回数に近い', () => {
    const w = resolveWorkload(isr({ onDemandUpdatesPerMonth: 1_000 }));
    expect(w.classes['isr-revalidate'].count).toBeCloseTo(
      (1_000 * 100_000) / (1_000 + 100_000),
      9,
    );
    // 時間の再検証（5 分）より少ない
    const timed = resolveWorkload(isr({ revalidateSeconds: 300 }));
    expect(w.classes['isr-revalidate'].count).toBeLessThan(
      timed.classes['isr-revalidate'].count,
    );
    expect(
      w.derivations.find((d) => d.id === 'isr-revalidations:article')!.label,
    ).toContain('オンデマンド');
  });

  it('最大寿命（保険の時間の再検証）を併せると、時間の式の分が加わる。閲覧が少ないと小さく、閲覧の回数は超えない（D-56）', () => {
    const DAY = 86_400;
    const SECONDS_PER_MONTH = 730 * 3600;
    const at = (views: number) =>
      resolveWorkload({
        ...isr({ onDemandUpdatesPerMonth: 1_000, onDemandMaxAgeSeconds: DAY }),
        traffic: {
          ...base([]).traffic,
          monthlyPageViewsOverride: views,
        },
      }).classes['isr-revalidate'].count;
    const expected = (v: number) => {
      const lt = (v / 1_000) * (DAY / SECONDS_PER_MONTH);
      return Math.min(v, (1_000 * v) / (1_000 + v) + v / (1 + lt));
    };
    expect(at(100_000)).toBeCloseTo(expected(100_000), 6);
    expect(at(100_000)).toBeGreaterThan((1_000 * 100_000) / 101_000);
    // 閲覧が少ないと再生成も少ない（閲覧の回数を超えない）
    expect(at(100)).toBeLessThanOrEqual(100);
    expect(at(100)).toBeLessThan(at(100_000));
    // 時間の分は、ページ数 × 1 か月 / 最大寿命 を超えない（閲覧が濃くても頭打ち）
    const timedOnly = (v: number) => expected(v) - (1_000 * v) / (1_000 + v);
    expect(timedOnly(10_000_000)).toBeLessThan(
      1_000 * (SECONDS_PER_MONTH / DAY),
    );
  });

  it('再検証を呼ぶページの数は 更新 × 1 回の更新で再検証するページ（再生成の回数とは別。既定は 1。時間の再検証は 0。D-66）', () => {
    const w = resolveWorkload(
      isr({ onDemandUpdatesPerMonth: 1_000, onDemandPagesPerUpdate: 2 }),
    );
    expect(w.onDemandPageRevalidations).toBe(2_000);
    expect(
      w.derivations.find((d) => d.id === 'on-demand-pages:article')!.result,
    ).toBe(2_000);
    expect(
      resolveWorkload(isr({ onDemandUpdatesPerMonth: 1_000 }))
        .onDemandPageRevalidations,
    ).toBe(1_000);
    expect(
      resolveWorkload(isr({ revalidateSeconds: 300 }))
        .onDemandPageRevalidations,
    ).toBe(0);
    // ISR のページの大きさ: ページ数 × 応答の大きさ
    expect(w.storage.isrPagesGB).toBeCloseTo((1_000 * 50) / 1_000_000, 12);
  });

  it('更新が 0 なら再生成も 0', () => {
    const w = resolveWorkload(isr({ onDemandUpdatesPerMonth: 0 }));
    expect(w.classes['isr-revalidate'].count).toBe(0);
  });

  it('時間とオンデマンドはどちらか一方（両方も、どちらも無いのも不可）', () => {
    expect(() =>
      resolveWorkload(
        isr({ revalidateSeconds: 300, onDemandUpdatesPerMonth: 10 }),
      ),
    ).toThrow();
    expect(() => resolveWorkload(isr({}))).toThrow();
  });
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

describe('期間つきのキャッシュのヒット率（D-37・prd/04 §2）', () => {
  const content = (pages: number, cacheSeconds?: number) =>
    resolveWorkload(
      base([
        {
          id: 'article',
          rendering: 'spa',
          share: 0.6,
          pages,
          processing,
          shellKB: 3,
          ...(cacheSeconds !== undefined ? { cacheSeconds } : {}),
        },
        {
          id: 'personal',
          rendering: 'spa',
          share: 0.4,
          pages: 1,
          processing,
          shellKB: 3,
        },
      ]),
    );

  it('期間を付けた中身だけ api-content に分かれ、個人化された中身は api のまま', () => {
    const off = content(100);
    const on = content(100, 300);
    expect(off.classes['api-content'].count).toBe(0);
    expect(off.cacheHitRate['api-content']).toBeUndefined();
    expect(on.classes['api-content'].count).toBeCloseTo(60_000);
    // api = もともとの API（PV × 1）+ 個人化の中身（40%）
    expect(on.classes.api.count).toBeCloseTo(100_000 + 40_000);
    expect(on.classes.api.count + on.classes['api-content'].count).toBeCloseTo(
      off.classes.api.count,
    );
  });

  it('ヒット率は λT / (1 + λT)。閲覧の密度（ページが少ない）と期間で単調に増え、1 未満', () => {
    const hit = (pages: number, sec: number) =>
      content(pages, sec).cacheHitRate['api-content']!;
    const lambdaT = (60_000 / 100) * (300 / (730 * 3600));
    expect(hit(100, 300)).toBeCloseTo(lambdaT / (1 + lambdaT), 12);
    const secs = [60, 300, 3600, 21600];
    for (let i = 1; i < secs.length; i++)
      expect(hit(100, secs[i]!)).toBeGreaterThan(hit(100, secs[i - 1]!));
    const pages = [10_000, 1_000, 100, 10];
    for (let i = 1; i < pages.length; i++)
      expect(hit(pages[i]!, 300)).toBeGreaterThan(hit(pages[i - 1]!, 300));
    expect(hit(1, 21600)).toBeLessThan(1);
  });

  it('ISR のページのヒット率は 1 − 再生成の数 / 閲覧（同じ式）', () => {
    const r = resolveWorkload(
      base([
        {
          id: 'article',
          rendering: 'isr',
          share: 1,
          pages: 100,
          revalidateSeconds: 300,
          processing,
        },
      ]),
    );
    expect(r.cacheHitRate['document-isr']).toBeCloseTo(
      1 - r.classes['isr-revalidate'].count / r.classes['document-isr'].count,
      12,
    );
  });

  it('cacheSeconds は SPA のルートだけ', () => {
    expect(() =>
      resolveWorkload(
        base([
          {
            id: 'x',
            rendering: 'ssr',
            share: 1,
            pages: 1,
            processing,
            cacheSeconds: 60,
          },
        ]),
      ),
    ).toThrow(/cacheSeconds/);
  });
});

describe('キャッシュの後ろへは、ルートごとの miss で重み付けした処理を渡す（OCL-48C8B649）', () => {
  // 閲覧が濃く軽いルート（hot）と、閲覧が薄く重いルート（cold）
  const w = resolveWorkload(
    base([
      {
        id: 'hot',
        rendering: 'spa',
        share: 0.5,
        pages: 1,
        processing: { ...processing, cpuMs: 1, queries: 1 },
        shellKB: 3,
        cacheSeconds: 3600,
      },
      {
        id: 'cold',
        rendering: 'spa',
        share: 0.5,
        pages: 100_000,
        processing: { ...processing, cpuMs: 100, queries: 4 },
        shellKB: 3,
        cacheSeconds: 3600,
      },
    ]),
  );
  const miss = (pages: number) => {
    const lt = (50_000 / pages) * (3600 / (730 * 3600));
    return 50_000 / (1 + lt);
  };
  const expectedCpu = miss(1) * 1 + miss(100_000) * 100;
  const expectedRows = (miss(1) * 1 + miss(100_000) * 4) * 5;

  it('CDN（ttlClasses）の後ろの関数の CPU と DB の読み取り', () => {
    const sim = simulateResources(w, {
      id: 'a',
      name: 'a',
      nodes: [
        {
          id: 'cdn',
          label: 'cdn',
          config: { kind: 'cdn', ttlClasses: ['api-content'] },
        },
        { id: 'fn', label: 'fn', config: { kind: 'function' } },
        { id: 'db', label: 'db', config: { kind: 'sql-db' } },
      ],
      routes: { 'api-content': ['cdn', 'fn', 'db'] },
    });
    expect(sim.nodes.fn!.resources['cpu-ms']).toBeCloseTo(expectedCpu, 6);
    expect(sim.nodes.db!.resources['rows-read']).toBeCloseTo(expectedRows, 6);
  });

  it('関数の中のキャッシュ（cache）でも同じ。ヒットは hitCpuMs だけ', () => {
    const sim = simulateResources(w, {
      id: 'a',
      name: 'a',
      nodes: [
        {
          id: 'fn',
          label: 'fn',
          config: {
            kind: 'function',
            cache: { classes: ['api-content'], hitCpuMs: 2 },
          },
        },
        { id: 'db', label: 'db', config: { kind: 'sql-db' } },
      ],
      routes: { 'api-content': ['fn', 'db'] },
    });
    const hits = 100_000 - miss(1) - miss(100_000);
    expect(sim.nodes.fn!.resources['cpu-ms']).toBeCloseTo(
      expectedCpu + hits * 2,
      6,
    );
    expect(sim.nodes.fn!.resources.requests).toBeCloseTo(100_000, 6);
    expect(sim.nodes.db!.resources['rows-read']).toBeCloseTo(expectedRows, 6);
  });

  it('1 リクエストの CPU の最大は、ヒットの CPU が miss の処理より重ければヒットの CPU（OCL-8B3B0CB7）', () => {
    const sim = (hitCpuMs: number) =>
      simulateResources(w, {
        id: 'a',
        name: 'a',
        nodes: [
          {
            id: 'fn',
            label: 'fn',
            config: {
              kind: 'function',
              cache: { classes: ['api-content'], hitCpuMs },
            },
          },
        ],
        routes: { 'api-content': ['fn'] },
      }).nodes.fn!.maxCpuMsPerRequest;
    // miss の処理は最大 100 ms（cold）。ヒットが 150 ms ならそちらが上限の判定に使われる
    expect(sim(2)).toBe(100);
    expect(sim(150)).toBe(150);
  });
});

describe('ピークの時間帯のヒット率（D-44）', () => {
  it('到着率が peakHourFactor 倍になるので、ピークのヒット率は月の平均より高い', () => {
    const w = resolveWorkload(
      base([
        {
          id: 'article',
          rendering: 'spa',
          share: 1,
          pages: 100,
          processing,
          shellKB: 3,
          cacheSeconds: 300,
        },
      ]),
    );
    const lt = (100_000 / 100) * (300 / (730 * 3600));
    const p = 2;
    expect(w.peakCacheHitRate['api-content']).toBeCloseTo(
      (lt * p) / (1 + lt * p),
      12,
    );
    expect(w.peakCacheHitRate['api-content']!).toBeGreaterThan(
      w.cacheHitRate['api-content']!,
    );
    expect(w.peakCacheMissFlow['api-content']!.count).toBeLessThan(
      w.cacheMissFlow['api-content']!.count,
    );
  });
});
