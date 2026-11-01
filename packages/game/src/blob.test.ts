// Vercel の画像の原本の置き場は Vercel Blob（D-46）: Hobby は込み分（保存量 1 GB）に当たり、Pro は保存量とアップロードが課金される。
import { describe, expect, it } from 'vitest';
import { newGame, playMonth } from './index.ts';

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
});
