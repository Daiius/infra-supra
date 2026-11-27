// playMonth の出来事の段: 今月の報告に載せる出来事（起きた・予告・提案・前提の境目・料金の改定の予告）。
import type { PlatformPremise } from 'estimator';
import { eventDef, revisionText, SCHEDULED_CHANGES } from '../core.ts';
import { BOT_BLOCK } from '../actions/check.ts';
import {
  acceptEffort,
  acceptSummary,
  describeEffect,
  describeEffectBlocked,
  effectContextOf,
  effectTrend,
  premiseRefsOf,
} from '../events.ts';
import {
  REQUIREMENT_LABEL,
  requirementStatus,
  unavailableReason,
} from '../requirements.ts';
import { articleFamily } from '../routes/strategy.ts';
import type { EventDef, Scenario, Scheduled } from '../scenario.ts';
import {
  componentsAfterMigration,
  membersOf,
  realtimeSessionLines,
  slaOf,
} from '../stacks.ts';
import type { GameState, MonthEvent, MonthReport } from '../state.ts';
import type { Due } from './traffic.ts';
import {
  architectureFor,
  staticBuildOf,
  withAnalysisMachines,
} from '../workload.ts';

/**
 * 起きた出来事の本文。予告なしなら surpriseText、Bot を遮断済みなら遮断済みの文（D-28・2026-11-04）。
 * 遮断の判定は起きた今月の状態で、流量の計算（trafficOf）が上乗せを半分にする条件と同じ。
 * 文は報告（history）に入るので、後で遮断しても過去の月の文は変わらない。
 */
function occurredTextOf(
  def: EventDef,
  surprise: boolean,
  botBlocked: boolean,
): string {
  if (def.notice && surprise && def.surpriseText)
    return (botBlocked && def.blockedSurpriseText) || def.surpriseText;
  return (botBlocked && def.blockedText) || def.text;
}

/**
 * 今の構成のリアルタイムの部品を付ける提案（研究会）の、セッションの保ち方の文（D-241）。接続の長さは受けると入るリアルタイムの形
 * （Workload の realtime の minutesPerConnection）。部品を付けない出来事は空。
 */
function sessionLinesOf(def: EventDef, state: GameState): string[] {
  const effects = def.accept?.effects ?? [];
  if (!effects.some((e) => e.type === 'realtime-component')) return [];
  const minutes = effects.reduce(
    (a, e) =>
      e.type === 'workload' && e.mods.realtime?.minutesPerConnection
        ? e.mods.realtime.minutesPerConnection
        : a,
    0,
  );
  return minutes > 0
    ? realtimeSessionLines(state.stackIndex, state.scenario, minutes)
    : [];
}

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
  // 効果の説明の部品の名前は今の構成の部品で引く（D-241）
  const ctx = effectContextOf(state);
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
        effects: p.effects.map((e) => describeEffect(e, ctx)),
        effectTrends: p.effects.map(effectTrend),
        premises: [],
      });
      continue;
    }
    // 今の構成では受けられない提案は、返事を待たない知らせにする（断ったことになる。D-201）
    if (x.unavailable) {
      events.push({
        id: def.id,
        kind: def.kind,
        tier: def.tier,
        phase: 'occurred',
        title: def.title,
        text: `${def.text}。今の構成では受けられません: ${x.unavailable}`,
        effects: [],
        premises: premiseRefsOf(def, premises),
        unavailable: x.unavailable,
        ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
        ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      });
      continue;
    }
    // Bot の流量の効果を持つ出来事が、遮断済みの月に起きた（上乗せは半分。2026-11-04）
    const botBlocked =
      state.botBlocked &&
      def.kind !== 'proposal' &&
      (def.effects ?? []).some((e) => e.type === 'traffic' && e.bot);
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
      text: occurredTextOf(def, x.noticeMonth === undefined, state.botBlocked),
      // 遮断済みなら Bot の流量は実際の倍率（trafficOf と同じ式・同じ判定）
      effects: (def.effects ?? []).map((e) =>
        botBlocked
          ? describeEffectBlocked(e, BOT_BLOCK.remaining)
          : describeEffect(e, ctx),
      ),
      effectTrends: (def.effects ?? []).map(effectTrend),
      ...(botBlocked ? { botBlocked: true as const } : {}),
      premises: premiseRefsOf(def, premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...((lines) => (lines.length ? { session: lines } : {}))(
        sessionLinesOf(def, state),
      ),
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
              effects: def.accept.effects.map((e) => describeEffect(e, ctx)),
              effort: acceptEffort(def, state),
              ...((d) => (d ? { declineLoss: d } : {}))(
                acceptSummary(state, def).declineLoss,
              ),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    // 今の構成では受けられない提案の予告は、来ても受けられない見込みと添える（D-201）
    const unreachable =
      def.kind === 'proposal' && def.requires && unavailableReason(state, def)
        ? `。ただし今の事業者では「${REQUIREMENT_LABEL[def.requires]}」を選べないので、来ても受けられない見込みです`
        : '';
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.notice!.title,
      // 遮断の判定は予告を出した今月の状態（流量の計算で前兆を半分にするのと同じ条件）
      text:
        (state.botBlocked && def.notice!.blockedText
          ? def.notice!.blockedText
          : def.notice!.text) + unreachable,
      effects: [],
      // 前兆が Bot の予告を、遮断済みの月に出した（来たときの上乗せは半分）
      ...(state.botBlocked && def.notice!.bot
        ? { botBlocked: true as const }
        : {}),
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
  // 今の構成が課金に使う事業者: 選んだ部品・差し替え中の部品・描き方で足すノードも含め、明細と同じ組み立て（architectureFor）から取る。
  // 乗り換え中は乗り換え先も動かしているので含める（OCL-6294AD10）
  const swap = state.componentSwap;
  const routing0 = staticBuildOf(
    sc,
    stackIndexNow,
    state.framework,
    state.routes,
    state.legacyRouteDefaults,
  );
  const routing = withAnalysisMachines(
    routing0,
    state.settings,
    state.components.analysis,
  );
  const archs = [
    architectureFor(
      stackIndexNow,
      state.seats,
      state.framework,
      state.components,
      swap ? { [swap.slot]: swap.option } : {},
      state.storageOption,
      routing,
    ),
    ...(state.migration
      ? [
          architectureFor(
            state.migration.to,
            0,
            state.framework,
            componentsAfterMigration(
              state.migration.to,
              state.mods,
              state.framework,
              sc,
            ),
          ),
        ]
      : []),
  ];
  const used = new Set(
    archs.flatMap((a) =>
      a.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
    ),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    // 知らせるのは、計算を変える改定（改定後の料金を持つ）で、今の構成が使っている事業者のものだけ（D-226）。
    // 計算は知らせの有無によらず、起きた月から改定後の料金で行う（applyRevisions）
    if (c.revisedMeters.length === 0 || !used.has(c.provider)) continue;
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
