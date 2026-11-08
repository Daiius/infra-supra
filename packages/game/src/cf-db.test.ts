// Cloudflare の DB に他の事業者（Neon・AWS。D-114 段 2b・prd/14 §3.13）: Postgres（Neon・Aurora・RDS）は Hyperdrive を中継に、
// DynamoDB は Worker から直接つなぐ。基準プレイ（何もしない・シード 1〜20）の達成数は prd/14 §3.13 に記録した。
import { describe, expect, it } from 'vitest';
import { meetsReference } from './reference.test-helpers.ts';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  stackName,
  STACKS,
  type FrameworkId,
} from './index.ts';
import type { Choices } from 'catalog';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_PAID = idx('cloudflare-vinext-paid');
const CF_FREE = idx('cloudflare-vinext-free');
const article = ARTICLE_COMMUNITY;
const contract = SCENARIOS['contract-operations']!;

/** 何もしない・シード 1〜20 の達成数。 */
function won(
  sc: Scenario,
  stack: number,
  framework: FrameworkId,
  components: Choices = {},
) {
  let n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let s = playMonth(
      newGame(stack, seed, sc, DEFAULT_START_DATE, framework, components),
    );
    while (s.phase === 'playing') s = playMonth(s);
    if (meetsReference(s)) n++;
  }
  return n;
}

describe('Cloudflare の DB に他の事業者（D-114 段 2b）', () => {
  it('始める画面の DB の欄に、今の 3 つの後ろに Neon・AWS の DB が出る', () => {
    const db = setupSlots(article, CF_PAID, 'nextjs').find(
      (x) => x.slot === 'db',
    )!;
    expect(db.options.map((o) => o.id)).toEqual([
      'd1',
      'kv',
      'hyperdrive',
      'neon',
      'dynamodb',
      'aurora',
      'aurora-pause',
      'rds',
    ]);
  });

  it('増えるアカウント: Neon は 1 つ。AWS は Paid で 1 つ（Free は既定のメールの SES で既にある）', () => {
    expect(addedAccounts(CF_PAID, { db: 'neon' })).toEqual(['neon']);
    expect(addedAccounts(CF_PAID, { db: 'dynamodb' })).toEqual(['aws']);
    expect(addedAccounts(CF_PAID, { db: 'rds' })).toEqual(['aws']);
    expect(addedAccounts(CF_FREE, { db: 'aurora' })).toEqual([]);
  });

  it('構成の名前は「+ vinext」の後ろに中継と DB', () => {
    expect(stackName(CF_PAID, 'nextjs', true, { db: 'neon' })).toBe(
      'Cloudflare Paid + vinext + Hyperdrive + Neon（Launch）',
    );
    expect(stackName(CF_FREE, 'astro', true, { db: 'dynamodb' })).toBe(
      'Cloudflare Free + AWS DynamoDB（Astro）',
    );
    expect(stackName(CF_PAID, 'nextjs', true, { db: 'hyperdrive' })).toBe(
      'Cloudflare Paid + vinext',
    );
  });

  it('ゲーム中に D1 から Neon へ差し替えられる（データの移行の後に切り替わる）', () => {
    let s = playMonth(
      newGame(CF_PAID, 1, contract, DEFAULT_START_DATE, 'nextjs'),
    );
    s = playMonth(
      applyActions(s, [{ type: 'component', slot: 'db', option: 'neon' }]),
    );
    for (let i = 0; i < 6 && s.components.db !== 'neon'; i++)
      s = playMonth(applyActions(s, []));
    expect(s.components.db).toBe('neon');
    const last = s.history[s.history.length - 1]!;
    expect(last.lines.some((l) => l.provider === 'neon')).toBe(true);
  });
});

describe('基準プレイ（何もしない・シード 1〜20。prd/14 §3.13）', () => {
  it('受託 × Cloudflare Paid: Neon・DynamoDB は全シードが届き、Aurora は届かない', () => {
    expect(won(contract, CF_PAID, 'nextjs', { db: 'neon' })).toBe(20);
    expect(won(contract, CF_PAID, 'nextjs', { db: 'dynamodb' })).toBe(20);
    expect(won(contract, CF_PAID, 'nextjs', { db: 'aurora-pause' })).toBe(0);
  });

  it('記事 × Cloudflare Paid × Next.js: RDS も全シードが届く（D1 より高い）', () => {
    expect(won(article, CF_PAID, 'nextjs', { db: 'rds' })).toBe(20);
    expect(won(article, CF_PAID, 'nextjs', { db: 'aurora' })).toBe(0);
  });
});
