// 解析の設定（区切り方・1 局面に残す候補の数。D-236・prd/17 §5.2・§5.3）のチップ。① の解析の置き場の行（と図の箱の吹き出し）に添える。
// 見積モードと、ゲームの途中の「構成を変える」で共用（値と整合は各画面が持つ）。解析のあるシナリオだけで出す。
import {
  candidatesLockReason,
  CLIENT_CANDIDATES,
  settingFlavor,
  SETTINGS,
  type SettingKey,
} from 'game';
import { SettingChips } from './setup-components.tsx';

export type AnalysisSettingValues = Record<
  'analysisUnit' | 'candidates',
  number
>;

export function AnalysisSettingChips({
  value,
  onChange,
  analysis,
}: {
  value: AnalysisSettingValues;
  onChange: (next: AnalysisSettingValues) => void;
  /** 選んでいる解析の置き場（利用者の端末なら候補の数を 1 つに固定する）。 */
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
      {chips('analysisUnit')}
      {chips('candidates')}
    </div>
  );
}
