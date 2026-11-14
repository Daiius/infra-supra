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
import { fmtPoints, STAGE_CLS } from './shared.ts';

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
  const parts = [
    { label: '自前運用の維持', value: e.upkeep, cls: 'bg-warning' },
    // 主のアカウント以外の事業者のアカウントの維持（D-52・D-123）。無ければ出さない
    ...(e.accounts
      ? [{ label: '他の事業者の管理', value: e.accounts, cls: 'bg-warning/50' }]
      : []),
    { label: 'イベントへの対応', value: e.interrupt, cls: 'bg-error' },
    {
      label: '乗り換え・作り直し・DB や API の移し替え',
      value: e.migration,
      cls: 'bg-secondary',
    },
    {
      label: 'アクション（設定・最適化・部品）',
      value: e.actions,
      cls: 'bg-info',
    },
    // 機能追加の提案への対応は機能開発に数える（D-29）。棒は手間の総量の内訳なので、加点は棒に入れず下に添える
    {
      label: '機能の追加（開発依頼）',
      value: e.featureWork,
      cls: 'bg-accent',
    },
    {
      label: '機能開発（残り）',
      value: e.feature - e.featureWork - e.featureBonus,
      cls: 'bg-success',
    },
  ];
  return (
    <div>
      <h3 className="mb-1 font-bold">
        開発の手間 {fmtPoints(e.total)} ポイント
        {/* 既定の構成の事業者の管理の分を足した月は内訳を添える（D-123） */}
        {e.accountAllowance ? (
          <span className="ml-1 text-sm font-normal opacity-70">
            {effortTotalNote(e.total, e.accountAllowance)}
          </span>
        ) : null}
        <span className="ml-2 text-sm font-normal opacity-70">
          機能開発 {Math.round(e.feature)}
          {e.featureBonus > 0 &&
            `（うち開発依頼の加点 +${Number(e.featureBonus.toFixed(1))}）`}
          ・累計 {Math.round(r.featurePoints)}
        </span>
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-base-200">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              className={`${p.cls} motion-width`}
              style={{ width: `${(p.value / e.total) * 100}%` }}
              title={`${p.label} ${p.value}`}
            />
          ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${p.cls}`} />
            {p.label}
            <span className="ml-auto tabular-nums">{fmtPoints(p.value)}</span>
          </li>
        ))}
      </ul>
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
      <div className="mt-1 text-xs opacity-70">
        サーバーで描く CPU 時間（SSR） {r.ssrCpuMs} ms（機能開発で重くなる）
      </div>
    </div>
  );
}
