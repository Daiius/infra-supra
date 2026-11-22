// 部品「解析の置き場」（prd/17 §5.1・D-235）。値はゲーム上の仮定なので、形と傾き（端末はサーバーの解析の CPU が 0・worker は定額）
// だけを確かめる。実在の料金の金額はテストに書かない（prd/05 §1）。
import { describe, expect, it } from 'vitest';
import { estimate, resolveWorkload } from 'estimator';
import {
  ANALYSIS_RESULT_CPU_MS,
  ANALYSIS_WORKER_NODE_ID,
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  KIFU_BROWSER_ANALYSIS,
  KIFU_POSITION_CPU_MS,
  kifuAnalysis,
  loadPriceBooks,
  rulesFor,
  ANALYSIS_PARTS,
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
  it('どの事業者でも 5 つ（同じ実行環境・端末・併用・worker の VPS 2GB / 4GB）', () => {
    for (const p of PLATFORMS)
      expect(
        componentsOf(p, 'analysis')
          .map((o) => o.id)
          .sort(),
        p,
      ).toEqual(
        ['client', 'hybrid', 'same', 'worker-vps-2gb', 'worker-vps-4gb'].sort(),
      );
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

  it('同じ実行環境・併用は API と同じ経路、端末は経路を持たない', () => {
    for (const def of VISIBLE) {
      const api = composeStack(def, { analysis: 'same' }).routes.api;
      expect(
        composeStack(def, { analysis: 'same' }).routes['api-async'],
      ).toEqual(api);
      expect(
        composeStack(def, { analysis: 'hybrid' }).routes['api-async'],
      ).toEqual(api);
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
        KIFU_POSITION_CPU_MS,
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
      // サーバーの CPU の合計は、解析の分（1 局面の CPU − 受けて書く CPU）だけ減る
      const cpu = (r: ReturnType<typeof run>) =>
        Object.values(r.result.simulation.nodes)
          .map((u) => u.resources['cpu-ms'] ?? 0)
          .reduce((a, b) => a + b, 0);
      if (def.platform !== 'sakura')
        expect(cpu(same) - cpu(client)).toBeCloseTo(
          ws.classes['api-async'].count *
            (KIFU_POSITION_CPU_MS - ANALYSIS_RESULT_CPU_MS),
          -3,
        );
    }
  });

  it('併用: サーバーの本解析は同じ実行環境と同じで、エンジンの転送だけ増える', () => {
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
