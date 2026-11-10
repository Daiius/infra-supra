// ゲームの途中の「構成を変える」（D-185）。始める画面と同じ ①② の選択（構成・部品・フレームワーク・ページの描き方・コメント欄）で
// 選び直した差を、今ある行動（plan・migrate・component・rewrite・route・route-part）に写し取る。新しいゲームの決まりは作らず、
// 選べるか・手間・期間は今までの行動の検査（checkActions）と文（stackChangeText・rewriteText など）に任せる。
import {
  componentsOf,
  DEFAULT_CHOICES,
  type Choices,
  type FrameworkId,
  type RouteStrategyId,
  slotLabel,
  type SlotId,
  strategyTitle,
} from 'catalog';
import { applyAction, applyActions, checkActions } from '../actions/apply.ts';
import { actionEffort, checkAction } from '../actions/check.ts';
import { proposalOnlyComponent } from '../components.ts';
import { frameworkDefaults, scenarioOf } from '../core.ts';
import { componentEffortLabel } from '../effort.ts';
import { componentsAfterRewrite, rewriteText } from '../rewrite.ts';
import { ROUTE_PARTS, commentsOf } from '../routes/comments.ts';
import {
  rewriteRouteNotice,
  stackChangeRouteNotice,
} from '../routes/fallbacks.ts';
import { routePlanOf } from '../routes/plan.ts';
import { publicRouteId, strategyFamily } from '../routes/strategy.ts';
import {
  componentLabel,
  componentsAfterMigration,
  isDataSwap,
  isPlanChange,
  stackChangeText,
  STACKS,
} from '../stacks.ts';
import type { Action, GameState } from '../state.ts';
import { validSetupChoices } from './new-game.ts';

/** 選び直したページの描き方（ルート → 描き方と、一緒に替える revalidateSec。S3 はオンデマンドなど）。 */
export type DraftRoutes = Readonly<
  Partial<Record<string, { strategy: RouteStrategyId; value?: number }>>
>;

/** 「構成を変える」の欄で選び直したもの（始める画面の ①② と同じ形）。 */
export type SetupDraft = {
  stackIndex: number;
  framework: FrameworkId;
  /** 部品（始める画面と同じく、その構成・フレームワークで選べるものだけ。validSetupChoices）。 */
  components: Choices;
  /** 今の描き方から選び直したページ（今と同じ分け方のものは持たない）。 */
  routes: DraftRoutes;
  /** 記事のページのコメント欄（D-109）。 */
  comments: number;
};

/** 行動の組（今月の行動の並びのどこに入れるかで分ける。画面の build と同じ順に当てる）。 */
export type SetupChangeGroups = {
  components: Action[];
  stack: Action | null;
  routes: Action[];
  routeParts: Action[];
  rewrite: Action | null;
};

/** 変更の内訳の 1 行。 */
export type SetupChangeItem = {
  kind: 'plan' | 'migrate' | 'rewrite' | 'component' | 'route' | 'route-part';
  /** 写し取った行動（写し取れない差は null）。 */
  action: Action | null;
  name: string;
  /** 手間・期間・並行の費用・翌月から など。 */
  meta: string[];
  /** ⓘ に出す説明。 */
  detail?: string | undefined;
  /** 替えると既定に戻る描き方の知らせ（D-107 の補足）。 */
  notice?: string | null | undefined;
  /** 選べない・この組み合わせではできない理由（選べれば null）。 */
  why: string | null;
};

export type SetupChange = {
  groups: SetupChangeGroups;
  items: SetupChangeItem[];
  /** 選べない理由（最初の 1 つ）。すべて選べれば null。 */
  why: string | null;
};

/** 今の部品（既定を重ねたもの。ゲームの部品の欄の「今」と同じ）。 */
function effectiveComponents(state: GameState): Choices {
  const platform = STACKS[state.stackIndex]!.provider;
  return {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(state.framework, platform, scenarioOf(state)),
    ...state.components,
  };
}

/**
 * その構成・フレームワークにしたとき、部品が何から始まるか（欄で構成・フレームワークを選び直したときの部品の初めの値）。
 * 今と同じ事業者のプラン変更は今の部品を引き継ぎ、乗り換え・契約し直しは乗り換え先の既定（D-24 X-9）、作り直しは
 * 作り直した後の部品（D-81）。始める画面と同じく、その組み合わせで選べるものだけにする。
 */
export function draftComponentsFor(
  state: GameState,
  stackIndex: number,
  framework: FrameworkId,
): Choices {
  const sc = scenarioOf(state);
  const keep =
    stackIndex === state.stackIndex ||
    isPlanChange(state.stackIndex, stackIndex);
  const base = !keep
    ? componentsAfterMigration(stackIndex, state.mods, framework, sc)
    : framework !== state.framework
      ? componentsAfterRewrite({ ...state, stackIndex }, framework)
      : effectiveComponents(state);
  return validDraftComponents(state, stackIndex, framework, base);
}

/**
 * 欄の部品の整合（始める画面と同じ validSetupChoices）。ただし提案で付いた部品（チャットの Durable Objects など）は、運営中の値として
 * その構成・フレームワークでも使えれば残す（新しく選べないのは選択肢の側で絞る。OCL-80A47F1A）。
 */
export function validDraftComponents(
  state: GameState,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices,
): Choices {
  const sc = scenarioOf(state);
  const platform = STACKS[stackIndex]!.provider;
  const out = validSetupChoices(sc, stackIndex, framework, choices);
  for (const [slot, option] of Object.entries(choices) as [SlotId, string][])
    if (
      option !== undefined &&
      proposalOnlyComponent(sc, slot, option) &&
      componentsOf(platform, slot, framework).some((o) => o.id === option)
    )
      out[slot] = option;
  return out;
}

/**
 * 部品の行動の順（OCL-099AD8D5）。並べた順のまま選べればそのまま（前の画面と同じ順）。依存で選べなければ（定額の CDN のプランを
 * 従量に戻してから CloudFront を外す など）、選べる行動から順に当てる。依存の向きは今の検査（componentConflict）に任せる。
 */
function orderComponents(state: GameState, actions: Action[]): Action[] {
  if (actions.length < 2 || checkActions(state, actions).ok) return actions;
  const out: Action[] = [];
  const rest = [...actions];
  let s = state;
  while (rest.length > 0) {
    // 移行を始める差し替えは、ほかに選べる行動が無いときだけ（始めるとほかの部品を差し替えられない。OCL-8361F527）
    const ok = (a: Action) => checkAction(s, a).ok;
    const swap = (a: Action) => a.type === 'component' && isDataSwap(a.slot);
    let i = rest.findIndex((a) => !swap(a) && ok(a));
    if (i < 0) i = rest.findIndex(ok);
    if (i < 0) break;
    const [a] = rest.splice(i, 1);
    out.push(a!);
    s = applyAction(s, a!);
  }
  return [...out, ...rest];
}

/** 今の状態を選んだ欄（開いたときの値）。 */
export function currentSetupDraft(state: GameState): SetupDraft {
  return {
    stackIndex: state.stackIndex,
    framework: state.framework,
    components: draftComponentsFor(state, state.stackIndex, state.framework),
    routes: {},
    comments: commentsOf(scenarioOf(state), state.routeParts),
  };
}

/** 今の状態と同じか（選び直していないか）。 */
export function sameAsCurrent(state: GameState, draft: SetupDraft): boolean {
  const cur = currentSetupDraft(state);
  const keys = new Set([
    ...Object.keys(cur.components),
    ...Object.keys(draft.components),
  ]);
  return (
    cur.stackIndex === draft.stackIndex &&
    cur.framework === draft.framework &&
    cur.comments === draft.comments &&
    Object.keys(draft.routes).length === 0 &&
    [...keys].every(
      (k) => cur.components[k as SlotId] === draft.components[k as SlotId],
    )
  );
}

const routeStrategiesOf = (s: GameState) =>
  Object.fromEntries(
    routePlanOf(s).map((r) => [r.route, r.strategy]),
  ) as Partial<Record<string, RouteStrategyId>>;

/**
 * 描き方を選び直すときの「今」（欄で選んだ部品・プラン変更を当てた後の描き方。setupChangeOf の差の基準と同じ。OCL-E7B403BA）。
 */
export function draftRouteBase(
  state: GameState,
  draft: SetupDraft,
): Partial<Record<string, RouteStrategyId>> {
  const { groups } = setupChangeOf(state, { ...draft, routes: {} });
  return routeStrategiesOf(
    applyActions(state, [
      ...groups.components,
      ...(groups.stack ? [groups.stack] : []),
    ]),
  );
}

/** 画面の build と同じ順（部品 → 構成 → 描き方 → ページの部品 → 作り直し）に並べる。 */
export function flattenSetupChange(g: SetupChangeGroups): Action[] {
  return [
    ...g.components,
    ...(g.stack ? [g.stack] : []),
    ...g.routes,
    ...g.routeParts,
    ...(g.rewrite ? [g.rewrite] : []),
  ];
}

const routeLabel = (state: GameState, id: string) => {
  const r = scenarioOf(state)
    .template(1)
    .routes.find((x) => x.id === id);
  return r?.label ?? id;
};

/**
 * 選び直した差を行動に写し取る（D-185）。
 * - 構成: 同じ事業者なら plan、別の事業者（と、さくらの VPS の下位への契約し直し）なら migrate。
 * - フレームワーク: rewrite（作り直し）。
 * - 部品: 今の部品と違うスロットごとに component。乗り換え・作り直しでは部品は決まった形で始まる（乗り換え先の既定・作り直した後の
 *   選び方）ので、それと違う部品は写し取らず、済んでから差し替える旨を理由に出す。
 * - ページの描き方: 分け方が今と違うページごとに route。作り直すと描き方は新しいフレームワークの既定に戻るので、作り直しと一緒には写し取らない。
 * - コメント欄: route-part。
 * 選べるかは今月のほかの行動と合わせて見る（wrap で今月の行動の並び全体を組む。省略は写し取った行動だけ）。
 */
export function setupChangeOf(
  state: GameState,
  draft: SetupDraft,
  wrap: (g: SetupChangeGroups) => Action[] = flattenSetupChange,
): SetupChange {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const toPlatform = STACKS[draft.stackIndex]!.provider;
  const stackChanged = draft.stackIndex !== state.stackIndex;
  const plan = stackChanged && isPlanChange(state.stackIndex, draft.stackIndex);
  const migrate = stackChanged && !plan;
  const rewrite = draft.framework !== state.framework;
  const items: SetupChangeItem[] = [];
  const groups: SetupChangeGroups = {
    components: [],
    stack: null,
    routes: [],
    routeParts: [],
    rewrite: null,
  };

  // 部品
  const cur = effectiveComponents(state);
  // 乗り換え・作り直しでは、部品はその行動が決める形で始まる（それと違うものは写し取れない）
  const fixedStart =
    migrate || rewrite
      ? draftComponentsFor(state, draft.stackIndex, draft.framework)
      : undefined;
  const slots = (Object.keys(draft.components) as SlotId[]).filter(
    (s) => draft.components[s] !== undefined,
  );
  const changed: SlotId[] = [];
  for (const slot of slots) {
    const v = draft.components[slot]!;
    if (fixedStart) {
      if (fixedStart[slot] === v) continue;
      items.push({
        kind: 'component',
        action: null,
        name: `${slotLabel(slot, draft.framework)}を${componentLabel(toPlatform, slot, v)}に`,
        meta: [],
        why: migrate
          ? `乗り換えでは部品は乗り換え先の既定の選択（${componentLabel(toPlatform, slot, fixedStart[slot] ?? '')}）から始まります。乗り換えが済んでから差し替えられます`
          : `作り直しの最中は部品を差し替えられません（作り直した後は${componentLabel(toPlatform, slot, fixedStart[slot] ?? '')}）。作り直しが済んでから差し替えられます`,
      });
      continue;
    }
    if (cur[slot] === v) continue;
    changed.push(slot);
  }
  // VPS の API の応答のキャッシュは前段の CDN が要る（D-37）。付けるときは前段の CDN の後、外すときは先に当てる
  // DB・API の置き場の差し替え（データの移行）は始めると最中はほかの部品を差し替えられないので最後に当てる（OCL-8361F527）
  const order = (slot: SlotId) =>
    isDataSwap(slot)
      ? 2
      : slot === 'apiCache'
        ? draft.components[slot] === 'none'
          ? -1
          : 1
        : 0;
  const ordered = orderComponents(
    state,
    [...changed]
      .sort((a, b) => order(a) - order(b))
      .map((slot): Action => ({
        type: 'component',
        slot,
        option: draft.components[slot]!,
      })),
  ) as Extract<Action, { type: 'component' }>[];
  for (const action of ordered) {
    const { slot, option } = action;
    groups.components.push(action);
    items.push({
      kind: 'component',
      action,
      name: `${slotLabel(slot, state.framework)}を${componentLabel(platform, slot, option)}に差し替える`,
      meta: componentEffortLabel(slot, state, option),
      detail:
        slot === 'api'
          ? 'API の置き場を移すと DB も一緒に移します（API と DB は同じ事業者に置きます）。データの移行があるので、手間を入れ終えた翌月に切り替わり、期間中は新旧両方の費用を払います。事業者をまたぐ往復の遅延は計算していません。Next.js・Astro では、ページを描くサーバーが API を呼んで応答を待ちます。VPS に置くと自前運用の維持と障害が加わります。'
          : isDataSwap(slot)
            ? 'DB の差し替えはデータの移行があるので、手間を入れ終えた翌月に切り替わります。期間中は新旧両方の DB の費用を払います。'
            : undefined,
      why: null,
    });
  }

  // 構成
  if (stackChanged) {
    const action: Action = {
      type: plan ? 'plan' : 'migrate',
      stackIndex: draft.stackIndex,
    };
    groups.stack = action;
    const t = stackChangeText(
      state.stackIndex,
      draft.stackIndex,
      state.framework,
      state.components,
    );
    items.unshift({
      kind: plan ? 'plan' : 'migrate',
      action,
      name: t.name,
      meta: t.meta,
      detail: t.detail,
      notice: stackChangeRouteNotice(state, draft.stackIndex),
      why: null,
    });
  }

  // ページの描き方
  // 描き方の差は、先に当てる部品・プラン変更の後の状態と比べる（部品で既定の描き方が変わる。OCL-E7B403BA）
  const before = applyActions(state, [
    ...groups.components,
    ...(groups.stack ? [groups.stack] : []),
  ]);
  const now = routeStrategiesOf(before);
  for (const [route, want] of Object.entries(draft.routes)) {
    if (!want) continue;
    const from = now[route];
    if (
      from !== undefined &&
      strategyFamily(from) === strategyFamily(want.strategy)
    )
      continue;
    const name = `${routeLabel(state, route)}を「${strategyTitle(want.strategy, draft.framework)}」に`;
    if (rewrite) {
      items.push({
        kind: 'route',
        action: null,
        name,
        meta: [],
        why: '作り直しが済むと描き方は新しいフレームワークの既定に戻ります。描き方は作り直しが済んでから選べます',
      });
      continue;
    }
    const action: Action = {
      type: 'route',
      route,
      strategy: want.strategy,
      ...(want.value !== undefined ? { value: want.value } : {}),
    };
    groups.routes.push(action);
    const effort = actionEffort(before, action);
    items.push({
      kind: 'route',
      action,
      name,
      meta: [...(effort !== null ? [`手間 ${effort}`] : []), '来月から'],
      why: null,
    });
  }

  // コメント欄
  const route = publicRouteId(sc);
  if (
    route !== undefined &&
    draft.comments !== commentsOf(sc, state.routeParts)
  ) {
    const def = ROUTE_PARTS.comments;
    const action: Action = {
      type: 'route-part',
      route,
      part: 'comments',
      value: draft.comments,
    };
    groups.routeParts.push(action);
    items.push({
      kind: 'route-part',
      action,
      name: `${routeLabel(state, route)}の${def.label}を「${def.options.find((o) => o.value === draft.comments)?.label ?? ''}」に`,
      meta: [`手間 ${def.effort}`, '来月から'],
      detail: def.note,
      why: null,
    });
  }

  // 作り直し（残りの手間をすべて取れるので最後。D-81）
  if (rewrite) {
    const action: Action = { type: 'rewrite', framework: draft.framework };
    groups.rewrite = action;
    const t = rewriteText(state, draft.framework);
    items.push({
      kind: 'rewrite',
      action,
      name: t.name,
      meta: t.meta,
      detail: t.detail,
      notice: rewriteRouteNotice(state, draft.framework),
      why: null,
    });
  }

  // 選べるか（今の行動の検査。最初に選べなかった行動に理由を付ける）
  const actions = wrap(groups);
  const r = checkActions(state, actions);
  let why = items.find((x) => x.why !== null)?.why ?? null;
  if (!r.ok) {
    const failed = actions[r.index];
    const item = items.find((x) => x.action !== null && x.action === failed);
    if (item) item.why = r.message;
    why ??= item
      ? `${item.name}: ${r.message}`
      : `この組み合わせではできません: ${r.message}`;
  }
  return { groups, items, why };
}

/** 登録した変更の短い要約（畳んだ欄の見出し）。 */
export function setupChangeSummary(change: SetupChange): string {
  return change.items
    .filter((x) => x.action !== null)
    .map((x) => x.name)
    .join('・');
}
