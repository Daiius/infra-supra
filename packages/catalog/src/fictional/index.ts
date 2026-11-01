// 架空の料金データの入口（prd/05 §1）。catalog の本体（index.ts）からは export しない。
// テストからは `catalog/fictional`（他のパッケージ）か相対パス（catalog の中）で読む。
import { parsePriceBook, type PriceBook, type PriceBookInput } from 'estimator';
import { FICTIONAL_DB, FICTIONAL_EDGE, FICTIONAL_YEN_HOST } from './books.ts';

export { FICTIONAL_DB, FICTIONAL_EDGE, FICTIONAL_YEN_HOST };

export const FICTIONAL_PRICE_BOOKS: readonly PriceBookInput[] = [
  FICTIONAL_EDGE,
  FICTIONAL_YEN_HOST,
  FICTIONAL_DB,
];

/** 検証済みの架空の料金データ（テスト用。allowFictional: true で読む）。 */
export function loadFictionalPriceBooks(): PriceBook[] {
  return FICTIONAL_PRICE_BOOKS.map((b) =>
    parsePriceBook(b, { allowFictional: true }),
  );
}
