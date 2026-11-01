// 部品の選択（D-24・prd/07 §11）で足した振る舞い。値はすべて架空。
import { describe, expect, it } from 'vitest';
import type { ArchitectureInput } from '../architecture/schema.ts';
import { resolveWorkload } from '../workload/resolve.ts';
import type { WorkloadInput } from '../workload/schema.ts';
import { simulateResources } from './simulate.ts';

const processing = {
  cpuMs: 10,
  ioWaitMs: 30,
  queries: 2,
  rowsReadPerQuery: 5,
  responseKB: 50,
};

const workload = (extra: Partial<WorkloadInput> = {}): WorkloadInput => ({
  commercial: true,
  traffic: {
    mau: 1000,
    dauPerMau: 0.5,
    sessionsPerDau: 1,
    pagesPerSession: 2,
    weekdayToWeekend: 1,
    peakHourFactor: 2,
  },
  routes: [
    {
      id: 'article',
      rendering: 'isr',
      share: 0.5,
      pages: 100,
      revalidateSeconds: 60,
      processing,
      cachedServeCpuMs: 1,
    },
    { id: 'mypage', rendering: 'ssr', share: 0.5, pages: 1, processing },
  ],
  perPage: { apiCalls: 1, assets: 10, images: 4 },
  api: { ...processing, writesPerCall: 0.5, rowsWrittenPerWrite: 2 },
  assets: { sizeKB: 20, browserReuse: 0.5 },
  images: {
    sizeKB: 100,
    browserReuse: 0.5,
    distinct: 10,
    variants: 2,
    storedGB: 3,
    uploadsPerMau: 0.1,
  },
  db: { sizeGB: 1, responseKBPerQuery: 1 },
  realtime: {
    usersPerMau: 0.1,
    connectionsPerUser: 4,
    messagesPerUser: 40,
    processingMs: 5,
    historyRowsPerConnect: 20,
  },
  ...extra,
});

const w = resolveWorkload(workload());
const sim = (
  nodes: ArchitectureInput['nodes'],
  routes: ArchitectureInput['routes'],
) => simulateResources(w, { id: 'x', name: 'x', nodes, routes }).nodes;

describe('ISR のページを期間つきでキャッシュする CDN の後ろのホスト（D-55）', () => {
  const host = {
    id: 'vps',
    label: 'vps',
    config: {
      kind: 'host' as const,
      vcpu: 1,
      memoryGB: 1,
      diskGB: 100,
      lineMbps: 100,
      residentMemoryGB: 0,
      dbCpuMsPerQuery: 0,
      imageTransformCpuMs: 0,
    },
  };
  const cdn = {
    id: 'cdn',
    label: 'cdn',
    config: {
      kind: 'cdn' as const,
      hitRate: {},
      ttlClasses: ['document-isr' as const],
    },
  };
  const run = (behindCdn: boolean) =>
    simulateResources(w, {
      id: 'x',
      name: 'x',
      nodes: behindCdn ? [cdn, host] : [host],
      routes: {
        'document-isr': behindCdn ? ['cdn', 'vps'] : ['vps'],
        'isr-revalidate': ['vps'],
      },
    }).nodes.vps!;
  const SECONDS_PER_MONTH = 730 * 3600;
  const reval = w.classes['isr-revalidate'];

  it('月: 再生成は CDN を miss して届いた閲覧と同じ数（従来と同じ）', () => {
    const miss = w.cacheMissFlow['document-isr']!;
    expect(miss.count).toBeCloseTo(reval.count, 9);
    expect(run(true).resources.requests).toBeCloseTo(miss.count * 2, 6);
  });

  it('ピーク: 再生成はピークの miss の数になり、ホストの CPU が下がる（CDN が無ければ従来どおり）', () => {
    const pm = w.peakCacheMissFlow['document-isr']!;
    const peak = w.peakHourFactor / SECONDS_PER_MONTH;
    expect(pm.count).toBeLessThan(reval.count);
    expect(run(true).host!.peakCores).toBeCloseTo(
      ((pm.count * pm.perRequest.cpuMs + pm.count * reval.perRequest.cpuMs) /
        1000) *
        peak,
      12,
    );
    // CDN が無いホスト: 閲覧は全部届き、再生成は月の数のまま（既定の構成は変えない）
    const doc = w.classes['document-isr'];
    expect(run(false).host!.peakCores).toBeCloseTo(
      ((doc.count * doc.perRequest.cpuMs +
        reval.count * reval.perRequest.cpuMs) /
        1000) *
        peak,
      12,
    );
  });
});

describe('部品の選択で足した振る舞い', () => {
  it('サイズ違いを投稿のときに作ると、変換 = 投稿数 × サイズ違い。作らないなら 0', () => {
    const at = (transformAt: 'upload' | 'none') =>
      resolveWorkload(
        workload({ images: { ...workload().images, transformAt } }),
      ).classes['image-transform'].count;
    expect(at('upload')).toBeCloseTo(1000 * 0.1 * 2, 9);
    expect(at('none')).toBe(0);
  });

  it('リアルタイムが無ければ、そのクラスは 0 件（経路が無くても欠落にならない）', () => {
    const r = resolveWorkload(workload({ realtime: undefined }));
    expect(r.classes['realtime-connect'].count).toBe(0);
    expect(r.classes['realtime-message'].count).toBe(0);
  });

  it('KV を DB の代わりにすると、問い合わせを読み取り、行の書き込みを書き込みに数える', () => {
    const u = sim(
      [{ id: 'kv', label: 'kv', config: { kind: 'kv', mode: 'db' } }],
      { api: ['kv'] },
    ).kv!;
    const api = w.classes.api;
    expect(u.resources['kv-reads']).toBe(api.count * api.perRequest.queries);
    expect(u.resources['kv-writes']).toBe(
      api.count * api.perRequest.rowsWritten,
    );
  });

  it('画像を SQL に置くと、保存量に画像が足され、1 枚 1 行で数える', () => {
    const u = sim(
      [
        {
          id: 'd1',
          label: 'd1',
          config: { kind: 'sql-db', storesImages: true },
        },
      ],
      { 'image-read': ['d1'] },
    ).d1!;
    expect(u.resources['storage-gb-month']).toBe(1 + 3);
    expect(u.resources['rows-read']).toBe(w.classes['image-read'].count);
  });

  it('オブジェクトストレージを ISR のキャッシュにすると、再生成は書き込み。画像を置かなければ保存量は 0', () => {
    const u = sim(
      [
        {
          id: 'r2',
          label: 'r2',
          config: { kind: 'object-storage', storesImages: false },
        },
      ],
      { 'isr-revalidate': ['r2'], 'document-isr': ['r2'] },
    ).r2!;
    expect(u.resources['object-writes']).toBe(
      w.classes['isr-revalidate'].count,
    );
    expect(u.resources['object-reads']).toBe(w.classes['document-isr'].count);
    expect(u.resources['storage-gb-month']).toBeUndefined();
  });

  it('事業者の CDN が配信するオブジェクトストレージ（Vercel Blob 型）: 転送とリクエストはヒットも含む全件、操作と origin は miss だけ（OCL-2AE853BD）', () => {
    const u = sim(
      [
        {
          id: 'blob',
          label: 'blob',
          config: { kind: 'object-storage', cdnHitRate: 0.9 },
        },
      ],
      { 'image-read': ['blob'] },
    ).blob!;
    const reads = w.classes['image-read'];
    const gb = (reads.count * reads.perRequest.kb) / 1e6; // 1 KB = 1,000 バイト（num/unit）
    expect(u.resources.requests).toBe(reads.count);
    expect(u.resources['egress-gb']).toBeCloseTo(gb, 9);
    expect(u.resources['object-reads']).toBeCloseTo(reads.count * 0.1, 9);
    expect(u.resources['origin-transfer-gb']).toBeCloseTo(gb * 0.1, 9);
  });

  it('DB のプロキシは問い合わせの件数を数える', () => {
    const u = sim([{ id: 'p', label: 'p', config: { kind: 'db-proxy' } }], {
      api: ['p'],
    }).p!;
    expect(u.resources.queries).toBe(w.classes.api.count * 2);
  });

  it('Durable Objects 型: 受信メッセージは N 件で 1 リクエスト、実行時間は処理の間だけ', () => {
    const u = sim(
      [
        {
          id: 'do',
          label: 'do',
          config: {
            kind: 'durable-object',
            messagesPerRequest: 20,
            memoryGB: 0.128,
          },
        },
      ],
      { 'realtime-connect': ['do'], 'realtime-message': ['do'] },
    ).do!;
    const users = 1000 * 0.1;
    expect(u.resources.requests).toBeCloseTo(users * 4 + (users * 40) / 20, 9);
    expect(u.resources['gb-seconds']).toBeCloseTo(
      users * 40 * 0.005 * 0.128,
      9,
    );
    expect(u.resources['rows-written']).toBeCloseTo(users * 40, 9);
    expect(u.resources['rows-read']).toBeCloseTo(users * 4 * 20, 9);
  });
});
