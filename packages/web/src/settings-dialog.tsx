// 設定のダイアログ（D-147）。ヘッダーの歯車から開く。遊び方を見る・ローカルの記録を消す（確認つき）・プライバシーポリシー（D-153）。
import { BookOpen, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** 消すものの一覧（画面の確認に出す。消すのは接頭辞 infra-supra: のキー全部。local-records.ts の clearLocalRecords）。 */
const CLEARED = [
  '遊んでいる途中のプレイ（セーブ・前の試行）',
  '前回の構成',
  '結果の履歴（自己ベスト・前回との差の比較の元）',
  'タブと表示の選択',
  '遊び方を見たかどうか・出来事の既読',
];

export function SettingsDialog({
  onHowto,
  onPrivacy,
  onClear,
  onClose,
}: {
  /** 「遊び方を見る」。設定を閉じてから遊び方を開く。 */
  onHowto: () => void;
  /** 「プライバシーポリシー」。設定を閉じてからポリシーを開く（D-153）。 */
  onPrivacy: () => void;
  /** 確認の後の「消す」。 */
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="settings-dialog-title"
      data-settings-dialog
      onClose={onClose}
    >
      <div className="modal-box max-w-md">
        <div className="flex items-start justify-between gap-2">
          <h2
            id="settings-dialog-title"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <Settings aria-hidden className="size-5" />
            設定
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="設定を閉じる"
            >
              ✕
            </button>
          </form>
        </div>
        {confirming ? (
          <section
            className="mt-3 space-y-2"
            aria-labelledby="settings-clear-title"
            data-settings-confirm
          >
            <h3 id="settings-clear-title" className="font-bold">
              ローカルの記録を消しますか？
            </h3>
            <p className="text-sm">
              このブラウザに保存した次の記録を全部消します。元には戻せません。
            </p>
            <p className="text-sm">
              集計に送った結果（匿名。プライバシーポリシーを参照）は、ここでは消えません。
            </p>
            <ul className="list-disc pl-5 text-sm">
              {CLEARED.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="text-sm">
              消した後は始める画面に戻り、遊び方がもう一度開きます。
            </p>
            <div className="modal-action">
              <button
                ref={cancelRef}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirming(false)}
              >
                やめる
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={onClear}
              >
                消す
              </button>
            </div>
          </section>
        ) : (
          <div className="mt-3 space-y-4">
            <section className="space-y-1">
              <h3 className="font-bold">遊び方</h3>
              <p className="text-sm opacity-70">
                ゲームの流れ・満足度・開発の手間・上限・終わり方を図で説明します。
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={onHowto}
              >
                <BookOpen aria-hidden className="size-4" />
                遊び方を見る
              </button>
            </section>
            <section className="space-y-1">
              <h3 className="font-bold">送る情報</h3>
              <p className="text-sm opacity-70">
                終わったプレイの結果（構成・行動・4
                つの軸など）を匿名で送ります。名前・IP・端末の情報は送りません。
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={onPrivacy}
              >
                <ShieldCheck aria-hidden className="size-4" />
                プライバシーポリシー
              </button>
            </section>
            <section className="space-y-1">
              <h3 className="font-bold">ローカルの記録</h3>
              <p className="text-sm opacity-70">
                セーブ・前回の構成・結果の履歴などは、このブラウザに保存しています。
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline btn-error"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden className="size-4" />
                ローカルの記録を消す…
              </button>
            </section>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="背景を押して閉じる" tabIndex={-1}>
          閉じる
        </button>
      </form>
    </dialog>
  );
}
