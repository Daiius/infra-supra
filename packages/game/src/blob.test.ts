// Vercel の画像の原本の置き場は Vercel Blob（D-46）: Hobby は込み分（保存量 1 GB）に当たり、Pro は保存量とアップロードが課金される。
import { describe, expect, it } from 'vitest';
import { ARTICLE_COMMUNITY, newGame, playMonth } from './index.ts';

const HOBBY = 2;
const PRO = 3;

describe('Vercel Blob（D-46）', () => {
  it('Hobby: 画像の原本（20 GB）が Blob の保存量の込み分 1 GB に当たる', () => {
    const r = playMonth(newGame(HOBBY, 42)).history[0]!;
    const p = r.premises.find((x) => x.text.includes('Vercel Blob は保存量'))!;
    expect(p.hit).toBe(true);
    expect(p.ratio).toBeCloseTo(20);
  });

  it('Pro: 保存量とアップロード（Advanced Operations）の明細が出る（iad1 の単価）', () => {
    const r = playMonth(newGame(PRO, 42)).history[0]!;
    const storage = r.lines.find((l) => l.label === 'vercel blob-storage')!;
    expect(storage.amount).toBeCloseTo(20 * 0.023);
    expect(
      r.lines.some((l) => l.label === 'vercel blob-advanced-operations'),
    ).toBe(true);
  });

  it('最適化しない画像は Blob の URL から配信: 転送はヒットも含む全件、Simple Operations は miss だけ（OCL-2AE853BD）', () => {
    const month1 = (stack: number) =>
      playMonth(
        newGame(stack, 42, ARTICLE_COMMUNITY, undefined, 'nextjs', {
          isrCache: 'default',
          images: 'none',
        }),
      ).history[0]!;
    const r = month1(PRO);
    const amount = (label: string) =>
      r.lines.find((l) => l.label === label)?.amount ?? 0;
    const transferGB = amount('vercel blob-data-transfer') / 0.05;
    const simpleOps = (amount('vercel blob-simple-operations') / 0.4) * 1e6;
    // 全件の転送 = miss（ヒット率 0.9 の残り）× 10 × 原本の大きさ
    expect(transferGB).toBeCloseTo(
      ((simpleOps / 0.1) * ARTICLE_COMMUNITY.unoptimizedImageKB) / 1e6,
      6,
    );
    // 画像の配信は Fast Data Transfer にならない（他の転送は込み分の内）
    expect(amount('vercel fast-data-transfer')).toBe(0);
    // Hobby は画像の配信だけで Blob Data Transfer の込み分 10 GB を超える
    const p = month1(HOBBY).premises.find((x) =>
      x.text.includes('Blob Data Transfer'),
    )!;
    expect(p.hit).toBe(true);
    expect(p.used).toBeCloseTo(transferGB, 6);
  });
});
