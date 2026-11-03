// 始める画面のインフラの構成（D-105）。フレームワークの欄（D-102）と同じカルーセルで、カードに構成図を出す
// （選んだフレームワークと部品で描く。どんなアプリをどこに載せるのかを図で分かるように）。
// どれにも推奨・既定の印を付けない（D-41）。並びは今までの一覧の順（隠した構成は出さない。D-100）。
// タブは土台の事業者（課金のアカウント）ごとの枠にまとめ、プランをチップで出す（1 つだけの事業者は事業者の名前だけ。D-105 の補足）。
import {
  membersOf,
  pageWireframes,
  slaOf,
  stackFlavor,
  stackName,
  stackOffered,
  STACKS,
  validRouteOverrides,
  type FrameworkId,
  type RouteOverrides,
  type Scenario,
} from 'game';
import { useMemo } from 'react';
import { BRANDS, PLATFORM_BRANDS, PlatformMarks } from './brand-logos.tsx';
import { ChoiceCarousel, type ChoiceGroup } from './choice-carousel.tsx';
import { Info } from './info.tsx';
import { NameWithInfo } from './option-text.tsx';
import { EffortBar } from './scenario-briefing.tsx';
import { DIAGRAM_NOTE, SystemDiagram } from './system-diagram.tsx';
import { diagramArchitecture } from './system-diagram-model.ts';

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
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: Partial<Record<string, string>> | undefined;
  comments: number | undefined;
  /** 選んだページごとの描き方（図と流れの凡例に効く。D-107）。 */
  routes: RouteOverrides | undefined;
  selected: boolean;
  noteId: string;
  /** この構成にすると既定に戻る描き方の注意（選んでいないカードだけ。D-107 の補足）。 */
  routeNotice?: string | null | undefined;
}) {
  const name = stackName(stackIndex, framework, false);
  // この構成で選べない描き方は既定に戻して描く（構成図の staticBuildOf と同じ。D-107 の補足）
  const pages = useMemo(
    () =>
      pageWireframes(
        scenario,
        framework,
        comments,
        routes && validRouteOverrides(scenario, stackIndex, framework, routes),
        STACKS[stackIndex]!.provider,
      ),
    [scenario, stackIndex, framework, comments, routes],
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
        {!selected && routeNotice && (
          <p className="text-xs text-warning" role="note">
            {routeNotice}
          </p>
        )}
        <EffortBar
          scenario={scenario}
          stackIndex={stackIndex}
          // 選んでいる構成は、選んだ部品で増える他の事業者の管理も出す（D-52）
          {...(selected ? { components: components ?? {}, framework } : {})}
        />
        <SystemDiagram
          architecture={arch}
          pages={pages}
          caption={
            selected
              ? '部品を選ぶ前のスロットは既定の部品で描く。'
              : '既定の部品で描く。'
          }
        />
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
}) {
  const groups = useMemo(
    () =>
      stackTabGroups(
        STACKS.filter((s) => stackOffered(s.index, framework)).map(
          (s) => s.index,
        ),
        framework,
      ),
    [framework],
  );
  const indexOf = (id: string) => STACKS.findIndex((s) => s.id === id);
  return (
    <ChoiceCarousel
      heading="インフラの構成"
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
      renderCard={(id, { selected, idPrefix }) => (
        <StackCard
          scenario={scenario}
          stackIndex={indexOf(id)}
          framework={framework}
          components={selected ? components : undefined}
          comments={comments}
          routes={routes}
          selected={selected}
          noteId={`${idPrefix}-${id}`}
          routeNotice={selected ? null : routeNotice?.(indexOf(id))}
        />
      )}
    />
  );
}
