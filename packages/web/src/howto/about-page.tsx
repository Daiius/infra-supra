// 遊び方の 1 ページ目（3 段のカルーセルと前置き。D-214）。
import {
  ArrowUp,
  Bell,
  CalendarDays,
  Flag,
  Info,
  Layers,
  Lightbulb,
  Pause,
  type LucideIcon,
  Play,
  Trophy,
  Wrench,
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
} from '../brand-logos.tsx';
import { useReducedMotion } from '../motion.tsx';
import { Figure } from './figure.tsx';

/** 前置き（D-146。ユーザーの決定）: ゲームであり、実際の開発より大幅に単純化していること。遊び方の 1 ページ目に置く（始める画面の下の 1 行は D-173 でやめた）。 */
export const PREMISE_NOTE =
  'これはゲームで、実際の開発より大幅に単純化されています。';

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
export function AboutPage() {
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
