// SPA の API の置き場（D-65・prd/10 §3）: 許した組だけ選べる・DB は API と同じ事業者・移し替えはデータの移行・基準プレイ。
import { describe, expect, it } from 'vitest';
import {
  addedAccounts,
  applyAction,
  checkAction,
  componentConflict,
  componentEffortLabel,
  componentSlots,
  DEFAULT_START_DATE,
  EFFORT,
  newGame,
  playMonth,
  SCENARIOS,
  setupProblem,
  setupSlots,
  stackChangeText,
  stackName,
  STACKS,
  validSetupChoices,
  type GameState,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const CF_FREE = idx('cloudflare-vinext-free');
const CF_PAID = idx('cloudflare-vinext-paid');
const VERCEL_HOBBY = idx('vercel-supabase-hobby');
const VERCEL_PRO = idx('vercel-supabase-pro');
const VPS = idx('sakura-vps-2gb');
const AWS = idx('aws-amplify');
const api = (option: string) =>
  ({ type: 'component', slot: 'api', option }) as const;

const spaGame = (stack: number, components = {}, seed = 1, sc = article) =>
  newGame(stack, seed, sc, DEFAULT_START_DATE, 'vite-spa', components);

describe('選べる範囲', () => {
  const options = (stack: number, fw: 'nextjs' | 'vite-spa') =>
    setupSlots(article, stack, fw)
      .find((x) => x.slot === 'api')
      ?.options.map((o) => `${o.platform}:${o.id}`);

  it('許した組だけ（VPS の構成は同居だけなのでスロットを出さない。Next.js・VPS の API は D-67）', () => {
    expect(options(VERCEL_PRO, 'vite-spa')).toEqual([
      'vercel:same',
      'cloudflare:cf-workers',
    ]);
    expect(options(CF_PAID, 'vite-spa')).toEqual([
      'cloudflare:same',
      'aws:aws-lambda',
      'sakura:sakura-vps-2gb',
      'sakura:sakura-vps-4gb',
    ]);
    expect(options(AWS, 'vite-spa')).toEqual([
      'aws:same',
      'cloudflare:cf-workers',
    ]);
    expect(options(VPS, 'vite-spa')).toBeUndefined();
    expect(options(CF_PAID, 'nextjs')).toBeUndefined();
    for (const s of [VERCEL_PRO, AWS])
      expect(options(s, 'nextjs')).toEqual([
        `${STACKS[s]!.provider}:same`,
        'cloudflare:cf-workers-server',
      ]);
  });

  it('既定は同じ事業者（今までのゲームは変わらない）', () => {
    expect(spaGame(VERCEL_PRO).components.api).toBe('same');
    expect(addedAccounts(VERCEL_PRO, { api: 'same' }, 'vite-spa')).toEqual([]);
  });

  it('API を他の事業者に置くと、構成の DB のスロットは出さず、始める画面でも選ばなくてよい', () => {
    const slots = (choices: Record<string, string>) =>
      setupSlots(article, CF_PAID, 'vite-spa', choices).map((x) => x.slot);
    expect(slots({})).toContain('db');
    expect(slots({ api: 'aws-lambda' })).not.toContain('db');
    const chosen = {
      images: 'images',
      api: 'aws-lambda',
      db: 'd1',
      ogp: 'none',
      apiCache: 'none',
    };
    const valid = validSetupChoices(article, CF_PAID, 'vite-spa', chosen);
    expect(valid).not.toHaveProperty('db');
    expect(setupProblem(article, CF_PAID, 'vite-spa', valid)).toBeNull();
    const s = spaGame(CF_PAID, chosen);
    expect(componentSlots(s).map((x) => x.slot)).not.toContain('db');
  });
});

describe('依存（始める画面とゲーム中で共通）', () => {
  it('API の応答のキャッシュ・D1 の画像とは同時に選べず、頼る側を先に戻す', () => {
    expect(
      componentConflict('vercel', 'api', 'cf-workers', { apiCache: 'cdn' }),
    ).toContain('キャッシュを外す');
    expect(
      componentConflict('vercel', 'apiCache', 'cdn', { api: 'cf-workers' }),
    ).toContain('効かない');
    expect(
      componentConflict('cloudflare', 'api', 'aws-lambda', { images: 'd1' }),
    ).toContain('D1');
    expect(
      componentConflict('cloudflare', 'db', 'hyperdrive', {
        api: 'aws-lambda',
      }),
    ).toContain('DB はその事業者');
    expect(componentConflict('vercel', 'api', 'cf-workers', {})).toBeNull();
  });
});

describe('ゲーム中の移し替え（データの移行）', () => {
  it('DB の差し替えと同じく進行中の状態を持ち、手間を入れ終えた翌月に切り替わる（期間中は新旧両方の費用）', () => {
    const s = playMonth(spaGame(VERCEL_PRO));
    expect(checkAction(s, api('cf-workers'))).toEqual({
      ok: true,
      cost: EFFORT.accountSetup,
    });
    expect(componentEffortLabel('api', s, 'cf-workers')).toEqual([
      `${EFFORT.dbSwap.perMonth} × ${EFFORT.dbSwap.months} か月 + 手間 ${EFFORT.accountSetup}`,
      '期間中は新旧両方の費用',
      `Cloudflare のアカウントが増える（毎月の維持 ${EFFORT.accountUpkeep}）`,
    ]);
    const started = applyAction(s, api('cf-workers'));
    expect(started.componentSwap).toMatchObject({
      slot: 'api',
      option: 'cf-workers',
    });
    // 他の行動は選べない
    expect(
      checkAction(started, {
        type: 'component',
        slot: 'ogp',
        option: 'prerender',
      }),
    ).toMatchObject({ ok: false, reason: 'busy' });
    let t: GameState = playMonth(started);
    const during = t.history[t.history.length - 1]!;
    // 期間中は Supabase と Cloudflare の両方を払う
    expect(during.lines.some((l) => l.label.startsWith('supabase'))).toBe(true);
    expect(during.lines.some((l) => l.label.startsWith('cloudflare'))).toBe(
      true,
    );
    while (t.componentSwap) t = playMonth(t);
    expect(t.components.api).toBe('cf-workers');
    t = playMonth(t);
    const after = t.history[t.history.length - 1]!;
    expect(after.lines.some((l) => l.label.startsWith('supabase'))).toBe(false);
  });
});

describe('KV を DB にした構成から API を移す（OCL-5A7916E6）', () => {
  it('移し替えが済むと構成の DB の選択は既定に戻り、KV の鮮度の低下も消える', () => {
    let s = playMonth(spaGame(CF_PAID, { db: 'kv' }));
    const kvMonth = s.history[0]!;
    expect(kvMonth.satisfaction.stages.freshness).not.toBe('good');
    s = applyAction(s, api('aws-lambda'));
    while (s.componentSwap) s = playMonth(s);
    expect(s.components.api).toBe('aws-lambda');
    expect(s.components.db).toBeUndefined();
    s = playMonth(s);
    const r = s.history[s.history.length - 1]!;
    expect(r.satisfaction.stages.freshness).toBe('good');
    expect(r.lines.some((l) => l.label.includes('KV'))).toBe(false);
  });
});

describe('構成の名前（ゲーム中）', () => {
  it('API を他の事業者に置くと実際の組で出す（月の表・プラン変更の文面。始める画面の一覧は構成の名前のまま）', () => {
    expect(stackName(VERCEL_PRO, 'vite-spa', true, { api: 'cf-workers' })).toBe(
      'Vercel Pro の静的 + Cloudflare Workers・D1（Vite の SPA）',
    );
    expect(stackName(CF_PAID, 'vite-spa', true, { api: 'aws-lambda' })).toBe(
      'Cloudflare Paid の静的 + AWS Lambda・DynamoDB（Vite の SPA）',
    );
    expect(stackName(AWS, 'vite-spa', true, { api: 'cf-workers' })).toBe(
      'AWS の S3 + CloudFront の静的 + Cloudflare Workers・D1（Vite の SPA）',
    );
    expect(stackName(VERCEL_PRO, 'vite-spa', true, { api: 'same' })).toBe(
      'Vercel Pro + Supabase Pro（Vite の SPA）',
    );
    expect(stackName(VERCEL_PRO, 'vite-spa', false)).toBe(
      'Vercel Pro + Supabase Pro',
    );
    const s = playMonth(spaGame(VERCEL_PRO, { api: 'cf-workers' }));
    expect(s.history[0]!.stackName).toBe(
      'Vercel Pro の静的 + Cloudflare Workers・D1（Vite の SPA）',
    );
    // プラン変更は部品を引き継ぐ（Hobby → Pro）。乗り換えは既定の部品に戻るので構成の名前
    const h = spaGame(VERCEL_HOBBY, { api: 'cf-workers' });
    expect(
      stackChangeText(VERCEL_HOBBY, VERCEL_PRO, 'vite-spa', h.components).name,
    ).toBe(
      'Vercel Pro の静的 + Cloudflare Workers・D1（Vite の SPA） にプラン変更',
    );
    expect(
      stackChangeText(VERCEL_PRO, CF_PAID, 'vite-spa', { api: 'cf-workers' })
        .name,
    ).toMatch(/^Cloudflare Paid（Vite の SPA）/);
  });
});

/** 何もしない・シード 1〜20 の達成数と所持金の中央値（始める画面で選んだ部品）。 */
function run(sc: typeof article, stack: number, components: object) {
  let won = 0;
  const cash: number[] = [];
  const ends = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    let st = spaGame(stack, components, seed, sc);
    while (st.phase === 'playing') st = playMonth(st);
    if (st.phase === 'won') won++;
    cash.push(st.cash);
    if (st.end) ends.add(st.end.reason);
  }
  cash.sort((a, b) => a - b);
  return { won, median: (cash[9]! + cash[10]!) / 2, ends: [...ends] };
}

describe('基準プレイ（何もしない・シード 1〜20・prd/10 §9）', () => {
  it('CF Paid・既定（目標の根拠）は変わらない', () => {
    expect(run(article, CF_PAID, {}).won).toBe(20);
    expect(run(contract, CF_PAID, {}).won).toBe(20);
  });

  it('記事コミュニティ: Vercel Pro は API と画像を Cloudflare に出しても席と静的の転送が残り届かない', () => {
    const r = run(article, VERCEL_PRO, {
      api: 'cf-workers',
      images: 'cf-resize',
    });
    expect(r.won).toBe(0);
    expect(r.median).toBeGreaterThan(run(article, VERCEL_PRO, {}).median);
  });

  it('受託: Vercel Pro は API と DB を Cloudflare に出すと Supabase Pro の固定費が消えて届く', () => {
    expect(run(contract, VERCEL_PRO, {}).won).toBe(0);
    expect(run(contract, VERCEL_PRO, { api: 'cf-workers' }).won).toBe(20);
  });

  it('Vercel Hobby は静的だけでも非商用の規約に当たる', () => {
    expect(run(article, VERCEL_HOBBY, { api: 'cf-workers' }).ends).toEqual([
      'policy',
    ]);
  });

  it('受託: Cloudflare Free の静的 + AWS の API は Workers Free の上限に当たらず届く', () => {
    expect(run(contract, CF_FREE, {}).won).toBe(0);
    expect(run(contract, CF_FREE, { api: 'aws-lambda' }).won).toBe(20);
  });
});
