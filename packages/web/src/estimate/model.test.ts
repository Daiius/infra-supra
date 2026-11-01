// 見積モードの計算と入力の扱い（D-73）。
import { describe, expect, it } from 'vitest';
import {
  compareStacks,
  fromQuery,
  normalizeInput,
  runEstimate,
  sortRows,
  toQuery,
  withStack,
} from './model.ts';

describe('normalizeInput', () => {
  it('空の入力は記事コミュニティ・始めた月の PV・既定のフレームワークと一覧の最初の構成', () => {
    const i = normalizeInput({});
    expect(i.template).toBe('article');
    expect(i.pv).toBe(300_000);
    expect(i.framework).toBe('nextjs');
    expect(i.stack).toBe('cloudflare-vinext-free');
    expect(i.revalidateSec).toBe(300);
  });

  it('載せられない構成（Astro × AWS）は、載せられる最初の構成にする', () => {
    const i = normalizeInput({ framework: 'astro', stack: 'aws-amplify' });
    expect(i.stack).not.toBe('aws-amplify');
  });

  it('選べない値は既定にし、PV は範囲に収める', () => {
    const i = normalizeInput({
      template: 'business',
      pv: 1e12,
      revalidateSec: 7,
      imageFormat: 'avif',
      parts: { images: 'none' },
    });
    expect(i.pv).toBe(100_000_000);
    expect(i.revalidateSec).toBe(300);
    // 業務アプリは画像の形式・画像の部品を出さない
    expect(i.imageFormat).toBe('jpeg');
    expect(i.parts.images).toBeUndefined();
  });
});

describe('URL のクエリ', () => {
  it('書いて読むと同じ入力に戻る', () => {
    const i = normalizeInput({
      template: 'article',
      pv: 1_000_000,
      framework: 'vite-spa',
      stack: 'vercel-supabase-pro',
      imageFormat: 'webp',
      variants: 2,
      revalidateSec: 3600,
    });
    expect(normalizeInput(fromQuery(`?${toQuery(i)}`))).toEqual(i);
  });

  it('読めない値は捨てる', () => {
    const q = fromQuery('?pv=abc&c.nope=x&c.images=none');
    expect(q.pv).toBeUndefined();
    expect(q.parts).toEqual({ images: 'none' });
  });
});

describe('runEstimate', () => {
  it('合計は事業者の小計の和（円建ては為替の仮定で換算）', () => {
    const v = runEstimate(normalizeInput({ stack: 'sakura-vps-2gb' }));
    const usd = v.providers.reduce(
      (a, p) => a + (p.currency === 'JPY' ? p.subtotal / 150 : p.subtotal),
      0,
    );
    expect(v.totalUsd).toBeCloseTo(usd, 9);
    expect(v.totalJpy).toBeCloseTo(v.totalUsd * 150, 6);
  });

  it('出典は使った事業者だけで、URL と取得日を持つ', () => {
    const v = runEstimate(normalizeInput({ stack: 'vercel-supabase-pro' }));
    expect(v.sources.map((s) => s.provider).sort()).toEqual(
      ['supabase', 'vercel'].sort(),
    );
    for (const s of v.sources) {
      expect(s.links.length).toBeGreaterThan(0);
      for (const l of s.links) expect(l.url).toMatch(/^https:\/\//);
    }
  });

  it('前提の使用率は高い順で、超えたものは hit', () => {
    const v = runEstimate(
      normalizeInput({ stack: 'cloudflare-vinext-free', pv: 10_000_000 }),
    );
    const ratios = v.thresholds.map((p) => p.ratio ?? 0);
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    expect(v.thresholds.some((p) => p.hit)).toBe(true);
  });
});

describe('compareStacks', () => {
  it('フレームワークを載せられる全構成を並べ、選んだ構成の月額は見積と同じ', () => {
    const i = normalizeInput({ stack: 'cloudflare-vinext-paid' });
    const rows = compareStacks(i);
    expect(rows.length).toBeGreaterThanOrEqual(11);
    const cur = rows.find((r) => r.current)!;
    expect(cur.totalUsd).toBeCloseTo(runEstimate(i).totalUsd, 9);
    const astro = compareStacks(normalizeInput({ framework: 'astro' }));
    expect(astro.some((r) => r.stack.startsWith('aws'))).toBe(false);
  });

  it('並べ替え: 費用の安い順・高い順', () => {
    const rows = compareStacks(normalizeInput({}));
    const asc = sortRows(rows, 'cost').map((r) => r.totalUsd);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(sortRows(rows, 'cost', true).map((r) => r.totalUsd)).toEqual(
      [...asc].reverse(),
    );
  });
});

describe('withStack', () => {
  it('今の構成を選び直しても部品を保ち、別の構成に替えるときだけ既定に戻す（OCL-83383F50）', () => {
    const i = normalizeInput({
      stack: 'cloudflare-vinext-paid',
      parts: { isrCache: 'workers-cache' },
    });
    expect(i.parts.isrCache).toBe('workers-cache');
    const same = normalizeInput({ ...i, ...withStack(i, i.stack) });
    expect(same).toEqual(i);
    const other = normalizeInput({
      ...i,
      ...withStack(i, 'cloudflare-vinext-free'),
    });
    expect(other.stack).toBe('cloudflare-vinext-free');
    expect(other.parts.isrCache).toBe('kv');
  });
});

describe('MAU の換算（OCL-D4F7AE54）', () => {
  it('テンプレートごとに 1 人あたりの月の PV が違う（記事 10・業務アプリ 200）', () => {
    const a = normalizeInput({ template: 'article', pv: 300_000 });
    const b = normalizeInput({ template: 'business', pv: 300_000 });
    expect(a.pv / runEstimate(a).mau).toBeCloseTo(10, 6);
    expect(b.pv / runEstimate(b).mau).toBeCloseTo(200, 6);
  });
});
