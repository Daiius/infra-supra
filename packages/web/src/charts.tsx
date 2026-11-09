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

// ---- 対数の軸の折れ線（見積の費用の曲線。D-74）----

export type MarkShape = 'circle' | 'square' | 'diamond';

export type CurveChartSeries = {
  id: string;
  label: string;
  /** CSS の色（var(--series-1) など）。 */
  color: string;
  /** 点の形（同じ色の系列を見分ける 2 つ目の手がかり）。 */
  shape: MarkShape;
  /** 添字は xs と同じ。flags が空でない点は × で描き、ツールチップに出す。 */
  points: { y: number; flags: string[] }[];
};

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

/** 止まる点の印（×）。地の色の縁取りで線の上でも読めるようにする。 */
function Cross({ x, y, color }: { x: number; y: number; color: string }) {
  const d = `M${x - 4.5},${y - 4.5}L${x + 4.5},${y + 4.5}M${x + 4.5},${y - 4.5}L${x - 4.5},${y + 4.5}`;
  return (
    <g>
      <path d={d} stroke="var(--surface-1)" strokeWidth="5" />
      <path d={d} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  );
}

/** 凡例の見本（線 + 点の形。× は止まる点の印）。 */
export function SeriesSwatch({
  color,
  shape,
}: {
  color: string;
  shape: MarkShape | 'cross';
}) {
  return (
    <svg width="22" height="12" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="6"
        x2="21"
        y2="6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {shape === 'cross' ? (
        <Cross x={11} y={6} color={color} />
      ) : (
        <MarkGlyph shape={shape} x={11} y={6} color={color} />
      )}
    </svg>
  );
}

/**
 * x・y とも対数の軸の折れ線（2 軸にしない）。y は floor 未満を floor の位置に描く（値はツールチップで読む）。
 * ホバーで最も近い x の縦線とツールチップ。凡例は呼び出し側（系列の選び方と一緒に出す）。直接のラベルは幅があって
 * 描画域に収まるときだけ線の右端に出す（近いものは上下に押し広げる）。
 */
export function LogCurveChart({
  series,
  xs,
  formatX,
  formatY,
  formatValue,
  marker,
  height = 240,
  floor = 1,
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
  floor?: number;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const directLabels = width >= 600 && series.length > 0;
  const pad = {
    top: 14,
    right: directLabels ? 150 : 14,
    bottom: 24,
    left: 44,
  };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const lx0 = Math.log10(xs[0]!);
  const lx1 = Math.log10(xs[xs.length - 1]!);
  const x = (v: number) =>
    pad.left + ((Math.log10(v) - lx0) / Math.max(lx1 - lx0, 1e-9)) * w;
  const maxY = Math.max(
    floor * 10,
    ...series.flatMap((s) => s.points.map((p) => p.y)),
  );
  const ly0 = Math.log10(floor);
  const ly1 = Math.ceil(Math.log10(maxY) - 1e-9);
  const yTicks = Array.from(
    { length: ly1 - ly0 + 1 },
    (_, i) => 10 ** (ly0 + i),
  );
  const y = (v: number) =>
    pad.top +
    h -
    ((Math.log10(Math.max(v, floor)) - ly0) / Math.max(ly1 - ly0, 1e-9)) * h;
  // 狭いときは x の目盛りを 1 つおきにする（文字が重ならないように）
  const xLabelEvery = w / xs.length < 34 ? 2 : 1;

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
    <figure className="viz-root relative block w-full" ref={ref}>
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
            <g key={t}>
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
                {i === 0 ? `≤${formatY(t)}` : formatY(t)}
              </text>
            </g>
          ))}
          {xs.map((v, i) => (
            <text
              key={v}
              x={x(v)}
              y={height - 6}
              textAnchor="middle"
              className="fill-[var(--text-muted)] text-[10px] tabular-nums"
            >
              {i % xLabelEvery === 0 ? formatX(v) : ''}
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
          {series.map((s) => (
            <g key={s.id}>
              {s.points.slice(1).map((p, i) => {
                const a = s.points[i]!;
                // 両端とも止まる区間は薄く（その月額では実際には運用できない）
                const stopped = a.flags.length > 0 && p.flags.length > 0;
                return (
                  <line
                    key={i}
                    x1={x(xs[i]!)}
                    y1={y(a.y)}
                    x2={x(xs[i + 1]!)}
                    y2={y(p.y)}
                    stroke={s.color}
                    strokeOpacity={stopped ? 0.35 : 1}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                );
              })}
              {s.points.map((p, i) =>
                p.flags.length > 0 ? (
                  <Cross key={i} x={x(xs[i]!)} y={y(p.y)} color={s.color} />
                ) : (
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
          ))}
          {labelsFit &&
            ends.map((e) => (
              <text
                key={e.s.id}
                x={pad.left + w + 10}
                y={e.y}
                dy="0.32em"
                className="fill-[var(--text-secondary)] text-[11px]"
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
                    shape={p.flags.length > 0 ? 'cross' : s.shape}
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
                    止まる: {p.flags[0]}
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

/**
 * 比較の図の 1 行（構成・フレームワークごとの小さなヒストグラム）。stats が null なら件数が少なく、棒を描かない。
 * bins は全部の行で共通の区切り（GroupHistogramChart の binEdges）での棒の件数。
 */
export type RangeChartRow = {
  key: string;
  label: string;
  count: number;
  stats: { median: number; bins: readonly number[] } | null;
  mine: boolean;
};

/** 比較の図を 3 列（名前｜棒｜件数）にする最少の幅。これより狭ければ、名前と件数の下に棒を全幅で入れる 2 段組み。 */
export const RANGE_WIDE_MIN = 480;
const RANGE_NAME_W = 220;
const RANGE_COUNT_W = 60;
const RANGE_GAP = 8;
/** 「▼ あなた」の段と目盛りの段の高さ。 */
const RANGE_HEAD_H = 16;
const RANGE_TICKS_H = 16;
/** 1 行の高さ（3 列・2 段組み）。2 段組みは名前の段（16px）の下にヒストグラム（3 列と同じ高さ）。 */
const RANGE_ROW_H = 28;
const RANGE_NAME_ROW_H = 16;
/** 中央値の印（棒の下の短い縦の印）の長さ。 */
const MEDIAN_TICK = 5;
/** 12px の文字の幅の目安（全角 12・半角 7）。名前を列に収めるときに使う。 */
const charW = (c: string) => (c.charCodeAt(0) > 0xff ? 12 : 7);

/** 名前を幅に収める（はみ出せば末尾を … にする。全部の名前は title で読める）。 */
export function fitText(s: string, width: number): string {
  let w = 0;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    w += charW(chars[i]!);
    if (w > width) {
      let out = chars.slice(0, i).join('');
      let ow = [...out].reduce((n, c) => n + charW(c), 0);
      while (out && ow + 12 > width) {
        const last = [...out].at(-1)!;
        out = [...out].slice(0, -1).join('');
        ow -= charW(last);
      }
      return `${out}…`;
    }
  }
  return s;
}

/**
 * 比較の図の配置（純粋な計算。幅は実際の画素）。棒・中央値・自分の線・目盛り・「▼ あなた」を全部この 1 つの x の座標（xOf）で置く。
 * wide: 名前（RANGE_NAME_W まで）｜棒（残り全部）｜件数（RANGE_COUNT_W）の 3 列。狭いとき: 名前と件数の段の下に棒を全幅。
 * 横の範囲は共通の区切り（binEdges）の両端で、自分の値が外にあれば広げる。
 */
export function groupRangeLayout(
  width: number,
  rows: readonly unknown[],
  value: number,
  binEdges: readonly number[],
) {
  const wide = width >= RANGE_WIDE_MIN;
  const nameW = wide ? Math.min(RANGE_NAME_W, width * 0.3) : width;
  const bandX0 = wide ? nameW + RANGE_GAP : 0;
  const bandX1 = wide ? width - RANGE_COUNT_W - RANGE_GAP : width;
  // 棒の列の中で、端の目盛りの文字・自分の線が切れないよう少し内側に寄せる
  const inset = 4;
  const edgeLo = binEdges[0] ?? value;
  const edgeHi = binEdges.at(-1) ?? value;
  let lo = Math.min(value, edgeLo);
  let hi = Math.max(value, edgeHi);
  if (hi - lo <= 0) {
    const d = Math.abs(lo) * 0.1 || 1;
    lo -= d;
    hi += d;
  }
  const xOf = (v: number) =>
    bandX0 + inset + ((v - lo) / (hi - lo)) * (bandX1 - bandX0 - 2 * inset);
  const rowH = wide ? RANGE_ROW_H : RANGE_NAME_ROW_H + RANGE_ROW_H;
  const rowTop = (i: number) => RANGE_HEAD_H + i * rowH;
  /** ヒストグラムの上端と、棒の下端（基線）。中央値の印は基線の下に MEDIAN_TICK だけ伸ばす。 */
  const histTop = (i: number) => rowTop(i) + (wide ? 0 : RANGE_NAME_ROW_H) + 3;
  const baseY = (i: number) => rowTop(i) + rowH - MEDIAN_TICK - 2;
  const textY = (i: number) => rowTop(i) + (wide ? rowH / 2 + 4 : 12);
  const rowsBottom = RANGE_HEAD_H + rows.length * rowH;
  const height = rowsBottom + RANGE_TICKS_H;
  const ticksY = height - 4;
  const tickValues =
    binEdges.length > 1
      ? [edgeLo, binEdges[Math.floor((binEdges.length - 1) / 2)]!, edgeHi]
      : [value];
  const ticks = tickValues.map((t) => ({ v: t, x: xOf(t) }));
  return {
    wide,
    nameW,
    bandX0,
    bandX1,
    xOf,
    mineX: xOf(value),
    /** 「あなた」を ▼ の左に置くか（右の端に近いとき。棒の列からはみ出さない）。 */
    mineEnd: bandX1 - xOf(value) < 48,
    rowH,
    rowTop,
    histTop,
    baseY,
    textY,
    rowsBottom,
    height,
    ticksY,
    ticks,
  };
}

/**
 * 行ごとの分布の比較（ST-11・D-175）: 各行に小さなヒストグラム（全部の行で同じ x 軸と区切り）を描き、棒の下に中央値の短い縦の印、
 * 全部の行を貫く自分の値の縦の線を引く（色だけに頼らず「▼ あなた」のラベル）。棒の高さは行ごとの最大で割る（件数の違う行どうしでも
 * 形を比べられるように。呼ぶ側の注記に書く）。自分の構成の行は強調の色・ほかは控えめの色（emphasis）。良し悪しの色（status）は
 * 使わない（向きを持たない ④ 費用の合計にも同じ図を使う。D-166）。件数が少ない行は棒を出さず emptyText を出す。
 * 件数は行ごとに常にテキストで出す。数値は呼ぶ側の表（数値で見る）でも読める。
 * 1 つの SVG を実際の幅（画素）で描き、文字も同じ座標で置く（HTML のグリッドと伸び縮みする SVG を混ぜると列がずれたため）。
 */
export function GroupHistogramChart({
  rows,
  binEdges,
  value,
  format,
  label,
  emptyText,
}: {
  rows: readonly RangeChartRow[];
  /** 全部の行で共通の区切り（棒の数 + 1 個）。 */
  binEdges: readonly number[];
  /** 自分の値。 */
  value: number;
  format: (n: number) => string;
  /** 読み上げの名前（図全体）。 */
  label: string;
  /** 件数が少ない行の文（例: まだ 3 件です）。 */
  emptyText: (count: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const L = width > 0 ? groupRangeLayout(width, rows, value, binEdges) : null;
  return (
    <figure className="viz-root min-w-0" data-group-range-chart>
      <div ref={ref} className="w-full">
        {L && (
          <svg
            role="group"
            aria-label={label}
            width={width}
            height={L.height}
            viewBox={`0 0 ${width} ${L.height}`}
            className="block"
            data-layout={L.wide ? 'wide' : 'narrow'}
            data-band-x0={L.bandX0}
            data-band-x1={L.bandX1}
            fontSize="12"
          >
            {rows.map((r, i) => {
              const top = L.histTop(i);
              const base = L.baseY(i);
              const ty = L.textY(i);
              const nameMax = L.wide ? L.nameW : width - RANGE_COUNT_W;
              const name = `${r.label}${r.mine ? '（あなた）' : ''}`;
              const bins = r.stats?.bins ?? [];
              const rowMax = Math.max(1, ...bins);
              return (
                <g
                  key={r.key}
                  data-group-row={r.key}
                  data-mine={r.mine ? 'true' : undefined}
                >
                  <title>{name}</title>
                  <text
                    x="0"
                    y={ty}
                    fill="var(--text-primary)"
                    fontWeight={r.mine ? 600 : 400}
                    data-group-name
                  >
                    {fitText(name, nameMax)}
                  </text>
                  <text
                    x={width}
                    y={ty}
                    textAnchor="end"
                    fill="var(--text-primary)"
                    className="tabular-nums"
                    data-group-count
                  >
                    {r.count} 件
                  </text>
                  <line
                    x1={L.bandX0}
                    x2={L.bandX1}
                    y1={base + 0.5}
                    y2={base + 0.5}
                    stroke="var(--axis)"
                    strokeWidth="1"
                  />
                  {r.stats ? (
                    <g
                      role="img"
                      aria-label={`${r.label}: ${r.count} 件・中央値 ${format(r.stats.median)}`}
                      data-group-hist
                    >
                      {bins.map((n, k) => {
                        if (n <= 0 || binEdges.length < k + 2) return null;
                        // 隣の棒との間に 2px の地の色のすき間
                        const x0 = L.xOf(binEdges[k]!) + 1;
                        const x1 = L.xOf(binEdges[k + 1]!) - 1;
                        const h = (n / rowMax) * (base - top);
                        return (
                          <rect
                            key={k}
                            x={x0}
                            width={Math.max(1, x1 - x0)}
                            y={base - h}
                            height={h}
                            fill={
                              r.mine ? 'var(--series-1)' : 'var(--deemphasis)'
                            }
                            data-bin={k}
                          />
                        );
                      })}
                      <line
                        x1={L.xOf(r.stats.median)}
                        x2={L.xOf(r.stats.median)}
                        y1={base + 1}
                        y2={base + 1 + MEDIAN_TICK}
                        stroke="var(--text-primary)"
                        strokeWidth="2"
                        data-group-median
                      />
                    </g>
                  ) : (
                    <text
                      x={L.bandX0 + 4}
                      y={base - 4}
                      fill="var(--text-muted)"
                      data-group-few
                    >
                      {emptyText(r.count)}
                    </text>
                  )}
                </g>
              );
            })}
            {/* 自分の値の縦の線（全部の行を貫く）と、その真上の ▼・横の「あなた」（右の端では左へ寄せる） */}
            <line
              x1={L.mineX}
              x2={L.mineX}
              y1={RANGE_HEAD_H - 4}
              y2={L.rowsBottom}
              stroke="var(--marker)"
              strokeWidth="2"
              data-group-mine-line
            />
            <g aria-hidden data-group-mine-label data-x={L.mineX}>
              <path
                d={`M${L.mineX - 4},2 L${L.mineX + 4},2 L${L.mineX},8 Z`}
                fill="var(--text-primary)"
              />
              <text
                x={L.mineEnd ? L.mineX - 7 : L.mineX + 7}
                y="9"
                textAnchor={L.mineEnd ? 'end' : 'start'}
                fontSize="10"
                fontWeight="600"
                fill="var(--text-primary)"
              >
                あなた
              </text>
            </g>
            <g
              aria-hidden
              fontSize="10"
              fill="var(--text-muted)"
              className="tabular-nums"
              data-group-ticks
            >
              {L.ticks.map((t, i, all) => (
                <text
                  key={i}
                  x={t.x}
                  y={L.ticksY}
                  textAnchor={
                    all.length === 1
                      ? 'middle'
                      : i === 0
                        ? 'start'
                        : i === all.length - 1
                          ? 'end'
                          : 'middle'
                  }
                  data-x={t.x}
                >
                  {format(t.v)}
                </text>
              ))}
            </g>
          </svg>
        )}
      </div>
    </figure>
  );
}
