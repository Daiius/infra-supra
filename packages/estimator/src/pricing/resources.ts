import type { Unit } from '../num/unit.ts';

// 汎用リソース（prd/01-domain-model.md §5.1）。資源シミュレーションが生み、メーターが参照するキー。
// 振る舞いはコード側の語彙なので列挙で持つ（新しいリソースの追加はエンジンの変更。prd/01 §4.1）。
export const RESOURCES = [
  'requests', // 関数・Worker・CDN へのリクエスト
  'invocations', // 関数の実行
  'cpu-ms', // CPU 時間
  'cpu-hours', // CPU 時間（時間単位で課金するサービス向け）
  'memory-gb-hours', // メモリ × 生存時間
  'rows-read',
  'rows-written',
  'storage-gb-month', // 保存量（GB 月）
  'object-writes', // オブジェクトストレージの書き込み系操作（R2 の Class A など）
  'object-reads', // 読み取り系操作（R2 の Class B など）
  'egress-gb', // クライアントへの転送量
  'origin-transfer-gb', // CDN とオリジンの間の転送量
  'kv-reads',
  'kv-writes',
  'image-transformations',
  'image-cache-reads',
  'image-cache-writes',
  'isr-reads',
  'isr-writes',
  'instance-hours', // 時間課金のインスタンス（DB のコンピュートなど）
  'monthly-active-users',
  'queries', // DB への問い合わせ（Hyperdrive のクエリ数など）
  'gb-seconds', // メモリ × 実行時間（秒。Durable Objects の Duration）
  'read-request-units', // 要求の単位で課金する DB の読み取りの単位（DynamoDB の RRU。AX-05）
  'write-request-units', // 同じく書き込みの単位（DynamoDB の WRU）
  'processing-units', // 処理の量の単位で課金する DB の単位（Aurora DSQL の DPU）
  'invalidation-paths', // CDN のキャッシュの無効化のパス（CloudFront の無効化。D-66）
  'build-minutes', // 静的なページをビルドし直す時間 × CPU の数（Astro の静的出力。D-68）
  'deploys', // 本番へのデプロイの回数（Netlify のクレジットは 1 回ごと。ビルドし直しの回数。D-71）
  'idle-cpu-hours', // 待機しているインスタンスの vCPU 時間（Cloud Run の最小インスタンスの idle。D-88）
  'idle-memory-gb-hours', // 待機しているインスタンスのメモリ × 時間（同じ）
] as const;
export type ResourceKey = (typeof RESOURCES)[number];

/** 資源シミュレーションが出す量の基準の単位。メーターの単位が違えば convertUnit で換算する。 */
export const RESOURCE_UNITS: Record<ResourceKey, Unit> = {
  requests: 'request',
  invocations: 'count',
  'cpu-ms': 'ms',
  'cpu-hours': 'cpu-hour',
  'memory-gb-hours': 'gb-hour',
  'rows-read': 'row',
  'rows-written': 'row',
  'storage-gb-month': 'gb-month',
  'object-writes': 'operation',
  'object-reads': 'operation',
  'egress-gb': 'gb',
  'origin-transfer-gb': 'gb',
  'kv-reads': 'operation',
  'kv-writes': 'operation',
  'image-transformations': 'count',
  'image-cache-reads': 'operation',
  'image-cache-writes': 'operation',
  'isr-reads': 'operation',
  'isr-writes': 'operation',
  'instance-hours': 'hour',
  'monthly-active-users': 'count',
  queries: 'count',
  'gb-seconds': 'gb-second',
  'read-request-units': 'operation',
  'write-request-units': 'operation',
  'processing-units': 'count',
  'invalidation-paths': 'count',
  'build-minutes': 'minute',
  deploys: 'count',
  'idle-cpu-hours': 'cpu-hour',
  'idle-memory-gb-hours': 'gb-hour',
};
