// 遊び方の 2〜7 ページ（機能ごとの詳しい説明。「詳しい説明を見る」で開く。D-146・D-214）。
import {
  Bell,
  CloudOff,
  Code,
  Coins,
  Equal,
  Eye,
  Flag,
  Gavel,
  Hammer,
  History,
  Image,
  Info,
  Layers,
  Lightbulb,
  type LucideIcon,
  MessagesSquare,
  Minus,
  OctagonX,
  Play,
  Puzzle,
  Receipt,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Smile,
  Snail,
  TrendingDown,
  TrendingUp,
  Trophy,
  Undo2,
  UserMinus,
  Wallet,
  WandSparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { hitLabel } from '../premise-view.ts';
import { Node, Arrow, Flow, Figure, FigureTitle } from './figure.tsx';

/** 2 ページ目: 始め方。 */
export function SetupPage() {
  return (
    <>
      <Figure label="図: ① インフラの構成と ② フレームワークと描き方を選んで、運営を始める">
        <Flow>
          <Node
            Icon={Layers}
            tone="primary"
            label="① インフラの構成"
            sub="事業者のプランと部品（DB・画像・メールなど）"
          />
          <Arrow />
          <Node
            Icon={Code}
            tone="secondary"
            label="② フレームワークと描き方"
            sub="ページごとの描き方・再検証の間隔"
          />
          <Arrow />
          <Node
            Icon={Play}
            tone="success"
            label="運営を始める"
            sub="1 か月目の費用の見込みを見て"
          />
        </Flow>
        <FigureTitle>迷ったときの近道</FigureTitle>
        <div className="grid gap-1 sm:grid-cols-3">
          <Node
            Icon={WandSparkles}
            tone="accent"
            label="残りを既定にする"
            sub="選び残した部品を既定の部品で埋めます"
          />
          <Node
            Icon={History}
            tone="info"
            label="前回の構成を選ぶ"
            sub="前回の選択をまとめて戻します（2 回目から）"
          />
          <Node Icon={Info} label="ⓘ" sub="詳しい説明・選択肢の比較と月額" />
        </div>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>① と ② はタブで切り替えます。どちらから選んでもかまいません。</li>
        <li>
          部品はスロット（役割）ごとに選びます。全部選ぶまで始められませんが、選び残しは「残りを既定にする」で埋められます。
        </li>
        <li>
          部品の ⓘ
          を開くと、選択肢ごとの月額（構成全体）と上限を見比べられます。既定の部品が正解とは限りません。
        </li>
      </ul>
    </>
  );
}

/** 3 ページ目: 毎月の流れ。 */
export function MonthPage() {
  return (
    <>
      <Figure label="図: アクションを選んで次の月へ進むと、その月の収益と費用が所持金に反映され、イベントと開発依頼が届く。これを 12 か月繰り返す">
        <FigureTitle>1 か月の流れ（12 回繰り返す）</FigureTitle>
        <Flow>
          <Node
            Icon={Wrench}
            tone="info"
            label="アクションを選ぶ"
            sub="手間を使って設定・最適化・乗り換え"
          />
          <Arrow />
          <Node Icon={Repeat} tone="primary" label="次の月へ" />
          <Arrow />
          <Node
            Icon={Wallet}
            tone="success"
            label="その月の結果"
            sub="費用の明細・上限の使用率・満足度"
          />
          <Arrow />
          <Node
            Icon={Bell}
            tone="warning"
            label="イベント・開発依頼"
            sub="ダイアログで知らせます"
          />
        </Flow>
        <FigureTitle>所持金の増減</FigureTitle>
        <Flow>
          <Node
            Icon={Coins}
            tone="success"
            label="収益"
            sub="PV と満足度で決まる"
          />
          <Minus
            aria-hidden
            className="size-4 shrink-0 self-center opacity-60"
          />
          <Node
            Icon={Receipt}
            tone="error"
            label="費用"
            sub="実在の料金表で計算"
          />
          <Equal
            aria-hidden
            className="size-4 shrink-0 self-center opacity-60"
          />
          <Node Icon={Wallet} label="所持金に足し引き" />
        </Flow>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Lightbulb
            aria-hidden
            className="mr-1 inline size-4 align-text-bottom text-primary"
          />
          開発依頼（機能追加など）は、アクションの欄で受けるか断るかを選びます。選ばずに「次の月へ」進むと断ったことになります。
        </li>
        <li>
          推移のグラフで、所持金・PV・上限の使用率がこの先どうなりそうかを確かめられます。
        </li>
        <li>
          うまくいかなかった月は、画面の上の「戻る…」（狭い画面では
          <Undo2
            aria-hidden
            className="mx-0.5 inline size-4 align-text-bottom"
          />
          のボタン）か、履歴の「この月に戻る」でやり直せます。
        </li>
      </ul>
    </>
  );
}

/** 4 ページ目: 満足度。 */
export function SatisfactionPage() {
  const elements: { Icon: LucideIcon; label: string; sub: string }[] = [
    { Icon: ShieldCheck, label: '可用性', sub: '止まらない' },
    { Icon: Zap, label: '速さ', sub: 'ページが速く開く' },
    { Icon: Puzzle, label: '機能', sub: '機能開発の累計 / 期待' },
    { Icon: RefreshCw, label: '反映スピード', sub: '更新がすぐ見える' },
    { Icon: Image, label: '画質', sub: '画像の見た目' },
  ];
  return (
    <>
      <Figure label="図: 可用性・速さ・機能・反映スピード・画質の 5 つの要素から満足度が決まり、高ければ口コミで、低ければ解約で PV が増減して収益に効く">
        <FigureTitle>5 つの要素（それぞれ 良い・普通・悪い）</FigureTitle>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
          {elements.map((e) => (
            <Node key={e.label} tone="primary" {...e} />
          ))}
        </div>
        <Arrow dir="down" />
        <Node
          Icon={Smile}
          tone="secondary"
          label="満足度（0〜1）"
          sub="要素を重みで合わせた値。重みはシナリオで違います"
        />
        <div className="grid gap-1 sm:grid-cols-2">
          <Node
            Icon={MessagesSquare}
            tone="success"
            label={
              <>
                高い → 口コミで伸びる{' '}
                <TrendingUp aria-hidden className="inline size-4" />
              </>
            }
          />
          <Node
            Icon={UserMinus}
            tone="error"
            label={
              <>
                低い → 解約が増える{' '}
                <TrendingDown aria-hidden className="inline size-4" />
              </>
            }
          />
        </div>
        <Flow>
          <Node Icon={Eye} label="PV の伸び" sub="来月以降の規模" />
          <Arrow />
          <Node Icon={Coins} tone="success" label="収益" />
          <Arrow />
          <Node
            Icon={Receipt}
            tone="error"
            label="費用・上限の使用率"
            sub="PV が増えると上がる"
          />
        </Flow>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          止まった月は可用性が大きく下がります。上限で遅くなった月・ページが重い月は速さが下がります。
        </li>
        <li>
          どの要素が下がったかと、その理由は、月の結果の満足度の内訳に出ます。
        </li>
        <li>12 か月の満足度の平均は、完走した後の振り返りの軸の 1 つです。</li>
      </ul>
    </>
  );
}

/** 手間の棒の例（10 マス）の塗り分け。色はゲーム中の手間の棒（game-screen/effort.tsx の EffortBreakdownView）と同じ。 */
const EFFORT_EXAMPLE: { label: string; n: number; cls: string }[] = [
  { label: '自前運用の維持・他の事業者の管理', n: 2, cls: 'bg-warning' },
  { label: 'イベントへの対応', n: 1, cls: 'bg-error' },
  { label: '乗り換え・移し替え', n: 2, cls: 'bg-secondary' },
  { label: 'アクション（設定・最適化・部品）', n: 1, cls: 'bg-info' },
  { label: '機能開発（残り）', n: 4, cls: 'bg-success' },
];

/** 5 ページ目: 開発の手間。 */
export function EffortPage() {
  return (
    <>
      <Figure label="図: 毎月の手間から運用・イベントへの対応・乗り換え・アクションに使った残りが機能開発に回り、満足度の機能と PV の伸びに効く">
        <FigureTitle>毎月の手間（例: 10 ポイント）の使い道</FigureTitle>
        <div className="flex gap-0.5" aria-hidden>
          {EFFORT_EXAMPLE.flatMap((p) =>
            Array.from({ length: p.n }, (_, i) => (
              <span
                key={`${p.label}:${i}`}
                className={clsx('h-5 flex-1 rounded-sm', p.cls)}
              />
            )),
          )}
        </div>
        <ul className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
          {EFFORT_EXAMPLE.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={clsx('size-2.5 shrink-0 rounded-sm', p.cls)}
              />
              {p.label} {p.n}
            </li>
          ))}
        </ul>
        <Flow>
          <Node
            Icon={Hammer}
            tone="success"
            label="機能開発に回った手間"
            sub="運用に取られなかった残り"
          />
          <Arrow />
          <Node
            Icon={Puzzle}
            tone="primary"
            label="満足度の「機能」"
            sub="累計 / 期待"
          />
          <Arrow />
          <Node Icon={TrendingUp} tone="success" label="PV の伸び" />
        </Flow>
        <FigureTitle>「毎月 手間 3 を 2 か月（合計 6）」の読み方</FigureTitle>
        <div
          className="flex flex-wrap items-center gap-1 text-xs"
          data-howto-effort-months
        >
          <span className="rounded-sm border border-base-300 bg-base-100 px-2 py-1 opacity-70">
            今月 0
          </span>
          <span className="rounded-sm bg-error/15 px-2 py-1 font-bold">
            翌月 3
          </span>
          <span className="rounded-sm bg-error/15 px-2 py-1 font-bold">
            翌々月 3
          </span>
          <span className="rounded-sm border border-base-300 bg-base-100 px-2 py-1 opacity-70">
            その後 0
          </span>
          <span className="opacity-80">= 合わせて 6</span>
        </div>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          手間は、毎月使える作業量の単位です（ゲーム上の仮定。単位はポイント）。「毎月
          手間 n を m か月（合計 n × m）」は、翌月から m か月のあいだ、毎月 n
          ポイントを使うという意味です。その間は機能開発に回る分が n
          ずつ減ります。
        </li>
        <li>
          機能追加の開発依頼を受けたときの作業は、機能開発に数えます（ほかの対応は数えません）。
        </li>
        <li>
          自前で運用する構成（VPS
          など）は毎月の維持の手間がかかり、まれに自前の障害も起きます。運用に手間を取られる構成ほど、③
          機能開発の累計が低くなります。
        </li>
      </ul>
    </>
  );
}

/** 6 ページ目: 上限。 */
export function LimitsPage() {
  return (
    <>
      <Figure label="図: 上限の使用率の目盛りと、止まる上限・遅くなる上限・課金の境目・規約の制限の 4 種類">
        <FigureTitle>上限の使用率</FigureTitle>
        <ol className="grid grid-cols-4 gap-0.5 text-center text-[11px] leading-tight sm:text-xs">
          <li className="rounded-sm bg-base-300 px-1 py-1">
            まだ遠い
            <span className="block tabular-nums opacity-70">〜50%</span>
          </li>
          <li className="rounded-sm bg-info/25 px-1 py-1">
            あと少し
            <span className="block tabular-nums opacity-70">50〜90%</span>
          </li>
          <li className="rounded-sm bg-warning/40 px-1 py-1">
            ギリギリ
            <span className="block tabular-nums opacity-70">90〜100%</span>
          </li>
          <li className="rounded-sm bg-error/30 px-1 py-1">
            達した
            <span className="block tabular-nums opacity-70">100%〜</span>
          </li>
        </ol>
        <div className="grid gap-1 sm:grid-cols-2">
          <Node
            Icon={OctagonX}
            tone="error"
            label="止まる上限"
            sub="無料プランの上限・プランの変更が要る上限。達した月はサイトが止まります"
          />
          <Node
            Icon={Snail}
            tone="warning"
            label="遅くなる上限"
            sub="達すると遅くなる・一部が届かない（止まりはしない）"
          />
          <Node
            Icon={Receipt}
            tone="info"
            label="課金の境目"
            sub="込みの量を超えた分は従量で請求（止まらない）"
          />
          <Node
            Icon={Gavel}
            tone="secondary"
            label="規約の制限"
            sub="非商用の条件など。違反すると指摘を受けます"
          />
        </div>
      </Figure>
      <ul className="space-y-1.5">
        <li>
          <span className="badge badge-sm badge-error mr-1">
            ✗ {hitLabel('block')}
          </span>
          止まる・遅くなる上限に届いた印です。止まる上限なら、その月は収益が減り、可用性が下がり、「止まった月」に
          1 回数えます。遅くなる上限なら、速さなどの満足度の要素が下がります。
        </li>
        <li>
          <span className="badge badge-sm badge-warning mr-1">
            ● {hitLabel('cost')}
          </span>
          課金の境目を超えた印です。止まりませんが、超えた分の費用がかかります。
        </li>
        <li>
          <span className="badge badge-sm badge-ghost mr-1">
            止まる上限に達する数 +1
          </span>
          描き方などの案の横の数は、その案にすると達する止まる上限が 1
          つ増えることを表します（−1 なら 1 つ減る）。
        </li>
        <li>
          手前で気づくには、推移の「○
          か月後に超える見込み」と、プランの変更・部品の切り替えのアクションを使います。
        </li>
      </ul>
    </>
  );
}

/** 7 ページ目: 終わり方と振り返り。 */
export function EndingPage() {
  return (
    <>
      <Figure label="図: 12 か月を走り切ると 4 つの軸で振り返り、3 つの条件のどれかで途中終了するとヒントが出る">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1 rounded-box border-2 border-success bg-base-100 p-2">
            <div className="flex items-center gap-1 text-sm font-bold">
              <Flag aria-hidden className="size-4 text-success" />
              完走（12 か月を走り切る）
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Node Icon={Wallet} label="① 所持金" sub="最後の月" />
              <Node Icon={Smile} label="② 満足度" sub="12 か月の平均" />
              <Node Icon={Puzzle} label="③ 機能開発" sub="累計" />
              <Node
                Icon={Receipt}
                label="④ 費用の合計"
                sub="インフラの費用（良し悪しは付けない）"
              />
            </div>
            <Arrow dir="down" />
            <Node
              Icon={Trophy}
              tone="success"
              label="この端末の過去の完走と比べる"
              sub="自己ベスト・前回との差・順位（④ は前回との差だけ）"
            />
          </div>
          <div className="space-y-1 rounded-box border-2 border-error/60 bg-base-100 p-2">
            <div className="flex items-center gap-1 text-sm font-bold">
              <OctagonX aria-hidden className="size-4 text-error-strong" />
              途中終了（どれか 1 つ）
            </div>
            <Node
              Icon={CloudOff}
              tone="error"
              label="止まった月が 2 回を超えた"
            />
            <Node Icon={Wallet} tone="error" label="所持金が尽きた" />
            <Node
              Icon={Gavel}
              tone="error"
              label="規約違反の指摘を受けた翌月も違反したまま"
            />
            <Arrow dir="down" />
            <Node
              Icon={Lightbulb}
              tone="primary"
              label="次のプレイへのヒント"
            />
          </div>
        </div>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          合否はありません。4 つの軸を 1
          つの点数にまとめず、軸ごとに過去の自分と見比べます。
        </li>
        <li>
          所持金だけで比べると、開発が大変な構成が勝ち筋に見えることがあります。③
          機能開発の累計も合わせて見てください。
        </li>
        <li>
          ④
          費用の合計は、高いから良い・低いから良いという軸ではありません。どの構成でいくら払ったかを見返すために出します。
        </li>
        <li>
          所持金には目標の目安があります（推移のグラフの点線）。下回っても完走になります。
        </li>
      </ul>
    </>
  );
}
