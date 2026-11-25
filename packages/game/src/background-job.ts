// バックエンドの長時間の処理（D-239・prd/17 §6 の出来事 7・PR-9）。戦法の分析の更新・次の一手の問題の選び方の更新など、解析の結果を
// 変えない裏の処理を月をまたいで進める。純粋関数だけを置き、乱数は使わない（シードの乱数の消費を変えない）。
//
// どこで動かすか: 置き場によらずサーバー（端末は長時間の処理に向かない。P-5）。解析の置き場が worker の VPS なら worker の VPS、
// ほか（同じ実行環境・端末・併用）はアプリの実行環境（アプリの API の経路の最初の VPS。無ければサーバーレス）。
// - VPS: その月の空いている CPU（処理の力 − 普段の使用）の分だけ進む。追加の費用は 0。普段のリクエスト・解析より低い優先度で、
//   空いている分だけを使うので、普段の解析を滞留させない（前提・満足度の判定は今月の見積のまま）。
//   空いている CPU = vCPU × 使用率の上限 × 月の時間 × (1 − 月の平均の比)。月の平均の比 = ピークの比 ÷ ピークの係数（D-238 の滞留と同じ）。
// - サーバーレス（関数・コンテナ）: 上限まで並べて流せるので 1 か月で終わり、処理の CPU をその月にそのまま払う。費用は、処理の CPU を
//   アプリの API の呼び出しに均して足した見積と今月の見積の差（どの構成でも同じ数え方。小分けで流すとみなし、1 件の上限・呼び出しの
//   回数の課金は数えない）。無料のプランなどで、処理を足すと込み分・クレジットを超えて止まる（effect: block の込み分の前提が新しく
//   当たる）なら、その月は動かせない（進まず、費用も 0。理由を月の報告に出す）。
import { apiCallsPerMonth, HOURS_PER_MONTH } from 'estimator';
import { ANALYSIS_WORKER_NODE_ID, analysisMachine } from 'catalog';
import { estimate } from './core.ts';
import { toUsd } from './format.ts';
import type { MonthEstimate } from './month/bill.ts';
import type { BackgroundJobDef } from './scenario.ts';
import type { BackgroundJob, BackgroundJobRun, GameState } from './state.ts';
import type { ArchitectureInput, PriceBook, WorkloadInput } from 'estimator';

const MS_PER_HOUR = 3_600_000;

/** 長時間の処理を始める（翌月から進む。提案を受けたときの効果 background-job から呼ぶ）。 */
export function startBackgroundJob(
  state: GameState,
  job: BackgroundJobDef,
  eventId: string,
): GameState {
  return {
    ...state,
    backgroundJobs: [
      ...(state.backgroundJobs ?? []),
      {
        eventId,
        label: job.label,
        vcpuHours: job.vcpuHours,
        done: 0,
        onDone: job.onDone,
      },
    ],
  };
}

/** 長時間の処理を動かす VPS（ノードの id・vCPU・使用率の上限・ピークの比）。サーバーレスなら undefined。 */
export type BackgroundHost = {
  nodeId: string;
  vcpu: number;
  cpuUtilMax: number;
  peakRatio: number;
  peakHourFactor: number;
};

/**
 * 長時間の処理を動かす所: 解析の置き場が worker の VPS なら worker、ほかはアプリの API の経路の最初の VPS（無ければサーバーレス）。
 * 端末・併用もサーバーで動かす（端末は長時間の処理に向かない。P-5）。
 */
export function backgroundHostOf(
  r: Pick<MonthEstimate, 'simulation' | 'premises'>,
  placement: string | undefined,
): BackgroundHost | undefined {
  const a = r.simulation.architecture;
  const path = a.routes.api ?? a.routes['api-async'] ?? [];
  const id =
    analysisMachine(placement) !== undefined
      ? ANALYSIS_WORKER_NODE_ID
      : path.find(
          (n) => a.nodes.find((x) => x.id === n)?.config.kind === 'host',
        );
  const node = a.nodes.find((x) => x.id === id);
  if (!node || node.config.kind !== 'host') return undefined;
  const p = r.premises.find((x) => x.id === `host:cpu:${node.id}`);
  return {
    nodeId: node.id,
    vcpu: node.config.vcpu,
    cpuUtilMax: node.config.cpuUtilMax,
    peakRatio: p?.ratio ?? 0,
    peakHourFactor: r.simulation.workload.peakHourFactor,
  };
}

/** VPS のその月の空いている CPU（vCPU 時間）= vCPU × 使用率の上限 × 月の時間 × (1 − 月の平均の比)。0 未満は 0。 */
export const freeVcpuHoursOf = (h: BackgroundHost): number =>
  h.vcpu *
  h.cpuUtilMax *
  HOURS_PER_MONTH *
  Math.max(0, 1 - h.peakRatio / h.peakHourFactor);

/**
 * サーバーレスで処理の CPU（ms）を流したときの見積（処理の CPU をアプリの API の呼び出しに均して足す。前提は使わず、費用だけを見る）。
 * API の呼び出しが無い Workload では足せないので今の見積のまま（費用 0）。
 */
export function serverlessJobEstimate(input: {
  workload: WorkloadInput;
  architecture: ArchitectureInput;
  books: PriceBook[];
  r: MonthEstimate;
  cpuMs: number;
}): MonthEstimate {
  const { workload, r, cpuMs } = input;
  const calls = apiCallsPerMonth(
    workload,
    r.simulation.workload.monthlyPageViews,
  );
  if (!(calls > 0) || !(cpuMs > 0)) return r;
  return estimate({
    workload: {
      ...workload,
      api: { ...workload.api, cpuMs: workload.api.cpuMs + cpuMs / calls },
    },
    architecture: input.architecture,
    books: input.books,
  });
}

export type BackgroundJobsMonth = {
  /** 今月の費用に使う見積（サーバーレスで処理を流した月はその見積。ほかは今月の見積のまま）。 */
  billed: MonthEstimate;
  runs: BackgroundJobRun[];
  /** 来月も続く処理。 */
  remaining: BackgroundJob[];
  /** 今月で終わった処理（月の終わりに onDone を当てる）。 */
  finished: BackgroundJob[];
};

/** 今月の長時間の処理を進める（始めた順に、空いている CPU を割り当てる）。処理が無ければ何も変えない。 */
export function runBackgroundJobs(
  state: Pick<GameState, 'backgroundJobs'>,
  c: {
    r: MonthEstimate;
    workload: WorkloadInput;
    architecture: ArchitectureInput;
    books: PriceBook[];
    placement: string | undefined;
  },
): BackgroundJobsMonth {
  const jobs = state.backgroundJobs ?? [];
  if (!jobs.length)
    return { billed: c.r, runs: [], remaining: [], finished: [] };
  const host = backgroundHostOf(c.r, c.placement);
  const runs: BackgroundJobRun[] = [];
  const remaining: BackgroundJob[] = [];
  const finished: BackgroundJob[] = [];
  if (host) {
    const free = freeVcpuHoursOf(host);
    let left = free;
    for (const j of jobs) {
      const ran = Math.min(left, j.vcpuHours - j.done);
      left -= ran;
      const done = j.done + ran;
      const over = done >= j.vcpuHours;
      (over ? finished : remaining).push({ ...j, done });
      runs.push({
        eventId: j.eventId,
        label: j.label,
        where: 'vps',
        nodeId: host.nodeId,
        freeVcpuHours: free,
        ran,
        done,
        required: j.vcpuHours,
        finished: over,
        usd: 0,
      });
    }
    return { billed: c.r, runs, remaining, finished };
  }
  // サーバーレス: 残りを全部その月に流す。費用の差を処理の量で割り振る
  const rest = jobs.map((j) => j.vcpuHours - j.done);
  const total = rest.reduce((a, b) => a + b, 0);
  const withJob = serverlessJobEstimate({
    ...c,
    cpuMs: total * MS_PER_HOUR,
  });
  const blocked = newlyBlockingQuota(c.r, withJob);
  if (blocked) {
    for (const j of jobs) {
      remaining.push(j);
      runs.push({
        eventId: j.eventId,
        label: j.label,
        where: 'serverless',
        ran: 0,
        done: j.done,
        required: j.vcpuHours,
        finished: false,
        usd: 0,
        blockedBy: blocked.text,
      });
    }
    return { billed: c.r, runs, remaining, finished };
  }
  const billed = withJob;
  const usd = toUsd(billed.bill.totals) - toUsd(c.r.bill.totals);
  jobs.forEach((j, i) => {
    finished.push({ ...j, done: j.vcpuHours });
    runs.push({
      eventId: j.eventId,
      label: j.label,
      where: 'serverless',
      ran: rest[i]!,
      done: j.vcpuHours,
      required: j.vcpuHours,
      finished: true,
      usd: total > 0 ? (usd * rest[i]!) / total : 0,
    });
  });
  return { billed, runs, remaining, finished };
}

/**
 * 処理を足すと新しく当たって止まる込み分・クレジットの前提（無料のプランなど）。1 件の上限は数えない（小分けで流すとみなす）ので、
 * 込み分（pool:）とクレジット（credit:）の前提だけを見る。
 */
function newlyBlockingQuota(
  r: MonthEstimate,
  withJob: MonthEstimate,
): MonthEstimate['premises'][number] | undefined {
  const hit = new Set(r.premises.filter((p) => p.hit).map((p) => p.id));
  return withJob.premises.find(
    (p) =>
      p.hit &&
      p.effect === 'block' &&
      !hit.has(p.id) &&
      (p.id.startsWith('pool:') || p.id.startsWith('credit:')),
  );
}

/** 月の報告の注記（今月終わった処理・動かせなかった処理）。 */
export const backgroundJobNotes = (runs: readonly BackgroundJobRun[]) =>
  runs.flatMap((x) =>
    x.finished
      ? [
          `長時間の処理「${x.label}」が終わりました${x.where === 'serverless' ? `（サーバーレスで 1 か月で流し、追加の費用は約 $${Math.round(x.usd).toLocaleString()} です）` : '（VPS の空いている CPU で進めたので、追加の費用はかかっていません）'}`,
        ]
      : x.blockedBy
        ? [
            `長時間の処理「${x.label}」は、今のプランの込み分を超えて止まるので動かせません（${x.blockedBy}）`,
          ]
        : [],
  );
