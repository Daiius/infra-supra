// Workload の解決（prd/01 §3・prd/04 §2）。入力からリクエストクラスごとの月間件数と性質を導く。純粋関数。
import { ceilUnits } from '../num/arith.ts';
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
    /**
     * 1 件の大きさの内訳（件数の割合と大きさ）。kb は件数で重み付けした平均なので、大きさの単位で切り上げて数える課金
     * （HTTP API の 512 KB など）は、平均でなくこの内訳ごとに切り上げてから足す（OCL-663E589C）。省略は kb だけの 1 種類。
     */
    kbMix?: { share: number; kb: number }[];
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
  /**
   * ピークの時間帯の同じヒット率。その時間帯は 1 ページへの到着率が λ × peakHourFactor になるので、
   * λT を peakHourFactor 倍して出す（容量の判定だけに使う。課金は cacheHitRate。D-44・prd/04 §2）。
   */
  peakCacheHitRate: Partial<Record<RequestClass, number>>;
  /**
   * 期間つきのキャッシュを miss した流れ（ルートごとの miss の件数で重み付けしてまとめる。OCL-48C8B649）。
   * 閲覧の密度・期間・処理の重さがルートで違うと、miss の 1 件あたりの処理はクラス全体の平均と違うので、
   * キャッシュの後ろへはこの流れを渡す（件数は cacheHitRate と整合する）。
   */
  cacheMissFlow: Partial<Record<RequestClass, ClassFlow>>;
  /** ピークの時間帯の miss の流れ（peakCacheHitRate と整合する。容量の判定だけに使う。D-44）。 */
  peakCacheMissFlow: Partial<Record<RequestClass, ClassFlow>>;
  /**
   * 内容の更新のたびに、そのルートの全ページの CDN のキャッシュを消す（ワイルドカードでまとめた無効化。D-79）ときの、
   * CDN を miss する流れ（document-isr だけ）。1 ページは更新のたびに消えるので、ページあたり 更新 × 閲覧 / (更新 + ページあたりの閲覧)。
   * CDN の後ろの ISR のキャッシュ（OpenNext の S3）は消えないので、再生成の回数（classes の isr-revalidate）は変わらない。
   * 時間の再検証のルートは cacheMissFlow と同じ。
   */
  cdnFlushMissFlow: Partial<Record<RequestClass, ClassFlow>>;
  /** ピークの時間帯の同じ流れ（容量の判定だけ）。 */
  peakCdnFlushMissFlow: Partial<Record<RequestClass, ClassFlow>>;
  /**
   * ピークの時間帯の ISR の再生成の流れ（ルートごとのピークの miss の件数で、ルートごとの再生成の処理を重み付けしてまとめる）。
   * ISR のページを期間つきでキャッシュする CDN の後ろでは、届いた閲覧がそのつど再生成を起こすので、ピークの再生成はこの流れ（D-55・OCL-55732091）。
   */
  peakRevalidateFlow: ClassFlow;
  /** 平日 1 日・休日 1 日が月の平均日の何倍か（合計が保存されるように割り振る）。 */
  dayFactors: { weekday: number; weekend: number };
  peakHourFactor: number;
  /**
   * 月を時間帯で分けた区間（D-89）。share は月の流れのうちその区間に入る割合（合計 1）、hours はその区間の月の時間（合計 730）。
   * hourlyProfile が無ければ月全体の 1 区間（share 1・730 時間）。
   */
  timeBuckets: TimeBucket[];
  /** 月のうち最も多い日 / 平均の日（話題・Bot の集中。日次の無料枠の判定だけ。D-60）。 */
  peakDayFactor: number;
  /**
   * 保存量。imagesGB は原本（images.storedGB）。variantsGB は投稿のときに作って保存するサイズ違い
   * （transformAt: upload のときだけ。閲覧のときに変換する構成では保存しないので 0。OCL-F3098083）。
   */
  storage: {
    dbGB: number;
    imagesGB: number;
    variantsGB: number;
    /** ISR のページを 1 つずつ置いたときの大きさ（ページ数 × 応答の大きさ）。ISR のキャッシュを置くストレージが使う（D-66）。 */
    isrPagesGB: number;
  };
  /**
   * オンデマンドの再検証で、月に再検証を呼ぶページの数（内容の更新 × 1 回の更新で再検証するページの数）。
   * 再生成の回数ではない（再生成は更新のあとの最初の閲覧で起きる）。CDN のキャッシュの無効化に使う（D-66）。
   */
  onDemandPageRevalidations: number;
  /** オンデマンドの再検証の月の内容の更新の回数（ルートの合計）。ワイルドカードでまとめた無効化のパスに使う（D-79）。 */
  onDemandUpdates: number;
  /**
   * 静的なページのビルドし直し（Workload の build。D-68）。count は月のビルドの回数、minutes はビルドの時間の合計
   * （1 回ごとに分へ切り上げる）。build が無ければ 0。
   */
  builds: { count: number; minutes: number };
  derivations: Derivation[];
};

const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

/** 月の時間帯の区間（D-89）。 */
export type TimeBucket = { share: number; hours: number };

/**
 * 時間帯の区間: 平日 5 日・休日 2 日 × 24 時間（D-89）。平日と休日の量の比は weekdayToWeekend、1 日の中の割り振りは
 * hourlyProfile の重みの比。profile が無ければ月全体の 1 区間（月の平均。D-88 の式に戻る）。
 */
export function timeBuckets(
  weekdayToWeekend: number,
  hourlyProfile: readonly number[] | undefined,
): TimeBucket[] {
  if (!hourlyProfile) return [{ share: 1, hours: HOURS_PER_MONTH }];
  const r = weekdayToWeekend;
  const sum = hourlyProfile.reduce((a, v) => a + v, 0);
  const days = [
    { share: (5 * r) / (5 * r + 2), hours: (HOURS_PER_MONTH * 5) / 7 },
    { share: 2 / (5 * r + 2), hours: (HOURS_PER_MONTH * 2) / 7 },
  ];
  return days.flatMap((d) =>
    hourlyProfile.map((v) => ({
      share: (d.share * v) / sum,
      hours: d.hours / 24,
    })),
  );
}
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
    ...(p.kbMix ? { kbMix: p.kbMix } : {}),
  },
});

/** 1 件の大きさの内訳（省略なら平均の大きさ 1 種類）。 */
export function kbMixOf(
  p: ClassFlow['perRequest'],
): { share: number; kb: number }[] {
  return p.kbMix ?? [{ share: 1, kb: p.kb }];
}

/** 複数ルートの流れを件数で重み付けして 1 つのクラスにまとめる。CPU の最大は平均とは別に残す。 */
function merge(flows: ClassFlow[]): ClassFlow {
  const count = flows.reduce((s, f) => s + f.count, 0);
  if (count === 0) return flow(0);
  const avg = (k: Exclude<keyof ClassFlow['perRequest'], 'kbMix'>): number =>
    flows.reduce((s, f) => s + f.count * f.perRequest[k], 0) / count;
  // 大きさの内訳は、各ルートの内訳を件数の割合で重み付けして並べ、同じ大きさをまとめる
  const mix = new Map<number, number>();
  for (const f of flows) {
    if (f.count <= 0) continue;
    for (const part of kbMixOf(f.perRequest))
      mix.set(
        part.kb,
        (mix.get(part.kb) ?? 0) + (part.share * f.count) / count,
      );
  }
  return flow(count, {
    kb: avg('kb'),
    kbMix: [...mix].map(([kb, share]) => ({ share, kb })),
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
  /** ルートごとの miss の流れ（キャッシュの後ろへ渡す）。 */
  const spaContentMiss: ClassFlow[] = [];
  const isrMiss: ClassFlow[] = [];
  const spaContentPeakMiss: ClassFlow[] = [];
  const isrPeakMiss: ClassFlow[] = [];
  const isrFlushMiss: ClassFlow[] = [];
  const isrPeakFlushMiss: ClassFlow[] = [];
  const peakRevalidations: ClassFlow[] = [];
  let spaContentHits = 0;
  let spaContentViews = 0;
  let isrViews = 0;
  let isrMisses = 0;
  // ピークの時間帯の miss（到着率が peakHourFactor 倍）
  let spaContentPeakMisses = 0;
  let isrPeakMisses = 0;
  const peakRate = t.peakHourFactor;
  /** SPA のルートの閲覧と入口（シェルと JS・CSS を読むのは入口だけ）。 */
  let spaViews = 0;
  let spaEntries = 0;
  // 1 訪問あたりのページ数（入口の割合 = 1 / これ）。0 なら毎回入口とみなす
  const pagesPerVisit = t.pagesPerSession > 0 ? t.pagesPerSession : 1;
  let isrWithRevalidate = 0;
  let onDemandPageRevalidations = 0;
  let onDemandUpdates = 0;
  let isrPagesKB = 0;
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
        spaContentMiss.push(flow(misses, work));
        spaContentHits += views - misses;
        spaContentViews += views;
        spaContentPeakMisses += views / (1 + lambdaT * peakRate);
        spaContentPeakMiss.push(flow(views / (1 + lambdaT * peakRate), work));
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
      const served = { kb: p.responseKB, cpuMs: r.cachedServeCpuMs };
      byRendering.isr.push(flow(views, served));
      isrPagesKB += r.pages * p.responseKB;
      const updates = r.onDemandUpdatesPerMonth;
      if (updates !== undefined) {
        const pagesPerUpdate = r.onDemandPagesPerUpdate ?? 1;
        onDemandPageRevalidations += updates * pagesPerUpdate;
        onDemandUpdates += updates;
        derivations.push({
          id: `on-demand-pages:${r.id}`,
          label: `オンデマンドの再検証を呼ぶページ（${r.id}）`,
          expression:
            '内容の更新 × 1 回の更新で再検証するページの数（CDN のキャッシュの無効化に使う）',
          inputs: [
            { name: '内容の更新', value: updates, basis: 'user-input' },
            {
              name: '1 回の更新で再検証するページ',
              value: pagesPerUpdate,
              basis:
                r.onDemandPagesPerUpdate === undefined
                  ? 'assumption'
                  : 'user-input',
            },
          ],
          result: updates * pagesPerUpdate,
        });
      }
      // 時間: 1 ページへの閲覧の到着率 λ に対し、間隔 T あたり高々 1 回 → 閲覧 / (1 + λT)（人気が一様と仮定。prd/04 §2）
      // オンデマンド: 更新のあとの最初の閲覧で 1 回 → 更新 × 閲覧 / (更新 + 閲覧)（更新と閲覧がページに一様に散ると仮定。
      // 更新が閲覧よりずっと少なければ更新の回数、閲覧が少なければ閲覧の回数に近づく）。ピークでも外れる割合は同じとみなす。
      // オンデマンドに最大寿命（保険の時間の再検証）を併せるときは、その分（時間の式）を足す。閲覧の回数を超えない（D-56）
      const maxAge =
        updates === undefined ? undefined : r.onDemandMaxAgeSeconds;
      const T = updates === undefined ? r.revalidateSeconds : maxAge;
      const lambdaT =
        T === undefined ? 0 : (views / r.pages) * (T / SECONDS_PER_MONTH);
      const onDemandPart =
        updates === undefined
          ? 0
          : updates + views > 0
            ? (updates * views) / (updates + views)
            : 0;
      const timedPart = (lt: number) =>
        T === undefined ? 0 : views / (1 + lt);
      const count =
        updates === undefined
          ? timedPart(lambdaT)
          : Math.min(views, onDemandPart + timedPart(lambdaT));
      const peakMisses =
        updates === undefined
          ? timedPart(lambdaT * peakRate)
          : Math.min(views, onDemandPart + timedPart(lambdaT * peakRate));
      // ワイルドカードでまとめた無効化（D-79）: 1 回の更新でルートの全ページの CDN のキャッシュが消える。
      // ページあたりの更新は U（ページごとの U / ページ数でなく）なので、合計は U × 閲覧 / (U + 閲覧 / ページ数)
      const flushPart =
        updates === undefined
          ? 0
          : updates + views / r.pages > 0
            ? (updates * views) / (updates + views / r.pages)
            : 0;
      const flushCount =
        updates === undefined
          ? count
          : Math.min(views, flushPart + timedPart(lambdaT));
      const peakFlushCount =
        updates === undefined
          ? peakMisses
          : Math.min(views, flushPart + timedPart(lambdaT * peakRate));
      isrFlushMiss.push(flow(flushCount, served));
      isrPeakFlushMiss.push(flow(peakFlushCount, served));
      revalidations.push(flow(count, work));
      isrMiss.push(flow(count, served));
      isrViews += views;
      isrMisses += count;
      isrPeakMisses += peakMisses;
      isrPeakMiss.push(flow(peakMisses, served));
      peakRevalidations.push(flow(peakMisses, work));
      if (count > 0) {
        isrWithRevalidate = Math.max(
          isrWithRevalidate,
          r.cachedServeCpuMs + p.cpuMs,
        );
      }
      derivations.push(
        updates === undefined
          ? {
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
            }
          : {
              id: `isr-revalidations:${r.id}`,
              label: `ISR の再生成（${r.id}・オンデマンド）`,
              expression:
                maxAge === undefined
                  ? '更新 × 閲覧 / (更新 + 閲覧)（更新のあとの最初の閲覧で 1 回。更新と閲覧がページに一様に散ると仮定）'
                  : 'min(閲覧, 更新 × 閲覧 / (更新 + 閲覧) + 閲覧 / (1 + ページあたりの閲覧 × 最大寿命 / 1 か月))（オンデマンドに最大寿命の時間の再検証を足す）',
              inputs: [
                { name: '閲覧', value: views, basis: 'derived' },
                {
                  name: '内容の更新',
                  value: updates,
                  basis: 'user-input',
                },
                ...(maxAge !== undefined
                  ? [
                      {
                        name: 'ページ数',
                        value: r.pages,
                        basis: 'user-input' as const,
                      },
                      {
                        name: '最大寿命',
                        value: maxAge,
                        unit: 'second' as const,
                        basis: 'user-input' as const,
                      },
                    ]
                  : []),
              ],
              result: count,
            },
      );
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

  const builds = resolveBuilds(w, derivations);
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
    peakCacheHitRate: {
      ...(isrViews > 0 ? { 'document-isr': 1 - isrPeakMisses / isrViews } : {}),
      ...(spaContentViews > 0
        ? { 'api-content': 1 - spaContentPeakMisses / spaContentViews }
        : {}),
    },
    cacheMissFlow: {
      ...(isrViews > 0 ? { 'document-isr': merge(isrMiss) } : {}),
      ...(spaContentViews > 0 ? { 'api-content': merge(spaContentMiss) } : {}),
    },
    peakRevalidateFlow: merge(peakRevalidations),
    peakCacheMissFlow: {
      ...(isrViews > 0 ? { 'document-isr': merge(isrPeakMiss) } : {}),
      ...(spaContentViews > 0
        ? { 'api-content': merge(spaContentPeakMiss) }
        : {}),
    },
    cdnFlushMissFlow:
      isrViews > 0 ? { 'document-isr': merge(isrFlushMiss) } : {},
    peakCdnFlushMissFlow:
      isrViews > 0 ? { 'document-isr': merge(isrPeakFlushMiss) } : {},
    dayFactors: { weekday: (7 * r) / (5 * r + 2), weekend: 7 / (5 * r + 2) },
    peakHourFactor: t.peakHourFactor,
    timeBuckets: timeBuckets(r, t.hourlyProfile),
    peakDayFactor: t.peakDayFactor ?? 1,
    storage: {
      dbGB: w.db.sizeGB,
      imagesGB: w.images.storedGB,
      // サイズ違い 1 枚は配る大きさ（sizeKB）とする（仮定）
      variantsGB:
        w.images.transformAt === 'upload'
          ? (w.images.distinct * w.images.variants * w.images.sizeKB) /
            1_000_000
          : 0,
      isrPagesGB: isrPagesKB / 1_000_000,
    },
    onDemandPageRevalidations,
    onDemandUpdates,
    builds,
    derivations,
  };
}

/**
 * 月のビルドの回数と時間（D-68）。間隔 T ごとの枠（ビルドの時間より短い枠は作れない）に、更新が 1 回でもあれば 1 回ビルドする。
 * 更新が一様に到着すると仮定して、枠の数 N のうち更新のある枠は N × (1 − e^(−更新 / N))。
 */
function resolveBuilds(
  w: ParsedWorkload,
  derivations: Derivation[],
): { count: number; minutes: number } {
  const b = w.build;
  if (!b || b.updatesPerMonth <= 0) return { count: 0, minutes: 0 };
  const slotSec = Math.max(b.intervalSeconds ?? 0, b.minutesPerBuild * 60);
  const slots = SECONDS_PER_MONTH / slotSec;
  const count = slots * (1 - Math.exp(-b.updatesPerMonth / slots));
  const minutes = count * ceilUnits(b.minutesPerBuild, 1);
  derivations.push({
    id: 'builds',
    label: '静的なページのビルドし直し',
    expression:
      '枠の数 × (1 − e^(−更新 / 枠の数))。枠 = 1 か月 / max(ビルドの間隔, 1 回のビルドの時間)（更新が一様に到着すると仮定）',
    inputs: [
      { name: '内容の更新', value: b.updatesPerMonth, basis: 'user-input' },
      ...(b.intervalSeconds !== undefined
        ? [
            {
              name: 'ビルドの間隔',
              value: b.intervalSeconds,
              unit: 'second' as const,
              basis: 'user-input' as const,
            },
          ]
        : []),
      {
        name: '1 回のビルドの時間（分）',
        value: b.minutesPerBuild,
        basis: 'user-input',
      },
    ],
    result: count,
  });
  return { count, minutes };
}
