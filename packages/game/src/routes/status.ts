// 描き方の計画の各行を実際に回した結果（始める画面の描き方の表の状態）。
import type { Stage } from '../rules.ts';
import type { Choices, FrameworkId, RouteStrategyId } from 'catalog';
import type { Scenario } from '../scenario.ts';
import { DEFAULT_START_DATE } from '../core.ts';
import { playMonth } from '../month/play.ts';
import { setupMonthOneEstimate } from '../setup/estimates.ts';
import { newGame } from '../setup/new-game.ts';
import type { RouteOverrides } from '../state.ts';
import { STACKS } from '../stacks.ts';
import { partsOfComments } from './comments.ts';
import { routePlanRows } from './plan.ts';
import { articleShellPerPage, withRouteChoice } from './strategy.ts';

/** 表の行の要件の判定（D-107。始める画面の 1 か月目の見込みと同じ組み立て）。 */
export type RouteRowStatus = {
  route: string;
  /** 反映スピード（全員に同じ中身のページだけ。1 か月目の満足度の判定）。 */
  freshness?: { stage: Stage; text: string };
  /** SNS のカード（HTML に記事ごとのメタタグが要るページだけ）。 */
  ogp?: { ok: boolean; text: string };
  /** 1 リクエストの CPU の制限（D-99 の causes をこのページで絞ったもの）。 */
  cpu: { ok: boolean; text?: string };
  /** ほかの描き方にしたときの 1 か月目の費用の差（USD）と、当たって止まる・遅くなる前提の数の差。 */
  deltas: Partial<
    Record<RouteStrategyId, { costUsd: number; blocking: number }>
  >;
};

/** 始める画面の選択（表の要件の判定・見込みの入力）。 */
export type RouteSetup = {
  framework: FrameworkId;
  stackIndex: number;
  components: Choices;
  revalidateSec?: number | undefined;
  comments?: number | undefined;
  routes?: RouteOverrides | undefined;
};

/**
 * ページごとの描き方の行の要件の判定と、ほかの描き方にしたときの 1 か月目の差（D-107）。
 * 1 か月目の基準の PV で、setupMonthOneEstimate（費用・止まる前提）と playMonth の 1 か月目（反映スピード）を引く。出来事・乱数は含めない目安。
 */
export function routePlanStatus(sc: Scenario, p: RouteSetup): RouteRowStatus[] {
  const est = (x: RouteSetup) =>
    setupMonthOneEstimate(
      sc,
      x.stackIndex,
      x.framework,
      x.components,
      x.revalidateSec,
      x.comments,
      x.routes,
    );
  const base = est(p);
  const state = newGame(
    p.stackIndex,
    1,
    sc,
    DEFAULT_START_DATE,
    p.framework,
    p.components,
    p.revalidateSec,
    partsOfComments(sc, p.comments),
    undefined,
    p.routes,
  );
  const month1 = playMonth(state).history[0]!;
  const rows = routePlanRows(sc, {
    framework: state.framework,
    stackIndex: state.stackIndex,
    settings: state.settings,
    components: state.components,
    routes: state.routes,
    routeParts: state.routeParts,
  });
  return rows.map((row) => {
    const cpuHit = base.blocking.filter(
      (b) => b.id.startsWith('limit:') && b.routes?.includes(row.route),
    );
    const deltas: RouteRowStatus['deltas'] = {};
    for (const alt of row.alternatives) {
      if (!alt.available) continue;
      const e = est({
        ...p,
        routes: withRouteChoice(
          sc,
          {
            framework: state.framework,
            platform: STACKS[state.stackIndex]!.provider,
          },
          state.routes,
          row.route,
          alt.strategy,
        ),
        revalidateSec: alt.value ?? state.settings.revalidateSec,
      });
      deltas[alt.strategy] = {
        costUsd: e.costUsd - base.costUsd,
        blocking: e.blocking.length - base.blocking.length,
      };
    }
    const fresh = row.audience === 'public';
    return {
      route: row.route,
      ...(fresh
        ? {
            freshness: {
              stage: month1.satisfaction.stages.freshness,
              text:
                month1.satisfaction.reasons.freshness ??
                '更新はすぐ・間隔の内に見えます',
            },
          }
        : {}),
      ...(row.traits?.needsOgp
        ? {
            ogp:
              row.strategy === 'shell-api' &&
              !articleShellPerPage(state) &&
              state.components.ogp !== 'prerender'
                ? {
                    ok: false,
                    text: 'HTML に中身が無いので、記事ごとの SNS のカードが出ません（話題の伸びが減ります）',
                  }
                : {
                    ok: true,
                    text: '記事ごとの SNS のカードは HTML に入ります',
                  },
          }
        : {}),
      cpu: cpuHit.length
        ? { ok: false, text: cpuHit.map((b) => b.detail ?? b.text).join('・') }
        : { ok: true },
      deltas,
    };
  });
}
