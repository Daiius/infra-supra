// ページごとの閲覧の偏り（Zipf。D-121・prd/04 §2）。期間つきのキャッシュの miss をページごとに出して足すための土台。純粋関数。
//
// 順位 k（1 〜 n）のページの閲覧の割合を p_k = k^(−s) / H_{n,s}（H_{n,s} = Σ k^(−s)）とし、ページごとの量 f(V × p_k) を足す。
// s = 0（省略）は一様で、n × f(V / n)（今までの式と同じ値。ページ数が整数でなくてもそのまま使う）。
// 計算は決定論の和（乱数なし）。順位の大きい側は p_k がほとんど変わらないので、EXACT_RANKS より後ろは順位を等比の幅でまとめ、
// まとめた区間の重みを x^(−s) の積分（区間の端 ± 0.5）で近似する（和の正規化は近似した重みの合計で取るので、割合の合計は 1 のまま）。

/** 1 つずつ数える順位の数（これより後ろはまとめる）。 */
const EXACT_RANKS = 4096;
/** まとめる区間の幅の比（区間の終わり / 始まり）。 */
const BIN_RATIO = 1.02;

/** ページの区間: count ページが、それぞれ閲覧の割合 share を持つ。 */
type Bin = { count: number; share: number };

/** x^(−s) の a〜b の積分（s = 1 は対数）。 */
function powIntegral(a: number, b: number, s: number): number {
  return s === 1
    ? Math.log(b / a)
    : (Math.pow(b, 1 - s) - Math.pow(a, 1 - s)) / (1 - s);
}

const memo = new Map<string, readonly Bin[]>();

/** n ページ・指数 s の Zipf の区間（同じ n・s には同じ配列を返す。値は入力だけで決まる）。 */
function zipfBins(n: number, s: number): readonly Bin[] {
  const key = `${n}:${s}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const raw: { count: number; weight: number }[] = [];
  const exact = Math.min(n, EXACT_RANKS);
  for (let k = 1; k <= exact; k++)
    raw.push({ count: 1, weight: Math.pow(k, -s) });
  for (let a = exact + 1; a <= n;) {
    const b = Math.min(n, Math.max(a, Math.floor(a * BIN_RATIO)));
    const count = b - a + 1;
    raw.push({ count, weight: powIntegral(a - 0.5, b + 0.5, s) / count });
    a = b + 1;
  }
  const total = raw.reduce((t, x) => t + x.count * x.weight, 0);
  const bins = raw.map((x) => ({ count: x.count, share: x.weight / total }));
  // 取りうる n・s の組は少ない（シナリオのページ数）が、際限なく増えないように古いものを捨てる
  if (memo.size >= 64) memo.clear();
  memo.set(key, bins);
  return bins;
}

/**
 * ルートの閲覧 views を pages ページに偏り（Zipf の指数 s）で散らしたとき、ページごとの量 perPage(そのページの閲覧) の合計。
 * s が 0・省略なら一様（pages × perPage(views / pages)）。
 */
export function sumOverPages(
  views: number,
  pages: number,
  s: number | undefined,
  perPage: (pageViews: number) => number,
): number {
  if (!s || s <= 0) return pages * perPage(views / pages);
  const n = Math.max(1, Math.round(pages));
  let sum = 0;
  for (const b of zipfBins(n, s)) sum += b.count * perPage(views * b.share);
  return sum;
}
