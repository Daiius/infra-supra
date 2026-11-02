// DB のバックアップ・PITR（D-93・prd/11 §19）。DB ごとの戻せる期間と、課金のメーターに載ること・料金の形を確かめる。
import { describe, expect, it } from 'vitest';
import { ArchitectureSchema, estimate, resolveWorkload } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { businessApp } from '../templates/index.ts';
import {
  BACKUP_CHANGE_KB_PER_ROW,
  backupStatus,
  PITR_REQUIRED_DAYS,
  SELF_DUMP_COPIES,
} from './backups.ts';
import { composeStack, STACK_DEFS, type Choices } from './index.ts';

const books = loadPriceBooks();
const workload = businessApp(1_000_000);
const w = resolveWorkload(workload);
const changesGB =
  (Object.values(w.classes).reduce(
    (a, f) => a + f.count * f.perRequest.rowsWritten,
    0,
  ) *
    BACKUP_CHANGE_KB_PER_ROW *
    1000) /
  1e9;

const run = (stack: string, choices: Choices) => {
  const architecture = composeStack(stack, choices);
  const r = estimate({ workload, architecture, books });
  // バックアップのノードだけの明細（DB と分け合う基本料は数えない）
  const ids = new Set(
    architecture.nodes
      .filter((n) => n.config.kind === 'db-backup')
      .map((n) => n.id),
  );
  const backupLines = r.bill.lines.filter(
    (l) => l.nodeIds.length > 0 && l.nodeIds.every((id) => ids.has(id)),
  );
  return {
    status: backupStatus(architecture, choices.dbBackup),
    r,
    usd: backupLines.reduce((a, l) => a + (l.amount ?? 0), 0),
    nodes: architecture.nodes.filter((n) => n.config.kind === 'db-backup'),
  };
};

describe('DB のバックアップ（D-93）', () => {
  it.each(
    STACK_DEFS.flatMap((d) =>
      ['default', 'pitr'].map((b) => [d.id, b] as const),
    ),
  )(
    '%s × %s: 構成は検証を通り、バックアップの量はどれもメーターに載る',
    (id, b) => {
      const { r, nodes } = run(id, { dbBackup: b });
      expect(() =>
        ArchitectureSchema.parse(composeStack(id, { dbBackup: b })),
      ).not.toThrow();
      expect(
        r.unmetered.filter((u) => u.resource.startsWith('backup-')),
      ).toEqual([]);
      for (const n of nodes) expect(n.billing).toBeDefined();
    },
  );

  it('既定で戻せる期間: D1 30 日・RDS 7 日・Cloud SQL 7 日。DynamoDB・Firestore・Supabase Pro・VPS は戻せない', () => {
    const days = (stack: string, c: Choices = {}) =>
      run(stack, c).status.map((s) => s.pitrDays);
    expect(days('cloudflare-vinext-paid')).toEqual([30]);
    expect(days('cloudflare-vinext-free')).toEqual([7]);
    expect(days('aws-amplify', { db: 'rds' })).toEqual([7]);
    expect(days('gcp-cloud-run', { db: 'cloud-sql' })).toEqual([7]);
    expect(days('aws-amplify')).toEqual([0]);
    expect(days('gcp-cloud-run')).toEqual([0]);
    expect(days('vercel-supabase-pro')).toEqual([0]);
    expect(days('sakura-vps-2gb')).toEqual([0]);
    expect(days('aws-amplify', { db: 'aurora' })).toEqual([1]);
    expect(days('vercel-supabase-pro', { db: 'neon' })).toEqual([1]);
    // 付けると 7 日以上
    for (const [s, c] of [
      ['aws-amplify', {}],
      ['aws-amplify', { db: 'aurora' }],
      ['gcp-cloud-run', {}],
      ['vercel-supabase-pro', {}],
      ['vercel-supabase-pro', { db: 'neon' }],
      ['sakura-vps-2gb', {}],
      ['cloudflare-vinext-paid', { db: 'hyperdrive' }],
    ] as const)
      expect(
        Math.min(...days(s, { ...c, dbBackup: 'pitr' })),
      ).toBeGreaterThanOrEqual(PITR_REQUIRED_DAYS);
    // 付けられない DB
    for (const [s, c] of [
      ['aws-amplify', { db: 'dsql' }],
      ['cloudflare-vinext-paid', { db: 'kv' }],
      ['vercel-supabase-hobby', {}],
      ['vercel-supabase-hobby', { db: 'neon' }],
    ] as const) {
      const st = run(s, { ...c, dbBackup: 'pitr' }).status;
      expect(st.every((x) => !x.extendable)).toBe(true);
      expect(Math.max(...st.map((x) => x.pitrDays))).toBeLessThan(
        PITR_REQUIRED_DAYS,
      );
    }
  });

  it('料金の形: Supabase は時間のアドオン、DynamoDB はテーブルの大きさ、RDS は割り当ての中は無料、VPS は月額 + 込みの容量', () => {
    expect(run('vercel-supabase-pro', { dbBackup: 'pitr' }).usd).toBeCloseTo(
      730 * 0.14416,
      6,
    );
    expect(run('aws-amplify', { dbBackup: 'pitr' }).usd).toBeCloseTo(
      w.storage.dbGB * 0.228,
      6,
    );
    // RDS の既定の 7 日は、割り当て（20 GiB から）の中に収まる
    expect(run('aws-amplify', { db: 'rds' }).usd).toBe(0);
    // Cloud SQL は全体 1 つ + 7 日分の差分
    expect(run('gcp-cloud-run', { db: 'cloud-sql' }).usd).toBeCloseTo(
      (w.storage.dbGB + (changesGB * 7) / 30) * 0.104,
      6,
    );
    // Neon Launch は窓の間の変更の履歴だけ
    expect(
      run('vercel-supabase-pro', { db: 'neon', dbBackup: 'pitr' }).usd,
    ).toBeCloseTo(((changesGB * 7) / 30) * 0.2, 6);
    // VPS: 7 日分のダンプ + バイナリログが 100 GiB に収まれば、月額 495 円だけ
    const vps = run('sakura-vps-2gb', { dbBackup: 'pitr' });
    expect(SELF_DUMP_COPIES * w.storage.dbGB).toBeLessThan(100);
    expect(vps.usd).toBe(495);
    expect(vps.status[0]!.selfManaged).toBe(true);
    // D1 は既定で足り、費用のノードを足さない
    expect(run('cloudflare-vinext-paid', {}).nodes).toEqual([]);
    expect(run('cloudflare-vinext-paid', { dbBackup: 'pitr' }).nodes).toEqual(
      [],
    );
  });
});
