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
import { createContext, useContext } from 'react';
import { SettingChips } from './setup-components.tsx';

/**
 * ③ のタブ（own-slot-field.tsx）が、画面から渡された設定の欄を段ごとに出し分けるための部分の指定。all: 全部（既定）・
 * machines: 台数だけ・rest: 台数以外・summary: 台数以外の今の値の要約の文字（D-254）。
 * 画面ごとの呼び出し（値と整合は各画面が持つ）を変えずに、同じ要素を段の中で何度か描く。
 */
export type AnalysisSettingsPart = 'all' | 'machines' | 'rest' | 'summary';
export const AnalysisSettingsPartContext =
  createContext<AnalysisSettingsPart>('all');

const labelOf = (key: SettingKey, v: number) =>
  SETTINGS[key].options.find((o) => o.value === v)?.label ?? String(v);

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
  const part = useContext(AnalysisSettingsPartContext);
  const lock = candidatesLockReason(analysis);
  const showMachines = analysisMachinesLockReason(analysis) === undefined;
  const showScope = analysisScopeLockReason(analysis) === undefined;
  if (part === 'summary')
    return (
      <>
        {[
          ...(showScope ? [labelOf('analysisScope', value.analysisScope)] : []),
          labelOf('analysisUnit', value.analysisUnit),
          `候補 ${labelOf('candidates', lock ? CLIENT_CANDIDATES : value.candidates)}`,
        ].join('・')}
      </>
    );
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
      {part !== 'rest' && showMachines && chips('analysisMachines')}
      {part !== 'machines' && (
        <>
          {showScope && chips('analysisScope')}
          {chips('analysisUnit')}
          {chips('candidates')}
        </>
      )}
    </div>
  );
}
