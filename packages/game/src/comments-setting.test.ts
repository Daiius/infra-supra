// 設定「コメントの描き方」（D-82）: 記事のページに含めると、コメントの投稿も記事のページを作り直す更新に数え
// （オンデマンドの再生成・CloudFront の無効化・ビルドし直しが増える）、記事を開いたときのコメントの取得（API）が無くなる。
// 時間の再検証では作り直しの回数は変わらない。SPA・受託では出さない。
import { resolveWorkload, WorkloadInputSchema } from 'estimator';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyActions,
  baseSsrCpuMsOf,
  checkAction,
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  DEFAULT_START_DATE,
  EFFORT,
  hiddenSettings,
  newGame,
  newSave,
  parseSave,
  playMonth,
  replaySave,
  retryHintsOf,
  setupCommentOptions,
  setupInvalidationEstimate,
  settingFlavor,
  settingNote,
  STACKS,
  withTurn,
  workloadFor,
  type FrameworkId,
  type GameState,
} from './index.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';

const sc = ARTICLE_COMMUNITY;
const CF_PAID = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid');
const OPENNEXT = STACKS.findIndex((s) => s.id === 'aws-opennext');
const start = (
  stack: number,
  revalidateSec: number,
  comments: number,
  framework: FrameworkId = 'nextjs',
  components?: Record<string, string>,
) =>
  newGame(
    stack,
    1,
    sc,
    DEFAULT_START_DATE,
    framework,
    components,
    revalidateSec,
    comments,
  );

/** 1 か月目の基準の PV の Workload（解決済み）。 */
const resolved = (st: GameState) =>
  resolveWorkload(
    WorkloadInputSchema.parse(
      workloadFor(sc, {
        pv: st.basePV,
        settings: st.settings,
        ssrCpuMs: baseSsrCpuMsOf(sc),
        mods: {},
        stock: null,
        platform: STACKS[st.stackIndex]!.provider,
        components: st.components,
        framework: st.framework,
      }),
    ),
  );

describe('コメントの描き方（D-82）', () => {
  it('記事のページがあるフレームワークでだけ選べる（SPA・受託では出さない）。既定はブラウザで読み込む', () => {
    for (const fw of ['nextjs', 'astro', 'nextjs-export'] as const) {
      const o = setupCommentOptions(sc, fw);
      expect(o.map((x) => x.value)).toEqual([
        COMMENTS_IN_BROWSER,
        COMMENTS_IN_PAGE,
      ]);
      expect(o.every((x) => x.flavor)).toBe(true);
    }
    expect(setupCommentOptions(sc, 'vite-spa')).toEqual([]);
    expect(setupCommentOptions(CONTRACT_OPERATIONS, 'nextjs')).toEqual([]);
    expect(
      hiddenSettings({ scenario: CONTRACT_OPERATIONS, framework: 'astro' }),
    ).toContain('comments');
    expect(newGame(CF_PAID).settings.comments).toBe(COMMENTS_IN_BROWSER);
    expect(start(CF_PAID, 300, 1).settings.comments).toBe(COMMENTS_IN_PAGE);
    expect(start(CF_PAID, 300, 1, 'vite-spa').settings.comments).toBe(
      COMMENTS_IN_BROWSER,
    );
    expect(settingFlavor('comments', COMMENTS_IN_PAGE)).toBeTruthy();
  });

  it('記事のページに含めると、記事を開いたときのコメントの取得（API）が無くなり、書き込みの回数は変わらない', () => {
    const browser = resolved(start(CF_PAID, 300, 0));
    const inPage = resolved(start(CF_PAID, 300, 1));
    // 30 万 PV × 1 回 → 記事（60%）の読み込み（書き込みでない 90%）が無くなる: 300,000 × (1 − 0.6 × 0.9) = 138,000
    expect(browser.classes.api.count).toBeCloseTo(300_000, 6);
    expect(inPage.classes.api.count).toBeCloseTo(138_000, 6);
    const writes = (w: typeof browser) =>
      w.classes.api.count * w.classes.api.perRequest.rowsWritten;
    expect(writes(inPage)).toBeCloseTo(writes(browser), 6);
  });

  it('時間の再検証では、作り直しの回数は更新の数に依らないので変わらない（その旨を注記に出す）', () => {
    const a = resolved(start(CF_PAID, 300, 0));
    const b = resolved(start(CF_PAID, 300, 1));
    expect(b.classes['isr-revalidate'].count).toBeCloseTo(
      a.classes['isr-revalidate'].count,
      6,
    );
    expect(settingNote(start(CF_PAID, 300, 1), 'comments')).toContain(
      '作り直しの回数は増えない',
    );
    expect(settingNote(start(CF_PAID, 300, 0), 'comments')).toBeUndefined();
  });

  it('オンデマンドでは、コメントの投稿も記事のページを再検証する（更新 300 → 15,000 回・コメントは記事のページだけ）', () => {
    const a = resolved(start(CF_PAID, 0, 0));
    const b = resolved(start(CF_PAID, 0, 1));
    expect(a.onDemandUpdates).toBeCloseTo(300, 6);
    expect(b.onDemandUpdates).toBeCloseTo(15_000, 6);
    // 記事 300 回 × 2 ページ + コメント 14,700 回 × 1 ページ
    expect(b.onDemandPageRevalidations).toBeCloseTo(300 * 2 + 14_700, 6);
    expect(b.classes['isr-revalidate'].count).toBeGreaterThan(
      a.classes['isr-revalidate'].count,
    );
    expect(settingNote(start(CF_PAID, 0, 1), 'comments')).toContain(
      'コメントの投稿のたびに',
    );
  });

  it('OpenNext の CloudFront の無効化の見込みに反映する（1,200 → 30,600 パス）', () => {
    const est = (comments: number) =>
      setupInvalidationEstimate(
        sc,
        OPENNEXT,
        'nextjs',
        { cdnPlan: 'payg' },
        comments,
      )!;
    expect(est(0).paths).toBeCloseTo(1_200, 6);
    expect(est(1).paths).toBeCloseTo(30_600, 6);
    expect(est(1).usd).toBeCloseTo((30_600 - 1_000) * 0.005, 6);
  });

  it('Astro・静的書き出しでは、コメントの投稿のたびのビルドし直しが増える', () => {
    for (const fw of ['astro', 'nextjs-export'] as const) {
      const a = resolved(start(CF_PAID, 0, 0, fw));
      const b = resolved(start(CF_PAID, 0, 1, fw));
      expect(b.builds.count).toBeGreaterThan(a.builds.count * 10);
    }
  });

  it('切り替えは手間 2（どちらの向きも）。SPA では選べない', () => {
    expect(EFFORT.setting.comments).toBe(2);
    const st = playMonth(start(CF_PAID, 300, 0));
    const on = { type: 'set', key: 'comments', value: 1 } as const;
    expect(checkAction(st, on)).toEqual({ ok: true, cost: 2 });
    const back = playMonth(applyActions(st, [on]));
    expect(back.settings.comments).toBe(COMMENTS_IN_PAGE);
    expect(
      checkAction(back, { type: 'set', key: 'comments', value: 0 }),
    ).toEqual({ ok: true, cost: 2 });
    const spa = playMonth(start(CF_PAID, 300, 0, 'vite-spa'));
    const r = checkAction(spa, on);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SPA');
  });

  it('保存の再生で同じになり、無い保存は既定（ブラウザで読み込む）で読む', () => {
    const save = withTurn(
      newSave({
        scenarioId: sc.id,
        stackIndex: CF_PAID,
        framework: 'nextjs',
        seed: 1,
        startDate: DEFAULT_START_DATE,
        revalidateSec: 0,
        comments: 1,
      }),
      [],
    );
    const st = replaySave(parseSave(JSON.parse(JSON.stringify(save)))!);
    expect(st.settings.comments).toBe(COMMENTS_IN_PAGE);
    const { comments: _, ...old } = save;
    expect(replaySave(parseSave(old)!).settings.comments).toBe(
      COMMENTS_IN_BROWSER,
    );
    expect(parseSave({ ...save, comments: 'x' })).toBeNull();
  });

  it('OpenNext × オンデマンド × 従量で含めると無効化で所持金が尽き、ヒントがブラウザで読み込む形に戻す方向を出す', () => {
    let s = playMonth(
      start(OPENNEXT, 0, 1, 'nextjs', { cdnPlan: 'payg', images: 'default' }),
    );
    while (s.phase === 'playing') s = playMonth(applyActions(s, []));
    expect(s.end?.reason).toBe('cash');
    const cost = retryHintsOf(s).find((x) => x.kind === 'cost')!;
    expect(cost.next).toContain('ブラウザで読み込む形に戻す');
  });
});
