// 始める画面のインフラの構成（D-105）。フレームワークの欄（D-102）と同じカルーセルで、カードに構成図を出す
// （選んだフレームワークと部品で描く。どんなアプリをどこに載せるのかを図で分かるように）。
// どれにも推奨・既定の印を付けない（D-41）。並びは今までの一覧の順（隠した構成は出さない。D-100）。
// 始める画面では構成を先に選ぶ（D-113）。今のフレームワークを載せられない構成も隠さず、印と注意を添える（選ぶとフレームワークが替わる）。
// タブは土台の事業者（課金のアカウント）ごとの枠にまとめ、プランをチップで出す（1 つだけの事業者は事業者の名前だけ。D-105 の補足）。
// カードは事業者ごとに 1 枚で、プランのチップはカードを動かさず中身（名前・説明・手間・注意・構成図）を替える（D-105 の補足）。
// 見積モードと共用（D-115）。値は STACKS の index（見積の構成の id との変換は見積の画面の境目で 1 回）。カードに添える注記
// （見積はその構成の月額）は cardExtra、手間の棒（ゲームだけ）は effort で切り替える。
// 部品の選択は選んでいるカードの中で行う（D-116。前の ③ 部品の欄を移した）。構成図の箱から選ぶ表示と、機能ごとのチップから選ぶ表示を
// タブで切り替える（D-116 の補足。どちらの表示でもすべてのスロットを選べる）。
import {
  FRAMEWORKS,
  frameworkOnStack,
  membersOf,
  pageWireframes,
  slaOf,
  stackFlavor,
  stackName,
  stackSupports,
  STACKS,
  resolvedRouteStrategies,
  validRouteOverrides,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
  type SetupSlot,
} from 'game';
import { useCallback, useState, type ReactNode } from 'react';
import { BRANDS, PLATFORM_BRANDS, PlatformMarks } from './brand-logos.tsx';
import { ChoiceCarousel, type ChoiceGroup } from './choice-carousel.tsx';
import { Info } from './info.tsx';
import { NameWithInfo } from './option-text.tsx';
import { EffortBar } from './scenario-briefing.tsx';
import {
  isUnselected,
  PartChips,
  PartOptions,
  usePartSlots,
  type SetupChoices,
} from './setup-components.tsx';
import {
  DIAGRAM_NOTE,
  SystemDiagram,
  type BandSlot,
  type BoxFocus,
  type DiagramParts,
} from './system-diagram.tsx';
import type { ResolvedPage } from './page-wireframes.tsx';
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
    title: '機能からインフラを選択（機能ごとの部品のチップ。構成図は出さない）',
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
  caption: string;
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
            className={`tab ${view === t.view ? 'tab-active' : ''}`}
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
          />
        )}
      </div>
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
  selected,
  noteId,
  routeNotice,
  fallbackNotice,
  extra,
  effort,
  caption,
  parts,
}: {
  scenario: Scenario;
  stackIndex: number;
  /** この構成で描くフレームワーク（今のものを載せられなければ、選ぶと替わる先。D-113）。 */
  framework: FrameworkId;
  components: Partial<Record<string, string>> | undefined;
  comments: number | undefined;
  /** 選んだページごとの描き方（図と流れの凡例に効く。D-107）。 */
  routes: RouteOverrides | undefined;
  selected: boolean;
  noteId: string;
  /** この構成にすると既定に戻る描き方の注意（選んでいないカードだけ。D-107 の補足）。 */
  routeNotice?: string | null | undefined;
  /** 今のフレームワークを載せられない構成の注意（選ぶとフレームワークが替わる。D-113）。 */
  fallbackNotice?: string | undefined;
  /** 説明の下に添える注記（見積の月額など。D-115）。 */
  extra?: ReactNode;
  /** 毎月の手間の棒を出すか（ゲームだけ）。 */
  effort: boolean;
  /** 構成図の説明。 */
  caption: string;
  /** 部品の選択（選んでいるカードだけ。D-116）。 */
  parts?: PartsEditor | undefined;
}) {
  // 選んでいるカードは、DB を他の事業者に替えた実際の組の名前（「Vercel Pro + AWS DynamoDB」。D-77・D-114 段 2）
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
  // 差し替えられるスロットの箱と幽霊の箱（選んでいないカードも、選んだときと同じ形に。D-116 の補足）
  const slots = usePartSlots(scenario, stackIndex, framework, components ?? {});
  const boxes = slotBoxes(
    (c) => diagramArchitecture(scenario, stackIndex, framework, c, routes),
    diagramComponents(scenario, stackIndex, framework, components),
    slots,
  );
  const premises = [...slaOf(stackIndex), ...membersOf(stackIndex)];
  return (
    <section
      aria-label={`${name} の構成`}
      aria-current={selected ? 'true' : undefined}
      data-stack={STACKS[stackIndex]!.id}
      className={`card w-full border border-t-4 bg-base-100 motion-safe:transition ${
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/30'
          : 'scale-[0.97] border-base-300 opacity-60 saturate-50 hover:opacity-80'
      }`}
    >
      {/* 中身は上に詰める（carousel で高さを揃えたときの余りは下に回す） */}
      <div className="card-body min-w-0 justify-start gap-3 p-3 *:grow-0 sm:p-4">
        <h4 className="card-title text-lg">
          <PlatformMarks platform={STACKS[stackIndex]!.provider} />
          <NameWithInfo
            name={name}
            info={
              <Info label={`${name} の説明`}>
                <span className="block space-y-1">
                  {premises.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-5">
                      {premises.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="block">{DIAGRAM_NOTE}</span>
                </span>
              </Info>
            }
          />
        </h4>
        {/* 短い説明（フレーバー。事実だが、それだけで選ぶと外れうる。D-41） */}
        <p id={noteId} className="text-sm opacity-80">
          {stackFlavor(stackIndex)}
        </p>
        {extra}
        {fallbackNotice && (
          <p className="text-xs text-warning" role="note">
            {fallbackNotice}
          </p>
        )}
        {!selected && !fallbackNotice && routeNotice && (
          <p className="text-xs text-warning" role="note">
            {routeNotice}
          </p>
        )}
        {effort && (
          <EffortBar
            scenario={scenario}
            stackIndex={stackIndex}
            // 選んでいる構成と覚えている部品のある構成は、その部品で増える他の事業者の管理も出す（D-52・D-116 の補足）
            {...(selected || components
              ? { components: components ?? {}, framework }
              : {})}
          />
        )}
        {/* 選んでいるカードは部品を選べる（構成図の箱か機能ごとのチップ。D-116 とその補足）。選んでいないカードは図だけ */}
        {selected && parts ? (
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
            pages={pages}
            caption={caption}
            ghosts={boxes.ghosts}
          />
        )}
      </div>
    </section>
  );
}

/** プランの短い名前（STACKS の plan。「free」→「Free」・「2gb」→「2GB」）。 */
const planLabel = (plan: string): string =>
  /^\d+gb$/i.test(plan)
    ? plan.toUpperCase()
    : plan.charAt(0).toUpperCase() + plan.slice(1);

/**
 * 構成のタブの組: 土台の事業者（STACKS の provider）ごとに、並びの順で最初に出た位置にまとめる。組の名前は事業者の最初のブランド。
 * チップはプランの短い名前（組の中でプランが重なるときは構成の名前）。1 つだけの組の名前が他の組と重なるときは構成の名前にする。
 */
export function stackTabGroups(
  stackIndices: readonly number[],
  framework: FrameworkId,
): ChoiceGroup<string>[] {
  const by = new Map<string, number[]>();
  for (const i of stackIndices) {
    const p = STACKS[i]!.provider;
    by.set(p, [...(by.get(p) ?? []), i]);
  }
  const title = (p: string) =>
    BRANDS[PLATFORM_BRANDS[p as keyof typeof PLATFORM_BRANDS][0]!].title;
  const titles = [...by.keys()].map(title);
  return [...by].map(([p, idx]) => {
    const plans = idx.map((i) => STACKS[i]!.plan);
    const distinct = new Set(plans).size === plans.length;
    const name = (i: number) => stackName(i, framework, false);
    const label =
      idx.length === 1 && titles.filter((t) => t === title(p)).length > 1
        ? name(idx[0]!)
        : title(p);
    return {
      key: p,
      label,
      mark: <PlatformMarks platform={STACKS[idx[0]!]!.provider} />,
      items: idx.map((i) => STACKS[i]!.id),
      chip: (id: string) => {
        const i = STACKS.findIndex((s) => s.id === id);
        return distinct ? planLabel(STACKS[i]!.plan) : name(i);
      },
    };
  });
}

/** 構成図の注記の既定（引数の既定値に関数を直接書くと React Compiler が最適化を諦めるので外に置く）。 */
const defaultDiagramCaption = (selected: boolean, remembered: boolean) =>
  selected
    ? '部品を選ぶ前のスロットは既定の部品で描く。'
    : remembered
      ? '前にこの構成で選んだ部品（選んでいないスロットは既定）で描く。'
      : '既定の部品で描く。';

/** インフラの構成を選ぶ（カルーセル）。value は STACKS の index。 */
export function StackField({
  scenario,
  framework,
  value,
  onChange,
  components,
  comments,
  routes,
  routeNotice,
  cardExtra,
  routesOnFallback,
  rememberedOf,
  effort = true,
  onComponentsChange,
  partsNote,
  partsExtra,
  diagramCaption = defaultDiagramCaption,
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
  /** その構成にすると既定に戻る描き方の注意（D-107 の補足）。 */
  routeNotice?: (stackIndex: number) => string | null;
  /** カードの説明の下に添える注記（見積モードはその構成の月額。D-115）。 */
  cardExtra?: (stackIndex: number, selected: boolean) => ReactNode;
  /**
   * 今のフレームワークを載せられない構成を選んだとき、付け替えた後に残る描き方（そのカードの図と注意に使う）。
   * 省略は全部を既定に戻す（ゲームの始める画面の規則）。見積モードは替えた先で選べるものを残す（OCL-00BB1F11）。
   */
  routesOnFallback?: (stackIndex: number) => RouteOverrides | undefined;
  /**
   * 選んでいない構成で覚えている部品（前にその構成で選んだもの。D-116 の補足）。そのカードの題・図・手間の棒に使う。
   * 記憶と整合（今のフレームワークで選べるものだけ）は呼び出し側が持つ。
   */
  rememberedOf?: (
    stackIndex: number,
  ) => Partial<Record<string, string>> | undefined;
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
  /** 構成図の説明（選んでいるカードか・選んでいないカードで覚えている部品で描くか）。 */
  diagramCaption?: (selected: boolean, remembered: boolean) => string;
}) {
  // 隠した構成（D-100）だけを外す。今のフレームワークを載せられない構成も出す（D-113）
  const groups = stackTabGroups(
    STACKS.filter((s) => !s.hidden).map((s) => s.index),
    framework,
  );
  const indexOf = (id: string) => STACKS.findIndex((s) => s.id === id);
  const fwLabel = FRAMEWORKS[framework].label;
  /** その構成で描くフレームワーク（載せられなければ選ぶと替わる先）。 */
  const fwOf = (i: number) => frameworkOnStack(scenario, i, framework);
  const fallbackOf = (i: number) => {
    if (stackSupports(i, framework)) return undefined;
    const to = FRAMEWORKS[fwOf(i)].label;
    // 選んだ描き方のうち、付け替えた後に残らないもの（ゲームは全部。見積は替えた先で選べないものだけ。OCL-00BB1F11）
    const kept = routesOnFallback?.(i);
    const chosen = Object.keys(routes ?? {});
    const dropped = chosen.filter((r) => kept?.[r] === undefined).length;
    return `${fwLabel} はこの構成に載せられない（公式のアダプターが無い）。選ぶとフレームワークは ${to} になる${
      dropped === 0
        ? ''
        : dropped === chosen.length
          ? '（選んだページの描き方は既定に戻る）'
          : '（選んだページの描き方のうち、替えた先で選べないものは既定に戻る）'
    }。構成図は ${to} で描く`;
  };
  return (
    <ChoiceCarousel
      heading="① インフラの構成"
      name="stack"
      noun="構成"
      // 並びは組の順（←/→ は組をまたいでこの順に移る）
      items={groups.flatMap((g) => g.items)}
      groups={groups}
      value={STACKS[value]!.id}
      onChange={(id) => onChange(indexOf(id))}
      label={(id) => stackName(indexOf(id), framework, false)}
      tab={(id) => (
        <>
          <PlatformMarks platform={STACKS[indexOf(id)]!.provider} />
          {stackName(indexOf(id), framework, false)}
        </>
      )}
      describedBy={(id) => stackFlavor(indexOf(id)) !== undefined}
      flag={(id) =>
        stackSupports(indexOf(id), framework)
          ? undefined
          : `${fwLabel} を載せられない構成（選ぶとフレームワークが替わる）`
      }
      renderCard={(id, { selected, idPrefix }) => {
        const remembered = selected ? undefined : rememberedOf?.(indexOf(id));
        const hasRemembered =
          remembered !== undefined && Object.keys(remembered).length > 0;
        return (
          <StackCard
            scenario={scenario}
            stackIndex={indexOf(id)}
            framework={fwOf(indexOf(id))}
            components={
              selected ? components : hasRemembered ? remembered : undefined
            }
            comments={comments}
            // 替わる先のフレームワークでは、付け替えた後の描き方で描く（ゲームは既定に戻る）
            routes={
              fallbackOf(indexOf(id)) ? routesOnFallback?.(indexOf(id)) : routes
            }
            selected={selected}
            noteId={`${idPrefix}-${id}`}
            routeNotice={
              selected || fallbackOf(indexOf(id))
                ? null
                : routeNotice?.(indexOf(id))
            }
            fallbackNotice={selected ? undefined : fallbackOf(indexOf(id))}
            extra={cardExtra?.(indexOf(id), selected)}
            effort={effort}
            caption={diagramCaption(selected, hasRemembered)}
            parts={
              selected && onComponentsChange
                ? {
                    onChange: onComponentsChange,
                    note: partsNote,
                    slotExtra: partsExtra,
                  }
                : undefined
            }
          />
        );
      }}
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
  return `${stackName(stackIndex, to, false)} には ${FRAMEWORKS[want].label} を載せる公式のアダプターが無いので、フレームワークを ${FRAMEWORKS[to].label} にした${
    routesReset ? '（選んだページの描き方は既定に戻した）' : ''
  }。`;
}
