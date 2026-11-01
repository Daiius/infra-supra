// 始める画面の部品の選択（D-45）。構成とフレームワークの組み合わせで選べるスロットを game の setupSlots から引き、
// スロットごとにラジオで選ぶ（既定は未選択）。選択肢には短い説明（フレーバー）を添え、事実の説明（note）は ⓘ に置く。
// 「不適切」の印は出さない（説明だけで正解が分からないようにする）。
import {
  componentConflict,
  componentFlavor,
  invalidationNote,
  ON_DEMAND_REVALIDATE,
  SETTINGS,
  setupInvalidationEstimate,
  setupRevalidateOptions,
  setupSlots,
  STACKS,
  type FrameworkId,
  type Scenario,
} from 'game';
import { useMemo } from 'react';
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
  const slots = setupSlots(scenario, stackIndex, framework, value);
  if (slots.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="mt-2 font-bold">部品</h3>
      <p className="text-sm opacity-70">
        構成の中の役割ごとに選ぶ（始める前なので手間はかからない）
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((x) => {
          // 1 択のスロット（固定）は選択済み・変更不可で出す（未選択の判定に含めない。D-45）
          const picked = x.fixed ? x.options[0]!.id : value[x.slot];
          return (
            <fieldset
              key={x.slot}
              className={`min-w-0 rounded-box border p-3 ${picked ? 'border-base-300' : 'border-warning'}`}
            >
              <legend className="px-1 font-semibold">
                {x.label}
                {x.fixed ? (
                  <span className="ml-1 text-xs font-normal opacity-70">
                    （この構成では 1 択）
                  </span>
                ) : (
                  !picked && (
                    <span className="ml-1 text-xs font-normal">（未選択）</span>
                  )
                )}
              </legend>
              <div className="space-y-2">
                {x.options.map((o) => {
                  // 部品どうしの依存で今は選べない（VPS の API のキャッシュは前段の CDN が要る。D-37）
                  const why =
                    x.fixed || x.slot === 'files'
                      ? null
                      : // 部品の事業者でなく構成の事業者で見る（他の事業者の部品も、構成の規則で判定する。D-52）
                        componentConflict(
                          STACKS[stackIndex]!.provider,
                          x.slot,
                          o.id,
                          value,
                          framework,
                        );
                  return (
                    <label
                      key={o.id}
                      className={`flex items-start gap-2 ${x.fixed || why ? '' : 'cursor-pointer'}`}
                    >
                      <input
                        type="radio"
                        name={`setup-${x.slot}`}
                        className="radio radio-primary radio-sm mt-0.5 shrink-0"
                        checked={picked === o.id}
                        disabled={x.fixed || why !== null}
                        onChange={() => onChange({ ...value, [x.slot]: o.id })}
                      />
                      <span className="block min-w-0">
                        <span className="block text-sm">
                          <NameWithInfo
                            name={o.label}
                            info={
                              <Info label={`${o.label} の説明`}>{o.note}</Info>
                            }
                          />
                        </span>
                        <span className="block text-xs opacity-70">
                          {componentFlavor(o)}
                        </span>
                        {why && <span className="block text-xs">{why}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 始める画面の ISR の再検証（D-49）。ISR のある構成（Next.js）だけ。始める前なので手間はかからない
 * （ゲーム中に時間からオンデマンドへ切り替えるときだけ実装の手間がかかる）。既定は 5 分を選んだ状態。
 */
export function SetupRevalidate({
  scenario,
  stackIndex,
  framework,
  components,
  value,
  onChange,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  /** 選んだ部品（オンデマンドの CloudFront の無効化の見込みに使う。D-66）。 */
  components: SetupChoices;
  value: number;
  onChange: (v: number) => void;
}) {
  const options = setupRevalidateOptions(scenario, framework);
  // OpenNext で ISR を CloudFront にキャッシュするとき、オンデマンドの無効化の見込み（1 か月目の規模。D-66）
  const invalidation = useMemo(() => {
    if (options.length === 0) return undefined;
    const chosen = Object.fromEntries(
      Object.entries(components).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    );
    const e = setupInvalidationEstimate(
      scenario,
      stackIndex,
      framework,
      chosen,
    );
    return e && invalidationNote(e);
  }, [scenario, stackIndex, framework, components, options.length]);
  if (options.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="mt-2 font-bold">設定</h3>
      <fieldset className="min-w-0 rounded-box border border-base-300 p-3">
        <legend className="px-1 font-semibold">
          <NameWithInfo
            name={SETTINGS.isr.label}
            info={
              <Info label={`${SETTINGS.isr.label} の説明`}>
                {SETTINGS.isr.note}
              </Info>
            }
          />
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-start gap-2"
            >
              <input
                type="radio"
                name="setup-revalidate"
                className="radio radio-primary radio-sm mt-0.5 shrink-0"
                checked={value === o.value}
                onChange={() => onChange(o.value)}
              />
              <span className="block min-w-0">
                <span className="block text-sm">{o.label}</span>
                <span className="block text-xs opacity-70">{o.flavor}</span>
                {o.value === ON_DEMAND_REVALIDATE && invalidation && (
                  <span className="block text-xs text-warning">
                    {invalidation}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
