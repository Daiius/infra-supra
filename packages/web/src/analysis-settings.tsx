// 解析の設定（区切り方・1 局面に残す候補の数・詳細解析の範囲。D-236・D-246・prd/17 §5.2・§5.3・§5.6）のチップ。③ 解析の置き場のタブ
// （D-245）の実行先の下に添える。見積モードと、ゲームの途中の「構成を変える」で共用（値と整合は各画面が持つ）。解析のあるシナリオだけで出す。
// 詳細解析の範囲は、置き方が併用（端末で簡易解析・サーバーで詳細解析）のときだけ出す。台数（D-251）は実行先が台で借りるマシンのときだけ出す。
import {
  analysisMachinesLockReason,
  analysisScopeLockReason,
  candidatesLockReason,
  CLIENT_CANDIDATES,
  settingFlavor,
  SETTINGS,
  type SettingKey,
} from 'game';
import { SettingChips } from './setup-components.tsx';

export type AnalysisSettingValues = Record<
  'analysisUnit' | 'candidates' | 'analysisScope' | 'analysisMachines',
  number
>;

export function AnalysisSettingChips({
  value,
  onChange,
  analysis,
}: {
  value: AnalysisSettingValues;
  onChange: (next: AnalysisSettingValues) => void;
  /** 選んでいる解析の置き場（利用者の端末なら候補の数を 1 つに固定する・併用なら詳細解析の範囲を出す）。 */
  analysis: string | undefined;
}) {
  const lock = candidatesLockReason(analysis);
  const chips = (key: SettingKey & keyof AnalysisSettingValues) => {
    const def = SETTINGS[key];
    const locked = key === 'candidates' ? lock : undefined;
    return (
      <SettingChips
        key={key}
        setting={key}
        label={def.label}
        note={def.note}
        options={def.options.map((o) => ({
          value: o.value,
          label: o.label,
          flavor: settingFlavor(key, o.value),
          ...(locked ? { why: locked } : {}),
        }))}
        value={locked ? CLIENT_CANDIDATES : value[key]}
        onChange={(v) => onChange({ ...value, [key]: v })}
      >
        {locked && (
          <p className="text-xs opacity-70" data-setting-lock={key}>
            今は選べません: {locked}
          </p>
        )}
      </SettingChips>
    );
  };
  return (
    <div className="space-y-1.5" data-analysis-settings>
      {/* 台数は台で借りるマシンのときだけ（D-251） */}
      {analysisMachinesLockReason(analysis) === undefined &&
        chips('analysisMachines')}
      {analysisScopeLockReason(analysis) === undefined &&
        chips('analysisScope')}
      {chips('analysisUnit')}
      {chips('candidates')}
    </div>
  );
}
