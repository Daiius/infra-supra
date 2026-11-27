// 棋譜解析のシナリオ（prd/17 PR-10・D-241）: 登録と開発中の印・出来事が起きる時期と受けたときの効果・決定論・保存と再生・
// 規模と費用の算術（2026-11-24 の決め直し。KF-16 の遊びの意図は捨てた）と、参照値・基準プレイ（golden）。
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_FN_NODE_ID,
  type Choices,
  composeStack,
  KIFU_ANALYSIS_JOB,
  KIFU_GAMES_PER_MAU,
  KIFU_MOVES_PER_GAME,
  KIFU_PV_PER_MAU,
  kifuAnalysis,
  loadPriceBooks,
  stackDef,
} from 'catalog';
import { estimate, resolveWorkload } from 'estimator';
import {
  applyActions,
  DEFAULT_START_DATE,
  estimateComponents,
  estimateWorkload,
  isPreviewScenario,
  listedScenarios,
  newGame,
  newSave,
  parseSave,
  playMonth,
  playStrategy,
  replaySave,
  rollSchedule,
  SCENARIOS,
  STACKS,
  withTurn,
  type Action,
  type FrameworkId,
  type GameState,
  type SaveData,
  type Scenario,
} from './index.ts';
import { analysisJobWallMs } from './analysis-satisfaction.ts';
import { KIFU_BACKGROUND_JOBS } from './scenarios/kifu-analysis.ts';

const K = SCENARIOS['kifu-analysis']!;
/**
 * 出来事の効果（仕組み）を見るための小さい規模（月 4,000 局。D-242 のときの普段の月）で、所持金で終わらないようにしたもの。
 * シナリオの規模（12 万 PV・月 9 万局）では、CF Paid はどの置き場でも 1 か月目から D1 の 10 GB に当たって止まり続け
 * （3 か月目に止まった月の上限で終わる）、サーバーレスの「同じ実行環境」は 1 か月目に所持金が尽き、アプリの VPS は解析で CPU が
 * 埋まって裏の処理が進まないので、3 か月目より後の提案・大きな対局イベントまで届かない。出来事の時期はシードだけで決まる
 * （規模によらない）ので、seedFor は K のままでよい。
 */
const SMALL = {
  ...K,
  startCash: 1e9,
  scale: {
    ...K.scale,
    startPV: (4_000 / KIFU_GAMES_PER_MAU) * KIFU_PV_PER_MAU,
  },
};
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VISIBLE = STACKS.filter(
  (s) => s.provider !== 'netlify' && s.provider !== 'aws-opennext',
);
const PLACEMENTS = [
  'same',
  'client',
  'hybrid',
  'worker-vps-2gb',
  'worker-vps-4gb',
] as const;

/** その出来事が起きるシード（1 から順に探す）と月。 */
function seedFor(id: string): { seed: number; month: number } {
  for (let seed = 1; seed <= 500; seed++) {
    const x = rollSchedule(K, seed).find((e) => e.id === id);
    if (x) return { seed, month: x.month };
  }
  throw new Error(`起きるシードが無い: ${id}`);
}

/** 提案が届いた月の終わりまで遊ぶ（ほかの提案は断る）。 */
function untilProposal(
  id: string,
  stackIndex: number,
  opts: { framework?: FrameworkId; components?: Choices } = {},
  sc: Scenario = SMALL,
): GameState {
  const { seed, month } = seedFor(id);
  let s = playMonth(
    newGame(
      stackIndex,
      seed,
      sc,
      DEFAULT_START_DATE,
      opts.framework,
      opts.components,
    ),
  );
  while (s.history.length < month && s.phase === 'playing') s = playMonth(s);
  expect(s.pendingProposals, id).toContain(id);
  return s;
}

const answer = (s: GameState, id: string, accept: boolean): GameState =>
  applyActions(s, [{ type: 'respond', eventId: id, accept }]);

describe('登録と開発中の印', () => {
  it('SCENARIOS に登録され、開発中の印が付く（?preview=1 のときだけ並ぶ）', () => {
    expect(K.preview).toBe(true);
    expect(isPreviewScenario(K.id)).toBe(true);
    expect(listedScenarios(false).map((s) => s.id)).not.toContain(K.id);
    expect(listedScenarios(true).map((s) => s.id)).toContain(K.id);
  });

  it('始める画面の出来事の説明は、台本・提案のすべてに触れる', () => {
    const about = new Set(K.text!.events.flatMap((l) => l.about));
    for (const e of K.events)
      if (e.kind !== 'state') expect(about.has(e.id), e.id).toBe(true);
  });

  it('Bot と完了のメールの出来事は入れない（prd/17 §6.2）', () => {
    expect(K.events.some((e) => e.id.includes('bot'))).toBe(false);
    expect(K.hidden?.blockBots).toBe(true);
    expect(K.template(30_000).email).toBeUndefined();
  });
});

describe('出来事の時期', () => {
  it('1〜2 か月目は台本・提案も予告も出さない（D-20 V-12）', () => {
    for (let seed = 1; seed <= 300; seed++)
      for (const x of rollSchedule(K, seed)) {
        expect(x.month).toBeGreaterThanOrEqual(3);
        if (x.noticeMonth !== undefined)
          expect(x.noticeMonth).toBeGreaterThanOrEqual(3);
      }
  });

  it('大きな対局イベントは毎回 5〜10 か月目に起き、前の月に予告が出る', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const x = rollSchedule(K, seed).find((e) => e.id === 'k-tournament')!;
      expect(x.month).toBeGreaterThanOrEqual(5);
      expect(x.month).toBeLessThanOrEqual(10);
      expect(x.noticeMonth).toBe(x.month - 1);
    }
  });

  it('大きな対局イベントの月は閲覧と解析が増え、費用が上がる（一部の利用者が残る）', () => {
    const { seed, month } = seedFor('k-tournament');
    let s = playMonth(newGame(idx('cloudflare-vinext-paid'), seed, SMALL));
    while (s.history.length < month && s.phase === 'playing') s = playMonth(s);
    const h = s.history;
    expect(h[month - 2]!.events.map((e) => `${e.id}:${e.phase}`)).toContain(
      'k-tournament:notice',
    );
    expect(h[month - 1]!.events.map((e) => `${e.id}:${e.phase}`)).toContain(
      'k-tournament:occurred',
    );
    expect(h[month - 1]!.infraCost).toBeGreaterThan(
      h[month - 2]!.infraCost * 1.5,
    );
  });
});

describe('提案を受けたときの効果', () => {
  it('過去の棋譜の取り込み: 翌月だけ解析と DB の増え方が 3 倍（端末の置き場はサーバーの解析が増えない）', () => {
    const run = (analysis: string, accept: boolean) => {
      const s = untilProposal('k-p-import', idx('cloudflare-vinext-paid'), {
        components: { analysis },
      });
      const before = s.stock.dbGB;
      const next = playMonth(answer(s, 'k-p-import', accept));
      const after = playMonth(next);
      return {
        grew: next.stock.dbGB - before,
        cost: next.history[next.history.length - 1]!,
        bursts: next.analysisBursts,
        later: after.analysisBursts,
      };
    };
    const on = run('same', true);
    const off = run('same', false);
    expect(on.grew / off.grew).toBeGreaterThan(2.5);
    expect(on.cost.infraCost).toBeGreaterThan(off.cost.infraCost * 1.5);
    expect(on.cost.notes.join('\n')).toContain('過去の棋譜の取り込み');
    // 上乗せは 1 か月で外れる（受けていないゲームは持たない）
    expect(on.bursts).toBeUndefined();
    expect(on.later).toBeUndefined();
    expect(off.bursts).toBeUndefined();
    // 端末の置き場: 在庫は増えるが、サーバーの解析（費用）は増えない
    const cOn = run('client', true);
    const cOff = run('client', false);
    expect(cOn.grew / cOff.grew).toBeGreaterThan(2.5);
    expect(cOn.cost.infraCost).toBeCloseTo(cOff.cost.infraCost, 1);
    expect(cOn.cost.notes.join('\n')).toContain('サーバーの解析は増えません');
  });

  it('画像付きのカードで共有: 成長の上乗せは、カードが出ない構成（SPA で前処理なし）では半分', () => {
    const bonus = (framework: FrameworkId, components?: Choices) => {
      const s = untilProposal('k-p-share-ogp', idx('cloudflare-vinext-paid'), {
        framework,
        ...(components ? { components } : {}),
      });
      return answer(s, 'k-p-share-ogp', true).growthBonus.at(-1)!.add;
    };
    expect(bonus('nextjs')).toBeCloseTo(0.03, 9);
    expect(bonus('vite-spa')).toBeCloseTo(0.015, 9);
    expect(bonus('vite-spa', { ogp: 'prerender' })).toBeCloseTo(0.03, 9);
  });

  it('裏の長い処理: 受けると翌月から進み、VPS は追加の費用なしで進む', () => {
    for (const id of ['k-p-strategy', 'k-p-problems'] as const) {
      const s = untilProposal(id, idx('sakura-vps-2gb'));
      const t = answer(s, id, true);
      const job =
        id === 'k-p-strategy'
          ? KIFU_BACKGROUND_JOBS.strategy
          : KIFU_BACKGROUND_JOBS.problems;
      expect(t.backgroundJobs?.map((j) => j.label)).toContain(job.label);
      const n = playMonth(t);
      const run = n.history
        .at(-1)!
        .backgroundJobs!.find((r) => r.label === job.label)!;
      expect(run.where).toBe('vps');
      expect(run.ran).toBeGreaterThan(0);
      expect(run.usd).toBe(0);
    }
  });
});

describe('決定論と保存', () => {
  /** 提案を全部受ける形で 12 か月遊び、行動の列を保存に積む。 */
  function playAccepting(stackIndex: number, seed: number) {
    let s = playMonth(newGame(stackIndex, seed, K));
    let save: SaveData = newSave({
      scenarioId: K.id,
      stackIndex,
      seed,
      startDate: DEFAULT_START_DATE,
      // 始める画面と同じく、始めたときの再検証を保存に入れる（省略は古い保存の既定で読む）
      revalidateSec: s.settings.revalidateSec,
    });
    while (s.phase === 'playing') {
      const t: Action[] = s.pendingProposals.map((eventId) => ({
        type: 'respond',
        eventId,
        accept: true,
      }));
      s = playMonth(applyActions(s, t));
      save = withTurn(save, t);
    }
    return { s, save };
  }

  it('同じシード・同じ行動は同じ結果になり、保存から再生しても同じ（JSON を通しても）', () => {
    for (const id of ['cloudflare-vinext-paid', 'sakura-vps-2gb']) {
      const a = playAccepting(idx(id), 3);
      const b = playAccepting(idx(id), 3);
      expect(b.s).toEqual(a.s);
      expect(replaySave(a.save)).toEqual(a.s);
      const parsed = parseSave(JSON.parse(JSON.stringify(a.save)));
      expect(replaySave(parsed!)).toEqual(a.s);
    }
  });
});

/** シナリオの規模の 1 か月目の見積（ゲームの 1 か月目と同じ Workload と構成。提案の変化なし）。 */
const books = loadPriceBooks();
function firstMonth(stackId: string, analysis: string) {
  const stackIndex = idx(stackId);
  const { components } = estimateComponents(K, stackIndex, 'nextjs', {
    analysis,
  });
  const workload = estimateWorkload(K, {
    pv: K.scale.startPV,
    stackIndex,
    framework: 'nextjs',
    components,
    settings: { imageKB: 150, variants: 3, revalidateSec: 300 },
  });
  const architecture = composeStack(stackDef(stackId), components);
  return {
    workload: resolveWorkload(workload),
    architecture,
    result: estimate({ workload, architecture, books }),
  };
}
/** 利用者の数（1 人 月 KIFU_PV_PER_MAU PV。シナリオの規模では 1,000 人）。 */
const USERS = K.scale.startPV / KIFU_PV_PER_MAU;
/** 局面ごとの解析の月の件数 = 利用者 × 月の局数 × 1 局の手数。 */
const JOBS = USERS * KIFU_GAMES_PER_MAU * KIFU_MOVES_PER_GAME;

// 2026-11-24 に現実の試算を優先して規模を決め直した（1 人 月 90 局・120 PV。KF-16 の「どの構成も生き残り、費用の差が収益の 1〜4 割」
// という遊びの意図は捨てた）。ここでは、費用と上限が現実の算術どおりに出ているかを確かめる（どの構成が勝つかは確かめない）。
describe('規模と費用の算術（2026-11-24 の決め直し）', () => {
  it('利用者 1,000 人・局面ごとの解析は 月 利用者 × 90 局 × 手数 件', () => {
    expect(USERS).toBeCloseTo(1_000, 9);
    const w = firstMonth('aws-amplify', 'same').workload;
    expect(w.classes['api-async'].count).toBeCloseTo(JOBS, 0);
    expect(JOBS).toBeCloseTo(1_000 * 90 * KIFU_MOVES_PER_GAME, 0);
  });

  it('AWS の同じ実行環境: 解析の Lambda の実行時間 = 件数 × 1 件の壁時計 × メモリ、費用は無料枠（40 万 GB 秒）を引いて単価を掛けた額', () => {
    const { architecture, result } = firstMonth('aws-amplify', 'same');
    const fn = architecture.nodes.find((n) => n.id === ANALYSIS_FN_NODE_ID)!;
    expect(fn.config.kind).toBe('function');
    const memoryGB = (fn.config as { memoryGB: number }).memoryGB;
    const wallSec = analysisJobWallMs(KIFU_ANALYSIS_JOB, 'position') / 1000;
    const gbSec = JOBS * wallSec * memoryGB;
    const sim = result.simulation.nodes[ANALYSIS_FN_NODE_ID]!;
    expect(sim.resources['memory-gb-hours']! * 3600).toBeCloseTo(gbSec, -3);
    // 単価は料金データから読む（金額をテストに書かない。prd/05 §1）
    const lambda = books
      .find((b) => b.provider === 'aws')!
      .plans.find((p) => p.id === 'lambda')!;
    const meter = lambda.meters.find((m) => m.id === 'compute')!;
    const tier = (
      meter.pricing as { tiers: { upTo: number | null; unitPrice: number }[] }
    ).tiers[0]!;
    expect(gbSec).toBeLessThan(tier.upTo!);
    const free = 400_000;
    const line = result.bill.lines.find(
      (l) =>
        l.nodeIds.includes(ANALYSIS_FN_NODE_ID) &&
        l.kind === 'usage' &&
        l.priceRef?.meterId === 'compute',
    )!;
    expect(line.amount!).toBeCloseTo((gbSec - free) * tier.unitPrice, -1);
    // 収益（利用者 1 人 月 $0.33）より桁で大きい
    expect(line.amount!).toBeGreaterThan(
      (K.scale.startPV / 1000) * K.revenue.adsUsdPer1000PV * 2,
    );
  });

  it('worker の VPS はこの規模ではピークの比が 1 を超え（2GB・4GB とも）、解析の速さは悪い', () => {
    for (const analysis of ['worker-vps-2gb', 'worker-vps-4gb']) {
      const r = playMonth(
        newGame(
          idx('vercel-supabase-pro'),
          1,
          K,
          DEFAULT_START_DATE,
          undefined,
          {
            analysis,
          },
        ),
      ).history[0]!;
      const p = r.premises.find((x) => x.id === 'host:cpu:analysis-worker')!;
      expect(p.ratio, analysis).toBeGreaterThan(1);
      expect(r.satisfaction.stages.analysisSpeed, analysis).toBe('bad');
    }
  });

  it('Cloudflare Paid は、どの置き場でも 1 か月目から D1 の 10 GB に当たる（解析の結果の在庫は置き場によらない）', () => {
    for (const analysis of PLACEMENTS) {
      const r = playMonth(
        newGame(
          idx('cloudflare-vinext-paid'),
          1,
          K,
          DEFAULT_START_DATE,
          undefined,
          {
            analysis,
          },
        ),
      );
      const hit = r.history[0]!.premises.find(
        (p) => p.id === 'limit:cloudflare:workers-paid:d1-db-size:d1',
      )!;
      expect(hit.hit, analysis).toBe(true);
      expect(r.stock.dbGB, analysis).toBeGreaterThan(10);
    }
    expect(kifuAnalysis(K.scale.startPV).db.sizeGB).toBeGreaterThan(10);
  });

  it('端末の置き場はサーバーの解析を無くし、結果を送る API だけが残る', () => {
    const same = firstMonth('aws-amplify', 'same');
    const client = firstMonth('aws-amplify', 'client');
    expect(client.workload.classes['api-async'].count).toBe(0);
    expect(client.workload.classes.api.count).toBeCloseTo(JOBS, 0);
    expect(
      client.architecture.nodes.some((n) => n.id === ANALYSIS_FN_NODE_ID),
    ).toBe(false);
    const total = (r: typeof same) =>
      r.result.bill.lines.reduce((a, l) => a + (l.amount ?? 0), 0);
    expect(total(client)).toBeLessThan(total(same) / 10);
  });
});

describe('参照値と基準プレイ', () => {
  it('初期費用（D-253）: 既定の置き場で何もしないサーバーレスの構成は 2〜3 か月目に所持金が尽きる（12 か月を走り切らない）', () => {
    const b = (id: string) => K.baselines.find((x) => x.id === id)!;
    for (const id of ['gcp', 'aws-amplify', 'vercel-pro'])
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = playStrategy(b(id), seed, K, DEFAULT_START_DATE);
        expect(s.end?.reason, `${id}・${seed}`).toBe('cash');
        expect(s.end!.month, `${id}・${seed}`).toBeGreaterThanOrEqual(2);
        expect(s.end!.month, `${id}・${seed}`).toBeLessThanOrEqual(4);
      }
  });

  it('参照値の所持金（D-64 の決め方・D-253）: 端末で解析・簡易 + Fargate は全シードで届き、VPS の道筋は自前の障害の無いシードで届く', () => {
    const b = (id: string) => K.baselines.find((x) => x.id === id)!;
    let clean = 0;
    for (let seed = 1; seed <= 50; seed++) {
      for (const id of ['vercel-pro-client', 'vercel-pro-fargate-requested']) {
        const s = playStrategy(b(id), seed, K, DEFAULT_START_DATE);
        expect(s.phase, `${id}・${seed}`).toBe('completed');
        expect(s.cash, `${id}・${seed}`).toBeGreaterThanOrEqual(K.goal.cash);
      }
      for (const id of ['vps-16gb-x4-requested', 'vps-worker']) {
        const s = playStrategy(b(id), seed, K, DEFAULT_START_DATE);
        if (s.outages > 0) continue;
        clean++;
        expect(s.phase, `${id}・${seed}`).toBe('completed');
        expect(s.cash, `${id}・${seed}`).toBeGreaterThanOrEqual(K.goal.cash);
      }
    }
    expect(clean).toBeGreaterThan(10);
  });

  it('基準プレイ（golden。シード 1・3）', () => {
    const r = (seed: number) =>
      Object.fromEntries(
        K.baselines.map((b) => {
          const s = playStrategy(b, seed, K, DEFAULT_START_DATE);
          return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
        }),
      );
    expect({ 1: r(1), 3: r(3) }).toMatchSnapshot();
  });
});
