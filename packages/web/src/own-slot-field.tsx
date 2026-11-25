// 構成・フレームワークと並ぶ別のタブで選ぶスロット（D-245・prd/17 §5.6。Scenario.ownTabSlots）。① 構成のカードからは外し、
// ゲームの始める画面・途中の「構成を変える」・見積モードの SetupTabs に ③ のタブとして出す。
// 解析の置き場は、置き方（サーバー・端末・併用）と実行先（同じ実行環境・別の事業者のサーバーレス・worker の VPS）の 2 段で選ぶ。
// 実行先は Web の事業者から独立して選べる（結果はアプリの API に送る）。今の構成で選べないものは出さない（選択肢に無いもの）、
// 部品どうしの依存で選べないものは灰色で理由を添える（チップと同じ判定）。それ以外のスロットは機能のチップ（PartChips）で選ぶ。
import clsx from 'clsx';
import {
  ANALYSIS_TARGETS,
  analysisPlacementId,
  analysisPlacementOf,
  analysisTargetName,
  type AnalysisMode,
  type AnalysisTarget,
} from 'catalog';
import {
  componentFlavor,
  setupSlots,
  STACKS,
  type FrameworkId,
  type Scenario,
  type SetupSlot,
} from 'game';
import type { ReactNode } from 'react';
import { BrandMark, COMPONENT_BRAND } from './brand-logos.tsx';
import {
  PartChips,
  slotView,
  usePartSlots,
  type OwnSetupTab,
  type PartsCompare,
  type SetupChoices,
} from './setup-components.tsx';
import { SlotCompareInfo } from './slot-compare.tsx';

/** 置き方の選択肢（解析の置き場）。 */
const MODES: readonly { mode: AnalysisMode; label: string; note: string }[] = [
  {
    mode: 'server',
    label: 'サーバーで解析',
    note: '解析をサーバーで動かします。実行先を下から選びます',
  },
  {
    mode: 'client',
    label: '利用者の端末で解析',
    note: 'ブラウザで解析し、サーバーの解析の費用はかかりません',
  },
  {
    mode: 'hybrid',
    label: '端末で速報・サーバーで本解析',
    note: '端末ですぐ速報を出し、本解析の実行先を下から選びます',
  },
];

type Props = {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: SetupChoices;
  onChange: (v: SetupChoices) => void;
  /** 部品の ⓘ の比較（D-124）。 */
  compare?: PartsCompare | undefined;
  /** 注記（画面ごと）。 */
  note?: ReactNode;
  /** スロットに添えるもの（解析の区切り方・候補の数。D-236。構成のカードの partsExtra と同じもの）。 */
  slotExtra?: Partial<Record<string, ReactNode>> | undefined;
};

/** シナリオが別のタブに出すスロット（今の構成で選べるもの）。 */
const ownSlots = (slots: readonly SetupSlot[], scenario: Scenario) =>
  slots.filter((x) => (scenario.ownTabSlots ?? []).includes(x.slot as never));

/**
 * SetupTabs に渡す別のタブ（D-245）。見出しはスロットの名前、要約は今の選択の名前。構成で選べないスロットのタブは出さない。
 */
export function ownSlotTabs(props: Props): OwnSetupTab[] {
  const { scenario, stackIndex, framework, components } = props;
  if (!scenario.ownTabSlots?.length) return [];
  return ownSlots(
    setupSlots(scenario, stackIndex, framework, components),
    scenario,
  ).map((x) => {
    const picked = x.fixed ? x.options[0]?.id : components[x.slot];
    return {
      slot: x.slot,
      label: x.label,
      summary: x.options.find((o) => o.id === picked)?.label ?? '未選択',
      warn: picked ? undefined : `${x.label}がまだ選ばれていません`,
      panel: <OwnSlotField {...props} slot={x.slot} />,
    };
  });
}

/** 別のタブの中身（解析の置き場は 2 段、それ以外は機能のチップ）。 */
function OwnSlotField(props: Props & { slot: string }) {
  const slots = usePartSlots(
    props.scenario,
    props.stackIndex,
    props.framework,
    props.components,
  );
  const x = slots.find((s) => s.slot === props.slot);
  if (!x) return null;
  if (x.slot === 'analysis') return <AnalysisField {...props} slot={x} />;
  return (
    <PartChips
      stackIndex={props.stackIndex}
      framework={props.framework}
      slots={[x]}
      value={props.components}
      onChange={props.onChange}
      note={props.note}
      slotExtra={props.slotExtra}
      compare={props.compare}
    />
  );
}

/** 選択のボタン（部品の吹き出しの選択肢と同じ見せ方: 枠で囲み、選んでいるものは太い枠と塗り）。 */
function Choice({
  selected,
  why,
  onClick,
  children,
  data,
}: {
  selected: boolean;
  why?: string | null | undefined;
  onClick: () => void;
  children: ReactNode;
  data: Record<string, string>;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!!why}
      {...data}
      className={clsx(
        'flex w-full min-w-0 items-start gap-1.5 rounded-field px-2 py-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        selected
          ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
          : why
            ? 'cursor-default bg-base-200 opacity-50 ring-1 ring-base-300 ring-inset'
            : 'cursor-pointer bg-base-100 ring-1 ring-base-300 ring-inset hover:bg-base-200',
      )}
      onClick={() => {
        if (selected || why) return;
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** 解析の置き場: 置き方 × 実行先（D-245）。 */
function AnalysisField({
  stackIndex,
  framework,
  components,
  onChange,
  compare,
  note,
  slotExtra,
  slot: x,
}: Props & { slot: SetupSlot }) {
  const platform = STACKS[stackIndex]!.provider;
  const { options } = slotView(x, stackIndex, framework, components);
  const byId = new Map(options.map((e) => [e.o.id, e]));
  const picked = components[x.slot];
  const current = analysisPlacementOf(picked);
  const pick = (id: string) => onChange({ ...components, [x.slot]: id });
  // 置き方ごとに選べる実行先（この構成の選択肢にあるもの。並びは ANALYSIS_TARGETS の順）
  const targetsOf = (mode: AnalysisMode): AnalysisTarget[] =>
    ANALYSIS_TARGETS.filter((t) => byId.has(analysisPlacementId(mode, t)));
  const chosen = picked ? byId.get(picked) : undefined;
  const mode = picked ? current.mode : undefined;
  return (
    <section
      className="min-w-0 space-y-3 p-1 sm:p-2"
      data-own-slot={x.slot}
      aria-label={x.label}
    >
      {/* 見出しはタブと重なるので画面からは隠す（読み上げには残す） */}
      <h4 className="sr-only">{x.label}</h4>
      <div className="flex items-start gap-1">
        <p className="text-xs opacity-70">
          解析をどこで動かすかは、インフラの構成から独立して選べます。サーバーの実行先は、アプリと別の事業者でもかまいません（結果はアプリの
          API に送って保存します）。
        </p>
        {compare && (
          <SlotCompareInfo
            label={`${x.label}を表と月額で比べる`}
            slotLabel={x.label}
            current={picked}
            why={(id) => byId.get(id)?.why ?? null}
            load={() => compare(x.slot)}
          />
        )}
      </div>
      {note && <p className="text-xs opacity-70">{note}</p>}
      <div role="group" aria-label="置き方" className="space-y-1">
        <div className="text-xs font-semibold">置き方</div>
        <div className="grid gap-1 sm:grid-cols-3">
          {MODES.map((m) => {
            const targets = targetsOf(m.mode);
            if (targets.length === 0) return null;
            // 置き方を替えても実行先は保つ（新しい置き方に無ければ最初の実行先）
            const keep =
              current.target && targets.includes(current.target)
                ? current.target
                : targets[0]!;
            const id = analysisPlacementId(m.mode, keep);
            return (
              <Choice
                key={m.mode}
                selected={mode === m.mode}
                why={byId.get(id)?.why}
                onClick={() => pick(id)}
                data={{ 'data-analysis-mode': m.mode }}
              >
                <span className="block min-w-0">
                  <span className="block">{m.label}</span>
                  <span className="block text-xs font-normal opacity-70">
                    {m.note}
                  </span>
                </span>
              </Choice>
            );
          })}
        </div>
      </div>
      {mode !== undefined && mode !== 'client' && (
        <div role="group" aria-label="実行先" className="space-y-1">
          <div className="text-xs font-semibold">
            {mode === 'hybrid' ? '本解析の実行先' : '実行先'}
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {targetsOf(mode).map((t) => {
              const id = analysisPlacementId(mode, t);
              const e = byId.get(id)!;
              const flavor = componentFlavor(e.o);
              return (
                <li key={t} data-option={id}>
                  <Choice
                    selected={picked === id}
                    why={e.why}
                    onClick={() => pick(id)}
                    data={{ 'data-analysis-target': t }}
                  >
                    {e.other && (
                      <span className="inline-block shrink-0 align-middle leading-none">
                        <BrandMark
                          brand={COMPONENT_BRAND[e.o.platform]}
                          size={14}
                        />
                      </span>
                    )}
                    <span className="block min-w-0">
                      <span className="block">
                        {analysisTargetName(t, platform)}
                        {t === 'same' && (
                          <span className="ml-1 text-xs font-normal opacity-70">
                            （アプリと同じ実行環境）
                          </span>
                        )}
                      </span>
                      {flavor && (
                        <span className="block text-xs font-normal opacity-70">
                          {flavor}
                        </span>
                      )}
                      {e.why && (
                        <span className="block text-xs font-normal">
                          {e.why}
                        </span>
                      )}
                    </span>
                  </Choice>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {slotExtra?.[x.slot] && (
        <div className="border-t border-base-300 pt-2">{slotExtra[x.slot]}</div>
      )}
      {chosen && (
        <p className="text-xs" data-own-slot-note>
          <span className="font-semibold">{chosen.o.label}: </span>
          {chosen.o.note}
        </p>
      )}
    </section>
  );
}
