// 過去の月へ戻るダイアログ（D-128・D-192）。ヘッダーの「戻る…」と、これまでの運営の行の「この月に戻る」から開く。
// 戻る先の月を選ぶ → 説明と今の結果がどうなるかを読む → 戻る、を 1 つのダイアログで済ませる。
import { useEffect, useRef, useState } from 'react';

export function RewindDialog({
  months,
  initial,
  current,
  ended,
  previousMonths,
  onConfirm,
  onClose,
}: {
  /** 戻れる月の数（1〜months か月目。行動を選んだ月だけ）。 */
  months: number;
  /** 開いたときに選んでいる月（ヘッダーからは 1 つ前の月、履歴の行からはその行の月）。 */
  initial: number;
  /** 今の試行の月数（今の月・終わった月）。 */
  current: number;
  ended: boolean;
  /** 今ある前の試行の月数（上書きの知らせ）。無ければ null。 */
  previousMonths: number | null;
  onConfirm: (month: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const [month, setMonth] = useState(Math.min(Math.max(initial, 1), months));
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="rewind-dialog-title"
      onClose={onClose}
    >
      <div className="modal-box max-w-md">
        <h2 id="rewind-dialog-title" className="text-lg font-bold">
          過去の月に戻る
        </h2>
        <p className="mt-2 text-sm opacity-80">
          選んだ月の行動を選ぶ前の状態に戻ります。始めたときの選択（シナリオ・構成・部品・乱数のシード）はそのままなので、同じ行動を選べば同じ結果になります。今の結果は「前の試行」として
          1 本だけ残り、推移のグラフに破線で重なります（もう一度戻ると上書き）。
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span>戻る先</span>
          <select
            className="select select-sm w-auto"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            aria-label="戻る先の月"
          >
            {Array.from({ length: months }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} か月目
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 text-sm" data-rewind-summary>
          {`${month} か月目の行動を選ぶ前に戻ります。今の結果（${current} か月目${ended ? 'で終了' : 'まで'}）は「前の試行」として 1 本だけ残ります。`}
        </p>
        {previousMonths !== null && (
          <p className="mt-1 text-sm opacity-70">
            {`今ある前の試行（${previousMonths} か月目まで）は上書きされます。`}
          </p>
        )}
        <div className="modal-action">
          <form method="dialog">
            <button className="btn btn-ghost btn-sm">やめる</button>
          </form>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onConfirm(month)}
          >
            {month} か月目に戻る
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>
  );
}
