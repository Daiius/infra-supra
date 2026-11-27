// 部品「リアルタイム」を Cloudflare 以外にも足す（prd/17 §6 の出来事 6・D-240）。値はゲーム上の仮定と公式の単価なので、
// 金額はテストに書かず、数え方（接続の分・つなぎ直し・送受信のメッセージ・常駐のメモリ）と傾きを確かめる（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload, simulateResources } from 'estimator';
import {
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  KIFU_PV_PER_MAU,
  KIFU_STUDY_REALTIME,
  kifuAnalysis,
  loadPriceBooks,
  REALTIME_OPTION,
  realtimeSession,
  STACK_DEFS,
  stackHidden,
  stackDef,
  VERCEL_WS_CONNECTIONS_PER_INSTANCE,
  VPS_WS_KB_PER_CONNECTION,
  type Platform,
} from '../index.ts';

const books = loadPriceBooks();
const PV = 300_000;
const RT = KIFU_STUDY_REALTIME;
const VISIBLE = STACK_DEFS.filter((d) => !stackHidden(d));

const workloadOf = (platform: Platform, realtime: boolean) => {
  const w = applyComponentsToWorkload(kifuAnalysis(PV), platform, {
    analysis: 'same',
  });
  return realtime ? { ...w, realtime: RT } : w;
};
const run = (id: string, realtime: boolean) => {
  const def = stackDef(id);
  const workload = workloadOf(def.platform, realtime);
  const architecture = composeStack(def, {
    analysis: 'same',
    ...(realtime ? { realtime: REALTIME_OPTION[def.platform]! } : {}),
  });
  return {
    workload,
    architecture,
    sim: simulateResources(resolveWorkload(workload), architecture),
    result: estimate({ workload, architecture, books }),
  };
};

// 利用者の数は棋譜解析の 1 人の月の PV から出す（定数を直書きしない）
const mau = PV / KIFU_PV_PER_MAU;
const connections = mau * RT.usersPerMau * RT.connectionsPerUser;
const messages = mau * RT.usersPerMau * RT.messagesPerUser;

describe('選択肢', () => {
  it('Cloudflare 以外のリアルタイムは optIn で、渡さないと出ない（記事のチャットは Cloudflare だけ。X-5）', () => {
    for (const p of ['vercel', 'sakura', 'gcp', 'aws'] as const) {
      expect(componentsOf(p, 'realtime')).toEqual([]);
      expect(
        componentsOf(p, 'realtime', undefined, { optIn: true }).map(
          (o) => o.id,
        ),
      ).toEqual(['none', REALTIME_OPTION[p]]);
    }
    expect(componentsOf('cloudflare', 'realtime').map((o) => o.id)).toEqual([
      'none',
      'durable-objects',
    ]);
  });

  it('隠している構成（Netlify・OpenNext）には足さない', () => {
    for (const p of ['netlify', 'aws-opennext'] as const) {
      expect(componentsOf(p, 'realtime', undefined, { optIn: true })).toEqual(
        [],
      );
      expect(realtimeSession(p, 'pro')).toBeUndefined();
    }
  });

  it('セッションの保ち方: Durable Objects・VPS は時間で切られず、サーバーレスは上限でつなぎ直し、盤面は外に置く', () => {
    expect(realtimeSession('cloudflare', 'paid')).toMatchObject({
      state: 'object',
    });
    expect(realtimeSession('sakura', '2gb')).toMatchObject({
      state: 'process',
    });
    expect(
      realtimeSession('sakura', '2gb')!.maxConnectionMinutes,
    ).toBeUndefined();
    expect(realtimeSession('vercel', 'hobby')!.maxConnectionMinutes).toBe(5);
    expect(realtimeSession('vercel', 'pro')!.maxConnectionMinutes).toBe(
      800 / 60,
    );
    expect(realtimeSession('gcp', 'default')!.maxConnectionMinutes).toBe(60);
    expect(realtimeSession('aws', 'default')!.maxConnectionMinutes).toBe(120);
    for (const p of ['vercel', 'gcp', 'aws'] as const)
      expect(realtimeSession(p, 'pro')!.state).toBe('external');
  });
});

describe('選ばなければ構成は変わらない', () => {
  it.each(VISIBLE.map((d) => [d.id]))('%s', (id) => {
    const def = stackDef(id);
    expect(composeStack(def, { realtime: 'none' })).toEqual(composeStack(def));
  });
});

describe('数え方', () => {
  it('Vercel Pro: 800 秒ごとにつなぎ直し、接続の間ずっとメモリを 1 インスタンスの接続の数で割って数える', () => {
    const { sim } = run('vercel-supabase-pro', true);
    const ws = sim.nodes.ws!;
    const reconnects = Math.ceil((RT.minutesPerConnection * 60) / 800);
    expect(ws.resources.invocations).toBeCloseTo(
      connections * reconnects + messages,
    );
    // 接続の時間と、メッセージの処理の時間（壁時計 = CPU）
    expect(ws.resources['memory-gb-hours']).toBeCloseTo(
      ((connections * RT.minutesPerConnection) / 60 +
        (messages * RT.processingMs) / 3_600_000) *
        (2 / VERCEL_WS_CONNECTIONS_PER_INSTANCE),
    );
    // 1 回の接続は上限以下（止まらない。つなぎ直しで表す）
    expect(ws.maxWallMsPerRequest).toBeLessThanOrEqual(800_000);
    // DB へは短い 1 件として渡す（接続の間 DB を使っているとは数えない。増えるのはメッセージの処理の分だけ）
    expect(
      sim.nodes.db!.peakBusyMs -
        run('vercel-supabase-pro', false).sim.nodes.db!.peakBusyMs,
    ).toBeCloseTo(messages * RT.processingMs);
  });

  it('Vercel Hobby は 5 分ごとにつなぎ直す', () => {
    const { sim } = run('vercel-supabase-hobby', true);
    expect(sim.nodes.ws!.resources.invocations).toBeCloseTo(
      connections * (RT.minutesPerConnection / 5) + messages,
    );
  });

  it('AWS: 受け取った分と配った分をメッセージに、接続の分を数え、2 時間までは 1 回の接続のまま', () => {
    const { sim, result } = run('aws-amplify', true);
    const gw = sim.nodes['apigw-ws']!;
    expect(gw.resources.messages).toBeCloseTo(messages * (1 + RT.fanout));
    expect(gw.resources['connection-minutes']).toBeCloseTo(
      connections * RT.minutesPerConnection,
    );
    // Lambda はメッセージと接続ごとに短く呼ばれる
    expect(sim.nodes['ws-lambda']!.resources.invocations).toBeCloseTo(
      connections + messages,
    );
    expect(
      result.bill.lines.some(
        (l) => l.nodeIds.includes('apigw-ws') && (l.amount ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('Google Cloud: 60 分ごとにつなぎ直し、開いている間のインスタンスの時間が増える', () => {
    const on = run('gcp-cloud-run', true).sim.nodes.run!;
    const off = run('gcp-cloud-run', false).sim.nodes.run!;
    expect(on.resources.requests! - off.resources.requests!).toBeCloseTo(
      connections * Math.ceil(RT.minutesPerConnection / 60) + messages,
    );
    expect(on.resources['cpu-hours']!).toBeGreaterThan(
      off.resources['cpu-hours']!,
    );
    expect(on.maxWallMsPerRequest).toBeLessThanOrEqual(3_600_000);
  });

  it('さくらの VPS: 月額は変わらず、メモリに同時接続のピーク × 1 接続のメモリが乗る', () => {
    const on = run('sakura-vps-2gb', true);
    const off = run('sakura-vps-2gb', false);
    const peak = on.sim.workload.realtime!.peakConnections;
    expect(peak).toBeCloseTo(
      ((connections * RT.minutesPerConnection) / (730 * 60)) * RT.peakFactor,
    );
    expect(
      on.sim.nodes.vps!.host!.memoryGB - off.sim.nodes.vps!.host!.memoryGB,
    ).toBeCloseTo((peak * VPS_WS_KB_PER_CONNECTION) / 1_000_000);
    expect(on.result.bill.totals).toEqual(off.result.bill.totals);
  });

  it('Cloudflare: 接続の長さを足しても Durable Objects の数え方は変わらない（休止中は課金しない）', () => {
    const def = stackDef('cloudflare-vinext-paid');
    const architecture = composeStack(def, {
      analysis: 'same',
      realtime: 'durable-objects',
    });
    const { minutesPerConnection: _m, ...short } = RT;
    void _m;
    const res = (realtime: typeof short) =>
      simulateResources(
        resolveWorkload({ ...workloadOf('cloudflare', false), realtime }),
        architecture,
      ).nodes.do!.resources;
    expect(res(RT)).toEqual(res(short));
  });

  it('どの構成でも、研究会を足しても新しく止まる前提は無い（この規模）', () => {
    for (const def of VISIBLE) {
      if (!REALTIME_OPTION[def.platform]) continue;
      const on = run(def.id, true).result.premises;
      const off = run(def.id, false).result.premises;
      const newBlocks = on.filter(
        (p) =>
          p.hit &&
          p.effect === 'block' &&
          !off.some((q) => q.id === p.id && q.hit),
      );
      expect(
        newBlocks.map((p) => p.id),
        def.id,
      ).toEqual([]);
    }
  });
});
