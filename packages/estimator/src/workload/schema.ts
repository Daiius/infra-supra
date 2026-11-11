// Workload の入力（prd/01-domain-model.md §3）。正準な入力だけを持ち、導出値は resolveWorkload で計算する。
// 既定値はテンプレート（catalog）が与える。スキーマ自体は既定値を持たない（どの値が仮定かを曖昧にしないため）。
import { z } from 'zod';

const NonNeg = z.number().finite().nonnegative();
const Pos = z.number().finite().positive();
const Ratio = z.number().finite().min(0).max(1);

// 大きさ（KB）の定義（D-211・prd/04 §2）: 利用者に届く応答の大きさは「転送の大きさ」＝圧縮後（gzip・Brotli で送る HTML・JSON・
// JS・CSS）の値で持つ。事業者は圧縮後のバイトで転送を数え、自動で圧縮する（出典は prd/04 §2.1）。画像は配るファイルそのまま
// （JPEG・WebP・AVIF は圧縮済みで、送るときにさらに圧縮しない）。DB → アプリの応答（db.responseKBPerQuery）はそのまま。
// 計算はこの値をそのまま使う（圧縮の比を式の中で掛けない）。

/** 1 リクエストあたりの処理の性質。 */
export const ProcessingSchema = z.object({
  cpuMs: NonNeg,
  /** I/O 待ち（DB の往復など）。壁時計時間 = cpuMs + ioWaitMs。 */
  ioWaitMs: NonNeg,
  queries: NonNeg,
  rowsReadPerQuery: NonNeg,
  /** 応答 1 回の転送の大きさ（KB・圧縮後。D-211）。HTML の文書なら RSC などフレームワークが埋め込む分も含む（D-212）。 */
  responseKB: NonNeg,
});

export const RouteGroupSchema = z.object({
  id: z.string(),
  /** 画面に出す名前（「記事のページ」など）。制限に当たったルートを示すときに使う（D-99）。省略は id。 */
  label: z.string().optional(),
  /**
   * spa: 1 つの静的なシェルとブラウザの JS で描く（prd/10 F-01）。シェルは訪問の入口だけ（PV ÷ ページ/セッション）、
   * ページごとの中身はデータの API（processing）で取る。
   */
  rendering: z.enum(['static', 'ssr', 'isr', 'spa']),
  /** PV に占める割合。全ルートの合計は 1。 */
  share: Ratio,
  /** コンテンツの在庫: このルートのページ数（ISR の再生成の見積に使う）。 */
  pages: Pos,
  /**
   * ページごとの閲覧の偏り（Zipf の指数 s。順位 k のページの閲覧 ∝ k^(−s)。D-121・prd/04 §2）。期間つきのキャッシュ（ISR の再検証・
   * API の応答の s-maxage・まとめた無効化）の miss を、ページごとの閲覧で出して足す。省略・0 は一様（人気がページに等しく散る）。
   */
  zipfExponent: NonNeg.optional(),
  /**
   * このルートの閲覧 1 回あたりの本文の画像の枚数（D-121）。与えると、このルートの閲覧には perPage.images の代わりにこれを使う
   * （画像の無いページ（個人向けのページなど）に 0 を、記事のページに本文の枚数を持たせる）。
   */
  images: NonNeg.optional(),
  /** このルートの閲覧 1 回あたりのサムネイル（関連記事・一覧）の枚数（perPage.thumbnails の代わり。D-121）。 */
  thumbnails: NonNeg.optional(),
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
  /** spa のみ: シェル（index.html）の転送の大きさ（KB・圧縮後。D-211）。 */
  shellKB: NonNeg.optional(),
  /**
   * spa のみ: ページの中身の API の応答をキャッシュする期間（s-maxage・秒）。与えると中身の API を api-content のクラスに分け、
   * ヒット率を閲覧の密度と期間から出す（prd/04 §2）。全員に同じ中身（記事）だけに付ける（個人化された中身はキャッシュできない）。
   */
  cacheSeconds: Pos.optional(),
  /**
   * 枠 + サーバーの島（描き方 S6。D-108・prd/13 §8）。人ごとに違う部分だけを閲覧ごとにサーバーが描く。
   * - request を与える（isr・static のルート。Astro の Server Islands）: 島は枠とは別の GET のリクエスト。閲覧 1 回ごとに
   *   document-ssr を 1 件足す（処理は request。人ごとに違う応答はキャッシュしない）。ルートの processing は枠の分。
   * - request を省く（ssr のルート。Next.js の PPR）: 島は枠と同じ応答の中で続けて流す。数え方は ssr のままで、processing が
   *   島を描く分。どちらも 1 リクエストあたりの CPU の内訳（D-99）で島と分かるようにする。
   */
  island: z
    .object({
      request: ProcessingSchema.optional(),
      /**
       * 内訳（D-99）の文で島を何と呼ぶか（省略は「サーバーの島」）。部品ごとにキャッシュ（Cache Components。D-111）の
       * 人ごとに違う部分は「動的な穴」と呼ぶ。数え方は変えない。
       */
      label: z.string().optional(),
    })
    .optional(),
  /**
   * このルートの閲覧 1 回あたりに、ページの部品（コメント欄・いいねなどのアイランド）がブラウザから呼ぶ API の回数（D-109・RS-02）。
   * 与えると、このルートの閲覧には perPage.apiCalls の代わりにこれを使う（二重に数えない）。処理は api と同じ。
   * spa のルートの中身のデータの API（processing）とは別に数える（枠 + API の記事は中身とコメント欄で 2 回）。
   */
  apiCalls: NonNeg.optional(),
  /**
   * spa のみ: 枠（HTML）を閲覧のたびに読む（ページごとの枠。D-109）。省略・false は入口だけ（1 つのシェルとブラウザの中の遷移）。
   * true なら枠と JS・CSS は閲覧の数だけ読み、中身はデータの API で取る（Astro・Next.js が記事ごとに書き出す枠）。
   */
  shellPerView: z.boolean().optional(),
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
      /** 多い時間帯 / 平均（容量の判定に使う）。時間より短い山もこれに含める（別の burst は持たない。D-83）。 */
      peakHourFactor: Pos,
      /**
       * 月のうち最も多い日 / 平均の日（話題・Bot の上乗せが短い期間に集中する月。D-60）。日次の無料枠の判定だけに使い、
       * 課金（月の総量）は変えない。省略は 1。
       */
      peakDayFactor: Pos.optional(),
      /**
       * 1 日の時間帯の形（0 時〜23 時の 24 個の重み。大きさは問わず、比だけを使う。D-89）。平日・休日は同じ形で、
       * 量は weekdayToWeekend で割り振る。コンテナのサービスの、時間帯ごとのアクティブな時間・待機・冷えた起動の割合だけに使い、
       * 容量の判定（peakHourFactor）・課金の総量は変えない（二重に数えない）。省略は月の平均の 1 つの時間帯（D-88 の式）。
       */
      hourlyProfile: z
        .array(NonNeg)
        .length(24)
        .refine((a) => a.some((v) => v > 0), '重みのどれかが正')
        .optional(),
      /** 月間 PV を直接与える上書き（与えたら MAU からの導出より優先し、上書きしたことを残す）。 */
      monthlyPageViewsOverride: NonNeg.optional(),
    }),
    routes: z.array(RouteGroupSchema).min(1),
    perPage: z.object({
      apiCalls: NonNeg,
      assets: NonNeg,
      /** 本文の画像（大きいサイズ違い）の枚数。ルートの images が上書きする。 */
      images: NonNeg,
      /** サムネイル（関連記事・一覧の小さいサイズ違い）の枚数（D-121）。ルートの thumbnails が上書きする。省略は 0。 */
      thumbnails: NonNeg.optional(),
    }),
    api: ProcessingSchema.extend({
      writesPerCall: NonNeg,
      rowsWrittenPerWrite: NonNeg,
    }),
    /** JS・CSS 1 ファイルの転送の大きさ（sizeKB。KB・圧縮後。D-211）と、ブラウザのキャッシュから出す割合。 */
    assets: z.object({ sizeKB: NonNeg, browserReuse: Ratio }),
    images: z.object({
      /** 本文の画像 1 枚（配るサイズ違い）の大きさ（KB。配るファイルそのまま。送るときにさらに圧縮しない。D-211）。 */
      sizeKB: NonNeg,
      /** 本文の画像のうち、ブラウザのキャッシュから出す割合（同じ人が同じページを開き直す割合）。 */
      browserReuse: Ratio,
      /**
       * サムネイル 1 枚の大きさと、ブラウザのキャッシュから出す割合（D-121）。サムネイルはサイズ違いの 1 つ（下の variants に含む）で、
       * 配る数（perPage.thumbnails・ルートの thumbnails）と大きさだけを本文の画像と分けて持つ。省略は本文の画像と同じ値。
       */
      thumbnails: z.object({ sizeKB: NonNeg, browserReuse: Ratio }).optional(),
      /**
       * コンテンツの在庫: 画像の種類数とサイズ違いの数（画像変換の件数は PV でなくこれで頭打ちになる）。
       * 一覧のサムネイルはサイズ違いの 1 つとして数える（変換の件数は別に数えない。D-83。配る数と大きさは D-121 で分けた）。
       */
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
      /**
       * variants のうち、形式のフォールバックで同じサイズ違いを何形式ぶん持つか（WebP・AVIF に JPEG も置くと 2。D-58）。
       * variants は「サイズ違い × 形式の数」のままで、保存量だけが形式ごとにサムネイルを 1 枚として数えるのに使う（D-121・OCL-E2492C36）。
       * 省略は 1。
       */
      formatCopies: z.number().finite().positive().optional(),
    }),
    db: z.object({
      sizeGB: NonNeg,
      /** DB → アプリの応答サイズ（マネージド DB の egress。KB。圧縮しない内部の転送としてそのまま。D-211）。 */
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
    /**
     * アプリが送るメール（パスワードの再設定・登録の確認・通知。D-95）。月の通数 = MAU × perMau + 書き込みの回数 × perWrite
     * （書き込みの回数 = PV × ページあたりの API × 1 回あたりの書き込み）。値はテンプレート・シナリオの仮定。省略は送らない。
     */
    email: z
      .object({
        /** 利用者 1 人の月の通数（アカウントの操作・業務の通知など、利用者に比例する分）。 */
        perMau: NonNeg,
        /** 書き込み 1 回あたりの通数（コメントの通知など、書き込みに比例する分）。 */
        perWrite: NonNeg,
        /**
         * メールの最も多い日 / 平均の日（日次の上限の判定だけ。省略は traffic.peakDayFactor）。メールは人の動き（登録・書き込み）に
         * 比例し、Bot の集中には従わないので、流量の集中と分けて渡す（D-117）。
         */
        peakDayFactor: Pos.optional(),
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
      if (r.island) {
        const ok = r.island.request
          ? r.rendering === 'isr' || r.rendering === 'static'
          : r.rendering === 'ssr';
        if (!ok)
          ctx.addIssue({
            code: 'custom',
            path: ['routes', i, 'island'],
            message: r.island.request
              ? '別のリクエストの島（island.request）は isr・static のルートだけ'
              : '同じ応答の中の島（island.request なし）は ssr のルートだけ',
          });
      }
      if (r.rendering !== 'spa' && r.shellPerView !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', i, 'shellPerView'],
          message: 'shellPerView は SPA のルートだけ',
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
