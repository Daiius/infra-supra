// Architecture（prd/01-domain-model.md §4）。ノードと、リクエストクラスごとの経路。
// MVP はグラフの辺の代わりに「クラスごとに通るノードの列」を持つ（エディタの辺は Phase 5 でここから作る）。
import { z } from 'zod';
import { RESOURCES } from '../pricing/resources.ts';
import { REQUEST_CLASSES } from '../workload/resolve.ts';

const Ratio = z.number().finite().min(0).max(1);
const Pos = z.number().finite().positive();
const NonNeg = z.number().finite().nonnegative();

/** ComponentKind ごとの設定。振る舞いはコード（simulate/kinds.ts）、値はデータ。 */
export const NodeKindSchema = z.discriminatedUnion('kind', [
  /** CDN・静的配信。クラスごとのヒット率。列挙しないクラスはキャッシュしない（ヒット率 0）。 */
  z.object({
    kind: z.literal('cdn'),
    hitRate: z.partialRecord(z.enum(REQUEST_CLASSES), Ratio).default({}),
    /**
     * オリジン転送（origin-transfer-gb）に数えるクラス。省略時は miss したクラスすべて。
     * 例: Vercel の Fast Origin Transfer は Functions・Middleware・Blob・Data Cache（ISR）で発生し、画像最適化は挙がっていない。
     */
    originClasses: z.array(z.enum(REQUEST_CLASSES)).optional(),
    /**
     * 期間つきのキャッシュ（ISR の再検証・API の応答の s-maxage）として持つクラス。ヒット率は hitRate でなく
     * Workload の閲覧の密度と期間から出す（ResolvedWorkload.cacheHitRate。prd/04 §2）。
     */
    ttlClasses: z.array(z.enum(REQUEST_CLASSES)).optional(),
  }),
  /** サーバーレス関数・Worker。メモリ × 生存時間（memory-gb-hours）は同時処理数で割る。 */
  z.object({
    kind: z.literal('function'),
    memoryGB: NonNeg.default(0),
    /** 1 インスタンスが同時にさばく件数（Vercel の Fluid など。導出できない仮定）。 */
    concurrency: Pos.default(1),
    /**
     * 同じ実行の中で裏で走るクラス（stale-while-revalidate の再生成など）。CPU・メモリは数えるが、
     * リクエスト・実行の件数には数えない。省略時はすべて別の実行として数える。
     */
    backgroundClasses: z.array(z.enum(REQUEST_CLASSES)).optional(),
    /**
     * コードの中のキャッシュ（Workers の Cache API など）。classes の応答をキャッシュから返すと、関数は起動して
     * リクエスト・実行の件数は変わらず、CPU は hitCpuMs だけになり、経路の次（DB）へは miss だけが流れる。
     * ヒット率は Workload の閲覧の密度と期間から出す（ResolvedWorkload.cacheHitRate）。
     */
    cache: z
      .object({
        classes: z.array(z.enum(REQUEST_CLASSES)),
        hitCpuMs: NonNeg,
      })
      .optional(),
  }),
  /**
   * KV。cache: ISR のキャッシュ（閲覧で読み、再生成で書く）。db: DB の代わり（問い合わせ 1 回を読み取り 1 回、
   * 書く行 1 行を書き込み 1 回と数える。仮定・D-24）。hotKeyShare は同じキーに集中する書き込みの割合（仮定）。
   */
  z.object({
    kind: z.literal('kv'),
    mode: z.enum(['cache', 'db']).default('cache'),
    hotKeyShare: Ratio.default(0),
  }),
  /** 行で課金される SQL（D1 型）。storesImages: 画像を BLOB で置く（1 枚 1 行と仮定。D-24 の不適切な選択）。 */
  z.object({
    kind: z.literal('sql-db'),
    storesImages: z.boolean().default(false),
    /** アプリの DB を置くか（false は画像だけを置く D1。DB は別の部品）。 */
    storesDb: z.boolean().default(true),
  }),
  /** DB への接続のプール（Hyperdrive 型）。問い合わせの件数を数え、経路の次の DB へ流す。 */
  z.object({ kind: z.literal('db-proxy') }),
  /**
   * Durable Objects 型（休止する WebSocket）。受信メッセージは messagesPerRequest 件で 1 リクエスト、
   * 実行時間は処理している間だけ memoryGB で数える（料金データの数え方。catalog の構成が値を持つ）。
   */
  z.object({
    kind: z.literal('durable-object'),
    messagesPerRequest: Pos,
    memoryGB: Pos,
  }),
  /**
   * コンピュートを時間で買うマネージド DB（Supabase 型）。capacityUnits は時間課金の単位の数（Aurora の ACU。既定 1）。
   * pauseAfterIdleSeconds: 接続がこの秒数ないと止まり、止まっている間は課金されない（Aurora Serverless v2 の 0 ACU）。
   * 動いている時間の割合は、DB に届く件数の到着率 λ と待ちの秒数 T から λT / (1 + λT)（キャッシュのヒット率と同じ近似。prd/04 §2）。
   */
  z.object({
    kind: z.literal('managed-db'),
    capacityUnits: Pos.default(1),
    pauseAfterIdleSeconds: Pos.optional(),
  }),
  /**
   * 処理の量の単位で課金する DB（Aurora DSQL 型）。DB に届く 1 件を unitsPerRequest 単位と数える（仮定。catalog の構成が値を持つ）。
   */
  z.object({
    kind: z.literal('processing-db'),
    unitsPerRequest: Pos,
  }),
  /**
   * 要求の単位で課金する DB（DynamoDB のオンデマンド型。prd/11 AX-05）。読み取りは問い合わせ 1 回の応答の大きさを
   * readUnitKB 単位で切り上げた数（結果整合なら半分）、書き込みは 1 行（itemKB）を writeUnitKB 単位で切り上げた数。
   * 単位の大きさは公式の文書、1 行の大きさ itemKB は仮定（catalog の構成が値を持つ）。
   */
  z.object({
    kind: z.literal('request-db'),
    readUnitKB: Pos,
    writeUnitKB: Pos,
    eventuallyConsistent: z.boolean().default(true),
    itemKB: Pos,
  }),
  /**
   * オブジェクトストレージ（R2・S3 型）。storesImages: false なら画像の保存量を載せない（ISR のキャッシュだけに使う場合）。
   * cdnHitRate: 事業者の CDN が自分で配信する型（Vercel Blob の公開のストア）。読み取りは全件を CDN のリクエストと
   * 配信の転送（egress）に数え、miss だけを読み取りの操作と origin への転送に数える（経路に CDN のノードを置かない）。
   */
  z.object({
    kind: z.literal('object-storage'),
    storesImages: z.boolean().default(true),
    cdnHitRate: Ratio.optional(),
  }),
  /** 画像の最適化。cacheMissRate はキャッシュの読み取りが共有キャッシュまで届く割合。 */
  z.object({
    kind: z.literal('image-optimizer'),
    unitKB: Pos.optional(),
    cacheMissRate: Ratio.default(0),
  }),
  /** ISR の永続ストレージ（Vercel 型）。読み書きを unitKB 単位で数える。 */
  z.object({
    kind: z.literal('isr-store'),
    unitKB: Pos,
    /** 再生成で内容が変わる割合（変わらなければ書き込みは 0）。 */
    changedRate: Ratio,
  }),
  /** VPS などのホスト。課金は固定費で、使用量は容量の判定（P1-8）に使う。 */
  z.object({
    kind: z.literal('host'),
    vcpu: Pos,
    memoryGB: Pos,
    diskGB: Pos,
    lineMbps: Pos,
    /** 常駐メモリ（OS・DB・アプリ。仮定）。 */
    residentMemoryGB: NonNeg,
    dbCpuMsPerQuery: NonNeg,
    imageTransformCpuMs: NonNeg,
    otherDiskGB: NonNeg.default(0),
    /** 共有回線のうち実際に使える割合（仮定）。 */
    lineUsable: Ratio.default(0.5),
    /** 劣化させずに使える CPU 使用率の上限（仮定）。 */
    cpuUtilMax: Ratio.default(0.7),
    /** 前段の Web サーバー（nginx・TLS）の 1 リクエストあたりの CPU（ms・仮定。D-31）。 */
    proxyCpuMsPerRequest: NonNeg.default(0),
  }),
]);
export type NodeKind = z.output<typeof NodeKindSchema>;

export const ArchNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  config: NodeKindSchema,
  /** このノードで効く料金データの事実（Plan の facts の id）。挙げたものだけ前提に出す（D-24）。 */
  facts: z.array(z.string()).default([]),
  /** 課金先。無いノード（VPS 上のプロセスなど）は課金されない。 */
  billing: z
    .object({
      accountId: z.string(),
      provider: z.string(),
      planId: z.string(),
      /** 汎用リソース → このプランのメーター ID。対応のないリソースは課金されない（明細に「対応なし」として残す）。 */
      meters: z.partialRecord(z.enum(RESOURCES), z.string()).default({}),
    })
    .optional(),
});
export type ArchNode = z.output<typeof ArchNodeSchema>;

export const ArchitectureSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    accounts: z
      .array(
        z.object({
          id: z.string(),
          seats: z.number().int().positive().optional(),
          region: z.string().optional(),
        }),
      )
      .default([]),
    nodes: z.array(ArchNodeSchema).min(1),
    /** リクエストクラスごとに通るノードの列（入口から順に）。 */
    routes: z.partialRecord(
      z.enum(REQUEST_CLASSES),
      z.array(z.string()).min(1),
    ),
    /** 課金されるが経路に載らない固定のノード（DB のコンピュートなど）は nodes に置けば静的な使用量が出る。 */
  })
  .superRefine((a, ctx) => {
    const ids = new Set<string>();
    a.nodes.forEach((n, i) => {
      if (ids.has(n.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `ノードの ID が重複: ${n.id}`,
        });
      }
      ids.add(n.id);
    });
    for (const [cls, path] of Object.entries(a.routes)) {
      for (const id of path ?? []) {
        if (!ids.has(id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['routes', cls],
            message: `経路に存在しないノード: ${id}`,
          });
        }
      }
    }
  });
export type ArchitectureInput = z.input<typeof ArchitectureSchema>;
export type Architecture = z.output<typeof ArchitectureSchema>;
