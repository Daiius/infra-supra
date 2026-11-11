// プライバシーポリシーの画面（D-134・D-153・prd/15 §4・ST-09）。設定のダイアログと、画面の下のリンクから開く。
// 文は送る中身（stats-client.ts の submissionOf と packages/stats の表）と合わせる。中身を変えたら最終更新日も直す。
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { statsEnabled } from './stats-client.ts';

export const PRIVACY_UPDATED = '2026-11-09';

/** 送る情報（prd/15 §4 の表と同じ並び）。 */
export const SENT_ITEMS = [
  'シナリオ',
  '乱数のシードと始めた日',
  '構成（構成・フレームワーク・部品・ページの描き方の設定）',
  '月ごとに選んだ行動',
  '振り返りの 4 つの軸の値（所持金・満足度の平均・機能開発の累計・費用の合計）',
  'プレイごとのランダムな id（同じプレイの送り直しを 1 件に数えるためのものです。端末やあなたを識別するものではありません）',
  '開始のときに受け取る使い捨ての番号（新しいプレイを始めるときに集計のサーバーから受け取り、終わったときに一緒に送ります。短い時間に大量に送られた結果を分布から外すためのもので、個人を識別しません）',
  '終わり方（完走か途中終了か・その理由と月）',
  '「この月に戻る」を使ったかどうか',
];

/** 送らない・保存しない情報。 */
export const NOT_SENT_ITEMS = [
  '名前・メールアドレスなど、あなたを特定する情報（アカウント・ログインはありません）',
  'IP アドレス',
  '端末の情報（User-Agent・画面の大きさなど）',
];

export function PrivacyPolicyDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const enabled = statsEnabled();
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="privacy-dialog-title"
      data-privacy-policy
      onClose={onClose}
    >
      <div className="modal-box flex flex-col overflow-hidden max-w-2xl">
        {/* 見出しと × は固定し、本文だけスクロールする（D-208） */}
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2
            id="privacy-dialog-title"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <ShieldCheck aria-hidden className="size-5" />
            プライバシーポリシー
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="プライバシーポリシーを閉じる"
            >
              ✕
            </button>
          </form>
        </div>
        <div
          className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-4 text-sm"
          data-modal-scroll
        >
          <p>
            このアプリ（infra-supra）がゲームのプレイを終えたときに送る情報と、その扱いを説明します。
          </p>
          {!enabled && (
            <p
              className="rounded-box border border-info/40 p-2"
              data-privacy-off
            >
              今は集計のサーバーを準備しているところで、まだ何も送っていません。送り始めた後は、下に書いた情報を送ります。
            </p>
          )}
          <section className="space-y-1">
            <h3 className="font-bold">送る情報</h3>
            <p>
              ゲームのプレイが終わったとき（12
              か月の完走と途中終了の両方）に、次の情報を 1 プレイにつき 1
              回、自動で匿名のまま送ります。送るのを止める設定はありません。
            </p>
            <ul className="list-disc pl-5" data-privacy-sent>
              {SENT_ITEMS.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
          <section className="space-y-1">
            <h3 className="font-bold">使い道</h3>
            <p>
              利用の分析のために使います。遊んだ人の結果の分布を作って振り返りの画面に出すことと、ゲームのバランスを見直すことです。
              送られた行動は同じゲームの計算で再生し直し、値が合わない送信は保存しません。短い時間に大量に送られたと見える結果は、保存しても分布には入れません。
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-bold">送らない・保存しない情報</h3>
            <ul className="list-disc pl-5" data-privacy-not-sent>
              {NOT_SENT_ITEMS.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p>
              集計のサーバーとそのログには IP アドレスを残しません。画面の配信と
              /api への中継には Vercel を使っています。Vercel の側の記録は
              Vercel のプライバシーポリシーに従います。
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-bold">保存の期間</h3>
            <p>
              集計の元として、期限を決めずに保存します。匿名で誰のプレイかが分からないため、特定のプレイを選んで消すことはできません。
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-bold">このブラウザに残す記録</h3>
            <p>
              遊んでいる途中のセーブ・前回の構成・結果の履歴などは、このブラウザ（localStorage）にだけ保存し、送りません。設定の「ローカルの記録を消す」で消せます。
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-bold">問い合わせ</h3>
            <p>
              GitHub のリポジトリの{' '}
              <a
                className="link"
                href="https://github.com/Daiius/infra-supra/issues"
                target="_blank"
                rel="noreferrer"
              >
                Issue
              </a>{' '}
              でお知らせください。
            </p>
          </section>
          <p className="opacity-70">
            内容を変えるときは、この画面を更新します。最終更新日:{' '}
            {PRIVACY_UPDATED}
          </p>
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
