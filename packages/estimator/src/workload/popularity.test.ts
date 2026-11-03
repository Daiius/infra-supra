// ページごとの閲覧の偏り（Zipf。D-121）の土台と、期間つきのキャッシュ・画像の閲覧への当て方。
import { describe, expect, it } from 'vitest';
import { sumOverPages } from './popularity.ts';
import { resolveWorkload } from './resolve.ts';
import type { WorkloadInput } from './schema.ts';

const MONTH = 730 * 3600;

/** 偏りを 1 ページずつ足した値（比べる正解）。 */
function exact(
  views: number,
  n: number,
  s: number,
  f: (v: number) => number,
): number {
  let h = 0;
  for (let k = 1; k <= n; k++) h += Math.pow(k, -s);
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += f((views * Math.pow(k, -s)) / h);
  return sum;
}

describe('sumOverPages', () => {
  it('偏りなし（省略・0）は一様: ページ数 × f(閲覧 / ページ数)。ページ数が整数でなくてもそのまま', () => {
    const f = (v: number) => v / (1 + v * 0.01);
    expect(sumOverPages(1_000, 20, undefined, f)).toBeCloseTo(20 * f(50), 12);
    expect(sumOverPages(1_000, 20, 0, f)).toBeCloseTo(20 * f(50), 12);
    expect(sumOverPages(1_000, 2.5, undefined, f)).toBeCloseTo(
      2.5 * f(400),
      12,
    );
  });

  it('閲覧の割合の合計は 1（f が恒等なら閲覧の数に戻る）', () => {
    for (const n of [1, 7, 2_000, 50_000])
      for (const s of [0.6, 1, 1.4])
        expect(sumOverPages(123_456, n, s, (v) => v)).toBeCloseTo(123_456, 6);
  });

  it('1 ページずつ足した値と一致する（まとめる区間の手前は厳密、後ろは近似）', () => {
    const k = 300 / MONTH;
    const f = (v: number) => v / (1 + v * k);
    for (const n of [10, 2_000, 6_000])
      expect(
        sumOverPages(780_000, n, 1, f) / exact(780_000, n, 1, f),
      ).toBeCloseTo(1, 7);
    expect(
      sumOverPages(780_000, 20_000, 0.8, f) / exact(780_000, 20_000, 0.8, f),
    ).toBeCloseTo(1, 6);
  });

  it('miss（閲覧 / (1 + λT)）は凹なので、偏るほど少ない（ヒット率が上がる）', () => {
    const k = 300 / MONTH;
    const misses = (s: number) =>
      sumOverPages(780_000, 2_000, s, (v) => v / (1 + v * k));
    expect(misses(0.5)).toBeLessThan(misses(0));
    expect(misses(1)).toBeLessThan(misses(0.5));
    expect(misses(1.5)).toBeLessThan(misses(1));
  });
});

/** 2,000 ページの ISR の記事（閲覧の 60%）と画像の無い SSR（40%）。値はテスト用。 */
function workload(over: Partial<WorkloadInput['routes'][number]> = {}) {
  return {
    commercial: true,
    traffic: {
      mau: 1,
      dauPerMau: 1,
      sessionsPerDau: 1,
      pagesPerSession: 1,
      weekdayToWeekend: 1,
      peakHourFactor: 2,
      monthlyPageViewsOverride: 1_300_000,
    },
    routes: [
      {
        id: 'article',
        rendering: 'isr',
        share: 0.6,
        pages: 2_000,
        revalidateSeconds: 300,
        processing: {
          cpuMs: 10,
          ioWaitMs: 0,
          queries: 0,
          rowsReadPerQuery: 0,
          responseKB: 60,
        },
        ...over,
      },
      {
        id: 'personal',
        rendering: 'ssr',
        share: 0.4,
        pages: 1,
        processing: {
          cpuMs: 10,
          ioWaitMs: 0,
          queries: 0,
          rowsReadPerQuery: 0,
          responseKB: 60,
        },
      },
    ],
    perPage: { apiCalls: 0, assets: 0, images: 0 },
    api: {
      cpuMs: 0,
      ioWaitMs: 0,
      queries: 0,
      rowsReadPerQuery: 0,
      responseKB: 0,
      writesPerCall: 0,
      rowsWrittenPerWrite: 0,
    },
    assets: { sizeKB: 0, browserReuse: 0 },
    images: {
      sizeKB: 100,
      browserReuse: 0.2,
      thumbnails: { sizeKB: 10, browserReuse: 0.5 },
      distinct: 100,
      variants: 3,
      storedGB: 1,
      uploadsPerMau: 0,
      transformAt: 'upload',
    },
    db: { sizeGB: 0, responseKBPerQuery: 0 },
  } satisfies WorkloadInput;
}

describe('ISR のヒット率・再生成（D-121）', () => {
  it('偏りなしは今までの λT / (1 + λT)。偏り（指数 1）ではページごとの値を閲覧で重み付けした平均', () => {
    const views = 1_300_000 * 0.6;
    const lt = (views / 2_000) * (300 / MONTH);
    expect(
      resolveWorkload(workload()).cacheHitRate['document-isr'],
    ).toBeCloseTo(lt / (1 + lt), 12);
    const z = resolveWorkload(workload({ zipfExponent: 1 }));
    const misses = exact(views, 2_000, 1, (v) => v / (1 + (v * 300) / MONTH));
    expect(z.cacheHitRate['document-isr']).toBeCloseTo(1 - misses / views, 9);
    expect(z.classes['isr-revalidate'].count).toBeCloseTo(misses, 3);
    // ピークの時間帯は到着率が peakHourFactor 倍
    const peak = exact(views, 2_000, 1, (v) => v / (1 + (v * 2 * 300) / MONTH));
    expect(z.peakCacheHitRate['document-isr']).toBeCloseTo(1 - peak / views, 9);
    // 130 万 PV（記事 78 万閲覧・2,000 ページ・5 分）で、一様の 4% が 37% ほどに上がる
    expect(lt / (1 + lt)).toBeCloseTo(0.043, 3);
    expect(z.cacheHitRate['document-isr']).toBeCloseTo(0.367, 3);
  });

  it('オンデマンドの更新の分は偏りに依らず、まとめた無効化の分はページごとに足す', () => {
    const base = {
      revalidateSeconds: undefined,
      onDemandUpdatesPerMonth: 300,
    } as const;
    const u = resolveWorkload(workload(base));
    const z = resolveWorkload(workload({ ...base, zipfExponent: 1 }));
    expect(z.classes['isr-revalidate'].count).toBeCloseTo(
      u.classes['isr-revalidate'].count,
      9,
    );
    const views = 1_300_000 * 0.6;
    expect(z.cdnFlushMissFlow['document-isr']!.count).toBeCloseTo(
      exact(views, 2_000, 1, (v) => (300 * v) / (300 + v)),
      3,
    );
    expect(z.cdnFlushMissFlow['document-isr']!.count).toBeLessThan(
      u.cdnFlushMissFlow['document-isr']!.count,
    );
  });
});

describe('画像の本文とサムネイル（D-121）', () => {
  it('ルートの枚数で数え、ブラウザのキャッシュの分を引き、大きさの内訳を持つ', () => {
    const w = resolveWorkload(workload({ images: 5, thumbnails: 4 }));
    const views = 1_300_000 * 0.6;
    const body = views * 5 * 0.8;
    const thumbs = views * 4 * 0.5;
    const img = w.classes['image-read'];
    expect(img.count).toBeCloseTo(body + thumbs, 6);
    expect(img.count * img.perRequest.kb).toBeCloseTo(
      body * 100 + thumbs * 10,
      3,
    );
    expect(img.perRequest.kbMix).toEqual([
      { share: body / (body + thumbs), kb: 100 },
      { share: thumbs / (body + thumbs), kb: 10 },
    ]);
  });

  it('サムネイルを持たなければ今までどおり（PV × 1 PV の枚数 × (1 − 再利用)・1 種類の大きさ）', () => {
    const w0 = workload();
    const w = resolveWorkload({
      ...w0,
      perPage: { ...w0.perPage, images: 5 },
      images: { ...w0.images, thumbnails: undefined },
    });
    expect(w.classes['image-read'].count).toBeCloseTo(1_300_000 * 5 * 0.8, 6);
    expect(w.classes['image-read'].perRequest.kb).toBe(100);
  });

  it('投稿のときに作るサイズ違いの保存量は、1 つをサムネイルの大きさで数える', () => {
    const w = resolveWorkload(workload({ images: 5, thumbnails: 4 }));
    expect(w.storage.variantsGB).toBeCloseTo((100 * (2 * 100 + 10)) / 1e6, 12);
  });
});
