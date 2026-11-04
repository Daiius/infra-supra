// playMonth の最後の段: 月の報告の組み立てと、ゲームの終わりの判定。
import {
  type Choices,
  componentsOf,
  FRAMEWORKS,
  type Platform,
  SLOT_LABELS,
  type SlotId,
} from 'catalog';
import { buzzLasting } from '../rules.ts';
import { lineLabel } from '../format.ts';
import type { Scenario } from '../scenario.ts';
import { INVALIDATION_METER } from '../setup/estimates.ts';
import { componentLabel, slotIneffective, stackName } from '../stacks.ts';
import type { Crossing, GameState, MonthEvent, MonthReport } from '../state.ts';
import type { Billed, MonthEstimate } from './bill.ts';
import type { Growth, Judged } from './judge.ts';
import type { Revenue } from './outcome.ts';
import { averageSatisfaction } from './satisfaction.ts';
import type { Traffic, Volume } from './traffic.ts';
import type { Progress } from './transitions.ts';

/**
 * その前提に効く部品の今月の値（「images:r2-variants」。推移を部品の差し替えで区切るのに使う。prd/07 §5）。
 * 効く slot は、その事業者で選べる部品のどれかが premiseRefs でこの前提を挙げている slot。無ければ undefined。
 */
export function premiseParts(
  platform: Platform,
  comps: Choices,
  premiseId: string,
): string | undefined {
  const slots = (Object.keys(SLOT_LABELS) as SlotId[]).filter((slot) =>
    componentsOf(platform, slot).some((o) =>
      o.premiseRefs.some((ref) => premiseId.startsWith(ref)),
    ),
  );
  return slots.length
    ? slots.map((slot) => `${slot}:${comps[slot] ?? ''}`).join(' ')
    : undefined;
}

/** 月の報告を組み立てる（今月の構成・設定は月の初めの状態で見せる）。 */
export function reportOf(
  state: GameState,
  c: {
    month: number;
    platform: Platform;
    traffic: Pick<Traffic, 'buzz' | 'buzzRule' | 'trafficNotes'>;
    volume: Pick<Volume, 'pv' | 'humanPV' | 'botPV' | 'basePV'>;
    revenue: Pick<Revenue, 'revenue' | 'contractRevenue' | 'status'>;
    bill: Billed;
    r: MonthEstimate;
    target: MonthEstimate | null;
    cash: number;
    notes: string[];
    events: MonthEvent[];
    crossings: Crossing[];
    policyWarning: boolean;
    ssrCpuMs: number;
    judged: Pick<Judged, 'stages' | 'comps'>;
    growth: Growth;
    effort: Progress['effort'];
    featurePoints: number;
  },
): MonthReport {
  const { month, r, target, effort, growth } = c;
  const { buzz, buzzRule } = c.traffic;
  const { fee, commitLines, commitUsd } = c.bill;
  const eligibleNow = c.bill.eligible;
  const platformNow = c.platform;
  const stackIndexNow = state.stackIndex;
  const comps: Choices = c.judged.comps;
  const swap = state.componentSwap;
  const rep = growth.rep;
  const slowPenalty = growth.slowPenalty;
  return {
    month,
    stackName: stackName(
      stackIndexNow,
      state.framework,
      true,
      state.components,
    ),
    buzz,
    ...(c.traffic.trafficNotes.length
      ? { trafficNote: c.traffic.trafficNotes.join('・') }
      : {}),
    pv: c.volume.pv,
    humanPV: c.volume.humanPV,
    botPV: c.volume.botPV,
    basePV: c.volume.basePV,
    revenue: c.revenue.revenue,
    infraCost: c.bill.infraCost,
    parallelInfraCost: c.bill.parallelInfraCost,
    cash: c.cash,
    status: c.revenue.status,
    notes: c.notes,
    events: c.events,
    crossings: c.crossings,
    policyWarning: c.policyWarning,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    snapshots: r.premises
      .filter(
        (p) =>
          p.kind === 'threshold' &&
          p.ratio !== undefined &&
          Number.isFinite(p.ratio),
      )
      .map((p) => {
        const parts = premiseParts(platformNow, comps, p.id);
        return {
          id: p.id,
          text: p.text,
          effect: p.effect,
          ratio: p.ratio!,
          hit: p.hit,
          accumulates: p.accumulates ?? false,
          ...(parts ? { parts } : {}),
        };
      }),
    lines: [
      ...[r, ...(target ? [target] : [])].flatMap((x) =>
        x.bill.lines
          .filter((l) => l.amount)
          .map((l) => ({
            label: lineLabel(l),
            provider: l.priceRef.provider,
            kind: l.kind,
            ...(l.priceRef.meterId ? { meterId: l.priceRef.meterId } : {}),
            amount: l.amount!,
            currency: l.currency,
            ...(l.priceRef.meterId === INVALIDATION_METER
              ? { quantity: l.quantity ?? 0 }
              : {}),
          })),
      ),
      ...(fee
        ? [
            {
              label: fee.label ?? `sakura-vps ${fee.name}（手数料・一度だけ）`,
              provider: 'sakura-vps',
              kind: 'fee' as const,
              amount: fee.amount,
              currency: 'JPY',
            },
          ]
        : []),
      ...commitLines.map((l) => ({
        label: l.label,
        provider: l.key.split(':')[0]!,
        kind: 'commitment' as const,
        amount: l.amount,
        currency: l.currency,
      })),
    ],
    unpricedLines: r.bill.unpricedLines + (target?.bill.unpricedLines ?? 0),
    settings: state.settings,
    ssrCpuMs: c.ssrCpuMs,
    stock: state.stock,
    seats: state.seats,
    satisfaction: {
      stages: c.judged.stages,
      reasons: growth.reasons,
      score: growth.score,
      reputation: rep,
      acquisition: growth.acquisition,
      churn: growth.churn,
      growth: buzz
        ? buzzLasting(rep, buzzRule) * (1 - slowPenalty) - 1
        : growth.net,
      ...(slowPenalty > 0 ? { slowPenalty } : {}),
    },
    effort,
    featurePoints: c.featurePoints,
    components: comps,
    componentSummary: (Object.keys(SLOT_LABELS) as SlotId[])
      .filter(
        (slot) =>
          componentsOf(platformNow, slot, state.framework).length > 1 &&
          !slotIneffective(slot, comps, {
            stackIndex: stackIndexNow,
            framework: state.framework,
          }),
      )
      .map(
        (slot) =>
          `${SLOT_LABELS[slot]}: ${componentLabel(platformNow, slot, comps[slot])}`,
      )
      .join('・'),
    contractRevenue: c.revenue.contractRevenue,
    ...(Object.keys(eligibleNow).length
      ? { commitmentEligible: eligibleNow }
      : {}),
    ...(commitLines.length ? { commitmentNet: -commitUsd } : {}),
    ...(swap
      ? {
          componentSwap: {
            label: `${SLOT_LABELS[swap.slot]}を ${componentLabel(platformNow, swap.slot, swap.option)} へ`,
            done: swap.done + effort.migration,
            required: swap.required,
          },
        }
      : {}),
    ...(state.migration
      ? {
          migration: {
            toName: stackName(state.migration.to, state.framework),
            done: state.migration.done + effort.migration,
            required: state.migration.required,
          },
        }
      : {}),
    ...(state.rewrite
      ? {
          rewrite: {
            toLabel: FRAMEWORKS[state.rewrite.to].label,
            done: state.rewrite.done + effort.migration,
            required: state.rewrite.required,
          },
        }
      : {}),
    framework: state.framework,
  };
}

/** ゲームの終わり（規約違反の停止 → 障害の月数 → 所持金 → 最後の月の目標の順に見る）。続くなら undefined。 */
export function endOf(
  sc: Scenario,
  month: number,
  s: {
    accountSuspended: boolean;
    outages: number;
    cash: number;
    history: readonly MonthReport[];
  },
): GameState['end'] {
  const { accountSuspended, outages, cash, history } = s;
  const finished = month >= sc.months;
  return accountSuspended
    ? { reason: 'policy', month }
    : outages > sc.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes(sc, { cash, outages, history }) ? 'won' : 'goal',
              month,
            }
          : undefined;
}

function passes(
  sc: Scenario,
  s: {
    cash: number;
    outages: number;
    history: readonly MonthReport[];
  },
): boolean {
  return (
    s.cash >= sc.goal.cash &&
    averageSatisfaction(s.history) >= sc.goal.satisfaction &&
    s.outages <= sc.goal.maxOutageMonths
  );
}
