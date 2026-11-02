// アプリの作り直し（フレームワークを替える。D-81・prd/10 F-06）。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyAction,
  applyActions,
  checkAction,
  componentsAfterRewrite,
  EFFORT,
  effortAvailable,
  newGame,
  newSave,
  playMonth,
  playStrategy,
  replaySave,
  rewriteEffort,
  rewriteTargets,
  rewriteText,
  STACKS,
  withTurn,
  type Action,
  type GameState,
} from './index.ts';

const CF_PAID = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
const VERCEL_PRO = STACKS.findIndex((s) => s.id === 'vercel-supabase-pro');
const VPS = STACKS.findIndex((s) => s.id === 'sakura-vps-2gb');
const VPS_4GB = STACKS.findIndex((s) => s.id === 'sakura-vps-4gb');
const AWS = STACKS.findIndex((s) => s.provider === 'aws');

const rewrite = (framework: GameState['framework']): Action => ({
  type: 'rewrite',
  framework,
});

const start = (
  stackIndex: number,
  fw: GameState['framework'],
  components?: Parameters<typeof newGame>[5],
  revalidateSec?: number,
) =>
  playMonth(
    newGame(
      stackIndex,
      1,
      ARTICLE_COMMUNITY,
      undefined,
      fw,
      components,
      revalidateSec,
    ),
  );

/** 作り直しが済むまで回す。 */
const untilDone = (s: GameState) => {
  let st = s;
  while (st.phase === 'playing' && st.rewrite) st = playMonth(st);
  return st;
};

describe('作り直しの規則（checkAction）', () => {
  it('手間は乗り換えより重い（ゲーム上の仮定）', () => {
    expect(rewriteEffort()).toBe(24);
    expect(rewriteEffort()).toBeGreaterThan(
      EFFORT.migrationPerMonth * EFFORT.migrationMonths.selfHosted,
    );
  });

  it('今と同じ・載せられない組は選べない（理由を出す）', () => {
    const s = start(VPS, 'vite-spa');
    expect(rewriteTargets(s)).toEqual(['nextjs', 'astro', 'nextjs-export']);
    expect(checkAction(s, rewrite('vite-spa'))).toMatchObject({
      ok: false,
      reason: 'same',
    });
    expect(checkAction(s, rewrite('nextjs'))).toEqual({ ok: true, cost: 0 });
    const aws = start(AWS, 'nextjs');
    const r = checkAction(aws, rewrite('astro'));
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(r.ok || r.message).toContain('公式のアダプターが無い');
    // AWS（S3 + CloudFront）は静的書き出しを載せられる（D-80）
    expect(checkAction(aws, rewrite('nextjs-export')).ok).toBe(true);
  });

  it('作り直しの最中は乗り換え・部品の差し替え・別の作り直しを選べない（プラン変更は選べる）', () => {
    const s = applyAction(start(VPS, 'vite-spa'), rewrite('nextjs'));
    expect(s.rewrite).toMatchObject({ from: 'vite-spa', to: 'nextjs' });
    for (const a of [
      { type: 'migrate', stackIndex: CF_PAID },
      { type: 'component', slot: 'frontCdn', option: 'static' },
      rewrite('astro'),
    ] as Action[])
      expect(checkAction(s, a)).toMatchObject({ ok: false, reason: 'busy' });
    // プラン変更は作り直しの規則では止めない（VPS の上位への変更は手間 2 なので、手間が足りないことだけが理由になる）
    const plan = checkAction(s, { type: 'plan', stackIndex: VPS_4GB });
    expect(plan.ok || plan.reason).toBe('effort');
  });

  it('乗り換え・データの移し替えの最中は作り直しを選べない', () => {
    const m = applyAction(start(VERCEL_PRO, 'nextjs'), {
      type: 'migrate',
      stackIndex: CF_PAID,
    });
    expect(checkAction(m, rewrite('vite-spa'))).toMatchObject({
      ok: false,
      reason: 'busy',
    });
    const d = applyAction(start(CF_PAID, 'nextjs'), {
      type: 'component',
      slot: 'db',
      option: 'kv',
    });
    expect(d.componentSwap).not.toBeNull();
    expect(checkAction(d, rewrite('vite-spa'))).toMatchObject({
      ok: false,
      reason: 'busy',
    });
  });
});

describe('作り直しの手間と切り替え', () => {
  it('作り直しの間は機能開発がほぼ止まる（VPS は維持の残りをすべて取り、長くかかる）', () => {
    const cf = applyAction(start(CF_PAID, 'vite-spa'), rewrite('nextjs'));
    expect(effortAvailable(cf)).toBe(2);
    const cf2 = playMonth(cf);
    expect(cf2.history[1]!.effort).toMatchObject({ migration: 8, feature: 2 });
    const vps = applyAction(start(VPS, 'vite-spa'), rewrite('nextjs'));
    expect(effortAvailable(vps)).toBe(0);
    const vps2 = playMonth(vps);
    expect(vps2.history[1]!.effort).toMatchObject({
      upkeep: 3,
      migration: 7,
      feature: 0,
    });
    expect(vps2.history[1]!.rewrite).toEqual({
      toLabel: 'Next.js（App Router）',
      done: 7,
      required: 24,
    });
  });

  it('作業の間は旧アプリのまま動き、済んだ翌月から新しいフレームワーク（部品はその既定）', () => {
    const s = applyAction(start(CF_PAID, 'vite-spa'), rewrite('nextjs'));
    const done = untilDone(playMonth(s));
    const last = done.history[done.history.length - 1]!;
    // 済んだ月までは旧アプリ（SPA）
    expect(done.history.every((r) => r.framework === 'vite-spa')).toBe(true);
    expect(last.notes.some((n) => n.startsWith('作り直しが済んだ'))).toBe(true);
    expect(done.framework).toBe('nextjs');
    expect(done.components).toEqual(
      newGame(CF_PAID, 1, ARTICLE_COMMUNITY, undefined, 'nextjs').components,
    );
    const next = playMonth(done);
    expect(next.history[next.history.length - 1]!.framework).toBe('nextjs');
    expect(next.history[next.history.length - 1]!.stackName).not.toContain(
      'SPA',
    );
  });

  it('API の置き場は同じ事業者に置ける選択肢があれば維持する（Next.js の Workers → SPA の Workers）', () => {
    const s = start(VERCEL_PRO, 'nextjs', { api: 'cf-workers-server' });
    expect(s.components.api).toBe('cf-workers-server');
    const after = componentsAfterRewrite(s, 'vite-spa');
    expect(after.api).toBe('cf-workers');
    expect(after.db).toBeUndefined();
    expect(after.ogp).toBe('none');
    // VPS の API は Next.js に無いので、同じ事業者に同居（既定）に戻る
    const vpsApi = start(CF_PAID, 'vite-spa', { api: 'sakura-vps-2gb' });
    expect(componentsAfterRewrite(vpsApi, 'nextjs').api).toBe('same');
    expect(componentsAfterRewrite(vpsApi, 'astro').api).toBe('sakura-vps-2gb');
  });

  it('新しいフレームワークの設定に無い再検証の値は既定（5 分）に戻す', () => {
    const s = applyAction(
      start(CF_PAID, 'nextjs', undefined, 0),
      rewrite('vite-spa'),
    );
    expect(s.settings.revalidateSec).toBe(0);
    expect(untilDone(playMonth(s)).settings.revalidateSec).toBe(300);
    const astro = applyAction(
      start(CF_PAID, 'nextjs', undefined, 0),
      rewrite('astro'),
    );
    expect(untilDone(playMonth(astro)).settings.revalidateSec).toBe(0);
  });

  it('選択肢の文は手間・月数・替わる部品を出す', () => {
    const s = start(VPS, 'vite-spa');
    const t = rewriteText(s, 'nextjs');
    expect(t.name).toBe('Next.js（App Router） に作り直す');
    expect(t.meta).toEqual([
      '手間 24（毎月 7 を取る）',
      '約 4 か月',
      '機能開発がほぼ止まる',
    ]);
    expect(t.detail).toContain('今のアプリのまま動き');
    // Vercel Pro の Next.js → 静的書き出しは画像の最適化が使えないので、投稿のときに縮めるに替わる（D-80）
    const v = rewriteText(start(VERCEL_PRO, 'nextjs'), 'nextjs-export');
    expect(v.detail).toContain('替わる部品: 画像');
  });

  it('保存の再生（D-26）で同じ状態になる', () => {
    const actions: Action[][] = [[rewrite('nextjs')], [], []];
    const st = playStrategy(
      { id: 'x', label: 'x', stackIndex: VPS, actions },
      7,
      ARTICLE_COMMUNITY,
      undefined,
      'vite-spa',
    );
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: VPS,
      framework: 'vite-spa',
      seed: 7,
      startDate: st.startDate,
    });
    for (let t = 1; t < st.history.length; t++)
      save = withTurn(save, actions[t - 1] ?? []);
    const replayed = replaySave(save);
    expect(replayed).toEqual(st);
    expect(replayed.framework).toBe('nextjs');
  });
});

// 基準プレイの観点（D-81・prd/10 §12）: 記事 × VPS 2GB × SPA で始め、話題の前（1 か月目の終わり）に Next.js へ作り直す。
// 目標の根拠（CF Paid × Next.js）は変えない。立て直しの道はあるが細い（作り直しの間の機能開発の止まりが満足度と伸びに効く）
describe('基準プレイの観点: VPS 2GB × SPA → Next.js に作り直す（シード 1〜20）', () => {
  const wins = (fw: GameState['framework'], actions?: Action[][]) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++)
      if (
        playStrategy(
          {
            id: 'x',
            label: 'x',
            stackIndex: VPS,
            ...(actions ? { actions } : {}),
          },
          seed,
          ARTICLE_COMMUNITY,
          undefined,
          fw,
        ).phase === 'won'
      )
        n++;
    return n;
  };
  it('何もしない SPA より達成が多く、始めから Next.js より少ない', () => {
    const spa = wins('vite-spa');
    const rewritten = wins('vite-spa', [[rewrite('nextjs')]]);
    const next = wins('nextjs');
    // 始めから Next.js はメールの送信（D-95）の費用で 10 → 9
    expect([spa, rewritten, next]).toEqual([0, 2, 9]);
  });
});

describe('古い状態との互換', () => {
  it('作り直しの行動が無い保存は今のまま再生できる', () => {
    const s = applyActions(start(CF_PAID, 'nextjs'), []);
    expect(s.rewrite).toBeNull();
  });
});
