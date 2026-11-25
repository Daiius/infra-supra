// 満足度の要素「解析の速さ」「解析の正確さ」（D-238・prd/17 §5.5・KF-10）。解析のあるシナリオ（SatisfactionRules.analysis と
// Scenario.analysisJob を持つ）だけで判定する。純粋関数だけを置き、値（境目・倍率）はシナリオのデータ（ゲーム上の仮定）。
//
// 速さ = 1 局の解析が見えるまでの時間（秒）。前提 P-4「利用者がページを開いている間に終わってほしい」が境目。
// - サーバー（同じ実行環境・worker の VPS・台で借りるマシン・Fargate・併用の詳細解析）: 1 件の時間（固定の重さ + 局面の数 × 1 局面 + 待ち）
//   × 順に解く回数。CPU の分は実行先の 1 vCPU の速さの倍率（D-247。仮定）で割る。
//   局面ごとは 1 局の件数を並べて動かせる（サーバーレスは全部、VPS は vCPU の数まで）。1 局まとめては 1 件、小分けは塊を順に解く。
// - ピークの滞留（B-5）: 解析する VPS のピークの比が 1 を超えたら、(比 − 1) × stallWindowSec を待ちに足す。月の平均の比も 1 以上なら、
//   1 日を通して追いつかないので「悪い」。サーバーレス（関数・コンテナ）は滞留しない（1 件の上限に当たって止まるのは可用性の判定のまま）。
// - 利用者の端末: 局面の数 × 1 局面 × 端末の倍率（1 件ごとの起動はページを開いたときの 1 回なので数えない）。遅い端末の段階が下がるなら 1 段下げる。
// - 併用: 端末の簡易解析とサーバーの詳細解析の早いほう。詳細解析が「悪い」（利用者が離れた後に届く）なら、正確さを 1 段下げる。
// 正確さ = 候補の数（B-7: 候補の数はここにだけ効かせる）。端末の評価関数と読みの量では下げない（D-244: 悪手を見つける用途では
// サーバーとの差が揺らぎの範囲に収まるとみる。端末は候補が 1 つなので「普通」）。
import {
  ANALYSIS_WORKER_NODE_ID,
  analysisCpuSpeed,
  analysisFnTarget,
  analysisMachine,
  analysisTaskTarget,
  browserAnalyzes,
  serverAnalyzes,
  jobsPerBatch,
  type AnalysisJobShape,
  type AnalysisSettings,
} from 'catalog';
import type { MonthEstimate } from './month/bill.ts';
import { STAGE_DOWN, STAGE_VALUE, type Stage } from './rules.ts';
import type { AnalysisSatisfactionRules } from './scenario.ts';

/** 解析する VPS のピークの時間帯の CPU（滞留の判定に使う）。 */
export type AnalysisHost = {
  nodeId: string;
  vcpu: number;
  /** ピークの時間帯の CPU の比（需要 ÷ vCPU × 使用率の上限。前提 host:cpu の ratio）。 */
  peakRatio: number;
  /** ピークの係数（月の平均の到着率に対するピークの時間帯の倍率）。 */
  peakHourFactor: number;
};

export type AnalysisJudgment = {
  analysisSpeed: Stage;
  analysisAccuracy: Stage;
  /** サーバーで 1 局が見えるまで（秒。待ちを含む。サーバーが解析しなければ undefined）。 */
  serverSec?: number;
  /** そのうちピークの滞留の待ち（秒）。 */
  waitSec?: number;
  /** 1 日を通しても追いつかない（月の平均の比も 1 以上）。 */
  backlog?: boolean;
  /** 解析する VPS（滞留しうる置き場だけ）。 */
  host?: AnalysisHost;
  /** 端末で 1 局が見えるまで（秒。ふつうの端末・遅い端末。端末が解析しなければ undefined）。 */
  clientSec?: number;
  clientSlowSec?: number;
  /** 判定に使った見えるまでの時間（秒）。backlog なら Infinity。 */
  visibleSec: number;
  /** 詳細解析が利用者の離れた後に届くので正確さを下げた（併用）。 */
  lateAccurate?: boolean;
  /** 正確さの判定に使った候補の数。 */
  candidates: number;
};

const stageOfSec = (sec: number, r: AnalysisSatisfactionRules): Stage =>
  sec <= r.speed.goodSec ? 'good' : sec <= r.speed.fairSec ? 'fair' : 'bad';

const better = (a: Stage, b: Stage): Stage =>
  STAGE_VALUE[a] >= STAGE_VALUE[b] ? a : b;

/**
 * 1 件の解析の壁時計（ms）: 固定の重さ（CPU・読み込みの待ち）+ 局面の数 × 1 局面 + DB の待ち。cpuSpeed は実行先の 1 vCPU の速さの
 * 倍率（今の値の基準 = 1。catalog の analysisCpuSpeed。D-247）で、CPU の分だけを割る。
 */
export function analysisJobWallMs(
  shape: AnalysisJobShape,
  unit: AnalysisSettings['unit'],
  cpuSpeed = 1,
): number {
  const items = shape.itemsPerBatch / jobsPerBatch(shape, unit);
  return (
    (shape.startupCpuMs + items * shape.itemCpuMs) / cpuSpeed +
    shape.startupIoMs +
    shape.ioWaitMs
  );
}

/**
 * サーバーで 1 局を解析し終えるまでの秒（待ちを含まない）。局面ごとの件数は並べて動かせる（lanes まで。サーバーレスは Infinity）。
 * 1 局まとめては 1 件、小分けは続きから順に解くので並べない。
 */
export function serverRunSec(
  shape: AnalysisJobShape,
  unit: AnalysisSettings['unit'],
  lanes: number,
  cpuSpeed = 1,
): number {
  const jobs = jobsPerBatch(shape, unit);
  const parallel = unit === 'position' ? Math.min(jobs, lanes) : 1;
  return ((jobs / parallel) * analysisJobWallMs(shape, unit, cpuSpeed)) / 1000;
}

/** ピークの滞留の待ち（秒）と、1 日を通しても追いつかないか（B-5 の仮定の式）。 */
export function stallOf(
  host: Pick<AnalysisHost, 'peakRatio' | 'peakHourFactor'>,
  r: AnalysisSatisfactionRules,
): { waitSec: number; backlog: boolean } {
  const over = host.peakRatio - 1;
  return {
    waitSec: over > 0 ? over * r.stallWindowSec : 0,
    backlog: host.peakRatio / host.peakHourFactor >= 1,
  };
}

/** 解析の速さ・正確さを判定する（置き場・区切り方・候補の数・解析する VPS のピーク）。 */
export function judgeAnalysis(input: {
  rules: AnalysisSatisfactionRules;
  shape: AnalysisJobShape;
  settings: AnalysisSettings;
  /** 解析の置き場の部品（省略は同じ実行環境）。 */
  placement: string | undefined;
  /** サーバーの解析が VPS で動くとき、その VPS（サーバーレスなら undefined）。 */
  host?: AnalysisHost | undefined;
}): AnalysisJudgment {
  const { rules: r, shape, settings, placement, host } = input;
  const onClient = browserAnalyzes(placement);
  const onServer = serverAnalyzes(placement);
  const out: Partial<AnalysisJudgment> = {};
  let speed: Stage | undefined;
  let server: Stage | undefined;
  if (onServer) {
    const run = serverRunSec(
      shape,
      settings.unit,
      host?.vcpu ?? Infinity,
      analysisCpuSpeed(placement),
    );
    const stall = host ? stallOf(host, r) : { waitSec: 0, backlog: false };
    out.serverSec = run + stall.waitSec;
    out.waitSec = stall.waitSec;
    if (host) out.host = host;
    if (stall.backlog) out.backlog = true;
    server = stall.backlog ? 'bad' : stageOfSec(out.serverSec, r);
    speed = server;
  }
  if (onClient) {
    const typical =
      (shape.itemsPerBatch * shape.itemCpuMs * r.client.cpuFactor) / 1000;
    const slow = typical * r.client.slowDeviceFactor;
    out.clientSec = typical;
    out.clientSlowSec = slow;
    const base = stageOfSec(typical, r);
    const client =
      STAGE_VALUE[stageOfSec(slow, r)] < STAGE_VALUE[base]
        ? STAGE_DOWN[base]
        : base;
    speed = speed === undefined ? client : better(speed, client);
  }
  const visibleSec = Math.min(
    onServer ? (out.backlog ? Infinity : out.serverSec!) : Infinity,
    onClient ? out.clientSec! : Infinity,
  );
  // 正確さ: 候補の数（端末は 1 つに固定なので「普通」。KF-08・D-244）。併用は詳細解析で候補が戻るが、詳細解析が「悪い」
  // （利用者が離れた後に届く）なら 1 段下げる。詳細解析が希望した棋譜だけなら、利用者が待つつもりで頼むので下げない（D-246）
  const byCandidates: Stage =
    settings.candidates >= r.accuracy.goodCandidates ? 'good' : 'fair';
  const lateAccurate =
    onClient && onServer && server === 'bad' && settings.scope !== 'requested';
  const accuracy = lateAccurate ? STAGE_DOWN[byCandidates] : byCandidates;
  return {
    ...out,
    ...(lateAccurate ? { lateAccurate } : {}),
    analysisSpeed: speed!,
    analysisAccuracy: accuracy,
    visibleSec,
    candidates: settings.candidates,
  };
}

/** 解析の CPU を担う VPS のノード（worker の置き場なら worker。ほかは解析の経路の最初の VPS）と、そのピークの比。 */
export function analysisHostOf(
  r: Pick<MonthEstimate, 'simulation' | 'premises'>,
  placement: string | undefined,
): AnalysisHost | undefined {
  // 端末だけ・別の事業者のサーバーレス（D-245）・Fargate（増やし減らす。D-247）は滞留しない（経路の後ろのアプリの VPS は結果を受けて書くだけ）
  if (
    !serverAnalyzes(placement) ||
    analysisFnTarget(placement) !== undefined ||
    analysisTaskTarget(placement) !== undefined
  )
    return undefined;
  const a = r.simulation.architecture;
  const path = a.routes['api-async'] ?? a.routes.api ?? [];
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
    peakRatio: p?.ratio ?? 0,
    peakHourFactor: r.simulation.workload.peakHourFactor,
  };
}

const sec = (s: number) =>
  s < 90 ? `約 ${Math.round(s)} 秒` : `約 ${Math.round(s / 60)} 分`;

/** 解析の要素の理由（「良い」でないときだけ。画面の文。です・ます調）。 */
export function analysisReasons(
  j: AnalysisJudgment,
  r: AnalysisSatisfactionRules,
): { analysisSpeed?: string; analysisAccuracy?: string } {
  const out: { analysisSpeed?: string; analysisAccuracy?: string } = {};
  const open = `ページを開いている間（${sec(r.speed.goodSec)}）`;
  if (j.analysisSpeed !== 'good') {
    const parts: string[] = [];
    if (j.serverSec !== undefined) {
      if (j.backlog)
        parts.push(
          'サーバーの解析が 1 日を通しても追いつかず、たまり続けます（解析する VPS の CPU が足りません）',
        );
      else
        parts.push(
          `サーバーで 1 局の解析が見えるまで ${sec(j.serverSec)}` +
            (j.waitSec
              ? `（うちピークの時間帯の滞留の待ち ${sec(j.waitSec)}。ピークの時間帯の解析の需要が VPS の処理の力の約 ${j.host!.peakRatio.toFixed(1)} 倍です）`
              : ''),
        );
    }
    if (j.clientSec !== undefined)
      parts.push(
        `端末で 1 局の解析が見えるまで ${sec(j.clientSec)}（遅い端末では ${sec(j.clientSlowSec!)}）`,
      );
    // ふつうの端末では間に合い、遅い端末の差だけで下がった月は「遅い端末では」と書く
    const slowOnly = j.visibleSec <= r.speed.goodSec;
    out.analysisSpeed = `${parts.join('・')}。${slowOnly ? '遅い端末では' : ''}${open}に終わりません`;
  }
  if (j.analysisAccuracy !== 'good')
    out.analysisAccuracy = [
      j.lateAccurate &&
        '端末の簡易解析は出ますが、サーバーの詳細解析が届くのは利用者がページを離れた後です',
      j.candidates < r.accuracy.goodCandidates &&
        `1 局面に残す候補が ${j.candidates} つで、ほかの手との比べ方が見えにくくなります`,
    ]
      .filter(Boolean)
      .join('。');
  return out;
}

/**
 * 解析の worker の VPS だけの遅くなる前提（CPU・回線）。ページの速さ・収益の減りには数えず、解析の速さ（滞留）でだけ扱う
 * （worker が混んでもページは遅くならない。D-238）。止まる前提（メモリ・ディスク）は今までどおり可用性。
 */
export const analysisOnlyThrottle = (p: {
  effect: string;
  nodeIds: readonly string[];
}): boolean =>
  p.effect === 'throttle' &&
  p.nodeIds.length > 0 &&
  p.nodeIds.every((id) => id === ANALYSIS_WORKER_NODE_ID);
