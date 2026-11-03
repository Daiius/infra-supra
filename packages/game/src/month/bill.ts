// playMonth の見積の段: 今月の Workload と構成の見積（乗り換え中は乗り換え先も）と、インフラの費用（手数料・確約を含む）。
import type { Platform } from 'catalog';
import type { ArchitectureInput, PriceBook } from 'estimator';
import {
  commitmentEligible,
  commitmentLines,
  type CommitmentLine,
} from '../commitments.ts';
import { booksAt, estimate, USD_JPY } from '../core.ts';
import { nextSsrCpuMs } from '../effort.ts';
import { toUsd, usdOf } from '../format.ts';
import { COMMITMENTS } from '../offers.ts';
import type { Scenario } from '../scenario.ts';
import {
  componentsAfterMigration,
  STACKS,
  withoutDomainRegistration,
} from '../stacks.ts';
import type { GameState } from '../state.ts';
import {
  architectureFor,
  staticBuildOf,
  workloadFor,
  type WorkloadParts,
} from '../workload.ts';
import type { Volume } from './traffic.ts';

export type MonthEstimate = ReturnType<typeof estimate>;

export type Estimated = {
  ssrCpuMs: number;
  parts: WorkloadParts;
  architecture: ArchitectureInput;
  books: PriceBook[];
  /** 今の構成の見積。 */
  r: MonthEstimate;
  /** 乗り換え中の乗り換え先の見積（乗り換えていなければ null）。 */
  target: MonthEstimate | null;
};

/** 今月の Workload を組み、今の構成（と乗り換え中なら乗り換え先）を見積もる。 */
export function estimateMonth(
  sc: Scenario,
  state: GameState,
  month: number,
  platform: Platform,
  volume: Pick<Volume, 'pv' | 'spikes'>,
  peakFactor: number,
): Estimated {
  const stackIndexNow = state.stackIndex;
  const ssrCpuMs = nextSsrCpuMs(state);
  const spikes = volume.spikes;
  const parts: WorkloadParts = {
    pv: volume.pv,
    settings: state.settings,
    ssrCpuMs,
    mods: state.mods,
    stock: sc.stock ? state.stock : null,
    platform,
    components: state.components,
    framework: state.framework,
    routes: state.routes,
    legacyRouteDefaults: state.legacyRouteDefaults,
    routeParts: state.routeParts,
    ...(peakFactor !== 1 ? { peakFactor } : {}),
    ...(spikes.length ? { spikes } : {}),
  };
  const workload = workloadFor(sc, parts);
  const swap = state.componentSwap;
  const architecture = architectureFor(
    stackIndexNow,
    state.seats,
    state.framework,
    state.components,
    swap ? { [swap.slot]: swap.option } : {},
    state.storageOption,
    staticBuildOf(
      sc,
      stackIndexNow,
      state.framework,
      state.routes,
      state.legacyRouteDefaults,
    ),
  );
  const books = booksAt(state, month);
  const r = estimate({ workload, architecture, books });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）。乗り換え先は既定の部品（D-24 X-9）
  const target = state.migration
    ? (() => {
        const to = state.migration.to;
        const components = componentsAfterMigration(
          to,
          state.mods,
          state.framework,
          sc,
        );
        return estimate({
          workload: workloadFor(sc, {
            ...parts,
            platform: STACKS[to]!.provider,
            components,
          }),
          // 同じドメイン（.com 1 つ）の登録料は今の構成で払っているので、乗り換え先では数えない（D-96・OCL-A580D510）
          architecture: withoutDomainRegistration(
            architectureFor(
              to,
              state.seats,
              state.framework,
              components,
              {},
              false,
              staticBuildOf(
                sc,
                to,
                state.framework,
                state.routes,
                state.legacyRouteDefaults,
              ),
            ),
          ),
          books,
        });
      })()
    : null;
  return { ssrCpuMs, parts, architecture, books, r, target };
}

export type Billed = {
  parallelInfraCost: number;
  fee: GameState['storageOptionFeeDue'];
  eligible: ReturnType<typeof commitmentEligible>;
  commitLines: CommitmentLine[];
  commitUsd: number;
  infraCost: number;
};

/** 今月のインフラの費用（今の構成・乗り換え先・ストレージ変更の手数料・確約）。 */
export function billOf(
  state: GameState,
  month: number,
  r: MonthEstimate,
  target: MonthEstimate | null,
): Billed {
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  // ストレージ変更オプションの手数料（付けた次の月に一度だけ。D-30）
  // 申し込んだときのプランの金額を一度だけ払う（同じ月に上位へ変更しても変わらない）
  const fee = state.storageOptionFeeDue;
  const feeUsd = fee ? fee.amount / USD_JPY : 0;
  // 確約（D-97）: 今と乗り換え先の明細の対象の額に、結んだ確約を当てる（対象を使わなくなっても支払いは残る）
  const eligible = commitmentEligible(
    [...r.bill.lines, ...(target?.bill.lines ?? [])],
    COMMITMENTS,
  );
  const commitLines = commitmentLines(state.commitments ?? [], eligible, month);
  const commitUsd = commitLines.reduce(
    (a, l) => a + usdOf(l.amount, l.currency),
    0,
  );
  const infraCost =
    toUsd(r.bill.totals) + parallelInfraCost + feeUsd + commitUsd;
  return {
    parallelInfraCost,
    fee,
    eligible,
    commitLines,
    commitUsd,
    infraCost,
  };
}
