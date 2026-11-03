// 始める画面・部品の欄の見積（1 か月目の見込み・CDN の無効化の見込み・部品の差し替えの見込み）。
import {
  type Choices,
  componentsOf,
  type FrameworkId,
  type SlotId,
} from 'catalog';
import type { Scenario } from '../scenario.ts';
import {
  booksAt,
  DEFAULT_START_DATE,
  estimate,
  scenarioOf,
  USD_JPY,
} from '../core.ts';
import { nextSsrCpuMs } from '../effort.ts';
import { premiseRefsOf } from '../events.ts';
import { commas, lineLabel, toUsd, usd } from '../format.ts';
import { emailOnlyPremise } from '../month/outcome.ts';
import { partsOfComments } from '../routes/comments.ts';
import { ON_DEMAND_REVALIDATE } from '../settings.ts';
import { STACKS } from '../stacks.ts';
import type { GameState, MonthEvent, RouteOverrides } from '../state.ts';
import { architectureFor, staticBuildOf, workloadFor } from '../workload.ts';
import { newGame } from './new-game.ts';

/**
 * 部品を選ぶ前に出す、当たりうる前提（D-24・選ぶ前に前提の文を出す）。今月の基準の PV で、その部品に替えた見積を引き、
 * 部品の premiseRefs に当たる前提を返す。表示のためだけで、ゲームの状態には入れない。
 */
export function componentPreview(
  state: GameState,
  slot: SlotId,
  option: string,
): MonthEvent['premises'] {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const def = componentsOf(platform, slot, state.framework).find(
    (c) => c.id === option,
  );
  if (!def || def.premiseRefs.length === 0) return [];
  const components = { ...state.components, [slot]: option };
  const r = estimate({
    workload: workloadFor(sc, {
      pv: state.basePV,
      settings: state.settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: sc.stock ? state.stock : null,
      platform,
      components,
      framework: state.framework,
      routes: state.routes,
      legacyRouteDefaults: state.legacyRouteDefaults,
      routeParts: state.routeParts,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      components,
      {},
      state.storageOption,
      staticBuildOf(sc, state.stackIndex, state.framework, state.routes),
      { tiers: state.capacityTiers },
    ),
    books: booksAt(state, state.history.length + 1),
  });
  return premiseRefsOf(def, r.premises);
}

/**
 * オンデマンドの再検証にしたときの CloudFront の無効化の見込み（D-66）。今月の基準の PV と今の部品で見積を引き、
 * 無効化のメーターの明細を読む。無効化が起きない構成（OpenNext 以外・ISR を CloudFront にキャッシュしない部品）は undefined。
 * included: 定額のプランで込み（解釈）。freePaths・unitUsd は従量の料金データ（無料のパス・1 パスの単価）。表示のためだけ。
 */
export type InvalidationEstimate = {
  paths: number;
  usd: number;
  included: boolean;
  freePaths: number;
  unitUsd: number;
  /** 無効化をワイルドカードでまとめているか（D-79）。 */
  wildcard: boolean;
  /**
   * ページごとに無効化している従量の構成で、ワイルドカードでまとめたときの見込み（選ぶ前に比べるため。D-79）。
   * まとめ方を選べない構成・定額のプラン（込み）・すでにまとめているときは undefined。
   */
  ifWildcard?: { paths: number; usd: number };
};

/** 無効化のまとめ方のスロット（D-79）。 */
const INVALIDATION_SLOT = 'cdnInvalidation';
const WILDCARD = 'wildcard';

export function onDemandInvalidationEstimate(
  state: GameState,
): InvalidationEstimate | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  const bk = booksAt(state, state.history.length + 1);
  const lines = invalidationLines(state, state.components, bk);
  if (lines.length === 0) return undefined;
  const wildcard = state.components[INVALIDATION_SLOT] === WILDCARD;
  const included = lines.every((l) => l.priceRef.planId !== 'cloudfront');
  const canWildcard = componentsOf(
    platform,
    INVALIDATION_SLOT,
    state.framework,
  ).some((o) => o.id === WILDCARD);
  const alt =
    !wildcard && !included && canWildcard
      ? invalidationLines(
          state,
          { ...state.components, [INVALIDATION_SLOT]: WILDCARD },
          bk,
        )
      : undefined;
  // 従量の料金データ（CloudFront の無効化の無料のパスと単価）
  const payg = bk
    .find((b) => b.provider === 'aws')
    ?.plans.find((p) => p.id === 'cloudfront');
  const meter = payg?.meters.find((m) => m.id === INVALIDATION_METER);
  const pool = bk
    .find((b) => b.provider === 'aws')
    ?.allowancePools.find((p) => p.id === meter?.allowancePool);
  const unitUsd =
    meter?.pricing.model === 'flat'
      ? meter.pricing.unitPrice / meter.pricing.per
      : 0;
  const sum = (ls: typeof lines) => ({
    paths: ls.reduce((a, l) => a + (l.quantity ?? 0), 0),
    usd: ls.reduce((a, l) => a + (l.amount ?? 0), 0),
  });
  return {
    ...sum(lines),
    included,
    freePaths: pool?.quantity ?? 0,
    unitUsd,
    wildcard,
    ...(alt ? { ifWildcard: sum(alt) } : {}),
  };
}

/** オンデマンドにしたときの、今月の基準の PV での無効化のメーターの明細（部品を差し替えて引けるようにした。D-79）。 */
function invalidationLines(
  state: GameState,
  components: Choices,
  bk: ReturnType<typeof booksAt>,
) {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const settings = { ...state.settings, revalidateSec: ON_DEMAND_REVALIDATE };
  const r = estimate({
    workload: workloadFor(sc, {
      pv: state.basePV,
      settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: sc.stock ? state.stock : null,
      platform,
      components,
      framework: state.framework,
      routes: state.routes,
      legacyRouteDefaults: state.legacyRouteDefaults,
      routeParts: state.routeParts,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      components,
      {},
      state.storageOption,
      staticBuildOf(sc, state.stackIndex, state.framework, state.routes),
      { tiers: state.capacityTiers },
    ),
    books: bk,
  });
  return r.bill.lines.filter(
    (l) => l.priceRef.meterId === INVALIDATION_METER && (l.quantity ?? 0) > 0,
  );
}

export const INVALIDATION_METER = 'invalidation-paths';

/** 始める画面で、オンデマンドを選んだときの無効化の見込み（1 か月目の規模。D-66）。 */
export function setupInvalidationEstimate(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Choices,
  /** 始める画面で選んだコメントの描き方（記事のページに含めると無効化が増える。D-82）。 */
  comments?: number,
): InvalidationEstimate | undefined {
  return onDemandInvalidationEstimate(
    newGame(
      stackIndex,
      1,
      scenario,
      DEFAULT_START_DATE,
      framework,
      components,
      ON_DEMAND_REVALIDATE,
      partsOfComments(scenario, comments),
    ),
  );
}

/** 無効化の見込みの文（再検証の設定の「オンデマンド」の選択肢に添える。D-66）。 */
export function invalidationNote(e: InvalidationEstimate): string {
  const paths = `無効化 月約 ${commas(e.paths)} パス${e.wildcard ? '（ワイルドカードでまとめた分。更新していないページの CDN のキャッシュも消える）' : ''}`;
  const alt = e.ifWildcard
    ? `。ワイルドカードでまとめると 約 ${commas(e.ifWildcard.paths)} パス・約 ${usd(e.ifWildcard.usd)}（代わりに更新していないページの CDN のキャッシュも消える）`
    : '';
  return e.included
    ? `${paths}（定額のプランでは込み。解釈）`
    : `${paths}・約 ${usd(e.usd)}（月 ${commas(e.freePaths)} パスまで無料、以降 1 パス $${e.unitUsd}）${alt}`;
}

/**
 * 始める画面の 1 か月目の費用と収益の見込み（D-72）。ゲーム上の目安で、出来事・乱数（話題・Bot・自前運用の障害）は含めない。
 * 1 か月目の基準の PV と選んだ部品・設定で、playMonth と同じ Workload・見積を引く。収益は広告・固定の収益に、前提に当たって
 * 止まる・遅くなる月の減りだけを掛ける。short: 費用が「開始の所持金 + 収益」を超える（1 か月目に所持金が尽きる見込み）。
 * topLines: 金額の大きい明細（$1 以上の上位 3 件。同じラベルはまとめる・USD に直す・クレジット前）。
 */
export type MonthOneEstimate = {
  costUsd: number;
  revenueUsd: number;
  startCash: number;
  short: boolean;
  topLines: { label: string; usd: number }[];
  /** 1 か月目に当たって止まる・遅くなる前提（収益を減らす理由。detail はどのルートが当たるか。D-99）。 */
  blocking: {
    id: string;
    text: string;
    detail?: string;
    /** 1 リクエストの CPU の制限に当たったルート（D-99 の causes。D-107 の表の行に出す）。 */
    routes?: string[];
  }[];
  /**
   * 1 か月目に当たるメールの送信の上限（サイトは止まらず、メールが届かない日がある。収益は減らさず、機能を 1 段下げる。D-117）。
   */
  undelivered: { id: string; text: string }[];
};

export function setupMonthOneEstimate(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Choices,
  revalidateSec?: number,
  comments?: number,
  /** 選んだページごとの描き方（D-107）。 */
  routes?: RouteOverrides,
): MonthOneEstimate {
  const state = newGame(
    stackIndex,
    1,
    scenario,
    DEFAULT_START_DATE,
    framework,
    components,
    revalidateSec,
    partsOfComments(scenario, comments),
    undefined,
    routes,
  );
  const r = estimate({
    workload: workloadFor(scenario, {
      pv: state.basePV,
      settings: state.settings,
      ssrCpuMs: nextSsrCpuMs(state),
      mods: state.mods,
      stock: scenario.stock ? state.stock : null,
      platform: STACKS[state.stackIndex]!.provider,
      components: state.components,
      framework: state.framework,
      routes: state.routes,
      legacyRouteDefaults: state.legacyRouteDefaults,
      routeParts: state.routeParts,
    }),
    architecture: architectureFor(
      state.stackIndex,
      state.seats,
      state.framework,
      state.components,
      {},
      state.storageOption,
      staticBuildOf(scenario, state.stackIndex, state.framework, state.routes),
      // 1 か月目は始めたばかりの契約（容量の段は最小の段。D-120）
      { tiers: state.capacityTiers },
    ),
    books: booksAt(state, 1),
  });
  const costUsd = toUsd(r.bill.totals);
  const loss = scenario.revenue.loss;
  // メールの送信の上限はサイトを止めない（収益を減らさない。D-117）
  const hit = (e: string[]) =>
    r.premises.some(
      (p) => p.hit && e.includes(p.effect) && !emailOnlyPremise(p),
    );
  let revenueUsd =
    (scenario.revenue.fixedUsdPerMonth ?? 0) +
    (state.basePV / 1000) * scenario.revenue.adsUsdPer1000PV;
  if (hit(['block', 'upgrade-required'])) revenueUsd *= 1 - loss.block;
  else if (hit(['throttle'])) revenueUsd *= 1 - loss.throttle;
  const byLabel = new Map<string, number>();
  for (const l of r.bill.lines) {
    if (!l.amount) continue;
    const v = l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
    byLabel.set(lineLabel(l), (byLabel.get(lineLabel(l)) ?? 0) + v);
  }
  const topLines = [...byLabel]
    .filter(([, v]) => v >= 1) // $1 未満の明細は主な費用に出さない
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, v]) => ({ label, usd: v }));
  return {
    costUsd,
    revenueUsd,
    startCash: scenario.startCash,
    short: costUsd > scenario.startCash + revenueUsd,
    topLines,
    undelivered: r.premises
      .filter(
        (p) =>
          p.hit &&
          (p.effect === 'block' || p.effect === 'upgrade-required') &&
          emailOnlyPremise(p),
      )
      .map((p) => ({ id: p.id, text: p.text })),
    blocking: r.premises
      .filter(
        (p) =>
          p.hit &&
          (p.effect === 'block' ||
            p.effect === 'upgrade-required' ||
            p.effect === 'throttle') &&
          !emailOnlyPremise(p),
      )
      .map((p) => {
        const routes = [
          ...new Set(
            (p.causes ?? []).flatMap((c) =>
              c.routeId !== undefined ? [c.routeId] : [],
            ),
          ),
        ];
        return {
          id: p.id,
          text: p.text,
          ...(p.detail !== undefined ? { detail: p.detail } : {}),
          ...(routes.length ? { routes } : {}),
        };
      }),
  };
}
