// 行動の適用と、まとめての検査。
import { FRAMEWORKS, SLOT_LABELS, strategyTitle } from 'catalog';
import { PAYMENT_LABEL } from '../commitments.ts';
import { EFFORT } from '../rules.ts';
import { componentProposal } from '../components.ts';
import { eventDef, scenarioOf } from '../core.ts';
import { effortAvailable } from '../effort.ts';
import { applyEffects } from '../events.ts';
import { carryPrepay, commitmentOffers, newCommitment } from '../offers.ts';
import { newRewrite } from '../rewrite.ts';
import { ROUTE_PARTS, withComments } from '../routes/comments.ts';
import { withRouteChoice } from '../routes/strategy.ts';
import { optionLabel, SETTINGS } from '../settings.ts';
import {
  componentLabel,
  isDataSwap,
  migrationEffort,
  stackName,
  STACKS,
  storageOptionAddon,
} from '../stacks.ts';
import type { Action, ComponentSwap, GameState, Migration } from '../state.ts';
import { type ActionBlockReason, checkAction } from './check.ts';

/**
 * 行動を順に当て、最初に選べなかった行動の理由を返す（画面の選択肢の表示に使う）。すべて選べれば ok。
 */
export function checkActions(
  state: GameState,
  actions: readonly Action[],
):
  | { ok: true; state: GameState }
  | { ok: false; index: number; reason: ActionBlockReason; message: string } {
  let s = state;
  for (const [index, a] of actions.entries()) {
    const c = checkAction(s, a);
    if (!c.ok)
      return { ok: false, index, reason: c.reason, message: c.message };
    s = applyAction(s, a);
  }
  return { ok: true, state: s };
}

/** 月の終わりの行動（次の月に効く）。1 か月に複数選べる。選べない行動は状態を変えずに返す。 */
export function applyAction(state: GameState, action: Action): GameState {
  const check = checkAction(state, action);
  if (!check.ok || action.type === 'none') return state;
  const cost = check.cost;
  // 提案で付く部品を部品の欄で選ぶのは、その提案を受けるのと同じ（どちらから選んでも同じ結果）
  if (action.type === 'component') {
    const pending = componentProposal(state, action.slot, action.option);
    if (pending)
      return applyAction(state, {
        type: 'respond',
        eventId: pending,
        accept: true,
      });
  }
  const last = state.history[state.history.length - 1];
  const withNote = (label: string, s: GameState): GameState =>
    last
      ? {
          ...s,
          history: [
            ...s.history.slice(0, -1),
            {
              ...last,
              action: last.action ? `${last.action}・${label}` : label,
            },
          ],
        }
      : s;
  const planned = { plannedEffort: state.plannedEffort + cost };
  switch (action.type) {
    case 'set': {
      const def = SETTINGS[action.key];
      return withNote(
        `${def.label}: ${optionLabel(action.key, action.value)}`,
        {
          ...state,
          ...planned,
          settings: { ...state.settings, [def.field]: action.value },
        },
      );
    }
    case 'optimize':
      return withNote('SSR を最適化（−5 ms）', {
        ...state,
        ...planned,
        settings: {
          ...state.settings,
          ssrOptimizations: state.settings.ssrOptimizations + 1,
        },
      });
    case 'plan':
      return withNote(
        `${stackName(action.stackIndex, state.framework, true, state.components)} にプラン変更`,
        {
          ...state,
          ...planned,
          stackIndex: action.stackIndex,
          // 12 か月一括のままのスケールアップは、差額を払って上位のプランの 12 か月一括に（D-97）
          ...(() => {
            const commitments = carryPrepay(
              state,
              state.stackIndex,
              action.stackIndex,
            );
            return commitments ? { commitments } : {};
          })(),
        },
      );
    case 'route': {
      const sc = scenarioOf(state);
      const r = sc.template(1).routes.find((x) => x.id === action.route)!;
      return withNote(
        `${r.label ?? r.id}を${strategyTitle(action.strategy)}に`,
        {
          ...state,
          ...planned,
          routes: withRouteChoice(
            sc,
            {
              framework: state.framework,
              platform: STACKS[state.stackIndex]!.provider,
              legacyRouteDefaults: state.legacyRouteDefaults,
            },
            state.routes,
            action.route,
            action.strategy,
          ),
          ...(action.value !== undefined
            ? {
                settings: { ...state.settings, revalidateSec: action.value },
              }
            : {}),
        },
      );
    }
    case 'route-part': {
      const sc = scenarioOf(state);
      const r = sc.template(1).routes.find((x) => x.id === action.route)!;
      const def = ROUTE_PARTS[action.part];
      const routeParts = withComments(sc, state.routeParts, action.value);
      const { routeParts: _, ...rest } = state;
      return withNote(
        `${r.label ?? r.id}の${def.label}: ${def.options.find((o) => o.value === action.value)!.label}`,
        {
          ...rest,
          ...planned,
          ...(Object.keys(routeParts).length > 0 ? { routeParts } : {}),
        },
      );
    }
    case 'rewrite':
      return withNote(
        `${FRAMEWORKS[action.framework].label} への作り直しを始めた`,
        { ...state, rewrite: newRewrite(state, action.framework) },
      );
    case 'migrate': {
      const migration: Migration = {
        from: state.stackIndex,
        to: action.stackIndex,
        required: migrationEffort(state.stackIndex, action.stackIndex),
        done: 0,
      };
      // 乗り換えの月ごとの手間と行動を合わせて、来月の手間に収まるか
      if (effortAvailable({ ...state, migration }) < 0) return state;
      return withNote(
        `${stackName(action.stackIndex, state.framework)} へ乗り換えを始めた`,
        {
          ...state,
          migration,
        },
      );
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId)!;
      const responded: GameState = {
        ...state,
        pendingProposals: state.pendingProposals.filter((id) => id !== def.id),
        responses: {
          ...state.responses,
          [def.id]: action.accept ? 'accepted' : 'declined',
        },
      };
      return withNote(
        `提案「${def.title}」を${action.accept ? '受けた' : '断った'}`,
        action.accept
          ? applyEffects(responded, def.accept!.effects, def.id)
          : responded,
      );
    }
    case 'storage-option': {
      const addon = storageOptionAddon(state.stackIndex)!;
      return withNote('ストレージ変更オプションを付けた', {
        ...state,
        ...planned,
        storageOption: true,
        storageOptionFeeDue: {
          name: addon.name,
          ...(addon.label ? { label: addon.label } : {}),
          amount: addon.oneTimeFee,
        },
      });
    }
    case 'commit': {
      const offer = commitmentOffers(state).find(
        (o) => o.key === action.key && o.payment === action.payment,
      )!;
      return withNote(
        `確約: ${offer.label}（${PAYMENT_LABEL[offer.payment]}）`,
        {
          ...state,
          commitments: [
            ...(state.commitments ?? []),
            newCommitment(offer, state.history.length + 1),
          ],
        },
      );
    }
    case 'block-bots':
      return withNote('Bot を遮断するルールを入れた', {
        ...state,
        ...planned,
        botBlocked: true,
      });
    case 'component': {
      const platform = STACKS[state.stackIndex]!.provider;
      const label = `${SLOT_LABELS[action.slot]}: ${componentLabel(platform, action.slot, action.option)}`;
      if (isDataSwap(action.slot)) {
        const componentSwap: ComponentSwap = {
          slot: action.slot,
          option: action.option,
          required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
          done: 0,
        };
        // 新しい事業者のアカウントを足す DB（Hyperdrive の Supabase など）は、設定の一度きりの手間も今月使う（D-52・OCL-B6A107A3）
        const next = { ...state, ...planned, componentSwap };
        if (effortAvailable(next) < 0) return state;
        return withNote(`${label} へ差し替えを始めた`, next);
      }
      return withNote(`${label} に差し替えた`, {
        ...state,
        ...planned,
        components: { ...state.components, [action.slot]: action.option },
      });
    }
  }
}

export function applyActions(
  state: GameState,
  actions: readonly Action[],
): GameState {
  return actions.reduce(applyAction, state);
}
