// 即時反映（オンデマンド ISR）の提案と要件（D-32）。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  ARTICLE_COMMUNITY,
  editsReflectImmediately,
  meetsRequirement,
  newGame,
  playMonth,
  type FrameworkId,
  type GameState,
  type RouteOverrides,
} from './index.ts';

const CF_PAID = 1;
const VERCEL_PRO = 3;
const VPS = 4;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const month = (seed: number) =>
  newGame(CF_PAID, seed).schedule.find((x) => x.id === 'p-ondemand')!.month;
const until = (stackIndex: number, months: number, seed: number) => {
  let s = playMonth(newGame(stackIndex, seed));
  while (s.history.length < months && s.phase === 'playing') s = playMonth(s);
  return s;
};

describe('即時反映の要件', () => {
  it('満たせる構成・満たせない構成（部品しだい）', () => {
    expect(meetsRequirement(CF_PAID, 'on-demand-isr')).toBe(false); // KV
    expect(
      meetsRequirement(CF_PAID, 'on-demand-isr', { isrCache: 'workers-cache' }),
    ).toBe(true);
    expect(meetsRequirement(CF_PAID, 'on-demand-isr', { isrCache: 'r2' })).toBe(
      true,
    );
    expect(meetsRequirement(VERCEL_PRO, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(VPS, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(VPS, 'on-demand-isr', { frontCdn: 'static' })).toBe(
      true,
    );
    // HTML もキャッシュしても、再検証と一緒に CDN の purge の API を呼べば満たせる（D-91）
    expect(meetsRequirement(VPS, 'on-demand-isr', { frontCdn: 'html' })).toBe(
      true,
    );
  });

  it('受ける前のカードに部品ごとの満たせる / 満たせないが出る', () => {
    const s = until(CF_PAID, month(42), 42);
    const e = last(s).events.find((x) => x.id === 'p-ondemand')!;
    const st = e.requirementStatus!;
    expect(st.find((x) => x.label.includes('KV'))).toMatchObject({
      ok: false,
      current: true,
    });
    expect(st.find((x) => x.label.includes('Workers Cache'))?.ok).toBe(true);
  });

  it('受けて満たさない構成では鮮度が 1 段下がり、Workers Cache に替えると戻る', () => {
    const s = until(CF_PAID, month(42), 42);
    const accepted = playMonth(
      applyAction(s, { type: 'respond', eventId: 'p-ondemand', accept: true }),
    );
    const declined = playMonth(
      applyAction(s, { type: 'respond', eventId: 'p-ondemand', accept: false }),
    );
    expect(last(declined).satisfaction.stages.freshness).toBe('good');
    expect(last(accepted).satisfaction.stages.freshness).toBe('fair');
    expect(last(accepted).satisfaction.reasons.freshness).toContain(
      '即時反映の要件を満たしていません',
    );
    const fixed = playMonth(
      applyAction(accepted, {
        type: 'component',
        slot: 'isrCache',
        option: 'workers-cache',
      }),
    );
    expect(last(fixed).satisfaction.stages.freshness).toBe('good');
  });
});

describe('先に即時反映にしていれば苦情は来ず、好評の知らせになる（D-118）', () => {
  const start = (
    stack: number,
    seed: number,
    o: {
      framework?: FrameworkId;
      components?: Record<string, string>;
      revalidateSec?: number;
      routes?: RouteOverrides;
    } = {},
  ) =>
    newGame(
      stack,
      seed,
      ARTICLE_COMMUNITY,
      undefined,
      o.framework ?? 'nextjs',
      o.components,
      o.revalidateSec,
      undefined,
      undefined,
      o.routes,
    );
  const atEvent = (g: GameState) => {
    const at = g.schedule.find((x) => x.id === 'p-ondemand')!.month;
    let s = playMonth(g);
    while (s.history.length < at && s.phase === 'playing') s = playMonth(s);
    return s;
  };
  const SEED = 42;

  it('オンデマンドで消せる構成: 起きる月は台本のまま、苦情（提案）の代わりに好評の知らせ・口コミの上乗せ', () => {
    const g = start(CF_PAID, SEED, {
      components: { isrCache: 'workers-cache' },
      revalidateSec: 0,
    });
    expect(editsReflectImmediately(g)).toBe(true);
    const s = atEvent(g);
    const e = last(s).events.find((x) => x.id === 'p-ondemand')!;
    expect(e.phase).toBe('occurred');
    expect(e.title).toContain('好評');
    expect(e.accept).toBeUndefined();
    expect(s.pendingProposals).not.toContain('p-ondemand');
    // 乱数を引かない: 台本（時期）は始めたときのまま。要件にもしない
    expect(s.schedule).toEqual(g.schedule);
    expect(s.requirements).not.toContain('on-demand-isr');
    // 口コミの上乗せは起きた月から 3 か月（月の終わりに 1 か月減る）
    expect(s.growthBonus).toContainEqual({ add: 0.02, months: 2 });
  });

  it('時間の再検証・消す呼び出しが届かない部品（Workers KV）では今までどおり苦情が来る', () => {
    for (const g of [
      start(CF_PAID, SEED, {
        components: { isrCache: 'workers-cache' },
        revalidateSec: 300,
      }),
      start(CF_PAID, SEED, { revalidateSec: 0 }),
    ]) {
      expect(editsReflectImmediately(g)).toBe(false);
      const s = atEvent(g);
      expect(last(s).events.find((x) => x.id === 'p-ondemand')!.phase).toBe(
        'proposal',
      );
      expect(s.pendingProposals).toContain('p-ondemand');
    }
  });

  it('どの構成で先に手を打っているとみなすか', () => {
    const at = (stack: number, o: Parameters<typeof start>[2]) =>
      editsReflectImmediately(start(stack, SEED, o));
    // 記事を毎回描く（S4）・ISR のキャッシュをしない: キャッシュが無いので苦情は来ない（今まではこれでも来ていた）
    expect(at(VERCEL_PRO, { routes: { article: 'ssr' } })).toBe(true);
    expect(at(VPS, { components: { isrCache: 'none' } })).toBe(true);
    // Vercel・VPS は既定の部品でオンデマンドが届く
    expect(at(VERCEL_PRO, { revalidateSec: 0 })).toBe(true);
    expect(at(VERCEL_PRO, { revalidateSec: 300 })).toBe(false);
    expect(at(VPS, { revalidateSec: 0 })).toBe(true);
    // Astro の記事のキャッシュ（既定はオンデマンド。Cloudflare は Workers Cache で消せる）
    expect(at(CF_PAID, { framework: 'astro' })).toBe(true);
    expect(at(CF_PAID, { framework: 'astro', revalidateSec: 300 })).toBe(false);
    // 静的にビルドし直す: 更新のたびにビルド（オンデマンド）なら即時反映とみなす（D-80）
    expect(
      at(CF_PAID, { routes: { article: 'static-build' }, revalidateSec: 0 }),
    ).toBe(true);
    expect(
      at(CF_PAID, { routes: { article: 'static-build' }, revalidateSec: 3600 }),
    ).toBe(false);
    // KV を DB の代わりにすると、書き込みが他の拠点にすぐ反映されない
    expect(
      at(CF_PAID, {
        components: { isrCache: 'workers-cache', db: 'kv' },
        revalidateSec: 0,
      }),
    ).toBe(false);
  });
});
