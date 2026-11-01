// Workload の解決（prd/01 §3・prd/04 §2）。入力からリクエストクラスごとの月間件数と性質を導く。純粋関数。
import { HOURS_PER_MONTH } from '../num/unit.ts';
import type { Derivation } from '../provenance.ts';
import {
  WorkloadInputSchema,
  type ParsedWorkload,
  type WorkloadInput,
} from './schema.ts';

export const REQUEST_CLASSES = [
  'document-static',
  'document-ssr',
  'document-isr', // ISR のページの閲覧（キャッシュから返る）
  'isr-revalidate', // ISR の再生成（関数が動く）
  'asset',
  'api',
  'api-content', // SPA の共有の中身（記事）を返すデータの API。応答を CDN 等でキャッシュするとき（cacheSeconds）だけ api から分ける
  'image-read',
  'image-write',
  'image-transform', // 画像の最適化（一意な変換）
  'realtime-connect', // リアルタイムの接続（WebSocket の確立）
  'realtime-message', // リアルタイムのメッセージ（サーバーが受け取る数）
] as const;
export type RequestClass = (typeof REQUEST_CLASSES)[number];

/** 1 クラスの月間の流れ。件数あたりの値（perRequest）と件数を分けて持つ。 */
export type ClassFlow = {
  count: number;
  perRequest: {
    kb: number;
    /** 件数で重み付けした平均（課金・使用量に使う）。 */
    cpuMs: number;
    /** まとめたルートのうち、件数が正のものの CPU の最大（1 リクエストあたりの上限の判定に使う）。 */
    maxCpuMs: number;
    wallMs: number;
    queries: number;
    rowsRead: number;
    rowsWritten: number;
  };
};

export type ResolvedWorkload = {
  input: ParsedWorkload;
  monthlyPageViews: number;
  classes: Record<RequestClass, ClassFlow>;
  /**
   * 裏で走るクラスを、それを起こした閲覧と 1 回の実行にまとめたときの CPU の最大（ms）。
   * ルートごとに「閲覧 + 再生成」を足してから最大を取る（別のルートの閲覧と再生成を足さない）。
   * 構成がそのクラスを裏で走らせるとき（function の backgroundClasses）だけ使う。
   */
  backgroundCpuMs: Partial<Record<RequestClass, number>>;
  /**
   * 期間つきのキャッシュ（ISR の再検証の間隔・API の応答の s-maxage）のヒット率（件数で重み付け）。
   * 1 ページへの閲覧の到着率 λ と期間 T から λT / (1 + λT)（= 1 − 再生成・取り直しの数 / 閲覧。人気が一様と仮定。prd/04 §2）。
   * document-isr と api-content だけ。構成の cdn（ttlClasses）と function（cache）が使う。
   */
  cacheHitRate: Partial<Record<RequestClass, number>>;
  /** 平日 1 日・休日 1 日が月の平均日の何倍か（合計が保存されるように割り振る）。 */
  dayFactors: { weekday: number; weekend: number };
  peakHourFactor: number;
  /**
   * 保存量。imagesGB は原本（images.storedGB）。variantsGB は投稿のときに作って保存するサイズ違い
   * （transformAt: upload のときだけ。閲覧のときに変換する構成では保存しないので 0。OCL-F3098083）。
   */
  storage: { dbGB: number; imagesGB: number; variantsGB: number };
  derivations: Derivation[];
};

const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;
const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;

const flow = (
  count: number,
  p: Partial<ClassFlow['perRequest']> = {},
): ClassFlow => ({
  count,
  perRequest: {
    kb: p.kb ?? 0,
    cpuMs: p.cpuMs ?? 0,
    maxCpuMs: p.maxCpuMs ?? p.cpuMs ?? 0,
    wallMs: p.wallMs ?? p.cpuMs ?? 0,
    queries: p.queries ?? 0,
    rowsRead: p.rowsRead ?? 0,
    rowsWritten: p.rowsWritten ?? 0,
  },
});

/** 複数ルートの流れを件数で重み付けして 1 つのクラスにまとめる。CPU の最大は平均とは別に残す。 */
function merge(flows: ClassFlow[]): ClassFlow {
  const count = flows.reduce((s, f) => s + f.count, 0);
  if (count === 0) return flow(0);
  const avg = (k: keyof ClassFlow['perRequest']) =>
    flows.reduce((s, f) => s + f.count * f.perRequest[k], 0) / count;
  return flow(count, {
    kb: avg('kb'),
    cpuMs: avg('cpuMs'),
    maxCpuMs: Math.max(
      ...flows.filter((f) => f.count > 0).map((f) => f.perRequest.maxCpuMs),
    ),
    wallMs: avg('wallMs'),
    queries: avg('queries'),
    rowsRead: avg('rowsRead'),
    rowsWritten: avg('rowsWritten'),
  });
}

export function resolveWorkload(raw: WorkloadInput): ResolvedWorkload {
  const w = WorkloadInputSchema.parse(raw);
  const t = w.traffic;
  const derivations: Derivation[] = [];

  const derivedPV =
    t.mau * t.dauPerMau * DAYS_PER_MONTH * t.sessionsPerDau * t.pagesPerSession;
  const pv = t.monthlyPageViewsOverride ?? derivedPV;
  derivations.push({
    id: 'monthly-page-views',
    label: '月間 PV',
    expression:
      t.monthlyPageViewsOverride !== undefined
        ? '上書き（monthlyPageViewsOverride）'
        : 'MAU × DAU/MAU × 30.4 日 × セッション/日 × ページ/セッション',
    inputs: [
      { name: 'MAU', value: t.mau, basis: 'user-input' },
      { name: 'DAU/MAU', value: t.dauPerMau, basis: 'user-input' },
      { name: 'セッション/日', value: t.sessionsPerDau, basis: 'user-input' },
      {
        name: 'ページ/セッション',
        value: t.pagesPerSession,
        basis: 'user-input',
      },
    ],
    result: pv,
  });

  const byRendering = {
    static: [] as ClassFlow[],
    ssr: [] as ClassFlow[],
    isr: [] as ClassFlow[],
  };
  const revalidations: ClassFlow[] = [];
  /** SPA のページの中身を取るデータの API（ページごとに 1 回）。 */
  const spaData: ClassFlow[] = [];
  /** SPA の共有の中身のうち、応答をキャッシュするもの（cacheSeconds）。hits はキャッシュから返る件数。 */
  const spaContent: ClassFlow[] = [];
  let spaContentHits = 0;
  let spaContentViews = 0;
  let isrViews = 0;
  let isrMisses = 0;
  /** SPA のルートの閲覧と入口（シェルと JS・CSS を読むのは入口だけ）。 */
  let spaViews = 0;
  let spaEntries = 0;
  // 1 訪問あたりのページ数（入口の割合 = 1 / これ）。0 なら毎回入口とみなす
  const pagesPerVisit = t.pagesPerSession > 0 ? t.pagesPerSession : 1;
  let isrWithRevalidate = 0;
  for (const r of w.routes) {
    const views = pv * r.share;
    const p = r.processing;
    const work = {
      kb: p.responseKB,
      cpuMs: p.cpuMs,
      wallMs: p.cpuMs + p.ioWaitMs,
      queries: p.queries,
      rowsRead: p.queries * p.rowsReadPerQuery,
    };
    if (r.rendering === 'spa') {
      // シェルは入口だけ（遷移はブラウザの中）。中身はページごとにデータの API で取る（prd/04 §2・prd/10 F-01）
      const entries = views / pagesPerVisit;
      spaViews += views;
      spaEntries += entries;
      byRendering.static.push(flow(entries, { kb: r.shellKB! }));
      if (r.cacheSeconds !== undefined) {
        // ISR の再生成と同じ形: 期間 T あたり 1 ページ高々 1 回だけ取り直す（miss）→ 閲覧 / (1 + λT)
        const lambdaT =
          (views / r.pages) * (r.cacheSeconds / SECONDS_PER_MONTH);
        const misses = views / (1 + lambdaT);
        spaContent.push(flow(views, work));
        spaContentHits += views - misses;
        spaContentViews += views;
        derivations.push({
          id: `api-cache-misses:${r.id}`,
          label: `API の応答のキャッシュの取り直し（${r.id}）`,
          expression:
            '閲覧 / (1 + ページあたりの閲覧 × キャッシュの期間 / 1 か月)（人気が一様と仮定。ISR の再生成と同じ形）',
          inputs: [
            { name: '閲覧', value: views, basis: 'derived' },
            { name: 'ページ数', value: r.pages, basis: 'user-input' },
            {
              name: 'キャッシュの期間',
              value: r.cacheSeconds,
              unit: 'second',
              basis: 'user-input',
            },
          ],
          result: misses,
        });
      } else spaData.push(flow(views, work));
      derivations.push({
        id: `spa-entries:${r.id}`,
        label: `SPA のシェルの読み込み（${r.id}）`,
        expression:
          '閲覧 / 1 セッションあたりのページ数（遷移はブラウザの中で、中身はデータの API）',
        inputs: [
          { name: '閲覧', value: views, basis: 'derived' },
          {
            name: 'ページ/セッション',
            value: t.pagesPerSession,
            basis: 'user-input',
          },
        ],
        result: entries,
      });
    } else if (r.rendering === 'static') {
      byRendering.static.push(flow(views, { kb: p.responseKB }));
    } else if (r.rendering === 'ssr') {
      byRendering.ssr.push(flow(views, work));
    } else {
      byRendering.isr.push(
        flow(views, { kb: p.responseKB, cpuMs: r.cachedServeCpuMs }),
      );
      // 1 ページへの閲覧の到着率 λ に対し、間隔 T あたり高々 1 回 → 閲覧 / (1 + λT)（人気が一様と仮定。prd/04 §2）
      const lambdaT =
        (views / r.pages) * (r.revalidateSeconds! / SECONDS_PER_MONTH);
      const count = views / (1 + lambdaT);
      revalidations.push(flow(count, work));
      isrViews += views;
      isrMisses += count;
      if (count > 0) {
        isrWithRevalidate = Math.max(
          isrWithRevalidate,
          r.cachedServeCpuMs + p.cpuMs,
        );
      }
      derivations.push({
        id: `isr-revalidations:${r.id}`,
        label: `ISR の再生成（${r.id}）`,
        expression:
          '閲覧 / (1 + ページあたりの閲覧 × 再検証の間隔 / 1 か月)（人気が一様と仮定）',
        inputs: [
          { name: '閲覧', value: views, basis: 'derived' },
          { name: 'ページ数', value: r.pages, basis: 'user-input' },
          {
            name: '再検証の間隔',
            value: r.revalidateSeconds!,
            unit: 'second',
            basis: 'user-input',
          },
        ],
        result: count,
      });
    }
  }

  const a = w.api;
  const rt = w.realtime;
  // JS・CSS は SPA のルートでは入口だけ読む（遷移では読み直さない）
  const assetViews = pv - spaViews + spaEntries;
  const apiFlow = flow(pv * w.perPage.apiCalls, {
    kb: a.responseKB,
    cpuMs: a.cpuMs,
    wallMs: a.cpuMs + a.ioWaitMs,
    queries: a.queries,
    rowsRead: a.queries * a.rowsReadPerQuery,
    rowsWritten: a.writesPerCall * a.rowsWrittenPerWrite,
  });
  const images = pv * w.perPage.images * (1 - w.images.browserReuse);
  const classes: Record<RequestClass, ClassFlow> = {
    'document-static': merge(byRendering.static),
    'document-ssr': merge(byRendering.ssr),
    'document-isr': merge(byRendering.isr),
    'isr-revalidate': merge(revalidations),
    asset: flow(assetViews * w.perPage.assets * (1 - w.assets.browserReuse), {
      kb: w.assets.sizeKB,
    }),
    api: spaData.length ? merge([apiFlow, ...spaData]) : apiFlow,
    'api-content': merge(spaContent),
    'image-read': flow(images, { kb: w.images.sizeKB }),
    'image-write': flow(t.mau * w.images.uploadsPerMau, {
      kb: w.images.sizeKB,
    }),
    // 一意な変換は「画像の種類 × サイズ違い」で頭打ち（閲覧がそれより少なければ閲覧数）。
    // 投稿のときに作るなら投稿数 × サイズ違い、作らないなら 0（D-24）
    'image-transform': flow(
      w.images.transformAt === 'none'
        ? 0
        : w.images.transformAt === 'upload'
          ? t.mau * w.images.uploadsPerMau * w.images.variants
          : Math.min(w.images.distinct * w.images.variants, images),
      {
        kb: w.images.sizeKB,
      },
    ),
    'realtime-connect': flow(
      rt ? t.mau * rt.usersPerMau * rt.connectionsPerUser : 0,
      { rowsRead: rt?.historyRowsPerConnect ?? 0 },
    ),
    'realtime-message': flow(
      rt ? t.mau * rt.usersPerMau * rt.messagesPerUser : 0,
      { cpuMs: rt?.processingMs ?? 0, rowsWritten: 1 },
    ),
  };

  const r = t.weekdayToWeekend;
  return {
    input: w,
    monthlyPageViews: pv,
    classes,
    backgroundCpuMs: { 'isr-revalidate': isrWithRevalidate },
    cacheHitRate: {
      ...(isrViews > 0 ? { 'document-isr': 1 - isrMisses / isrViews } : {}),
      ...(spaContentViews > 0
        ? { 'api-content': spaContentHits / spaContentViews }
        : {}),
    },
    dayFactors: { weekday: (7 * r) / (5 * r + 2), weekend: 7 / (5 * r + 2) },
    peakHourFactor: t.peakHourFactor,
    storage: {
      dbGB: w.db.sizeGB,
      imagesGB: w.images.storedGB,
      // サイズ違い 1 枚は配る大きさ（sizeKB）とする（仮定）
      variantsGB:
        w.images.transformAt === 'upload'
          ? (w.images.distinct * w.images.variants * w.images.sizeKB) /
            1_000_000
          : 0,
    },
    derivations,
  };
}
