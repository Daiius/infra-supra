// 評価（prd/07 §9.6）と基準プレイ（成績の目盛り・バランスの検証。§10.8）。振り返りの 4 軸は results.ts（D-132）。
import {
  type EffortBreakdown,
  type Element,
  ELEMENT_LABEL,
  ELEMENTS,
  STAGE_VALUE,
} from './rules.ts';
import { isTrafficSpike, premiseTrends } from './trends.ts';
import type { Scenario, Strategy } from './scenario.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import type { FrameworkId } from 'catalog';
import { applyActions } from './actions/apply.ts';
import { DEFAULT_START_DATE, scenarioOf } from './core.ts';
import { playMonth } from './month/play.ts';
import { averageSatisfaction } from './month/satisfaction.ts';
import { newGame } from './setup/new-game.ts';
import { offeredBaselines } from './stacks.ts';
import type { EndReason, GameState } from './state.ts';

// ---- 評価（prd/07 §9.6）----

export type Axes = {
  /** 累積の利益（最終の所持金 − 開始時）。 */
  profit: number;
  satisfaction: number;
  /** 要素ごとの平均の段階の数値（0〜1）。 */
  elements: Record<Element, number>;
  /** 最終月の基準の PV（話題・Bot の倍率を除く）。 */
  finalPV: number;
  featurePoints: number;
  /** 総ポイントに対する機能開発の割合。 */
  featureShare: number;
};

export function axesOf(state: GameState): Axes {
  const h = state.history;
  const n = Math.max(1, h.length);
  const last = h[h.length - 1];
  const elements = Object.fromEntries(
    ELEMENTS.map((e) => [
      e,
      h.reduce((a, r) => a + STAGE_VALUE[r.satisfaction.stages[e]], 0) / n,
    ]),
  ) as Record<Element, number>;
  const total = h.reduce((a, r) => a + r.effort.total, 0);
  return {
    profit: state.cash - scenarioOf(state).startCash,
    satisfaction: averageSatisfaction(h),
    elements,
    finalPV: last ? last.basePV : 0,
    featurePoints: state.featurePoints,
    featureShare: total ? state.featurePoints / total : 0,
  };
}

export const END_LABEL: Record<EndReason, string> = {
  completed: '完走',
  cash: '所持金が尽きた',
  outages: '止まった回数の上限を超えた',
  policy: '規約違反が続き、アカウントが停止された',
};

export type Surprise = {
  premiseId: string;
  text: string;
  month: number;
  cause:
    | { kind: 'event'; title: string; ratioWithout: number }
    | { kind: 'action'; action: string }
    | { kind: 'growth' };
};

export type Reflection = {
  premises: { month: number; text: string; hit: boolean; action?: string }[];
  badMonths: {
    month: number;
    element: Element;
    label: string;
    reason: string;
  }[];
  effort: Omit<EffortBreakdown, 'total'> & { total: number };
  /** 見込みより早く超えた前提と、その理由（prd/07 §10.7）。 */
  surprises: Surprise[];
};

/**
 * 見込みが外れた理由（prd/07 §10.7）。前提が境目を初めて越えた月のうち、その月までの推移で
 * 「前の月の見込みより早く超えた」（GD-1 の earlierThanProjected）ものについて、
 * ① 外すと越えなかった出来事 → ② 前の月のプレイヤーの行動 → ③ 伸びが直近より速かった、の順に理由を決める。
 */
export function surprisesOf(state: GameState): Surprise[] {
  const months = scenarioOf(state).months;
  const out: Surprise[] = [];
  for (const r of state.history) {
    if (!r.crossings.length) continue;
    const earlier = new Set(
      premiseTrends(
        state.history.slice(0, r.month).map((m) => m.snapshots),
        months,
        { spikes: state.history.slice(0, r.month).map(isTrafficSpike) },
      )
        .filter((t) => t.earlierThanProjected)
        .map((t) => t.id),
    );
    for (const c of r.crossings) {
      if (!earlier.has(c.premiseId)) continue;
      const before = state.history[r.month - 2];
      const top = [...c.causes].sort(
        (a, b) => a.ratioWithout - b.ratioWithout,
      )[0];
      out.push({
        premiseId: c.premiseId,
        text: c.text,
        month: r.month,
        cause: top
          ? { kind: 'event', title: top.title, ratioWithout: top.ratioWithout }
          : before?.action
            ? { kind: 'action', action: before.action }
            : { kind: 'growth' },
      });
    }
  }
  return out;
}

/** 振り返り（①前提とその月の選択 ②「悪い」になった月と理由 ③手間の内訳 ④見込みが外れた理由）。 */
export function reflectionOf(state: GameState): Reflection {
  const seen = new Map<string, Reflection['premises'][number]>();
  for (const r of state.history)
    for (const p of r.premises) {
      const cur = seen.get(p.id);
      if (!cur || (!cur.hit && p.hit))
        seen.set(p.id, {
          month: r.month,
          text: p.text,
          hit: p.hit,
          ...(r.action ? { action: r.action } : {}),
        });
    }
  const badMonths = state.history.flatMap((r) =>
    ELEMENTS.filter((e) => r.satisfaction.stages[e] === 'bad').map((e) => ({
      month: r.month,
      element: e,
      label: ELEMENT_LABEL[e],
      reason: r.satisfaction.reasons[e] ?? '',
    })),
  );
  const effort = state.history.reduce(
    (a, r) => ({
      total: a.total + r.effort.total,
      accountAllowance:
        (a.accountAllowance ?? 0) + (r.effort.accountAllowance ?? 0),
      upkeep: a.upkeep + r.effort.upkeep,
      accounts: (a.accounts ?? 0) + (r.effort.accounts ?? 0),
      interrupt: a.interrupt + r.effort.interrupt,
      featureWork: a.featureWork + r.effort.featureWork,
      featureBonus: a.featureBonus + r.effort.featureBonus,
      migration: a.migration + r.effort.migration,
      actions: a.actions + r.effort.actions,
      feature: a.feature + r.effort.feature,
    }),
    {
      total: 0,
      accountAllowance: 0,
      upkeep: 0,
      accounts: 0,
      interrupt: 0,
      featureWork: 0,
      featureBonus: 0,
      migration: 0,
      actions: 0,
      feature: 0,
    },
  );
  return {
    premises: [...seen.values()].sort((a, b) => a.month - b.month),
    badMonths,
    effort,
    surprises: surprisesOf(state),
  };
}

// ---- 基準プレイ（成績の目盛り・バランスの検証。prd/07 §9.6・§10.8。合否はやめた。D-131）----

/** 記事コミュニティの基準プレイ（シナリオのデータ）。 */
export const BASELINES: Strategy[] = ARTICLE_COMMUNITY.baselines;

export function playStrategy(
  s: Strategy,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
  startDate: string = DEFAULT_START_DATE,
  framework?: FrameworkId,
): GameState {
  let st = playMonth(
    newGame(
      s.stackIndex,
      seed,
      scenario,
      startDate,
      framework ?? s.framework,
      undefined,
      undefined,
      undefined,
      undefined,
      s.routes,
    ),
  );
  for (let i = 0; st.phase === 'playing'; i++)
    st = playMonth(
      applyActions(st, s.decide ? s.decide(st) : (s.actions?.[i] ?? [])),
    );
  return st;
}

export type ComparisonRow = {
  id: string;
  /** 表の 1 列目に出す名前（基準プレイは短い名前）。 */
  name: string;
  /** 長い説明（ツールチップ用）。 */
  description: string;
  axes: Axes;
  you: boolean;
};

/** 結果の比較の表の行（あなた + 同じシードの基準プレイ）。表示用の名前はここで決める。 */
export function comparisonRows(state: GameState): ComparisonRow[] {
  const sc = scenarioOf(state);
  return [
    {
      id: 'you',
      name: 'あなた',
      description: 'あなたのプレイ',
      axes: axesOf(state),
      you: true,
    },
    ...offeredBaselines(sc).map((b) => ({
      id: b.id,
      name: b.short ?? b.label,
      description: b.label,
      // 基準プレイも同じフレームワークで回す（同じアプリの形で比べる。prd/10）
      axes: axesOf(
        playStrategy(b, state.startSeed, sc, state.startDate, state.framework),
      ),
      you: false,
    })),
  ];
}
