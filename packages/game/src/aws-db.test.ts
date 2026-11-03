// DB だけ AWS（Vercel × DynamoDB・Aurora。D-114 段 2・prd/14 §3.12）: Vercel の DB のスロットで Supabase の代わりに選べ、
// AWS のアカウントは既定のメールの送信（SES）で既にあるので増えず、DB の応答は AWS からインターネットへの転送で数える。
// 基準プレイ（何もしない・シード 1〜20）の達成数は prd/14 §3.12 に記録した。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  stackName,
  STACKS,
  type FrameworkId,
} from './index.ts';
import type { Choices } from 'catalog';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VERCEL_PRO = idx('vercel-supabase-pro');
const VERCEL_HOBBY = idx('vercel-supabase-hobby');
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
    if (s.phase === 'won') n++;
  }
  return n;
}

describe('DB だけ AWS（D-114 段 2）', () => {
  it('AWS のアカウントは増えない（構成の既定のメールの送信の SES と同じアカウント。D-52 の数え方）', () => {
    for (const db of ['dynamodb', 'aurora', 'aurora-pause'])
      expect(addedAccounts(VERCEL_PRO, { db })).toEqual([]);
    expect(
      addedAccounts(VERCEL_PRO, { db: 'dynamodb', email: 'resend-free' }),
    ).toEqual(['resend']);
  });

  it('構成の名前は実際の組で出す', () => {
    expect(stackName(VERCEL_PRO, 'nextjs', true, { db: 'dynamodb' })).toBe(
      'Vercel Pro + AWS DynamoDB',
    );
    expect(
      stackName(VERCEL_HOBBY, 'vite-spa', true, { db: 'aurora-pause' }),
    ).toBe('Vercel Hobby + AWS Aurora Serverless v2（Vite の SPA）');
  });

  it('Supabase の基本料が消え、AWS の明細になる', () => {
    const s = playMonth(
      newGame(VERCEL_PRO, 1, article, DEFAULT_START_DATE, 'nextjs', {
        db: 'dynamodb',
      }),
    );
    const lines = s.history[0]!.lines;
    expect(lines.some((l) => l.provider === 'supabase')).toBe(false);
    // 1 か月目の応答の転送は AWS 全体の月 100 GB の無料の中（金額 0 の行は出ない）。読み書きの行が AWS に出る
    expect(lines.some((l) => l.provider === 'aws')).toBe(true);
  });

  it('ゲーム中に Supabase から DynamoDB へ差し替えられる（データの移行の後に切り替わる）', () => {
    let s = playMonth(
      newGame(VERCEL_PRO, 1, contract, DEFAULT_START_DATE, 'nextjs'),
    );
    s = playMonth(
      applyActions(s, [{ type: 'component', slot: 'db', option: 'dynamodb' }]),
    );
    for (let i = 0; i < 6 && s.components.db !== 'dynamodb'; i++)
      s = playMonth(applyActions(s, []));
    expect(s.components.db).toBe('dynamodb');
    const last = s.history[s.history.length - 1]!;
    expect(last.lines.some((l) => l.provider === 'aws')).toBe(true);
  });
});

describe('基準プレイ（何もしない・シード 1〜20。prd/14 §3.12）', () => {
  it('受託 × Vercel Pro: DynamoDB は CDN を従量にすると届き（Next.js 17・SPA 20 シード）、Aurora は届かない', () => {
    // 既定の Flat Rate CDN（2 か月目から $20 の段）では届かない。受託の量では従量の CDN がクレジットに収まる（D-120）
    expect(won(contract, VERCEL_PRO, 'nextjs', { db: 'dynamodb' })).toBe(0);
    const onDemand = { db: 'dynamodb', cdnPlan: 'on-demand' };
    // 東京の単価（D-120）で Next.js は 20 → 17
    expect(won(contract, VERCEL_PRO, 'nextjs', onDemand)).toBe(17);
    expect(won(contract, VERCEL_PRO, 'vite-spa', onDemand)).toBe(20);
    expect(won(contract, VERCEL_PRO, 'nextjs', { db: 'aurora-pause' })).toBe(0);
  });

  it('記事 × Vercel Pro: DynamoDB は Astro だけ届き、Next.js は届かない', () => {
    // 既定の Flat Rate CDN（D-120）で CDN の転送が段に込みになり 6 → 20。画像を Cloudflare に出すと Vercel の CDN の量が減り、
    // 従量ならクレジットに収まった分が段の月額になって 20 → 11
    expect(won(article, VERCEL_PRO, 'astro', { db: 'dynamodb' })).toBe(20);
    expect(
      won(article, VERCEL_PRO, 'astro', {
        db: 'dynamodb',
        images: 'cf-resize',
      }),
    ).toBe(11);
    expect(
      won(article, VERCEL_PRO, 'nextjs', {
        db: 'dynamodb',
        images: 'cf-resize',
      }),
    ).toBe(0);
  });
});
