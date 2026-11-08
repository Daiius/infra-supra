// 遊び方のダイアログ（D-146）。初めてゲームモードを開いたときに自動で開き、あとは設定の「遊び方を見る」・ヘッダーの「遊び方」で開く。
// 各ページに lucide-react のアイコンを組み合わせた図を置く（生成画像・ラスタは使わない。色は daisyUI のトークンだけで、ダークモードでも替わる）。
// ページ送りは出来事のダイアログ（game-screen.tsx の EventsDialog）と同じ作法: 見出しの下のナビ・固定の高さ・左右の矢印キー・横のスワイプ。
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Bell,
  CalendarDays,
  CloudOff,
  Code,
  Coins,
  Equal,
  Eye,
  Flag,
  Gamepad2,
  Gauge,
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
  UserMinus,
  Wallet,
  WandSparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './motion.tsx';

/** 図の箱の色（daisyUI のテーマの色。Tailwind が拾えるよう、クラスは文字列のまま書く）。 */
const TONE = {
  neutral: { box: 'border-base-300 bg-base-100', icon: 'text-base-content/70' },
  primary: { box: 'border-primary/40 bg-primary/5', icon: 'text-primary' },
  secondary: {
    box: 'border-secondary/40 bg-secondary/5',
    icon: 'text-secondary',
  },
  accent: { box: 'border-accent/40 bg-accent/5', icon: 'text-accent' },
  info: { box: 'border-info/40 bg-info/5', icon: 'text-info' },
  success: { box: 'border-success/50 bg-success/5', icon: 'text-success' },
  warning: { box: 'border-warning/50 bg-warning/5', icon: 'text-warning' },
  error: { box: 'border-error/40 bg-error/5', icon: 'text-error' },
} as const;
type Tone = keyof typeof TONE;

/** 図の 1 つの箱（印・名前・短い説明）。 */
function Node({
  Icon,
  label,
  sub,
  tone = 'neutral',
  className = '',
}: {
  Icon: LucideIcon;
  label: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-box border px-2 py-1.5 ${TONE[tone].box} ${className}`}
      data-howto-node
    >
      <Icon
        aria-hidden
        className={`mt-0.5 size-5 shrink-0 ${TONE[tone].icon}`}
      />
      <div className="min-w-0 leading-snug">
        <div className="text-sm font-bold">{label}</div>
        {sub && <div className="text-xs opacity-75">{sub}</div>}
      </div>
    </div>
  );
}

/** 流れの矢印。flow は狭い画面で下向き・sm 以上で右向き（箱の並びと合わせる）。 */
function Arrow({ dir = 'flow' }: { dir?: 'flow' | 'down' }) {
  const Icon = dir === 'down' ? ArrowDown : ArrowRight;
  return (
    <Icon
      aria-hidden
      className={`size-4 shrink-0 self-center opacity-50 ${dir === 'flow' ? 'rotate-90 sm:rotate-0' : 'mx-auto block'}`}
    />
  );
}

/** 箱を矢印でつないだ 1 列（狭い画面では縦に並べる）。 */
function Flow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:[&>[data-howto-node]]:flex-1">
      {children}
    </div>
  );
}

/** 図の面（ページの本文の上）。 */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure
      className="space-y-2 rounded-box bg-base-200 p-2 sm:p-3"
      aria-label={label}
      data-howto-figure
    >
      {children}
    </figure>
  );
}

/** 図の中の小見出し。 */
const FigureTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-bold opacity-70">{children}</div>
);

/** 前置き（D-146。ユーザーの決定）: ゲームであり、実際の開発より大幅に単純化していること。始める画面の下にも同じ趣旨の 1 行を置く。 */
export const PREMISE_NOTE =
  'これはゲームで、実際の開発より大幅に単純化されています。';

/** 1 ページ目: このゲームについて。 */
function AboutPage() {
  return (
    <>
      <Figure label="図: 構成を選び、12 か月運営して、完走したら振り返る">
        <ol className="flex flex-wrap items-center gap-1" aria-label="12 か月">
          {Array.from({ length: 12 }, (_, i) => (
            <li
              key={i}
              className="flex size-6 items-center justify-center rounded-sm bg-primary/15 text-xs tabular-nums"
            >
              {i + 1}
            </li>
          ))}
          <li className="flex items-center gap-1 pl-1 text-xs font-bold">
            <Flag aria-hidden className="size-4 text-success" />
            完走
          </li>
        </ol>
        <Flow>
          <Node
            Icon={Layers}
            tone="primary"
            label="構成を選ぶ"
            sub="事業者のプラン・部品・フレームワーク"
          />
          <Arrow />
          <Node
            Icon={CalendarDays}
            tone="info"
            label="毎月の運営"
            sub="12 か月。出来事に応じて手を打つ"
          />
          <Arrow />
          <Node
            Icon={Trophy}
            tone="success"
            label="振り返り"
            sub="4 つの軸で見比べる"
          />
        </Flow>
      </Figure>
      <p>
        Web アプリ（記事のコミュニティなど）のインフラを選び、12
        か月運営するゲームです。PV
        が伸びると費用も上限の使用率も上がっていきます。どの構成にどんな得意・不得意があるかを、月ごとの費用と出来事で確かめます。
      </p>
      <p
        className="flex items-start gap-2 rounded-box border border-info/50 bg-info/5 p-2 text-sm"
        data-howto-premise
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <span>
          {PREMISE_NOTE}
          料金・制限は実在の公式の料金表（出典つき）で計算しますが、収益・PV
          の伸び・満足度・開発の手間・出来事はゲーム上の仮定です。
        </span>
      </p>
      <p className="text-sm opacity-70">
        この説明は、画面の右上の歯車（設定）と「遊び方」から、いつでも見直せます。
      </p>
    </>
  );
}

/** 2 ページ目: 始め方。 */
function SetupPage() {
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
function MonthPage() {
  return (
    <>
      <Figure label="図: 行動を選んで次の月へ進むと、その月の収益と費用が所持金に反映され、出来事と提案が届く。これを 12 か月繰り返す">
        <FigureTitle>1 か月の流れ（12 回繰り返す）</FigureTitle>
        <Flow>
          <Node
            Icon={Wrench}
            tone="info"
            label="行動を選ぶ"
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
            label="出来事・提案"
            sub="ダイアログで知らせます"
          />
        </Flow>
        <FigureTitle>所持金の増減</FigureTitle>
        <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:[&>[data-howto-node]]:flex-1">
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
        </div>
      </Figure>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Lightbulb
            aria-hidden
            className="mr-1 inline size-4 align-text-bottom text-primary"
          />
          提案（機能追加の依頼など）は、行動の欄で受けるか断るかを選びます。選ばずに「次の月へ」進むと断ったことになります。
        </li>
        <li>
          推移のグラフで、所持金・PV・上限の使用率がこの先どうなりそうかを確かめられます。
        </li>
        <li>うまくいかなかった月は、履歴の「この月に戻る」でやり直せます。</li>
      </ul>
    </>
  );
}

/** 4 ページ目: 満足度。 */
function SatisfactionPage() {
  const elements: { Icon: LucideIcon; label: string; sub: string }[] = [
    { Icon: ShieldCheck, label: '可用性', sub: '止まらない' },
    { Icon: Zap, label: '速さ', sub: 'ページが速く開く' },
    { Icon: Puzzle, label: '機能', sub: '機能開発の累計 / 期待' },
    { Icon: RefreshCw, label: '鮮度', sub: '更新がすぐ見える' },
    { Icon: Image, label: '画質', sub: '画像の見た目' },
  ];
  return (
    <>
      <Figure label="図: 可用性・速さ・機能・鮮度・画質の 5 つの要素から満足度が決まり、高ければ口コミで、低ければ解約で PV が増減して収益に効く">
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

/** 手間の棒の例（10 マス）の塗り分け。色はゲーム中の手間の棒（game-screen.tsx の EffortBreakdownView）と同じ。 */
const EFFORT_EXAMPLE: { label: string; n: number; cls: string }[] = [
  { label: '自前運用の維持・他の事業者の管理', n: 2, cls: 'bg-warning' },
  { label: '出来事への対応', n: 1, cls: 'bg-error' },
  { label: '乗り換え・移し替え', n: 2, cls: 'bg-secondary' },
  { label: '行動（設定・最適化・部品）', n: 1, cls: 'bg-info' },
  { label: '機能開発（残り）', n: 4, cls: 'bg-success' },
];

/** 5 ページ目: 開発の手間。 */
function EffortPage() {
  return (
    <>
      <Figure label="図: 毎月の手間から運用・出来事への対応・乗り換え・行動に使った残りが機能開発に回り、満足度の機能と PV の伸びに効く">
        <FigureTitle>毎月の手間（例: 10 ポイント）の使い道</FigureTitle>
        <div className="flex gap-0.5" aria-hidden>
          {EFFORT_EXAMPLE.flatMap((p) =>
            Array.from({ length: p.n }, (_, i) => (
              <span
                key={`${p.label}:${i}`}
                className={`h-5 flex-1 rounded-sm ${p.cls}`}
              />
            )),
          )}
        </div>
        <ul className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
          {EFFORT_EXAMPLE.map((p) => (
            <li key={p.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-sm ${p.cls}`}
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
        <FigureTitle>「手間 3 × 2 か月」の読み方</FigureTitle>
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
          「手間 n × m か月」は、翌月から m か月のあいだ、毎月 n
          ポイントを使うという意味です。その間は機能開発に回る分が n
          ずつ減ります。
        </li>
        <li>
          機能追加の提案を受けたときの作業は、機能開発に数えます（ほかの対応は数えません）。
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
function LimitsPage() {
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
            ✗ 上限に達した
          </span>
          止まる・遅くなる上限に届いた印です。止まる上限なら、その月は収益が減り、可用性が下がり、「止まった月」に
          1 回数えます。遅くなる上限なら、速さなどの満足度の要素が下がります。
        </li>
        <li>
          <span className="badge badge-sm badge-warning mr-1">
            ● 超過（課金）
          </span>
          課金の境目を超えた印です。止まりませんが、超えた分の費用がかかります。
        </li>
        <li>
          <span className="badge badge-sm badge-ghost mr-1">止まる上限 +1</span>
          描き方などの案の横の数は、その案にすると達する止まる上限が 1
          つ増えることを表します（−1 なら 1 つ減る）。
        </li>
        <li>
          手前で気づくには、推移の「○
          か月後に超える見込み」と、プランの変更・部品の切り替えの行動を使います。
        </li>
      </ul>
    </>
  );
}

/** 7 ページ目: 終わり方と振り返り。 */
function EndingPage() {
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
                Icon={Gauge}
                label="④ ギリギリ"
                sub="上限の 90〜100% の月（ジョーク枠）"
              />
            </div>
            <Arrow dir="down" />
            <Node
              Icon={Trophy}
              tone="success"
              label="この端末の過去の完走と比べる"
              sub="自己ベスト・前回との差・順位"
            />
          </div>
          <div className="space-y-1 rounded-box border-2 border-error/60 bg-base-100 p-2">
            <div className="flex items-center gap-1 text-sm font-bold">
              <OctagonX aria-hidden className="size-4 text-error" />
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
      </ul>
    </>
  );
}

/** ページの並び（D-146）。題はナビの点の名前にも使う。 */
export const HOWTO_PAGES: {
  title: string;
  Icon: LucideIcon;
  body: () => ReactNode;
}[] = [
  { title: 'このゲームについて', Icon: Gamepad2, body: AboutPage },
  { title: '始め方', Icon: Layers, body: SetupPage },
  { title: '毎月の流れ', Icon: CalendarDays, body: MonthPage },
  { title: '満足度', Icon: Smile, body: SatisfactionPage },
  { title: '開発の手間', Icon: Hammer, body: EffortPage },
  { title: '上限', Icon: Gauge, body: LimitsPage },
  { title: '終わり方と振り返り', Icon: Flag, body: EndingPage },
];

/**
 * 遊び方のダイアログ。× ・Esc・背景・「閉じる」・最後のページの「始める」で閉じる（どれでも onClose）。
 * first: 初めて自動で開いたとき（最後のページのボタンを「始める」にする。ほかは「閉じる」）。
 */
export function HowtoDialog({
  first,
  onClose,
}: {
  first: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [view, setView] = useState({ page: 0, dir: 0 });
  const { page, dir } = view;
  const n = HOWTO_PAGES.length;
  const last = page === n - 1;
  const current = HOWTO_PAGES[page]!;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // ページを移ったら本文を先頭へ戻す。押したボタンが端で押せなくなったら、次へ（最後のページでは「始める」）へフォーカスを移す
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    bodyRef.current?.scrollTo?.({ top: 0 });
    const a = document.activeElement;
    if (
      a instanceof HTMLButtonElement &&
      !a.disabled &&
      ref.current?.contains(a)
    )
      return;
    (last ? doneRef : nextRef).current?.focus();
  }, [page, last]);
  const go = (to: number) => {
    if (to < 0 || to >= n || to === page) return;
    moved.current = true;
    setView({ page: to, dir: to > page ? 1 : -1 });
  };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const Body = current.body;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="howto-dialog-title"
      data-howto-dialog
      onClose={onClose}
      onKeyDown={(k) => {
        if (k.key === 'ArrowRight') go(page + 1);
        else if (k.key === 'ArrowLeft') go(page - 1);
      }}
    >
      {/* 高さを一定にする（modal は縦中央なので、ページで高さが変わると上端・ナビが上下に動く。D-146） */}
      <div className="modal-box flex h-[min(42rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-11/12 max-w-2xl flex-col overflow-hidden px-3 sm:px-6">
        <div className="flex shrink-0 items-start justify-between gap-2">
          <h2
            id="howto-dialog-title"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <BookOpen aria-hidden className="size-5 text-primary" />
            遊び方
          </h2>
          <form method="dialog">
            <button
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="遊び方を閉じる"
            >
              ✕
            </button>
          </form>
        </div>
        <nav
          className="mt-3 shrink-0 space-y-2 border-b border-base-300 pb-3"
          aria-label="遊び方のページ"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={page === 0}
              onClick={() => go(page - 1)}
            >
              ← 前へ
            </button>
            <span
              className="min-w-12 text-center text-sm tabular-nums"
              aria-hidden
              data-howto-position
            >
              {page + 1} / {n}
            </span>
            <button
              ref={nextRef}
              type="button"
              className="btn btn-primary btn-sm"
              disabled={last}
              autoFocus
              onClick={() => go(page + 1)}
            >
              次へ →
            </button>
          </div>
          <span className="sr-only" aria-live="polite">
            {n} ページ中 {page + 1} ページ目: {current.title}
          </span>
          <ol className="flex items-center gap-0.5" data-howto-dots>
            {HOWTO_PAGES.map((p, i) => (
              <li key={p.title}>
                <button
                  type="button"
                  className="flex h-6 items-center px-1"
                  aria-label={`${i + 1} ページ目: ${p.title}`}
                  aria-current={i === page ? 'step' : undefined}
                  title={p.title}
                  onClick={() => go(i)}
                >
                  <span
                    aria-hidden
                    className={`block rounded-full ${
                      i === page
                        ? 'h-2.5 w-2.5 bg-base-content/60'
                        : 'h-1.5 w-1.5 bg-base-content/30'
                    }`}
                  />
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div
          ref={bodyRef}
          className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          data-howto-page={page + 1}
          onTouchStart={(t) => {
            const p = t.touches[0];
            touch.current = p ? { x: p.clientX, y: p.clientY } : null;
          }}
          onTouchEnd={(t) => {
            const s0 = touch.current;
            const p = t.changedTouches[0];
            touch.current = null;
            if (!s0 || !p) return;
            const dx = p.clientX - s0.x;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(p.clientY - s0.y))
              go(dx < 0 ? page + 1 : page - 1);
          }}
        >
          <section
            key={page}
            aria-labelledby="howto-page-title"
            className={`space-y-3 ${
              reduced || dir === 0
                ? ''
                : dir > 0
                  ? 'motion-slide-from-right'
                  : 'motion-slide-from-left'
            }`}
          >
            <h3
              id="howto-page-title"
              className="flex items-center gap-2 font-bold"
            >
              <current.Icon aria-hidden className="size-5 text-primary" />
              {current.title}
            </h3>
            <Body />
          </section>
        </div>
        <div className="modal-action mt-3 shrink-0">
          <form method="dialog">
            {last ? (
              <button ref={doneRef} className="btn btn-primary btn-sm">
                {first ? '始める' : '閉じる'}
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm">
                {first ? 'とばす（閉じる）' : '閉じる'}
              </button>
            )}
          </form>
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
