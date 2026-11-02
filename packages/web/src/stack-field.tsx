// 始める画面のインフラの構成（D-105）。フレームワークの欄（D-102）と同じカルーセルで、カードに構成図を出す
// （選んだフレームワークと部品で描く。どんなアプリをどこに載せるのかを図で分かるように）。
// どれにも推奨・既定の印を付けない（D-41）。並びは今までの一覧の順（隠した構成は出さない。D-100）。
import {
  membersOf,
  pageWireframes,
  slaOf,
  stackFlavor,
  stackName,
  stackOffered,
  STACKS,
  type FrameworkId,
  type Scenario,
} from 'game';
import { useMemo } from 'react';
import { PlatformMarks } from './brand-logos.tsx';
import { ChoiceCarousel } from './choice-carousel.tsx';
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
  selected,
  noteId,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: Partial<Record<string, string>> | undefined;
  comments: number | undefined;
  selected: boolean;
  noteId: string;
}) {
  const name = stackName(stackIndex, framework, false);
  const pages = useMemo(
    () => pageWireframes(scenario, framework, comments),
    [scenario, framework, comments],
  );
  const arch = useMemo(
    () =>
      diagramArchitecture(scenario, stackIndex, framework, components ?? {}),
    [scenario, stackIndex, framework, components],
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

/** インフラの構成を選ぶ（カルーセル）。value は STACKS の index。 */
export function StackField({
  scenario,
  framework,
  value,
  onChange,
  components,
  comments,
}: {
  scenario: Scenario;
  framework: FrameworkId;
  value: number;
  onChange: (stackIndex: number) => void;
  /** 選んでいる構成の部品（選んでいる構成の図と手間に使う）。 */
  components: Partial<Record<string, string>>;
  /** コメントの描き方（流れの凡例のページの名前に使う。D-82）。 */
  comments?: number | undefined;
}) {
  const offered = STACKS.filter((s) => stackOffered(s.index, framework));
  const indexOf = (id: string) => STACKS.findIndex((s) => s.id === id);
  return (
    <ChoiceCarousel
      heading="インフラの構成"
      name="stack"
      noun="構成"
      items={offered.map((s) => s.id)}
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
          selected={selected}
          noteId={`${idPrefix}-${id}`}
        />
      )}
    />
  );
}
