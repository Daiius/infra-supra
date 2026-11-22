import type { MonthReport } from 'game';

/** 進行中の作業か長時間の処理（D-239）があるか（月の報告の右の列を出すか）。 */
export const hasWorkProgress = (r: MonthReport): boolean =>
  !!(r.componentSwap || r.migration || r.rewrite || r.backgroundJobs?.length);

const hours = (h: number) => Math.round(h).toLocaleString();

/**
 * 月の報告の、進行中の作業（部品の差し替え・乗り換え・作り直し）と長時間の処理（D-239）の進み。どれも無ければ出さない。
 * 工数の総量・使い道・累計の行は外した（評価は累計で、満足度の「機能」の札と行動の欄の来月の見込みに任せる。D-222 の補足）。
 */
export function WorkProgressView({ report: r }: { report: MonthReport }) {
  if (!hasWorkProgress(r)) return null;
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
      {r.backgroundJobs?.map((j) => (
        <div
          key={j.eventId}
          className="mt-2 text-sm"
          data-background-job={j.eventId}
        >
          長時間の処理「{j.label}」{j.finished ? 'が終わりました' : '中'}:{' '}
          {hours(j.done)} / {hours(j.required)} vCPU 時間
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={j.done}
            max={j.required}
          />
          <div className="text-xs opacity-70">
            {j.where === 'vps'
              ? `VPS の空いている CPU で今月 ${hours(j.ran)} vCPU 時間進みました（追加の費用はかかりません）`
              : j.blockedBy
                ? '今のプランの込み分を超えて止まるので、今月は動かせませんでした'
                : `サーバーレスで今月流しました（追加の費用 約 $${Math.round(j.usd).toLocaleString()}）`}
          </div>
        </div>
      ))}
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
