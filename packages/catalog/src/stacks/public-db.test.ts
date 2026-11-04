// 公開の口へ出られる土台の処理 → 公開の口を持つ DB（D-114 段 2d・prd/14 §3.15）。規則で一括に開いた組の形・転送・差し替えの途中と、
// 規則ごとの実在の golden（CP-14。1 か月目の見積の合計。料金データを直したら取り直す）。
import { describe, expect, it } from 'vitest';
import { estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { articleCommunity } from '../templates/index.ts';
import { VPS_RESIDENT_WITHOUT_DB_GB } from './cross.ts';
import { CONNECTION_RULES, rulesFor } from './connections.ts';
import { CROSS_PARTS } from './parts.ts';
import {
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  stackDef,
  type Choices,
  type Platform,
} from './index.ts';

const books = loadPriceBooks();
const node = (a: ReturnType<typeof composeStack>, id: string) =>
  a.nodes.find((n) => n.id === id);

describe('公開の口の DB を規則で開く（D-114 段 2d）', () => {
  it('開いた土台 × DB の部品（土台の事業者自身の DB は出ない）', () => {
    const dbs = (p: Platform) =>
      componentsOf(p, 'db')
        .filter((c) => c.platform !== p)
        .map((c) => c.id);
    const aws = ['dynamodb', 'aurora', 'aurora-pause', 'rds'];
    expect(dbs('sakura')).toEqual(['neon', 'supabase', ...aws]);
    expect(dbs('gcp')).toEqual(['neon', 'supabase', ...aws]);
    expect(dbs('aws')).toEqual(['neon', 'supabase']);
    // OpenNext は AWS の構成の DB の部品を自分の部品として持つ（同じ部品が 2 つ出ない）
    expect(
      componentsOf('aws-opennext', 'db').filter((c) => c.id === 'dynamodb'),
    ).toHaveLength(1);
    expect(dbs('aws-opennext')).toEqual(['neon', 'supabase']);
    expect(dbs('netlify')).toEqual(['neon', ...aws]);
  });

  it('規則は公開の口だけ（中継なし）。土台ごとのつなぎ方の文と出典を持つ', () => {
    const ids = [
      'public-compute-neon',
      'public-compute-supabase',
      'public-compute-dynamodb',
      'public-compute-aws-sql',
    ];
    for (const id of ids) {
      const r = CONNECTION_RULES.find((x) => x.id === id)!;
      expect(r.verdict).toBe('ok');
      expect(r.relay).toBeUndefined();
      expect(r.partNote).toBeTruthy();
      expect(r.sources.length).toBeGreaterThan(0);
      expect(['https-api', 'tcp-sql']).toContain(r.to.port);
    }
    // 1 つの土台 × 部品に当たる規則は 1 つ（説明の文が重ならない）
    for (const part of CROSS_PARTS.filter((p) => p.slot === 'db'))
      for (const host of [
        'sakura',
        'gcp',
        'aws',
        'aws-opennext',
        'netlify',
      ] as const)
        expect(
          rulesFor(host, part).length,
          `${host} × ${part.id}`,
        ).toBeLessThanOrEqual(1);
  });

  it('さくらの VPS: DB を外に出すと VPS は MySQL を動かさず、DB を読む経路の VPS の後に DB が来る', () => {
    const a = composeStack('sakura-vps-2gb', { db: 'neon' });
    const vps = node(a, 'vps')!;
    expect(vps.config).toMatchObject({
      kind: 'host',
      residentMemoryGB: VPS_RESIDENT_WITHOUT_DB_GB,
      dbCpuMsPerQuery: 0,
      storesDb: false,
    });
    expect(a.routes['document-ssr']).toEqual(['vps', 'db']);
    expect(a.routes['isr-revalidate']).toEqual(['vps', 'db']);
    expect(a.routes.api).toEqual(['vps', 'db']);
    expect(a.routes['document-isr']).toEqual(['vps']);
    expect(node(a, 'db')!.billing!.provider).toBe('neon');
    // TCP（接続のプール）でつなぐので serverless driver の事実は出さない
    expect(node(a, 'db')!.facts).not.toContain('serverless-driver');
    expect(a.name).toBe('さくらの VPS 2GB（東京） + Neon（Launch）');
    // 既定（VPS の MySQL）は今までの構成のまま
    expect(composeStack('sakura-vps-2gb', { db: 'mysql' })).toEqual(
      composeStack('sakura-vps-2gb'),
    );
  });

  it('さくらの VPS の差し替えの途中: MySQL → 他の事業者は移す先を経路に載せずに足し、戻すときは VPS に MySQL のメモリを残す', () => {
    const to = composeStack(
      'sakura-vps-2gb',
      { db: 'mysql' },
      { standby: { db: 'supabase' } },
    );
    expect(node(to, 'db-next')!.billing!.provider).toBe('supabase');
    expect(Object.values(to.routes).flat()).not.toContain('db-next');
    const back = composeStack(
      'sakura-vps-2gb',
      { db: 'supabase' },
      { standby: { db: 'mysql' } },
    );
    expect(node(back, 'vps')!.config).toMatchObject({
      residentMemoryGB: 1.35,
      dbCpuMsPerQuery: 0,
    });
    expect(
      (node(back, 'vps')!.config as { storesDb?: boolean }).storesDb,
    ).toBeUndefined();
  });

  it('Google Cloud・AWS は仮の DB を部品に替え、土台の DB を置かない。戻す途中は土台の DB を移す先として足す', () => {
    for (const id of ['gcp-cloud-run', 'aws-amplify', 'aws-opennext']) {
      const a = composeStack(id, { db: 'neon' });
      const dbs = a.nodes.filter((n) => n.role === 'sql-db');
      expect(dbs.map((n) => n.billing?.provider)).toEqual(['neon']);
    }
    const back = composeStack(
      'gcp-cloud-run',
      { db: 'neon' },
      { standby: { db: 'firestore' } },
    );
    expect(node(back, 'firestore')!.billing!.provider).toBe('gcp');
    expect(Object.values(back.routes).flat()).not.toContain('firestore');
  });

  it('転送: AWS の DB の応答はインターネットへの転送（土台が AWS の外なので同じリージョンの扱いによらない）。Neon・Supabase は DB のノードのメーター', () => {
    for (const id of [
      'sakura-vps-2gb',
      'gcp-cloud-run',
      'netlify-supabase-pro',
    ])
      for (const db of ['dynamodb', 'aurora', 'rds']) {
        const a = composeStack(id, { db });
        expect(node(a, 'aws-db-out')!.facts, `${id} × ${db}`).toEqual([
          'db-out-internet',
        ]);
        expect(a.routes.api!.slice(-2)).toEqual(['aws-db-out', 'db']);
      }
    for (const db of ['neon', 'supabase']) {
      const a = composeStack('aws-amplify', { db });
      expect(a.nodes.filter((n) => n.id.endsWith('-out'))).toEqual([]);
      expect(node(a, 'db')!.billing!.meters?.['egress-gb']).toBeDefined();
    }
  });

  it('Supabase の部品は既定の Supabase と同じ課金（土台が有料なら Pro）と、共有のプールの事実', () => {
    const a = composeStack('aws-amplify', { db: 'supabase' });
    expect(node(a, 'db')!.billing).toEqual(
      node(composeStack('vercel-supabase-pro'), 'db')!.billing,
    );
    expect(node(a, 'db')!.facts).toEqual(['shared-pooler', 'pooler-egress']);
    expect(a.name).toBe('AWS（Amplify Hosting） + Supabase Pro');
  });

  // 規則ごとの実在の golden（CP-14）: 記事コミュニティ・月 30 万 PV・既定の部品の 1 か月目の見積（税抜）
  const total = (id: string, c: Choices, framework?: 'vite-spa') => {
    const def = stackDef(id);
    return estimate({
      workload: applyComponentsToWorkload(
        articleCommunity(300_000),
        def.platform,
        c,
        { originalImageKB: 400 },
      ),
      architecture: composeStack(id, c, framework ? { framework } : {}),
      books,
    }).bill.totals;
  };
  it('規則ごとの golden（public-compute-neon・supabase・dynamodb・aws-sql）', () => {
    expect({
      neon: total('sakura-vps-2gb', { db: 'neon' }),
      supabase: total('aws-amplify', { db: 'supabase' }),
      dynamodb: total('gcp-cloud-run', { db: 'dynamodb' }),
      awsSql: total('sakura-vps-2gb', { db: 'rds' }),
    }).toMatchInlineSnapshot(`
      {
        "awsSql": {
          "JPY": 1958,
          "USD": 22.300833333333333,
        },
        "dynamodb": {
          "USD": 25.98446489522131,
        },
        "neon": {
          "JPY": 1958,
          "USD": 20.74200407022335,
        },
        "supabase": {
          "USD": 37.72029711012453,
        },
      }
    `);
  });
});
