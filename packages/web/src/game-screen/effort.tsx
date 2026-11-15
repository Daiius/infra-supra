import {
  featureProgressOf,
  featureRuleText,
  STAGE_LABEL,
  type MonthReport,
  type Scenario,
  type Stage,
} from 'game';
import { Info } from '../info.tsx';
import { featureStageView } from '../feature-ring.tsx';
import { STAGE_CLS } from './shared.ts';

/**
 * 機能開発の累計と期待、「機能」の段階（D-122）。良いのときも出す。余った手間が何に効くかは ⓘ に畳む（狭い画面で溢れない）。
 */
export function FeatureProgressLine({
  scenario: sc,
  total,
  month,
  prefix = '',
  actual,
  note,
}: {
  scenario: Scenario;
  total: number;
  month: number;
  /** 「来月の」など。 */
  prefix?: string;
  /** 実際の「機能」の段階（月の報告。メールが届かない分の下げを含む）。 */
  actual?: Stage;
  /** 段階に添える断り（来月の見込み）。 */
  note?: string;
}) {
  const p = featureProgressOf(sc, total, month);
  const shown = featureStageView(p.stage, actual, note);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>
        {prefix}機能開発の累計 {Math.round(p.total)} / 期待 {p.expected} →
        「機能」は
      </span>
      <span className={`badge badge-sm ${STAGE_CLS[shown.stage]}`}>
        {STAGE_LABEL[shown.stage]}
      </span>
      {shown.note && <span className="text-xs opacity-70">{shown.note}</span>}
      <Info label="余った手間の効き目">{featureRuleText(sc)}</Info>
    </span>
  );
}

/**
 * 月の報告の、進行中の作業（部品の差し替え・乗り換え・作り直し）の進み。どれも無ければ出さない。
 * 手間の総量・使い道・累計の行は外した（評価は累計で、満足度の「機能」の札と行動の欄の来月の見込みに任せる。D-222 の補足）。
 */
export function WorkProgressView({ report: r }: { report: MonthReport }) {
  if (!r.componentSwap && !r.migration && !r.rewrite) return null;
  return (
    <div>
      {r.componentSwap && (
        <div className="mt-2 text-sm">
          {r.componentSwap.label}差し替え中（データの移行）:{' '}
          {r.componentSwap.done} / {r.componentSwap.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.componentSwap.done}
            max={r.componentSwap.required}
          />
        </div>
      )}
      {r.migration && (
        <div className="mt-2 text-sm">
          {r.migration.toName} へ乗り換え中: {r.migration.done} /{' '}
          {r.migration.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.migration.done}
            max={r.migration.required}
          />
        </div>
      )}
      {r.rewrite && (
        <div className="mt-2 text-sm">
          {r.rewrite.toLabel} へ作り直し中（今月は旧アプリのまま）:{' '}
          {r.rewrite.done} / {r.rewrite.required}
          <progress
            className="progress progress-secondary ml-2 w-24"
            value={r.rewrite.done}
            max={r.rewrite.required}
          />
        </div>
      )}
    </div>
  );
}
