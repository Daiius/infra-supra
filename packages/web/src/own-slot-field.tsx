// 構成・フレームワークと並ぶ別のタブで選ぶスロット（D-245・prd/17 §5.6。Scenario.ownTabSlots）。① 構成のカードからは外し、
// ゲームの始める画面・途中の「構成を変える」・見積モードの SetupTabs に ③ のタブとして出す。
// 解析の置き場は、置き方（サーバー・端末・併用）→ 払い方（同じ実行環境・件ごと・動いている間・台で借りる）→ 事業者（台で借りるとき）
// → 実行先（台で借りるマシンは系列の行に大きさを並べ、台数を添える。D-247・D-251）の段で選び、選んだものの下の段だけを開く。
// 解析の設定（区切り方・候補の数・詳細解析の範囲）は最後の段で、今の値の要約を見出しにして畳む（D-254）。
// 実行先は Web の事業者から独立して選べる（結果はアプリの API に送る）。今の構成で選べないものは出さない（選択肢に無いもの）、
// 部品どうしの依存で選べないものは灰色で理由を添える（チップと同じ判定）。それ以外のスロットは機能のチップ（PartChips）で選ぶ。
import clsx from 'clsx';
import {
  ANALYSIS_MACHINES,
  ANALYSIS_TARGETS,
  analysisPlacementId,
  analysisPlacementOf,
  analysisTargetKind,
  analysisTargetName,
  type AnalysisMachine,
  type AnalysisMode,
  type AnalysisTarget,
  type AnalysisTargetKind,
  type Platform,
} from 'catalog';
import {
  componentFlavor,
  setupSlots,
  STACKS,
  STAGE_LABEL,
  type FrameworkId,
  type Scenario,
  type SetupSlot,
  type Stage,
} from 'game';
import {
  Coins,
  Server,
  Smartphone,
  Target,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AnalysisSettingsPartContext } from './analysis-settings.tsx';
import { BrandMark, COMPONENT_BRAND } from './brand-logos.tsx';
import { STAGE_CLS } from './game-screen/shared.ts';
import {
  PartChips,
  slotView,
  usePartSlots,
  type OwnSetupTab,
  type PartsCompare,
  type SetupChoices,
} from './setup-components.tsx';
import { SlotCompareInfo } from './slot-compare.tsx';

/**
 * 置き方ごとの引き換え（正確さ・サーバーの費用・速さ）。モデルの判定（prd/17 §5.5）を言葉にしたもの。段階は満足度の札と同じ
 * 3 段（良い・普通・悪い）の色で見せ、費用は「安い・中・高い」の言葉にする（word）。
 */
type Tradeoff = {
  icon: LucideIcon;
  label: string;
  stage: Stage;
  text: string;
  word?: Record<Stage, string>;
};
/** 費用の段階の言葉（良い = 安い）。 */
const COST_WORD: Record<Stage, string> = {
  good: '安い',
  fair: '中',
  bad: '高い',
};

/** 置き方の選択肢（解析の置き場）。 */
const MODES: readonly {
  mode: AnalysisMode;
  label: string;
  /** 置き方のアイコン（併用は端末とサーバーを並べる）。 */
  icons: readonly LucideIcon[];
  tradeoffs: readonly Tradeoff[];
}[] = [
  {
    mode: 'server',
    label: 'サーバーで解析',
    icons: [Server],
    tradeoffs: [
      {
        icon: Target,
        label: '正確さ',
        stage: 'good',
        text: '強い評価関数で深く読める',
      },
      {
        icon: Coins,
        label: '費用',
        stage: 'bad',
        word: COST_WORD,
        text: '解析の量だけかかる',
      },
      { icon: Zap, label: '速さ', stage: 'fair', text: '実行先しだい' },
    ],
  },
  {
    mode: 'client',
    label: '利用者の端末で解析',
    icons: [Smartphone],
    tradeoffs: [
      {
        icon: Target,
        label: '正確さ',
        stage: 'fair',
        text: '軽い評価関数で読みは浅め',
      },
      {
        icon: Coins,
        label: '費用',
        stage: 'good',
        word: COST_WORD,
        text: 'サーバーの解析は 0',
      },
      { icon: Zap, label: '速さ', stage: 'fair', text: '端末しだい' },
    ],
  },
  {
    mode: 'hybrid',
    label: '端末で簡易解析・サーバーで詳細解析',
    icons: [Smartphone, Server],
    tradeoffs: [
      {
        icon: Target,
        label: '正確さ',
        stage: 'good',
        text: '詳細解析で深く読める',
      },
      {
        icon: Coins,
        label: '費用',
        stage: 'bad',
        word: COST_WORD,
        text: 'サーバーと同じ（希望した棋譜だけなら約半分）',
      },
      { icon: Zap, label: '速さ', stage: 'good', text: '簡易解析ですぐ見える' },
    ],
  },
];

/**
 * 全角の括弧の補足（「（」から「）」まで）を inline-block で包む。収まらないときは括弧の手前で折れ、補足が 1 行より長ければ
 * その中で折れる（必ず改行させはしない）。括弧が無ければそのまま返す。
 */
function withParenBreaks(text: string): ReactNode {
  const parts = text.split(/(（[^（）]*）)/);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.startsWith('（') && p.endsWith('）') ? (
      <span key={i} className="inline-block">
        {p}
      </span>
    ) : (
      p
    ),
  );
}

/** 引き換えの 1 行（満足度の札と同じバッジ: アイコン・名前・太字の段階を段階の色で。横に短い理由を小さく）。 */
function TradeoffRow({ t }: { t: Tradeoff }) {
  const Icon = t.icon;
  return (
    // 狭い画面では理由がバッジの下に折り返す（バッジは途中で折らない）
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal">
      <span
        className={clsx(
          'badge badge-sm shrink-0 gap-1 whitespace-nowrap',
          STAGE_CLS[t.stage],
        )}
      >
        <Icon aria-hidden className="size-3" />
        {t.label}
        <span className="font-semibold">
          {(t.word ?? STAGE_LABEL)[t.stage]}
        </span>
      </span>
      <span className="min-w-0 opacity-70">{withParenBreaks(t.text)}</span>
    </li>
  );
}

/** 実行先の払い方の型の名前と一言（D-247）。 */
const KIND_LABEL: Record<AnalysisTargetKind, string> = {
  same: 'アプリと同じ実行環境',
  'per-call': '件ごとに払う',
  running: '動いている間だけ払う',
  machine: '台で借りる',
};
const KIND_DESC: Record<AnalysisTargetKind, string> = {
  same: 'Web と同じ所で動かします（別の契約は要りません）',
  'per-call': 'サーバーレス。解析の量に比例します',
  running: 'コンテナ（Fargate）を混み具合に合わせて増やし減らします',
  machine: 'マシン・VPS の定額。混む時間に待ちが出ます',
};
const KINDS: readonly AnalysisTargetKind[] = [
  'same',
  'per-call',
  'running',
  'machine',
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

/**
 * 解析の置き場の段（D-254）。どの段も選択肢を全部見せ、選んだものの下の段だけを開く（選んでいない枝は出さない）。
 * 解析の設定の段だけは、既定のままでよいことが多いので、今の値の要約を見出しにして畳む。
 */
type StepKey = 'mode' | 'kind' | 'provider' | 'target' | 'settings';
type Step = { key: StepKey; label: string; content: ReactNode };

/** 台で借りるマシンの事業者（段「事業者」）。 */
const PROVIDER_LABEL: Record<AnalysisMachine['provider'], string> = {
  sakura: 'さくらの VPS',
  aws: 'AWS（EC2）',
  gcp: 'Google Cloud（Compute Engine）',
};
const PROVIDERS: readonly AnalysisMachine['provider'][] = [
  'sakura',
  'aws',
  'gcp',
];

/** 解析の置き場: 置き方 → 払い方 → 事業者 → 実行先（と台数）→ 解析の設定の段（D-245）。 */
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
  const targetsOf = (mode: AnalysisMode): AnalysisTarget[] =>
    ANALYSIS_TARGETS.filter((t) => byId.has(analysisPlacementId(mode, t)));
  const chosen = picked ? byId.get(picked) : undefined;
  const mode = picked ? current.mode : undefined;
  const target = current.target ?? 'same';
  const kind = analysisTargetKind(target);
  const provider = ANALYSIS_MACHINES[target]?.provider;
  /** 候補のうち、今の実行先を保つか、選べる最初のもの。 */
  const prefer = (m: AnalysisMode, ts: readonly AnalysisTarget[]) =>
    ts.includes(target)
      ? target
      : (ts.find((t) => !byId.get(analysisPlacementId(m, t))?.why) ?? ts[0]!);

  const steps: Step[] = [];
  steps.push({
    key: 'mode',
    label: '置き方',
    content: (
      <div
        role="group"
        aria-label="置き方"
        className="grid gap-1 sm:grid-cols-3"
      >
        {MODES.map((m) => {
          const targets = targetsOf(m.mode);
          if (targets.length === 0) return null;
          const id = analysisPlacementId(m.mode, prefer(m.mode, targets));
          return (
            <Choice
              key={m.mode}
              selected={mode === m.mode}
              why={byId.get(id)?.why}
              onClick={() => pick(id)}
              data={{ 'data-analysis-mode': m.mode }}
            >
              <span className="block min-w-0 space-y-1">
                <span className="flex items-center gap-1.5">
                  <span className="flex shrink-0 items-center">
                    {m.icons.map((Icon, i) => (
                      <Icon key={i} aria-hidden className="size-4" />
                    ))}
                  </span>
                  {m.label}
                </span>
                <ul className="space-y-0.5 pl-5">
                  {m.tradeoffs.map((t) => (
                    <TradeoffRow key={t.label} t={t} />
                  ))}
                </ul>
              </span>
            </Choice>
          );
        })}
      </div>
    ),
  });
  if (mode !== undefined && mode !== 'client') {
    const ts = targetsOf(mode);
    const kinds = KINDS.filter((k) =>
      ts.some((t) => analysisTargetKind(t) === k),
    );
    steps.push({
      key: 'kind',
      label: mode === 'hybrid' ? '詳細解析の払い方' : '払い方',
      content: (
        <div
          role="group"
          aria-label="払い方"
          className="grid gap-1 sm:grid-cols-2"
        >
          {kinds.map((k) => {
            const id = analysisPlacementId(
              mode,
              prefer(
                mode,
                ts.filter((t) => analysisTargetKind(t) === k),
              ),
            );
            return (
              <Choice
                key={k}
                selected={kind === k}
                why={byId.get(id)?.why}
                onClick={() => pick(id)}
                data={{
                  'data-analysis-kind': k,
                  ...(k === 'same' ? { 'data-analysis-target': 'same' } : {}),
                }}
              >
                <span className="block min-w-0">
                  <span className="block">
                    {k === 'same'
                      ? analysisTargetName('same', platform)
                      : KIND_LABEL[k]}
                  </span>
                  <span className="block text-xs font-normal opacity-70">
                    {withParenBreaks(KIND_DESC[k])}
                  </span>
                </span>
              </Choice>
            );
          })}
        </div>
      ),
    });
    const inKind = ts.filter((t) => analysisTargetKind(t) === kind);
    if (kind === 'machine') {
      const provs = PROVIDERS.filter((p) =>
        inKind.some((t) => ANALYSIS_MACHINES[t]!.provider === p),
      );
      steps.push({
        key: 'provider',
        label: '事業者',
        content: (
          <div
            role="group"
            aria-label="事業者"
            className="grid gap-1 sm:grid-cols-3"
          >
            {provs.map((p) => {
              const pts = inKind.filter(
                (t) => ANALYSIS_MACHINES[t]!.provider === p,
              );
              const id = analysisPlacementId(mode, prefer(mode, pts));
              const e = byId.get(id)!;
              return (
                <Choice
                  key={p}
                  selected={provider === p}
                  why={e.why}
                  onClick={() => pick(id)}
                  data={{ 'data-analysis-provider': p }}
                >
                  <span className="inline-block shrink-0 align-middle leading-none">
                    <BrandMark
                      brand={COMPONENT_BRAND[e.o.platform]}
                      size={14}
                    />
                  </span>
                  <span className="block min-w-0">
                    {withParenBreaks(PROVIDER_LABEL[p])}
                    <span className="ml-1 text-xs font-normal opacity-70">
                      {pts.length} 種類
                    </span>
                  </span>
                </Choice>
              );
            })}
          </div>
        ),
      });
      steps.push({
        key: 'target',
        label: '系列と大きさ・台数',
        content: (
          <div className="space-y-2">
            <MachineRows
              targets={inKind.filter(
                (t) => ANALYSIS_MACHINES[t]!.provider === provider,
              )}
              mode={mode}
              picked={picked}
              byId={byId}
              pick={pick}
            />
            {slotExtra?.[x.slot] && (
              <AnalysisSettingsPartContext value="machines">
                {slotExtra[x.slot]}
              </AnalysisSettingsPartContext>
            )}
          </div>
        ),
      });
    } else if (kind !== 'same') {
      steps.push({
        key: 'target',
        label: '実行先',
        content: (
          <TargetList
            targets={inKind}
            mode={mode}
            platform={platform}
            picked={picked}
            byId={byId}
            pick={pick}
          />
        ),
      });
    }
  }
  if (slotExtra?.[x.slot])
    steps.push({
      key: 'settings',
      label: '解析の設定',
      content: (
        <AnalysisSettingsPartContext value="rest">
          {slotExtra[x.slot]}
        </AnalysisSettingsPartContext>
      ),
    });

  const settingsSummary = slotExtra?.[x.slot] && (
    <AnalysisSettingsPartContext value="summary">
      {slotExtra[x.slot]}
    </AnalysisSettingsPartContext>
  );

  return (
    <section
      className="min-w-0 space-y-3 p-1 sm:p-2"
      data-own-slot={x.slot}
      aria-label={x.label}
    >
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
      <ol className="space-y-3">
        {steps.map((s) =>
          s.key === 'settings' ? (
            <li key={s.key} className="border-t border-base-300 pt-2">
              <details data-analysis-step={s.key}>
                <summary className="cursor-pointer text-xs">
                  <span className="font-semibold">{s.label}</span>
                  <span className="ml-1 opacity-70">{settingsSummary}</span>
                </summary>
                <div className="mt-1.5">{s.content}</div>
              </details>
            </li>
          ) : (
            <li key={s.key} className="space-y-1" data-analysis-step={s.key}>
              <div className="text-xs font-semibold">{s.label}</div>
              {s.content}
            </li>
          ),
        )}
      </ol>
      {chosen && (
        <p className="text-xs" data-own-slot-note>
          <span className="font-semibold">{chosen.o.label}: </span>
          {chosen.o.note}
        </p>
      )}
    </section>
  );
}

/** 件ごと・動いている間の実行先の一覧。 */
function TargetList({
  targets,
  mode,
  platform,
  picked,
  byId,
  pick,
}: {
  targets: readonly AnalysisTarget[];
  mode: AnalysisMode;
  platform: Platform;
  picked: string | undefined;
  byId: ReadonlyMap<string, OptionEntry>;
  pick: (id: string) => void;
}) {
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {targets.map((t) => {
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
              <span className="inline-block shrink-0 align-middle leading-none">
                <BrandMark brand={COMPONENT_BRAND[e.o.platform]} size={14} />
              </span>
              <span className="block min-w-0">
                <span className="block">{analysisTargetName(t, platform)}</span>
                {flavor && (
                  <span className="block text-xs font-normal opacity-70">
                    {withParenBreaks(flavor)}
                  </span>
                )}
                {e.why && (
                  <span className="block text-xs font-normal">
                    {withParenBreaks(e.why)}
                  </span>
                )}
              </span>
            </Choice>
          </li>
        );
      })}
    </ul>
  );
}

/** 実行先の選択肢（slotView の 1 行）。 */
type OptionEntry = ReturnType<typeof slotView>['options'][number];

/**
 * 台で借りるマシンの実行先（D-247）: 系列（さくらの VPS・EC2 c7g など）ごとの行に、大きさのボタンを並べる。系列の一言は
 * 最初の大きさの説明（部品のフレーバー）。
 */
function MachineRows({
  targets,
  mode,
  picked,
  byId,
  pick,
}: {
  targets: readonly AnalysisTarget[];
  mode: AnalysisMode;
  picked: string | undefined;
  byId: ReadonlyMap<string, OptionEntry>;
  pick: (id: string) => void;
}) {
  const families = new Map<string, AnalysisTarget[]>();
  for (const t of targets) {
    const f = ANALYSIS_MACHINES[t]!.family;
    families.set(f, [...(families.get(f) ?? []), t]);
  }
  return (
    <ul className="space-y-1">
      {[...families].map(([family, ts]) => {
        const first = byId.get(analysisPlacementId(mode, ts[0]!))!;
        const flavor = componentFlavor(first.o);
        return (
          <li
            key={family}
            className="rounded-field bg-base-100 px-2 py-1 ring-1 ring-base-300 ring-inset"
            data-analysis-family={family}
          >
            <div className="flex items-start gap-1.5 text-sm">
              <span className="inline-block shrink-0 align-middle leading-none">
                <BrandMark
                  brand={COMPONENT_BRAND[first.o.platform]}
                  size={14}
                />
              </span>
              <span className="block min-w-0">
                <span className="block">{withParenBreaks(family)}</span>
                {flavor && (
                  <span className="block text-xs opacity-70">
                    {withParenBreaks(flavor)}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 pl-5">
              {ts.map((t) => {
                const id = analysisPlacementId(mode, t);
                const e = byId.get(id)!;
                const m = ANALYSIS_MACHINES[t]!;
                return (
                  <span key={t} data-option={id} className="min-w-0">
                    <Choice
                      selected={picked === id}
                      why={e.why}
                      onClick={() => pick(id)}
                      data={{ 'data-analysis-target': t }}
                    >
                      <span className="block min-w-0 text-xs">
                        {withParenBreaks(m.size)}
                        <span className="ml-1 opacity-70">
                          メモリ {m.memoryGB} GB
                        </span>
                      </span>
                    </Choice>
                  </span>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
