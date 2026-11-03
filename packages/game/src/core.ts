// ゲームの土台: 見積の入口（メールを送らないシナリオの扱い）・シナリオの一覧・為替・シナリオとフレームワークの既定・
// 料金データ（books）と予定された料金の改定。
import {
  estimate as estimateArch,
  type PriceBook,
  type ScheduledChange,
} from 'estimator';
import {
  type Choices,
  type FrameworkId,
  loadPriceBooks,
  type Platform,
  sendsEmail,
  withoutUnusedEmail,
} from 'catalog';
import type { EventDef, Scenario } from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import { CONTRACT_OPERATIONS } from './scenarios/contract-operations.ts';
import type { GameState } from './state.ts';

/**
 * 見積（estimator の estimate）。アプリがメールを送らないシナリオ（Workload に email が無い）では、送信のノードを外してから回す
 * （部品「メール送信」も出さない。D-101）。ゲームの見積はすべてこれを通す。
 */
export const estimate: typeof estimateArch = (input) =>
  estimateArch({
    ...input,
    architecture: withoutUnusedEmail(input.architecture, input.workload),
  });

/** アプリがメールを送るシナリオか（テンプレートに email がある。D-101）。 */
export const scenarioSendsEmail = (sc: Pick<Scenario, 'template'>): boolean =>
  sendsEmail(sc.template(1));

/** 組み込みのシナリオ（id で引く。保存したゲームを読み込むときに使う）。ゲームの計算はこの表を書き換えない。 */
export const SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  [ARTICLE_COMMUNITY.id]: ARTICLE_COMMUNITY,
  [CONTRACT_OPERATIONS.id]: CONTRACT_OPERATIONS,
});

/** ⚠ 為替は取得していない（仮定）。シナリオによらない共通の仮定。 */
export const USD_JPY = 150;

/** テンプレートの SSR 1 回の CPU（シナリオのテンプレートから読む）。 */
export function baseSsrCpuMsOf(sc: Scenario): number {
  return sc.template(1).routes[0]!.processing.cpuMs;
}

/** 記事コミュニティの値の見え方（画面とテストの互換のため。正はシナリオのデータ）。 */
export const GAME = {
  months: ARTICLE_COMMUNITY.months,
  startPV: ARTICLE_COMMUNITY.scale.startPV,
  startCash: ARTICLE_COMMUNITY.startCash,
  usdJpy: USD_JPY,
  baseSsrCpuMs: baseSsrCpuMsOf(ARTICLE_COMMUNITY),
  goal: ARTICLE_COMMUNITY.goal,
} as const;

export function scenarioOf(state: Pick<GameState, 'scenario'>): Scenario {
  return state.scenario;
}

/** シナリオで選べるフレームワーク（省略は Next.js だけ）と既定。 */
export function frameworksOf(sc: Scenario): {
  allowed: FrameworkId[];
  default: FrameworkId;
} {
  return sc.frameworks ?? { allowed: ['nextjs'], default: 'nextjs' };
}

/**
 * フレームワークの既定の部品（SPA は OGP の前処理なし・API の応答のキャッシュなし。prd/10 F-07・D-37）。
 * Next.js の静的書き出し（D-80）は next/image の既定のローダーが使えないので、閲覧のときに変換する事業者の画像の部品
 * （Vercel の画像の最適化・VPS のホスト・Cloud Run で変換）が無い。platform を渡すと、その事業者では投稿のときに縮める部品を既定にする。
 * シナリオが画像のスロットを隠しているとき（受託の添付ファイル）は、画像の部品は効かせないので替えない。
 */
export function frameworkDefaults(
  framework: FrameworkId,
  platform?: Platform,
  scenario?: Pick<Scenario, 'hidden'>,
): Choices {
  // API の置き場の既定は同じ事業者（SPA は D-65・Next.js は D-67）
  if (framework === 'vite-spa')
    return { ogp: 'none', apiCache: 'none', api: 'same' };
  if (
    framework === 'nextjs-export' &&
    (platform === 'vercel' || platform === 'sakura' || platform === 'gcp') &&
    !scenario?.hidden?.slots?.includes('images')
  )
    return { api: 'same', images: 'resize' };
  return { api: 'same' };
}

export function eventDef(sc: Scenario, id: string): EventDef | undefined {
  return sc.events.find((e) => e.id === id);
}

export const books = loadPriceBooks();

/** 既定の始めた日（料金データの取得日）。テストと基準プレイの golden はこの日で固定する。 */
export const DEFAULT_START_DATE = '2026-10-31';

/** catalog の施行日つきの予告（id は事業者と施行日）。 */
export const SCHEDULED_CHANGES: (ScheduledChange & {
  id: string;
  provider: string;
})[] = books.flatMap((b) =>
  b.scheduledChanges.map((c) => ({
    ...c,
    id: `revision:${b.provider}:${c.effectiveFrom}`,
    provider: b.provider,
  })),
);

/**
 * その月の料金データ（D-21）。起きた改定のうち、改定後の料金を持つものだけメーターの料金を差し替える。
 * 改定後の料金が無い予告は計算を変えない。同じメーターの改定が複数起きていれば、後に起きたほうを使う。
 */
export function applyRevisions(
  base: readonly PriceBook[],
  changes: readonly (ScheduledChange & { id: string; provider: string })[],
  revisions: readonly { id: string; month: number }[],
  month: number,
): PriceBook[] {
  const occurred = (c: { id: string }) =>
    revisions.find((r) => r.id === c.id && r.month <= month)?.month;
  // 起きた月の順（同じ月なら施行日の順）。後ろの改定が前の改定を上書きする
  const due = changes
    .filter((c) => c.revisedMeters.length > 0 && occurred(c) !== undefined)
    .sort(
      (a, b) =>
        occurred(a)! - occurred(b)! ||
        a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
  if (!due.length) return [...base];
  return base.map((b) => {
    const mine = due.filter((c) => c.provider === b.provider);
    if (!mine.length) return b;
    return {
      ...b,
      plans: b.plans.map((p) => ({
        ...p,
        meters: p.meters.map((m) => {
          const rv = mine
            .flatMap((c) => c.revisedMeters)
            .findLast((x) => x.planId === p.id && x.meterId === m.id);
          return rv ? { ...m, pricing: rv.pricing } : m;
        }),
      })),
    };
  });
}

export const booksAt = (state: Pick<GameState, 'revisions'>, month: number) =>
  applyRevisions(books, SCHEDULED_CHANGES, state.revisions, month);

/** 改定の出来事の文（D-21）。計算への影響を正確に書く。 */
export function revisionText(
  c: (typeof SCHEDULED_CHANGES)[number],
  usedByStack: boolean,
): string {
  const effect =
    c.revisedMeters.length > 0
      ? 'あり（改定後の料金を公式の出典つきで持っているので、今月から改定後の料金で計算する）'
      : `なし（${c.notModeledReason}）`;
  return `実際に予告されている改定（${c.provider}・施行日 ${c.effectiveFrom}）: ${c.description}。${usedByStack ? '' : '今の構成では使っていない事業者。'}このモデルの計算への影響: ${effect}`;
}
