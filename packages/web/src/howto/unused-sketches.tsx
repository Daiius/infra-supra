// 遊び方の 1 ページ目のために作ったが、情報が多いので今は出していない図（D-214。別の場所に出すかもしれないので残す）。
import { ArrowUp } from 'lucide-react';
import clsx from 'clsx';
import { type ReactNode } from 'react';

/**
 * 構成の型（1 ページ目の模式図と表）。数値は持たない（形だけ。料金の数値は画面の明細と ⓘ が出す）。
 * 性質はゲームの計算に合わせる: 無料プランは止まる上限と規約の制限、従量のプランは込みの量を超えた分を請求、
 * VPS は定額で、維持の手間・自前の障害があり、上位プランへの変更は停止と手間（D-27）。
 */
export const KINDS = [
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
