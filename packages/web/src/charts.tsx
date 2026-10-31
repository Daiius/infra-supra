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
};

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
    <g aria-hidden pointerEvents="none">
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
  /** 境目の線（使用率 100% など）。 */
  reference?: { value: number; label: string };
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
  ]);
  const ticks = niceTicks(yMax ?? Math.max(reference?.value ?? 0, ...all, 0));
  const top = ticks[ticks.length - 1]!;
  const x = (month: number) =>
    pad.left + (months <= 1 ? 0 : ((month - 1) / (months - 1)) * w);
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
    const m = Math.round(((px - pad.left) / Math.max(w, 1)) * (months - 1)) + 1;
    setHover(m >= 1 && m <= months ? m : null);
  };

  const hoverRows =
    hover === null
      ? []
      : series
          .map((s) => {
            const v = s.values[hover - 1];
            const p = s.projection?.find(
              (q) => q.month === hover && hover - 1 > lastIndex(s),
            );
            return v !== null && v !== undefined
              ? { s, value: format(v), note: '' }
              : p
                ? { s, value: format(p.value), note: '（見込み）' }
                : null;
          })
          .filter((r) => r !== null);

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
      {series.length > 1 && (
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
        </div>
      )}
      {width > 0 && (
        <svg
          width={width}
          height={height}
          // 最新の点の輪が端で切れないように
          overflow="visible"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={typeof title === 'string' ? title : '推移のグラフ'}
        >
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
            <g>
              <line
                x1={pad.left}
                x2={pad.left + w}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--status-critical)"
                strokeWidth="1"
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
          {series.map((s) => {
            // 記録のない月で線を切る（構成を乗り換えて前提が途切れたとき）
            const runs: { m: number; v: number }[][] = [];
            let current: { m: number; v: number }[] | null = null;
            s.values.forEach((v, i) => {
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
            <div key={r.s.id} className="flex items-center gap-2">
              <svg width="10" height="4" aria-hidden>
                <line
                  x1="0"
                  y1="2"
                  x2="10"
                  y2="2"
                  stroke={r.s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
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

/** 数値タイルの小さな推移（12 点・目立たない色。今月だけ強調色の点）。 */
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
  const stroke = li >= 1 ? `url(#${gid})` : 'var(--deemphasis)';
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
          <FadeGradient
            id={gid}
            color="var(--deemphasis)"
            x1={x(0)}
            x2={x(li)}
          />
        </defs>
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
