// 機能開発の効き目のグラフ（D-122）: 機能開発の累計と期待の折れ線。段階（悪い・普通・良い）の区間を薄い帯で塗り、
// 行動の欄では選んでいる行動を当てた来月の見込みを破線の 1 点で延ばす。月の報告の手間の棒の下と、行動の欄の来月の見込みの下に出す。
// 値は game の関数（featureProgressOf・featureOutlook）と history から引き、式を持たない。
// 図の作法は charts.tsx に揃える（2px の線・r4 の端点と地の色の輪・細い実線の目盛り・2 系列以上は凡例・ホバーで縦線とツールチップ）。
import { useState, type ReactNode } from 'react';
import {
  featureProgressOf,
  STAGE_LABEL,
  type FeatureOutlook,
  type MonthReport,
  type Scenario,
} from 'game';
import { niceTicks, useWidth } from './charts.tsx';
import { FeatureRing } from './feature-ring.tsx';

/**
 * 案 E（手間の輪）を試す一時的な切り替え（D-122 の補足 3）。`?featureViz=E` のときだけ輪を出し、それ以外は折れ線。
 * 1 案に決めたら、この関数と使わない方の部品を消す。
 */
const ringTrial = () =>
  new URLSearchParams(window.location.search).get('featureViz') === 'E';

/**
 * 機能開発の累計と期待の折れ線。next を渡すと、来月の見込み（選んでいる行動を当てた featureOutlook の累計）まで破線で延ばす。
 */
export function FeatureChart({
  scenario,
  history,
  next,
}: {
  scenario: Scenario;
  history: readonly MonthReport[];
  next?: FeatureOutlook;
}) {
  const last = history[history.length - 1];
  if (!last) return null;
  if (ringTrial())
    return (
      <div className="mt-2" data-feature-chart="ring">
        {next ? (
          <FeatureRing
            scenario={scenario}
            month={next.month}
            total={next.total}
            effort={next.effort}
            change={next.change}
            next
          />
        ) : (
          <FeatureRing
            scenario={scenario}
            month={last.month}
            total={last.featurePoints}
            effort={last.effort}
          />
        )}
      </div>
    );
  return (
    <div className="mt-2" data-feature-chart="lines">
      <FeatureLines
        scenario={scenario}
        history={history}
        {...(next ? { next: { month: next.month, total: next.total } } : {})}
      />
    </div>
  );
}

type Pt = { m: number; v: number };

const fmt = (n: number) => String(Number(n.toFixed(1)));

/**
 * 小さな折れ線。区間（段階の帯）・参照の線（期待）・系列の線。ホバーで月に合わせた縦線と、全系列の値のツールチップ。
 */
function MiniLineChart({
  title,
  from,
  to,
  height = 170,
  lines,
  refLine,
  zones = [],
}: {
  title: string;
  from: number;
  to: number;
  height?: number;
  lines: {
    id: string;
    label: string;
    color: string;
    points: Pt[];
    /** 見込みの線（破線）。 */
    dashed?: boolean;
    /** 凡例に出さない（実線の続きの見込みなど）。 */
    noLegend?: boolean;
  }[];
  refLine: { label: string; points: Pt[] };
  zones?: { label: string; fill: string; lower: Pt[]; upper: Pt[] }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 10, right: 12, bottom: 22, left: 36 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const all = [
    ...lines.flatMap((l) => l.points.map((p) => p.v)),
    ...refLine.points.map((p) => p.v),
  ];
  const ticks = niceTicks(Math.max(...all, 1));
  const top = ticks[ticks.length - 1]!;
  const span = Math.max(to - from, 1);
  const x = (m: number) => pad.left + ((m - from) / span) * w;
  const y = (v: number) => pad.top + h - (Math.min(v, top) / top) * h;
  const path = (pts: Pt[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m)},${y(p.v)}`).join('');
  const area = (lower: Pt[], upper: Pt[]) =>
    `${path(upper)}${[...lower]
      .reverse()
      .map((p) => `L${x(p.m)},${y(p.v)}`)
      .join('')}Z`;
  const months = Array.from({ length: span + 1 }, (_, i) => from + i);
  // 目盛りの月は狭い画面で重ならないよう間引く
  const every = Math.max(1, Math.ceil((span + 1) / Math.max(1, w / 24)));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = Math.round(
      ((e.clientX - rect.left - pad.left) / Math.max(w, 1)) * span + from,
    );
    setHover(m >= from && m <= to ? m : null);
  };
  const at = (pts: Pt[], m: number) => pts.find((p) => p.m === m)?.v;
  const legend = lines.filter((l) => !l.noLegend);
  return (
    <figure
      className="viz-root relative block w-full"
      style={{ overflow: 'visible' }}
      ref={ref}
    >
      <figcaption className="mb-1 text-xs font-semibold">{title}</figcaption>
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
        {legend.map((l) => (
          <LineKey key={l.id} color={l.color} dashed={l.dashed}>
            {l.label}
          </LineKey>
        ))}
        <LineKey color="var(--marker)" thin>
          {refLine.label}
        </LineKey>
        {zones.map((z) => (
          <span key={z.label} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: z.fill }}
            />
            {z.label}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg
          width="100%"
          height={height}
          overflow="visible"
          role="img"
          aria-label={title}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {zones.map((z) => (
            <path key={z.label} d={area(z.lower, z.upper)} fill={z.fill} />
          ))}
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
                {t}
              </text>
            </g>
          ))}
          {months
            .filter((m) => (m - from) % every === 0)
            .map((m) => (
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
          <path
            d={path(refLine.points)}
            fill="none"
            stroke="var(--marker)"
            strokeWidth="1"
          />
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
          {lines.map((l) => {
            const end = l.points[l.points.length - 1];
            return (
              <g key={l.id}>
                {l.points.length > 1 && (
                  <path
                    d={path(l.points)}
                    fill="none"
                    stroke={l.color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={l.dashed ? '4 4' : undefined}
                  />
                )}
                {end && (
                  <circle
                    cx={x(end.m)}
                    cy={y(end.v)}
                    r="4"
                    // 見込みの端は中を地の色にして、実績の点と見分ける
                    fill={l.dashed ? 'var(--surface-1)' : l.color}
                    stroke={l.dashed ? l.color : 'var(--surface-1)'}
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-box border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs shadow"
          style={{
            left: Math.min(x(hover) + 8, Math.max(0, width - 150)),
            top: 24,
          }}
        >
          <div className="text-[var(--text-secondary)]">{hover} か月目</div>
          {lines.map((l) => {
            const v = at(l.points, hover);
            // 見込みの線の起点（実績の線の端と同じ点）は、実績の行だけを出す
            const dup =
              l.dashed &&
              lines.some(
                (o) =>
                  !o.dashed &&
                  o.color === l.color &&
                  at(o.points, hover) !== undefined,
              );
            return v === undefined || dup ? null : (
              <TipRow key={l.id} color={l.color} value={fmt(v)}>
                {l.label}
                {l.dashed ? '（見込み）' : ''}
              </TipRow>
            );
          })}
          {at(refLine.points, hover) !== undefined && (
            <TipRow
              color="var(--marker)"
              value={fmt(at(refLine.points, hover)!)}
            >
              {refLine.label}
            </TipRow>
          )}
        </div>
      )}
    </figure>
  );
}

function LineKey({
  color,
  dashed,
  thin,
  children,
}: {
  color: string;
  dashed?: boolean | undefined;
  thin?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1">
      <svg width="14" height="4" aria-hidden>
        <line
          x1="1"
          y1="2"
          x2="13"
          y2="2"
          stroke={color}
          strokeWidth={thin ? 1 : 2}
          strokeLinecap="round"
          strokeDasharray={dashed ? '3 3' : undefined}
        />
      </svg>
      {children}
    </span>
  );
}

function TipRow({
  color,
  value,
  children,
}: {
  color: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="10" height="4" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="10"
          y2="2"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
        {value}
      </span>
      <span className="text-[var(--text-secondary)]">{children}</span>
    </div>
  );
}

/** 累計と期待の折れ線。段階の区間を薄い帯で、来月の見込みを破線の 1 点で延ばす。 */
function FeatureLines({
  scenario: sc,
  history,
  next,
}: {
  scenario: Scenario;
  history: readonly MonthReport[];
  next?: { month: number; total: number };
}) {
  const to = Math.max(sc.months, next?.month ?? 0, history.length);
  const progress = Array.from({ length: to + 1 }, (_, m) =>
    featureProgressOf(sc, 0, m),
  );
  const pts = (pick: (p: (typeof progress)[number]) => number) =>
    progress.map((p, m) => ({ m, v: pick(p) }));
  const zero = pts(() => 0);
  const fair = pts((p) => p.fairAt);
  const good = pts((p) => p.goodAt);
  // 良いの帯の上端は、累計の線より少し上まで（軸の上限を帯で決めない）
  const actual: Pt[] = [
    { m: 0, v: 0 },
    ...history.map((r) => ({ m: r.month, v: r.featurePoints })),
  ];
  const last = actual[actual.length - 1]!;
  const ceiling = good.map((p) => ({ m: p.m, v: p.v * 1.25 }));
  return (
    <MiniLineChart
      title="機能開発の累計と期待"
      from={0}
      to={to}
      lines={[
        {
          id: 'total',
          label: '累計',
          color: 'var(--series-1)',
          points: actual,
        },
        ...(next
          ? [
              {
                id: 'next',
                label: '来月の見込み',
                color: 'var(--series-1)',
                points: [last, { m: next.month, v: next.total }],
                dashed: true,
              },
            ]
          : []),
      ]}
      refLine={{
        label: `期待（月 ${sc.satisfaction.feature.expectedPerMonth} × 月数）`,
        points: pts((p) => p.expected),
      }}
      zones={[
        {
          label: `${STAGE_LABEL.bad}`,
          fill: 'var(--status-critical-track)',
          lower: zero,
          upper: fair,
        },
        {
          label: `${STAGE_LABEL.fair}`,
          fill: 'var(--status-warning-track)',
          lower: fair,
          upper: good,
        },
        {
          label: `${STAGE_LABEL.good}`,
          fill: 'var(--status-good-track)',
          lower: good,
          upper: ceiling,
        },
      ]}
    />
  );
}
