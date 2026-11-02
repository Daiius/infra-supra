// Astro の API の置き場（D-69・prd/10 §9.5）: Vercel・VPS の Astro のサーバーから Cloudflare Workers + D1 を呼ぶ／
// Cloudflare の Astro（静的 + Worker の SSR）+ さくらの VPS の API。許した組だけ選べ、他の組は既定に戻る。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  applyAction,
  checkAction,
  componentPreview,
  DEFAULT_START_DATE,
  EFFORT,
  newGame,
  playMonth,
  SCENARIOS,
  selfHostedOf,
  setupSlots,
  stackName,
  STACKS,
  upkeepOf,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_FREE = idx('cloudflare-vinext-free');
const CF_PAID = idx('cloudflare-vinext-paid');
const VERCEL_PRO = idx('vercel-supabase-pro');
const VPS_2GB = idx('sakura-vps-2gb');
const WORKERS = { api: 'cf-workers-astro' };
const VPS2 = { api: 'sakura-vps-2gb' };

const game = (stack: number, components = {}, seed = 1, sc = article) =>
  newGame(stack, seed, sc, DEFAULT_START_DATE, 'astro', components);

/** 何もしない・シード 1〜20 の達成数と所持金の中央値（始める画面で選んだ部品）。 */
function run(sc: typeof article, stack: number, components: object) {
  let won = 0;
  const cash: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    let st = game(stack, components, seed, sc);
    while (st.phase === 'playing') st = playMonth(st);
    if (st.phase === 'won') won++;
    cash.push(st.cash);
  }
  cash.sort((a, b) => a - b);
  return { won, median: (cash[9]! + cash[10]!) / 2 };
}

describe('Astro の API の置き場（D-69）', () => {
  it('始める画面: 許した組だけ API の置き場が出て、選ぶと構成の DB は出ない', () => {
    const opts = (stack: number) =>
      setupSlots(article, stack, 'astro')
        .find((x) => x.slot === 'api')
        ?.options.map((o) => o.id);
    expect(opts(CF_PAID)).toEqual(['same', 'sakura-vps-2gb', 'sakura-vps-4gb']);
    expect(opts(CF_FREE)).toEqual(['same', 'sakura-vps-2gb', 'sakura-vps-4gb']);
    expect(opts(VERCEL_PRO)).toEqual(['same', 'cf-workers-astro']);
    expect(opts(VPS_2GB)).toEqual(['same', 'cf-workers-astro']);
    for (const [s, c] of [
      [CF_PAID, VPS2],
      [VERCEL_PRO, WORKERS],
    ] as const)
      expect(
        setupSlots(article, s, 'astro', c).map((x) => x.slot),
      ).not.toContain('db');
  });

  it('許していない組（Next.js・SPA の部品）を渡しても既定に戻る', () => {
    expect(game(VERCEL_PRO, { api: 'cf-workers-server' }).components.api).toBe(
      'same',
    );
    expect(game(CF_PAID, { api: 'aws-lambda' }).components.api).toBe('same');
    expect(game(VPS_2GB, VPS2).components.api).toBe('same');
    expect(game(CF_PAID, WORKERS).components.api).toBe('same');
  });

  it('アカウントが増え（D-52）、ゲーム中の名前は実際の組 +（Astro）', () => {
    expect(addedAccounts(VERCEL_PRO, WORKERS, 'astro')).toEqual(['cloudflare']);
    expect(addedAccounts(VPS_2GB, WORKERS, 'astro')).toEqual(['cloudflare']);
    expect(addedAccounts(CF_PAID, VPS2, 'astro')).toEqual(['sakura']);
    expect(stackName(VERCEL_PRO, 'astro', true, WORKERS)).toBe(
      'Vercel Pro + Cloudflare Workers・D1（Astro）',
    );
    expect(stackName(VPS_2GB, 'astro', true, WORKERS)).toBe(
      'さくらの VPS 2GB（東京） + Cloudflare Workers・D1（Astro）',
    );
    expect(stackName(CF_PAID, 'astro', true, VPS2)).toBe(
      'Cloudflare Paid + さくらの VPS 2GB（API・MySQL）（Astro）',
    );
    expect(stackName(CF_PAID, 'astro', true, { api: 'same' })).toBe(
      'Cloudflare Paid（Astro）',
    );
    const s = playMonth(game(VERCEL_PRO, WORKERS));
    expect(s.history[0]!.stackName).toBe(
      'Vercel Pro + Cloudflare Workers・D1（Astro）',
    );
    expect(s.history[0]!.lines.some((l) => l.provider === 'supabase')).toBe(
      false,
    );
  });

  it('SSR が外の API を待つこと・外への通信の数え方を前提の文で出す', () => {
    const ids = (stack: number, option: string) =>
      componentPreview(playMonth(game(stack)), 'api', option).map((p) => p.id);
    expect(ids(VERCEL_PRO, 'cf-workers-astro')).toEqual(
      expect.arrayContaining([
        'fact:cloudflare:workers-paid:astro-server-fetch',
        'fact:vercel:pro:function-outbound',
      ]),
    );
    expect(ids(CF_PAID, 'sakura-vps-2gb')).toEqual(
      expect.arrayContaining([
        'fact:cloudflare:workers-paid:astro-server-fetch',
        'fact:cloudflare:workers-paid:worker-outbound',
      ]),
    );
  });

  it('VPS を部品で使うと自前運用の維持がかかる。VPS の構成から Workers に出しても自前運用のまま', () => {
    expect(selfHostedOf(CF_PAID, VPS2, 'astro')).toBe(true);
    expect(upkeepOf(article, CF_PAID, VPS2, 'astro')).toBe(
      article.effort.selfHostedUpkeep,
    );
    expect(selfHostedOf(VPS_2GB, WORKERS, 'astro')).toBe(true);
  });

  it('ゲーム中の移し替えは DB の差し替えと同じデータの移行', () => {
    const s = playMonth(game(VPS_2GB));
    const a = {
      type: 'component',
      slot: 'api',
      option: 'cf-workers-astro',
    } as const;
    expect(checkAction(s, a)).toEqual({ ok: true, cost: EFFORT.accountSetup });
    let t = applyAction(s, a);
    expect(t.componentSwap).toMatchObject({ slot: 'api' });
    while (t.componentSwap) t = playMonth(t);
    expect(t.components.api).toBe('cf-workers-astro');
  });

  it('基準プレイ（何もしない・シード 1〜20）: 目標の根拠は変わらず、新しい組の結果は prd/10 §9.7 の表のとおり', () => {
    // 目標の根拠（CF Paid × Next.js）と Astro の既定は変わらない
    const next = (() => {
      let won = 0;
      for (let seed = 1; seed <= 20; seed++) {
        let st = newGame(CF_PAID, seed, article, DEFAULT_START_DATE, 'nextjs');
        while (st.phase === 'playing') st = playMonth(st);
        if (st.phase === 'won') won++;
      }
      return won;
    })();
    expect(next).toBe(20);
    expect(run(article, CF_PAID, VPS2).won).toBe(17);
    expect(run(article, VERCEL_PRO, WORKERS).won).toBe(0);
    expect(run(contract, VERCEL_PRO, WORKERS).won).toBe(20);
    // メールの送信（D-95）の費用で 12 → 9
    expect(run(contract, CF_PAID, VPS2).won).toBe(9);
  });
});
