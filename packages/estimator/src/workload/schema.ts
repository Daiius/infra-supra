// Workload の入力（prd/01-domain-model.md §3）。正準な入力だけを持ち、導出値は resolveWorkload で計算する。
// 既定値はテンプレート（catalog）が与える。スキーマ自体は既定値を持たない（どの値が仮定かを曖昧にしないため）。
import { z } from 'zod';

const NonNeg = z.number().finite().nonnegative();
const Pos = z.number().finite().positive();
const Ratio = z.number().finite().min(0).max(1);

/** 1 リクエストあたりの処理の性質。 */
export const ProcessingSchema = z.object({
  cpuMs: NonNeg,
  /** I/O 待ち（DB の往復など）。壁時計時間 = cpuMs + ioWaitMs。 */
  ioWaitMs: NonNeg,
  queries: NonNeg,
  rowsReadPerQuery: NonNeg,
  responseKB: NonNeg,
});

export const RouteGroupSchema = z.object({
  id: z.string(),
  /**
   * spa: 1 つの静的なシェルとブラウザの JS で描く（prd/10 F-01）。シェルは訪問の入口だけ（PV ÷ ページ/セッション）、
   * ページごとの中身はデータの API（processing）で取る。
   */
  rendering: z.enum(['static', 'ssr', 'isr', 'spa']),
  /** PV に占める割合。全ルートの合計は 1。 */
  share: Ratio,
  /** コンテンツの在庫: このルートのページ数（ISR の再生成の見積に使う）。 */
  pages: Pos,
  revalidateSeconds: Pos.optional(),
  /**
   * isr のみ: オンデマンドの再検証（内容を更新したときに再検証する）。与えると revalidateSeconds の代わりに、
   * 再生成の回数をこの月の内容の更新の回数から出す（prd/04 §2）。
   */
  onDemandUpdatesPerMonth: NonNeg.optional(),
  /**
   * isr・オンデマンドのみ: 最大寿命（保険の時間の再検証・秒）。再検証の呼び出しの取りこぼしに備えて、時間の再検証を併せて持つ。
   * 与えると再生成の回数に時間の式の分を足す（prd/04 §2・D-56）。
   */
  onDemandMaxAgeSeconds: Pos.optional(),
  /**
   * isr・オンデマンドのみ: 1 回の内容の更新で再検証を呼ぶページの数（記事のページと一覧など）。CDN のキャッシュの無効化の数に使い、
   * 再生成の回数には使わない（prd/04 §2・D-66）。省略は 1。
   */
  onDemandPagesPerUpdate: Pos.optional(),
  processing: ProcessingSchema,
  /** ISR のページをキャッシュから返すときの CPU（ホストによっては関数・Worker を通る）。 */
  cachedServeCpuMs: NonNeg.default(0),
  /** spa のみ: シェル（index.html）の大きさ。 */
  shellKB: NonNeg.optional(),
  /**
   * spa のみ: ページの中身の API の応答をキャッシュする期間（s-maxage・秒）。与えると中身の API を api-content のクラスに分け、
   * ヒット率を閲覧の密度と期間から出す（prd/04 §2）。全員に同じ中身（記事）だけに付ける（個人化された中身はキャッシュできない）。
   */
  cacheSeconds: Pos.optional(),
});

export const WorkloadInputSchema = z
  .object({
    /** 商用か（利用資格の判定。Vercel Hobby など）。 */
    commercial: z.boolean(),
    traffic: z.object({
      mau: NonNeg,
      dauPerMau: Ratio,
      sessionsPerDau: NonNeg,
      pagesPerSession: NonNeg,
      /** 平日 1 日 / 休日 1 日 の比（日次の無料枠の判定に使う）。 */
      weekdayToWeekend: Pos,
      /** 多い時間帯 / 平均（容量の判定に使う）。 */
      peakHourFactor: Pos,
      /**
       * 月のうち最も多い日 / 平均の日（話題・Bot の上乗せが短い期間に集中する月。D-60）。日次の無料枠の判定だけに使い、
       * 課金（月の総量）は変えない。省略は 1。
       */
      peakDayFactor: Pos.optional(),
      /** 月間 PV を直接与える上書き（与えたら MAU からの導出より優先し、上書きしたことを残す）。 */
      monthlyPageViewsOverride: NonNeg.optional(),
    }),
    routes: z.array(RouteGroupSchema).min(1),
    perPage: z.object({
      apiCalls: NonNeg,
      assets: NonNeg,
      images: NonNeg,
    }),
    api: ProcessingSchema.extend({
      writesPerCall: NonNeg,
      rowsWrittenPerWrite: NonNeg,
    }),
    assets: z.object({ sizeKB: NonNeg, browserReuse: Ratio }),
    images: z.object({
      sizeKB: NonNeg,
      browserReuse: Ratio,
      /** コンテンツの在庫: 画像の種類数とサイズ違いの数（画像変換の件数は PV でなくこれで頭打ちになる）。 */
      distinct: NonNeg,
      variants: NonNeg,
      /** 画像の原本の保存量（サイズ違いは含まない。投稿のときに作るサイズ違いは resolve で足す）。 */
      storedGB: NonNeg,
      uploadsPerMau: NonNeg,
      /**
       * サイズ違いを作る時（D-24）。request: 閲覧のときに変換（一意な変換 = 種類 × サイズ違い）・
       * upload: 投稿のときに 1 回（= 投稿数 × サイズ違い）・none: 変換しない。
       */
      transformAt: z.enum(['request', 'upload', 'none']).default('request'),
      /**
       * 画像の変換 1 回の重さの倍率（画像の形式で変わる。AVIF は WebP より約 50% 長い。D-58）。
       * 構成の関数が変換の時間（classCpuMs）を持つときだけ、その時間に掛ける（OCL-ECDEF8A1）。
       */
      transformWorkFactor: z.number().finite().positive().default(1),
    }),
    db: z.object({
      sizeGB: NonNeg,
      /** DB → アプリの応答サイズ（マネージド DB の egress）。 */
      responseKBPerQuery: NonNeg,
    }),
    /**
     * 静的なページをビルドし直す（Astro の静的出力で、記事の更新をビルドで反映する。D-68・prd/06 §6）。
     * 月のビルドの回数は、間隔 T（省略は更新のたび。1 回のビルドの時間より短くはできない）ごとに「その間に更新が 1 回でもあれば 1 回」と数える
     * （更新は一様に到着すると仮定: 枠の数 N × (1 − e^(−更新 / N))。prd/04 §2）。値はテンプレート・シナリオの仮定。
     */
    build: z
      .object({
        /** ビルドを起こす内容の更新の回数（月）。 */
        updatesPerMonth: NonNeg,
        /** まとめてビルドする間隔（秒）。省略は更新のたび。 */
        intervalSeconds: Pos.optional(),
        /** 1 回のビルドの時間（分。事業者は 1 回ごとに分へ切り上げて数える）。 */
        minutesPerBuild: Pos,
      })
      .optional(),
    /** リアルタイム（チャットなどの WebSocket）。値はテンプレート・シナリオの仮定（D-24）。 */
    realtime: z
      .object({
        /** 使う人の割合（MAU あたり）。 */
        usersPerMau: Ratio,
        /** 1 人の月の接続数。 */
        connectionsPerUser: NonNeg,
        /** 1 人の月の送信メッセージ（サーバーが受け取る数）。 */
        messagesPerUser: NonNeg,
        /** 1 メッセージの処理時間（ms）。 */
        processingMs: NonNeg,
        /** 接続のときに読む履歴の行数。 */
        historyRowsPerConnect: NonNeg,
      })
      .optional(),
  })
  .superRefine((w, ctx) => {
    const total = w.routes.reduce((s, r) => s + r.share, 0);
    if (Math.abs(total - 1) > 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: ['routes'],
        message: `ルートの share の合計は 1（現在 ${total}）`,
      });
    }
    w.routes.forEach((r, i) => {
      if (
        r.rendering === 'isr' &&
        r.revalidateSeconds === undefined &&
        r.onDemandUpdatesPerMonth === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'revalidateSeconds'],
          message:
            'ISR のルートには revalidateSeconds か onDemandUpdatesPerMonth が必要',
        });
      }
      if (
        r.revalidateSeconds !== undefined &&
        r.onDemandUpdatesPerMonth !== undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'onDemandUpdatesPerMonth'],
          message:
            '再検証は時間（revalidateSeconds）かオンデマンド（onDemandUpdatesPerMonth）のどちらか',
        });
      }
      if (r.rendering !== 'spa' && r.cacheSeconds !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'cacheSeconds'],
          message:
            'cacheSeconds は SPA のルートだけ（ISR は revalidateSeconds）',
        });
      }
      if (r.rendering === 'spa' && r.shellKB === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'shellKB'],
          message: 'SPA のルートには shellKB が必要',
        });
      }
    });
  });

export type WorkloadInput = z.input<typeof WorkloadInputSchema>;
export type ParsedWorkload = z.output<typeof WorkloadInputSchema>;
