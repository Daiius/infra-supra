// 部品の選択（D-24・prd/07 §11）で足した振る舞い。値はすべて架空。
import { describe, expect, it } from 'vitest';
import type { ArchitectureInput } from '../architecture/schema.ts';
import { resolveWorkload, timeBuckets } from '../workload/resolve.ts';
import type { WorkloadInput } from '../workload/schema.ts';
import { pausingDbShares, simulateResources } from './simulate.ts';

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
  const run = (behindCdn: boolean, rw = w) =>
    simulateResources(rw, {
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

  it('ピーク: 密度と処理の重さが違う ISR のルートが複数あると、再生成の処理もルートごとのピークの miss で重み付けする（OCL-55732091）', () => {
    const route = (
      id: string,
      share: number,
      pages: number,
      cpuMs: number,
    ) => ({
      id,
      rendering: 'isr' as const,
      share,
      pages,
      revalidateSeconds: 600,
      processing: { ...processing, cpuMs },
      cachedServeCpuMs: 1,
    });
    const multi = resolveWorkload(
      workload({
        routes: [
          route('hot', 0.4, 5, 40),
          route('cold', 0.4, 2_000, 4),
          { id: 'mypage', rendering: 'ssr', share: 0.2, pages: 1, processing },
        ],
      }),
    );
    const pv = multi.monthlyPageViews;
    const T = 600 / SECONDS_PER_MONTH;
    const p = multi.peakHourFactor;
    const peakMiss = (share: number, pages: number) =>
      (pv * share) / (1 + ((pv * share) / pages) * T * p);
    const hot = peakMiss(0.4, 5);
    const cold = peakMiss(0.4, 2_000);
    expect(multi.peakRevalidateFlow.count).toBeCloseTo(hot + cold, 6);
    expect(multi.peakRevalidateFlow.perRequest.cpuMs).toBeCloseTo(
      (hot * 40 + cold * 4) / (hot + cold),
      9,
    );
    // 月の平均で重み付けした処理とは違う（ピークは閲覧の濃い hot がよく当たって、軽い cold の比が上がる）
    expect(multi.peakRevalidateFlow.perRequest.cpuMs).not.toBeCloseTo(
      multi.classes['isr-revalidate'].perRequest.cpuMs,
      3,
    );
    const pm = multi.peakCacheMissFlow['document-isr']!;
    expect(run(true, multi).host!.peakCores).toBeCloseTo(
      ((pm.count * pm.perRequest.cpuMs + hot * 40 + cold * 4) / 1000) *
        (p / SECONDS_PER_MONTH),
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

  it('要求の単位で課金する DB: 読み取りは応答を単位で切り上げ（結果整合は半分）、書き込みは 1 行を単位で切り上げ（AX-05）', () => {
    const node = (eventuallyConsistent: boolean) => ({
      id: 'd',
      label: 'd',
      config: {
        kind: 'request-db' as const,
        readUnitKB: 4,
        writeUnitKB: 1,
        eventuallyConsistent,
        itemKB: 1.5,
      },
    });
    const api = w.classes.api;
    // 応答 1 KB → 4 KB の 1 単位。問い合わせ 2 回。書き込みは 1 行 1.5 KB → 2 単位
    const strong = sim([node(false)], { api: ['d'] }).d!;
    expect(strong.resources['read-request-units']).toBeCloseTo(
      api.count * 2,
      9,
    );
    expect(strong.resources['write-request-units']).toBeCloseTo(
      api.count * api.perRequest.rowsWritten * 2,
      9,
    );
    const eventual = sim([node(true)], { api: ['d'] }).d!;
    expect(eventual.resources['read-request-units']).toBeCloseTo(api.count, 9);
    // 保存量はアプリの DB の大きさ（時間課金のコンピュートは無い）
    expect(eventual.resources['storage-gb-month']).toBe(w.storage.dbGB);
    expect(eventual.resources['instance-hours']).toBeUndefined();
  });

  it('要求の単位で課金する DB: 応答が 0 KB でも問い合わせ 1 回に 1 単位（OCL-0E5E2CF2）', () => {
    const w0 = resolveWorkload(
      workload({ db: { sizeGB: 1, responseKBPerQuery: 0 } }),
    );
    const u = simulateResources(w0, {
      id: 'x',
      name: 'x',
      nodes: [
        {
          id: 'd',
          label: 'd',
          config: {
            kind: 'request-db',
            readUnitKB: 4,
            writeUnitKB: 1,
            eventuallyConsistent: false,
            itemKB: 1,
          },
        },
      ],
      routes: { api: ['d'] },
    }).nodes.d!;
    expect(u.resources['read-request-units']).toBeCloseTo(
      w0.classes.api.count * 2,
      9,
    );
  });

  it('リクエストを大きさの単位で数える CDN: 1 件は最低 1、超えた分は単位で切り上げ。次へ渡す件数は変わらない（OCL-70ABEDB7）', () => {
    const u = sim(
      [
        {
          id: 'g',
          label: 'g',
          config: { kind: 'cdn', hitRate: {}, requestUnitKB: 30 },
        },
        { id: 'p', label: 'p', config: { kind: 'db-proxy' } },
      ],
      { api: ['g', 'p'] },
    );
    const api = w.classes.api;
    expect(u.g!.resources.requests).toBeCloseTo(
      api.count * Math.max(1, Math.ceil(api.perRequest.kb / 30)),
      9,
    );
    expect(u.p!.resources.queries).toBeCloseTo(api.count * 2, 9);
  });

  it('大きさの単位で数える CDN は、ルートごとの大きさで切り上げてから足す（平均で切り上げない。OCL-663E589C）', () => {
    const w2 = resolveWorkload(
      workload({
        routes: [
          {
            id: 'small',
            rendering: 'ssr',
            share: 0.5,
            pages: 1,
            processing: { ...processing, responseKB: 50 },
          },
          {
            id: 'large',
            rendering: 'ssr',
            share: 0.5,
            pages: 1,
            processing: { ...processing, responseKB: 900 },
          },
        ],
      }),
    );
    const ssr = w2.classes['document-ssr'];
    // 平均（約 475 KB）で切り上げると 1 件 1 だが、ルートごとなら 1 と 2 で平均 1.5
    expect(Math.ceil(ssr.perRequest.kb / 512)).toBe(1);
    const u = simulateResources(w2, {
      id: 'x',
      name: 'x',
      nodes: [
        {
          id: 'g',
          label: 'g',
          config: { kind: 'cdn', hitRate: {}, requestUnitKB: 512 },
        },
      ],
      routes: { 'document-ssr': ['g'] },
    }).nodes.g!;
    expect(u.resources.requests).toBeCloseTo(ssr.count * 1.5, 6);
  });

  it('1 件を N リクエストと数える CDN（SQS の送信・受信・削除）と、クラスの処理の時間を関数で決める（D-63）', () => {
    const u = sim(
      [
        {
          id: 'q',
          label: 'q',
          config: { kind: 'cdn', hitRate: {}, requestsPerItem: 3 },
        },
        {
          id: 'f',
          label: 'f',
          config: {
            kind: 'function',
            memoryGB: 1,
            classCpuMs: { api: 150 },
          },
        },
      ],
      { api: ['q', 'f'] },
    );
    const n = w.classes.api.count;
    expect(u.q!.resources.requests).toBeCloseTo(n * 3, 9);
    expect(u.f!.resources.invocations).toBeCloseTo(n, 9);
    expect(u.f!.resources['cpu-ms']).toBeCloseTo(n * 150, 6);
    expect(u.f!.resources['memory-gb-hours']).toBeCloseTo(
      (n * 150) / 3_600_000,
      9,
    );
  });

  it('画像の変換の時間は、画像の形式による重さの倍率を掛ける（OCL-ECDEF8A1）', () => {
    const at = (transformWorkFactor: number) =>
      simulateResources(
        resolveWorkload(
          workload({ images: { ...workload().images, transformWorkFactor } }),
        ),
        {
          id: 'x',
          name: 'x',
          nodes: [
            {
              id: 'f',
              label: 'f',
              config: {
                kind: 'function',
                memoryGB: 1,
                classCpuMs: { 'image-read': 150, api: 10 },
              },
            },
          ],
          routes: { 'image-read': ['f'], api: ['f'] },
        },
      ).nodes.f!.resources['cpu-ms']!;
    const reads = w.classes['image-read'].count;
    expect(at(1.5) - at(1)).toBeCloseTo(reads * 75, 3);
  });

  it('止まる DB: 動いている割合は λT / (1 + λT)、時間課金は容量の単位の数を掛ける。止まらない DB は 730 時間', () => {
    const node = (pauseAfterIdleSeconds?: number) => ({
      id: 'a',
      label: 'a',
      config: {
        kind: 'managed-db' as const,
        capacityUnits: 0.5,
        ...(pauseAfterIdleSeconds ? { pauseAfterIdleSeconds } : {}),
      },
    });
    const always = sim([node()], { api: ['a'] }).a!;
    expect(always.resources['instance-hours']).toBeCloseTo(730 * 0.5, 9);
    expect(always.awakeShare).toBeUndefined();
    const paused = sim([node(300)], { api: ['a'] }).a!;
    const lt = (w.classes.api.count / (730 * 3600)) * 300;
    expect(paused.awakeShare).toBeCloseTo(lt / (1 + lt), 12);
    expect(paused.resumeShare).toBeCloseTo(1 / (1 + lt), 12);
    expect(always.resumeShare).toBeUndefined();
    expect(paused.resources['instance-hours']).toBeCloseTo(
      730 * 0.5 * (lt / (1 + lt)),
      9,
    );
  });

  it('コンテナのサービス（Cloud Run 型・D-88）: アクティブな時間は 1 − e^(−x)・同時実行・CPU の大きい方、最小インスタンスは待機を課金し冷えた起動を 0 に', () => {
    const S = 730 * 3600;
    const node = (extra: Record<string, unknown> = {}) => ({
      id: 'r',
      label: 'r',
      config: {
        kind: 'container' as const,
        vcpu: 1,
        memoryGB: 0.5,
        concurrency: 80,
        ...extra,
      },
    });
    const n = w.classes.api.count;
    const p = w.classes.api.perRequest;
    const x = (n * p.wallMs) / 1000 / S;
    const u = sim([node()], { api: ['r'] }).r!;
    const active = Math.max(-Math.expm1(-x), x / 80, (n * p.cpuMs) / 1000 / S);
    expect(u.activeInstanceShare).toBeCloseTo(active, 12);
    expect(u.resources['cpu-hours']).toBeCloseTo((active * S) / 3600, 9);
    expect(u.resources['memory-gb-hours']).toBeCloseTo(
      ((active * S) / 3600) * 0.5,
      9,
    );
    expect(u.resources.requests).toBeCloseTo(n, 9);
    expect(u.resources['idle-cpu-hours']).toBeUndefined();
    // 薄い到着: 同時に重ならないので、アクティブな時間 ≒ 壁時計時間の合計（同時実行で割らない）
    expect(u.resources['cpu-hours']!).toBeLessThanOrEqual(
      (n * p.wallMs) / 3_600_000 + 1e-9,
    );
    expect(u.resources['cpu-hours']!).toBeGreaterThan(
      (n * p.wallMs) / 3_600_000 / 80,
    );
    expect(u.coldStartShare).toBeCloseTo(Math.exp(-(n / S) * 900), 12);
    // 最小インスタンス 1: 月の残りを待機で課金し、冷えた起動は 0
    const warm = sim([node({ minInstances: 1 })], { api: ['r'] }).r!;
    expect(warm.resources['cpu-hours']).toBeCloseTo(
      u.resources['cpu-hours']!,
      9,
    );
    expect(warm.resources['idle-cpu-hours']).toBeCloseTo(
      730 - u.resources['cpu-hours']!,
      9,
    );
    expect(warm.resources['idle-memory-gb-hours']).toBeCloseTo(
      (730 - u.resources['cpu-hours']!) * 0.5,
      9,
    );
    expect(warm.coldStartShare).toBe(0);
    // CPU を使い切る重い処理: CPU 秒 / vCPU が下限になる
    const heavy = sim([node({ vcpu: 0.25, classCpuMs: { api: 5_000 } })], {
      api: ['r'],
    }).r!;
    expect(heavy.activeInstanceShare).toBeGreaterThanOrEqual(
      (n * 5) / S / 0.25 - 1e-12,
    );
  });

  describe('1 日の時間帯の形（D-89）', () => {
    const node = (extra: Record<string, unknown> = {}) => ({
      id: 'r',
      label: 'r',
      config: {
        kind: 'container' as const,
        vcpu: 1,
        memoryGB: 0.5,
        concurrency: 80,
        ...extra,
      },
    });
    const withProfile = (
      hourlyProfile: number[] | undefined,
      weekdayToWeekend = 1,
      mau = 1000,
    ) => {
      const base = workload();
      return resolveWorkload({
        ...base,
        traffic: {
          ...base.traffic,
          mau,
          weekdayToWeekend,
          ...(hourlyProfile ? { hourlyProfile } : {}),
        },
      });
    };
    const run = (rw: ReturnType<typeof resolveWorkload>, extra = {}) =>
      simulateResources(rw, {
        id: 'x',
        name: 'x',
        nodes: [node(extra)],
        routes: { api: ['r'] },
      }).nodes.r!;
    const office = Array.from({ length: 24 }, (_, h) =>
      h >= 9 && h < 18 ? 3 : h >= 7 && h < 21 ? 0.5 : 0,
    );

    it('区間の割合の和は 1・時間の和は 730。形が無ければ月全体の 1 区間', () => {
      for (const r of [1, 1.3, 8]) {
        const b = timeBuckets(r, office);
        expect(b).toHaveLength(48);
        expect(b.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
        expect(b.reduce((a, x) => a + x.hours, 0)).toBeCloseTo(730, 9);
        // 平日 5 日の量 / 休日 2 日の量 = 5r / 2（1 日あたりの比が r）
        const wd = b.slice(0, 24).reduce((a, x) => a + x.share, 0);
        expect(wd / (1 - wd)).toBeCloseTo((5 * r) / 2, 12);
      }
      expect(timeBuckets(8, undefined)).toEqual([{ share: 1, hours: 730 }]);
      // 重みの大きさは問わない（比だけ）
      expect(
        timeBuckets(
          2,
          office.map((v) => v * 7),
        ),
      ).toEqual(
        timeBuckets(2, office).map((x) => ({
          ...x,
          share: expect.closeTo(x.share, 12),
        })),
      );
    });

    it('平らな形・平日と休日が同じなら、月の平均の式（D-88）と一致する', () => {
      const flat = Array.from({ length: 24 }, () => 1);
      for (const extra of [{}, { minInstances: 1 }]) {
        const a = run(withProfile(undefined), extra);
        const b = run(withProfile(flat), extra);
        expect(b.coldStartShare).toBeCloseTo(a.coldStartShare!, 12);
        expect(b.activeInstanceShare).toBeCloseTo(a.activeInstanceShare!, 12);
        for (const k of [
          'cpu-hours',
          'memory-gb-hours',
          'idle-cpu-hours',
          'idle-memory-gb-hours',
        ] as const)
          expect(b.resources[k] ?? 0).toBeCloseTo(a.resources[k] ?? 0, 9);
      }
    });

    it('冷えた起動は区間ごとの e^(−λ_h × 900) を件数の割合で重みづけして足す。夜間 0 の偏りで月の平均より増える', () => {
      const rw = withProfile(office, 8);
      const u = run(rw);
      const n = rw.classes.api.count;
      const expected = timeBuckets(8, office).reduce(
        (a, b) =>
          a + b.share * Math.exp(-((n * b.share) / (b.hours * 3600)) * 900),
        0,
      );
      expect(u.coldStartShare).toBeCloseTo(expected, 12);
      const flat = run(withProfile(undefined, 8));
      expect(u.coldStartShare!).toBeGreaterThan(flat.coldStartShare!);
      // 重み 0 の時間帯（深夜）は件数が無いので、冷えた起動の割合に入らない（1 を超えない）
      expect(u.coldStartShare!).toBeLessThanOrEqual(1);
      // 最小インスタンス 1 なら時間帯によらず 0
      expect(run(rw, { minInstances: 1 }).coldStartShare).toBe(0);
    });

    it('冷えた起動の境目: 到着率が下がるほど増え、薄いと 1 に近づき、濃いと 0 に近づく', () => {
      const shares = [1, 100, 1_000, 10_000, 1_000_000].map(
        (mau) => run(withProfile(office, 8, mau)).coldStartShare!,
      );
      for (let i = 1; i < shares.length; i++)
        expect(shares[i]!).toBeLessThan(shares[i - 1]!);
      expect(shares[0]!).toBeGreaterThan(0.9);
      expect(shares[4]!).toBeLessThan(1e-6);
    });

    it('アクティブな時間・待機は区間ごとに積む（1 − e^(−x) が凹なので月の平均より少なく、待機はその分多い）', () => {
      const rw = withProfile(office, 8, 200_000);
      const u = run(rw, { minInstances: 1 });
      const flat = run(withProfile(undefined, 8, 200_000), { minInstances: 1 });
      expect(u.resources['cpu-hours']!).toBeLessThan(
        flat.resources['cpu-hours']!,
      );
      const busy = u.busyMs / 1000;
      const cpu = u.resources['cpu-ms']! / 1000;
      let active = 0;
      let idle = 0;
      for (const b of timeBuckets(8, office)) {
        const s = b.hours * 3600;
        const x = (busy * b.share) / s;
        const a = Math.max(-Math.expm1(-x), x / 80, (cpu * b.share) / s);
        active += a * b.hours;
        idle += Math.max(0, 1 - a) * b.hours;
      }
      expect(u.resources['cpu-hours']).toBeCloseTo(active, 9);
      expect(u.resources['idle-cpu-hours']).toBeCloseTo(idle, 9);
      expect(u.activeInstanceShare).toBeCloseTo(active / 730, 12);
    });

    describe('止まる DB を時間帯で数える（D-90）', () => {
      const db = (pauseAfterIdleSeconds = 300) => ({
        id: 'a',
        label: 'a',
        config: {
          kind: 'managed-db' as const,
          capacityUnits: 0.5,
          pauseAfterIdleSeconds,
        },
      });
      const runDb = (rw: ReturnType<typeof resolveWorkload>, t = 300) =>
        simulateResources(rw, {
          id: 'x',
          name: 'x',
          nodes: [db(t)],
          routes: { api: ['a'] },
        }).nodes.a!;

      /**
       * 総当たり: 平日・休日の 1 日をそれぞれ 24 時間の繰り返しとみて、時刻 t に止まっている確率 e^(−∫_{t−W}^{t} λ) を
       * 1 秒ごとに平均する（区間の頭の混ざりを式でなく数値で出す）。
       */
      const brute = (
        n: number,
        busyMs: number,
        t: number,
        profile: number[],
        r: number,
      ) => {
        const w = t + busyMs / 1000 / n;
        const b = timeBuckets(r, profile);
        let awakeH = 0;
        let resume = 0;
        for (let d = 0; d < 2; d++) {
          const rate = (h: number) => {
            const x = b[d * 24 + (((h % 24) + 24) % 24)]!;
            return (n * x.share) / (x.hours * 3600);
          };
          // ∫_{s}^{e} λ（区間の中は一定）
          const integral = (s: number, e: number) => {
            let acc = 0;
            for (let x = s; x < e;) {
              const h = Math.floor(x / 3600);
              const next = Math.min(e, (h + 1) * 3600);
              acc += rate(h) * (next - x);
              x = next;
            }
            return acc;
          };
          let asleepSum = 0;
          let resumeSum = 0;
          let rateSum = 0;
          for (let x = 0.5; x < 86400; x += 1) {
            const asleep = Math.exp(-integral(x - w, x));
            const l = rate(Math.floor(x / 3600));
            asleepSum += asleep;
            resumeSum += l * asleep;
            rateSum += l;
          }
          const hours = b
            .slice(d * 24, d * 24 + 24)
            .reduce((a, x) => a + x.hours, 0);
          const share = b
            .slice(d * 24, d * 24 + 24)
            .reduce((a, x) => a + x.share, 0);
          awakeH += (1 - asleepSum / 86400) * hours;
          resume += rateSum > 0 ? (share * resumeSum) / rateSum : 0;
        }
        return { awake: awakeH / 730, resume };
      };

      it('形が無ければ月の平均の式（D-51 の λT / (1 + λT)）のまま', () => {
        const rw = withProfile(undefined, 8, 3_000);
        const u = runDb(rw);
        const lt = (rw.classes.api.count / (730 * 3600)) * 300;
        expect(u.awakeShare).toBeCloseTo(lt / (1 + lt), 12);
        expect(u.resumeShare).toBeCloseTo(1 / (1 + lt), 12);
        expect(u.resources['instance-hours']).toBeCloseTo(
          730 * 0.5 * (lt / (1 + lt)),
          9,
        );
      });

      it('形があれば区間ごとに e^(−λ_b × W)（W = 待ち + 1 件の処理の時間）を積み、区間の頭は直前の時間帯と混ぜる（総当たりと一致）', () => {
        for (const [mau, r] of [
          [30, 8],
          [3_000, 8],
          [300_000, 1.3],
        ] as const) {
          const rw = withProfile(office, r, mau);
          const u = runDb(rw);
          const n = rw.classes.api.count;
          const want = brute(n, u.busyMs, 300, office, r);
          expect(u.awakeShare!).toBeCloseTo(want.awake, 5);
          expect(u.resumeShare!).toBeCloseTo(want.resume, 5);
          expect(u.resources['instance-hours']).toBeCloseTo(
            730 * 0.5 * u.awakeShare!,
            9,
          );
        }
      });

      it('深夜に届かない形では、その時間帯は（頭の待ちの分を除いて）止まり、月の平均の式より安い', () => {
        // 9〜18 時だけ届く業務の形・閲覧が多く日中は止まらない
        const rw = withProfile(office, 8, 300_000);
        const u = runDb(rw);
        const flat = runDb(withProfile(undefined, 8, 300_000));
        expect(flat.awakeShare!).toBeGreaterThan(0.99);
        // 届く時間帯は平日 7〜21 時の 14 時間・休日も同じ形。止まらない時間は 14 / 24 + 区間の頭の待ち（1 日に 1 回・最大 300 秒）
        expect(u.awakeShare!).toBeGreaterThan(14 / 24);
        expect(u.awakeShare!).toBeLessThan(14 / 24 + 300 / 86400 + 1e-3);
        // 夜間に止まった DB を朝の 1 件目が起こす。件数の割合はごく小さい
        expect(u.resumeShare!).toBeGreaterThan(0);
        expect(u.resumeShare!).toBeLessThan(1e-3);
      });

      it('到着率が上がるほど動いている割合は増え、待ちが長いほど増える（0〜1）', () => {
        const awake = [1, 30, 1_000, 30_000, 1_000_000].map(
          (mau) => runDb(withProfile(office, 8, mau)).awakeShare!,
        );
        for (let i = 1; i < awake.length; i++)
          expect(awake[i]!).toBeGreaterThan(awake[i - 1]!);
        expect(awake[0]!).toBeGreaterThanOrEqual(0);
        expect(awake[4]!).toBeLessThanOrEqual(1);
        const rw = withProfile(office, 8, 3_000);
        expect(runDb(rw, 900).awakeShare!).toBeGreaterThan(
          runDb(rw, 300).awakeShare!,
        );
      });

      it('待ちが時間帯の長さ（1 時間）以上でも、2 つ以上前の時間帯までたどって窓の到着を数える（総当たりと一致。OCL-C6476435）', () => {
        for (const t of [3_600, 5_000, 7_200, 30_000, 86_400]) {
          const got = pausingDbShares(10_000, 0, t, timeBuckets(1, office));
          const want = brute(10_000, 0, t, office, 1);
          expect(got.awake).toBeCloseTo(want.awake, 5);
          expect(got.resume).toBeCloseTo(want.resume, 5);
        }
        // 12 時台にだけ届く（毎日十分多く）・待ち 7,200 秒: 最後の要求（13 時の直前）から約 2 時間動き、1 日に約 3 時間
        const spike = Array.from({ length: 24 }, (_, h) => (h === 12 ? 1 : 0));
        const r = pausingDbShares(1e6, 0, 7_200, timeBuckets(1, spike));
        expect(r.awake).toBeCloseTo(3 / 24, 3);
        expect(r.awake).toBeCloseTo(brute(1e6, 0, 7_200, spike, 1).awake, 5);
      });

      it('桁あふれしない（直前が濃く今が 0・その逆）', () => {
        const spike = Array.from({ length: 24 }, (_, h) => (h === 12 ? 1 : 0));
        for (const n of [1e3, 1e9, 1e12]) {
          const r = pausingDbShares(n, 0, 300, timeBuckets(1, spike));
          expect(Number.isFinite(r.awake)).toBe(true);
          expect(r.awake).toBeGreaterThan(0);
          expect(r.awake).toBeLessThanOrEqual(1);
          expect(r.resume).toBeGreaterThanOrEqual(0);
          expect(r.resume).toBeLessThanOrEqual(1);
        }
      });
    });
  });

  it('処理の量で課金する DB: 届いた 1 件を決まった単位で数える', () => {
    const u = sim(
      [
        {
          id: 'q',
          label: 'q',
          config: { kind: 'processing-db', unitsPerRequest: 0.14 },
        },
      ],
      { api: ['q'] },
    ).q!;
    expect(u.resources['processing-units']).toBeCloseTo(
      w.classes.api.count * 0.14,
      9,
    );
    expect(u.resources['storage-gb-month']).toBe(w.storage.dbGB);
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

describe('OpenNext の CloudFront の無効化と S3 の ISR のキャッシュ（D-66）', () => {
  const onDemand = resolveWorkload(
    workload({
      routes: [
        {
          id: 'article',
          rendering: 'isr',
          share: 0.5,
          pages: 100,
          onDemandUpdatesPerMonth: 300,
          onDemandPagesPerUpdate: 2,
          processing,
          cachedServeCpuMs: 1,
        },
        { id: 'mypage', rendering: 'ssr', share: 0.5, pages: 1, processing },
      ],
    }),
  );
  const cdn = (ttl: boolean) => ({
    id: 'cf',
    label: 'cf',
    config: {
      kind: 'cdn' as const,
      invalidationPathsPerPage: 2,
      ...(ttl ? { ttlClasses: ['document-isr' as const] } : {}),
    },
  });
  const run = (wl: typeof w, ttl: boolean) =>
    simulateResources(wl, {
      id: 'x',
      name: 'x',
      nodes: [cdn(ttl)],
      routes: { 'document-isr': ['cf'] },
    }).nodes.cf!;

  it('オンデマンドの更新 × 1 回で再検証するページ × 1 ページのパスを数える', () => {
    expect(run(onDemand, true).resources['invalidation-paths']).toBe(
      300 * 2 * 2,
    );
  });

  it('ISR のページをキャッシュしない CDN・時間の再検証では数えない', () => {
    expect(
      run(onDemand, false).resources['invalidation-paths'],
    ).toBeUndefined();
    expect(run(w, true).resources['invalidation-paths']).toBeUndefined();
  });

  it('ワイルドカードでまとめる（D-79）: パスは更新 × 更新あたりのパス、CDN の外れは全ページが更新のたびに消える分に増え、再生成は変わらない', () => {
    const wildcard = simulateResources(onDemand, {
      id: 'x',
      name: 'x',
      nodes: [
        {
          id: 'cf',
          label: 'cf',
          config: {
            kind: 'cdn',
            invalidationWildcardPathsPerUpdate: 1,
            ttlClasses: ['document-isr'],
          },
        },
        {
          id: 'fn',
          label: 'fn',
          config: { kind: 'function', memoryGB: 1, concurrency: 1 },
        },
      ],
      routes: { 'document-isr': ['cf', 'fn'], 'isr-revalidate': ['fn'] },
    });
    expect(wildcard.nodes.cf!.resources['invalidation-paths']).toBe(300);
    const views = onDemand.classes['document-isr'].count;
    const perPage = views / 100;
    // ページあたり 更新 300 × 閲覧 / (300 + 閲覧)。最大寿命は無い
    const flush = Math.min(views, (100 * 300 * perPage) / (300 + perPage));
    expect(onDemand.cdnFlushMissFlow['document-isr']!.count).toBeCloseTo(
      flush,
      6,
    );
    expect(flush).toBeGreaterThan(
      onDemand.cacheMissFlow['document-isr']!.count,
    );
    // 関数に届く件数 = CDN の外れ（ワイルドカード）+ 再生成（ページごとと同じ）
    expect(wildcard.nodes.fn!.resources.requests).toBeCloseTo(
      flush + onDemand.classes['isr-revalidate'].count,
      6,
    );
  });

  it('ワイルドカードで消えるのは ISR のページだけで、同じ CDN の API の応答のキャッシュは従来の miss のまま（OCL-62E7477C）', () => {
    const mixed = resolveWorkload(
      workload({
        routes: [
          {
            id: 'article',
            rendering: 'isr',
            share: 0.5,
            pages: 100,
            onDemandUpdatesPerMonth: 300,
            processing,
            cachedServeCpuMs: 1,
          },
          {
            id: 'feed',
            rendering: 'spa',
            share: 0.5,
            pages: 100,
            processing,
            shellKB: 3,
            cacheSeconds: 300,
          },
        ],
      }),
    );
    const out = (wildcard: boolean) =>
      simulateResources(mixed, {
        id: 'x',
        name: 'x',
        nodes: [
          {
            id: 'cf',
            label: 'cf',
            config: {
              kind: 'cdn',
              ...(wildcard
                ? { invalidationWildcardPathsPerUpdate: 1 }
                : { invalidationPathsPerPage: 2 }),
              ttlClasses: ['document-isr', 'api-content'],
            },
          },
          {
            id: 'api',
            label: 'api',
            config: { kind: 'function', memoryGB: 1, concurrency: 1 },
          },
        ],
        routes: { 'api-content': ['cf', 'api'] },
      }).nodes.api!.resources.requests;
    expect(mixed.cacheMissFlow['api-content']!.count).toBeGreaterThan(0);
    expect(out(true)).toBeCloseTo(mixed.cacheMissFlow['api-content']!.count, 6);
    expect(out(true)).toBeCloseTo(out(false)!, 6);
  });

  it('ISR のキャッシュを置くストレージは ISR のページの大きさ × 倍率を保存する（画像は載せない）', () => {
    const u = simulateResources(w, {
      id: 'x',
      name: 'x',
      nodes: [
        {
          id: 's3',
          label: 's3',
          config: {
            kind: 'object-storage',
            storesImages: false,
            isrCacheSizeFactor: 2,
          },
        },
      ],
      routes: { 'isr-revalidate': ['s3'] },
    }).nodes.s3!;
    expect(u.resources['storage-gb-month']).toBeCloseTo(
      ((100 * 50) / 1_000_000) * 2,
      12,
    );
  });
});

describe('サーバーから外の API への問い合わせ・API だけを置くホスト（D-67）', () => {
  it('egressKBPerRequest: 転送は応答の大きさでなく 1 件の固定の KB で数え、流れはそのまま次へ渡す', () => {
    const n = sim(
      [
        {
          id: 'out',
          label: 'out',
          config: { kind: 'cdn', hitRate: {}, egressKBPerRequest: 1 },
        },
        { id: 'fn', label: 'fn', config: { kind: 'function' } },
      ],
      { 'document-ssr': ['out', 'fn'] },
    );
    const count = w.classes['document-ssr'].count;
    expect(n.out!.resources['egress-gb']).toBeCloseTo((count * 1000) / 1e9);
    expect(n.fn!.resources.requests).toBeCloseTo(count);
  });

  it('storesImages: false のホストはディスクに画像を数えない（DB と他だけ）', () => {
    const host = (storesImages: boolean) =>
      sim(
        [
          {
            id: 'vps',
            label: 'vps',
            config: {
              kind: 'host',
              vcpu: 1,
              memoryGB: 1,
              diskGB: 100,
              lineMbps: 100,
              residentMemoryGB: 0,
              dbCpuMsPerQuery: 0,
              imageTransformCpuMs: 0,
              otherDiskGB: 5,
              storesImages,
            },
          },
        ],
        { api: ['vps'] },
      ).vps!.host!.diskGB;
    expect(host(false)).toBeCloseTo(w.storage.dbGB + 5);
    expect(host(true)).toBeCloseTo(
      w.storage.dbGB + w.storage.imagesGB + w.storage.variantsGB + 5,
    );
  });
});

describe('実行ごとのログ（D-92）', () => {
  it('関数・コンテナは前景の実行 1 回ごとに KB と件数を数え、裏で走るクラスは数えない。logs が無ければ 0', () => {
    const logs = { kbPerInvocation: 0.5, eventsPerInvocation: 2 };
    const u = sim(
      [
        {
          id: 'f',
          label: 'f',
          config: {
            kind: 'function',
            backgroundClasses: ['isr-revalidate'],
            logs,
          },
        },
        {
          id: 'c',
          label: 'c',
          config: { kind: 'container', vcpu: 1, memoryGB: 1, logs },
        },
        { id: 'plain', label: 'plain', config: { kind: 'function' } },
      ],
      {
        'document-isr': ['f'],
        'isr-revalidate': ['f'],
        api: ['c', 'plain'],
      },
    );
    const isr = w.classes['document-isr'].count;
    expect(w.classes['isr-revalidate'].count).toBeGreaterThan(0);
    expect(u.f!.resources['log-gb']).toBeCloseTo((isr * 0.5 * 1000) / 1e9, 12);
    expect(u.f!.resources['log-events']).toBeCloseTo(isr * 2, 6);
    const api = w.classes.api.count;
    expect(u.c!.resources['log-gb']).toBeCloseTo((api * 0.5 * 1000) / 1e9, 12);
    expect(u.plain!.resources['log-gb']).toBeUndefined();
    expect(u.plain!.resources['log-events']).toBeUndefined();
    // 保持の日数が無ければ保存は出さない
    expect(u.f!.resources['log-gb-month']).toBeUndefined();
  });

  it('保持の日数があれば、保存（GB 月）= 月の取り込み × 日数 / 30（D-94）', () => {
    const u = sim(
      [
        {
          id: 'f',
          label: 'f',
          config: {
            kind: 'function',
            logs: { kbPerInvocation: 1.5, retentionDays: 7 },
          },
        },
      ],
      { api: ['f'] },
    );
    const gb = u.f!.resources['log-gb']!;
    expect(gb).toBeGreaterThan(0);
    expect(u.f!.resources['log-gb-month']).toBeCloseTo((gb * 7) / 30, 12);
  });
});

describe('DB のバックアップ（D-93）', () => {
  const rows = Object.values(w.classes).reduce(
    (a, f) => a + f.count * f.perRequest.rowsWritten,
    0,
  );
  const changesGB = (rows * 2 * 1000) / 1e9;
  const backup = (
    config: Omit<
      Extract<
        ArchitectureInput['nodes'][number]['config'],
        { kind: 'db-backup' }
      >,
      'kind'
    >,
  ) =>
    sim([{ id: 'b', label: 'b', config: { kind: 'db-backup', ...config } }], {})
      .b!.resources;

  it('全体の写し × DB の大きさ + 保持の日数分の変更を残し、経路を持たない', () => {
    expect(rows).toBeGreaterThan(0);
    const r = backup({ retentionDays: 7, fullCopies: 1, changeKBPerRow: 2 });
    expect(r['backup-gb-month']).toBeCloseTo(
      w.storage.dbGB + (changesGB * 7) / 30,
      12,
    );
    expect(r['backup-hours']).toBeUndefined();
  });

  it('DB の大きさ（と最小の割り当て）までは無料で、超えた分だけ数える。アドオンは月の時間', () => {
    // 割り当て 20 GB の中に収まる
    expect(
      backup({
        retentionDays: 7,
        fullCopies: 1,
        changeKBPerRow: 2,
        freeUpToDbSize: true,
        minFreeGB: 20,
      })['backup-gb-month'],
    ).toBeUndefined();
    // DB の大きさだけが無料なら、変更の分だけ残る
    expect(
      backup({
        retentionDays: 35,
        fullCopies: 1,
        changeKBPerRow: 2,
        freeUpToDbSize: true,
      })['backup-gb-month'],
    ).toBeCloseTo((changesGB * 35) / 30, 12);
    expect(backup({ retentionDays: 7, addonHours: true })).toEqual({
      'backup-hours': 730,
    });
  });
});

describe('メールの送信（D-95）', () => {
  const sender: ArchitectureInput['nodes'] = [
    { id: 'm', label: 'm', config: { kind: 'email-sender' } },
  ];

  it('通数は MAU × 利用者あたり + 書き込み × 書き込みあたりで、経路を持たない', () => {
    const we = resolveWorkload(
      workload({ email: { perMau: 0.5, perWrite: 0.2 } }),
    );
    const writes = we.monthlyPageViews * 1 * 0.5;
    expect(we.emails).toBeCloseTo(1000 * 0.5 + writes * 0.2, 9);
    const u = simulateResources(we, {
      id: 'x',
      name: 'x',
      nodes: sender,
      routes: {},
    });
    expect(u.nodes.m!.resources).toEqual({ emails: we.emails });
  });

  it('email が無ければ送らない（0 は資源に載せない）', () => {
    expect(w.emails).toBe(0);
    expect(sim(sender, {}).m!.resources.emails).toBeUndefined();
  });
});
