// 始める画面の部品の選択（D-45）。構成とフレームワークの組み合わせで選べるスロットを game の setupSlots から引き、
// スロットごとにラジオで選ぶ（既定は未選択）。選択肢には短い説明（フレーバー）を添え、事実の説明（note）は ⓘ に置く。
// 「不適切」の印は出さない（説明だけで正解が分からないようにする）。
import {
  componentFlavor,
  setupSlots,
  type FrameworkId,
  type Scenario,
} from 'game';
import { Info } from './info.tsx';
import { NameWithInfo } from './option-text.tsx';

export type SetupChoices = Partial<Record<string, string>>;

export function SetupComponents({
  scenario,
  stackIndex,
  framework,
  value,
  onChange,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  /** 選んだ部品（選べなくなったものは呼び出し側で外してある）。 */
  value: SetupChoices;
  onChange: (v: SetupChoices) => void;
}) {
  const slots = setupSlots(scenario, stackIndex, framework);
  if (slots.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="mt-2 font-bold">部品</h3>
      <p className="text-sm opacity-70">
        構成の中の役割ごとに選ぶ（始める前なので手間はかからない）
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((x) => (
          <fieldset
            key={x.slot}
            className={`min-w-0 rounded-box border p-3 ${value[x.slot] ? 'border-base-300' : 'border-warning'}`}
          >
            <legend className="px-1 font-semibold">
              {x.label}
              {!value[x.slot] && (
                <span className="ml-1 text-xs font-normal">（未選択）</span>
              )}
            </legend>
            <div className="space-y-2">
              {x.options.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-start gap-2"
                >
                  <input
                    type="radio"
                    name={`setup-${x.slot}`}
                    className="radio radio-primary radio-sm mt-0.5 shrink-0"
                    checked={value[x.slot] === o.id}
                    onChange={() => onChange({ ...value, [x.slot]: o.id })}
                  />
                  <span className="block min-w-0">
                    <span className="block text-sm">
                      <NameWithInfo
                        name={o.label}
                        info={<Info label={`${o.label} の説明`}>{o.note}</Info>}
                      />
                    </span>
                    <span className="block text-xs opacity-70">
                      {componentFlavor(o)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
