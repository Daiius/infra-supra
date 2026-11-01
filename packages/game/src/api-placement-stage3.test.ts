// API の置き場の段 3（D-67・prd/10 §9.5〜）: Next.js のサーバーから別の事業者の API を呼ぶ（F-14）・
// Cloudflare の静的 + さくらの VPS の API（自前運用の維持・障害が部品で VPS を使うときにも効く）。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  applyAction,
  checkAction,
  componentEffortLabel,
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
  type FrameworkId,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_FREE = idx('cloudflare-vinext-free');
const CF_PAID = idx('cloudflare-vinext-paid');
const VERCEL_PRO = idx('vercel-supabase-pro');
const AWS = idx('aws-amplify');
const ON = idx('aws-opennext');
const VPS2 = { api: 'sakura-vps-2gb' };
const NEXT_API = { api: 'cf-workers-server' };

const game = (
  stack: number,
  framework: FrameworkId,
  components = {},
  seed = 1,
  sc = article,
) => newGame(stack, seed, sc, DEFAULT_START_DATE, framework, components);

/** 何もしない・シード 1〜20 の達成数と所持金の中央値（始める画面で選んだ部品）。 */
function run(
  sc: typeof article,
  stack: number,
  framework: FrameworkId,
  components: object,
) {
  let won = 0;
  let incidents = 0;
  const cash: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    let st = game(stack, framework, components, seed, sc);
    while (st.phase === 'playing') st = playMonth(st);
    if (st.phase === 'won') won++;
    incidents += st.history.filter((h) => h.status === 'incident').length;
    cash.push(st.cash);
  }
  cash.sort((a, b) => a - b);
  return { won, incidents, median: (cash[9]! + cash[10]!) / 2 };
}

describe('Next.js のサーバーから別の事業者の API を呼ぶ（F-14）', () => {
  it('始める画面: Vercel・Amplify・OpenNext の Next.js に API の置き場が出て、選ぶと構成の DB は出ない', () => {
    for (const s of [VERCEL_PRO, AWS, ON]) {
      const slots = setupSlots(article, s, 'nextjs', NEXT_API).map(
        (x) => x.slot,
      );
      expect(slots).toContain('api');
      expect(slots).not.toContain('db');
    }
    expect(
      setupSlots(article, CF_PAID, 'nextjs').map((x) => x.slot),
    ).not.toContain('api');
  });

  it('Cloudflare のアカウントが増え（D-52）、ゲーム中の名前は実際の組で出す', () => {
    expect(addedAccounts(VERCEL_PRO, NEXT_API, 'nextjs')).toEqual([
      'cloudflare',
    ]);
    expect(stackName(VERCEL_PRO, 'nextjs', true, NEXT_API)).toBe(
      'Vercel Pro + Cloudflare Workers・D1',
    );
    expect(stackName(AWS, 'nextjs', true, NEXT_API)).toBe(
      'AWS Amplify の Next.js + Cloudflare Workers・D1',
    );
    expect(stackName(ON, 'nextjs', true, NEXT_API)).toBe(
      'AWS の OpenNext + Cloudflare Workers・D1',
    );
    expect(stackName(VERCEL_PRO, 'nextjs', true, { api: 'same' })).toBe(
      'Vercel Pro + Supabase Pro',
    );
  });

  it('SSR が外の API を待つことと、外への通信の数え方を前提の文で出す（遅延は計算しない）', () => {
    const ids = (stack: number) =>
      componentPreview(
        playMonth(game(stack, 'nextjs')),
        'api',
        'cf-workers-server',
      ).map((p) => p.id);
    expect(ids(VERCEL_PRO)).toEqual(
      expect.arrayContaining([
        'fact:cloudflare:workers-paid:server-fetch',
        'fact:vercel:pro:function-outbound',
      ]),
    );
    expect(ids(AWS)).toContain('fact:aws:amplify-hosting:ssr-outbound');
    expect(ids(ON)).toContain('fact:aws:data-transfer-out:lambda-out');
    const s = playMonth(game(VERCEL_PRO, 'nextjs', NEXT_API));
    expect(s.history[0]!.stackName).toBe('Vercel Pro + Cloudflare Workers・D1');
    expect(
      s.history[0]!.lines.some((l) => l.label.startsWith('supabase')),
    ).toBe(false);
  });

  it('ゲーム中の移し替えは DB の差し替えと同じデータの移行', () => {
    const s = playMonth(game(VERCEL_PRO, 'nextjs'));
    const a = {
      type: 'component',
      slot: 'api',
      option: 'cf-workers-server',
    } as const;
    expect(checkAction(s, a)).toEqual({ ok: true, cost: EFFORT.accountSetup });
    let t = applyAction(s, a);
    expect(t.componentSwap).toMatchObject({ slot: 'api' });
    while (t.componentSwap) t = playMonth(t);
    expect(t.components.api).toBe('cf-workers-server');
    expect(t.components.db).toBeUndefined();
  });
});

describe('Cloudflare の静的 + さくらの VPS の API', () => {
  it('部品で VPS を使うと、自前運用の維持の手間（シナリオの値）がかかる', () => {
    expect(selfHostedOf(CF_PAID, VPS2, 'vite-spa')).toBe(true);
    expect(selfHostedOf(CF_PAID, {}, 'vite-spa')).toBe(false);
    expect(upkeepOf(article, CF_PAID, VPS2, 'vite-spa')).toBe(
      article.effort.selfHostedUpkeep,
    );
    expect(upkeepOf(article, CF_PAID, {}, 'vite-spa')).toBe(0);
    expect(addedAccounts(CF_PAID, VPS2, 'vite-spa')).toEqual(['sakura']);
    const s = playMonth(game(CF_PAID, 'vite-spa', VPS2));
    expect(s.history[0]!.effort.upkeep).toBe(article.effort.selfHostedUpkeep);
    expect(s.history[0]!.effort.accounts).toBe(EFFORT.accountUpkeep);
    expect(s.history[0]!.stackName).toBe(
      'Cloudflare Paid の静的 + さくらの VPS 2GB（API・MySQL）（Vite の SPA）',
    );
  });

  it('移し替えの途中も新しい VPS の維持がかかり、手間の見込みにアカウントの設定が付く', () => {
    const s = playMonth(game(CF_PAID, 'vite-spa'));
    expect(componentEffortLabel('api', s, 'sakura-vps-2gb')).toEqual([
      `${EFFORT.dbSwap.perMonth} × ${EFFORT.dbSwap.months} か月 + 手間 ${EFFORT.accountSetup}`,
      '期間中は新旧両方の費用',
      `さくらのクラウド のアカウントが増える（毎月の維持 ${EFFORT.accountUpkeep}）`,
      `自前運用になる（毎月の維持 ${article.effort.selfHostedUpkeep}・自前の障害 月 ${Math.round(article.incidents.selfHostedChancePerMonth * 100)}%）`,
    ]);
    const t = playMonth(
      applyAction(s, {
        type: 'component',
        slot: 'api',
        option: 'sakura-vps-2gb',
      }),
    );
    const r = t.history[t.history.length - 1]!;
    expect(r.effort.upkeep).toBe(article.effort.selfHostedUpkeep);
    expect(r.lines.some((l) => l.label.startsWith('sakura-vps'))).toBe(true);
  });

  it('自前の障害（偶発的）は API の VPS にも当たり、文で API の障害と分かる', () => {
    let g = game(CF_PAID, 'vite-spa', VPS2, 1);
    while (g.phase === 'playing') g = playMonth(g);
    const inc = g.history.find((h) => h.status === 'incident');
    expect(inc?.notes.join('')).toContain('API の VPS の障害');
  });

  it('VPS の回線・ディスクに届くのは API と DB の分だけ（静的・画像は Cloudflare）', () => {
    const max = (components: object, stack: number) => {
      let g = game(stack, 'vite-spa', components);
      while (g.phase === 'playing') g = playMonth(g);
      const m: Record<string, number> = {};
      for (const h of g.history)
        for (const p of h.snapshots) m[p.id] = Math.max(m[p.id] ?? 0, p.ratio);
      return m;
    };
    const api = max(VPS2, CF_PAID);
    const whole = max({}, idx('sakura-vps-2gb'));
    expect(api['host:line:vps']!).toBeLessThan(whole['host:line:vps']! / 10);
    expect(api['host:disk:vps']!).toBeLessThan(whole['host:disk:vps']! / 3);
  });
});

describe('基準プレイ（何もしない・シード 1〜20・prd/10 §9.6）', () => {
  it('CF Paid・既定（目標の根拠）は変わらない', () => {
    expect(run(article, CF_PAID, 'vite-spa', {}).won).toBe(20);
    expect(run(contract, CF_PAID, 'vite-spa', {}).won).toBe(20);
    expect(run(article, CF_PAID, 'nextjs', {}).won).toBe(20);
  });

  it('受託: Vercel Pro の Next.js は API と DB を Workers・D1 に出すと Supabase Pro の固定費が消えて届く', () => {
    expect(run(contract, VERCEL_PRO, 'nextjs', {}).won).toBe(0);
    expect(run(contract, VERCEL_PRO, 'nextjs', NEXT_API).won).toBe(20);
  });

  it('記事コミュニティ: Vercel Pro の Next.js は API を出しても席と転送が残り届かない', () => {
    const base = run(article, VERCEL_PRO, 'nextjs', {});
    const r = run(article, VERCEL_PRO, 'nextjs', NEXT_API);
    expect(r.won).toBe(0);
    expect(r.median).toBeGreaterThan(base.median);
  });

  it('受託: Cloudflare の静的 + VPS 2GB の API は、偶発的な障害を除いて届く（VPS だけの構成は画像でディスクが埋まる）', () => {
    const r = run(contract, CF_FREE, 'vite-spa', VPS2);
    expect(r.won).toBe(17);
    expect(r.incidents).toBeGreaterThan(0);
    expect(run(contract, idx('sakura-vps-2gb'), 'vite-spa', {}).won).toBe(1);
  });
});
