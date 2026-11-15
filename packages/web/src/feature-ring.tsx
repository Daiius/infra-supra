// 機能開発の効き目の輪（progress ring。D-122）。行動の欄の来月の見込みの下に出す（月の報告の輪と工数の欄は D-222 の補足で外した）。
// 内側の輪: その月（月の報告）／来月（行動の欄）の工数の総量の円。機能開発に回る分と、ほかに使った分（行動・出来事への対応・乗り換えなど・維持）を
// 区分で続けて塗り、期待（月の期待）の位置に目盛り。外側の細い輪: 累計の進み（一周はその月の工数をすべて機能開発に回したときの累計）。
// 色は段階の色で、普通・良い（期待）の境目に目盛り。
// 値は game の関数（featureProgressOf・featureOutlook）と月の報告から引き、式を持たない。
// 内側の区分の色の並びは validate_palette.js で隣どうし（輪なので最後と最初も）を検査した順（2026-11-04・light で全項目 PASS。
// 地の色との対比は WARN なので、凡例に値を書く）。
import { Info } from './info.tsx';
import { fmtPoints } from './format.ts';
import {
  effortTotalNote,
  featureProgressOf,
  featureRuleText,
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
    // 加点は工数の総量の外なので輪に入れない（中央の数に含める）
    of: (e) => e.feature - e.featureBonus,
  },
  {
    key: 'interrupt',
    label: 'イベントへの対応',
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
    label: 'アクション',
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

/** 工数の区分と値（輪の色と同じ並び・同じ色）。 */
const effortParts = (e: EffortBreakdown) =>
  SEGMENTS.map((s) => ({ s, v: Math.max(0, s.of(e)) }));

/** 工数の使い道の一覧（色の見本つき）。keep の区分は 0 でも出す。 */
function EffortParts({
  effort,
  keep = ['feature'],
}: {
  effort: EffortBreakdown;
  keep?: readonly string[];
}) {
  return (
    <ul className="space-y-0.5">
      {effortParts(effort)
        .filter((x) => x.v > 0 || keep.includes(x.s.key))
        .map((x) => (
          <li key={x.s.key} className="flex items-center gap-1.5">
            <RingSwatch color={x.s.color} ring="inner" />
            {x.s.label}
            <span className="ml-auto pl-2 text-[var(--text-primary)] tabular-nums">
              {fmtPoints(x.v)}
            </span>
          </li>
        ))}
    </ul>
  );
}

/**
 * 凡例の色の見本: 小さな二重の輪で、内側の輪の区分か外側の輪（累計）かを形で分ける（色が近くても見分けられる）。
 */
function RingSwatch({
  color,
  ring,
}: {
  color: string;
  ring: 'inner' | 'outer';
}) {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 20 20"
      className="shrink-0"
      data-ring-swatch={ring}
    >
      <circle
        cx="10"
        cy="10"
        r="8.5"
        fill="none"
        stroke={ring === 'outer' ? color : 'var(--grid)'}
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r="4.2"
        fill="none"
        stroke={ring === 'inner' ? color : 'var(--grid)'}
        strokeWidth="3.6"
      />
    </svg>
  );
}

const STAGE_COLOR: Record<Stage, string> = {
  good: 'var(--status-good)',
  fair: 'var(--status-warning)',
  bad: 'var(--status-critical)',
};

const SIZE = 148;
const C = SIZE / 2;
/** 輪の下に置く「累計」の札の高さ。 */
const FOOT = 16;
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
  next,
  actual,
  note,
}: {
  scenario: Scenario;
  /** 累計と期待を見る月。 */
  month: number;
  /** その月の終わりの累計。 */
  total: number;
  /** その月の工数の配分。 */
  effort: EffortBreakdown;
  /** その月に増える機能開発（省略は effort.feature。受けた提案の今すぐの加点を含めるときに渡す）。 */
  feature?: number;
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
  const parts = effortParts(effort);
  const T = Math.max(effort.total, 1);
  // 外側の一周 = その月の工数をすべて機能開発に回したときの累計（行動・対応・維持に回すほど進みが減って見える。
  // 期待（良いの境目）と普通の境目は、この一周の上の位置に目盛りで出す。一周を超える目盛りは届かないので描かない）
  const most = p.total + Math.max(0, effort.total - parts[0]!.v);
  const of = (v: number) => (most > 0 ? v / most : 0);
  let acc = 0;
  const arcs = parts.map((x) => {
    const from = acc / T;
    acc += x.v;
    return { ...x, from, to: acc / T };
  });
  const head = `${next ? '来月' : `${month} か月目`}の機能開発 ${fmtPoints(feature)} / 期待 ${perMonth}`;
  const progressText = `累計 ${fmtPoints(p.total)} / 期待 ${fmtPoints(p.expected)}（${Math.round(ratio * 100)}%）`;
  return (
    <div
      className="viz-root flex flex-wrap items-center gap-x-4 gap-y-2"
      data-feature-ring
    >
      <svg
        width={SIZE}
        height={SIZE + FOOT}
        role="img"
        aria-label={`${head}・${progressText}・「機能」は${STAGE_LABEL[shown.stage]}${shown.note}`}
        className="shrink-0"
      >
        {/* 外側: 累計（下地 + 段階の色の進み。一周は工数をすべて機能開発に回したときの累計） */}
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
          to={Math.min(of(p.total), 1)}
          color={STAGE_COLOR[shown.stage]}
          label={progressText}
        />
        {[p.fairAt, p.goodAt]
          .filter((v) => of(v) <= 1)
          .map((v) => (
            <Tick key={v} frac={of(v)} r={OUTER.r} width={OUTER.w} />
          ))}
        {/* 内側: 月の工数の総量の内訳 */}
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
            label={`${a.s.label} ${fmtPoints(a.v)}`}
          />
        ))}
        <Tick frac={Math.min(perMonth / T, 1)} r={INNER.r} width={INNER.w} />
        <text
          x={C}
          y={C - 2}
          textAnchor="middle"
          className="fill-[var(--text-primary)] text-[20px] font-bold tabular-nums"
        >
          {fmtPoints(feature)} / {perMonth}
        </text>
        <text
          x={C}
          y={C + 14}
          textAnchor="middle"
          className="fill-[var(--text-secondary)] text-[10px]"
        >
          機能開発 / 期待
        </text>
        {/* 外側の輪が機能開発の累計だと分かるよう、輪の下に累計を置く */}
        {/* 名前は中央の「機能開発 / 期待」と同じ字、数は太字 */}
        <text
          x={C}
          y={SIZE + FOOT / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          data-ring-total-label
        >
          <tspan className="fill-[var(--text-secondary)] text-[10px]">
            累計{' '}
          </tspan>
          <tspan className="fill-[var(--text-primary)] text-[11px] font-semibold tabular-nums">
            {fmtPoints(p.total)}
          </tspan>
        </text>
      </svg>
      <div className="min-w-0 max-w-64 flex-1 basis-28 space-y-1 text-xs text-[var(--text-secondary)]">
        {/* 値が 0 の区分は省く（輪に無いものは出さない。機能開発だけは 0 でも出す） */}
        <EffortParts effort={effort} />
        {feature - parts[0]!.v > 0 && (
          <p>（ほかに開発依頼の加点 +{fmtPoints(feature - parts[0]!.v)}）</p>
        )}
        <div className="flex items-center gap-1.5">
          <RingSwatch color={STAGE_COLOR[shown.stage]} ring="outer" />
          {/* 段階は色だけに頼らず文字でも添える */}
          <span>
            累計 {fmtPoints(p.total)} / 期待 {fmtPoints(p.expected)}
            <span data-feature-stage>（{STAGE_LABEL[shown.stage]}）</span>
          </span>
          {/* 来月の機能開発 / 期待は輪の中央で読めるので見出しは出さない。輪の読み方（内側・外側・目盛り）は ⓘ に畳む（prd/16） */}
          <Info label="輪のグラフの見方" title="輪のグラフの見方">
            <p>
              内側の輪: 工数 {fmtPoints(effort.total)}
              {effortTotalNote(effort.total, effort.accountAllowance)}{' '}
              の使い道（目盛りは期待 {perMonth}）。
            </p>
            <p>
              外側の輪: {progressText} →「機能」は{STAGE_LABEL[shown.stage]}
              {shown.note}。一周は、工数をすべて機能開発に回したときの累計{' '}
              {fmtPoints(most)}{' '}
              です。アクションなどに工数を使うと、その分だけ短くなります。
            </p>
            <p>
              外側の目盛り: 普通 {fmtPoints(p.fairAt)}・良い（期待）{' '}
              {fmtPoints(p.goodAt)}
              {of(p.goodAt) > 1
                ? '（この月の工数では届かないので描きません）'
                : ''}
              。
            </p>
            <p>{featureRuleText(sc)}</p>
          </Info>
        </div>
      </div>
    </div>
  );
}
