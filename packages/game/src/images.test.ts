// 画像の大きさ（D-47）: 最適化しない＝原本・投稿のときに一律で縮めて置く部品・記事のデザインの刷新の提案。
import { describe, expect, it } from 'vitest';
import { applyComponentsToWorkload, componentsOf } from 'catalog';
import {
  actionEffort,
  applyActions,
  DEFAULT_START_DATE,
  IMAGE_REDESIGN_ID,
  newGame,
  pageWeightOf,
  playMonth,
  playStrategy,
  retryHintsOf,
  SCENARIOS,
  componentFlavor,
  setupSlots,
  type Action,
  type GameState,
} from './index.ts';
import type { Scenario } from './scenario.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;

/** 刷新の提案を 3 か月目に必ず出す（確率 1）。chance を渡すとその確率。 */
const withRedesign = (chance = 1, month = 3): Scenario => ({
  ...article,
  id: 't-redesign',
  events: article.events.map((e) =>
    e.id === IMAGE_REDESIGN_ID
      ? { ...e, when: { type: 'window', from: month, to: month, chance } }
      : e,
  ),
});

/** 1 か月目の終わりに first の行動、刷新の提案が来たら respond（undefined なら返事をしない＝断る）。 */
function play(
  sc: Scenario,
  stack: number,
  first: Action[],
  respond: boolean | undefined,
  months = 12,
): GameState {
  let s = playMonth(newGame(stack, 42, sc, DEFAULT_START_DATE));
  s = applyActions(s, first);
  while (s.phase === 'playing' && s.history.length < months) {
    const acts: Action[] =
      respond !== undefined && s.pendingProposals.includes(IMAGE_REDESIGN_ID)
        ? [{ type: 'respond', eventId: IMAGE_REDESIGN_ID, accept: respond }]
        : [];
    s = playMonth(applyActions(s, acts));
  }
  return s;
}
const images = (option: string): Action[] => [
  { type: 'component', slot: 'images', option },
];

describe('画像の大きさ（D-47）', () => {
  it('最適化しないで配る大きさは原本（在庫の 1 枚の大きさ）と同じ', () => {
    for (const sc of [article, contract])
      expect(sc.unoptimizedImageKB).toBeCloseTo(sc.stock!.gbPerImage * 1e6, 9);
  });

  it('一律で縮めて置く部品は 3 事業者で選べ、変換のサービスを使わずサイズ違いは 1 種', () => {
    for (const p of ['cloudflare', 'vercel', 'sakura'] as const)
      expect(componentsOf(p, 'images').map((o) => o.id)).toContain('resize');
    const w = applyComponentsToWorkload(
      article.template(300_000),
      'cloudflare',
      { images: 'resize' },
      { resizedImageKB: 400 },
    );
    expect(w.images).toMatchObject({
      sizeKB: 400,
      variants: 1,
      transformAt: 'none',
    });
  });

  it('始める画面でも 3 事業者で選べ、短い説明がある', () => {
    for (const stack of [CF_PAID, VERCEL_PRO, VPS]) {
      const slot = setupSlots(article, stack, 'nextjs').find(
        (x) => x.slot === 'images',
      )!;
      const opt = slot.options.find((o) => o.id === 'resize')!;
      expect(opt).toBeDefined();
      expect(componentFlavor(opt)).toContain('投稿のときに一度だけ縮めて置く');
    }
  });

  it('1 ページの通信量: 既定 約 1.2 MB・最適化しない 約 20.5 MB・一律で縮める 約 2.5 MB', () => {
    const s = playMonth(newGame(CF_PAID, 42, article));
    expect(pageWeightOf(s)).toBe('1 ページ約 1.2 MB');
    expect(pageWeightOf(s, 'none')).toBe('1 ページ約 20.5 MB');
    expect(pageWeightOf(s, 'resize')).toBe('1 ページ約 2.5 MB');
  });

  it('最適化しない（原本）は速さが「悪い」で、理由に 1 ページの通信量を出す。一律で縮めるは「普通」', () => {
    const none = play(withRedesign(0), CF_PAID, images('none'), undefined, 3);
    const r = none.history[2]!;
    expect(r.satisfaction.stages.speed).toBe('bad');
    expect(r.satisfaction.reasons.speed).toContain('1 ページ約 20.5 MB');
    const resize = play(
      withRedesign(0),
      CF_PAID,
      images('resize'),
      undefined,
      3,
    );
    expect(resize.history[2]!.satisfaction.stages.speed).toBe('fair');
  });

  it('一律で縮めると、保存量（在庫の GB）の増え方が原本より小さい', () => {
    const grow = (opt: Action[]) => {
      const s = play(withRedesign(0), VPS, opt, undefined, 4);
      return s.stock.imagesGB - s.history[1]!.stock.imagesGB;
    };
    const resize = grow(images('resize'));
    expect(resize).toBeLessThan(grow([]) / 5);
    expect(resize).toBeGreaterThan(0);
  });

  it('Vercel の最適化しない（原本）は転送量の費用が大きく増える', () => {
    const cost = (opt: Action[]) =>
      play(withRedesign(0), VERCEL_PRO, opt, undefined, 2).history[1]!
        .infraCost;
    expect(cost(images('none'))).toBeGreaterThan(cost([]) * 2);
  });
});

describe('記事のデザインの刷新の提案（D-47）', () => {
  it('確率 0 なら出ない・1 なら出る', () => {
    const s0 = newGame(CF_PAID, 42, withRedesign(0));
    expect(s0.schedule.some((x) => x.id === IMAGE_REDESIGN_ID)).toBe(false);
    const s1 = newGame(CF_PAID, 42, withRedesign(1));
    expect(s1.schedule.find((x) => x.id === IMAGE_REDESIGN_ID)?.month).toBe(3);
  });

  it('受ける手間は構成で違う: 原本あり 1・一律で縮めた 2・原本を配っている 0', () => {
    const at = (opt: Action[]) => {
      const s = play(withRedesign(), CF_PAID, opt, undefined, 3);
      expect(s.pendingProposals).toContain(IMAGE_REDESIGN_ID);
      return actionEffort(s, {
        type: 'respond',
        eventId: IMAGE_REDESIGN_ID,
        accept: true,
      });
    };
    expect(at([])).toBe(1);
    expect(at(images('resize'))).toBe(2);
    expect(at(images('none'))).toBe(0);
  });

  it('断ると、その後 2 か月だけ画質が 1 段下がる（原本を配っている構成は下がらない）', () => {
    const declined = play(withRedesign(), CF_PAID, [], false, 7);
    const q = declined.history.map((h) => h.satisfaction.stages.quality);
    expect(q.slice(0, 3)).toEqual(['good', 'good', 'good']);
    expect(q.slice(3, 5)).toEqual(['fair', 'fair']);
    expect(q[5]).toBe('good');
    expect(declined.history[3]!.satisfaction.reasons.quality).toContain(
      'デザインの刷新を断った',
    );
    const accepted = play(withRedesign(), CF_PAID, [], true, 7);
    expect(accepted.history.map((h) => h.satisfaction.stages.quality)).toEqual(
      Array(7).fill('good'),
    );
    const none = play(withRedesign(), CF_PAID, images('none'), false, 7);
    expect(none.history[3]!.satisfaction.stages.quality).toBe('good');
  });

  it('一律で縮めた構成で受けても、原本の無い粗い画像が多い間は画質が下がる（原本がある構成は下がらない）', () => {
    const sc = withRedesign(1, 8);
    const resize = play(sc, CF_PAID, images('resize'), true, 10);
    const r = resize.history[8]!;
    expect(r.satisfaction.stages.quality).toBe('fair');
    expect(r.satisfaction.reasons.quality).toContain('原本の無い粗い画像');
    const original = play(sc, CF_PAID, [], true, 10);
    expect(original.history[8]!.satisfaction.stages.quality).toBe('good');
  });
});

describe('速さが「悪い」月は PV の伸びが下がる（D-47）', () => {
  const noPenalty: Scenario = {
    ...withRedesign(0),
    growth: { ...article.growth, slowPenalty: 0 },
  };

  it('原本を配る月は伸びが 3 ポイント下がり、理由に出る。一律で縮める（普通）は下がらない', () => {
    const s = play(withRedesign(0), CF_PAID, images('none'), undefined, 4);
    const f = play(noPenalty, CF_PAID, images('none'), undefined, 4);
    const r = s.history[2]!;
    expect(r.satisfaction.slowPenalty).toBeCloseTo(0.03, 12);
    expect(r.satisfaction.growth).toBeCloseTo(
      f.history[2]!.satisfaction.growth - 0.03,
      9,
    );
    expect(r.satisfaction.reasons.speed).toContain(
      '速さが悪く PV の伸びが約 3% 下がった',
    );
    const resize = play(
      withRedesign(0),
      CF_PAID,
      images('resize'),
      undefined,
      4,
    );
    expect(resize.history.some((h) => h.satisfaction.slowPenalty)).toBe(false);
  });

  it('CF Paid でも原本を配り続けると目標に届かず、ヒントに出る', () => {
    const st = playStrategy(
      { id: 'x', label: 'x', stackIndex: CF_PAID, actions: [images('none')] },
      42,
      article,
    );
    expect(st.end?.reason).toBe('goal');
    const hint = retryHintsOf(st).find((x) => x.kind === 'slow');
    expect(hint?.what).toContain('速さが悪く PV の伸びが下がった');
    expect(hint?.what).toContain('1 ページ約 20.5 MB');
  });
});
