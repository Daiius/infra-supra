// 遊び方のダイアログ（D-146）。初めてゲームモードを開いたときに自動で開き、あとは設定の「遊び方を見る」・ヘッダーの「遊び方」で開く。
// 各ページに lucide-react のアイコンを組み合わせた図を置く（生成画像・ラスタは使わない。色は daisyUI のトークンだけで、ダークモードでも替わる）。
// ページ送りは出来事のダイアログ（game-screen.tsx の EventsDialog）と同じ作法: 見出しの下のナビ・固定の高さ・左右の矢印キー・横のスワイプ。
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  BookOpen,
  BookOpenText,
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
  Pause,
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
import {
  FRAMEWORKS,
  frameworkSupported,
  HIDDEN_PLATFORMS,
  type FrameworkId,
  type Platform,
} from 'catalog';
import clsx from 'clsx';
import { RESULT_AXES, USD_JPY } from 'game';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  BrandMark,
  BRANDS,
  FRAMEWORK_BRAND,
  PLATFORM_BRANDS,
  PlatformMarks,
} from './brand-logos.tsx';
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
  error: { box: 'border-error/40 bg-error/5', icon: 'text-error-strong' },
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
      className={clsx(
        'flex min-w-0 items-start gap-2 rounded-box border px-2 py-1.5',
        TONE[tone].box,
        className,
      )}
      data-howto-node
    >
      <Icon
        aria-hidden
        className={clsx('mt-0.5 size-5 shrink-0', TONE[tone].icon)}
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
      className={clsx(
        'size-4 shrink-0 self-center opacity-50',
        dir === 'flow' ? 'rotate-90 sm:rotate-0' : 'mx-auto block',
      )}
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

/** 前置き（D-146。ユーザーの決定）: ゲームであり、実際の開発より大幅に単純化していること。遊び方の 1 ページ目に置く（始める画面の下の 1 行は D-173 でやめた）。 */
export const PREMISE_NOTE =
  'これはゲームで、実際の開発より大幅に単純化されています。';

/**
 * 構成の型（1 ページ目の模式図と表）。数値は持たない（形だけ。料金の数値は画面の明細と ⓘ が出す）。
 * 性質はゲームの計算に合わせる: 無料プランは止まる上限と規約の制限、従量のプランは込みの量を超えた分を請求、
 * VPS は定額で、維持の手間・自前の障害があり、上位プランへの変更は停止と手間（D-27）。
 */
const KINDS = [
  {
    id: 'free',
    label: '無料プラン',
    stroke: 'stroke-success',
    dash: undefined,
  },
  {
    id: 'payg',
    label: '従量のプラン',
    stroke: 'stroke-info',
    dash: '6 3',
  },
  {
    id: 'vps',
    label: '定額の VPS',
    stroke: 'stroke-secondary',
    dash: '2 3',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  stroke: string;
  dash: string | undefined;
}[];

/** 模式図の凡例の線（色と線の形の両方で見分ける）。 */
function LegendLine({
  kind,
}: {
  kind: { stroke: string; dash?: string | undefined };
}) {
  return (
    <svg aria-hidden viewBox="0 0 20 6" className="h-1.5 w-5 shrink-0">
      <line
        x1="0"
        y1="3"
        x2="20"
        y2="3"
        className={kind.stroke}
        strokeWidth="2.5"
        strokeDasharray={kind.dash}
      />
    </svg>
  );
}

/** 模式図の面（軸と軸の名前）。中身は 0〜100 の座標で描く（上が大きい）。 */
function SketchChart({
  title,
  yLabel,
  children,
  label,
}: {
  title: string;
  yLabel: string;
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0 rounded-box border border-base-300 bg-base-100 p-2">
      <div className="text-xs font-bold">{title}</div>
      <div className="mt-1 flex gap-1">
        <div className="flex shrink-0 flex-col items-center gap-0.5 text-[10px] opacity-70">
          <ArrowUp aria-hidden className="size-3" />
          <span className="[writing-mode:vertical-rl]">{yLabel}</span>
        </div>
        <svg
          role="img"
          aria-label={label}
          viewBox="-2 -4 104 108"
          className="h-24 w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <path
            d="M0 0 V100 H100"
            fill="none"
            className="stroke-base-content/40"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          {children}
        </svg>
      </div>
      <div className="mt-0.5 text-right text-[10px] opacity-70">PV →</div>
    </div>
  );
}

/** 模式図の線（vector-effect で、縦横の伸び縮みでも太さを保つ）。 */
const SketchPath = ({
  d,
  className,
  dash,
}: {
  d: string;
  className: string;
  dash?: string | undefined;
}) => (
  <path
    d={d}
    fill="none"
    className={className}
    strokeWidth="2.5"
    strokeDasharray={dash}
    strokeLinejoin="round"
    vectorEffect="non-scaling-stroke"
  />
);

/**
 * 模式図: PV が伸びると、月額と上限の使用率が上がる（月額の伸び方は構成の型で違う）。
 * 1 ページ目が情報過多になったので、今はどこにも出していない（別の場所に出すかもしれないので残す。2026-11-14）。
 */
export function GrowthSketch() {
  const [free, payg, vps] = KINDS;
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
      <SketchChart
        title="月額の費用"
        yLabel="月額"
        label="模式図: 無料プランは 0 のまま上限で止まり、従量のプランは込みの量を超えると使った分だけ増え、定額の VPS は一定で、伸びると上位プランへ段を上がる"
      >
        <SketchPath d="M0 94 H38" className={free.stroke} dash={free.dash} />
        {/* 無料プランが止まる所の ✗ */}
        <path
          d="M34 88 L42 100 M42 88 L34 100"
          className="stroke-error"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        <SketchPath
          d="M0 84 H35 L100 10"
          className={payg.stroke}
          dash={payg.dash}
        />
        <SketchPath
          d="M0 62 H62 V42 H100"
          className={vps.stroke}
          dash={vps.dash}
        />
      </SketchChart>
      <SketchChart
        title="上限の使用率"
        yLabel="使用率"
        label="模式図: PV が伸びると上限の使用率が上がり、100% に達すると止まる・遅くなる・超えた分を請求される"
      >
        <rect
          x="0"
          y="12"
          width="100"
          height="10"
          className="fill-warning/25"
        />
        <path
          d="M0 12 H100"
          className="stroke-error"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        <SketchPath d="M0 92 C40 80 70 40 100 2" className="stroke-primary" />
      </SketchChart>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs col-span-2">
        {KINDS.map((k) => (
          <li key={k.id} className="flex items-center gap-1">
            <LegendLine kind={k} />
            {k.label}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5 shrink-0">
            <path
              d="M1 1 L9 9 M9 1 L1 9"
              className="stroke-error"
              strokeWidth="2"
            />
          </svg>
          上限で止まる
        </li>
        <li className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-0 w-5 border-t-2 border-dashed border-error"
          />
          使用率 100%
        </li>
      </ul>
    </div>
  );
}

/** 表の印（良い・普通・苦手）。色だけに頼らず、印の形も変える。 */
const MARK = {
  good: { sign: '○', cls: 'text-success' },
  fair: { sign: '△', cls: 'text-warning' },
  poor: { sign: '✗', cls: 'text-error-strong' },
} as const;

/** 構成の型ごとの得意・不得意（行 × 型）。 */
const KIND_TRAITS: {
  row: string;
  cells: [keyof typeof MARK, string][];
}[] = [
  {
    row: '小さい規模の月額',
    cells: [
      ['good', 'ほぼかからない'],
      ['good', '少額から'],
      ['fair', '使わなくても定額'],
    ],
  },
  {
    row: '伸びたときの月額',
    cells: [
      ['poor', '上限で止まる'],
      ['fair', '使った分だけ増える'],
      ['good', '定額のまま'],
    ],
  },
  {
    row: '上限に達すると',
    cells: [
      ['poor', '止まる・規約の制限も'],
      ['good', '超えた分を請求'],
      ['fair', '上位プランへ（停止と手間）'],
    ],
  },
  {
    row: '運用の手間',
    cells: [
      ['good', '少ない'],
      ['good', '少ない'],
      ['poor', '維持の手間・自前の障害'],
    ],
  },
];

/**
 * 表: 構成の型ごとの得意・不得意。GrowthSketch と同じ理由で、今はどこにも出していない（2026-11-14）。
 */
export function KindTable() {
  return (
    <table className="table-xs table w-full table-fixed bg-base-100 text-xs">
      <thead>
        <tr>
          <th className="w-[22%]">
            <span className="sr-only">観点</span>
          </th>
          {KINDS.map((k) => (
            <th
              key={k.id}
              scope="col"
              className="text-xs leading-tight whitespace-normal"
            >
              <span className="flex flex-col items-start gap-1">
                <LegendLine kind={k} />
                {k.label}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {KIND_TRAITS.map((t) => (
          <tr key={t.row}>
            <th scope="row" className="leading-tight font-normal opacity-80">
              {t.row}
            </th>
            {t.cells.map(([m, text], i) => (
              <td key={i} className="leading-tight">
                <span className={clsx('mr-0.5 font-bold', MARK[m].cls)}>
                  {MARK[m].sign}
                </span>
                {text}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 収支の概念図に並べる土台の事業者（隠している事業者は出さない。D-100）。 */
const GROWTH_PLATFORMS = (
  [
    'cloudflare',
    'vercel',
    'sakura',
    'aws',
    'gcp',
  ] as const satisfies readonly Platform[]
).filter((p) => !HIDDEN_PLATFORMS.includes(p));

/**
 * 収支の伸び方の型（12 か月・0〜1。どれも右肩上がり）。概念図なので数値の意味は持たず、事業者への割り当ては入れ替える
 * （どの事業者が良いとは言わない。伸び方が選び方と運営で違うことだけを見せる）。右端のロゴが重ならないよう、終わりの値を離す。
 */
const GROWTH_SHAPES: readonly (readonly number[])[] = [
  // 出だしは遅く、後で大きく伸びる
  Array.from({ length: 12 }, (_, i) => 0.04 + 0.94 * (i / 11) ** 2.2),
  // 最初に落ち込んでから伸びる（移行や初期の費用）
  [0.12, 0.07, 0.05, 0.08, 0.14, 0.22, 0.31, 0.4, 0.5, 0.6, 0.69, 0.78],
  // まっすぐ伸びる
  Array.from({ length: 12 }, (_, i) => 0.06 + (0.52 * i) / 11),
  // 早く伸びて頭打ち
  Array.from({ length: 12 }, (_, i) => 0.08 + 0.32 * (1 - (1 - i / 11) ** 2.5)),
  // ゆるやかに伸びる
  Array.from({ length: 12 }, (_, i) => 0.03 + 0.19 * (i / 11) ** 1.3),
];

/** 線の色（事業者の色は黒一色や無いものがあるので、テーマの色を順に使う。ロゴを右端に添えて見分ける）。 */
const GROWTH_STROKES = [
  'stroke-primary',
  'stroke-secondary',
  'stroke-warning',
  'stroke-info',
  'stroke-success',
] as const;

/** 図の座標（幅 100・高さ 100。上が大きい）。 */
const growthY = (v: number) => 96 - v * 90;

/** 0〜1 の 12 点を折れ線の d にする。 */
const sparkPath = (ys: readonly number[]) =>
  ys
    .map(
      (y, i) =>
        `${i === 0 ? 'M' : 'L'}${((i / (ys.length - 1)) * 100).toFixed(1)} ${growthY(y).toFixed(1)}`,
    )
    .join(' ');

/** 並びをランダムに入れ替えた添字（Fisher–Yates。画面の演出だけなので Math.random でよい）。 */
function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 入れ替えの間隔（ミリ秒）。 */
const GROWTH_INTERVAL_MS = 5000;

/**
 * 組ませるフレームワーク（並びは FRAMEWORKS のまま）。概念図ではロゴが同じ Next.js の静的書き出しを出さない
 * （Next.js と並ぶと見分けが煩わしいため）。
 */
const GROWTH_FRAMEWORKS = (Object.keys(FRAMEWORKS) as FrameworkId[]).filter(
  (f) => f !== 'nextjs-export',
);

/** その事業者に載せられるフレームワークから 1 つをランダムに選ぶ（ありえない組み合わせは出さない。D-68）。 */
function pickFramework(p: Platform): FrameworkId {
  const ok = GROWTH_FRAMEWORKS.filter((f) => frameworkSupported(f, p));
  return ok[Math.floor(Math.random() * ok.length)] ?? GROWTH_FRAMEWORKS[0]!;
}

/** 1 回分の割り当て: 伸び方の型の並びと、事業者ごとのフレームワーク。 */
const newRound = (n: number) => ({
  n,
  order: shuffled(GROWTH_SHAPES.length),
  frameworks: GROWTH_PLATFORMS.map(pickFramework),
});

/** 構成とフレームワークの名前（読み上げ・title 用）。 */
const comboName = (p: Platform, f: FrameworkId) =>
  `${PLATFORM_BRANDS[p].map((b) => BRANDS[b].title).join(' + ')} × ${FRAMEWORKS[f].label}`;

/**
 * 1 ページ目の概念図: インフラとフレームワークの組ごとの月ごとの収支の伸びを 1 つのグラフに重ねる。一定の間隔で伸び方の型と
 * フレームワークをランダムに入れ替え、線を左から描き直し、右端のアイコンを新しい終わりの位置へ動かす。動きを減らす設定では入れ替えない。
 */
function GrowthByPlatform() {
  const reduced = useReducedMotion();
  const [round, setRound] = useState(() => newRound(0));
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(
      () => setRound((r) => newRound(r.n + 1)),
      GROWTH_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [reduced]);
  const lines = GROWTH_PLATFORMS.map((p, i) => ({
    p,
    f: round.frameworks[i]!,
    stroke: GROWTH_STROKES[i % GROWTH_STROKES.length]!,
    ys: GROWTH_SHAPES[round.order[i]! % GROWTH_SHAPES.length]!,
  }));
  // 実際に選べる組は 1 つだけなので、12 か月目にいちばん高い線だけを濃く出し、ほかは半透明にする
  const top = Math.max(...lines.map((l) => l.ys.at(-1)!));
  const marked = lines.map((l) => ({ ...l, chosen: l.ys.at(-1) === top }));
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2">
      <div className="flex gap-1">
        <div className="flex shrink-0 flex-col items-center gap-0.5 text-[10px] opacity-70">
          <ArrowUp aria-hidden className="size-3" />
          <span className="[writing-mode:vertical-rl]">月ごとの収支</span>
        </div>
        {/* 右の余白はアイコンの置き場 */}
        <div className="relative min-w-0 flex-1 pr-[6.75rem]" data-howto-growth>
          <svg
            role="img"
            aria-label="概念図: インフラとフレームワークの組ごとに、収支が月を追って右肩上がりに伸びる。伸び方は組ごとに違う"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-36 w-full overflow-visible"
          >
            <path
              d="M0 0 V100 H100"
              fill="none"
              className="stroke-base-content/40"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            {/* 選んだ線を最後に描いて上に重ねる */}
            {[...marked]
              .sort((a, b) => Number(a.chosen) - Number(b.chosen))
              .map(({ p, stroke, ys, chosen }) => (
                <path
                  key={`${p}:${round.n}`}
                  d={sparkPath(ys)}
                  fill="none"
                  className={clsx(
                    'motion-reveal-x',
                    stroke,
                    !chosen && 'opacity-25',
                  )}
                  data-howto-chosen={chosen || undefined}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          </svg>
          {/* 線の右端のアイコン: インフラ × フレームワーク（新しい終わりの位置へ滑らせる） */}
          {marked.map(({ p, f, stroke, ys, chosen }) => (
            <span
              key={p}
              className={clsx(
                'absolute left-[calc(100%-6.5rem)] flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap',
                'transition-[top,opacity] duration-700 ease-out motion-reduce:transition-none',
                chosen ? 'z-10' : 'opacity-30',
              )}
              style={{ top: `${growthY(ys.at(-1)!)}%` }}
              title={comboName(p, f)}
              data-howto-combo={`${p}:${f}`}
            >
              <svg aria-hidden viewBox="0 0 8 4" className="h-1 w-2 shrink-0">
                <line
                  x1="0"
                  y1="2"
                  x2="8"
                  y2="2"
                  className={stroke}
                  strokeWidth="3"
                />
              </svg>
              {/* A（インフラ）と B（フレームワーク）を固定の幅の枠に入れ、× を縦にそろえる */}
              <span className="flex w-10 shrink-0 justify-center">
                <PlatformMarks platform={p} />
              </span>
              <span
                aria-hidden
                className="w-2 text-center text-[10px] opacity-50"
              >
                ×
              </span>
              <span
                key={`${f}:${round.n}`}
                className="motion-pop inline-flex w-10 shrink-0 justify-center"
              >
                <BrandMark
                  brand={FRAMEWORK_BRAND[f].brand}
                  size={14}
                  tag={FRAMEWORK_BRAND[f].tag}
                />
              </span>
              <span className="sr-only">{comboName(p, f)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-0.5 pr-[6.75rem] text-right text-[10px] opacity-70">
        月 →（12 か月）
      </div>
    </div>
  );
}

/** 運営の概念図の所持金（12 か月・0〜1）。4 か月目の出来事で落ち、5 か月目に手を打って持ち直し、8 か月目の提案を受けて伸びる。 */
const MONTHS_CASH = [
  0.22, 0.28, 0.35, 0.2, 0.22, 0.33, 0.42, 0.47, 0.58, 0.68, 0.78, 0.88,
];

/** 運営の概念図の印（何か月目・印・色・名前）。 */
const MONTHS_MARKS = [
  {
    month: 4,
    Icon: Bell,
    badge: 'badge-warning',
    label: 'イベント',
    below: false,
  },
  {
    month: 5,
    Icon: Wrench,
    badge: 'badge-info',
    label: 'アクション',
    below: true,
  },
  {
    month: 8,
    Icon: Lightbulb,
    badge: 'badge-primary',
    label: '開発依頼',
    below: false,
  },
] as const;

/** 運営の概念図の線を引き終えるまで（ミリ秒）。印はその月に線が届いたときに出す。 */
const MONTHS_DRAW_MS = 6000;

/** 1 ページ目の概念図（毎月の運営）: 所持金の線を月を追って引き、出来事・手を打つ・提案の印をその月に出す。 */
function MonthsSketch() {
  // 線の横位置（右の余白 pr-5 = 1.25rem を除いた幅の中での位置。absolute の left は余白を含む幅に対して決まるため）
  const x = (m: number) => `calc((100% - 1.25rem) * ${(m - 1) / 11})`;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2">
      <div className="flex gap-1">
        <div className="flex shrink-0 flex-col items-center gap-0.5 text-[10px] opacity-70">
          <ArrowUp aria-hidden className="size-3" />
          <span className="[writing-mode:vertical-rl]">所持金</span>
        </div>
        <div className="relative min-w-0 flex-1 pr-5">
          <svg
            role="img"
            aria-label="概念図: 所持金が月を追って伸びる。4 か月目のイベントで落ち、5 か月目のアクションで持ち直し、8 か月目の開発依頼を受けてさらに伸びる"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-36 w-full overflow-visible"
          >
            <path
              d="M0 0 V100 H100"
              fill="none"
              className="stroke-base-content/40"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={sparkPath(MONTHS_CASH)}
              fill="none"
              className="motion-reveal-x stroke-success"
              style={{
                animationDuration: `${MONTHS_DRAW_MS}ms`,
                animationTimingFunction: 'linear',
              }}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {MONTHS_MARKS.map((m) => (
            <span
              key={m.month}
              className={clsx(
                'badge badge-sm motion-pop absolute -translate-x-1/2 gap-0.5 px-1',
                !m.below && '-translate-y-full',
                m.badge,
              )}
              style={{
                left: x(m.month),
                // 近い月の札が重ならないよう、線の上と下に分ける
                top: `${growthY(MONTHS_CASH[m.month - 1]!) + (m.below ? 6 : -6)}%`,
                animationDelay: `${((m.month - 1) / 11) * MONTHS_DRAW_MS}ms`,
              }}
            >
              <m.Icon aria-hidden className="size-3" />
              {m.label}
            </span>
          ))}
          {/*
            12 か月目のゴール（線を引き終えたときに出す）。枠線つきの丸い札に旗を入れ、線の終わりに中心を合わせる。
            後ろの波紋（animate-ping）は札の子なので、札が出るまでは見えない。動きを減らす設定では波紋を出さない
          */}
          <span
            aria-hidden
            className="motion-pop absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center"
            style={{
              left: x(12),
              top: `${growthY(MONTHS_CASH[11]!)}%`,
              animationDelay: `${MONTHS_DRAW_MS}ms`,
            }}
            data-howto-goal
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-success/40 motion-reduce:hidden" />
            <span className="relative grid size-7 place-items-center rounded-full border-2 border-success bg-base-100 shadow-sm">
              <Flag className="size-4 text-success" />
            </span>
          </span>
        </div>
      </div>
      <div className="mt-0.5 text-right text-[10px] opacity-70">
        月 →（12 か月）
      </div>
    </div>
  );
}

/** 振り返りの概念図の分布（棒の高さ 0〜1）と自分の位置（棒の添字）。軸ごとに形を変える。 */
const REVIEW_BARS: readonly { bars: readonly number[]; you: number }[] = [
  { bars: [0.2, 0.45, 0.8, 1, 0.7, 0.4, 0.2], you: 4 },
  { bars: [0.15, 0.3, 0.55, 0.9, 1, 0.6, 0.25], you: 5 },
  { bars: [0.35, 0.7, 1, 0.75, 0.5, 0.3, 0.15], you: 2 },
  { bars: [0.25, 0.6, 0.95, 1, 0.55, 0.3, 0.1], you: 3 },
];

/**
 * 振り返りの概念図の軸ごとの色（自分の棒・ほかの棒・▼）。説明の図を鮮やかにするための仮の色分けで、実際の結果の画面の
 * 分布は 1 色（食い違いは承知のうえ。2026-11-14 のユーザーの判断）。
 */
const REVIEW_TONES = [
  { you: 'bg-success', rest: 'bg-success/25', mark: 'text-success' },
  { you: 'bg-secondary', rest: 'bg-secondary/25', mark: 'text-secondary' },
  { you: 'bg-info', rest: 'bg-info/25', mark: 'text-info' },
  { you: 'bg-warning', rest: 'bg-warning/30', mark: 'text-warning' },
] as const;

/** 1 ページ目の概念図（振り返り）: 4 つの軸ごとに、みんなの分布の中の自分の位置を見る。 */
function ReviewSketch() {
  return (
    <ul
      className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
      aria-label="概念図: 4 つの軸ごとに、分布の中での自分の位置を見比べる"
    >
      {RESULT_AXES.map((a, i) => {
        const r = REVIEW_BARS[i % REVIEW_BARS.length]!;
        const tone = REVIEW_TONES[i % REVIEW_TONES.length]!;
        return (
          <li
            key={a.id}
            className="min-w-0 rounded-box border border-base-300 bg-base-100 p-1.5 sm:p-2"
          >
            <div className="text-xs leading-tight font-bold">{a.label}</div>
            <div
              aria-hidden
              className="mt-1 flex h-16 items-end gap-0.5 pt-4 sm:h-28"
            >
              {r.bars.map((h, j) => (
                <span
                  key={j}
                  className={clsx(
                    'motion-grow-y relative flex-1 rounded-t-sm',
                    j === r.you ? tone.you : tone.rest,
                  )}
                  style={{
                    height: `${h * 100}%`,
                    animationDelay: `${i * 250 + j * 60}ms`,
                  }}
                >
                  {j === r.you && (
                    <span
                      className={clsx(
                        'motion-pop absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] leading-none',
                        tone.mark,
                      )}
                      style={{ animationDelay: `${i * 250 + 700}ms` }}
                    >
                      ▼
                    </span>
                  )}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 1 ページ目の段（構成を選ぶ → 毎月の運営 → 振り返り）。ms はその段を見せる長さ（自動で進めるとき）。 */
const ABOUT_STEPS: {
  Icon: LucideIcon;
  label: string;
  title: string;
  ms: number;
  body: () => ReactNode;
}[] = [
  {
    Icon: Layers,
    label: '構成を選ぶ',
    title: '最適なインフラとフレームワークを選びましょう',
    ms: 10_000,
    body: GrowthByPlatform,
  },
  {
    Icon: CalendarDays,
    label: '毎月の運営',
    title: 'イベントにアクションで応えながら 12 か月運営しましょう',
    ms: 9_000,
    body: MonthsSketch,
  },
  {
    Icon: Trophy,
    label: '振り返り',
    title: '4 つの軸で振り返りましょう',
    ms: 7_000,
    body: ReviewSketch,
  },
];

/**
 * 自動で進めるときの残りの円（daisyUI の radial-progress）。値は requestAnimationFrame で毎フレーム直接書き、React の描き直しを
 * 挟まない。daisyUI の 0.3 秒の補間は切る（細かく値を変えると補間が始め直しになってカクつくため）。
 * running の間、key が変わるたびに 0 から ms かけて 100 まで進む。
 */
function AutoplayRing({
  running,
  ms,
  restart,
}: {
  running: boolean;
  ms: number;
  restart: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--value', '0');
    if (!running) return;
    const t0 = performance.now();
    let id = requestAnimationFrame(function frame(now) {
      const v = Math.min(100, ((now - t0) / ms) * 100);
      el.style.setProperty('--value', v.toFixed(2));
      if (v < 100) id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [running, ms, restart]);
  return (
    <span
      ref={ref}
      aria-hidden
      className="radial-progress bg-base-100 text-primary transition-none! before:transition-none! after:transition-none! hover:bg-base-300"
      style={{ '--size': '1.75rem', '--thickness': '3px' } as CSSProperties}
    >
      {running ? <Pause className="size-3" /> : <Play className="size-3" />}
    </span>
  );
}

/**
 * 1 ページ目の段の図（daisyUI の steps・carousel・progress）。何もしなければ段を順に自動で進め、段を押す・横に送ると止める
 * （「自動で進める」で再開）。動きを減らす設定では自動で進めない。
 */
function AboutCarousel() {
  const reduced = useReducedMotion();
  const n = ABOUT_STEPS.length;
  const [step, setStep] = useState(0);
  // 段に入った回数（入り直すたびに図の動きを最初から見せる）
  const [visit, setVisit] = useState(0);
  const [auto, setAuto] = useState(!reduced);
  const ref = useRef<HTMLDivElement>(null);
  // こちらから送っている間の scroll は、手で送ったものとして扱わない
  const scripted = useRef(false);
  const show = (i: number) => {
    setStep(i);
    setVisit((v) => v + 1);
  };
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    scripted.current = true;
    c.scrollTo?.({
      left: step * c.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    });
    const t = setTimeout(() => (scripted.current = false), 700);
    return () => clearTimeout(t);
  }, [step, reduced]);
  // 自動で進める: その段の長さが過ぎたら次の段へ（残りの円は AutoplayRing が同じ長さで描く）
  useEffect(() => {
    if (!auto || reduced) return;
    const t = setTimeout(() => show((step + 1) % n), ABOUT_STEPS[step]!.ms);
    return () => clearTimeout(t);
  }, [auto, reduced, step, n]);
  const pick = (i: number) => {
    setAuto(false);
    if (i !== step) show(i);
  };
  const current = ABOUT_STEPS[step]!;
  const running = auto && !reduced;
  return (
    <div className="space-y-2">
      {/* 段（steps）と、右上に自動で進める・止めるの円（radial-progress。円が次の段までの残りを表す） */}
      <div className="flex items-start gap-1">
        <ul className="steps min-w-0 flex-1" data-howto-steps>
          {ABOUT_STEPS.map((s, i) => (
            // 押せるのは「アイコン + 名前」だけ（段の間の線は押せない）。daisyUI の steps はアイコンが段の直下にある前提なので、
            // 名前のボタンの押せる範囲を透明な領域（after）で上のアイコンまで広げ、ホバー・フォーカスでアイコンと名前を一緒に反応させる
            <li
              key={s.label}
              className={clsx(
                'step',
                i <= step && 'step-primary',
                // アイコンの輪（名前のボタンのホバー・フォーカスで出す）
                '[&>.step-icon]:ring-offset-2 [&>.step-icon]:ring-offset-base-200 [&>.step-icon]:transition-shadow',
                '[&:has(button:hover)>.step-icon]:ring-2 [&:has(button:hover)>.step-icon]:ring-primary/70',
                '[&:has(button:focus-visible)>.step-icon]:ring-2 [&:has(button:focus-visible)>.step-icon]:ring-primary',
              )}
            >
              <span aria-hidden className="step-icon">
                <s.Icon className="size-4" />
              </span>
              <button
                type="button"
                className={clsx(
                  'relative z-10 cursor-pointer rounded-sm px-1 text-xs underline-offset-2 outline-none sm:text-sm',
                  'hover:underline focus-visible:underline',
                  // 押せる範囲を上のアイコンまで広げる透明な領域
                  "after:absolute after:bottom-full after:left-1/2 after:size-10 after:-translate-x-1/2 after:content-['']",
                  i === step ? 'font-bold' : 'opacity-70 hover:opacity-100',
                )}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => pick(i)}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        {/* 動きを減らす設定では自動で進めないので押せない（円は空のまま） */}
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-full disabled:cursor-default disabled:opacity-50"
          disabled={reduced}
          aria-label={running ? '自動で進めるのを止める' : '自動で進める'}
          title={running ? '止める' : '自動で進める'}
          onClick={() => setAuto((x) => !x)}
          data-howto-autoplay
        >
          <AutoplayRing running={running} ms={current.ms} restart={visit} />
        </button>
      </div>
      <div
        ref={ref}
        className="carousel w-full"
        data-howto-carousel
        // 横に送ったら自動を止め、その段を選ぶ（ダイアログのページ送りのスワイプには渡さない）
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onScroll={(e) => {
          if (scripted.current) return;
          const c = e.currentTarget;
          const i = Math.round(c.scrollLeft / c.clientWidth);
          if (i !== step && i >= 0 && i < n) {
            setAuto(false);
            show(i);
          }
        }}
      >
        {ABOUT_STEPS.map((s, i) => (
          <section
            key={s.label}
            className="carousel-item w-full flex-col gap-2"
            aria-hidden={i !== step}
            inert={i !== step}
          >
            {/* 段の主題（操作の中心なので、図の小見出しより大きく・primary の色で目立たせる） */}
            <p
              className="flex items-center gap-2 border-l-4 border-primary pl-2 text-base leading-snug font-bold text-primary sm:text-lg"
              data-howto-step-title
            >
              {s.title}
            </p>
            {/* 入り直すたびに描き直す（線を引く・棒を伸ばす動きを最初から） */}
            <div key={i === step ? `on:${visit}` : 'off'}>
              <s.body />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** 1 ページ目: このゲームについて。文は最小にし、図で見せる。 */
function AboutPage() {
  return (
    <>
      <p>Web アプリのインフラを選び、12 か月運営するゲームです。</p>
      <Figure label="図: 構成を選び、12 か月運営して、振り返る">
        <AboutCarousel />
      </Figure>
      <div
        className="flex items-start gap-2 rounded-box border border-info/50 bg-info/5 p-2 text-sm text-info-strong"
        data-howto-premise
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <ul className="list-disc space-y-0.5 pl-4">
          <li>{PREMISE_NOTE}</li>
          <li>
            料金・制限は実在の公式の料金表（出典つき。2026-10-31
            時点）で計算します。
          </li>
          <li>円建ての料金は 1 USD = {USD_JPY} 円の仮定で換算しています。</li>
          <li>
            収益・PV
            の伸び・満足度・開発の手間・障害の影響・イベントはゲーム上の仮定です。
          </li>
        </ul>
      </div>
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
  { label: 'イベントへの対応', n: 1, cls: 'bg-error' },
  { label: '乗り換え・移し替え', n: 2, cls: 'bg-secondary' },
  { label: 'アクション（設定・最適化・部品）', n: 1, cls: 'bg-info' },
  { label: '機能開発（残り）', n: 4, cls: 'bg-success' },
];

/** 5 ページ目: 開発の手間。 */
function EffortPage() {
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
 * 遊び方のダイアログ。× ・Esc・背景・「閉じる」・「始める」で閉じる（どれでも onClose）。
 * どこから開いても、まず 1 ページ目だけを出す（ページ送りを隠す）。1 ページ目を見て閉じるのが既定の動きで、ほかの説明は
 * 遊びながら画面で案内する。2 ページ目以降は機能ごとの詳しい説明（ヘルプに近い）で、「詳しい説明を見る」で開いたときだけ送れる。
 * first: 初めて自動で開いたとき（閉じるボタンを「始める」にし、あとから見直せる場所を添える）。
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
  // まず 1 ページ目だけ（詳しい説明は押したときだけ）
  const [expanded, setExpanded] = useState(false);
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
    if (!expanded) return;
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
      <div className="modal-box flex h-[min(42rem,calc(100dvh-2rem))] w-11/12 max-w-2xl flex-col overflow-hidden px-3 sm:px-6">
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
        {expanded && (
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
                      className={clsx(
                        'block rounded-full',
                        i === page
                          ? 'h-2.5 w-2.5 bg-base-content/60'
                          : 'h-1.5 w-1.5 bg-base-content/30',
                      )}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
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
            className={clsx(
              'space-y-3',
              !reduced &&
                dir !== 0 &&
                (dir > 0
                  ? 'motion-slide-from-right'
                  : 'motion-slide-from-left'),
            )}
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
        {/* 閉じる（初回は「始める」）を右の主のボタンにし、いつでも押せるようにする。詳しい説明への入口は左の控えめなリンク */}
        <div className="modal-action mt-3 shrink-0 items-end justify-between">
          {!expanded ? (
            <div className="flex min-w-0 flex-col items-start">
              {/* 詳しい説明を開ける印を添える。sm 未満は印だけ（名前は aria-label・title。ヘッダーの「遊び方」と同じ作り） */}
              <button
                type="button"
                className="btn btn-ghost btn-sm px-2"
                aria-label="詳しい説明を見る"
                title="詳しい説明を見る"
                onClick={() => {
                  moved.current = true;
                  setExpanded(true);
                  setView({ page: 1, dir: 1 });
                }}
              >
                <BookOpenText aria-hidden className="size-4" />
                <span className="hidden sm:inline">詳しい説明を見る</span>
              </button>
              {first && (
                <span className="text-xs opacity-70">
                  右上の「遊び方」からいつでも見直せます
                </span>
              )}
            </div>
          ) : (
            <span />
          )}
          <form method="dialog">
            <button
              ref={doneRef}
              className="btn btn-primary btn-sm"
              autoFocus={!expanded}
            >
              {first ? '始める' : '閉じる'}
            </button>
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
