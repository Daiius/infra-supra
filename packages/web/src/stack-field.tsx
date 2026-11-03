// 始める画面のインフラの構成（D-105）。フレームワークの欄（D-102）と同じカルーセルで、カードに構成図を出す
// （選んだフレームワークと部品で描く。どんなアプリをどこに載せるのかを図で分かるように）。
// どれにも推奨・既定の印を付けない（D-41）。並びは今までの一覧の順（隠した構成は出さない。D-100）。
// 始める画面では構成を先に選ぶ（D-113）。今のフレームワークを載せられない構成も隠さず、印と注意を添える（選ぶとフレームワークが替わる）。
// タブは土台の事業者（課金のアカウント）ごとの枠にまとめ、プランをチップで出す（1 つだけの事業者は事業者の名前だけ。D-105 の補足）。
// カードは事業者ごとに 1 枚で、プランのチップはカードを動かさず中身（名前・説明・手間・注意・構成図）を替える（D-105 の補足）。
// 見積モードと共用（D-115）。値は STACKS の index（見積の構成の id との変換は見積の画面の境目で 1 回）。カードに添える注記
// （見積はその構成の月額）は cardExtra、手間の棒（ゲームだけ）は effort で切り替える。
// 部品の選択は選んでいるカードの中（構成図の下のチップと、図の箱の差し替え）で行う（D-116。前の ③ 部品の欄を移した）。
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
} from 'game';
import { useMemo, type ReactNode } from 'react';
import { BRANDS, PLATFORM_BRANDS, PlatformMarks } from './brand-logos.tsx';
import { ChoiceCarousel, type ChoiceGroup } from './choice-carousel.tsx';
import { Info } from './info.tsx';
import { NameWithInfo } from './option-text.tsx';
import { EffortBar } from './scenario-briefing.tsx';
import {
  PartChips,
  PartOptions,
  usePartSlots,
  type SetupChoices,
} from './setup-components.tsx';
import {
  DIAGRAM_NOTE,
  SystemDiagram,
  type DiagramParts,
} from './system-diagram.tsx';
import type { ResolvedPage } from './page-wireframes.tsx';
import { diagramArchitecture, swappableSlots } from './system-diagram-model.ts';

/** 部品の選択（選んでいるカードの、構成図の下のチップと図の箱。D-116）。 */
type PartsEditor = {
  onChange: (v: SetupChoices) => void;
  note?: ReactNode;
};

/**
 * 選んでいるカードの構成図と部品のチップ（D-116）。箱を押すと、その箱に当たるスロットの部品を選べる（swappableSlots）。
 */
function EditableDiagram({
  scenario,
  stackIndex,
  framework,
  components,
  routes,
  arch,
  pages,
  caption,
  editor,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: SetupChoices;
  routes: RouteOverrides | undefined;
  arch: ReturnType<typeof diagramArchitecture>;
  pages: readonly ResolvedPage[];
  caption: string;
  editor: PartsEditor;
}) {
  const slots = usePartSlots(scenario, stackIndex, framework, components);
  const bySlot = useMemo(
    () =>
      new Map<string, (typeof slots)[number]>(slots.map((x) => [x.slot, x])),
    [slots],
  );
  const swap = useMemo(
    () =>
      swappableSlots(
        (c) => diagramArchitecture(scenario, stackIndex, framework, c, routes),
        components,
        slots,
      ),
    [scenario, stackIndex, framework, routes, components, slots],
  );
  const parts: DiagramParts = {
    slotsOf: (id) => swap.get(id) ?? [],
    render: (slot, close) => (
      <PartOptions
        slot={bySlot.get(slot)!}
        stackIndex={stackIndex}
        framework={framework}
        value={components}
        onChange={editor.onChange}
        close={close}
      />
    ),
  };
  return (
    <>
      <SystemDiagram
        architecture={arch}
        pages={pages}
        caption={caption}
        parts={swap.size > 0 ? parts : undefined}
      />
      <PartChips
        stackIndex={stackIndex}
        framework={framework}
        slots={slots}
        value={components}
        onChange={editor.onChange}
        note={editor.note}
      />
    </>
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
  const pages = useMemo(
    () =>
      pageWireframes(
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
      ),
    [scenario, stackIndex, framework, comments, routes, components],
  );
  const arch = useMemo(
    () =>
      diagramArchitecture(
        scenario,
        stackIndex,
        framework,
        components ?? {},
        routes,
      ),
    [scenario, stackIndex, framework, components, routes],
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
      <div className="card-body min-w-0 justify-start gap-3 p-4 *:grow-0">
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
            // 選んでいる構成は、選んだ部品で増える他の事業者の管理も出す（D-52）
            {...(selected ? { components: components ?? {}, framework } : {})}
          />
        )}
        {/* 選んでいるカードは構成図の下に部品のチップを並べ、図の箱からも差し替えられる（D-116）。選んでいないカードは図だけ */}
        {selected && parts ? (
          <EditableDiagram
            scenario={scenario}
            stackIndex={stackIndex}
            framework={framework}
            components={components ?? {}}
            routes={routes}
            arch={arch}
            pages={pages}
            caption={caption}
            editor={parts}
          />
        ) : (
          <SystemDiagram architecture={arch} pages={pages} caption={caption} />
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
  effort = true,
  onComponentsChange,
  partsNote,
  diagramCaption = (selected) =>
    selected
      ? '部品を選ぶ前のスロットは既定の部品で描く。'
      : '既定の部品で描く。',
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
  /** 毎月の手間の棒を出すか（ゲームの仮定なので、見積モードでは出さない。D-115）。 */
  effort?: boolean;
  /**
   * 部品を選び直す（選んでいるカードの構成図の下のチップと、図の箱から。D-116）。整合（ゲームの validSetupChoices・
   * 見積の normalizeInput）は呼び出し側が持つ。省略は部品を選ばせない。
   */
  onComponentsChange?: (components: SetupChoices) => void;
  /** 部品のチップの注記（画面ごと。D-115）。 */
  partsNote?: ReactNode;
  /** 構成図の説明（選んでいるカードか）。 */
  diagramCaption?: (selected: boolean) => string;
}) {
  // 隠した構成（D-100）だけを外す。今のフレームワークを載せられない構成も出す（D-113）
  const groups = useMemo(
    () =>
      stackTabGroups(
        STACKS.filter((s) => !s.hidden).map((s) => s.index),
        framework,
      ),
    [framework],
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
      renderCard={(id, { selected, idPrefix }) => (
        <StackCard
          scenario={scenario}
          stackIndex={indexOf(id)}
          framework={fwOf(indexOf(id))}
          components={selected ? components : undefined}
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
          caption={diagramCaption(selected)}
          parts={
            selected && onComponentsChange
              ? { onChange: onComponentsChange, note: partsNote }
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
  return `${stackName(stackIndex, to, false)} には ${FRAMEWORKS[want].label} を載せる公式のアダプターが無いので、フレームワークを ${FRAMEWORKS[to].label} にした${
    routesReset ? '（選んだページの描き方は既定に戻した）' : ''
  }。`;
}
