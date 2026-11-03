// 描き方の置き換え（乗り換え・書き直し・始める画面で、選んだ描き方が使えなくなったとき）と、その通知。
import {
  type Choices,
  type FrameworkId,
  type RouteStrategyId,
  strategySupport,
  strategyTitle,
} from 'catalog';
import type { Scenario } from '../scenario.ts';
import { scenarioOf } from '../core.ts';
import { componentsAfterRewrite, revalidateAfterRewrite } from '../rewrite.ts';
import { validSetupChoices } from '../setup/new-game.ts';
import { setupRevalidateOptions } from '../setup/options.ts';
import {
  componentsAfterMigration,
  isPlanChange,
  isRecontract,
  STACKS,
} from '../stacks.ts';
import type { GameState, RouteOverrides } from '../state.ts';
import { defaultRevalidateSec } from './hidden-settings.ts';
import type { RoutePlanInput } from './plan.ts';
import {
  routeAudienceOf,
  routeChoices,
  strategyFamily,
  strategySelectable,
  validRouteOverrides,
} from './strategy.ts';

/** 構成・フレームワークを替えると既定に戻るページの描き方（D-107 の補足）。from・to は描き方の番号つきの id。 */
export type RouteFallback = {
  route: string;
  label: string;
  from: RouteStrategyId;
  to: RouteStrategyId;
  /** 戻る理由（乗り換え先の対応表の理由。使えるのに戻るときは reset の文）。 */
  reason: string;
};

/**
 * 替えた先で既定に戻るページの描き方（D-107 の補足）。選んだ描き方（from.routes）のうち、替えた先で選べない（reset を渡すと全部）
 * ものが、替えた先の既定（routeChoices）に戻って分け方が変わるページを返す。替える前に見せるための予測で、
 * 乗り換え・作り直しの後の validRouteOverrides・routes の扱いと同じ結果になる（テストで確かめる）。
 */
export function routeFallbacks(
  sc: Scenario,
  from: RoutePlanInput,
  to: Omit<RoutePlanInput, 'routes'>,
  /** 使えても全部を既定に戻すとき（作り直し・始める画面のフレームワークの変更）の理由。 */
  reset?: string,
): RouteFallback[] {
  const chosen = from.routes;
  if (!chosen || Object.keys(chosen).length === 0) return [];
  const tpl = sc.template(1).routes;
  const fromPlatform = STACKS[from.stackIndex]!.provider;
  const toPlatform = STACKS[to.stackIndex]!.provider;
  const kept =
    reset !== undefined
      ? undefined
      : validRouteOverrides(
          sc,
          to.stackIndex,
          to.framework,
          chosen,
          from.legacyRouteDefaults,
        );
  const before = routeChoices(sc, tpl, { ...from, platform: fromPlatform });
  const after = routeChoices(sc, tpl, {
    ...to,
    platform: toPlatform,
    routes: kept,
    legacyRouteDefaults: from.legacyRouteDefaults,
  });
  const out: RouteFallback[] = [];
  for (const r of tpl) {
    const want = chosen[r.id];
    if (want === undefined || kept?.[r.id] !== undefined) continue;
    const a = before[r.id]!.strategy;
    const b = after[r.id]!.strategy;
    if (strategyFamily(a) === strategyFamily(b)) continue;
    const audience = routeAudienceOf(sc, r);
    const reason = strategySelectable(to.framework, toPlatform, audience, want)
      ? (reset ?? '')
      : strategySupport(to.framework, toPlatform, audience, want).note;
    out.push({ route: r.id, label: r.label ?? r.id, from: a, to: b, reason });
  }
  return out;
}

/** 戻る描き方の注意の文（「乗り換えると、個人向けのページは S5 → S4（既定）に戻る: …」）。無ければ null。 */
export function routeFallbackNotice(
  verb: string,
  fallbacks: readonly RouteFallback[],
): string | null {
  if (fallbacks.length === 0) return null;
  // 理由が同じページはまとめる（作り直しは全部が同じ理由）
  const reasons = [...new Set(fallbacks.map((f) => f.reason))];
  return `${verb}と、${reasons
    .map(
      (why) =>
        `${fallbacks
          .filter((f) => f.reason === why)
          .map(
            (f) =>
              `${f.label}は「${strategyTitle(f.from)}」→「${strategyTitle(f.to)}」（既定）`,
          )
          .join('・')}に戻る${why ? `: ${why.replace(/。$/, '')}` : ''}`,
    )
    .join('。')}`;
}

/** 作り直しで戻るときの理由（ゲームの作り直しと、始める画面のフレームワークの変更）。 */
const REWRITE_RESETS_ROUTES =
  '済んだ翌月から、描き方は新しいフレームワークの既定で始まる（選び直すには手間がかかる）';
const SETUP_FRAMEWORK_RESETS_ROUTES =
  'フレームワークを替えると、描き方はそのフレームワークの既定から選び直しになる';

const planInputOf = (
  state: Pick<
    GameState,
    | 'framework'
    | 'stackIndex'
    | 'settings'
    | 'components'
    | 'routes'
    | 'routeParts'
    | 'legacyRouteDefaults'
  >,
): RoutePlanInput => ({
  framework: state.framework,
  stackIndex: state.stackIndex,
  settings: state.settings,
  components: state.components,
  routes: state.routes,
  legacyRouteDefaults: state.legacyRouteDefaults,
  routeParts: state.routeParts,
});

/** 途中のプラン変更・乗り換えで既定に戻る描き方（D-107 の補足）。乗り換えは乗り換え先の既定の部品で見る。 */
export function stackChangeRouteFallbacks(
  state: GameState,
  stackIndex: number,
): RouteFallback[] {
  const sc = scenarioOf(state);
  return routeFallbacks(sc, planInputOf(state), {
    framework: state.framework,
    stackIndex,
    settings: state.settings,
    components: isPlanChange(state.stackIndex, stackIndex)
      ? state.components
      : componentsAfterMigration(stackIndex, state.mods, state.framework, sc),
  });
}

/** 途中の作り直しで既定に戻る描き方（D-107 の補足。作り直しが済むと描き方は全部既定に戻る）。 */
export function rewriteRouteFallbacks(
  state: GameState,
  framework: FrameworkId,
): RouteFallback[] {
  return routeFallbacks(
    scenarioOf(state),
    planInputOf(state),
    {
      framework,
      stackIndex: state.stackIndex,
      settings: {
        ...state.settings,
        revalidateSec: revalidateAfterRewrite(
          state.settings.revalidateSec,
          framework,
        ),
      },
      components: componentsAfterRewrite(state, framework),
    },
    REWRITE_RESETS_ROUTES,
  );
}

/** 途中の構成・フレームワークの変更の注意の文（行動の欄の選択肢に添える。D-107 の補足）。 */
export function stackChangeRouteNotice(
  state: GameState,
  stackIndex: number,
): string | null {
  const verb = isPlanChange(state.stackIndex, stackIndex)
    ? 'プランを変える'
    : isRecontract(state.stackIndex, stackIndex)
      ? '契約し直す'
      : '乗り換える';
  return routeFallbackNotice(
    verb,
    stackChangeRouteFallbacks(state, stackIndex),
  );
}

export function rewriteRouteNotice(
  state: GameState,
  framework: FrameworkId,
): string | null {
  return routeFallbackNotice(
    '作り直す',
    rewriteRouteFallbacks(state, framework),
  );
}

/**
 * 始める画面で構成・フレームワークを替えると既定に戻る描き方の注意（カードに添える。D-107 の補足）。
 * 構成を替えると選べないものだけ、フレームワークを替えると全部が既定に戻る（始める画面の今の動き）。
 */
export function setupRouteNotice(
  sc: Scenario,
  cur: SetupRouteState,
  next: { stackIndex?: number; framework?: FrameworkId },
): string | null {
  const fwChanged =
    next.framework !== undefined && next.framework !== cur.framework;
  return routeFallbackNotice(
    fwChanged ? 'このフレームワークにする' : 'この構成にする',
    setupRouteFallbacks(sc, cur, next),
  );
}

/** 始める画面の今の選択（描き方の予測に使う分）。 */
export type SetupRouteState = {
  stackIndex: number;
  framework: FrameworkId;
  components: Choices;
  revalidateSec: number;
  /** 始める画面で選んだ再検証（選んでいなければ undefined）。替えた先でも選べれば残る。 */
  revalidateChosen?: number | undefined;
  routes: RouteOverrides | undefined;
};

/** 始める画面で構成・フレームワークを替えると既定に戻る描き方（setupRouteNotice の中身）。 */
export function setupRouteFallbacks(
  sc: Scenario,
  cur: SetupRouteState,
  next: { stackIndex?: number; framework?: FrameworkId },
): RouteFallback[] {
  const stackIndex = next.stackIndex ?? cur.stackIndex;
  const framework = next.framework ?? cur.framework;
  const fwChanged = framework !== cur.framework;
  // 替えた後の描き方と再検証は始める画面と同じ規則で決める: フレームワークを替えると描き方は既定、
  // 選んだ再検証は替えた先で選べれば残し、それ以外は既定（OCL-0ABECA36）
  const nextRoutes = fwChanged
    ? undefined
    : validRouteOverrides(sc, stackIndex, framework, cur.routes);
  const chosen = cur.revalidateChosen;
  const revalidateSec =
    chosen !== undefined &&
    setupRevalidateOptions(sc, framework, nextRoutes).some(
      (o) => o.value === chosen,
    )
      ? chosen
      : defaultRevalidateSec(framework, stackIndex, sc, nextRoutes);
  return routeFallbacks(
    sc,
    {
      framework: cur.framework,
      stackIndex: cur.stackIndex,
      settings: { revalidateSec: cur.revalidateSec },
      components: cur.components,
      routes: cur.routes,
    },
    {
      framework,
      stackIndex,
      settings: { revalidateSec },
      components: validSetupChoices(sc, stackIndex, framework, cur.components),
    },
    fwChanged ? SETUP_FRAMEWORK_RESETS_ROUTES : undefined,
  );
}
