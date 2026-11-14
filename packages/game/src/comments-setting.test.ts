// 記事のページの部品「コメント欄」（D-82。段 4 で全体の設定からルートの部品に移した。D-109）: 記事のページに含めると、
// コメントの投稿も記事のページを作り直す更新に数え（オンデマンドの再生成・CloudFront の無効化・ビルドし直しが増える）、
// 記事を開いたときのコメントの取得（API）が無くなる。時間の再検証では作り直しの回数は変わらない。SPA・受託では出さない。
import { resolveWorkload, WorkloadInputSchema } from 'estimator';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  applyActions,
  baseSsrCpuMsOf,
  checkAction,
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  commentsOf,
  DEFAULT_START_DATE,
  EFFORT,
  newGame,
  newSave,
  parseSave,
  playMonth,
  replaySave,
  partsOfComments,
  retryHintsOf,
  routePartNote,
  routePlanOf,
  setupCommentOptions,
  setupInvalidationEstimate,
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
    partsOfComments(sc, comments),
  );

/** ゲームの状態のコメント欄の描き方。 */
const commentsNow = (st: GameState) => commentsOf(sc, st.routeParts);

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
        routeParts: st.routeParts,
      }),
    ),
  );

describe('記事のページの部品「コメント欄」（D-82・D-109）', () => {
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
    expect(setupCommentOptions(CONTRACT_OPERATIONS, 'astro')).toEqual([]);
    expect(commentsNow(newGame(CF_PAID))).toBe(COMMENTS_IN_BROWSER);
    expect(newGame(CF_PAID).routeParts).toBeUndefined();
    expect(start(CF_PAID, 300, 1).routeParts).toEqual({
      article: { comments: COMMENTS_IN_PAGE },
    });
    expect(start(CF_PAID, 300, 1, 'vite-spa').routeParts).toBeUndefined();
    // 枠 + API の記事（S5）にも含める HTML が無い
    expect(setupCommentOptions(sc, 'nextjs', { article: 'shell-api' })).toEqual(
      [],
    );
  });

  it('描き方の表の記事の行に部品として出る（個人向けのページ・SPA には出ない）', () => {
    const rows = routePlanOf(start(CF_PAID, 300, 1));
    const article = rows.find((r) => r.route === 'article')!;
    expect(article.parts).toEqual([
      expect.objectContaining({
        part: 'comments',
        value: COMMENTS_IN_PAGE,
        options: [
          expect.objectContaining({ value: COMMENTS_IN_BROWSER }),
          expect.objectContaining({ value: COMMENTS_IN_PAGE }),
        ],
      }),
    ]);
    expect(rows.find((r) => r.route === 'personal')!.parts).toEqual([]);
    expect(
      routePlanOf(start(CF_PAID, 300, 0, 'vite-spa')).every(
        (r) => r.parts.length === 0,
      ),
    ).toBe(true);
  });

  it('記事のページに含めると、記事を開いたときのコメントの取得（API）が無くなり、書き込みの回数は変わらない', () => {
    const browser = resolved(start(CF_PAID, 300, 0));
    const inPage = resolved(start(CF_PAID, 300, 1));
    // コメント欄の API は記事のページの部品として、記事のルートに数える（RS-02）
    expect(
      browser.sources.api?.find((x) => x.routeId === 'article')?.count,
    ).toBeCloseTo(180_000, 6);
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
    expect(routePartNote(start(CF_PAID, 300, 1), 'comments')).toContain(
      '作り直しの回数は増えません',
    );
    expect(routePartNote(start(CF_PAID, 300, 0), 'comments')).toBeUndefined();
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
    expect(routePartNote(start(CF_PAID, 0, 1), 'comments')).toContain(
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

  it('静的書き出しでは、コメントの投稿のたびのビルドし直しが増える。Astro はビルドせず、記事のキャッシュを消す回数が増える（D-103）', () => {
    const a = resolved(start(CF_PAID, 0, 0, 'nextjs-export'));
    const b = resolved(start(CF_PAID, 0, 1, 'nextjs-export'));
    expect(b.builds.count).toBeGreaterThan(a.builds.count * 10);
    const x = resolved(start(CF_PAID, 0, 0, 'astro'));
    const y = resolved(start(CF_PAID, 0, 1, 'astro'));
    expect(x.builds.count).toBe(0);
    expect(y.builds.count).toBe(0);
    expect(y.onDemandUpdates).toBeCloseTo(15_000, 6);
    expect(y.classes['isr-revalidate'].count).toBeGreaterThan(
      x.classes['isr-revalidate'].count,
    );
    expect(routePartNote(start(CF_PAID, 0, 1, 'astro'), 'comments')).toContain(
      'キャッシュを消します',
    );
  });

  it('切り替えは記事のページの部品の行動で、手間 2（どちらの向きも）。SPA・枠 + API・ほかのページでは選べない', () => {
    expect(EFFORT.route.comments).toBe(2);
    const st = playMonth(start(CF_PAID, 300, 0));
    const on = {
      type: 'route-part',
      route: 'article',
      part: 'comments',
      value: 1,
    } as const;
    expect(checkAction(st, on)).toEqual({ ok: true, cost: 2 });
    const back = playMonth(applyActions(st, [on]));
    expect(commentsNow(back)).toBe(COMMENTS_IN_PAGE);
    expect(checkAction(back, on)).toMatchObject({ ok: false, reason: 'same' });
    const off = { ...on, value: 0 };
    expect(checkAction(back, off)).toEqual({ ok: true, cost: 2 });
    expect(playMonth(applyActions(back, [off])).routeParts).toBeUndefined();
    expect(checkAction(st, { ...on, route: 'personal' }).ok).toBe(false);
    const spa = playMonth(start(CF_PAID, 300, 0, 'vite-spa'));
    const r = checkAction(spa, on);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SPA');
    const api = playMonth(
      newGame(
        CF_PAID,
        1,
        sc,
        DEFAULT_START_DATE,
        'nextjs',
        undefined,
        300,
        undefined,
        undefined,
        { article: 'shell-api' },
      ),
    );
    expect(checkAction(api, on)).toMatchObject({ ok: false });
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
        routeParts: { article: { comments: 1 } },
      }),
      [],
    );
    const st = replaySave(parseSave(JSON.parse(JSON.stringify(save)))!);
    expect(commentsNow(st)).toBe(COMMENTS_IN_PAGE);
    const { routeParts: _, ...old } = save;
    expect(commentsNow(replaySave(parseSave(old)!))).toBe(COMMENTS_IN_BROWSER);
    expect(parseSave({ ...save, routeParts: { article: 'x' } })).toBeNull();
    expect(parseSave({ ...save, comments: 'x' })).toBeNull();
  });

  it('版 2 の保存（始めたときの comments と、行動 set comments）は、記事のページの部品として読んで同じ結果になる（D-109）', () => {
    const turns = [
      [{ type: 'set', key: 'comments', value: 0 }],
      [],
      [{ type: 'set', key: 'comments', value: 1 }],
      [{ type: 'set', key: 'isr', value: 60 }],
    ];
    const v2 = {
      version: 2,
      scenarioId: sc.id,
      stackIndex: CF_PAID,
      framework: 'nextjs',
      seed: 7,
      startDate: DEFAULT_START_DATE,
      revalidateSec: 300,
      comments: 1,
      turns,
    };
    const v3 = {
      ...v2,
      version: 3,
      comments: undefined,
      routeParts: { article: { comments: 1 } },
      turns: turns.map((t) =>
        t.map((a) =>
          a.key === 'comments'
            ? {
                type: 'route-part',
                route: 'article',
                part: 'comments',
                value: a.value,
              }
            : a,
        ),
      ),
    };
    const a = replaySave(parseSave(v2)!);
    const b = replaySave(parseSave(JSON.parse(JSON.stringify(v3)))!);
    expect(a.history.length).toBe(5);
    expect(a.cash).toBe(b.cash);
    expect(a.routeParts).toEqual(b.routeParts);
    expect(commentsNow(a)).toBe(COMMENTS_IN_PAGE);
    expect(a.history.map((h) => h.infraCost)).toEqual(
      b.history.map((h) => h.infraCost),
    );
    // 手間も同じ（2 か月目に外す・4 か月目に含める）
    expect(a.history.map((h) => h.effort)).toEqual(
      b.history.map((h) => h.effort),
    );
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

  it('反映スピード（D-85）: 含めて時間で再検証すると、コメントは間隔の分だけ遅れて見え、記事とコメントの悪い方になる', () => {
    const fresh = (rev: number, cm: number, fw: FrameworkId = 'nextjs') =>
      playMonth(start(CF_PAID, rev, cm, fw)).history[0]!.satisfaction;
    // ブラウザで読み込む: コメントは常に新しい（記事の 5 分は「良い」のまま）
    expect(fresh(300, COMMENTS_IN_BROWSER).stages.freshness).toBe('good');
    // 含める × 1 分: コメントも「良い」の内
    expect(fresh(60, COMMENTS_IN_PAGE).stages.freshness).toBe('good');
    // 含める × 5 分: 記事は「良い」・コメントは「普通」→「普通」。理由にコメントの遅れを出す
    const five = fresh(300, COMMENTS_IN_PAGE);
    expect(five.stages.freshness).toBe('fair');
    expect(five.reasons.freshness).toContain(
      'コメントも間隔の分だけ遅れて見えます',
    );
    // 含める × 1 時間: 記事は「普通」・コメントは「悪い」→「悪い」
    expect(fresh(3600, COMMENTS_IN_PAGE).stages.freshness).toBe('bad');
    expect(fresh(3600, COMMENTS_IN_BROWSER).stages.freshness).toBe('fair');
    // オンデマンド（コメントのたびに作り直す）は遅れない: 含めても含めなくても同じ
    expect(fresh(0, COMMENTS_IN_PAGE).stages.freshness).toBe(
      fresh(0, COMMENTS_IN_BROWSER).stages.freshness,
    );
    // Astro のビルドの間隔も同じ
    expect(fresh(300, COMMENTS_IN_PAGE, 'astro').stages.freshness).toBe('fair');
    expect(fresh(300, COMMENTS_IN_BROWSER, 'astro').stages.freshness).toBe(
      'good',
    );
  });

  it('反映スピード（D-85）: ISR のキャッシュを使わない（毎回描く）なら、含めてもコメントは遅れない', () => {
    const st = playMonth(
      start(CF_PAID, 300, COMMENTS_IN_PAGE, 'nextjs', { isrCache: 'none' }),
    );
    expect(st.history[0]!.satisfaction.stages.freshness).toBe('good');
  });
});
