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
  rendering: z.enum(['static', 'ssr', 'isr']),
  /** PV に占める割合。全ルートの合計は 1。 */
  share: Ratio,
  /** コンテンツの在庫: このルートのページ数（ISR の再生成の見積に使う）。 */
  pages: Pos,
  revalidateSeconds: Pos.optional(),
  processing: ProcessingSchema,
  /** ISR のページをキャッシュから返すときの CPU（ホストによっては関数・Worker を通る）。 */
  cachedServeCpuMs: NonNeg.default(0),
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
      storedGB: NonNeg,
      uploadsPerMau: NonNeg,
      /**
       * サイズ違いを作る時（D-24）。request: 閲覧のときに変換（一意な変換 = 種類 × サイズ違い）・
       * upload: 投稿のときに 1 回（= 投稿数 × サイズ違い）・none: 変換しない。
       */
      transformAt: z.enum(['request', 'upload', 'none']).default('request'),
    }),
    db: z.object({
      sizeGB: NonNeg,
      /** DB → アプリの応答サイズ（マネージド DB の egress）。 */
      responseKBPerQuery: NonNeg,
    }),
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
      if (r.rendering === 'isr' && r.revalidateSeconds === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'revalidateSeconds'],
          message: 'ISR のルートには revalidateSeconds が必要',
        });
      }
    });
  });

export type WorkloadInput = z.input<typeof WorkloadInputSchema>;
export type ParsedWorkload = z.output<typeof WorkloadInputSchema>;
