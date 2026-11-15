import type { MonthReport } from 'game';

/**
 * 月の報告の、進行中の作業（部品の差し替え・乗り換え・作り直し）の進み。どれも無ければ出さない。
 * 手間の総量・使い道・累計の行は外した（評価は累計で、満足度の「機能」の札と行動の欄の来月の見込みに任せる。D-222 の補足）。
 */
export function WorkProgressView({ report: r }: { report: MonthReport }) {
  if (!r.componentSwap && !r.migration && !r.rewrite) return null;
  return (
    <div>
      {r.componentSwap && (
        <div className="mt-2 text-sm">
          {r.componentSwap.label}差し替え中（データの移行）:{' '}
          {r.componentSwap.done} / {r.componentSwap.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.componentSwap.done}
            max={r.componentSwap.required}
          />
        </div>
      )}
      {r.migration && (
        <div className="mt-2 text-sm">
          {r.migration.toName} へ乗り換え中: {r.migration.done} /{' '}
          {r.migration.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.migration.done}
            max={r.migration.required}
          />
        </div>
      )}
      {r.rewrite && (
        <div className="mt-2 text-sm">
          {r.rewrite.toLabel} へ作り直し中（今月は旧アプリのまま）:{' '}
          {r.rewrite.done} / {r.rewrite.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.rewrite.done}
            max={r.rewrite.required}
          />
        </div>
      )}
    </div>
  );
}
