import {
  effortTotalNote,
  featureProgressOf,
  featureRuleText,
  STAGE_LABEL,
  type MonthReport,
  type Scenario,
  type Stage,
} from 'game';
import { Info } from '../info.tsx';
import { FeatureRing, featureStageView } from '../feature-ring.tsx';
import { fmtPoints } from '../format.ts';
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

export function EffortBreakdownView({
  report: r,
  scenario: sc,
}: {
  report: MonthReport;
  scenario: Scenario;
}) {
  const e = r.effort;
  // 手間の使い道は下の輪のグラフ（色の凡例つき）で見せ、横棒と全区分の表は出さない（0 の区分が多く、輪と重なる）。
  // 総量の内訳と SSR の CPU の注記は見出しの ⓘ に畳む（prd/16）
  return (
    <div>
      <h3 className="mb-1 flex flex-wrap items-center gap-x-1 font-bold">
        開発の手間 {fmtPoints(e.total)} ポイント
        <span className="text-sm font-normal opacity-70">
          機能開発 {Math.round(e.feature)}・累計 {Math.round(r.featurePoints)}
        </span>
        <Info label="開発の手間の説明" title="開発の手間">
          <p>
            毎月使える手間 {fmtPoints(e.total)} ポイント
            {e.accountAllowance
              ? effortTotalNote(e.total, e.accountAllowance)
              : ''}
            のうち、運用やアクションに使わなかった分が機能開発に回ります。使い道の内訳は下の輪のグラフです。
          </p>
          {e.featureBonus > 0 && (
            <p>機能開発のうち開発依頼の加点 +{fmtPoints(e.featureBonus)}。</p>
          )}
          <p>
            サーバーで描く CPU 時間（SSR）は {r.ssrCpuMs} ms
            です（機能開発で重くなります）。
          </p>
        </Info>
      </h3>
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
      <div className="mt-2 text-sm">
        <FeatureProgressLine
          scenario={sc}
          total={r.featurePoints}
          month={r.month}
          actual={r.satisfaction.stages.feature}
        />
      </div>
      <div className="mt-2">
        <FeatureRing
          scenario={sc}
          month={r.month}
          total={r.featurePoints}
          effort={r.effort}
          actual={r.satisfaction.stages.feature}
        />
      </div>
    </div>
  );
}
