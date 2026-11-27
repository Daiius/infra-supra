// 部品「解析の置き場」（prd/17 §5.1・D-235）。値はゲーム上の仮定なので、形と傾き（端末はサーバーの解析の CPU が 0・worker は定額）
// だけを確かめる。実在の料金の金額はテストに書かない（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload } from 'estimator';
import {
  ANALYSIS_FN_NODE_ID,
  ANALYSIS_RESULT_CPU_MS,
  ANALYSIS_WORKER_NODE_ID,
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  KIFU_BROWSER_ANALYSIS,
  KIFU_ENGINE_STARTUP_CPU_MS,
  KIFU_POSITION_CPU_MS,
  kifuAnalysis,
  loadPriceBooks,
  rulesFor,
  ANALYSIS_PARTS,
  ANALYSIS_FN,
  ANALYSIS_FN_TARGETS,
  ANALYSIS_MODES,
  ANALYSIS_TARGETS,
  ANALYSIS_MACHINE_TARGETS,
  ANALYSIS_MACHINE_COUNTS,
  ANALYSIS_MACHINES,
  ANALYSIS_TASK_TARGETS,
  analysisCpuSpeed,
  analysisMachine,
  analysisTaskTarget,
  cpuSpeedOf,
  analysisTargetKind,
  ANALYSIS_CPU_SPEED,
  FARGATE_TASK,
  FARGATE_TARGET_UTILIZATION,
  analysisFnTarget,
  analysisPlacementId,
  analysisPlacementOf,
  analysisWorkerPlan,
  browserAnalyzes,
  serverAnalyzes,
  STACK_DEFS,
  stackHidden,
  type Platform,
} from '../index.ts';

const books = loadPriceBooks();
const PV = 300_000;
const PLATFORMS: Platform[] = [
  'cloudflare',
  'vercel',
  'sakura',
  'aws',
  'aws-opennext',
  'netlify',
  'gcp',
];
const VISIBLE = STACK_DEFS.filter((d) => !stackHidden(d));

const run = (def: (typeof STACK_DEFS)[number], analysis: string, pv = PV) => {
  const workload = applyComponentsToWorkload(
    kifuAnalysis(pv),
    def.platform,
    { analysis },
    { browserAnalysis: KIFU_BROWSER_ANALYSIS },
  );
  const architecture = composeStack(def, { analysis });
  return {
    workload,
    architecture,
    result: estimate({ workload, architecture, books }),
  };
};
const workerUsd = (r: ReturnType<typeof run>['result']) =>
  r.bill.lines
    .filter((l) => l.nodeIds.includes(ANALYSIS_WORKER_NODE_ID))
    .reduce((s, l) => s + (l.amount ?? 0), 0);

describe('選択肢', () => {
  it('どの事業者でも、端末と、置き方（サーバー・併用）× 実行先（同じ実行環境・別の事業者のサーバーレス・worker の VPS・Fargate・台で借りるマシン）', () => {
    for (const p of PLATFORMS) {
      // 別の事業者のサーバーレスは、同じ事業者（AWS は OpenNext も）の土台では「同じ実行環境」と重なるので出さない
      const fns = ANALYSIS_FN_TARGETS.filter(
        (t) =>
          ANALYSIS_FN[t].provider !== p &&
          !(p === 'aws-opennext' && ANALYSIS_FN[t].provider === 'aws'),
      );
      // Fargate・台で借りるマシン（D-247）は、同じ事業者の土台でも別の実行先なので、どの土台にも出す
      const targets = [
        'same',
        ...fns,
        'worker-vps-2gb',
        'worker-vps-4gb',
        ...ANALYSIS_TASK_TARGETS,
        ...ANALYSIS_MACHINE_TARGETS.filter(
          (t) => t !== 'worker-vps-2gb' && t !== 'worker-vps-4gb',
        ),
      ];
      expect(
        componentsOf(p, 'analysis')
          .map((o) => o.id)
          .sort(),
        p,
      ).toEqual(
        [
          'client',
          ...targets,
          ...targets.map((t) => (t === 'same' ? 'hybrid' : `hybrid-${t}`)),
        ].sort(),
      );
    }
  });

  it('部品の id は置き方と実行先に分けられ、今の id（same・client・hybrid・worker-vps-*）はそのまま', () => {
    expect(analysisPlacementOf(undefined)).toEqual({
      mode: 'server',
      target: 'same',
    });
    expect(analysisPlacementOf('client')).toEqual({ mode: 'client' });
    expect(analysisPlacementId('client', 'fn-lambda')).toBe('client');
    expect(analysisPlacementId('server', 'same')).toBe('same');
    expect(analysisPlacementId('hybrid', 'same')).toBe('hybrid');
    expect(analysisPlacementId('server', 'worker-vps-2gb')).toBe(
      'worker-vps-2gb',
    );
    expect(analysisPlacementId('hybrid', 'fn-lambda')).toBe('hybrid-fn-lambda');
    for (const mode of ANALYSIS_MODES)
      for (const target of ANALYSIS_TARGETS) {
        const id = analysisPlacementId(mode, target);
        expect(analysisPlacementOf(id), id).toEqual(
          mode === 'client' ? { mode } : { mode, target },
        );
        expect(serverAnalyzes(id)).toBe(mode !== 'client');
        expect(browserAnalyzes(id)).toBe(mode !== 'server');
      }
    expect(analysisWorkerPlan('hybrid-worker-vps-4gb')).toBe('4gb');
    expect(analysisWorkerPlan('hybrid-fn-lambda')).toBeUndefined();
    expect(analysisFnTarget('hybrid-fn-cloud-run')).toBe('fn-cloud-run');
    expect(analysisFnTarget('same')).toBeUndefined();
  });

  it('worker は さくらの VPS の部品で、VPS 以外の土台には接続の規則（アプリの API を HTTPS で呼ぶ）で差す', () => {
    for (const p of PLATFORMS) {
      const workers = componentsOf(p, 'analysis').filter((o) =>
        o.id.startsWith('worker-'),
      );
      for (const w of workers) expect(w.platform).toBe('sakura');
      if (p === 'sakura') continue;
      for (const part of ANALYSIS_PARTS) {
        const rules = rulesFor(p, part);
        expect(rules.map((r) => r.id)).toEqual(['vps-worker-app-api']);
        expect(rules[0]!.to.port).toBe('https-api');
      }
    }
  });
});

describe('構成', () => {
  it('選ばなければ構成を変えない（記事・受託の構成のまま。非同期の API の経路を持たない）', () => {
    for (const def of STACK_DEFS)
      expect(composeStack(def).routes['api-async']).toBeUndefined();
  });

  it('同じ実行環境・併用は API と同じ経路（Amplify は同じアカウントの Lambda）、端末は経路を持たない', () => {
    for (const def of VISIBLE) {
      const api = composeStack(def, { analysis: 'same' }).routes.api!;
      // Amplify の SSR はキューから起こせないので、解析は別の Lambda で動かし、DB へは API と同じ先に書く
      const expected =
        def.platform === 'aws'
          ? [ANALYSIS_FN_NODE_ID, ...api.slice(api.indexOf('ssr') + 1)]
          : api;
      expect(
        composeStack(def, { analysis: 'same' }).routes['api-async'],
        def.id,
      ).toEqual(expected);
      expect(
        composeStack(def, { analysis: 'hybrid' }).routes['api-async'],
        def.id,
      ).toEqual(expected);
      expect(
        composeStack(def, { analysis: 'client' }).routes['api-async'],
      ).toBeUndefined();
    }
  });

  it('worker は別の VPS の箱で、結果はアプリの API の経路に送り、アプリの処理は受けて書くだけ', () => {
    for (const def of VISIBLE) {
      const a = composeStack(def, { analysis: 'worker-vps-2gb' });
      const path = a.routes['api-async']!;
      expect(path[0]).toBe(ANALYSIS_WORKER_NODE_ID);
      expect(path.slice(-a.routes.api!.length)).toEqual(a.routes.api);
      const worker = a.nodes.find((n) => n.id === ANALYSIS_WORKER_NODE_ID)!;
      expect(worker.config.kind).toBe('host');
      expect(worker.billing).toMatchObject({
        accountId: 'sakura',
        provider: 'sakura-vps',
        planId: '2gb-tokyo',
      });
      // アプリの処理（関数・コンテナ・ホスト）は受けて書くだけの CPU
      const apps = a.nodes.filter(
        (n) =>
          a.routes.api!.includes(n.id) &&
          n.role === 'compute' &&
          ['function', 'container', 'host'].includes(n.config.kind),
      );
      expect(apps.length, def.id).toBeGreaterThan(0);
      for (const n of apps)
        expect(
          'classCpuMs' in n.config ? n.config.classCpuMs?.['api-async'] : -1,
        ).toBe(ANALYSIS_RESULT_CPU_MS);
    }
    // VPS の構成は、アプリの VPS とは別にもう 1 台（月額が 1 台分増える）
    const vps = composeStack('sakura-vps-2gb', {
      analysis: 'worker-vps-4gb',
    });
    expect(vps.nodes.filter((n) => n.config.kind === 'host')).toHaveLength(2);
  });
});

describe('費用の傾き', () => {
  it('端末: サーバーの解析の CPU は 0（結果を受けて書くだけ）、書き込みの行は同じ、エンジンの転送が増える', () => {
    for (const def of VISIBLE) {
      const same = run(def, 'same');
      const client = run(def, 'client');
      const ws = resolveWorkload(same.workload);
      const wc = resolveWorkload(client.workload);
      expect(ws.classes['api-async'].perRequest.cpuMs).toBe(
        KIFU_ENGINE_STARTUP_CPU_MS + KIFU_POSITION_CPU_MS,
      );
      expect(wc.classes['api-async'].count).toBe(0);
      expect(wc.classes.api.count).toBeCloseTo(
        ws.classes['api-async'].count,
        6,
      );
      expect(wc.classes.api.perRequest.cpuMs).toBe(ANALYSIS_RESULT_CPU_MS);
      expect(wc.classes.api.perRequest.rowsWritten).toBe(
        ws.classes['api-async'].perRequest.rowsWritten,
      );
      // 配るファイル（エンジンと評価関数）の分だけ JS・CSS の転送が大きい
      const kb = (w: typeof ws) =>
        w.classes.asset.count * w.classes.asset.perRequest.kb;
      expect(kb(wc)).toBeGreaterThan(kb(ws));
      // サーバーの CPU の合計は、解析の分（1 件の CPU − 受けて書く CPU）だけ減る
      const cpu = (r: ReturnType<typeof run>) =>
        Object.values(r.result.simulation.nodes)
          .map((u) => u.resources['cpu-ms'] ?? 0)
          .reduce((a, b) => a + b, 0);
      if (def.platform !== 'sakura')
        expect(cpu(same) - cpu(client)).toBeCloseTo(
          ws.classes['api-async'].count *
            (KIFU_ENGINE_STARTUP_CPU_MS +
              KIFU_POSITION_CPU_MS -
              ANALYSIS_RESULT_CPU_MS),
          -3,
        );
    }
  });

  it('併用: サーバーの詳細解析は同じ実行環境と同じで、エンジンの転送だけ増える', () => {
    for (const def of VISIBLE) {
      const ws = resolveWorkload(run(def, 'same').workload);
      const wh = resolveWorkload(run(def, 'hybrid').workload);
      expect(wh.classes['api-async']).toEqual(ws.classes['api-async']);
      expect(
        wh.classes.asset.count * wh.classes.asset.perRequest.kb,
      ).toBeGreaterThan(
        ws.classes.asset.count * ws.classes.asset.perRequest.kb,
      );
    }
  });

  it('worker: 解析の CPU は worker の VPS の使用率に入り、費用は PV によらず定額', () => {
    for (const def of VISIBLE) {
      const a = run(def, 'worker-vps-2gb', PV);
      const b = run(def, 'worker-vps-2gb', PV * 2);
      expect(workerUsd(a.result)).toBeGreaterThan(0);
      expect(workerUsd(b.result)).toBe(workerUsd(a.result));
      const ua = a.result.premises.find(
        (p) => p.id === `host:cpu:${ANALYSIS_WORKER_NODE_ID}`,
      )!;
      const ub = b.result.premises.find(
        (p) => p.id === `host:cpu:${ANALYSIS_WORKER_NODE_ID}`,
      )!;
      expect(ua.ratio).toBeGreaterThan(0);
      // 使用率は解析の件数にほぼ比例する
      expect(ub.ratio! / ua.ratio!).toBeCloseTo(2, 1);
    }
  });
});

/** その土台で選べる、別の事業者のサーバーレスの実行先。 */
const fnTargetsOn = (def: (typeof STACK_DEFS)[number]) =>
  ANALYSIS_FN_TARGETS.filter((t) =>
    componentsOf(def.platform, 'analysis').some((o) => o.id === t),
  );

describe('別の事業者のサーバーレス（D-245・prd/17 §5.6）', () => {
  it('解析は別の関数・コンテナの箱（その事業者のアカウント）で、結果はアプリの API の経路に送り、アプリの処理は受けて書くだけ', () => {
    for (const def of VISIBLE)
      for (const t of fnTargetsOn(def))
        for (const id of [t, `hybrid-${t}`]) {
          const a = composeStack(def, { analysis: id });
          const path = a.routes['api-async']!;
          expect(path[0], `${def.id} ${id}`).toBe(ANALYSIS_FN_NODE_ID);
          expect(path.slice(-a.routes.api!.length)).toEqual(a.routes.api);
          const fn = a.nodes.find((n) => n.id === ANALYSIS_FN_NODE_ID)!;
          expect(['function', 'container']).toContain(fn.config.kind);
          expect(fn.billing?.provider).toBe(ANALYSIS_FN[t].provider);
          // 経路の上のノードは重ならない（同じ事業者の外への転送のノードは 1 つ）
          expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
          const apps = a.nodes.filter(
            (n) =>
              a.routes.api!.includes(n.id) &&
              n.role === 'compute' &&
              ['function', 'container', 'host'].includes(n.config.kind),
          );
          for (const n of apps)
            expect(
              'classCpuMs' in n.config
                ? n.config.classCpuMs?.['api-async']
                : -1,
            ).toBe(ANALYSIS_RESULT_CPU_MS);
        }
  });

  it('Lambda の解析の費用は、Web の事業者によらず AWS（Amplify）の同じ実行環境の Lambda とほぼ同じ（DB の待ちの差だけ）', () => {
    const lambdaUsd = (r: ReturnType<typeof run>['result']) =>
      r.bill.lines
        .filter(
          (l) =>
            l.nodeIds.includes(ANALYSIS_FN_NODE_ID) &&
            l.priceRef.planId === 'lambda',
        )
        .reduce((s, l) => s + (l.amount ?? 0), 0);
    const amplify = STACK_DEFS.find((d) => d.id === 'aws-amplify')!;
    const base = lambdaUsd(run(amplify, 'same').result);
    expect(base).toBeGreaterThan(0);
    for (const id of [
      'vercel-supabase-pro',
      'gcp-cloud-run',
      'sakura-vps-2gb',
      'cloudflare-vinext-paid',
    ]) {
      const def = STACK_DEFS.find((d) => d.id === id)!;
      // Amplify の同じ実行環境は解析の関数が DB へ直接書き、別の事業者からは結果をアプリの API に送るので、1 件の待ちがわずかに違う
      expect(
        Math.abs(lambdaUsd(run(def, 'fn-lambda').result) / base - 1),
        id,
      ).toBeLessThan(0.001);
    }
  });

  it('Web と別の事業者なら、そのアカウントの基本料（Workers Paid・Vercel Pro）が足される', () => {
    const amplify = STACK_DEFS.find((d) => d.id === 'aws-amplify')!;
    const accounts = (analysis: string) =>
      new Set(
        run(amplify, analysis)
          .result.bill.lines.filter((l) => l.kind === 'base-fee')
          .map((l) => `${l.accountId}:${l.priceRef.planId}`),
      );
    expect(accounts('fn-workers')).toContain('cloudflare:workers-paid');
    expect(accounts('fn-vercel')).toContain('vercel:pro');
    expect([...accounts('same')].some((a) => a.startsWith('cloudflare'))).toBe(
      false,
    );
  });

  it('1 件の上限は実行先の事業者のもので判定する（1 件 20 分なら Workers・Vercel Functions は当たり、Lambda・Cloud Run は当たらない）', () => {
    const vercel = STACK_DEFS.find((d) => d.id === 'vercel-supabase-pro')!;
    const amplify = STACK_DEFS.find((d) => d.id === 'aws-amplify')!;
    const hits = (def: (typeof STACK_DEFS)[number], analysis: string) => {
      const { workload, architecture } = run(def, analysis);
      const w = {
        ...workload,
        api: { ...workload.api, cpuMs: 1_000, ioWaitMs: 20 * 60_000 },
      };
      return estimate({ workload: w, architecture, books })
        .premises.filter(
          (p) =>
            p.hit &&
            p.id.startsWith('limit:') &&
            p.nodeIds.includes(ANALYSIS_FN_NODE_ID),
        )
        .map((p) => p.id);
    };
    expect(hits(vercel, 'fn-workers').join()).toMatch(
      /^limit:cloudflare:workers-paid:/,
    );
    expect(hits(amplify, 'fn-vercel').join()).toMatch(/^limit:vercel:pro:/);
    expect(hits(vercel, 'fn-lambda')).toEqual([]);
    expect(hits(vercel, 'fn-cloud-run')).toEqual([]);
  });
});

describe('Fargate・台で借りるマシン（D-247・prd/17 §5.6）', () => {
  const vercel = STACK_DEFS.find((d) => d.id === 'vercel-supabase-pro')!;
  const amplify = STACK_DEFS.find((d) => d.id === 'aws-amplify')!;
  const gcpRun = STACK_DEFS.find((d) => d.id === 'gcp-cloud-run')!;
  const sakura = STACK_DEFS.find((d) => d.id === 'sakura-vps-2gb')!;
  const lines = (r: ReturnType<typeof run>['result'], planId: string) =>
    r.bill.lines.filter((l) => l.priceRef.planId === planId);

  it('型ごとの id の判定: Fargate は動いている間・EC2・Compute Engine・さくらの VPS は台で借りる', () => {
    expect(analysisTargetKind('same')).toBe('same');
    expect(analysisTargetKind('fn-lambda')).toBe('per-call');
    expect(analysisTargetKind('fargate-arm')).toBe('running');
    for (const t of ANALYSIS_MACHINE_TARGETS)
      expect(analysisTargetKind(t), t).toBe('machine');
    expect(analysisTaskTarget('hybrid-fargate-x86')).toBe('fargate-x86');
    expect(analysisMachine('hybrid-ec2-c7g-2xlarge')).toBe('ec2-c7g-2xlarge');
    expect(analysisMachine('worker-vps-2gb')).toBe('worker-vps-2gb');
    expect(analysisMachine('fn-lambda')).toBeUndefined();
  });

  it('台で借りるマシンは worker の箱（host）で、EC2・Compute Engine は 1 台の月の時間をオンデマンドの単価で払う', () => {
    for (const [def, target, planId] of [
      [vercel, 'ec2-c7g-2xlarge', 'ec2-c7g-2xlarge'],
      [amplify, 'ec2-c7a-xlarge', 'ec2-c7a-xlarge'],
      [vercel, 'gce-c4a-standard-8', 'gce-c4a-standard-8'],
      [gcpRun, 'gce-n2d-standard-4', 'gce-n2d-standard-4'],
    ] as const) {
      const r = run(def, target);
      const worker = r.architecture.nodes.find(
        (n) => n.id === ANALYSIS_WORKER_NODE_ID,
      )!;
      expect(worker.config.kind).toBe('host');
      expect(r.architecture.routes['api-async']![0]).toBe(
        ANALYSIS_WORKER_NODE_ID,
      );
      const ls = lines(r.result, planId);
      expect(ls).toHaveLength(1);
      const plan = books
        .find((b) => b.provider === worker.billing!.provider)!
        .plans.find((p) => p.id === planId)!;
      const m = plan.meters.find((x) => x.id === 'instance')!;
      const unit = m.pricing.model === 'flat' ? m.pricing.unitPrice : NaN;
      expect(ls[0]!.amount).toBeCloseTo(730 * unit, 6);
    }
  });

  it('さくらの大きいプランは月額の定額、アプリが さくらの VPS でも別の 1 台として足す', () => {
    const r = run(vercel, 'worker-vps-16gb');
    expect(
      r.result.bill.lines.find(
        (l) => l.kind === 'base-fee' && l.priceRef.planId === '16gb-tokyo',
      )?.amount,
    ).toBe(15_400);
    const own = run(sakura, 'worker-vps-32gb');
    expect(
      own.architecture.nodes.filter((n) => n.config.kind === 'host'),
    ).toHaveLength(2);
  });

  it('Fargate はコンテナの箱で、動いている間の vCPU とメモリの時間を払い、目標の使用率の分だけ長く動く', () => {
    const r = run(vercel, 'fargate-arm');
    const fn = r.architecture.nodes.find((n) => n.id === ANALYSIS_FN_NODE_ID)!;
    expect(fn.config.kind).toBe('container');
    const ls = lines(r.result, 'fargate-arm');
    expect(ls.map((l) => l.priceRef.meterId).sort()).toEqual([
      'memory',
      'vcpu',
    ]);
    const sim = r.result.simulation.nodes[ANALYSIS_FN_NODE_ID]!;
    const cpuHours = sim.resources['cpu-hours']!;
    // CPU で決まる時間（CPU の時間 ÷ タスクの vCPU）÷ 目標の使用率 以上
    const cpuBound = sim.resources['cpu-ms']! / 3_600_000 / FARGATE_TASK.vcpu;
    expect(cpuHours / FARGATE_TASK.vcpu).toBeGreaterThanOrEqual(
      cpuBound / FARGATE_TARGET_UTILIZATION - 1e-6,
    );
  });

  it('速さの係数: 系列ごとの仮定の値（物理コアの x86 = 1）で、今の値の基準（サーバーレス・さくらの仮想コア）は 1 倍のまま', () => {
    expect(ANALYSIS_CPU_SPEED['x86-core']).toBe(1);
    expect(cpuSpeedOf('serverless')).toBe(1);
    expect(cpuSpeedOf('vps-core')).toBe(1);
    expect(cpuSpeedOf('x86-thread')).toBe(1);
    expect(cpuSpeedOf('arm-core')).toBeGreaterThan(1);
    expect(cpuSpeedOf('x86-core')).toBeGreaterThan(cpuSpeedOf('arm-core'));
    expect(analysisCpuSpeed('same')).toBe(1);
    expect(analysisCpuSpeed('fn-lambda')).toBe(1);
    expect(analysisCpuSpeed('worker-vps-4gb')).toBe(1);
    expect(analysisCpuSpeed('hybrid-ec2-c7a-2xlarge')).toBe(
      cpuSpeedOf('x86-core'),
    );
    expect(analysisCpuSpeed('fargate-arm')).toBe(cpuSpeedOf('arm-core'));
  });

  it('速さの係数は解析の CPU に効く: 同じ 8 vCPU でも、物理コアの c7a は SMT の c7i より CPU の使用率が低い', () => {
    const ratio = (t: string) =>
      run(vercel, t).result.premises.find(
        (p) => p.id === `host:cpu:${ANALYSIS_WORKER_NODE_ID}`,
      )!.ratio!;
    const c7i = ratio('ec2-c7i-2xlarge');
    const c7a = ratio('ec2-c7a-2xlarge');
    expect(c7a / c7i).toBeCloseTo(
      cpuSpeedOf('x86-thread') / cpuSpeedOf('x86-core'),
      6,
    );
  });

  it('EC2 の予約・Compute Engine の CUD は前払いなしの 1 年で、オンデマンドより安い', () => {
    for (const [provider, planId, id] of [
      ['aws', 'ec2-c7g-2xlarge', 'reserved-instance'],
      ['gcp', 'gce-c4a-standard-8', 'resource-cud'],
    ] as const) {
      const plan = books
        .find((b) => b.provider === provider)!
        .plans.find((p) => p.id === planId)!;
      const c = plan.commitments.find((x) => x.id === id)!;
      const m = plan.meters.find((x) => x.id === 'instance')!;
      expect(c.kind).toBe('instance');
      expect(c.payments.map((p) => p.payment)).toEqual(['no-upfront']);
      expect(c.payments[0]!.hourly!).toBeLessThan(
        m.pricing.model === 'flat' ? m.pricing.unitPrice : 0,
      );
    }
  });

  it('EC2・Fargate・Compute Engine から別の事業者のアプリへ送る結果は、その事業者の外への転送で数える', () => {
    for (const [target, planId] of [
      ['ec2-c7g-xlarge', 'data-transfer-out'],
      ['fargate-x86', 'data-transfer-out'],
      ['gce-c4-standard-4', 'internet-egress'],
    ] as const) {
      const a = composeStack(vercel, { analysis: target });
      const path = a.routes['api-async']!;
      expect(
        path.some(
          (id) => a.nodes.find((n) => n.id === id)?.billing?.planId === planId,
        ),
        target,
      ).toBe(true);
    }
  });
});

describe('台で借りるマシンの台数（D-251・prd/17 §5.6）', () => {
  const vercel = STACK_DEFS.find((d) => d.id === 'vercel-supabase-pro')!;
  const runN = (target: string, n: number) => {
    const workload = applyComponentsToWorkload(
      kifuAnalysis(PV),
      vercel.platform,
      { analysis: target },
      { browserAnalysis: KIFU_BROWSER_ANALYSIS },
    );
    const architecture = composeStack(
      vercel,
      { analysis: target },
      { analysisMachines: n },
    );
    return {
      architecture,
      result: estimate({ workload, architecture, books }),
    };
  };
  const worker = (r: ReturnType<typeof runN>) =>
    r.architecture.nodes.find((n) => n.id === ANALYSIS_WORKER_NODE_ID)!;

  it('台数の選択肢は 1・2・4・8', () => {
    expect([...ANALYSIS_MACHINE_COUNTS]).toEqual([1, 2, 4, 8]);
  });

  it('n 台にすると、vCPU・メモリは台数倍・時間の課金（EC2・Compute Engine）と月額（さくら）も台数倍', () => {
    for (const target of [
      'ec2-c7g-2xlarge',
      'gce-c4a-standard-8',
      'worker-vps-16gb',
    ]) {
      const one = runN(target, 1);
      const four = runN(target, 4);
      const c1 = worker(one).config;
      const c4 = worker(four).config;
      if (c1.kind !== 'host' || c4.kind !== 'host') throw new Error(target);
      expect(c4.vcpu, target).toBe(c1.vcpu * 4);
      expect(c4.memoryGB, target).toBe(c1.memoryGB * 4);
      expect(c4.machines, target).toBe(4);
      expect(c1.machines, target).toBeUndefined();
      const usd = (r: ReturnType<typeof runN>) =>
        r.result.bill.lines
          .filter((l) => l.nodeIds.includes(ANALYSIS_WORKER_NODE_ID))
          .reduce((s, l) => s + (l.amount ?? 0), 0);
      expect(usd(four), target).toBeCloseTo(usd(one) * 4, 6);
    }
  });

  it('台数は台で借りるマシンの worker にだけ効き、ほかの実行先・1 台では構成を変えない', () => {
    expect(
      composeStack(vercel, { analysis: 'fn-lambda' }, { analysisMachines: 4 }),
    ).toEqual(composeStack(vercel, { analysis: 'fn-lambda' }));
    expect(
      composeStack(
        vercel,
        { analysis: 'ec2-c7g-2xlarge' },
        { analysisMachines: 1 },
      ),
    ).toEqual(composeStack(vercel, { analysis: 'ec2-c7g-2xlarge' }));
  });
});
