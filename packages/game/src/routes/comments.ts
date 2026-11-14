// コメントの部分（ページに含めるか・ブラウザから取るか。ROUTE_PARTS）。
import type { Scenario } from '../scenario.ts';
import type { FrameworkId } from 'catalog';
import { EFFORT } from '../rules.ts';
import { COMMENTS_IN_BROWSER, COMMENTS_IN_PAGE } from '../settings.ts';
import type {
  RouteOverrides,
  RoutePartChoice,
  RoutePartKey,
  RouteParts,
} from '../state.ts';
import { articleFamily, publicRoute } from './strategy.ts';

/**
 * 記事のページ（全員に同じ中身）のコメント欄の描き方（D-109）。選んでいなければブラウザで読み込む。
 * コメントの無いシナリオ・記事のページの無いシナリオもブラウザで読み込む（値は効かない）。
 */
export function commentsOf(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  parts: RouteParts | undefined,
): number {
  const r = publicRoute(sc);
  return (r && parts?.[r.id]?.comments) ?? COMMENTS_IN_BROWSER;
}

/** 始める画面・見積モードのコメント欄の値（数）を、ページの部品にする（省略・ブラウザで読み込むは空。D-109）。 */
export function partsOfComments(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  comments: number | undefined,
): RouteParts | undefined {
  return comments === undefined || comments === COMMENTS_IN_BROWSER
    ? undefined
    : withComments(sc, undefined, comments);
}

/** コメント欄の描き方を替えたページの部品（既定のブラウザで読み込むは持たない。D-109）。 */
export function withComments(
  sc: Pick<Scenario, 'template' | 'routeTraits'>,
  parts: RouteParts | undefined,
  comments: number,
): RouteParts {
  const r = publicRoute(sc);
  const out: Partial<Record<string, RoutePartChoice>> = { ...parts };
  if (!r) return out;
  if (comments === COMMENTS_IN_BROWSER) delete out[r.id];
  else out[r.id] = { ...out[r.id], comments };
  return out;
}

/**
 * 記事のページのコメント欄の描き方を選べるか（D-82・D-109）。シナリオにコメントがあり、記事のページが HTML である
 * （S5 の枠 + API・SPA はページの中身が無いので含められない）ときだけ。
 */
export function commentsChoosable(
  framework: FrameworkId,
  sc: Pick<Scenario, 'comments' | 'template' | 'routeTraits'>,
  routes?: RouteOverrides,
): boolean {
  const fam = articleFamily({ scenario: sc, framework, routes });
  return (
    (fam !== undefined ? fam !== 'api' : framework !== 'vite-spa') &&
    sc.comments !== undefined
  );
}

/**
 * コメントを記事のページに含めるか（D-82）。記事のページの部品が「記事のページに含める」（D-109）で、選べるときだけ。
 */
export function commentsInPage(
  comments: number,
  framework: FrameworkId,
  sc: Pick<Scenario, 'comments' | 'template' | 'routeTraits'>,
  routes?: RouteOverrides,
): boolean {
  return (
    comments === COMMENTS_IN_PAGE && commentsChoosable(framework, sc, routes)
  );
}

/**
 * ページの部品の選択肢（段 4・D-109）。今は記事のページのコメント欄だけ。始める画面・ゲームの途中・見積モードで、
 * 描き方の表の記事の行に出す（前は全体の設定「コメントの描き方」。D-82）。手間は今までの設定と同じ（どちらの向きも 2）。
 */
export const ROUTE_PARTS = {
  /**
   * コメント欄の描き方（D-82。段 4 で記事のページの部品に移した。D-109）。記事のページに含めると、コメントの投稿も記事のページを作り直す更新に数え（シナリオの
   * comments.pageUpdateShare）、記事のページの API の読み込み（コメントの取得）が無くなる。SPA・コメントの無いシナリオでは出さない。
   */
  comments: {
    label: 'コメント欄',
    effort: EFFORT.route.comments,
    note: 'コメント欄を、ブラウザが記事を開いてから API で読み込むか、記事のページ（HTML）に含めるかを選びます。含めると、記事を開いたときのコメントの取得（API の呼び出し）が無くなり、コメントも HTML で届きます。代わりにコメントの投稿のたびに記事のページが変わるので、更新で消す再検証では作り直し（OpenNext では CloudFront の無効化も）が、Astro では記事のキャッシュを消して描き直す回数が、静的書き出しではビルドし直しが増えます。時間の再検証・間隔でまとめるビルドでは、作り直しの回数は更新の数にほぼ依らないので増えにくいですが、コメントはその間隔の分だけ遅れて見え、反映スピード（満足度）が下がります（コメントは記事より厳しく、1 分までなら「良い」・5 分までなら「普通」とみなす。ゲーム上の仮定）。ブラウザで読み込むのは、Next.js の文書（Suspense で後から流す）・Astro のアイランドの形に近い一般的な作り方です（D-70）',
    options: [
      { value: COMMENTS_IN_BROWSER, label: 'ブラウザで読み込む' },
      { value: COMMENTS_IN_PAGE, label: '記事のページに含める' },
    ],
  },
} as const satisfies Record<
  RoutePartKey,
  {
    label: string;
    effort: number;
    note: string;
    options: readonly { value: number; label: string }[];
  }
>;
