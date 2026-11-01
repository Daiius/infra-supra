// 事業者をまたぐ構成（D-52）: 許した組だけ選べる・アカウントの手間・請求が 2 つに分かれる・保存の再生。
import { describe, expect, it } from 'vitest';
import {
  accountUpkeepOf,
  addedAccounts,
  applyAction,
  checkAction,
  componentEffortLabel,
  EFFORT,
  newGame,
  newSave,
  pageWeightOf,
  playMonth,
  replaySave,
  setupSlots,
  STACKS,
  withTurn,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  type GameState,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const AWS = STACKS.findIndex((s) => s.provider === 'aws');
const swap = (option: string) =>
  ({ type: 'component', slot: 'images', option }) as const;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const costOf = (s: GameState, provider: string) =>
  last(s)
    .lines.filter((l) => l.label.startsWith(`${provider} `))
    .reduce((a, l) => a + l.amount, 0);
const line = (s: GameState, label: string) =>
  last(s).lines.find((l) => l.label === label)?.amount ?? 0;

describe('許した組だけ選べる', () => {
  it('始める画面: Vercel の画像のスロットにだけ Cloudflare の部品が出る', () => {
    const images = (stack: number, fw: 'nextjs' | 'vite-spa' = 'nextjs') =>
      setupSlots(ARTICLE_COMMUNITY, stack, fw)
        .find((x) => x.slot === 'images')!
        .options.map((o) => `${o.platform}:${o.id}`);
    for (const fw of ['nextjs', 'vite-spa'] as const)
      expect(images(AWS, fw)).toEqual(
        expect.arrayContaining([
          'cloudflare:cf-images',
          'cloudflare:cf-resize',
        ]),
      );
    for (const fw of ['nextjs', 'vite-spa'] as const)
      expect(images(VERCEL_PRO, fw)).toEqual(
        expect.arrayContaining([
          'cloudflare:cf-images',
          'cloudflare:cf-resize',
        ]),
      );
    expect(images(CF_PAID).some((x) => x.includes('cf-'))).toBe(false);
    expect(images(VPS).some((x) => !x.startsWith('sakura:'))).toBe(false);
  });

  it('ゲーム中: Cloudflare の構成では選べない', () => {
    const s = playMonth(newGame(CF_PAID));
    expect(checkAction(s, swap('cf-images'))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('アカウントの手間', () => {
  it('どの構成も既定の部品ではアカウントが増えない（Vercel の Supabase は構成の既定）', () => {
    for (const s of STACKS) {
      expect(addedAccounts(s.index)).toEqual([]);
      expect(accountUpkeepOf(s.index)).toBe(0);
    }
  });

  it('増えたアカウント 1 つにつき毎月 0.5（既存のまたぐ部品も同じ規則）', () => {
    expect(addedAccounts(VERCEL_PRO, { images: 'cf-images' })).toEqual([
      'cloudflare',
    ]);
    expect(accountUpkeepOf(VERCEL_PRO, { images: 'cf-resize' })).toBe(
      EFFORT.accountUpkeep,
    );
    expect(addedAccounts(CF_PAID, { db: 'hyperdrive' })).toEqual(['supabase']);
    expect(addedAccounts(VPS, { frontCdn: 'static' })).toEqual(['cloudflare']);
    expect(addedAccounts(AWS, { images: 'cf-images' })).toEqual(['cloudflare']);
  });

  it('差すときは部品の手間に一度きりの 1 が足され、翌月から維持 0.5 が引かれる', () => {
    const s = playMonth(newGame(VERCEL_PRO));
    expect(checkAction(s, swap('cf-images'))).toEqual({
      ok: true,
      cost: EFFORT.component.images + EFFORT.accountSetup,
    });
    // 同じ事業者の部品は今までどおり
    expect(checkAction(s, swap('resize'))).toEqual({
      ok: true,
      cost: EFFORT.component.images,
    });
    expect(componentEffortLabel('images', s, 'cf-images')).toEqual([
      `手間 ${EFFORT.component.images + EFFORT.accountSetup}（他の事業者の設定 ${EFFORT.accountSetup} を含む）`,
      '来月から',
      `Cloudflare のアカウントが増える（毎月の維持 ${EFFORT.accountUpkeep}）`,
    ]);
    const swapped = playMonth(applyAction(s, swap('cf-images')));
    expect(last(swapped).effort.actions).toBe(
      EFFORT.component.images + EFFORT.accountSetup,
    );
    const next = playMonth(swapped);
    expect(last(next).effort.accounts).toBe(EFFORT.accountUpkeep);
    expect(last(next).effort.feature).toBe(
      ARTICLE_COMMUNITY.effort.perMonth - EFFORT.accountUpkeep,
    );
    expect(last(playMonth(s)).effort.accounts).toBe(0);
  });

  it('始める画面で選んでも、毎月の維持は同じく引かれる', () => {
    const s = playMonth(
      newGame(VERCEL_PRO, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE, 'nextjs', {
        images: 'cf-resize',
      }),
    );
    expect(last(s).effort.accounts).toBe(EFFORT.accountUpkeep);
  });
});

describe('課金が 2 つの事業者に分かれる', () => {
  it('Cloudflare の請求が加わり、Vercel の Fast Data Transfer・画像の最適化・Blob が減る', () => {
    const s = playMonth(newGame(VERCEL_PRO));
    const plain = playMonth(playMonth(s));
    const cf = playMonth(playMonth(applyAction(s, swap('cf-images'))));
    expect(costOf(plain, 'cloudflare')).toBe(0);
    expect(costOf(cf, 'cloudflare')).toBeGreaterThan(0);
    expect(line(cf, 'cloudflare transformations')).toBeGreaterThan(0);
    expect(line(cf, 'vercel fast-data-transfer')).toBeLessThan(
      line(plain, 'vercel fast-data-transfer') / 2,
    );
    expect(line(cf, 'vercel image-transformations')).toBe(0);
    expect(line(cf, 'vercel blob-storage')).toBe(0);
    // R2 の転送は無料
    expect(line(cf, 'cloudflare egress')).toBe(0);
  });

  it('一律で縮めて R2 に置くなら、変換の請求は無く、配る画像は Vercel の一律で縮めると同じ大きさ', () => {
    const s = playMonth(newGame(VERCEL_PRO));
    const cf = playMonth(playMonth(applyAction(s, swap('cf-resize'))));
    const v = playMonth(playMonth(applyAction(s, swap('resize'))));
    expect(line(cf, 'cloudflare transformations')).toBe(0);
    expect(pageWeightOf(cf)).toBe(pageWeightOf(v));
    expect(last(cf).satisfaction.stages).toEqual(last(v).satisfaction.stages);
    expect(last(cf).stock.imagesGB).toBeCloseTo(last(v).stock.imagesGB, 9);
  });
});

describe('保存の再生', () => {
  it('始める画面の Cloudflare の部品と、ゲーム中の差し替えを含む保存から同じ状態に戻る', () => {
    const turns = [[swap('cf-images')], [], [swap('cf-resize')]];
    let s = playMonth(
      newGame(
        VERCEL_PRO,
        5,
        ARTICLE_COMMUNITY,
        DEFAULT_START_DATE,
        'vite-spa',
        {
          images: 'cf-resize',
        },
      ),
    );
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VERCEL_PRO,
      seed: 5,
      startDate: DEFAULT_START_DATE,
      framework: 'vite-spa',
      components: { images: 'cf-resize' },
    });
    for (const t of turns) {
      for (const a of t) s = applyAction(s, a);
      s = playMonth(s);
      save = withTurn(save, t);
    }
    const back = replaySave(JSON.parse(JSON.stringify(save)));
    expect(back).toEqual(s);
    expect(back.components.images).toBe('cf-resize');
  });
});

describe('AWS + 画像だけ Cloudflare', () => {
  it('SPA: Cloudflare の請求が加わり、Lambda から R2 への書き込みを AWS の転送で数える（月 100 GB までは無料）', () => {
    const s = playMonth(
      newGame(AWS, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE, 'vite-spa'),
    );
    expect(checkAction(s, swap('cf-images'))).toEqual({
      ok: true,
      cost: EFFORT.component.images + EFFORT.accountSetup,
    });
    const cf = playMonth(playMonth(applyAction(s, swap('cf-images'))));
    expect(costOf(cf, 'cloudflare')).toBeGreaterThan(0);
    const out = last(cf).snapshots.find(
      (p) => p.id === 'pool:aws:data-transfer-out:internet-free-transfer',
    );
    expect(out?.ratio).toBeGreaterThan(0);
    expect(out!.ratio).toBeLessThan(1);
    expect(last(cf).effort.accounts).toBe(EFFORT.accountUpkeep);
  });
});
