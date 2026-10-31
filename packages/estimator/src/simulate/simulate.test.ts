// prd/05-test-strategy.md §3（資源シミュレーション）と §5b（フレームワーク由来の件数）。値はすべて架空。
import { describe, expect, it } from 'vitest';
import { nearlyEqual } from '../num/arith.ts';
import type { ArchitectureInput } from '../architecture/schema.ts';
import { estimate } from '../estimate.ts';
import { FICTIONAL_CLOUD } from '../pricing/fixtures.test-helpers.ts';
import { parsePriceBook } from '../pricing/schema.ts';
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

const workload = (
  mau: number,
  extra: Partial<WorkloadInput> = {},
): WorkloadInput => ({
  commercial: true,
  traffic: {
    mau,
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
    { id: 'mypage', rendering: 'ssr', share: 0.3, pages: 1, processing },
    { id: 'about', rendering: 'static', share: 0.2, pages: 5, processing },
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
  ...extra,
});

/** CDN → 関数 → DB と、CDN → オブジェクトストレージの、最小の構成（課金は架空のプランの 1 メーターだけ）。 */
const arch: ArchitectureInput = {
  id: 'fictional-stack',
  name: '架空の構成',
  nodes: [
    {
      id: 'cdn',
      label: 'CDN',
      config: {
        kind: 'cdn',
        hitRate: {
          asset: 0.9,
          'document-static': 1,
          'image-read': 0.8,
          'document-isr': 0.75,
        },
      },
    },
    {
      id: 'fn',
      label: '関数',
      config: { kind: 'function', memoryGB: 1, concurrency: 1 },
      billing: {
        accountId: 'acct',
        provider: 'fictional-cloud',
        planId: 'basic',
        meters: { requests: 'requests', 'cpu-ms': 'cpu-ms' },
      },
    },
    { id: 'db', label: 'DB', config: { kind: 'sql-db' } },
    { id: 'store', label: 'オブジェクト', config: { kind: 'object-storage' } },
  ],
  routes: {
    'document-static': ['cdn'],
    'document-ssr': ['cdn', 'fn', 'db'],
    'document-isr': ['cdn', 'fn'],
    'isr-revalidate': ['fn', 'db'],
    asset: ['cdn'],
    api: ['cdn', 'fn', 'db'],
    'image-read': ['cdn', 'store'],
    'image-write': ['fn', 'store'],
    'image-transform': ['fn'],
  },
};

const structuredLike = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('resolveWorkload', () => {
  it('月間 PV は MAU から導出し、上書きがあれば優先して根拠に残す', () => {
    const w = resolveWorkload(workload(1000));
    expect(nearlyEqual(w.monthlyPageViews, 1000 * 0.5 * (730 / 24) * 2)).toBe(
      true,
    );
    const o = resolveWorkload(
      workload(1000, {
        traffic: { ...workload(1).traffic, monthlyPageViewsOverride: 123 },
      }),
    );
    expect(o.monthlyPageViews).toBe(123);
    expect(o.derivations[0]!.expression).toContain('上書き');
  });

  it('ISR の再生成は閲覧が増えても「ページ数 × 1 か月 / 間隔」で頭打ちになる', () => {
    const cap = (100 * 730 * 3600) / 60;
    const small = resolveWorkload(workload(10)).classes['isr-revalidate'].count;
    const huge = resolveWorkload(workload(1e9)).classes['isr-revalidate'].count;
    const views = resolveWorkload(workload(10)).classes['document-isr'].count;
    expect(small).toBeLessThan(views);
    expect(nearlyEqual(small, views, 1e-3)).toBe(true); // 閲覧がまばらならほぼ全部が再生成
    expect(huge).toBeLessThan(cap);
    expect(huge / cap).toBeGreaterThan(0.99);
  });

  it('画像の変換は「種類 × サイズ違い」で頭打ち（PV でなく在庫で決まる）', () => {
    expect(
      resolveWorkload(workload(1e6)).classes['image-transform'].count,
    ).toBe(20);
  });

  it('平日と休日の倍率は月の合計を保存する', () => {
    const w = resolveWorkload(
      workload(1, {
        traffic: { ...workload(1).traffic, weekdayToWeekend: 1.5 },
      }),
    );
    expect(
      nearlyEqual(w.dayFactors.weekday * 5 + w.dayFactors.weekend * 2, 7),
    ).toBe(true);
    expect(nearlyEqual(w.dayFactors.weekday / w.dayFactors.weekend, 1.5)).toBe(
      true,
    );
  });

  it('同じ描画のルートをまとめても、1 リクエストあたりの CPU の最大は残る（課金は平均）', () => {
    const w = workload(10_000);
    w.routes = [
      w.routes[2]!,
      { ...w.routes[1]!, id: 'light', share: 0.4, processing },
      {
        ...w.routes[1]!,
        id: 'heavy',
        share: 0.4,
        processing: { ...processing, cpuMs: 30 },
      },
      // 件数 0 のルートは最大に数えない
      {
        ...w.routes[1]!,
        id: 'unused',
        share: 0,
        processing: { ...processing, cpuMs: 99 },
      },
    ];
    const r = resolveWorkload(w);
    const ssr = r.classes['document-ssr'].perRequest;
    expect(nearlyEqual(ssr.cpuMs, 20)).toBe(true);
    expect(ssr.maxCpuMs).toBe(30);
    expect(simulateResources(r, arch).nodes.fn!.maxCpuMsPerRequest).toBe(30);
  });

  it('裏で走る再生成の CPU は、それを起こす閲覧の CPU に足して 1 回の実行の最大に数える', () => {
    const bg: ArchitectureInput = {
      ...arch,
      nodes: arch.nodes.map((n) =>
        n.id === 'fn'
          ? {
              ...n,
              config: {
                kind: 'function',
                memoryGB: 1,
                concurrency: 1,
                backgroundClasses: ['isr-revalidate'],
              },
            }
          : n,
      ),
    };
    const r = resolveWorkload(workload(10_000));
    // 前景は SSR・API の 10 ms、ISR の閲覧 1 ms + 裏の再生成 10 ms = 11 ms
    expect(simulateResources(r, arch).nodes.fn!.maxCpuMsPerRequest).toBe(10);
    expect(simulateResources(r, bg).nodes.fn!.maxCpuMsPerRequest).toBe(11);

    // ISR のルートが 2 つ: 閲覧の最大（5 ms）と再生成の最大（10 ms）が別のルートなら 15 ms にしない。
    // ルートごとに 1 + 10 = 11・5 + 5 = 10 を出して最大を取る
    const two = workload(10_000);
    const article = two.routes[0]!;
    two.routes = [
      { ...article, share: 0.25 },
      {
        ...article,
        id: 'news',
        share: 0.25,
        cachedServeCpuMs: 5,
        processing: { ...processing, cpuMs: 5 },
      },
      ...two.routes.slice(1),
    ];
    const r2 = resolveWorkload(two);
    expect(r2.backgroundCpuMs['isr-revalidate']).toBe(11);
    expect(simulateResources(r2, bg).nodes.fn!.maxCpuMsPerRequest).toBe(11);
  });

  it('ISR・画像キャッシュの読み書きの単位は ceilUnits で数える（2.1 / 0.3 を 8 単位にしない）', () => {
    expect(Math.ceil(2.1 / 0.3)).toBe(8); // 浮動小数点の誤差で 1 単位多くなる
    const w = workload(10_000);
    w.routes = w.routes.map((r) => ({
      ...r,
      processing: { ...processing, responseKB: 2.1 },
    }));
    w.images = { ...w.images, sizeKB: 2.1 };
    const r = resolveWorkload(w);
    const s = simulateResources(r, {
      id: 'units',
      name: '単位の切り上げ',
      nodes: [
        {
          id: 'isr',
          label: 'ISR',
          config: { kind: 'isr-store', unitKB: 0.3, changedRate: 1 },
        },
        {
          id: 'img',
          label: '画像',
          config: { kind: 'image-optimizer', unitKB: 0.3, cacheMissRate: 1 },
        },
      ],
      routes: {
        'document-isr': ['isr'],
        'isr-revalidate': ['isr'],
        'image-read': ['img'],
        'image-transform': ['img'],
      },
    });
    const c = r.classes;
    const near = (a: number | undefined, b: number) =>
      expect(nearlyEqual(a!, b)).toBe(true);
    near(s.nodes.isr!.resources['isr-reads'], c['document-isr'].count * 7);
    near(s.nodes.isr!.resources['isr-writes'], c['isr-revalidate'].count * 7);
    near(
      s.nodes.img!.resources['image-cache-reads'],
      c['image-read'].count * 7,
    );
    near(
      s.nodes.img!.resources['image-cache-writes'],
      c['image-transform'].count * 7,
    );
  });

  it('share の合計が 1 でなければ入力の誤り', () => {
    const bad = workload(1);
    bad.routes[0]!.share = 0.9;
    expect(() => resolveWorkload(bad)).toThrow();
  });
});

describe('simulateResources', () => {
  it('保存則: CDN のリクエスト = 入ってきた件数、オリジンへの転送 = miss の分', () => {
    const w = resolveWorkload(workload(10_000));
    const s = simulateResources(w, arch);
    const c = w.classes;
    const into =
      c['document-static'].count +
      c['document-ssr'].count +
      c['document-isr'].count +
      c.asset.count +
      c.api.count +
      c['image-read'].count;
    expect(nearlyEqual(s.nodes.cdn!.resources.requests!, into)).toBe(true);
    const missKB =
      c['document-ssr'].count * 50 +
      c['document-isr'].count * 0.25 * 50 +
      c.asset.count * 0.1 * 20 +
      c.api.count * 50 +
      c['image-read'].count * 0.2 * 100;
    expect(
      nearlyEqual(
        s.nodes.cdn!.resources['origin-transfer-gb']!,
        (missKB * 1000) / 1e9,
      ),
    ).toBe(true);
  });

  it('関数に届くのは CDN の miss だけ（ISR は 25% だけ関数を通る）', () => {
    const w = resolveWorkload(workload(10_000));
    const s = simulateResources(w, arch);
    const c = w.classes;
    const fnReq =
      c['document-ssr'].count +
      c['document-isr'].count * 0.25 +
      c['isr-revalidate'].count +
      c.api.count +
      c['image-write'].count +
      c['image-transform'].count;
    expect(nearlyEqual(s.nodes.fn!.resources.requests!, fnReq)).toBe(true);
  });

  it('裏で走るクラスは CPU だけ数え、リクエスト・実行の件数に数えない', () => {
    const w = resolveWorkload(workload(10_000));
    const fg = simulateResources(w, arch);
    const bgArch = structuredLike(arch);
    bgArch.nodes[1]!.config = {
      kind: 'function',
      memoryGB: 1,
      concurrency: 1,
      backgroundClasses: ['isr-revalidate'],
    };
    const bg = simulateResources(w, bgArch);
    const rev = w.classes['isr-revalidate'];
    expect(
      nearlyEqual(
        fg.nodes.fn!.resources.requests! - bg.nodes.fn!.resources.requests!,
        rev.count,
      ),
    ).toBe(true);
    expect(bg.nodes.fn!.resources['cpu-ms']).toBe(
      fg.nodes.fn!.resources['cpu-ms'],
    );
  });

  it('オリジン転送は originClasses に挙げたクラスの miss だけ数える', () => {
    const w = resolveWorkload(workload(10_000));
    const a = structuredLike(arch);
    a.nodes[0]!.config = {
      kind: 'cdn',
      hitRate: { 'image-read': 0.8 },
      originClasses: ['api'],
    };
    const s = simulateResources(w, a);
    expect(
      nearlyEqual(
        s.nodes.cdn!.resources['origin-transfer-gb']!,
        (w.classes.api.count * 50 * 1000) / 1e9,
      ),
    ).toBe(true);
  });

  it('MAU = 0 なら経路を通る使用量はすべて 0（保存量だけ残る）', () => {
    const s = simulateResources(resolveWorkload(workload(0)), arch);
    expect(s.nodes.cdn!.resources).toEqual({});
    expect(s.nodes.fn!.resources).toEqual({});
    expect(s.nodes.db!.resources).toEqual({ 'storage-gb-month': 1 });
  });

  it('線形性: 在庫で頭打ちにならないクラスは MAU に比例する', () => {
    const a = simulateResources(resolveWorkload(workload(1_000)), arch);
    const b = simulateResources(resolveWorkload(workload(3_000)), arch);
    expect(
      nearlyEqual(
        b.nodes.db!.resources['rows-written']!,
        3 * a.nodes.db!.resources['rows-written']!,
      ),
    ).toBe(true);
    expect(
      nearlyEqual(
        b.nodes.cdn!.resources['egress-gb']!,
        3 * a.nodes.cdn!.resources['egress-gb']!,
      ),
    ).toBe(true);
  });

  it('経路のないクラスは「構成の欠落」として出る', () => {
    const routes = { ...arch.routes };
    delete routes['image-write'];
    const s = simulateResources(resolveWorkload(workload(100)), {
      ...arch,
      routes,
    });
    expect(s.unroutedClasses).toEqual(['image-write']);
  });

  it('存在しないノードを経路に書くと構成の検証で落ちる', () => {
    expect(() =>
      simulateResources(resolveWorkload(workload(1)), {
        ...arch,
        routes: { asset: ['ghost'] },
      }),
    ).toThrow();
  });
});

describe('estimate（端から端まで・架空の料金）', () => {
  const book = parsePriceBook(FICTIONAL_CLOUD, { allowFictional: true });

  it('課金先のメーターに写り、対応のないリソースは unmetered に残る', () => {
    const r = estimate({
      workload: workload(10_000),
      architecture: arch,
      books: [book],
    });
    const meters = r.usage.map((u) => u.meterId).sort();
    expect(meters).toEqual(['cpu-ms', 'requests']);
    expect(
      r.unmetered.some(
        (u) => u.nodeId === 'fn' && u.resource === 'invocations',
      ),
    ).toBe(true);
    expect(r.unmetered.some((u) => u.nodeId === 'cdn')).toBe(true); // CDN には課金先がない
    expect(r.bill.totals.USD).toBeGreaterThan(10); // 固定費 10 + 従量
  });

  it('cpu-ms は関数の実行件数で 1 回ごとに切り上げる', () => {
    const r = estimate({
      workload: workload(10_000),
      architecture: arch,
      books: [book],
    });
    const cpu = r.usage.find((u) => u.meterId === 'cpu-ms')!;
    expect(cpu.events).toBeCloseTo(r.simulation.nodes.fn!.events, 9);
  });

  it('同じ入力で同じ結果（JSON が一致）', () => {
    const a = estimate({
      workload: workload(5_000),
      architecture: arch,
      books: [book],
    });
    const b = estimate({
      workload: workload(5_000),
      architecture: arch,
      books: [book],
    });
    expect(JSON.stringify(a.bill)).toBe(JSON.stringify(b.bill));
  });
});
