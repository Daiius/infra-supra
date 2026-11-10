// 描き方の計画（ページごとの行・選べる代わりの描き方）。
import {
  type Choices,
  defaultStrategy,
  type FrameworkId,
  FRAMEWORKS,
  ROUTE_STRATEGIES,
  ROUTE_STRATEGY_ORDER,
  type RouteAudience,
  type RouteStrategyId,
  type RouteTraits,
  slotLabel,
  strategyTermNote,
  strategySupport,
  strategyTitle,
} from 'catalog';
import type { Scenario } from '../scenario.ts';
import { onDemandBlocker } from '../requirements.ts';
import {
  DEFAULT_REVALIDATE_SEC,
  isOnDemand,
  ON_DEMAND_REVALIDATE,
  optionLabel,
  type Settings,
} from '../settings.ts';
import { setupCommentOptions } from '../setup/options.ts';
import { STACKS } from '../stacks.ts';
import type {
  Action,
  GameState,
  RouteOverrides,
  RoutePartKey,
  RouteParts,
} from '../state.ts';
import { commentsOf, ROUTE_PARTS } from './comments.ts';
import { hiddenSettings, revalidateSettingOf } from './hidden-settings.ts';
import {
  articleFamily,
  routeAudienceOf,
  routeChoices,
  SHELL_PER_PAGE_NOTE,
  SHELL_PER_PAGE_WHY,
  shellPerPage,
  strategyFamily,
  strategySelectable,
} from './strategy.ts';

/**
 * 描き方の表の 1 行の、ほかの描き方（D-106・D-107）。available: この事業者・今の部品で選べるか。reason は使えない理由か条件。
 * value: 選ぶときに一緒に替える revalidateSec（S3 はオンデマンド、S3 から S2 は 5 分。省略は今の値のまま）。
 */
export type RouteAlternative = {
  strategy: RouteStrategyId;
  /** 描き方の名前（選んだフレームワークでの呼び名。無ければ一般の言葉。D-193）。 */
  label: string;
  /** 呼び名の短い説明（ⓘ。呼び名が無ければ無い。D-193）。 */
  termNote?: string;
  /** 文書の中の番号（S1〜S6。部品ごとにキャッシュは空）。画面には出さない（D-112）。 */
  code: string;
  available: boolean;
  reason: string;
  /** 出典がある（source）か、ゲーム上の仮定（assumption）か。 */
  basis: 'source' | 'assumption';
  value?: number;
};

/** 「ページごとの描き方」の表の 1 行（D-106・D-107）。 */
export type RoutePlanRow = {
  route: string;
  label: string;
  audience: RouteAudience;
  /** ページの性質（SNS のカード・鮮度の要件・部品。D-107）。 */
  traits: RouteTraits | undefined;
  /** PV の割合（0〜1。テンプレートの値）。 */
  share: number;
  strategy: RouteStrategyId;
  /** 描き方の名前（番号なし。D-112。選んだフレームワークでの呼び名。無ければ一般の言葉。D-193）。 */
  strategyLabel: string;
  /** 呼び名の短い説明（ⓘ。呼び名が無ければ無い。D-193）。 */
  strategyTermNote?: string;
  /** 文書の中の番号（S1〜S6。部品ごとにキャッシュは空）。画面には出さない（D-112）。 */
  code: string;
  /** 描き方の値（期限・更新のたび・API の応答のキャッシュの期間・記事ごとの枠）。コメント欄は parts（D-109）。 */
  detail: string[];
  /** この描き方がこのページの何の要件に応えるか。 */
  why: string;
  /** フレームワークの既定から外れている理由（選んだ描き方・今の部品で決まった分）。 */
  overriddenBy?: string;
  /** ほかの描き方（確かめていない描き方は出さない。RS-04）。 */
  alternatives: RouteAlternative[];
  /** このページの部品で選べるもの（記事のページのコメント欄。D-109）。選べない描き方・シナリオでは空。 */
  parts: RoutePartRow[];
};

/** 表の行の部品の選択（D-109。記事のページのコメント欄）。 */
export type RoutePartRow = {
  part: RoutePartKey;
  label: string;
  /** 部品の説明（ⓘ）。 */
  note: string;
  /** 今の選択。 */
  value: number;
  options: { value: number; label: string; flavor: string }[];
};

/** 表の行を組む入力（始める画面・見積モード・ゲームの状態）。 */
export type RoutePlanInput = {
  framework: FrameworkId;
  stackIndex: number;
  settings: Pick<Settings, 'revalidateSec'>;
  components: Choices;
  /** 選んだ描き方（D-107）。 */
  routes?: RouteOverrides | undefined;
  /** 部品ごとにキャッシュを既定にする前の既定で決める（保存の版 3 まで。D-111）。 */
  legacyRouteDefaults?: boolean | undefined;
  /** ページの部品の選択（記事のページのコメント欄。D-109）。 */
  routeParts?: RouteParts | undefined;
};

/**
 * ページごとの描き方の表（D-106・D-107。始める画面・見積モード・ゲームの状態から使う）。
 * 行はテンプレートのルート、描き方は routeChoices（workloadFor が当てるものと同じ）。
 */
export function routePlanRows(sc: Scenario, p: RoutePlanInput): RoutePlanRow[] {
  const platform = STACKS[p.stackIndex]!.provider;
  const routes = sc.template(1).routes;
  const plan = routeChoices(sc, routes, { ...p, platform });
  const state = { scenario: sc, framework: p.framework, routes: p.routes };
  const hidden = hiddenSettings(state);
  const fam = articleFamily(state);
  const revalidateKey = revalidateSettingOf(p.framework, fam);
  const comments = commentsOf(sc, p.routeParts);
  const commentOptions = setupCommentOptions(sc, p.framework, p.routes);
  const blocker = onDemandBlocker(
    p.stackIndex,
    p.components,
    p.framework,
    'cached',
  );
  return routes.map((r) => {
    const audience = routeAudienceOf(sc, r);
    const choice = plan[r.id]!;
    const def = ROUTE_STRATEGIES[choice.strategy];
    const rowTermNote = strategyTermNote(choice.strategy, p.framework);
    const preset = defaultStrategy(p.framework, platform, audience, {
      legacy: p.legacyRouteDefaults === true,
    });
    const detail: string[] = [];
    const value = optionLabel(revalidateKey, p.settings.revalidateSec);
    if (choice.strategy === 'cached-ttl' && !hidden.includes(revalidateKey))
      detail.push(`期限 ${value}`);
    if (choice.strategy === 'static-build' && !hidden.includes(revalidateKey))
      detail.push(
        isOnDemand(p.settings)
          ? 'ビルドし直し: 更新のたび'
          : `ビルドし直し: 間隔 ${value}`,
      );
    // 部品ごとにキャッシュ（D-111）: 記事は期限（cacheLife）かタグ（cacheTag・updateTag）。個人向けの動的な穴は説明（long・why）に
    // 書いてあるので値の行を持たない（D-125）
    if (choice.strategy === 'cache-components' && audience === 'public')
      detail.push(
        isOnDemand(p.settings)
          ? '部品をタグで作り直す（投稿・編集で updateTag）'
          : `部品の期限 ${value}（cacheLife）`,
      );
    if (choice.shellPerPage)
      detail.push(
        '枠: 記事ごとに書き出す（メタタグ入り・新しい記事と編集でビルドし直し）',
      );
    if (choice.cacheContent)
      detail.push(`中身の API の応答をキャッシュ（期間 ${value}）`);
    const chosen = p.routes?.[r.id] !== undefined;
    const overriddenBy =
      strategyFamily(choice.strategy) === strategyFamily(preset)
        ? undefined
        : chosen
          ? `選んだ描き方（${FRAMEWORKS[p.framework].label} の既定は「${strategyTitle(preset, p.framework)}」）`
          : choice.strategy === 'ssr'
            ? `${slotLabel('isrCache', p.framework)}の部品が「キャッシュしない」`
            : undefined;
    const alternatives = ROUTE_STRATEGY_ORDER.filter(
      (s) => s !== choice.strategy,
    ).flatMap((s): RouteAlternative[] => {
      const x = strategySupport(p.framework, platform, audience, s);
      if (x.support === 'unverified') return [];
      const d = ROUTE_STRATEGIES[s];
      const termNote = strategyTermNote(s, p.framework);
      // 部品で決まるもの（Next.js の S3）は、今の部品で消せるか（onDemandBlocker）で判定する
      const blocked =
        x.support === 'depends' && s === 'cached-purge' ? blocker : undefined;
      // 部品ごとにキャッシュの記事は、今の部品でタグが届かない（S3 と同じ onDemandBlocker）のにオンデマンドなら、
      // 選ぶときに期限（5 分）へ戻す（D-111・OCL-FC4A03B7）
      const ccTagBlocked =
        s === 'cache-components' &&
        audience === 'public' &&
        isOnDemand(p.settings) &&
        blocker !== undefined;
      const value =
        s === 'cached-purge'
          ? ON_DEMAND_REVALIDATE
          : (s === 'cached-ttl' && isOnDemand(p.settings)) || ccTagBlocked
            ? DEFAULT_REVALIDATE_SEC
            : undefined;
      return [
        {
          strategy: s,
          label: strategyTitle(s, p.framework),
          ...(termNote !== undefined ? { termNote } : {}),
          code: d.code,
          available:
            strategySelectable(p.framework, platform, audience, s) &&
            blocked === undefined,
          reason: blocked
            ? `${blocked.label}: ${blocked.reason}`
            : ccTagBlocked
              ? `${x.note}。この部品ではタグで消せない（${blocker.label}: ${blocker.reason.replace(/。$/, '')}）ので、選ぶと期限 ${optionLabel(revalidateKey, DEFAULT_REVALIDATE_SEC)} に戻します`
              : s === 'shell-api' &&
                  audience === 'public' &&
                  shellPerPage(p.framework, platform)
                ? `${x.note}。${SHELL_PER_PAGE_NOTE}`
                : x.note,
          basis: x.basis,
          ...(value !== undefined ? { value } : {}),
        },
      ];
    });
    return {
      route: r.id,
      label: r.label ?? r.id,
      audience,
      traits: sc.routeTraits[r.id],
      share: r.share,
      strategy: choice.strategy,
      strategyLabel: strategyTitle(choice.strategy, p.framework),
      ...(rowTermNote !== undefined ? { strategyTermNote: rowTermNote } : {}),
      code: def.code,
      detail,
      why: choice.shellPerPage ? SHELL_PER_PAGE_WHY : def.why[audience],
      ...(overriddenBy ? { overriddenBy } : {}),
      alternatives,
      parts:
        audience === 'public' && commentOptions.length > 0
          ? [
              {
                part: 'comments' as const,
                label: ROUTE_PARTS.comments.label,
                note: ROUTE_PARTS.comments.note,
                value: comments,
                options: commentOptions,
              },
            ]
          : [],
    };
  });
}

/**
 * ルートごとの実際の描き方（routeChoices。表・計算と同じ）。見取り図・構成図に渡す（D-111・OCL-CD192A98）。
 */
export function resolvedRouteStrategies(
  sc: Scenario,
  p: Omit<RoutePlanInput, 'settings'> & {
    settings?: Pick<Settings, 'revalidateSec'>;
  },
): Partial<Record<string, RouteStrategyId>> {
  const plan = routeChoices(sc, sc.template(1).routes, {
    ...p,
    settings: p.settings ?? { revalidateSec: DEFAULT_REVALIDATE_SEC },
    platform: STACKS[p.stackIndex]!.provider,
  });
  return Object.fromEntries(
    Object.entries(plan).map(([id, c]) => [id, c.strategy]),
  );
}

/** ゲームの今の状態のページごとの描き方（D-106。今のフレームワーク・構成・設定・部品・選んだ描き方から決まる）。 */
export function routePlanOf(
  state: Pick<
    GameState,
    | 'scenario'
    | 'framework'
    | 'stackIndex'
    | 'settings'
    | 'components'
    | 'routes'
    | 'legacyRouteDefaults'
  >,
): RoutePlanRow[] {
  return routePlanRows(state.scenario, state);
}

/**
 * 表の行のほかの描き方を選ぶ行動（ゲームの途中。D-107）。S2 ↔ S3 は設定（再検証・記事のキャッシュ）の変更、
 * それ以外は描き方の変更（value があれば revalidateSec も一緒に替える）。
 */
export function routeAlternativeAction(
  state: Pick<GameState, 'scenario' | 'framework' | 'routes'>,
  row: Pick<RoutePlanRow, 'route' | 'strategy'>,
  alt: Pick<RouteAlternative, 'strategy' | 'value'>,
): Action {
  if (
    strategyFamily(row.strategy) === 'cached' &&
    strategyFamily(alt.strategy) === 'cached'
  )
    return {
      type: 'set',
      key: revalidateSettingOf(state.framework, 'cached'),
      value: alt.value ?? DEFAULT_REVALIDATE_SEC,
    };
  return {
    type: 'route',
    route: row.route,
    strategy: alt.strategy,
    ...(alt.value !== undefined ? { value: alt.value } : {}),
  };
}
