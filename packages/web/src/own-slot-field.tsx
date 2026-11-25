// 構成・フレームワークと並ぶ別のタブで選ぶスロット（D-245・prd/17 §5.6。Scenario.ownTabSlots）。① 構成のカードからは外し、
// ゲームの始める画面・途中の「構成を変える」・見積モードの SetupTabs に ③ のタブとして出す。
// 解析の置き場は、置き方（サーバー・端末・併用）と実行先（同じ実行環境・別の事業者のサーバーレス・Fargate・台で借りるマシン）の 2 段で選ぶ。
// 実行先は払い方の型ごとの見出し（件ごと・動いている間・台で借りる）でまとめ、台で借りるマシンは系列の行に大きさを並べる（D-247）。
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
  type AnalysisMode,
  type AnalysisTarget,
  type AnalysisTargetKind,
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

/** 実行先の払い方の型の見出し（D-247）。 */
const KIND_HEADING: Record<AnalysisTargetKind, string> = {
  same: 'アプリと同じ実行環境',
  'per-call': '件ごとに払う（サーバーレス）',
  running: '動いている間だけ払う（コンテナを増やし減らす）',
  machine: '台で借りる（マシン・VPS。混む時間に待ちが出る）',
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
      </div>
      {mode !== undefined && mode !== 'client' && (
        <div role="group" aria-label="実行先" className="space-y-1">
          <div className="text-xs font-semibold">
            {mode === 'hybrid' ? '詳細解析の実行先' : '実行先'}
          </div>
          {KINDS.map((kind) => {
            const ts = targetsOf(mode).filter(
              (t) => analysisTargetKind(t) === kind,
            );
            if (ts.length === 0) return null;
            return (
              <div key={kind} className="space-y-1" data-analysis-kind={kind}>
                <div className="text-xs opacity-70">{KIND_HEADING[kind]}</div>
                {kind === 'machine' ? (
                  <MachineRows
                    targets={ts}
                    mode={mode}
                    picked={picked}
                    byId={byId}
                    pick={pick}
                  />
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {ts.map((t) => {
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
                            {t !== 'same' && (
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
                )}
              </div>
            );
          })}
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
