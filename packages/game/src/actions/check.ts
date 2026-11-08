// 行動の検査（選べるか・手間はいくらか）。
import {
  componentsOf,
  DEFAULT_CHOICES,
  FRAMEWORKS,
  ROUTE_STRATEGIES,
  strategySupport,
} from 'catalog';
import { EFFORT } from '../rules.ts';
import { newAccountsBy } from '../accounts.ts';
import {
  componentConflict,
  componentProposal,
  proposalOnlyComponent,
} from '../components.ts';
import { eventDef, frameworksOf, scenarioOf } from '../core.ts';
import {
  componentBaseEffort,
  effortAvailable,
  nextSsrCpuMs,
  rewriteWanted,
} from '../effort.ts';
import { acceptEffort } from '../events.ts';
import { settingInactiveReason } from '../notes.ts';
import {
  activeCommitments,
  carryPrepay,
  commitmentDef,
  commitmentOffers,
  pendingUpfrontUsd,
} from '../offers.ts';
import { onDemandBlocker, unavailableReason } from '../requirements.ts';
import { newRewrite, rewriteUnsupported } from '../rewrite.ts';
import {
  commentsChoosable,
  commentsOf,
  ROUTE_PARTS,
} from '../routes/comments.ts';
import {
  hiddenSettings,
  revalidateSettingOf,
} from '../routes/hidden-settings.ts';
import {
  articleFamily,
  publicRoute,
  routeAudienceOf,
  routeChangeEffort,
  routeChoices,
  strategyFamily,
  strategySelectable,
} from '../routes/strategy.ts';
import { ON_DEMAND_REVALIDATE, SETTINGS } from '../settings.ts';
import {
  isDataSwap,
  isPlanChange,
  isRecontract,
  migrationEffort,
  planChangeEffort,
  STACKS,
  stackSupports,
  storageOptionAddon,
  swapLabel,
} from '../stacks.ts';
import type { Action, GameState, Migration } from '../state.ts';

/** Bot を遮断するルールの手間と効き方（ゲーム上の仮定。製品の料金は未取得。D-20 V-9）。 */
export const BOT_BLOCK = { effort: 2, remaining: 0.5 } as const;

/** 行動を選べない理由（画面はこの文をそのまま出す）。 */
export type ActionBlockReason =
  | 'not-playing' // ゲームが終わっている
  | 'invalid' // 存在しない選択肢
  | 'same' // 今と同じ・すでに選んでいる（予定済み）
  | 'irreversible' // 戻せない（チャットを受けたあとのリアルタイムなど）
  | 'busy' // 乗り換え・DB の差し替えの最中
  | 'unavailable' // 要件を満たせる構成が無い（SLA など）
  | 'via-proposal' // 提案を受けると付く部品
  | 'limit' // これ以上できない（SSR の最適化の下限など）
  | 'effort'; // 手間が足りない

export type ActionCheck =
  | { ok: true; cost: number }
  | { ok: false; reason: ActionBlockReason; message: string };

const ok = (cost: number): ActionCheck => ({ ok: true, cost });
const ng = (reason: ActionBlockReason, message: string): ActionCheck => ({
  ok: false,
  reason,
  message,
});

/** 行動の規則（手間の残りは見ない）。選べない理由を区別して返す。 */
function actionRule(state: GameState, action: Action): ActionCheck {
  if (state.phase !== 'playing')
    return ng('not-playing', 'ゲームは終わっています');
  const busy = state.migration
    ? ng('busy', '乗り換えの最中は選べません')
    : state.componentSwap
      ? ng('busy', `${swapLabel(state.componentSwap.slot)}の最中は選べません`)
      : null;
  // 作り直しの最中は、乗り換え・部品の差し替え・別の作り直しを選べない（済むと部品が新しいフレームワークの選択に替わるため。
  // 同じ事業者のプラン変更・ストレージ変更オプションは選べる。D-81）
  const rewriting = state.rewrite
    ? ng(
        'busy',
        `${FRAMEWORKS[state.rewrite.to].label} への作り直しの最中は選べません`,
      )
    : null;
  switch (action.type) {
    case 'none':
      return ok(0);
    case 'set': {
      const def = SETTINGS[action.key];
      if (!def || !def.options.some((o) => o.value === action.value))
        return ng('invalid', '選択肢にありません');
      if (hiddenSettings(state).includes(action.key))
        return ng(
          'unavailable',
          action.key === 'isr' ||
            action.key === 'apiCacheTtl' ||
            action.key === 'buildInterval' ||
            action.key === 'pageCache'
            ? articleFamily(state) === 'ssr' ||
              (articleFamily(state) === 'api' && state.framework !== 'vite-spa')
              ? '記事のページをキャッシュしない描き方では効きません'
              : `${FRAMEWORKS[state.framework].label} では「${SETTINGS[revalidateSettingOf(state.framework, articleFamily(state))].label}」で選びます`
            : 'このシナリオでは効きません',
        );
      if (state.settings[def.field] === action.value)
        return ng('same', '今と同じ（または選択済み）');
      const inactive = settingInactiveReason(state, action.key);
      if (inactive) return ng('unavailable', inactive);
      // 部品ごとにキャッシュの記事は、タグで消せない部品ではオンデマンドにできない（表の選択肢・計算と同じ判定。D-111・OCL-FC4A03B7）
      if (action.key === 'isr' && action.value === ON_DEMAND_REVALIDATE) {
        const sc = scenarioOf(state);
        const pr = publicRoute(sc);
        const blocker = onDemandBlocker(
          state.stackIndex,
          state.components,
          state.framework,
          'cached',
        );
        if (
          pr &&
          blocker &&
          routeChoices(sc, [pr], {
            framework: state.framework,
            platform: STACKS[state.stackIndex]!.provider,
            settings: state.settings,
            components: state.components,
            routes: state.routes,
            legacyRouteDefaults: state.legacyRouteDefaults,
          })[pr.id]?.strategy === 'cache-components'
        )
          return ng(
            'unavailable',
            `部品ごとにキャッシュの記事をタグで消せません（${blocker.label}: ${blocker.reason.replace(/。$/, '')}）`,
          );
      }
      // 時間 → オンデマンドは、更新のたびに再検証を呼ぶ実装の手間がかかる（D-49）
      // 静的書き出しの更新のたびのビルドも、更新からビルドを起こす仕組み（デプロイの hook）の実装が要る（同じ手間・仮定。D-68）。
      // Astro の投稿・編集でキャッシュを消すのも、消す呼び出し（cache.invalidate・bypassToken）の実装が要る（同じ手間・仮定。D-103）
      if (
        (action.key === 'isr' ||
          action.key === 'buildInterval' ||
          action.key === 'pageCache') &&
        action.value === ON_DEMAND_REVALIDATE
      )
        return ok(EFFORT.onDemandSwitch);
      return ok(def.effort);
    }
    case 'optimize':
      return nextSsrCpuMs(state) > EFFORT.minSsrCpuMs
        ? ok(EFFORT.optimize)
        : ng(
            'limit',
            `SSR の CPU は ${EFFORT.minSsrCpuMs} ms より下げられません`,
          );
    case 'plan':
    case 'migrate': {
      if (busy) return busy;
      if (action.type === 'migrate' && rewriting) return rewriting;
      if (!STACKS[action.stackIndex]) return ng('invalid', '構成がありません');
      if (action.stackIndex === state.stackIndex)
        return ng('same', '今の構成と同じ');
      if (!stackSupports(action.stackIndex, state.framework))
        return ng(
          'unavailable',
          `${FRAMEWORKS[state.framework].label} を載せる公式のアダプターがありません`,
        );
      const plan = isPlanChange(state.stackIndex, action.stackIndex);
      if ((action.type === 'plan') !== plan)
        return ng(
          'invalid',
          plan
            ? '同じ事業者なのでプラン変更'
            : isRecontract(state.stackIndex, action.stackIndex)
              ? '今よりディスク容量が少ないプランへは変更できないので契約し直し'
              : '別の事業者なので乗り換え',
        );
      // 年額のままのスケールアップは差額を来月に前払いするので、所持金に収まるときだけ（D-97・OCL-C32E39AF）
      const carried = plan
        ? carryPrepay(state, state.stackIndex, action.stackIndex)
        : undefined;
      if (carried) {
        const due = pendingUpfrontUsd(state, carried);
        if (due > state.cash)
          return ng(
            'limit',
            `年額のままの変更の前払い $${due.toFixed(2)} が所持金より多いです`,
          );
      }
      // 乗り換えの手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(plan ? planChangeEffort(state.stackIndex) : 0);
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId);
      if (!def?.accept) return ng('invalid', '提案がありません');
      if (!state.pendingProposals.includes(action.eventId))
        return ng('same', 'すでに返事をしました');
      if (action.accept) {
        const why = unavailableReason(state, def);
        if (why) return ng('unavailable', why);
      }
      return ok(action.accept ? acceptEffort(def, state) : 0);
    }
    case 'storage-option': {
      if (busy) return busy;
      if (!storageOptionAddon(state.stackIndex))
        return ng('invalid', 'さくらの VPS のときだけ');
      if (state.storageOption)
        return ng('same', 'すでに付けています（戻せません）');
      return ok(EFFORT.storageOption);
    }
    case 'block-bots':
      return state.botBlocked
        ? ng('same', 'すでに入れています')
        : ok(BOT_BLOCK.effort);
    case 'commit': {
      const def = commitmentDef(action.key);
      if (!def) return ng('invalid', '確約がありません');
      if (!def.commitment.payments.some((p) => p.payment === action.payment))
        return ng('invalid', 'この確約に無い支払いの形');
      const cur = activeCommitments(state).find((c) => c.key === action.key);
      if (cur)
        return ng(
          'same',
          `すでに結んでいます（${cur.endMonth} か月目まで・取り消せません）`,
        );
      const offer = commitmentOffers(state).find(
        (o) => o.key === action.key && o.payment === action.payment,
      );
      if (!offer)
        return ng(
          'unavailable',
          '今月は対象の使用がありません（対象のサービスを使っている構成で結べます）',
        );
      // 同じ月に選んだほかの前払い（確約・年額のスケールアップの差額）も来月に払うので、合わせて所持金と比べる
      const reserved = pendingUpfrontUsd(state);
      if (offer.usd.upfront + reserved > state.cash)
        return ng(
          'limit',
          `前払い $${offer.usd.upfront.toFixed(2)}${reserved > 0 ? `（今月選んだ前払い $${reserved.toFixed(2)} と合わせて）` : ''} が所持金より多いです`,
        );
      // 申し込むだけで、作業の手間はかからない（仮定）
      return ok(0);
    }
    case 'route': {
      // 作り直しの最中は、済むと描き方が新しいフレームワークの既定に戻るので選べない（D-81・D-107）
      if (rewriting) return rewriting;
      const sc = scenarioOf(state);
      const r = sc.template(1).routes.find((x) => x.id === action.route);
      if (!r) return ng('invalid', 'このシナリオに無いページ');
      if (!ROUTE_STRATEGIES[action.strategy])
        return ng('invalid', '描き方にありません');
      if (
        action.value !== undefined &&
        !Object.values(SETTINGS).some(
          (d) =>
            d.field === 'revalidateSec' &&
            d.options.some((o) => o.value === action.value),
        )
      )
        return ng('invalid', '選択肢に無い値');
      const platform = STACKS[state.stackIndex]!.provider;
      const audience = routeAudienceOf(sc, r);
      const now = routeChoices(sc, [r], {
        framework: state.framework,
        platform,
        settings: state.settings,
        components: state.components,
        routes: state.routes,
        legacyRouteDefaults: state.legacyRouteDefaults,
      })[r.id]!.strategy;
      if (strategyFamily(now) === strategyFamily(action.strategy))
        return ng(
          'same',
          strategyFamily(now) === 'cached'
            ? '期限とオンデマンドは設定で替えます'
            : '今の描き方と同じ',
        );
      if (
        !strategySelectable(
          state.framework,
          platform,
          audience,
          action.strategy,
        )
      )
        return ng(
          'unavailable',
          strategySupport(state.framework, platform, audience, action.strategy)
            .note,
        );
      return ok(routeChangeEffort(now, action.strategy));
    }
    case 'route-part': {
      // ページの部品（記事のページのコメント欄。D-109）。手間は前の設定「コメントの描き方」と同じ（D-82）
      const sc = scenarioOf(state);
      const def = ROUTE_PARTS[action.part];
      if (!def || !def.options.some((o) => o.value === action.value))
        return ng('invalid', '選択肢にありません');
      const r = publicRoute(sc);
      if (!r || r.id !== action.route || sc.comments === undefined)
        return ng('unavailable', 'このページには無い部品');
      if (!commentsChoosable(state.framework, sc, state.routes))
        return ng(
          'unavailable',
          state.framework === 'vite-spa'
            ? 'SPA には記事のページがありません（コメントはブラウザで読み込みます）'
            : '記事のページが枠 + API なので、コメントを含める HTML がありません（コメントはブラウザで読み込みます）',
        );
      if (commentsOf(sc, state.routeParts) === action.value)
        return ng('same', '今と同じ（または選択済み）');
      return ok(def.effort);
    }
    case 'rewrite': {
      if (busy) return busy;
      if (rewriting) return rewriting;
      if (!frameworksOf(scenarioOf(state)).allowed.includes(action.framework))
        return ng('invalid', 'このシナリオでは選べないフレームワーク');
      if (action.framework === state.framework)
        return ng('same', '今のフレームワークと同じ');
      const unsupported = rewriteUnsupported(
        state.stackIndex,
        action.framework,
      );
      if (unsupported) return ng('unavailable', unsupported);
      // 作り直しの手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(0);
    }
    case 'component': {
      if (busy) return busy;
      if (rewriting) return rewriting;
      const sc = scenarioOf(state);
      const platform = STACKS[state.stackIndex]!.provider;
      const opt = componentsOf(platform, action.slot, state.framework).find(
        (c) => c.id === action.option,
      );
      if (!opt) return ng('invalid', 'この事業者の部品にありません');
      const current = { ...DEFAULT_CHOICES[platform], ...state.components };
      if (current[action.slot] === action.option)
        return ng('same', '今の部品（または選択済み）');
      // チャットを受けたあとはリアルタイムを外せない
      if (action.slot === 'realtime' && state.mods.realtime)
        return ng('irreversible', 'チャットを受けたので外せません');
      // さくらの VPS の API の応答のキャッシュは前段の CDN の上で効く（D-37）
      const conflict = componentConflict(
        platform,
        action.slot,
        action.option,
        current,
        state.framework,
      );
      if (conflict) return ng('unavailable', conflict);
      // 提案で付く部品は、提案が届いている月だけ選べる（選ぶと提案を受けたのと同じ）
      const via = proposalOnlyComponent(sc, action.slot, action.option);
      if (via) {
        const pending = componentProposal(state, action.slot, action.option);
        if (!pending)
          return ng('via-proposal', `提案「${via.title}」を受けると付きます`);
        return actionRule(state, {
          type: 'respond',
          eventId: pending,
          accept: true,
        });
      }
      // 新しい事業者のアカウントを足す部品は、差すときに一度きりの手間が付く（D-52）
      const setup =
        newAccountsBy(state, action.slot, action.option).length > 0
          ? EFFORT.accountSetup
          : 0;
      if (isDataSwap(action.slot)) return ok(setup); // 移行の手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(componentBaseEffort(state, action.slot, action.option) + setup);
    }
  }
}

/** 行動の手間（選べない行動は null。手間の残りは見ない）。 */
export function actionEffort(state: GameState, action: Action): number | null {
  const r = actionRule(state, action);
  return r.ok ? r.cost : null;
}

/** 行動を今選べるか（規則と手間の残り）。選べなければ理由を区別して返す。 */
export function checkAction(state: GameState, action: Action): ActionCheck {
  const r = actionRule(state, action);
  if (!r.ok) return r;
  const left = effortAvailable(state);
  const short = (need: number) =>
    ng('effort', `手間が足りません: あと ${need}`);
  if (r.cost > left) return short(r.cost - left);
  if (action.type === 'migrate') {
    const m: Migration = {
      from: state.stackIndex,
      to: action.stackIndex,
      required: migrationEffort(state.stackIndex, action.stackIndex),
      done: 0,
    };
    const after = effortAvailable({ ...state, migration: m });
    if (after < 0) return short(-after);
  }
  // プラン変更は今月から構成が替わり、月の手間に足す既定の構成の事業者の管理の分（D-123）も替わる。
  // 減る向き（Cloudflare Free で Resend を選んで Paid へ、など）でも余力が負にならないか、変更後の構成で確かめる（OCL-15C8F3A2）
  if (action.type === 'plan') {
    const after = effortAvailable({
      ...state,
      stackIndex: action.stackIndex,
      plannedEffort: state.plannedEffort + r.cost,
    });
    if (after < 0) return short(-after);
  }
  // 作り直しは残りの手間をすべて取れる（月あたりの上限まで）。今月 1 も回せないときだけ選べない
  if (
    action.type === 'rewrite' &&
    rewriteWanted({
      ...state,
      rewrite: newRewrite(state, action.framework),
    }) <= 0
  )
    return ng('effort', '作り直しに回せる手間が残っていません');
  if (
    action.type === 'component' &&
    isDataSwap(action.slot) &&
    !proposalOnlyComponent(scenarioOf(state), action.slot, action.option)
  ) {
    const after = effortAvailable({
      ...state,
      componentSwap: {
        slot: action.slot,
        option: action.option,
        required: EFFORT.dbSwap.perMonth * EFFORT.dbSwap.months,
        done: 0,
      },
      // 新しいアカウントの設定の一度きりの手間（r.cost）も同じ月に使う（D-52・OCL-B6A107A3）
      plannedEffort: state.plannedEffort + r.cost,
    });
    if (after < 0) return short(-after);
  }
  // DB 以外の部品は今月から差し替わるので、増えるアカウントの維持（D-52）も今月の余力に含めて確かめる（OCL-73780314）
  if (
    action.type === 'component' &&
    !isDataSwap(action.slot) &&
    !proposalOnlyComponent(scenarioOf(state), action.slot, action.option)
  ) {
    const after = effortAvailable({
      ...state,
      components: { ...state.components, [action.slot]: action.option },
      plannedEffort: state.plannedEffort + r.cost,
    });
    if (after < 0) return short(-after);
  }
  return r;
}
