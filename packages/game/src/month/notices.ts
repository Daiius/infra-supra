// playMonth の出来事の段: 今月の報告に載せる出来事（起きた・予告・提案・前提の境目・料金の改定の予告）。
import { MVP_STACKS } from 'catalog';
import type { PlatformPremise } from 'estimator';
import { eventDef, revisionText, SCHEDULED_CHANGES } from '../core.ts';
import { acceptEffort, describeEffect, premiseRefsOf } from '../events.ts';
import { requirementStatus, unavailableReason } from '../requirements.ts';
import { articleFamily } from '../routes/strategy.ts';
import type { Scenario, Scheduled } from '../scenario.ts';
import { membersOf, slaOf } from '../stacks.ts';
import type { GameState, MonthEvent, MonthReport } from '../state.ts';
import type { Due } from './traffic.ts';

/**
 * 今月の出来事の通知を並べる（台本の起きた・予告 → 前提の境目を越えた → 料金の改定の予告の順）。
 * 前提で起きる出来事は一度だけなので、起きた出来事を足した fired も返す。
 */
export function monthEventsOf(
  sc: Scenario,
  state: GameState,
  c: {
    month: number;
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    due: readonly Due[];
    noticed: readonly Scheduled[];
  },
): { events: MonthEvent[]; fired: GameState['fired'] } {
  const { month, prev, premises, due, noticed } = c;
  const stackIndexNow = state.stackIndex;
  const events: MonthEvent[] = [];
  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    // 先に手を打っていた提案は、苦情の代わりに知らせを出す（受ける・断るは無い。D-118）
    if (x.preempted) {
      const p = def.preempted!;
      events.push({
        id: def.id,
        kind: def.kind,
        tier: def.tier,
        phase: 'occurred',
        title: p.title,
        text: p.text,
        effects: p.effects.map(describeEffect),
        premises: [],
      });
      continue;
    }
    // 予告を持ちうる台本は、予告どおり起きたか、予告なしで起きたか（D-28）
    const announced =
      def.notice && def.kind !== 'proposal'
        ? { announced: x.noticeMonth !== undefined }
        : {};
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      ...announced,
      title: def.title,
      text:
        def.notice && x.noticeMonth === undefined && def.surpriseText
          ? def.surpriseText
          : def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...(def.previewRequirement
        ? {
            requirementStatus: requirementStatus(
              stackIndexNow,
              state.components,
              def.previewRequirement,
              state.framework,
              articleFamily(state),
            ),
          }
        : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def, state),
              ...(unavailableReason(state, def)
                ? { unavailable: unavailableReason(state, def)! }
                : {}),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.notice!.title,
      text: def.notice!.text,
      effects: [],
      premises: premiseRefsOf(def, premises),
    });
  }
  // 状態で起きる出来事（前提の使用率が境目を越えた。一度だけ）
  let fired = state.fired;
  for (const def of sc.events) {
    if (def.when.type !== 'premise' || fired.includes(def.id)) continue;
    const w = def.when;
    // 前の月は境目より下で、今月越えた前提（1 か月目から越えているものは「近づいた」と呼ばない）
    const p = premises.find(
      (q) =>
        w.premiseIds.some((id) => q.id.startsWith(id)) &&
        (q.ratio ?? 0) >= w.atLeast &&
        (prev?.snapshots.find((x) => x.id === q.id)?.ratio ?? Infinity) <
          w.atLeast,
    );
    if (!p) continue;
    fired = [...fired, def.id];
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'occurred',
      title: def.title,
      text: def.text,
      effects: [],
      premises: premiseRefsOf(
        { premiseRefs: w.premiseIds },
        premises.filter((q) => (q.ratio ?? 0) >= w.atLeast),
      ),
    });
  }
  // 実際に予告されている改定（始めた日が施行日より前のものだけ。D-21）
  const stack = MVP_STACKS[stackIndexNow]!;
  const used = new Set(
    stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    events.push({
      id: c.id,
      kind: 'script',
      tier: 'common',
      phase: 'occurred',
      title: `${c.kind === 'pricing' ? '料金' : c.kind === 'limit' ? '制限' : '提供条件'}の改定が予告された（${c.provider}・施行日 ${c.effectiveFrom}）`,
      text: revisionText(c, used.has(c.provider)),
      effects: [],
      premises: [],
    });
  }
  return { events, fired };
}
