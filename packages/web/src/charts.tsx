// 推移のグラフ（prd/07 §5）。dataviz の指針に沿う: 2px の線・r4 の端点と 2px の地の色の輪・細い目盛線（実線）・
// 2 系列以上は凡例 + 線の端の直接ラベル・縦線とツールチップのホバー（値は表でも読める。ホバーだけに閉じ込めない）。
// 色は CSS 変数（styles.css の .viz-root）で役割として参照する。テキストに系列の色は使わない。
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** 線の古い側の不透明度（最新の点で 1。古い月ほど薄くして、伸びている向きを見せる。D-25）。 */
const OLDEST_OPACITY = 0.3;

/**
 * 古い月ほど薄く、最新の点で系列の色そのものになる横向きのグラデーション（線の stroke に使う）。
 * x1・x2 は SVG の座標（最古の点・最新の点）。
 */
function FadeGradient({
  id,
  color,
  x1,
  x2,
}: {
  id: string;
  color: string;
  x1: number;
  x2: number;
}) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} x2={x2}>
      <stop
        offset="0"
        style={{ stopColor: color, stopOpacity: OLDEST_OPACITY }}
      />
      <stop offset="1" style={{ stopColor: color, stopOpacity: 1 }} />
    </linearGradient>
  );
}

export type Series = {
  id: string;
  label: string;
  /** CSS の色（var(--series-1) など）。 */
  color: string;
  /** 添字 0 が 1 か月目。null は記録なし。 */
  values: (number | null)[];
  /** 見込みの線（月・値）。破線で描く。 */
  projection?: { month: number; value: number }[];
  /** 線を区切る月の添字（部品を差し替えた月など。前の月から線をつながず、縦の破線の印を付ける）。 */
  breaks?: number[];
  /**
   * 前の試行の同じ系列（D-128。添字 0 が 1 か月目・null は記録なし）。今の試行より長くてもよい。灰色の細かい点線で今の線の下に
   * 重ね（見込みの長い破線・系列の色と分ける）、凡例に「前の試行」・ツールチップに値を並べる。1 枚の中で 2 系列以上が持つときは、
   * どの系列か分かるよう系列の色を薄くした点線にし、凡例も「収益（前の試行）」のように系列ごとに出す。
   */
  previous?: (number | null)[];
};

/**
 * 前の試行の線（D-128）。灰色（base-content の 40%）の細かい点線。見込みの線（系列の色・長い破線 4 4）と色と模様の両方で分ける。
 */
const PREVIOUS_GRAY = 'var(--color-base-content)';
const PREVIOUS_OPACITY = 0.4;
const PREVIOUS_DASH = '2 3';

/** 前の試行の値を記録のない月で区間に分ける（添字 0 が 1 か月目）。 */
function previousRuns(values: (number | null)[]): { m: number; v: number }[][] {
  const runs: { m: number; v: number }[][] = [];
  let current: { m: number; v: number }[] | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      current = null;
      return;
    }
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push({ m: i + 1, v });
  });
  return runs;
}

/** 系列を記録のない月と区切りの月で区間に分ける（添字 0 が 1 か月目）。 */
function runsOf(s: Series): { m: number; v: number }[][] {
  const runs: { m: number; v: number }[][] = [];
  let current: { m: number; v: number }[] | null = null;
  s.values.forEach((v, i) => {
    if (v === null) {
      current = null;
      return;
    }
    if (!current || s.breaks?.includes(i)) {
      current = [];
      runs.push(current);
    }
    current.push({ m: i + 1, v });
  });
  return runs;
}

/**
 * ping（輪と点の脈打ち）の位相を全グラフで揃える（D-25）。CSS のアニメーションは要素が現れた時刻から始まるので、
 * Web Animations API で開始時刻を文書の時計の原点（0）にそろえる。周期と遅れは CSS（styles.css）の 1 か所だけに持つ。
 * 月送りで点が作り直されても、新しいグラフが出ても、同じ時計に乗る。動きを減らす設定ではアニメーションが無いので何もしない。
 */
const PING_ANIMATIONS = new Set(['motion-ping', 'motion-pulse']);
export function syncPing(el: Element | null) {
  if (!el || typeof el.getAnimations !== 'function') return;
  for (const a of el.getAnimations({ subtree: true }))
    if (a instanceof CSSAnimation && PING_ANIMATIONS.has(a.animationName))
      a.startTime = 0;
}

/**
 * 最新の月の点の強調（D-25）。2 重の輪（塗り + 縁）が時間差で点の 4 倍ほどまで広がって消える。色は系列の色。
 * 輪は SVG の外へはみ出してよい（SVG は overflow: visible）。動きを減らす設定では出さない（styles.css）。
 */
function PingRings({
  cx,
  cy,
  color,
}: {
  cx: number;
  cy: number;
  color: string;
}) {
  return (
    <g aria-hidden pointerEvents="none" ref={syncPing}>
      {[0, 1].map((i) => (
        <circle
          key={i}
          className={`motion-ping ${i ? 'motion-ping-late' : ''}`}
          cx={cx}
          cy={cy}
          r="4"
          fill={color}
          fillOpacity="0.3"
          stroke={color}
          strokeWidth="1.5"
        />
      ))}
    </g>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 目盛りをきりのよい値にする（0 から上限まで 3〜5 本）。 */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 1e-9; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max)
    ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

export const compact = (n: number) =>
  Math.abs(n) >= 1e6
    ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
    : Math.abs(n) >= 1e4
      ? `${Math.round(n / 1e3)}K`
      : n.toLocaleString();

export function LineChart({
  series,
  months,
  height = 180,
  format,
  yMax,
  reference,
  title,
}: {
  series: Series[];
  /** x 軸の月数（未来の月も軸に出し、続いていく感じを見せる）。 */
  months: number;
  height?: number;
  format: (v: number) => string;
  yMax?: number;
  /**
   * 境目の線（使用率 100% など）。tone が neutral なら控えめの色の破線（所持金の目標の目安など、合否を表さない線。D-167）。
   */
  reference?: { value: number; label: string; tone?: 'critical' | 'neutral' };
  title?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const pad = {
    top: 12,
    right: series.length > 1 ? 56 : 16,
    bottom: 24,
    left: 48,
  };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const all = series.flatMap((s) => [
    ...s.values.filter((v): v is number => v !== null),
    ...(s.projection ?? []).map((p) => p.value),
    ...(s.previous ?? []).filter((v): v is number => v !== null),
  ]);
  const withPrevious = series.filter((s) =>
    (s.previous ?? []).some((v) => v !== null),
  );
  const hasPrevious = withPrevious.length > 0;
  // 1 枚に前の試行が 1 系列だけなら灰色、2 系列以上なら系列の色を薄くする（どの系列の前の試行か分かるように）
  const previousColor = (s: Series) =>
    withPrevious.length > 1 ? s.color : PREVIOUS_GRAY;
  const ticks = niceTicks(yMax ?? Math.max(reference?.value ?? 0, ...all, 0));
  const top = ticks[ticks.length - 1]!;
  // 1 か月目の左に 0.6 か月分の内側の余白を取る（点が 1 つだけの区間の延長線の余地。月の目盛り・ツールチップは月に揃う）
  const lead = 0.6;
  const x = (month: number) =>
    pad.left + ((month - 1 + lead) / Math.max(months - 1 + lead, 1)) * w;
  const y = (v: number) => pad.top + h - (Math.min(v, top) / top) * h;
  const path = (pts: { m: number; v: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${y(p.v)}`).join('');
  const lastIndex = (s: Series) =>
    s.values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);

  // 線の端のラベルは、近すぎて重なるなら出さない（凡例とツールチップに任せる）
  const ends = series
    .map((s) => ({ s, i: lastIndex(s) }))
    .filter((e) => e.i >= 0);
  const endYs = ends.map((e) => y(e.s.values[e.i]!));
  const labelsFit = endYs.every((a, i) =>
    endYs.every((b, j) => i === j || Math.abs(a - b) >= 14),
  );

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const m =
      Math.round(
        ((px - pad.left) / Math.max(w, 1)) * Math.max(months - 1 + lead, 1) -
          lead,
      ) + 1;
    setHover(m >= 1 && m <= months ? m : null);
  };

  const hoverRows =
    hover === null
      ? []
      : series.flatMap((s) => {
          const v = s.values[hover - 1];
          const p = s.projection?.find(
            (q) => q.month === hover && hover - 1 > lastIndex(s),
          );
          const now =
            v !== null && v !== undefined
              ? { s, key: s.id, value: format(v), note: '', previous: false }
              : p
                ? {
                    s,
                    key: s.id,
                    value: format(p.value),
                    note: '（見込み）',
                    previous: false,
                  }
                : null;
          // 前の試行の同じ月の値（D-128）を今の値の下に並べる
          const pv = s.previous?.[hover - 1];
          const prev =
            pv !== null && pv !== undefined
              ? {
                  s,
                  key: `${s.id}-previous`,
                  value: format(pv),
                  note: '（前の試行）',
                  previous: true,
                }
              : null;
          return [now, prev].filter((r) => r !== null);
        });

  return (
    // daisyUI の .card figure は overflow: hidden（最新の点の輪が切れるので見えるようにする）
    <figure
      className="viz-root relative block w-full"
      style={{ overflow: 'visible' }}
      ref={ref}
    >
      {title && (
        <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      )}
      {(series.length > 1 || hasPrevious) && (
        <div className="mb-1 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1">
              <svg width="14" height="4" aria-hidden>
                <line
                  x1="0"
                  y1="2"
                  x2="14"
                  y2="2"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {s.label}
            </span>
          ))}
          {/* 前の試行（D-128）: 線と同じ色・模様の見本。2 系列以上なら系列ごと */}
          {(withPrevious.length > 1
            ? withPrevious
            : withPrevious.slice(0, 1)
          ).map((s) => (
            <span
              key={`previous-${s.id}`}
              className="flex items-center gap-1"
              data-legend-previous
            >
              <svg width="18" height="4" aria-hidden>
                <line
                  x1="1"
                  y1="2"
                  x2="17"
                  y2="2"
                  stroke={previousColor(s)}
                  strokeOpacity={PREVIOUS_OPACITY}
                  strokeWidth="2"
                  strokeDasharray={PREVIOUS_DASH}
                />
              </svg>
              {withPrevious.length > 1 ? `${s.label}（前の試行）` : '前の試行'}
            </span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg
          // 幅は固定の px で付けない（付けると SVG の幅が figure の最小幅になり、グリッドの列が縮まず ResizeObserver も
          // 発火しないので、画面を狭めても元の幅のまま残る）。100% なら figure と一緒に縮み、測った幅で描き直す。
          // viewBox は付けない（座標は CSS px のまま。文字・輪の大きさが拡縮しない）
          width="100%"
          height={height}
          // 最新の点の輪が端で切れないように
          overflow="visible"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={typeof title === 'string' ? title : '推移のグラフ'}
        >
          {/*
            点が 1 つだけの区間（1 か月目・乗り換えや部品の差し替えの後など）は、点だけで光ると不自然なので、左へ 1 か月分の水平線を
            最も薄い色で描く（表示だけ。データ・軸・ツールチップ・見込みには入れない）。1 か月目は内側の余白（lead）の分まで描き、
            目盛りの数字の手前で止める
          */}
          {series.flatMap((s) =>
            runsOf(s).flatMap((run) => {
              if (run.length !== 1) return [];
              const { m, v } = run[0]!;
              const i = m - 1;
              // 区切りの直後は区切りの印（前の月との中ほど）まで
              const step = (x(2) - x(1)) / (s.breaks?.includes(i) ? 2 : 1);
              const x2 = x(m);
              return [
                <line
                  key={`stub-${s.id}-${i}`}
                  // 目盛りの数字（右端は pad.left - 6）の手前 4px で止める（数字に取り消し線のように重ならない）
                  x1={Math.max(x2 - step, pad.left - 2)}
                  x2={x2}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={s.color}
                  strokeOpacity={OLDEST_OPACITY}
                  strokeWidth="2"
                  strokeLinecap="round"
                  pointerEvents="none"
                />,
              ];
            }),
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'}
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-[var(--text-muted)] text-[10px] tabular-nums"
              >
                {format(t)}
              </text>
            </g>
          ))}
          {Array.from({ length: months }, (_, i) => i + 1).map((m) => (
            <text
              key={m}
              x={x(m)}
              y={height - 6}
              textAnchor="middle"
              className="fill-[var(--text-muted)] text-[10px] tabular-nums"
            >
              {m}
            </text>
          ))}
          {reference && (
            <g data-reference={reference.tone ?? 'critical'}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke={
                  reference.tone === 'neutral'
                    ? 'var(--text-secondary)'
                    : 'var(--status-critical)'
                }
                strokeWidth="1"
                {...(reference.tone === 'neutral'
                  ? { strokeDasharray: '2 3' }
                  : {})}
              />
              <text
                x={pad.left + w}
                y={y(reference.value) - 4}
                textAnchor="end"
                className="fill-[var(--text-secondary)] text-[10px]"
              >
                {reference.label}
              </text>
            </g>
          )}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + h}
              stroke="var(--axis)"
              strokeWidth="1"
            />
          )}
          {series.flatMap((s) =>
            // 区切りの印（部品を差し替えた月）: 前の月との間に縦の破線
            (s.breaks ?? []).map((i) => (
              <line
                key={`break-${s.id}-${i}`}
                x1={(x(i) + x(i + 1)) / 2}
                x2={(x(i) + x(i + 1)) / 2}
                y1={pad.top}
                y2={pad.top + h}
                stroke="var(--axis)"
                strokeWidth="1"
                strokeDasharray="2 3"
                pointerEvents="none"
              />
            )),
          )}
          {series.flatMap((s) =>
            // 前の試行（D-128）は今の線の下に、灰色の細かい点線で描く（後の月まで進んでいた分も描く）
            s.previous
              ? previousRuns(s.previous).map((run, i) =>
                  run.length >= 2 ? (
                    <path
                      key={`previous-${s.id}-${i}`}
                      data-previous-series={s.id}
                      d={path(run)}
                      fill="none"
                      stroke={previousColor(s)}
                      strokeOpacity={PREVIOUS_OPACITY}
                      strokeWidth="2"
                      strokeDasharray={PREVIOUS_DASH}
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  ) : (
                    <circle
                      key={`previous-${s.id}-${i}`}
                      data-previous-series={s.id}
                      cx={x(run[0]!.m)}
                      cy={y(run[0]!.v)}
                      r="2.5"
                      fill={previousColor(s)}
                      fillOpacity={PREVIOUS_OPACITY}
                      pointerEvents="none"
                    />
                  ),
                )
              : [],
          )}
          {series.map((s) => {
            // 記録のない月（構成を乗り換えて前提が途切れたとき）と区切りの月（部品の差し替え）で線を切る
            const runs = runsOf(s);
            const li = lastIndex(s);
            const fi = s.values.findIndex((v) => v !== null);
            // 最新の点に近いほど濃い線（見込みの破線・凡例は系列の色のまま）
            const gid = `${uid}-fade-${s.id}`;
            const stroke = li > fi ? `url(#${gid})` : s.color;
            return (
              <g key={s.id}>
                {li > fi && (
                  <defs>
                    <FadeGradient
                      id={gid}
                      color={s.color}
                      x1={x(fi + 1)}
                      x2={x(li + 1)}
                    />
                  </defs>
                )}
                {s.projection && s.projection.length > 1 && (
                  <path
                    d={path(
                      s.projection.map((p) => ({ m: p.month, v: p.value })),
                    )}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                    opacity="0.6"
                  />
                )}
                {runs.map((r, i) => {
                  // 最後の区間だけ、月が進んだときに端から描く（D-25。key が変わると描き直す）
                  const grow = i === runs.length - 1 && r.length >= 2;
                  const head = grow ? r.slice(0, -1) : r;
                  return (
                    <g key={i}>
                      {head.length >= 2 && (
                        <path
                          d={path(head)}
                          fill="none"
                          stroke={stroke}
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )}
                      {grow && (
                        <path
                          key={`seg-${s.values.length}`}
                          className="motion-draw"
                          pathLength={1}
                          d={path(r.slice(-2))}
                          fill="none"
                          stroke={stroke}
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )}
                    </g>
                  );
                })}
                {li >= 0 && li === s.values.length - 1 && (
                  // 最新の月の点だけ、広がって消える輪で強調する（D-25。輪の色は系列の色）
                  <PingRings
                    cx={x(li + 1)}
                    cy={y(s.values[li]!)}
                    color={s.color}
                  />
                )}
                {li >= 0 && (
                  <circle
                    key={`end-${li}`}
                    className={`motion-pop ${li === s.values.length - 1 ? 'motion-pulse' : ''}`}
                    ref={syncPing}
                    cx={x(li + 1)}
                    cy={y(s.values[li]!)}
                    r="4"
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth="2"
                  />
                )}
                {li >= 0 && series.length > 1 && labelsFit && (
                  <text
                    x={x(li + 1) + 8}
                    y={y(s.values[li]!)}
                    dy="0.32em"
                    className="fill-[var(--text-secondary)] text-[11px]"
                  >
                    {s.label}
                  </text>
                )}
                {hover !== null && s.values[hover - 1] != null && (
                  <circle
                    cx={x(hover)}
                    cy={y(s.values[hover - 1]!)}
                    r="4"
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && hoverRows.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 rounded-box border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs shadow"
          style={{
            left: Math.min(x(hover) + 8, Math.max(0, width - 150)),
            top: 24,
          }}
        >
          <div className="text-[var(--text-secondary)]">{hover} か月目</div>
          {hoverRows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <svg width="10" height="4" aria-hidden>
                <line
                  x1="0"
                  y1="2"
                  x2="10"
                  y2="2"
                  stroke={r.previous ? previousColor(r.s) : r.s.color}
                  strokeWidth="2"
                  {...(r.previous
                    ? {
                        strokeOpacity: PREVIOUS_OPACITY,
                        strokeDasharray: PREVIOUS_DASH,
                      }
                    : { strokeLinecap: 'round' as const })}
                />
              </svg>
              <span className="font-semibold text-[var(--text-primary)]">
                {r.value}
              </span>
              <span className="text-[var(--text-secondary)]">
                {r.s.label}
                {r.note}
              </span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/** 数値タイルの小さな推移（12 点・強調の青。古い月ほど薄く、今月の点で濃い）。 */
export function Sparkline({
  values,
  months,
}: {
  values: number[];
  months: number;
}) {
  const width = 120;
  const height = 28;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => 4 + (i / Math.max(months - 1, 1)) * (width - 8);
  const y = (v: number) => 4 + (height - 8) * (1 - (v - min) / span);
  const d = (from: number, to: number) =>
    values
      .slice(from, to)
      .map((v, i) => `${i ? 'L' : 'M'}${x(from + i)},${y(v)}`)
      .join('');
  const li = values.length - 1;
  const gid = `${useId().replace(/:/g, '')}-fade`;
  // 最新の点に近いほど濃い線（D-25）
  const stroke = li >= 1 ? `url(#${gid})` : 'var(--series-1)';
  return (
    <svg
      width={width}
      height={height}
      aria-hidden
      className="viz-root"
      // 最新の点の輪が小さな枠で切れないように
      overflow="visible"
    >
      {li >= 1 && (
        <defs>
          <FadeGradient id={gid} color="var(--series-1)" x1={x(0)} x2={x(li)} />
        </defs>
      )}
      {li === 0 && (
        // 点が 1 つだけのときは、左へ 1 か月分の水平線を最も薄い色で描く（表示だけ。タイルの余白に収まる）
        <line
          x1={x(0) - (width - 8) / Math.max(months - 1, 1)}
          x2={x(0)}
          y1={y(values[0]!)}
          y2={y(values[0]!)}
          stroke="var(--series-1)"
          strokeOpacity={OLDEST_OPACITY}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      {min < 0 && (
        <line
          x1="4"
          x2={width - 4}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--axis)"
          strokeWidth="1"
        />
      )}
      {li >= 2 && (
        <path
          d={d(0, li)}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {li >= 1 && (
        // 最後の区間だけ、月が進んだときに端から描く（D-25）
        <path
          key={`seg-${li}`}
          className="motion-draw"
          pathLength={1}
          d={d(li - 1, li + 1)}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {li >= 0 && (
        // 最新の月の点だけ、広がって消える輪で強調する（D-25）
        <PingRings cx={x(li)} cy={y(values[li]!)} color="var(--series-1)" />
      )}
      {li >= 0 && (
        <circle
          key={`end-${li}`}
          className="motion-pop motion-pulse"
          ref={syncPing}
          cx={x(li)}
          cy={y(values[li]!)}
          r="4"
          fill="var(--series-1)"
          stroke="var(--surface-1)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

// ---- PV ごとの月額の折れ線（見積の費用の曲線。D-74。通常 / 対数の軸は D-179）----

export type MarkShape = 'circle' | 'square' | 'diamond';

export type CurveChartSeries = {
  id: string;
  label: string;
  /** CSS の色（var(--series-1) など）。 */
  color: string;
  /** 点の形（同じ色の系列を見分ける 2 つ目の手がかり）。 */
  shape: MarkShape;
  /**
   * 添字は xs と同じ。flags が空でない点は上限に達して止まる点（D-180）: 印を描かず、そこへ入る・そこから出る区間を
   * 薄い破線にし、ツールチップに「止まります（上限）」と言葉で出す。止まらない区間は通常どおり描く。
   */
  points: { y: number; flags: string[] }[];
  /**
   * 強調（D-182・D-183）: strong は太い線で一番上に描き（今の構成・凡例で選んだ構成）、muted は薄くする（凡例で別の構成を選んだとき）。
   * 既定は normal。
   */
  emphasis?: 'strong' | 'normal' | 'muted';
};

/** 凡例で別の構成を選んだときの、ほかの線の不透明度。 */
const MUTED_OPACITY = 0.15;

/** 系列の点の印（r4 相当・2px の地の色の輪）。 */
function MarkGlyph({
  shape,
  x,
  y,
  color,
}: {
  shape: MarkShape;
  x: number;
  y: number;
  color: string;
}) {
  const ring = { stroke: 'var(--surface-1)', strokeWidth: 2, fill: color };
  if (shape === 'square')
    return <rect x={x - 4} y={y - 4} width="8" height="8" rx="1" {...ring} />;
  if (shape === 'diamond')
    return (
      <path
        d={`M${x},${y - 5.5}L${x + 5.5},${y}L${x},${y + 5.5}L${x - 5.5},${y}Z`}
        {...ring}
      />
    );
  return <circle cx={x} cy={y} r="4" {...ring} />;
}

/** 止まる区間の線（薄い破線。D-180）。 */
const STOPPED_OPACITY = 0.35;
const STOPPED_DASH = '4 4';

/** 凡例の見本（線 + 点の形）。stopped は止まる区間の見本（薄い破線・点の印なし。D-180）。 */
export function SeriesSwatch({
  color,
  shape,
  stopped = false,
}: {
  color: string;
  shape: MarkShape;
  stopped?: boolean;
}) {
  return (
    <svg
      width="22"
      height="12"
      aria-hidden
      className="shrink-0"
      data-swatch={stopped ? 'stopped' : 'normal'}
    >
      <line
        x1="1"
        y1="6"
        x2="21"
        y2="6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap={stopped ? 'butt' : 'round'}
        strokeOpacity={stopped ? STOPPED_OPACITY : 1}
        strokeDasharray={stopped ? STOPPED_DASH : undefined}
      />
      {!stopped && <MarkGlyph shape={shape} x={11} y={6} color={color} />}
    </svg>
  );
}

/** 費用の曲線の軸の目盛り（D-179）。linear は等間隔（既定）、log は 1 目盛りで 10 倍。 */
export type CurveScale = 'linear' | 'log';

/** lo〜hi の中の 10 のべき（対数の目盛り。1 目盛りで 10 倍）。 */
function decadeTicks(lo: number, hi: number): number[] {
  const a = Math.ceil(Math.log10(lo) - 1e-9);
  const b = Math.floor(Math.log10(hi) + 1e-9);
  return Array.from(
    { length: Math.max(0, b - a + 1) },
    (_, i) => 10 ** (a + i),
  );
}

/** 1 本の軸（値 → 0〜1 の位置と目盛り）。 */
function curveAxis(
  scale: CurveScale,
  lo: number,
  hi: number,
): { at: (v: number) => number; ticks: number[] } {
  if (scale === 'log') {
    const l0 = Math.log10(lo);
    const l1 = Math.log10(hi);
    return {
      at: (v) => (Math.log10(Math.max(v, lo)) - l0) / Math.max(l1 - l0, 1e-9),
      ticks: decadeTicks(lo, hi),
    };
  }
  const ticks = niceTicks(hi);
  const top = ticks[ticks.length - 1]!;
  return { at: (v) => Math.max(v, 0) / Math.max(top, 1e-9), ticks };
}

/**
 * PV ごとの月額の折れ線（2 軸にしない）。軸は scale で通常（等間隔・0 から。既定）か対数（1 目盛りで 10 倍）を選ぶ（D-179）。
 * 対数では y は floor 未満を floor の位置に描き（値はツールチップで読む）、目盛りは 10 倍ごとにする。
 * ホバーで最も近い x の縦線とツールチップ。凡例は呼び出し側（系列の選び方と一緒に出す）。直接のラベルは幅があって
 * 描画域に収まるときだけ線の右端に出す（近いものは上下に押し広げる）。
 */
export function CurveChart({
  series,
  xs,
  formatX,
  formatY,
  formatValue,
  marker,
  height = 240,
  floor = 1,
  scale = 'linear',
  label,
}: {
  series: CurveChartSeries[];
  xs: readonly number[];
  formatX: (v: number) => string;
  /** 目盛りの書式。 */
  formatY: (v: number) => string;
  /** ツールチップの値の書式。 */
  formatValue: (v: number) => string;
  /** x の目印（今の値など）。 */
  marker?: { x: number; label: string };
  height?: number;
  /** 対数のときの y の底（これ未満は底に寄せる）。 */
  floor?: number;
  scale?: CurveScale;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const directLabels = width >= 600 && series.length > 0;
  const log = scale === 'log';
  const pad = {
    top: 14,
    right: directLabels ? 150 : 14,
    bottom: 24,
    left: 44,
  };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const xMax = xs[xs.length - 1]!;
  const xAxis = curveAxis(scale, log ? xs[0]! : 0, xMax);
  const x = (v: number) => pad.left + xAxis.at(v) * w;
  const maxValue = Math.max(
    0,
    ...series.flatMap((s) => s.points.map((p) => p.y)),
  );
  const yAxis = log
    ? curveAxis(
        'log',
        floor,
        10 ** Math.ceil(Math.log10(Math.max(floor * 10, maxValue)) - 1e-9),
      )
    : curveAxis('linear', 0, maxValue);
  const y = (v: number) => pad.top + h - yAxis.at(v) * h;
  const yTicks = yAxis.ticks;
  // x の目盛り: 狭いときは 1 つおきにする（文字が重ならないように）
  const xTicks = xAxis.ticks;
  const xLabelEvery = w / Math.max(xTicks.length, 1) < 34 ? 2 : 1;
  const xTickLabel = (v: number) => (v === 0 ? '0' : formatX(v));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (px < pad.left - 12 || px > pad.left + w + 12) return setHover(null);
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(x(v) - px) < Math.abs(x(xs[best]!) - px)) best = i;
    });
    setHover(best);
  };

  // 線の右端のラベル: 近いものを下へ押し広げ、それでも描画域を外れるなら出さない（凡例とツールチップに任せる）
  const ends = directLabels
    ? series
        .map((s) => ({ s, y: y(s.points[s.points.length - 1]!.y) }))
        .sort((a, b) => a.y - b.y)
    : [];
  for (let i = 1; i < ends.length; i++)
    ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 13);
  const labelsFit = ends.every((e) => e.y <= height - 4);

  return (
    <figure
      className="viz-root relative block w-full"
      ref={ref}
      data-scale={scale}
    >
      {log && (
        // 対数は読み違えやすいので、軸のすぐ上に強く書く（D-179）
        <figcaption
          className="mb-1 flex flex-wrap items-center gap-2 text-xs"
          data-log-note
        >
          <span className="badge badge-info badge-sm font-semibold">
            対数の目盛り
          </span>
          <span className="font-semibold text-[var(--text-primary)]">
            横軸・縦軸とも、1 目盛りで 10 倍です（等間隔ではありません）。
          </span>
          <span className="text-[var(--text-secondary)]">
            {`${formatY(floor)} 未満は底の目盛り（≤${formatY(floor)}）に寄せています。`}
          </span>
        </figcaption>
      )}
      {width > 0 && (
        <svg
          // 幅は 100%（LineChart と同じ理由。固定の px にすると狭めても縮まない）
          width="100%"
          height={height}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={label}
        >
          {yTicks.map((t, i) => (
            <g key={t} data-y-tick={t}>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(t)}
                y2={y(t)}
                stroke={i === 0 ? 'var(--axis)' : 'var(--grid)'}
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-[var(--text-muted)] text-[10px] tabular-nums"
              >
                {log && i === 0 ? `≤${formatY(t)}` : formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((v, i) => (
            <text
              key={v}
              data-x-tick={v}
              x={x(v)}
              y={height - 6}
              textAnchor={i === 0 && !log ? 'start' : 'middle'}
              className="fill-[var(--text-muted)] text-[10px] tabular-nums"
            >
              {i % xLabelEvery === 0 ? xTickLabel(v) : ''}
            </text>
          ))}
          {marker && marker.x >= xs[0]! && marker.x <= xs[xs.length - 1]! && (
            // 目印は線の系列と区別するため細い点線（推移のグラフの破線 = 見込みとは太さと間隔で分ける）
            <g>
              <line
                x1={x(marker.x)}
                x2={x(marker.x)}
                y1={pad.top}
                y2={pad.top + h}
                stroke="var(--marker)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <text
                x={x(marker.x)}
                y={pad.top - 4}
                textAnchor={x(marker.x) > pad.left + w * 0.8 ? 'end' : 'middle'}
                className="fill-[var(--text-secondary)] text-[10px]"
              >
                {marker.label}
              </text>
            </g>
          )}
          {hover !== null && (
            <line
              x1={x(xs[hover]!)}
              x2={x(xs[hover]!)}
              y1={pad.top}
              y2={pad.top + h}
              stroke="var(--axis)"
              strokeWidth="1"
            />
          )}
          {
            // 強調する線を一番上に描く（並びは凡例と同じまま。描く順だけ替える）
            [...series]
              .sort(
                (a, b) =>
                  Number(a.emphasis === 'strong') -
                  Number(b.emphasis === 'strong'),
              )
              .map((s) => (
                <g
                  key={s.id}
                  data-series={s.id}
                  data-emphasis={s.emphasis ?? 'normal'}
                  opacity={s.emphasis === 'muted' ? MUTED_OPACITY : 1}
                >
                  {s.points.slice(1).map((p, i) => {
                    const a = s.points[i]!;
                    // 片端でも止まる点に触れる区間は薄い破線（上限に達した後の月額では実際には運用できない。D-180）。
                    // 止まらない区間（無料枠の範囲など）は通常どおり描く
                    const stopped = a.flags.length > 0 || p.flags.length > 0;
                    return (
                      <line
                        key={i}
                        data-segment={stopped ? 'stopped' : 'normal'}
                        x1={x(xs[i]!)}
                        y1={y(a.y)}
                        x2={x(xs[i + 1]!)}
                        y2={y(p.y)}
                        stroke={s.color}
                        strokeOpacity={stopped ? STOPPED_OPACITY : 1}
                        strokeDasharray={stopped ? STOPPED_DASH : undefined}
                        strokeWidth={s.emphasis === 'strong' ? 3.5 : 2}
                        strokeLinecap={stopped ? 'butt' : 'round'}
                      />
                    );
                  })}
                  {s.points.map((p, i) =>
                    // 止まる点には印を描かない（× などの印に「止まる」の意味を持たせない。D-180）
                    p.flags.length > 0 ? null : (
                      <MarkGlyph
                        key={i}
                        shape={s.shape}
                        x={x(xs[i]!)}
                        y={y(p.y)}
                        color={s.color}
                      />
                    ),
                  )}
                </g>
              ))
          }
          {labelsFit &&
            ends.map((e) => (
              <text
                key={e.s.id}
                x={pad.left + w + 10}
                y={e.y}
                dy="0.32em"
                className={`text-[11px] ${e.s.emphasis === 'strong' ? 'fill-[var(--text-primary)] font-semibold' : 'fill-[var(--text-secondary)]'}`}
                opacity={e.s.emphasis === 'muted' ? 0.4 : 1}
              >
                {e.s.label.length > 22
                  ? `${e.s.label.slice(0, 21)}…`
                  : e.s.label}
              </text>
            ))}
        </svg>
      )}
      {hover !== null && series.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 w-72 max-w-full rounded-box border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs shadow"
          style={{
            left: Math.max(0, Math.min(x(xs[hover]!) + 8, width - 288)),
            top: 8,
          }}
        >
          <div className="text-[var(--text-secondary)]">
            月 {formatX(xs[hover]!)} PV
          </div>
          {series.map((s) => {
            const p = s.points[hover]!;
            return (
              <div key={s.id} className="py-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <SeriesSwatch
                    color={s.color}
                    shape={s.shape}
                    stopped={p.flags.length > 0}
                  />
                  <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatValue(p.y)}
                  </span>
                  <span className="truncate text-[var(--text-secondary)]">
                    {s.label}
                  </span>
                </div>
                {p.flags.length > 0 && (
                  <div className="pl-7 text-[var(--text-secondary)]">
                    止まります（上限）: {p.flags[0]}
                    {p.flags.length > 1
                      ? `（ほか ${p.flags.length - 1} 件）`
                      : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export type MeterStatus = 'good' | 'critical' | 'reference';

const METER_FILL: Record<MeterStatus, { fill: string; track: string }> = {
  good: { fill: 'var(--status-good)', track: 'var(--status-good-track)' },
  critical: {
    fill: 'var(--status-critical)',
    track: 'var(--status-critical-track)',
  },
  // 合否の条件でない項目（基準プレイとの比較）。状態の色は使わない
  reference: { fill: 'var(--series-1)', track: 'var(--series-1-track)' },
};

/**
 * 1 つの値を目標（または上限・基準）と比べるメーター（dataviz の Meter）。
 * 塗りの棒 + 同じ系統の薄い下地。棒は 12px・データ側の端だけ 4px の角丸。目盛りは細い実線とラベル。
 * 状態は色だけでなく、印とラベル（status）で示す。文字は文字の色の役割で書く。
 */
export function Meter({
  label,
  valueText,
  value,
  max,
  marker,
  status,
  statusText,
  note,
  size = 'md',
}: {
  label: string;
  valueText: string;
  value: number;
  /** 棒の右端の値（0 から max まで）。 */
  max: number;
  marker: { value: number; label: string };
  status: MeterStatus;
  /** 印 + ラベル（例: ✓ 達成）。 */
  statusText: string;
  /** 目標までの差・向きの説明など。 */
  note?: string;
  /** lg: 値を大きく出す（目標達成のダイアログ）。 */
  size?: 'md' | 'lg';
}) {
  const pos = (v: number) => `${(Math.max(0, Math.min(v, max)) / max) * 100}%`;
  const c = METER_FILL[status];
  const markerRatio = Math.max(0, Math.min(marker.value, max)) / max;
  return (
    <div
      className="viz-root"
      role="img"
      aria-label={`${label} ${valueText}・${marker.label} ${statusText}${note ? `・${note}` : ''}`}
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm">
        <span
          style={{ color: 'var(--text-primary)' }}
          className="font-semibold"
        >
          {label}
        </span>
        <span
          style={{ color: 'var(--text-primary)' }}
          className={size === 'lg' ? 'text-2xl font-bold tabular-nums' : ''}
        >
          {valueText}
        </span>
        <span
          className="flex items-center gap-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: c.fill }}
          />
          {statusText}
        </span>
        {note && (
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </span>
        )}
      </div>
      <div className="relative pb-4">
        <div
          className="relative h-3 w-full overflow-hidden"
          style={{ background: c.track, borderRadius: 4 }}
        >
          <div
            className="motion-grow-x absolute inset-y-0 left-0"
            style={{
              width: pos(value),
              background: c.fill,
              borderRadius: '0 4px 4px 0',
            }}
          />
        </div>
        <div
          aria-hidden
          className="absolute -top-1 h-5"
          style={{
            left: pos(marker.value),
            width: 2,
            marginLeft: -1,
            background: 'var(--marker)',
          }}
        />
        <div
          aria-hidden
          className="absolute top-4 text-xs whitespace-nowrap"
          style={{
            left: pos(marker.value),
            // 端に近い目盛りのラベルは、はみ出さないように内側へ寄せる
            transform: `translateX(${markerRatio > 0.8 ? '-100%' : markerRatio < 0.2 ? '0' : '-50%'})`,
            color: 'var(--text-muted)',
          }}
        >
          {marker.label}
        </div>
      </div>
    </div>
  );
}

/** 横棒の 1 本（CostBars）。value が null の棒は描かず、valueText だけを出す（計算できない選択肢）。 */
export type CostBar = {
  key: string;
  label: ReactNode;
  value: number | null;
  /** 棒の右の数値のラベル（例: $94/月（+$73））。 */
  valueText: string;
  /** 棒の下の小さい注記（選べない理由・止まる前提など）。 */
  note?: string | undefined;
  /** 基準の棒（今の部品）。目盛りの線をこの値に引き、ラベルを太くする。 */
  current?: boolean;
  /** 薄く出す（選べない選択肢）。 */
  muted?: boolean;
};

/**
 * 同じ量（月の費用）を選択肢ごとに比べる横棒（dataviz の bar。1 系列なので色は series-1 の 1 色）。
 * 基準の棒（current）の値に縦の目盛りの線を引き、差が棒の端と線のずれで見える。値は棒の右に数値のラベルで出し、
 * 基準の印は色でなく文字（ラベルの「今」）で示す。読み上げは一覧（各行に名前と数値の文）で、棒そのものは飾り。
 */
export function CostBars({
  items,
  caption,
}: {
  items: readonly CostBar[];
  /** 図の説明（読み上げの一覧の名前にも使う）。 */
  caption: string;
}) {
  const max = Math.max(0, ...items.map((b) => b.value ?? 0));
  const pos = (v: number) =>
    max > 0 ? `${(Math.max(0, v) / max) * 100}%` : '0%';
  const base = items.find((b) => b.current)?.value ?? undefined;
  return (
    <figure className="viz-root min-w-0" data-cost-bars>
      <ul aria-label={caption} className="space-y-2">
        {items.map((b) => (
          <li
            key={b.key}
            data-bar={b.key}
            data-current={b.current ? 'true' : undefined}
            className={`min-w-0 ${b.muted ? 'opacity-50' : ''}`}
          >
            <div
              className={`text-xs ${b.current ? 'font-semibold' : ''}`}
              style={{ color: 'var(--text-primary)' }}
            >
              {b.label}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative h-3 min-w-0 flex-1">
                {b.value !== null && (
                  <div
                    aria-hidden
                    className="motion-grow-x absolute inset-y-0 left-0"
                    style={{
                      width: pos(b.value),
                      background: 'var(--series-1)',
                      borderRadius: '0 4px 4px 0',
                    }}
                  />
                )}
                {base !== undefined && (
                  <div
                    aria-hidden
                    className="absolute -inset-y-0.5"
                    style={{
                      left: pos(base),
                      width: 2,
                      marginLeft: -1,
                      background: 'var(--marker)',
                    }}
                  />
                )}
              </div>
              <span
                className="w-32 shrink-0 text-right text-xs tabular-nums sm:w-40"
                style={{ color: 'var(--text-primary)' }}
              >
                {b.valueText}
              </span>
            </div>
            {b.note && (
              <div
                className="text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {b.note}
              </div>
            )}
          </li>
        ))}
      </ul>
      <figcaption
        className="mt-1 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        {caption}
      </figcaption>
    </figure>
  );
}

// ---- 分布のヒストグラム（振り返りの 4 軸。段 3・D-161）----

export type HistogramChartBin = { from: number; to: number; count: number };

/**
 * 小さなヒストグラム（棒は件数・横は値）と「あなた」の印。自分の値を含む棒は強調の色、ほかは控えめの色にし、
 * 色だけに頼らず縦の線と「▼ あなた」のラベルで位置を示す。数値の要約（n 件中 上位 x %）は呼ぶ側がテキストで出す。
 * discrete: 値ごとに幅 1 の棒（整数の軸用。D-166 で ④ を費用の合計に替えてからは使う軸が無い）。値の印は棒の真ん中に置く。
 */
export function HistogramChart({
  bins,
  value,
  discrete = false,
  label,
}: {
  bins: readonly HistogramChartBin[];
  value: number;
  discrete?: boolean;
  /** 読み上げの名前（例: 同じシードの分布）。 */
  label: string;
}) {
  const W = 200;
  const H = 36;
  if (bins.length === 0) return null;
  const lo = bins[0]!.from;
  const hi = bins.at(-1)!.to;
  const span = hi - lo;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const at = discrete ? value + 0.5 : value;
  // 範囲の外（自分が分布に入っていないとき）は端に寄せる。全部同じ値（幅 0）は真ん中
  const frac = span > 0 ? Math.min(1, Math.max(0, (at - lo) / span)) : 0.5;
  const mine = bins.findIndex((b, i) =>
    discrete
      ? Math.floor(value) === b.from
      : value >= b.from &&
        (value < b.to || (i === bins.length - 1 && value <= b.to)),
  );
  const bw = W / bins.length;
  return (
    <figure className="viz-root relative min-w-0 pt-4" data-histogram>
      <div
        aria-hidden
        className="absolute top-0 text-[10px] leading-none font-semibold whitespace-nowrap"
        style={{
          left: `${frac * 100}%`,
          transform: `translateX(${frac > 0.8 ? '-100%' : frac < 0.2 ? '0' : '-50%'})`,
          color: 'var(--text-primary)',
        }}
      >
        ▼ あなた
      </div>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-9 w-full"
      >
        <line
          x1="0"
          x2={W}
          y1={H - 0.5}
          y2={H - 0.5}
          stroke="var(--axis)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {bins.map((b, i) =>
          b.count > 0 ? (
            <rect
              key={i}
              data-mine={i === mine ? 'true' : undefined}
              x={i * bw + bw * 0.1}
              width={bw * 0.8}
              y={H - (b.count / maxCount) * (H - 2)}
              height={(b.count / maxCount) * (H - 2)}
              fill={i === mine ? 'var(--series-1)' : 'var(--deemphasis)'}
            />
          ) : null,
        )}
        <line
          x1={frac * W}
          x2={frac * W}
          y1="0"
          y2={H}
          stroke="var(--marker)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}
