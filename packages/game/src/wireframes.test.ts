// ページの見取り図のデータの整合（D-102）。シナリオの wireframes が、ページの一覧・テンプレートのルート・
// 選べるフレームワークと食い違っていないこと。区画の作られ方の値そのものは図の仮定なので、代表だけ確かめる。
import { describe, expect, it } from 'vitest';
import {
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  frameworksOf,
  pageWireframes,
  REGION_SOURCES,
  SCENARIOS,
} from './index.ts';

const sources = (
  ...args: Parameters<typeof pageWireframes>
): Record<string, Record<string, string>> =>
  Object.fromEntries(
    pageWireframes(...args).map((p) => [
      p.route,
      Object.fromEntries(p.regions.map((r) => [r.id, r.source])),
    ]),
  );

describe('ページの見取り図のデータ', () => {
  for (const sc of Object.values(SCENARIOS)) {
    describe(sc.name, () => {
      const wireframes = sc.text?.wireframes ?? [];
      const routes = sc.template(1).routes;

      it('テンプレートのルートごとに見取り図が 1 枚ずつある', () => {
        expect(wireframes.map((w) => w.route).sort()).toEqual(
          routes.map((r) => r.id).sort(),
        );
      });

      it('ページの一覧のページ（ルートの名前）すべてに見取り図がある', () => {
        const pages = sc.text?.pages ?? [];
        for (const r of routes) {
          expect(r.label, `${r.id} に名前が無い`).toBeDefined();
          expect(
            pages.some((line) => line.startsWith(r.label ?? r.id)),
            `${r.label} が pages に無い`,
          ).toBe(true);
        }
      });

      it('選べるフレームワークすべてで、すべての区画に作られ方がある', () => {
        for (const w of wireframes) {
          const ids = w.regions.map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);
          for (const fw of frameworksOf(sc).allowed) {
            const tags = w.byFramework[fw];
            expect(Object.keys(tags).sort(), `${w.route} × ${fw}`).toEqual(
              [...ids].sort(),
            );
            for (const s of Object.values(tags))
              expect(REGION_SOURCES[s]).toBeDefined();
          }
          for (const [fw, over] of Object.entries(w.commentsInPage ?? {}))
            for (const id of Object.keys(over ?? {}))
              expect(ids, `${w.route} × ${fw} の上書き`).toContain(id);
        }
      });
    });
  }
});

describe('pageWireframes（今の計算のモデルどおり）', () => {
  const sc = SCENARIOS['article-community']!;

  it('Next.js: 記事は ISR・個人は SSR・コメントはブラウザが API で取る', () => {
    const s = sources(sc, 'nextjs');
    expect(s.article).toMatchObject({ body: 'isr', comments: 'api' });
    expect(s.personal).toMatchObject({ mine: 'ssr' });
  });

  it('Astro: 記事は閲覧時に SSR + キャッシュ（投稿で消す。D-103）・個人は SSR・コメントはアイランド', () => {
    const s = sources(sc, 'astro');
    expect(s.article).toMatchObject({
      body: 'cached',
      comments: 'island',
      likes: 'island',
      login: 'island',
    });
    expect(s.personal).toMatchObject({ mine: 'ssr' });
  });

  it('静的書き出し: 個人は静的な枠 + API。SPA はシェル + API', () => {
    expect(sources(sc, 'nextjs-export').personal).toMatchObject({
      header: 'build',
      mine: 'api',
    });
    expect(sources(sc, 'vite-spa').article).toMatchObject({
      header: 'shell',
      body: 'api',
    });
  });

  it('コメントを記事のページに含めると、コメント欄は記事の HTML の一部になる（SPA は変わらない。D-82）', () => {
    expect(sources(sc, 'nextjs', COMMENTS_IN_PAGE).article!.comments).toBe(
      'isr',
    );
    expect(sources(sc, 'astro', COMMENTS_IN_PAGE).article!.comments).toBe(
      'cached',
    );
    expect(sources(sc, 'astro', COMMENTS_IN_BROWSER).article!.comments).toBe(
      'island',
    );
    expect(sources(sc, 'vite-spa', COMMENTS_IN_PAGE).article!.comments).toBe(
      'api',
    );
  });

  it('コメントの無いシナリオ（受託）では、設定を渡しても変わらない', () => {
    const contract = SCENARIOS['contract-operations']!;
    expect(sources(contract, 'nextjs', COMMENTS_IN_PAGE)).toEqual(
      sources(contract, 'nextjs'),
    );
  });
});
