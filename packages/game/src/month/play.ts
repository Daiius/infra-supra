// 1 か月を進める（playMonth）。各段は同じフォルダの関数に分けてあり、ここでは順に呼んで次の月の状態を組む。
import { buzzLasting } from '../rules.ts';
import { eventDef, scenarioOf } from '../core.ts';
import type { GameState, MonthReport } from '../state.ts';
import { billOf, estimateMonth } from './bill.ts';
import { crossingsOf } from './crossings.ts';
import { growthOf, judgeMonth } from './judge.ts';
import { monthEventsOf } from './notices.ts';
import {
  incidentOf,
  policyOf,
  premiseOutcomesOf,
  revenueOf,
} from './outcome.ts';
import { endOf, reportOf } from './report.ts';
import {
  applyDueEffects,
  declineUnanswered,
  scriptOf,
  trafficOf,
  volumeOf,
} from './traffic.ts';
import { progressOf, stockOf, transitionsOf } from './transitions.ts';

/** 1 か月を進める（出来事 → 見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 在庫 → 終わりの判定）。 */
export function playMonth(input: GameState): GameState {
  if (input.phase !== 'playing') return input;
  const sc = scenarioOf(input);
  const month = input.history.length + 1;
  const prev = input.history[input.history.length - 1];

  // 出来事と流量（流量の倍率は台本の効果を当てる前の状態で見る）
  let state = declineUnanswered(input);
  const { platform, due, noticed } = scriptOf(sc, state, month);
  const traffic = trafficOf(sc, state, month, noticed);
  state = applyDueEffects(sc, state, due);
  const volume = volumeOf(state.basePV, traffic);
  const { buzz, buzzRule } = traffic;
  const { basePV, humanPV } = volume;

  // 見積と費用
  const { ssrCpuMs, parts, architecture, books, r, target } = estimateMonth(
    sc,
    state,
    month,
    platform,
    volume,
    traffic.peakFactor,
  );
  const bill = billOf(state, month, r, target);
  const { events, fired } = monthEventsOf(sc, state, {
    month,
    prev,
    premises: r.premises,
    due,
    noticed,
  });

  // 手間・障害・収益・規約違反
  const progress = progressOf(state);
  const { effort, featurePoints } = progress;
  const { seed, incident, apiOnlyHost } = incidentOf(sc, state);
  const { blocking, undelivered, policy, throttling, adjusted } =
    premiseOutcomesOf(state, r.premises);
  const revenue = revenueOf(sc, state, {
    humanPV,
    blocking,
    throttling,
    incident,
    apiOnlyHost,
  });
  const { outages } = revenue;
  const { policyWarnedMonth, policyWarning, accountSuspended, ...ps } =
    policyOf(state, month, policy);

  // 満足度と評判（prd/07 §9.1〜9.3）
  const judged = judgeMonth(sc, state, {
    month,
    platform,
    r,
    ssrCpuMs,
    featurePoints,
    blocking,
    undelivered,
    throttling,
    adjusted,
    incident,
  });
  const growth = growthOf(sc, state, {
    prev,
    stages: judged.stages,
    reasons: judged.reasons,
  });
  const { rep, slowPenalty, net } = growth;

  const cash = state.cash + revenue.revenue - bill.infraCost;

  // 前提が初めて境目を越えた月: 出来事を外して見積を引き直し、理由を確かめる（prd/07 §10.7）
  const crossings = crossingsOf(sc, {
    prev,
    premises: r.premises,
    parts,
    architecture,
    books,
    humanPV,
    basePV,
    trafficEvents: traffic.trafficEvents,
    state,
  });

  // 乗り換え・差し替え・作り直しが済んだら、次の月から切り替える
  const next = transitionsOf(sc, state, platform, progress);
  const { stock, coarseImages } = stockOf(sc, state, humanPV, judged.imgs);

  const report: MonthReport = reportOf(state, {
    month,
    platform,
    traffic,
    volume,
    revenue,
    bill,
    r,
    target,
    cash,
    notes: [...revenue.notes, ...ps.notes, ...judged.notes, ...next.notes],
    events,
    crossings,
    policyWarning,
    ssrCpuMs,
    judged,
    growth,
    effort,
    featurePoints,
  });

  // 今月届いた提案は、月の終わりに返事を待つ
  // 先に手を打っていた提案は知らせにしたので、返事を待たない（D-118）
  const proposals = due.filter(
    (x) => !x.preempted && eventDef(sc, x.id)!.kind === 'proposal',
  );

  const history = [...state.history, report];
  const end = endOf(sc, month, { accountSuspended, outages, cash, history });
  const { routes } = next;
  const { routes: _routes, ...base } = state;
  return {
    ...base,
    ...(routes !== undefined ? { routes } : {}),
    seed,
    stackIndex: next.stackIndex,
    framework: next.framework,
    rewrite: next.rewrite,
    settings: next.settings,
    components: next.components,
    componentSwap: next.componentSwap,
    mods: next.mods,
    storageOption: next.storageOption,
    storageOptionFeeDue: null,
    cash,
    outages,
    featurePoints,
    migration: next.migration,
    switching: next.switching,
    plannedEffort: 0,
    policyWarnedMonth,
    stock,
    ...(coarseImages > 0 ? { coarseImages } : {}),
    fired,
    pendingProposals: end ? [] : proposals.map((x) => x.id),
    interrupts: state.interrupts
      .map((i) => ({ ...i, months: i.months - 1 }))
      .filter((i) => i.months > 0),
    growthBonus: state.growthBonus
      .map((b) => ({ ...b, months: b.months - 1 }))
      .filter((b) => b.months > 0),
    basePV: buzz
      ? basePV * buzzLasting(rep, buzzRule) * (1 - slowPenalty)
      : basePV * (1 + net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

/** 今月見込みを出さない理由（一時的に流量が増えた月。プレイヤーにも見えている出来事。prd/07 §10.7）。 */
export function projectionNote(r: MonthReport): string | undefined {
  if (r.buzz)
    return '話題になった月の伸びは続かないかもしれないので、今月は見込みを出さない';
  if (r.trafficNote)
    return `一時的に流量が増えた月（${r.trafficNote}）なので、今月は見込みを出さない`;
  return undefined;
}
