// 振り返りの 4 軸（D-132）と、手元の履歴との比較（D-144）。完走のダイアログと結果の画面で共用する。
// 1 つの点数にはまとめず、軸ごとに並べる（prd/07 §7・prd/15 §2）。
import type { ResultAxisId } from 'game';
import { signedText, usd } from './format.ts';
import type { AxisComparison } from './results-history.ts';

const fmtPoints = (n: number) => String(Number(n.toFixed(1)));

/** 軸ごとの値の書式（差は絶対値の書式に符号を付ける）。 */
const FORMAT: Record<ResultAxisId, (n: number) => string> = {
  cash: usd,
  satisfaction: (n) => n.toFixed(2),
  featurePoints: fmtPoints,
  edgeMonths: (n) => `${n} か月`,
};

/** 軸の短い説明（値の意味。④ はジョーク枠）。 */
const CAPTION: Record<ResultAxisId, string> = {
  cash: '最後の月の所持金',
  satisfaction: '毎月の満足度の平均',
  featurePoints: '機能開発に回せた手間の合計',
  edgeMonths: '止まらずに、上限の 90〜100% まで使った月（ジョーク枠）',
};

export function ResultAxesPanel({
  comparisons,
  outages,
  size = 'md',
}: {
  comparisons: readonly AxisComparison[];
  /** 止まった月の数（軸ではなく、振り返りとして下に出す）。 */
  outages: number;
  size?: 'md' | 'lg';
}) {
  const count = comparisons[0]?.count ?? 0;
  return (
    <section aria-label="4 つの軸の振り返り" data-result-axes>
      <p className="mb-2 text-xs opacity-70" data-result-compare-note>
        {count > 0
          ? `この端末に残した過去の完走（同じシナリオの ${count} 回）と比べています。`
          : 'この端末に、比べる過去の完走はまだありません。次に完走すると、自己ベスト・前回との差・順位を出します。'}
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {comparisons.map((c, i) => {
          const f = FORMAT[c.id];
          return (
            <li
              key={c.id}
              className="rounded-box border border-success/40 bg-base-100 p-3"
              data-axis={c.id}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">
                  {['①', '②', '③', '④'][i]} {c.label}
                </span>
                {c.newBest && (
                  <span className="badge badge-success badge-sm">
                    ★ 自己ベスト更新
                  </span>
                )}
              </div>
              <div
                className={`tabular-nums ${size === 'lg' ? 'text-2xl font-bold' : 'text-xl font-semibold'}`}
              >
                {f(c.value)}
              </div>
              <div className="text-xs opacity-70">{CAPTION[c.id]}</div>
              {c.count > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {c.best !== undefined && (
                    <li>
                      {c.newBest ? 'これまでの自己ベスト' : '自己ベスト'}{' '}
                      <span className="tabular-nums">{f(c.best)}</span>
                    </li>
                  )}
                  {c.diffFromLast !== undefined && (
                    <li>
                      前回との差{' '}
                      <span className="tabular-nums">
                        {signedText(c.diffFromLast, f)}
                      </span>
                    </li>
                  )}
                  <li>
                    過去 {c.count + 1} 回の中で {c.rank} 位
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm">
        止まった月 <span className="tabular-nums">{outages} 回</span>
        <span className="text-xs opacity-70">
          （振り返りとして出します。軸には入れません）
        </span>
      </p>
    </section>
  );
}
