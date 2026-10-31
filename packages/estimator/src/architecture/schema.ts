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
  }),
  /** KV（ISR のキャッシュとして使う場合: 閲覧で読み、再生成で書く）。 */
  z.object({ kind: z.literal('kv') }),
  /** 行で課金される SQL（D1 型）。 */
  z.object({ kind: z.literal('sql-db') }),
  /** コンピュートを時間で買うマネージド DB（Supabase 型）。 */
  z.object({ kind: z.literal('managed-db') }),
  /** オブジェクトストレージ（R2・S3 型）。 */
  z.object({ kind: z.literal('object-storage') }),
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
  }),
]);
export type NodeKind = z.output<typeof NodeKindSchema>;

export const ArchNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  config: NodeKindSchema,
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
