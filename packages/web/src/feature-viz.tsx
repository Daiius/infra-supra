// 機能開発の効き目のグラフの案（D-122 の補足・一時的）。URL の `?featureViz=A|B|C|D|none` で案を選び、そのときだけ画面の上に
// 切り替えを出す（既定は出さない＝今の文字だけの表示）。1 案に絞ったら、このファイルの切り替え（useFeatureViz・FeatureVizSwitch）と
// 使わない案を消す。値は game の関数（featureProgressOf・featureOutlook・featureProjection）と history から引き、式を持たない。
// 図の作法は charts.tsx に揃える（2px の線・r4 の端点と地の色の輪・細い実線の目盛り・2 系列以上は凡例・ホバーで縦線とツールチップ）。
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  featureProgressOf,
  featureProjection,
  scenarioOf,
  STAGE_LABEL,
  type Action,
  type EffortBreakdown,
  type FeatureOutlook,
  type GameState,
  type MonthReport,
  type Scenario,
} from 'game';
import { niceTicks, useWidth } from './charts.tsx';

// ---- 切り替え（一時的。消すときはここから） ----

const VIZ = ['none', 'A', 'B', 'C', 'D'] as const;
export type FeatureViz = (typeof VIZ)[number];
const PARAM = 'featureViz';
const VIZ_LABEL: Record<FeatureViz, string> = {
  none: 'なし',
  A: 'A 累計の折れ線',
  B: 'B 目盛り',
  C: 'C 月ごとの手間',
  D: 'D 提案の比較',
};

const listeners = new Set<() => void>();
const readViz = (): FeatureViz | null => {
  const v = new URLSearchParams(window.location.search).get(PARAM);
  if (v === null) return null;
  return (VIZ as readonly string[]).includes(v) ? (v as FeatureViz) : 'none';
};
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', cb);
  };
};
const setViz = (v: FeatureViz) => {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, v);
  window.history.replaceState(window.history.state, '', url);
  listeners.forEach((l) => l());
};

/** 選んでいる案（URL に `featureViz` が無ければ null＝切り替えを出さず、グラフも出さない）。 */
export function useFeatureViz(): FeatureViz | null {
  return useSyncExternalStore(subscribe, readViz, () => null);
}

/** 案の切り替え（URL に `featureViz` があるときだけ出す）。 */
export function FeatureVizSwitch() {
  const v = useFeatureViz();
  if (v === null) return null;
  return (
    <div
      role="group"
      aria-label="機能開発のグラフの案（一時的）"
      className="flex flex-wrap items-center gap-1 rounded-box border border-dashed border-base-300 bg-base-100 p-2 text-xs"
    >
      <span className="opacity-70">グラフの案（一時的）:</span>
      {VIZ.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={v === k}
          className={`btn btn-xs ${v === k ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setViz(k)}
        >
          {VIZ_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

// ---- 置き場ごとの出し分け ----

/** 月の報告の手間の棒の下（A・B・C。来月の見込みは出さない）。 */
export function FeatureVizReport({
  scenario: sc,
  history,
}: {
  scenario: Scenario;
  history: readonly MonthReport[];
}) {
  const v = useFeatureViz();
  const last = history[history.length - 1];
  if (!last) return null;
  if (v === 'A')
    return (
      <Wrap viz="A">
        <FeatureLines scenario={sc} history={history} />
      </Wrap>
    );
  if (v === 'B')
    return (
      <Wrap viz="B">
        <FeatureBullet
          scenario={sc}
          total={last.featurePoints}
          month={last.month}
        />
      </Wrap>
    );
  if (v === 'C')
    return (
      <Wrap viz="C">
        <EffortColumns scenario={sc} history={history} />
      </Wrap>
    );
  return null;
}

/** 行動の欄の「来月の機能開発」の近く（A・B・C。選んでいる行動を当てた来月の見込みを足す）。 */
export function FeatureVizOutlook({
  state,
  outlook,
}: {
  state: GameState;
  outlook: FeatureOutlook;
}) {
  const v = useFeatureViz();
  const sc = scenarioOf(state);
  if (v === 'A')
    return (
      <Wrap viz="A">
        <FeatureLines
          scenario={sc}
          history={state.history}
          next={{ month: outlook.month, total: outlook.total }}
        />
      </Wrap>
    );
  if (v === 'B')
    return (
      <Wrap viz="B">
        <FeatureBullet
          scenario={sc}
          total={state.featurePoints}
          month={outlook.month}
          increment={outlook.feature}
        />
      </Wrap>
    );
  if (v === 'C')
    return (
      <Wrap viz="C">
        <EffortColumns
          scenario={sc}
          history={state.history}
          next={outlook.effort}
        />
      </Wrap>
    );
  return null;
}

/** 提案のカードの中（D。受けた場合と断った場合の、累計の今後 3 か月の見込み）。 */
export function FeatureVizProposal({
  state,
  accept,
  decline,
}: {
  state: GameState;
  /** 受けたときの行動の組（受けられなければ null）。 */
  accept: Action[] | null;
  decline: Action[];
}) {
  const v = useFeatureViz();
  if (v !== 'D' || !accept) return null;
  const sc = scenarioOf(state);
  const now = state.history.length;
  const months = 3;
  const line = (values: number[]) => [
    { m: now, v: state.featurePoints },
    ...values.map((v, i) => ({ m: now + i + 1, v })),
  ];
  const acc = line(featureProjection(state, accept, months));
  const dec = line(featureProjection(state, decline, months));
  return (
    <Wrap viz="D">
      <MiniLineChart
        title={`機能開発の累計の見込み（${months} か月）`}
        from={now}
        to={now + months}
        height={130}
        lines={[
          {
            id: 'accept',
            label: '受ける',
            color: 'var(--series-1)',
            points: acc,
            dashed: true,
          },
          {
            id: 'decline',
            label: '断る',
            color: 'var(--series-2)',
            points: dec,
            dashed: true,
          },
        ]}
        refLine={expectedLine(sc, now, now + months)}
      />
    </Wrap>
  );
}

// ---- 案ごとの部品 ----

function Wrap({ viz, children }: { viz: FeatureViz; children: ReactNode }) {
  return (
    <div className="mt-2" data-feature-viz={viz}>
      {children}
    </div>
  );
}

type Pt = { m: number; v: number };

const expectedLine = (sc: Scenario, from: number, to: number) => ({
  label: '期待',
  points: Array.from({ length: to - from + 1 }, (_, i) => ({
    m: from + i,
    v: featureProgressOf(sc, 0, from + i).expected,
  })),
});

const fmt = (n: number) => String(Number(n.toFixed(1)));

/**
 * 小さな折れ線（A・D で共用）。区間（段階の帯）・参照の線（期待）・系列の線。ホバーで月に合わせた縦線と、全系列の値のツールチップ。
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

/** A. 累計と期待の折れ線。段階の区間を薄い帯で、来月の見込みを破線の 1 点で延ばす。 */
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

/**
 * B. 横の目盛り（bullet）。下地を段階の区間（悪い・普通・良い）で塗り、累計の棒と、普通の境目・期待の目盛りを重ねる。
 * 来月の見込みの増分は棒の続きとして薄く重ねる。
 */
function FeatureBullet({
  scenario: sc,
  total,
  month,
  increment,
}: {
  scenario: Scenario;
  total: number;
  /** 目盛り（期待）を取る月。 */
  month: number;
  increment?: number;
}) {
  const p = featureProgressOf(sc, total + (increment ?? 0), month);
  const max = Math.max(p.goodAt * 1.3, p.total * 1.05, 1);
  const pct = (v: number) => `${(Math.max(0, Math.min(v, max)) / max) * 100}%`;
  const zones = [
    { stage: 'bad' as const, from: 0, to: p.fairAt, fill: 'critical' },
    { stage: 'fair' as const, from: p.fairAt, to: p.goodAt, fill: 'warning' },
    { stage: 'good' as const, from: p.goodAt, to: max, fill: 'good' },
  ];
  const marks = [
    { v: p.fairAt, label: `普通 ${fmt(p.fairAt)}` },
    { v: p.goodAt, label: `期待 ${fmt(p.goodAt)}` },
  ];
  const text = `${month} か月目の期待で見た累計 ${fmt(total)}${increment !== undefined ? `（来月 +${fmt(increment)} → ${fmt(p.total)}）` : ''} →「機能」は${STAGE_LABEL[p.stage]}`;
  return (
    <div className="viz-root" role="img" aria-label={text}>
      <div className="mb-1 text-xs text-[var(--text-secondary)]">{text}</div>
      <div className="relative pb-5">
        <div
          className="relative h-5 w-full overflow-hidden"
          style={{ borderRadius: 4 }}
        >
          {zones.map((z) => (
            <div
              key={z.stage}
              className="absolute inset-y-0 flex items-center justify-center text-[10px] text-[var(--text-secondary)]"
              style={{
                left: pct(z.from),
                width: `calc(${pct(z.to)} - ${pct(z.from)})`,
                background: `var(--status-${z.fill}-track)`,
              }}
            >
              {STAGE_LABEL[z.stage]}
            </div>
          ))}
          <div
            className="absolute left-0 h-2"
            style={{
              top: 6,
              width: pct(total),
              background: 'var(--series-1)',
              borderRadius: '0 4px 4px 0',
            }}
          />
          {increment !== undefined && increment > 0 && (
            <div
              className="absolute h-2"
              style={{
                top: 6,
                left: pct(total),
                width: `calc(${pct(total + increment)} - ${pct(total)})`,
                background: 'var(--series-1)',
                opacity: 0.4,
                borderRadius: '0 4px 4px 0',
              }}
            />
          )}
        </div>
        {marks.map((m, i) => (
          <div key={m.label}>
            <div
              aria-hidden
              className="absolute -top-0.5 h-6"
              style={{
                left: pct(m.v),
                width: 2,
                marginLeft: -1,
                background: 'var(--marker)',
              }}
            />
            <div
              aria-hidden
              className="absolute top-5 text-[10px] whitespace-nowrap text-[var(--text-muted)]"
              style={{
                left: pct(m.v),
                // 2 つの目盛りの文字が重ならないよう、普通は左へ・期待は右へ寄せる
                transform: i === 0 ? 'translateX(-100%)' : 'translateX(0)',
                paddingLeft: i === 0 ? 0 : 3,
                paddingRight: i === 0 ? 3 : 0,
              }}
            >
              {m.label}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-[var(--text-secondary)]">
        <Swatch fill="var(--series-1)">累計</Swatch>
        {increment !== undefined && (
          <Swatch fill="var(--series-1)" opacity={0.4}>
            来月の見込み
          </Swatch>
        )}
      </div>
    </div>
  );
}

function Swatch({
  fill,
  opacity = 1,
  children,
}: {
  fill: string;
  opacity?: number;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: fill, opacity }}
      />
      {children}
    </span>
  );
}

/**
 * C の積み上げの区分（下から。機能開発に数える 2 つを下に置き、期待の横線と上端を比べられるようにする）。
 * 色の並びは validate_palette.js で隣どうしを検査した順（2026-11-04・light で全項目 PASS。地の色との対比は WARN なので凡例とツールチップを付ける）。
 */
const SEGMENTS: {
  key: string;
  label: string;
  color: string;
  of: (e: EffortBreakdown) => number;
}[] = [
  {
    key: 'feature',
    label: '機能開発（残り）',
    color: 'var(--series-3)',
    of: (e) => e.feature - e.featureWork - e.featureBonus,
  },
  {
    key: 'proposal',
    label: '提案の作業と加点',
    color: 'var(--series-6)',
    of: (e) => e.featureWork + e.featureBonus,
  },
  {
    key: 'actions',
    label: '行動',
    color: 'var(--series-5)',
    of: (e) => e.actions,
  },
  {
    key: 'upkeep',
    label: '維持・他の事業者の管理',
    color: 'var(--series-4)',
    of: (e) => e.upkeep + (e.accounts ?? 0),
  },
  {
    key: 'migration',
    label: '乗り換え・作り直し・移し替え',
    color: 'var(--series-1)',
    of: (e) => e.migration,
  },
  {
    key: 'interrupt',
    label: '出来事への対応',
    color: 'var(--series-2)',
    of: (e) => e.interrupt,
  },
];

/** C. 月ごとの手間の積み上げ。期待の月あたりを横線で、来月の列は選んでいる行動からの見込みを薄く描く。 */
function EffortColumns({
  scenario: sc,
  history,
  next,
}: {
  scenario: Scenario;
  history: readonly MonthReport[];
  next?: EffortBreakdown;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const cols = [
    ...history.map((r) => ({ month: r.month, e: r.effort, next: false })),
    ...(next ? [{ month: history.length + 1, e: next, next: true }] : []),
  ];
  const perMonth = sc.satisfaction.feature.expectedPerMonth;
  const height = 170;
  const pad = { top: 10, right: 12, bottom: 22, left: 28 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const totals = cols.map((c) =>
    SEGMENTS.reduce((a, s) => a + Math.max(0, s.of(c.e)), 0),
  );
  const ticks = niceTicks(Math.max(...totals, perMonth, 1));
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => pad.top + h - (Math.min(v, top) / top) * h;
  const slots = Math.max(cols.length, sc.months);
  const band = w / Math.max(slots, 1);
  const barW = Math.min(24, band * 0.7);
  const cx = (i: number) => pad.left + band * (i + 0.5);
  const hovered = hover === null ? null : cols[hover];
  return (
    <figure
      className="viz-root relative block w-full"
      style={{ overflow: 'visible' }}
      ref={ref}
    >
      <figcaption className="mb-1 text-xs font-semibold">
        月ごとの手間の使い道
      </figcaption>
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
        {SEGMENTS.map((s) => (
          <Swatch key={s.key} fill={s.color}>
            {s.label}
          </Swatch>
        ))}
        <LineKey color="var(--marker)" thin>
          期待（月 {perMonth}）
        </LineKey>
      </div>
      {width > 0 && (
        <svg
          width="100%"
          height={height}
          overflow="visible"
          role="img"
          aria-label="月ごとの手間の使い道"
          onPointerLeave={() => setHover(null)}
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
                {t}
              </text>
            </g>
          ))}
          {cols.map((c, i) => {
            let acc = 0;
            const parts = SEGMENTS.map((s) => {
              const v = Math.max(0, s.of(c.e));
              const from = acc;
              acc += v;
              return { s, v, from };
            }).filter((p) => p.v > 0);
            return (
              <g
                key={c.month}
                opacity={c.next ? 0.45 : 1}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${c.month} か月目${c.next ? '（見込み）' : ''}`}
              >
                {/* 当たりの範囲は棒より広く（列の幅いっぱい） */}
                <rect
                  x={cx(i) - band / 2}
                  y={pad.top}
                  width={band}
                  height={h}
                  fill="transparent"
                />
                {parts.map((p) => (
                  <rect
                    key={p.s.key}
                    x={cx(i) - barW / 2}
                    y={y(p.from + p.v)}
                    width={barW}
                    // 区分の間に 2px の地の色の隙間
                    height={Math.max(0, y(p.from) - y(p.from + p.v) - 2)}
                    fill={p.s.color}
                    rx="1"
                  />
                ))}
              </g>
            );
          })}
          {cols.map((c, i) => (
            <text
              key={c.month}
              x={cx(i)}
              y={height - 6}
              textAnchor="middle"
              className="fill-[var(--text-muted)] text-[10px] tabular-nums"
            >
              {c.next ? `${c.month}?` : c.month}
            </text>
          ))}
          <line
            x1={pad.left}
            x2={pad.left + w}
            y1={y(perMonth)}
            y2={y(perMonth)}
            stroke="var(--marker)"
            strokeWidth="1"
            pointerEvents="none"
          />
        </svg>
      )}
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-box border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs shadow"
          style={{
            left: Math.min(cx(hover) + 8, Math.max(0, width - 190)),
            top: 24,
          }}
        >
          <div className="text-[var(--text-secondary)]">
            {hovered.month} か月目{hovered.next ? '（見込み）' : ''}
          </div>
          {SEGMENTS.map((s) => {
            const v = s.of(hovered.e);
            return v > 0 ? (
              <TipRow key={s.key} color={s.color} value={fmt(v)}>
                {s.label}
              </TipRow>
            ) : null;
          })}
        </div>
      )}
    </figure>
  );
}
