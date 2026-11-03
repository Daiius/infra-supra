// playMonth の結果の段: 偶発的な障害・当たった前提の分類・収益（止まった・遅い・契約）・規約違反の扱い。
import type { PlatformPremise } from 'estimator';
import { FLAT_PLAN_ADJUST, policyStep } from '../rules.ts';
import { nextRandom } from '../random.ts';
import { meetsRequirement, REQUIREMENT_LABEL } from '../requirements.ts';
import { articleFamily } from '../routes/strategy.ts';
import type { Scenario } from '../scenario.ts';
import { selfHostedOf, STACKS } from '../stacks.ts';
import type { GameState, MonthReport } from '../state.ts';

/** 自前運用のサーバーの偶発的な障害（乱数を 1 つ引く）。 */
export function incidentOf(
  sc: Scenario,
  state: GameState,
): { seed: number; incident: boolean; apiOnlyHost: boolean } {
  const stackIndexNow = state.stackIndex;
  const [rand, seed] = nextRandom(state.seed);
  // 自前運用のサーバーの偶発的な障害。部品で VPS を使うとき（VPS の API。D-67）も、そのホストがリクエストを受けていれば当たる
  const apiOnlyHost = !STACKS[stackIndexNow]!.selfHosted;
  const incident =
    selfHostedOf(stackIndexNow, state.components, state.framework, {}, true) &&
    rand < sc.incidents.selfHostedChancePerMonth;
  return { seed, incident, apiOnlyHost };
}

export type PremiseOutcomes = {
  blocking: PlatformPremise[];
  policy: PlatformPremise[];
  throttling: PlatformPremise[];
  adjusted: PlatformPremise[];
};

/** 当たった前提を、止まる・規約違反・遅くなる・性能が調整される（CDN の定額）に分ける。 */
export function premiseOutcomesOf(
  state: GameState,
  premises: readonly PlatformPremise[],
): PremiseOutcomes {
  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = premises.filter((p) => p.hit && p.effect === 'throttle');
  // CDN の定額のプランの込みを超えた前提（請求は増えない）。急増が大きいか、続けて超えると性能が調整される（D-61）
  const prevAdjust = new Set(
    (state.history[state.history.length - 1]?.premises ?? [])
      .filter((p) => p.hit && p.effect === 'adjust')
      .map((p) => p.id),
  );
  const adjusted = premises.filter(
    (p) =>
      p.hit &&
      p.effect === 'adjust' &&
      ((p.ratio ?? 0) > FLAT_PLAN_ADJUST.spikeRatio ||
        // 続けて超えた: 前の月も同じ前提で超えていた（sustainedMonths = 2 か月）
        prevAdjust.has(p.id)),
  );
  return { blocking, policy, throttling, adjusted };
}

export type Revenue = {
  revenue: number;
  contractRevenue: number;
  outages: number;
  status: MonthReport['status'];
  notes: string[];
};

/** 今月の収益（広告・固定・契約）と、止まった・遅くなった月の減り。 */
export function revenueOf(
  sc: Scenario,
  state: GameState,
  c: {
    humanPV: number;
    blocking: readonly PlatformPremise[];
    throttling: readonly PlatformPremise[];
    incident: boolean;
    apiOnlyHost: boolean;
  },
): Revenue {
  const stackIndexNow = state.stackIndex;
  const loss = sc.revenue.loss;
  let revenue =
    (sc.revenue.fixedUsdPerMonth ?? 0) +
    (c.humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (c.blocking.length) {
    revenue *= 1 - loss.block;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (c.incident) {
    revenue *= 1 - loss.incident;
    outages++;
    status = 'incident';
    notes.push(
      c.apiOnlyHost
        ? 'API の VPS の障害で数時間止まった（SLA なし・1 台構成。シェルは出るが中身が読めない）'
        : 'VPS の障害で数時間止まった（SLA なし・1 台構成）',
    );
  } else if (c.throttling.length) {
    revenue *= 1 - loss.throttle;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - loss.migration;
    notes.push('乗り換えの切り替えで収益が減った');
  }
  // 契約の収益（要件を満たす構成の月だけ。SLA の出来事・D-24）
  let contractRevenue = 0;
  for (const k of state.contracts) {
    if (
      meetsRequirement(
        stackIndexNow,
        k.requires,
        state.components,
        state.framework,
        articleFamily(state),
      )
    )
      contractRevenue += k.usdPerMonth;
    else
      notes.push(
        `契約の収益が入らなかった（${REQUIREMENT_LABEL[k.requires]}でない）`,
      );
  }
  revenue += contractRevenue;
  return { revenue, contractRevenue, outages, status, notes };
}

/** 規約違反: 最初の月は指摘（警告）、翌月も違反したままならアカウント停止（D-19）。 */
export function policyOf(
  state: GameState,
  month: number,
  policy: readonly PlatformPremise[],
): {
  policyWarnedMonth: GameState['policyWarnedMonth'];
  policyWarning: boolean;
  accountSuspended: boolean;
  notes: string[];
} {
  const notes: string[] = [];
  const ps = policyStep({
    warnedMonth: state.policyWarnedMonth,
    violating: policy.length > 0,
    migrating: state.migration !== null,
    month,
  });
  const policyWarnedMonth = ps.warnedMonth;
  const policyWarning = ps.outcome === 'warned';
  const accountSuspended = ps.outcome === 'suspended';
  if (ps.outcome === 'warned')
    notes.push(
      `運営元から指摘が来た（規約違反の警告: ${policy[0]!.text}）。来月も違反したままならアカウントが停止される`,
    );
  else if (ps.outcome === 'grace')
    notes.push('規約違反のまま乗り換えの作業中（猶予中）');
  else if (accountSuspended)
    notes.push('規約違反が続いたため、アカウントが停止された');
  return { policyWarnedMonth, policyWarning, accountSuspended, notes };
}
