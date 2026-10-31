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
};
