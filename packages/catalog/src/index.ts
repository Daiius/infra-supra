// サービスカタログと料金データ（プロバイダー別・版付き）・構成・テンプレート。スキーマと計算は estimator 側にあり、
// ここはデータだけを持つ（prd/03-pricing-schema.md）。架空の料金はここには置かない（estimator のテスト用の架空データを使う）。
import { parsePriceBook, type PriceBook, type PriceBookInput } from 'estimator';
import { aws } from './providers/aws.ts';
import { cloudflare } from './providers/cloudflare.ts';
import { netlify } from './providers/netlify.ts';
import { sakuraVps } from './providers/sakura-vps.ts';
import { supabase } from './providers/supabase.ts';
import { vercel } from './providers/vercel.ts';

export const RAW_PRICE_BOOKS: readonly PriceBookInput[] = [
  cloudflare,
  vercel,
  supabase,
  sakuraVps,
  aws,
  netlify,
];

/** 検証済みの料金データ。本番の読み込みなので架空の料金は拒否される。 */
export function loadPriceBooks(): PriceBook[] {
  return RAW_PRICE_BOOKS.map((b) =>
    parsePriceBook(b, { allowFictional: false }),
  );
}

export * from './frameworks/index.ts';
export * from './stacks/index.ts';
export * from './stacks/cross.ts';
export * from './stacks/flavor.ts';
export * from './stacks/files.ts';
export * from './templates/index.ts';
