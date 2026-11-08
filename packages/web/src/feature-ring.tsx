// 機能開発の効き目の輪（progress ring。D-122）。月の報告の手間の棒の下と、行動の欄の来月の見込みの下に出す。
// 内側の輪: その月（月の報告）／来月（行動の欄）の手間の総量の円。機能開発に回る分と、ほかに使った分（行動・出来事への対応・乗り換えなど・維持）を
// 区分で続けて塗り、期待（月の期待）の位置に目盛り。外側の細い輪: 累計 / 期待の進み（100% で一周）。色は段階の色で、普通・良いの境目に目盛り。
// 値は game の関数（featureProgressOf・featureOutlook）と月の報告から引き、式を持たない。
// 内側の区分の色の並びは validate_palette.js で隣どうし（輪なので最後と最初も）を検査した順（2026-11-04・light で全項目 PASS。
// 地の色との対比は WARN なので、凡例に値を書く）。
import { isZeroText, signedText } from './format.ts';
import {
  effortTotalNote,
  featureProgressOf,
  STAGE_LABEL,
  type EffortBreakdown,
  type Scenario,
  type Stage,
} from 'game';

const SEGMENTS: {
  key: string;
  label: string;
  color: string;
  of: (e: EffortBreakdown) => number;
}[] = [
  {
    key: 'feature',
    label: '機能開発',
    color: 'var(--series-3)',
    // 加点は手間の総量の外なので輪に入れない（中央の数に含める）
    of: (e) => e.feature - e.featureBonus,
  },
  {
    key: 'interrupt',
    label: '出来事への対応',
    color: 'var(--series-2)',
    of: (e) => e.interrupt,
  },
  {
    key: 'migration',
    label: '乗り換えなど',
    color: 'var(--series-1)',
    of: (e) => e.migration,
  },
  {
    key: 'actions',
    label: '行動',
    color: 'var(--series-5)',
    of: (e) => e.actions,
  },
  {
    key: 'upkeep',
    label: '維持・管理',
    color: 'var(--series-4)',
    of: (e) => e.upkeep + (e.accounts ?? 0),
  },
];

const STAGE_COLOR: Record<Stage, string> = {
  good: 'var(--status-good)',
  fair: 'var(--status-warning)',
  bad: 'var(--status-critical)',
};

const fmt = (n: number) => String(Number(n.toFixed(1)));
const SIZE = 148;
const C = SIZE / 2;
const INNER = { r: 46, w: 12 };
const OUTER = { r: 64, w: 5 };
const GAP = 2;

/** 輪の上の位置（0〜1。上から時計回り）の点。 */
const at = (frac: number, r: number) => ({
  x: C + r * Math.sin(frac * 2 * Math.PI),
  y: C - r * Math.cos(frac * 2 * Math.PI),
});

/** 輪の一部（from〜to の割合）を、円の破線で描く。 */
function Arc({
  r,
  width,
  from,
  to,
  color,
  gap = 0,
  label,
}: {
  r: number;
  width: number;
  from: number;
  to: number;
  color: string;
  gap?: number;
  label?: string;
}) {
  const len = 2 * Math.PI * r;
  const l = Math.max(0, (to - from) * len - gap);
  if (l <= 0) return null;
  return (
    <circle
      cx={C}
      cy={C}
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={`${l} ${len}`}
      strokeDashoffset={-from * len}
      transform={`rotate(-90 ${C} ${C})`}
    >
      {label && <title>{label}</title>}
    </circle>
  );
}

/** 輪を横切る短い目盛り。 */
function Tick({ frac, r, width }: { frac: number; r: number; width: number }) {
  const a = at(frac, r - width / 2 - 3);
  const b = at(frac, r + width / 2 + 3);
  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke="var(--marker)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  );
}

/**
 * 表示する「機能」の段階。月の報告では実際の段階（メールが届かない分の下げを含む。D-117）を渡し、機能開発の比だけの段階と違えば理由を添える。
 * 来月の見込みは実際の段階を予想できないので、機能開発の比だけで見た段階に note で断りを添える（OCL-7D797D79）。
 */
export function featureStageView(
  ratioStage: Stage,
  actual?: Stage,
  note?: string,
): { stage: Stage; note: string } {
  if (actual && actual !== ratioStage)
    return {
      stage: actual,
      note: `（メールが届かない分で下がりました。機能開発だけなら${STAGE_LABEL[ratioStage]}です）`,
    };
  return { stage: actual ?? ratioStage, note: note ?? '' };
}

export function FeatureRing({
  scenario: sc,
  month,
  total,
  effort,
  feature = effort.feature,
  change,
  next,
  actual,
  note,
}: {
  scenario: Scenario;
  /** 累計と期待を見る月。 */
  month: number;
  /** その月の終わりの累計。 */
  total: number;
  /** その月の手間の配分。 */
  effort: EffortBreakdown;
  /** その月に増える機能開発（省略は effort.feature。受けた提案の今すぐの加点を含めるときに渡す）。 */
  feature?: number;
  /** 選んだ行動で機能開発が変わる量（行動の欄だけ）。 */
  change?: number;
  /** 実際の「機能」の段階（月の報告）。 */
  actual?: Stage;
  /** 段階に添える断り（来月の見込み）。 */
  note?: string;
  /** 来月の見込み（行動の欄）。 */
  next?: boolean;
}) {
  const p = featureProgressOf(sc, total, month);
  const shown = featureStageView(p.stage, actual, note);
  const perMonth = featureProgressOf(sc, 0, 1).expected;
  const ratio = p.expected > 0 ? p.total / p.expected : 1;
  const parts = SEGMENTS.map((s) => ({ s, v: Math.max(0, s.of(effort)) }));
  const T = Math.max(effort.total, 1);
  let acc = 0;
  const arcs = parts.map((x) => {
    const from = acc / T;
    acc += x.v;
    return { ...x, from, to: acc / T };
  });
  const head = `${next ? '来月' : `${month} か月目`}の機能開発 ${fmt(feature)} / 期待 ${perMonth}`;
  const progressText = `累計 ${fmt(p.total)} / 期待 ${fmt(p.expected)}（${Math.round(ratio * 100)}%）`;
  return (
    <div
      className="viz-root flex flex-wrap items-center gap-x-4 gap-y-2"
      data-feature-ring
    >
      <svg
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`${head}・${progressText}・「機能」は${STAGE_LABEL[shown.stage]}${shown.note}`}
        className="shrink-0"
      >
        {/* 外側: 累計 / 期待（下地 + 段階の色の進み。100% を超えた分は中の文字で） */}
        <circle
          cx={C}
          cy={C}
          r={OUTER.r}
          fill="none"
          stroke="var(--grid)"
          strokeWidth={OUTER.w}
        />
        <Arc
          r={OUTER.r}
          width={OUTER.w}
          from={0}
          to={Math.min(ratio, 1)}
          color={STAGE_COLOR[shown.stage]}
          label={progressText}
        />
        <Tick
          frac={p.fairAt / Math.max(p.expected, 1)}
          r={OUTER.r}
          width={OUTER.w}
        />
        <Tick
          frac={p.goodAt / Math.max(p.expected, 1)}
          r={OUTER.r}
          width={OUTER.w}
        />
        {/* 内側: 月の手間の総量の内訳 */}
        <circle
          cx={C}
          cy={C}
          r={INNER.r}
          fill="none"
          stroke="var(--grid)"
          strokeWidth={INNER.w}
        />
        {arcs.map((a) => (
          <Arc
            key={a.s.key}
            r={INNER.r}
            width={INNER.w}
            from={a.from}
            to={a.to}
            color={a.s.color}
            gap={GAP}
            label={`${a.s.label} ${fmt(a.v)}`}
          />
        ))}
        <Tick frac={Math.min(perMonth / T, 1)} r={INNER.r} width={INNER.w} />
        <text
          x={C}
          y={C - 2}
          textAnchor="middle"
          className="fill-[var(--text-primary)] text-[20px] font-bold tabular-nums"
        >
          {fmt(feature)} / {perMonth}
        </text>
        <text
          x={C}
          y={C + 14}
          textAnchor="middle"
          className="fill-[var(--text-secondary)] text-[10px]"
        >
          {change !== undefined && !isZeroText(fmt(Math.abs(change)))
            ? `行動で ${signedText(change, fmt)}`
            : '機能開発 / 期待'}
        </text>
      </svg>
      <div className="min-w-0 space-y-1 text-xs text-[var(--text-secondary)]">
        <div className="font-semibold text-[var(--text-primary)]">{head}</div>
        <div>
          内側の輪: 手間 {fmt(effort.total)}
          {effortTotalNote(effort.total, effort.accountAllowance)}{' '}
          の使い道（目盛りは期待 {perMonth}）
        </div>
        <ul className="space-y-0.5">
          {/* 値が 0 の区分は省く（機能開発と、行動の欄の「行動」は選ぶと動くので常に出す） */}
          {parts
            .filter(
              (x) =>
                x.v > 0 ||
                x.s.key === 'feature' ||
                (next === true && x.s.key === 'actions'),
            )
            .map((x) => (
              <li key={x.s.key} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: x.s.color }}
                />
                {x.s.label}
                <span className="ml-auto pl-2 text-[var(--text-primary)] tabular-nums">
                  {fmt(x.v)}
                </span>
              </li>
            ))}
          {feature - parts[0]!.v > 0 && (
            <li>（ほかに提案の加点 +{fmt(feature - parts[0]!.v)}）</li>
          )}
        </ul>
        <div className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: STAGE_COLOR[shown.stage] }}
          />
          外側の輪: {progressText} →「機能」は{STAGE_LABEL[shown.stage]}
          {shown.note}
        </div>
        <div>
          目盛り: 普通 {fmt(p.fairAt)}・良い {fmt(p.goodAt)}
        </div>
      </div>
    </div>
  );
}
