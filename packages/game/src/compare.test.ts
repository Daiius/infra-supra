// 部品のスロットの比較（部品の ⓘ の表と月額の横棒。D-124）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  componentComparison,
  componentSlots,
  DEFAULT_START_DATE,
  newGame,
  setupComponentComparison,
  setupMonthOneEstimate,
  STACKS,
} from './index.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VERCEL_PRO = idx('vercel-supabase-pro');
const article = ARTICLE_COMMUNITY;

describe('部品の比較（D-124）', () => {
  const state = newGame(VERCEL_PRO, 1, article, DEFAULT_START_DATE, 'nextjs');
  const db = componentSlots(state).find((x) => x.slot === 'db')!;
  const rows = componentComparison(state, 'db', db.current);

  it('スロットの選択肢を全部並べ、今の部品の月額は 1 か月目の見込みと同じ', () => {
    expect(rows.map((r) => r.id)).toEqual(db.options.map((o) => o.id));
    const now = rows.find((r) => r.id === db.current)!;
    expect(now.costUsd).toBeCloseTo(
      setupMonthOneEstimate(article, VERCEL_PRO, 'nextjs', {}).costUsd,
      6,
    );
  });

  it('Aurora（停止しない）は最小の容量の固定費の分だけ高く、部品の明細はそのノードだけで数える', () => {
    const aurora = rows.find((r) => r.id === 'aurora')!;
    const now = rows.find((r) => r.id === db.current)!;
    expect(aurora.costUsd! - now.costUsd!).toBeGreaterThan(40);
    expect(aurora.charge).toBeDefined();
    expect(aurora.charge!.fixedUsd + aurora.charge!.usageUsd).toBeGreaterThan(
      40,
    );
    // AWS は構成の既定（メールの送信の SES）で既にあるので増えない（D-52）
    expect(aurora.accounts.map((a) => [a.label, a.added])).toEqual([
      ['AWS', false],
    ]);
  });

  it('始める画面の比較は 1 か月目の見込みと同じ条件で数える', () => {
    const setup = setupComponentComparison(
      article,
      VERCEL_PRO,
      'nextjs',
      { db: 'neon' },
      'db',
    );
    const neon = setup.find((r) => r.id === 'neon')!;
    expect(neon.costUsd).toBeCloseTo(
      setupMonthOneEstimate(article, VERCEL_PRO, 'nextjs', { db: 'neon' })
        .costUsd,
      6,
    );
    expect(neon.accounts.some((a) => a.label === 'Neon')).toBe(true);
  });

  it('画像のスロットは 1 ページの通信量を添える', () => {
    const images = componentComparison(
      state,
      'images',
      componentSlots(state).find((x) => x.slot === 'images')!.current,
    );
    expect(images.every((r) => r.extra?.includes('画像込み'))).toBe(true);
  });
});
