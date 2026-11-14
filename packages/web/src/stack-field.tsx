// 始める画面のインフラの構成（D-105）。事業者のタブ（D-221）と、選んでいる構成のカード（プラン・構成図）。
// （選んだフレームワークと部品で描く。どんなアプリをどこに載せるのかを図で分かるように）。
// どれにも推奨・既定の印を付けない（D-41）。並びは今までの一覧の順（隠した構成は出さない。D-100）。
// 始める画面では構成を先に選ぶ（D-113）。今のフレームワークを載せられない構成も隠さず、印と注意を添える（選ぶとフレームワークが替わる）。
// タブは土台の事業者（課金のアカウント）ごとの枠にまとめ、プランをチップで出す（1 つだけの事業者は事業者の名前だけ。D-105 の補足）。
// カードは事業者ごとに 1 枚で、プランのチップはカードを動かさず中身（名前・説明・手間・注意・構成図）を替える（D-105 の補足）。
// 見積モードと共用（D-115）。値は STACKS の index（見積の構成の id との変換は見積の画面の境目で 1 回）。カードに添える注記
// （見積はその構成の月額）は cardExtra、手間の棒（ゲームだけ）は effort で切り替える。
// 部品の選択は選んでいるカードの中で行う（D-116。前の ③ 部品の欄を移した）。構成図の箱から選ぶ表示と、機能ごとのチップから選ぶ表示を
// タブで切り替える（D-116 の補足。どちらの表示でもすべてのスロットを選べる）。
import clsx from 'clsx';
import {
  FRAMEWORKS,
  membersOf,
  pageWireframes,
  slaOf,
  stackFlavor,
  stackName,
  stackSupports,
  STACKS,
  termNotesOf,
  resolvedRouteStrategies,
  validRouteOverrides,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
  type SetupSlot,
} from 'game';
import { useCallback, useState, type ReactNode } from 'react';
import { BRANDS, PLATFORM_BRANDS, PlatformMarks } from './brand-logos.tsx';
import { ChoiceTabs } from './choice-tabs.tsx';
import { Info, MoreDetails } from './info.tsx';
import { EffortBar, EffortDetail } from './scenario-briefing.tsx';
import {
  isUnselected,
  PartChips,
  PartOptions,
  componentWhy,
  usePartSlots,
  type PartsCompare,
  type SetupChoices,
} from './setup-components.tsx';
import { SlotCompareDialog } from './slot-compare.tsx';
import {
  DIAGRAM_NOTE,
  LaneLegend,
  SystemDiagram,
  type BandSlot,
  type BoxFocus,
  type DiagramParts,
} from './system-diagram.tsx';
import type { ResolvedPage } from './page-wireframes.tsx';
import { diagramModel } from './system-diagram-model.ts';
import {
  diagramArchitecture,
  diagramComponents,
  slotBoxes,
  type GhostSlot,
} from './system-diagram-model.ts';

/** 部品の選択（選んでいるカードの、構成図の箱か機能ごとのチップ。D-116）。 */
type PartsEditor = {
  onChange: (v: SetupChoices) => void;
  note?: ReactNode;
  /** スロットに添えるもの（見積モードの画像の形式・サイズ違い。チップの行の下か、図の箱の吹き出しの中。D-119）。 */
  slotExtra?: Partial<Record<string, ReactNode>> | undefined;
  /** 部品の ⓘ の比較（D-124。チップの ⓘ と図の箱の吹き出しの「比べる」）。 */
  compare?: PartsCompare | undefined;
};

/**
 * 部品の選び方の表示（D-116 の補足）: 構成図の箱から選ぶ（「インフラ構成から機能を選択」）か、スロットごとのチップから選ぶ
 * （「機能からインフラを選択」）。既定は構成図。切り替えた表示は、ゲームの始める画面と見積モードで共通の好みとして覚える
 * （保存データ・URL には入れない）。
 */
export type PartsView = 'diagram' | 'list';
const PARTS_VIEW_KEY = 'infra-supra:parts-view';
const PARTS_VIEWS: readonly {
  view: PartsView;
  label: string;
  title: string;
}[] = [
  {
    view: 'diagram',
    label: '構成図から選ぶ',
    title: 'インフラ構成から機能を選択（構成図の箱を押して部品を替える）',
  },
  {
    view: 'list',
    label: '機能から選ぶ',
    title:
      '機能からインフラを選択（機能ごとの部品のチップ。構成図は出しません）',
  },
];

function readPartsView(): PartsView {
  try {
    return localStorage.getItem(PARTS_VIEW_KEY) === 'list' ? 'list' : 'diagram';
  } catch {
    // 保存領域が使えない環境では既定の構成図
    return 'diagram';
  }
}

function storePartsView(v: PartsView) {
  try {
    localStorage.setItem(PARTS_VIEW_KEY, v);
  } catch {
    // 覚えられなくても選べる（開き直すと構成図に戻るだけ）
  }
}

/**
 * 選んでいるカードの部品の選択（D-116 とその補足）。タブで 2 つの表示を切り替え、どちらか一方だけを出す:
 * - 構成図: 箱を押すと、その箱に当たるスロットの部品を選べる（slotBoxes）。今の選択が箱を持たないスロットは幽霊の箱、
 *   経路に載らない部品・図に箱を持たないスロットは図の一番下の段の箱で選ぶ。
 * - 機能: スロットごとのチップ（PartChips）だけ。縦の量を減らすため構成図は出さない。
 * どちらの表示でも、すべてのスロットを選べる。
 */
function EditableDiagram({
  stackIndex,
  framework,
  components,
  slots,
  swap,
  ghosts,
  arch,
  pages,
  caption,
  editor,
}: {
  stackIndex: number;
  framework: FrameworkId;
  components: SetupChoices;
  slots: SetupSlot[];
  swap: ReadonlyMap<string, readonly string[]>;
  ghosts: readonly GhostSlot[];
  arch: ReturnType<typeof diagramArchitecture>;
  pages: readonly ResolvedPage[];
  caption: string | undefined;
  editor: PartsEditor;
}) {
  const [view, setViewState] = useState<PartsView>(readPartsView);
  const setView = (v: PartsView) => {
    setViewState(v);
    storePartsView(v);
  };
  // 箱の吹き出しで選んだスロットと押した箱（描き直した後に、その箱へ focus を移す。消えていればスロットの最初の箱。OCL-131BD89D）
  const [focusTarget, setFocusTarget] = useState<BoxFocus | null>(null);
  const clearFocus = useCallback(() => setFocusTarget(null), []);
  // 箱の吹き出しの「比べる」で開いた比較（D-124）。閉じたら、開く前に focus のあった箱へ戻す
  const [comparing, setComparing] = useState<{
    slot: string;
    back: HTMLElement | null;
  } | null>(null);
  const bySlot = new Map<string, (typeof slots)[number]>(
    slots.map((x) => [x.slot, x]),
  );
  const parts: DiagramParts = {
    slotsOf: (id) => swap.get(id) ?? [],
    // チップの行の「未選択」と同じ判定（D-45。見積モードは全部のスロットが埋まっていて出ない）
    unselected: (slot) => {
      const x = bySlot.get(slot);
      return x !== undefined && isUnselected(x, components);
    },
    render: (slot, close, box) => (
      <>
        <PartOptions
          slot={bySlot.get(slot)!}
          stackIndex={stackIndex}
          framework={framework}
          value={components}
          onChange={(v) => {
            editor.onChange(v);
            setFocusTarget({ slot, box });
          }}
          close={close}
          onCompare={
            editor.compare
              ? () => {
                  // 吹き出しを閉じる（focus は箱に戻る）。その箱を、比較を閉じたときの戻り先にする
                  close();
                  setComparing({
                    slot,
                    back: document.activeElement as HTMLElement | null,
                  });
                }
              : undefined
          }
        />
        {/* 見積モードの画像の形式・サイズ違いは、画像の箱の吹き出しの中で選ぶ（D-119） */}
        {editor.slotExtra?.[slot] && (
          <div className="mt-2 border-t border-base-300 pt-1.5">
            {editor.slotExtra[slot]}
          </div>
        )}
      </>
    ),
  };
  // 一番下の段に出すスロット（図に箱を持たないもの。1 択は押せない箱）
  const bandSlots: BandSlot[] = slots.map((x) => {
    const id = x.fixed ? x.options[0]!.id : components[x.slot];
    return {
      slot: x.slot,
      label: x.label,
      picked: x.options.find((o) => o.id === id)?.label,
      fixed: x.fixed,
      pressable: !x.fixed && x.slot !== 'files' && x.options.length >= 2,
    };
  });
  return (
    <div className="min-w-0 space-y-2" data-parts-view={view}>
      {/* 見た目は daisyUI のタブ。矢印キーで移る tablist にはせず、押した状態（aria-pressed）を持つボタンの組にする */}
      <div
        role="group"
        aria-label="部品の選び方"
        className="tabs-box tabs w-fit max-w-full tabs-xs"
      >
        {PARTS_VIEWS.map((t) => (
          <button
            key={t.view}
            type="button"
            aria-pressed={view === t.view}
            title={t.title}
            data-parts-view-tab={t.view}
            className={clsx('tab', view === t.view && 'tab-active')}
            onClick={() => setView(t.view)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-w-0">
        {view === 'diagram' ? (
          <div className="min-w-0 space-y-1.5">
            {editor.note && <p className="text-xs opacity-70">{editor.note}</p>}
            <SystemDiagram
              architecture={arch}
              framework={framework}
              pages={pages}
              caption={caption}
              parts={parts}
              ghosts={ghosts}
              bandSlots={bandSlots}
              focusTarget={focusTarget}
              onFocused={clearFocus}
            />
          </div>
        ) : (
          <PartChips
            stackIndex={stackIndex}
            framework={framework}
            slots={slots}
            value={components}
            onChange={editor.onChange}
            note={editor.note}
            slotExtra={editor.slotExtra}
            compare={editor.compare}
          />
        )}
      </div>
      {comparing && editor.compare && bySlot.get(comparing.slot) && (
        <SlotCompareDialog
          open
          slotLabel={bySlot.get(comparing.slot)!.label}
          current={components[comparing.slot]}
          why={(id) =>
            componentWhy(
              stackIndex,
              framework,
              bySlot.get(comparing.slot)!,
              components,
              id,
            )
          }
          load={() => editor.compare!(comparing.slot)}
          onClose={() => {
            comparing.back?.focus();
            setComparing(null);
          }}
        />
      )}
    </div>
  );
}

/** 構成のカード: 名前・説明・毎月の手間・構成図。 */
function StackCard({
  scenario,
  stackIndex,
  framework,
  components,
  comments,
  routes,
  extra,
  effort,
  caption,
  parts,
  plans,
}: {
  scenario: Scenario;
  stackIndex: number;
  /** この構成で描くフレームワーク。 */
  framework: FrameworkId;
  components: Partial<Record<string, string>> | undefined;
  comments: number | undefined;
  /** 選んだページごとの描き方（図と流れの凡例に効く。D-107）。 */
  routes: RouteOverrides | undefined;
  /** 説明の下に添える注記（見積の月額など。D-115）。 */
  extra?: ReactNode;
  /** 毎月の手間の棒を出すか（ゲームだけ）。 */
  effort: boolean;
  /** 構成図の説明。 */
  caption: string | undefined;
  /** 部品の選択（D-116）。省略は図だけ。 */
  parts?: PartsEditor | undefined;
  /** プランのチップ（D-221）。 */
  plans?: ReactNode;
}) {
  // DB を他の事業者に替えた実際の組の名前（「Vercel Pro + AWS DynamoDB」。D-77・D-114 段 2）
  const name = stackName(
    stackIndex,
    framework,
    false,
    components?.db ? { db: components.db } : {},
  );
  // この構成で選べない描き方は既定に戻して描く（構成図の staticBuildOf と同じ。D-107 の補足）
  const pages = pageWireframes(
    scenario,
    framework,
    comments,
    routes && validRouteOverrides(scenario, stackIndex, framework, routes),
    // 表・計算と同じ実際の描き方（部品の「キャッシュしない」なども効く。OCL-CD192A98）
    resolvedRouteStrategies(scenario, {
      framework,
      stackIndex,
      components: components ?? {},
      routes,
    }),
  );
  const arch = diagramArchitecture(
    scenario,
    stackIndex,
    framework,
    components ?? {},
    routes,
  );
  // 差し替えられるスロットの箱と幽霊の箱（D-116 の補足）
  const slots = usePartSlots(scenario, stackIndex, framework, components ?? {});
  const boxes = slotBoxes(
    (c) => diagramArchitecture(scenario, stackIndex, framework, c, routes),
    diagramComponents(scenario, stackIndex, framework, components),
    slots,
  );
  const premises = [...slaOf(stackIndex), ...membersOf(stackIndex)];
  // 名前・部品に出る用語（vinext・Fluid）の補足（D-160）
  const terms = termNotesOf([name, ...arch.nodes.map((n) => n.label)]);
  const flavor = stackFlavor(stackIndex);
  // 選んでいる部品で増える他の事業者の管理も出す（D-52）
  const effortProps = {
    scenario,
    stackIndex,
    components: components ?? {},
    framework,
  };
  // 線の色の凡例は ⓘ の中に出す（D-217。図の下には出さない）
  const lanes = diagramModel(
    arch,
    pages,
    'horizontal',
    boxes.ghosts,
    framework,
  ).lanes;
  return (
    <section
      aria-label={`${name} の構成`}
      aria-current="true"
      data-stack={STACKS[stackIndex]!.id}
      className="card w-full bg-base-100"
    >
      {/* カードの枠はタブの下の枠（ChoiceTabs）が持つ */}
      <div className="card-body min-w-0 gap-3 p-1 sm:p-2">
        <h4 className="card-title text-lg">
          <PlatformMarks platform={STACKS[stackIndex]!.provider} primaryOnly />
          <span className="min-w-0">{name}</span>
          {/* カードの ⓘ は右上の 1 つにまとめる（短い説明・毎月の手間の内訳・線の色・詳しい説明。D-217・D-218） */}
          <span className="ml-auto shrink-0">
            <Info label={`${name} の説明`}>
              {flavor && <p>{flavor}。</p>}
              {effort && <EffortDetail {...effortProps} />}
              <LaneLegend lanes={lanes} />
              <MoreDetails>
                {premises.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {premises.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
                {terms.map((t) => (
                  <p key={t}>{t}。</p>
                ))}
                <p>{DIAGRAM_NOTE}</p>
              </MoreDetails>
            </Info>
          </span>
        </h4>
        {plans}
        {extra}
        {effort && <EffortBar {...effortProps} />}
        {/* 部品を選べる（構成図の箱か機能ごとのチップ。D-116 とその補足）。部品を選ばせない画面は図だけ */}
        {parts ? (
          <EditableDiagram
            stackIndex={stackIndex}
            framework={framework}
            components={components ?? {}}
            slots={slots}
            swap={boxes.swap}
            ghosts={boxes.ghosts}
            arch={arch}
            pages={pages}
            caption={caption}
            editor={parts}
          />
        ) : (
          <SystemDiagram
            architecture={arch}
            framework={framework}
            pages={pages}
            caption={caption}
            ghosts={boxes.ghosts}
          />
        )}
      </div>
    </section>
  );
}

/** プランの短い名前（STACKS の plan。「free」→「Free」・「2gb」→「2GB」・「pay-as-you-go」→「従量課金」）。 */
const planLabel = (plan: string): string =>
  plan === 'pay-as-you-go'
    ? '従量課金'
    : /^\d+gb$/i.test(plan)
      ? plan.toUpperCase()
      : plan.charAt(0).toUpperCase() + plan.slice(1);

/** 事業者の名前（その事業者の最初のブランド）。 */
const providerTitle = (provider: string): string =>
  BRANDS[PLATFORM_BRANDS[provider as keyof typeof PLATFORM_BRANDS][0]!].title;

/**
 * 構成のカードの中のプランのチップ（D-221。プランが 1 つの事業者も、何のプランかを出す）。ラジオの名前は構成の名前（「Cloudflare Paid」）、
 * 値は構成の id。
 */
function PlanChips({
  plans,
  shown,
  value,
  framework,
  onChange,
}: {
  plans: readonly number[];
  /** このカードに出しているプラン。 */
  shown: number;
  /** 選んでいる構成（選んでいない事業者のカードでは、どのプランのラジオも選ばれていない）。 */
  value: number;
  framework: FrameworkId;
  onChange: (stackIndex: number) => void;
}) {
  const distinct =
    new Set(plans.map((i) => STACKS[i]!.plan)).size === plans.length;
  return (
    <div
      role="radiogroup"
      aria-label="プラン"
      className="flex flex-wrap items-center gap-2 text-sm"
      data-plan-chips
      // カードを押して選ぶ動き（その事業者の最初のプラン）と重ねない
      onClick={(e) => e.stopPropagation()}
    >
      <span className="font-semibold">プラン:</span>
      {/* 枠つきの切り替えボタン（選んだプランを塗る。選択肢だと分かるように枠で囲む。D-221） */}
      <div className="join">
        {plans.map((i) => (
          <label
            key={i}
            className={clsx(
              'join-item btn gap-1 btn-sm btn-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary',
              i === shown ? '' : 'btn-outline bg-base-100',
            )}
          >
            <input
              type="radio"
              name="stack-plan"
              value={STACKS[i]!.id}
              className="sr-only"
              aria-label={stackName(i, framework, false)}
              checked={i === value}
              onChange={() => onChange(i)}
            />
            {distinct
              ? planLabel(STACKS[i]!.plan)
              : stackName(i, framework, false)}
          </label>
        ))}
      </div>
    </div>
  );
}

/** インフラの構成を選ぶ（事業者のタブとカードの中のプラン。D-221）。value は STACKS の index。 */
export function StackField({
  scenario,
  framework,
  value,
  onChange,
  components,
  comments,
  routes,
  cardExtra,
  effort = true,
  onComponentsChange,
  partsNote,
  partsExtra,
  partsCompare,
  diagramCaption,
  alsoShow,
}: {
  scenario: Scenario;
  framework: FrameworkId;
  value: number;
  onChange: (stackIndex: number) => void;
  /** 選んでいる構成の部品（選んでいる構成の図と手間に使う）。 */
  components: Partial<Record<string, string>>;
  /** 記事のページのコメント欄（流れの凡例のページの名前に使う。D-82・D-109）。 */
  comments?: number | undefined;
  /** 選んだページごとの描き方（D-107）。 */
  routes?: RouteOverrides | undefined;
  /** カードの説明の下に添える注記（見積モードはその構成の月額。D-115）。 */
  cardExtra?: (stackIndex: number) => ReactNode;
  /** 毎月の手間の棒を出すか（ゲームの仮定なので、見積モードでは出さない。D-115）。 */
  effort?: boolean;
  /**
   * 部品を選び直す（選んでいるカードの構成図の下のチップと、図の箱から。D-116）。整合（ゲームの validSetupChoices・
   * 見積の normalizeInput）は呼び出し側が持つ。省略は部品を選ばせない。
   */
  onComponentsChange?: (components: SetupChoices) => void;
  /** 部品のチップの注記（画面ごと。D-115）。 */
  partsNote?: ReactNode;
  /** 部品のスロットの行に添えるもの（見積モードの画像の形式・サイズ違いを画像の行に。D-119）。 */
  partsExtra?: Partial<Record<string, ReactNode>> | undefined;
  /** 構成図の説明。 */
  diagramCaption?: string | undefined;
  /** 部品の ⓘ の比較（選んでいる構成の今の条件で、スロットだけ替えた見積。D-124）。省略は説明の吹き出し。 */
  partsCompare?: PartsCompare | undefined;
  /** 隠した構成でも出す構成（ゲームの途中で、隠した構成で始めた古い保存の今の構成。D-100・D-185）。 */
  alsoShow?: number | undefined;
}) {
  // 隠した構成（D-100）だけを外す。今のフレームワークを載せられない構成も出す（D-113）
  const shownStacks = STACKS.filter(
    (s) => !s.hidden || s.index === alsoShow,
  ).map((s) => s.index);
  // タブは事業者ごと、プランはカードの中で選ぶ（D-221）。その事業者へ移るときは最初のプラン
  const providers = [...new Set(shownStacks.map((i) => STACKS[i]!.provider))];
  const plansOf = (p: string) =>
    shownStacks.filter((i) => STACKS[i]!.provider === p);
  const currentProvider = STACKS[value]!.provider;
  const stackOf = (p: string) =>
    p === currentProvider ? value : plansOf(p)[0]!;
  // タブは事業者の名前だけ（プランはカードの中。D-221）
  const tabName = providerTitle;
  const fwLabel = FRAMEWORKS[framework].label;
  return (
    <ChoiceTabs
      heading="① インフラの構成"
      name="stack"
      items={providers}
      value={currentProvider}
      onChange={(p) => onChange(stackOf(p))}
      tab={(p) => ({
        mark: (
          <PlatformMarks platform={STACKS[stackOf(p)]!.provider} primaryOnly />
        ),
        label: tabName(p),
      })}
      flag={(p) =>
        stackSupports(stackOf(p), framework)
          ? undefined
          : `${fwLabel} を載せられない構成（選ぶとフレームワークが替わる）`
      }
      renderCard={(p) => (
        // 出すのは選んでいる構成のカードだけ（D-221。タブにした）
        <StackCard
          scenario={scenario}
          stackIndex={value}
          framework={framework}
          components={components}
          comments={comments}
          routes={routes}
          plans={
            <PlanChips
              plans={plansOf(p)}
              shown={value}
              value={value}
              framework={framework}
              onChange={onChange}
            />
          }
          extra={cardExtra?.(value)}
          effort={effort}
          caption={diagramCaption}
          parts={
            onComponentsChange
              ? {
                  onChange: onComponentsChange,
                  note: partsNote,
                  slotExtra: partsExtra,
                  compare: partsCompare,
                }
              : undefined
          }
        />
      )}
    />
  );
}

/**
 * 構成を替えて、今のフレームワークを載せられないので替わる先へ付け替えたときの知らせ（D-113。② の頭に出す。見積モードと共用。D-115）。
 * routesReset は選んだページの描き方を既定に戻したか。
 */
export function frameworkFallbackNotice(
  stackIndex: number,
  want: FrameworkId,
  to: FrameworkId,
  routesReset: boolean,
): string {
  return `${stackName(stackIndex, to, false)} には ${FRAMEWORKS[want].label} を載せる公式のアダプターが無いので、フレームワークを ${FRAMEWORKS[to].label} にしました${
    routesReset ? '（選んだページの描き方は既定に戻しました）' : ''
  }。`;
}
