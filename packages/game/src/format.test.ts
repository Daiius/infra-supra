// 画像の形式（D-58）: 同じ見た目の画質で小さくする。画質は下げない。損の側は変換の件数・保存（フォールバック）で表す。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  DEFAULT_START_DATE,
  IMAGE_FORMAT_KB,
  newGame,
  playMonth,
  SCENARIOS,
  checkAction,
  fixedImageFormat,
  fixedSettingValue,
  imageFormatInactiveReason,
  pageWeightOf,
  settingInactiveReason,
  settingNote,
  type Action,
  type GameState,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;

const format = (kb: number): Action => ({
  type: 'set',
  key: 'format',
  value: kb,
});
const images = (option: string): Action => ({
  type: 'component',
  slot: 'images',
  option,
});

/** 1 か月目の終わりに行動して、2 か月目の報告。 */
function month2(
  stack: number,
  acts: Action[],
  framework: 'nextjs' | 'vite-spa' = 'nextjs',
): GameState {
  const s = playMonth(
    newGame(stack, 42, article, DEFAULT_START_DATE, framework),
  );
  return playMonth(applyActions(s, acts));
}
/** 「事業者 メーター」で明細を引く（行の名前は表示名なので、ID で引く。D-75）。 */
const usage = (s: GameState, id: string) =>
  s.history[1]!.lines.find((l) => `${l.provider} ${l.meterId ?? ''}` === id)
    ?.amount ?? 0;

describe('画像の形式（D-58）', () => {
  it('WebP・AVIF は小さく配り、画質は下げない（CF Paid）', () => {
    for (const kb of [IMAGE_FORMAT_KB.webp, IMAGE_FORMAT_KB.avif]) {
      const r = month2(CF_PAID, [format(kb)]).history[1]!;
      expect(r.satisfaction.stages.quality).toBe('good');
      expect(r.satisfaction.reasons.speed ?? '').not.toContain('画像 150 kB');
    }
    expect(IMAGE_FORMAT_KB.webp / IMAGE_FORMAT_KB.jpeg).toBeCloseTo(0.7, 9);
    expect(IMAGE_FORMAT_KB.avif / IMAGE_FORMAT_KB.webp).toBeCloseTo(0.8, 9);
  });

  it('Next.js の画像の部品（Vercel）は WebP に固定し、形式の欄を無効にして理由を出す。SPA は選べる（D-58 の補足）', () => {
    const next = month2(VERCEL_PRO, []);
    expect(
      next.history[1]!.satisfaction.reasons.speed ?? '画像 105 kB',
    ).toContain('画像 105 kB');
    expect(settingInactiveReason(next, 'format')).toContain('WebP');
    expect(settingInactiveReason(next, 'format')).toContain('next/image');
    expect(settingNote(next, 'format')).toBeUndefined();
    // 欄が無効なので、形式を替える行動は選べない（状態は変わらない）
    expect(checkAction(next, format(IMAGE_FORMAT_KB.avif)).ok).toBe(false);
    const spa = month2(VERCEL_PRO, [], 'vite-spa');
    expect(settingInactiveReason(spa, 'format')).toBeUndefined();
    expect(settingNote(spa, 'format')).toBeUndefined();
    expect(month2(CF_PAID, []).history[1]!.settings.imageKB).toBe(150);
  });

  it('固定の形式は、状態に残った形式の値（JPEG・AVIF）に依らずその形式で数える', () => {
    const at = (imageKB: number) => {
      const s = playMonth(
        newGame(VERCEL_PRO, 42, article, DEFAULT_START_DATE, 'nextjs'),
      );
      return playMonth({ ...s, settings: { ...s.settings, imageKB } })
        .history[1]!;
    };
    const jpeg = at(IMAGE_FORMAT_KB.jpeg);
    const avif = at(IMAGE_FORMAT_KB.avif);
    expect(avif.lines).toEqual(jpeg.lines);
    expect(avif.satisfaction.reasons.speed ?? '画像 105 kB').toContain(
      '画像 105 kB',
    );
  });

  it('Cloudflare の構成の Images（バインディング）は形式を選べ、選んだ形式で数える。注記は Worker のコードが決める旨', () => {
    const jpeg = month2(CF_PAID, []);
    expect(settingInactiveReason(jpeg, 'format')).toBeUndefined();
    expect(settingNote(jpeg, 'format')).toContain('Worker のコード');
    expect(pageWeightOf(jpeg)).toBe('1 ページ約 1.3 MB');
    const webp = month2(CF_PAID, [format(IMAGE_FORMAT_KB.webp)]);
    expect(pageWeightOf(webp)).toBe('1 ページ約 1 MB');
  });

  it('閲覧のときに変換する他の部品も欄を無効にして固定する: cf-images は AVIF・Bunny Optimizer は WebP・Astro の <Image /> は WebP', () => {
    const base = playMonth(newGame(VERCEL_PRO, 42, article));
    const cf = applyActions(base, [images('cf-images')]);
    expect(settingInactiveReason(cf, 'format')).toContain('AVIF');
    expect(settingInactiveReason(cf, 'format')).toContain('format=auto');
    const bunny = applyActions(base, [images('bunny-images')]);
    expect(settingInactiveReason(bunny, 'format')).toContain('WebP');
    expect(settingInactiveReason(bunny, 'format')).toContain('Optimizer');
    const astro = playMonth(
      newGame(VERCEL_PRO, 42, article, DEFAULT_START_DATE, 'astro'),
    );
    expect(settingInactiveReason(astro, 'format')).toContain('<Image />');
    const cfAstro = playMonth(
      newGame(CF_PAID, 42, article, DEFAULT_START_DATE, 'astro'),
    );
    expect(settingInactiveReason(cfAstro, 'format')).toContain(
      'バインディング',
    );
    // cf-images は AVIF の大きさで数える（JPEG のままでも）
    // 記事のページ: HTML 60 + JS・CSS 400 + 本文 5 × 84 + サムネイル 4 × 8.4 = 914 KB
    expect(pageWeightOf(cf)).toBe('1 ページ約 914 kB');
  });

  it('Netlify Image CDN は WebP に固定（SPA でも）', () => {
    expect(
      imageFormatInactiveReason('netlify', 'vite-spa', 'default'),
    ).toContain('Netlify Image CDN');
    expect(fixedImageFormat('netlify', 'vite-spa', 'default')?.format).toBe(
      'webp',
    );
    // Vercel・VPS の SPA は形式を自分で決めるので選べる
    expect(fixedImageFormat('vercel', 'vite-spa', 'default')).toBeUndefined();
    expect(fixedImageFormat('sakura', 'vite-spa', 'default')).toBeUndefined();
  });

  it('投稿のときにサイズ違いを作る（R2）で WebP は、JPEG のフォールバックも置くので保存が増える（Cloudflare Images の閲覧のときの変換は形式で増えない）', () => {
    const storage = (acts: Action[]) =>
      usage(month2(CF_PAID, acts), 'cloudflare storage');
    expect(
      storage([images('r2-variants'), format(IMAGE_FORMAT_KB.webp)]),
    ).toBeGreaterThan(storage([images('r2-variants')]));
    const cost = (acts: Action[]) =>
      usage(month2(CF_PAID, acts), 'cloudflare transformations');
    expect(cost([])).toBeGreaterThan(0);
    expect(cost([format(IMAGE_FORMAT_KB.avif)])).toBeCloseTo(cost([]), 6);
  });

  it('一律で縮めて置く構成で WebP は、配る大きさは小さく、保存は JPEG のフォールバックの分だけ増える', () => {
    const grow = (acts: Action[]) => {
      let s = playMonth(newGame(VPS, 42, article, DEFAULT_START_DATE));
      s = playMonth(applyActions(s, acts));
      s = playMonth(applyActions(s, []));
      return s.stock.imagesGB - s.history[1]!.stock.imagesGB;
    };
    expect(
      grow([images('resize'), format(IMAGE_FORMAT_KB.webp)]),
    ).toBeGreaterThan(grow([images('resize')]));
  });

  it('最適化しない（原本）では形式の設定は効かない', () => {
    const s = applyActions(playMonth(newGame(CF_PAID, 42, article)), [
      images('none'),
    ]);
    expect(settingInactiveReason(s, 'format')).toContain('原本の形式のまま');
  });

  it('投稿のときに作る（r2-variants）・一律で縮めるは閲覧のときに変換しないので、欄は有効のまま', () => {
    const base = playMonth(newGame(CF_PAID, 42, article));
    for (const id of ['r2-variants', 'resize'])
      expect(
        settingInactiveReason(applyActions(base, [images(id)]), 'format'),
      ).toBeUndefined();
  });
});

describe('固定した形式の表示の値（OCL-CAAEFA7D）', () => {
  it('固定中は固定の形式の大きさ、選べる構成では undefined。保存した値は替えない', () => {
    const vercel = playMonth(newGame(VERCEL_PRO, 42, article));
    expect(fixedSettingValue(vercel, 'format')).toBe(IMAGE_FORMAT_KB.webp);
    expect(vercel.settings.imageKB).toBe(IMAGE_FORMAT_KB.jpeg);
    expect(
      fixedSettingValue(applyActions(vercel, [images('cf-images')]), 'format'),
    ).toBe(IMAGE_FORMAT_KB.avif);
    expect(
      fixedSettingValue(playMonth(newGame(CF_PAID, 42, article)), 'format'),
    ).toBeUndefined();
    expect(fixedSettingValue(vercel, 'variants')).toBeUndefined();
  });
});
