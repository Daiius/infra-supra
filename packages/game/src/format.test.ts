// 画像の形式（D-58）: 同じ見た目の画質で小さくする。画質は下げない。損の側は変換の件数・保存（フォールバック）で表す。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  DEFAULT_START_DATE,
  IMAGE_FORMAT_KB,
  newGame,
  playMonth,
  SCENARIOS,
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
      expect(r.satisfaction.reasons.speed ?? '').not.toContain('画像 150 KB');
    }
    expect(IMAGE_FORMAT_KB.webp / IMAGE_FORMAT_KB.jpeg).toBeCloseTo(0.7, 9);
    expect(IMAGE_FORMAT_KB.avif / IMAGE_FORMAT_KB.webp).toBeCloseTo(0.8, 9);
  });

  it('Next.js の画像の部品（Vercel）は JPEG を選んでも WebP で配り、注記を出す。SPA は JPEG のまま', () => {
    const next = month2(VERCEL_PRO, []);
    expect(
      next.history[1]!.satisfaction.reasons.speed ?? '画像 105 KB',
    ).toContain('画像 105 KB');
    expect(settingNote(next, 'format')).toContain('WebP');
    const spa = month2(VERCEL_PRO, [], 'vite-spa');
    expect(settingNote(spa, 'format')).toBeUndefined();
    expect(month2(CF_PAID, []).history[1]!.settings.imageKB).toBe(150);
  });

  it('Vercel で AVIF は形式ごとにキャッシュするので、画像の変換が WebP の 2 倍に数えられる', () => {
    const webp = month2(VERCEL_PRO, [format(IMAGE_FORMAT_KB.webp)]);
    const avif = month2(VERCEL_PRO, [format(IMAGE_FORMAT_KB.avif)]);
    const t = (s: GameState) =>
      s.history[1]!.lines.find((l) => l.meterId === 'image-transformations')
        ?.amount ?? 0;
    expect(t(avif)).toBeGreaterThan(t(webp));
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
});
