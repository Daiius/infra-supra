// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間、GD-3 でシナリオのデータと出来事を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// シナリオの値（収益・成長・手間・満足度・障害の影響・出来事・目標）はゲーム上の仮定で、実在の値ではない（prd/07 §10）。
import {
  type Effect,
  type EventDef,
  type PageBadge,
  type RegionSource,
  rollRevisions,
  rollSchedule,
  type Scenario,
  type Scheduled,
  type Stock,
  type Strategy,
  type WireframeRegion,
  type WorkloadMods,
} from './scenario.ts';
import {
  apiCacheActive,
  apiPlacedElsewhere,
  astroPageCacheChoice,
  type Choices,
  type ComponentProvider,
  componentsOf,
  DEFAULT_CHOICES,
  defaultStrategy,
  deployTarget,
  FILE_STORAGE_LABEL,
  fileStorageOf,
  FRAMEWORK_PRESETS,
  type FrameworkId,
  FRAMEWORKS,
  imagesBehavior,
  MVP_STACKS,
  perPageShellFramework,
  rebuildsStaticPages,
  ROUTE_STRATEGIES,
  ROUTE_STRATEGY_ORDER,
  type RouteAudience,
  type RouteStrategyId,
  type RouteTraits,
  SLOT_LABELS,
  type SlotId,
  strategySupport,
} from 'catalog';
import {
  allocateEffort,
  buzzLasting,
  COLD_START,
  effectiveSsrCpuMs,
  EFFORT,
  type EffortBreakdown,
  type Element,
  ELEMENT_LABEL,
  ELEMENTS,
  FLAT_PLAN_ADJUST,
  growthFromReputation,
  judgeStages,
  policyStep,
  reputation,
  satisfactionScore,
  speedHeaviness,
  type Stage,
  STAGE_VALUE,
  type Stages,
} from './rules.ts';
import { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
import {
  type ActiveCommitment,
  commitmentEligible,
  commitmentLines,
  type CommitmentPaymentId,
  PAYMENT_LABEL,
} from './commitments.ts';
import type { ArchitectureInput, PlatformPremise, PriceBook } from 'estimator';
import { nextRandom } from './random.ts';
import { premiseTrends } from './trends.ts';
import { accountLabel, accountUpkeepOf, newAccountsBy } from './accounts.ts';
import {
  componentConflict,
  componentProposal,
  proposalOnlyComponent,
} from './components.ts';
import {
  baseSsrCpuMsOf,
  booksAt,
  DEFAULT_START_DATE,
  estimate,
  eventDef,
  frameworkDefaults,
  frameworksOf,
  revisionText,
  scenarioOf,
  scenarioSendsEmail,
  SCHEDULED_CHANGES,
  USD_JPY,
} from './core.ts';
import { commas, fmtFactor, lineLabel, toUsd, usd, usdOf } from './format.ts';
import {
  activeCommitments,
  carryPrepay,
  commitmentDef,
  type CommitmentOffer,
  commitmentOffers,
  COMMITMENTS,
  newCommitment,
  offerOf,
  offersFor,
  pendingUpfrontUsd,
} from './offers.ts';
import {
  FRONT_CDN_DELAY_FACTOR,
  htmlCachedAtFront,
  meetsRequirement,
  onDemandBlocker,
  REQUIREMENT_LABEL,
  requirementStatus,
  unavailableReason,
} from './requirements.ts';
import {
  commentsChoosable,
  commentsInPage,
  commentsOf,
  partsOfComments,
  ROUTE_PARTS,
  withComments,
} from './routes/comments.ts';
import {
  defaultRevalidateSec,
  hiddenSettings,
  revalidateSettingOf,
} from './routes/hidden-settings.ts';
import {
  articleFamily,
  articleShellPerPage,
  publicRoute,
  routeAudienceOf,
  routeChangeEffort,
  routeChoices,
  routeFamily,
  SHELL_PER_PAGE_NOTE,
  SHELL_PER_PAGE_WHY,
  shellPerPage,
  strategyFamily,
  strategySelectable,
  validRouteOverrides,
  withRouteChoice,
} from './routes/strategy.ts';
import {
  astroImage,
  autoImageFormat,
  COMMENTS_IN_BROWSER,
  DEFAULT_REVALIDATE_SEC,
  deliveredImageKB,
  IMAGE_FORMAT_KB,
  imageFormatOf,
  isOnDemand,
  ON_DEMAND_REVALIDATE,
  optionLabel,
  pageWeightKB,
  pageWeightLabel,
  type SettingKey,
  type Settings,
  SETTINGS,
  usesNextImage,
} from './settings.ts';
import {
  setupCommentOptions,
  setupRevalidateOptions,
} from './setup/options.ts';
import {
  componentLabel,
  componentsAfterMigration,
  imagesOf,
  isDataSwap,
  isPlanChange,
  isRecontract,
  membersOf,
  migrationEffort,
  offeredBaselines,
  planChangeEffort,
  realtimeSupported,
  selfBackupOf,
  selfHostedOf,
  slaOf,
  slotIneffective,
  stackName,
  STACKS,
  stackSupports,
  storageOptionAddon,
  swapLabel,
  withoutDomainRegistration,
  withoutRealtime,
} from './stacks.ts';
import type {
  Action,
  ComponentSwap,
  Crossing,
  EndReason,
  GameState,
  Migration,
  MonthEvent,
  MonthReport,
  Rewrite,
  RouteOverrides,
  RoutePartKey,
  RouteParts,
} from './state.ts';
import {
  architectureFor,
  coldStartViewShare,
  initialStock,
  type Spike,
  staticBuildOf,
  workloadFor,
  type WorkloadParts,
} from './workload.ts';
export {
  scenarioSendsEmail,
  SCENARIOS,
  USD_JPY,
  baseSsrCpuMsOf,
  GAME,
  scenarioOf,
  frameworksOf,
  frameworkDefaults,
  eventDef,
  DEFAULT_START_DATE,
  SCHEDULED_CHANGES,
  applyRevisions,
  revisionText,
} from './core.ts';
export {
  type Settings,
  ON_DEMAND_REVALIDATE,
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  COMMENT_PAGES_PER_UPDATE,
  isOnDemand,
  ON_DEMAND_MAX_AGE_NOTE,
  IMAGE_FORMAT_KB,
  imageFormatOf,
  usesNextImage,
  autoImageFormat,
  SETTINGS,
  type SettingKey,
  deliveredImageKB,
  pageWeightKB,
  pageWeightLabel,
  DEFAULT_REVALIDATE_SEC,
  SETTING_FLAVOR,
  settingFlavor,
} from './settings.ts';
export {
  type RouteOverrides,
  type RoutePartChoice,
  type RouteParts,
  type RoutePartKey,
  type StrategyFamily,
  type Action,
  type ComponentSwap,
  type Migration,
  type Rewrite,
  type EndReason,
  type MonthEvent,
  type Crossing,
  type MonthReport,
  type GameState,
} from './state.ts';
export {
  isDataSwap,
  swapLabel,
  slotIneffective,
  dbBackupStatus,
  selfBackupOf,
  STACKS,
  stackSupports,
  stackOffered,
  offeredBaselines,
  selfHostedOf,
  stackName,
  withoutDomainRegistration,
  membersOf,
  slaOf,
  componentLabel,
  storageOptionAddon,
  storageOptionText,
  isPlanChange,
  isRecontract,
  planChangeEffort,
  migrationEffort,
  stackChangeText,
  stackFlavor,
} from './stacks.ts';
export {
  componentProposal,
  componentConflict,
  componentFlavor,
} from './components.ts';
export {
  accountLabel,
  accountsFor,
  addedAccounts,
  accountUpkeepOf,
  newAccountsBy,
} from './accounts.ts';
export {
  strategyFamily,
  routeAudienceOf,
  publicRouteId,
  routeFamily,
  articleFamily,
  routeChoices,
  shellPerPage,
  articleShellPerPage,
  strategySelectable,
  withRouteChoice,
  validRouteOverrides,
  routeChangeEffort,
} from './routes/strategy.ts';
export {
  commentsOf,
  partsOfComments,
  withComments,
  commentsChoosable,
  commentsInPage,
  ROUTE_PARTS,
} from './routes/comments.ts';
export {
  hiddenSettings,
  revalidateSettingOf,
  defaultRevalidateSec,
} from './routes/hidden-settings.ts';
export {
  setupRevalidateOptions,
  setupCommentOptions,
} from './setup/options.ts';
export {
  type WorkloadParts,
  type Spike,
  spikePeakFactor,
  ON_DEMAND_MAX_AGE_SEC,
  ON_DEMAND_PAGES_PER_UPDATE,
  workloadFor,
  coldStartViewShare,
  initialStock,
  staticBuildOf,
  type RoutingOptions,
} from './workload.ts';
export {
  meetsRequirement,
  requirementReachable,
  FRONT_CDN_DELAY_FACTOR,
  requirementStatus,
  unavailableReason,
} from './requirements.ts';
export {
  COMMITMENTS,
  commitmentDef,
  type CommitmentOffer,
  activeCommitments,
  commitmentOffers,
} from './offers.ts';

/** Bot を遮断するルールの手間と効き方（ゲーム上の仮定。製品の料金は未取得。D-20 V-9）。 */
export const BOT_BLOCK = { effort: 2, remaining: 0.5 } as const;

/**
 * 記事ごとの SNS のカードが出ないか（記事のページが枠 + API（S5）で、OGP の前処理なし。prd/10 F-05・D-107）。
 * OGP の前処理の部品は SPA だけにある。Next.js・Astro・静的書き出しの記事の S5 は記事ごとの枠（メタタグ入り）なのでカードは出る（D-109）。
 */
function noSocialCards(
  state: Pick<
    GameState,
    'framework' | 'components' | 'scenario' | 'stackIndex'
  > & {
    routes?: RouteOverrides | undefined;
  },
): boolean {
  const r = publicRoute(state.scenario);
  if (!r)
    return (
      state.framework === 'vite-spa' && state.components.ogp !== 'prerender'
    );
  const needsOgp = state.scenario.routeTraits[r.id]?.needsOgp ?? true;
  return (
    needsOgp &&
    routeFamily(state, r.id) === 'api' &&
    !articleShellPerPage(state) &&
    state.components.ogp !== 'prerender'
  );
}

/** 始める画面で選んだ部品を重ねた、1 か月目の部品（newGame と同じ重ね方）。 */
function initialComponents(
  sc: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components?: Choices,
): Choices {
  return {
    ...DEFAULT_CHOICES[STACKS[stackIndex]!.provider],
    ...frameworkDefaults(framework, STACKS[stackIndex]!.provider, sc),
    ...(components
      ? validSetupChoices(sc, stackIndex, framework, components)
      : {}),
  };
}

/**
 * 始める画面で結べる確約: 台数の予約（RDS のリザーブドインスタンス）と年払い（さくらの VPS）だけ。
 * 時間あたりの額の確約（Savings Plans・CUD）は額を使用から決めるので、1 か月動かしてから。
 * 前払いが始めの所持金を超える形（さくらの年額・RDS の全額前払い）は出さない（D-97）。
 */
export function setupCommitments(
  sc: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components?: Choices,
): CommitmentOffer[] {
  const arch = architectureFor(
    stackIndex,
    0,
    framework,
    initialComponents(sc, stackIndex, framework, components),
  );
  const billed = new Set(
    arch.nodes.flatMap((n) =>
      n.billing ? [`${n.billing.provider}:${n.billing.planId}`] : [],
    ),
  );
  return offersFor(
    COMMITMENTS.filter(
      (d) =>
        d.commitment.kind !== 'spend' &&
        billed.has(`${d.provider}:${d.planId}`),
    ),
    () => undefined,
    sc.months,
  ).filter((o) => o.usd.upfront <= sc.startCash);
}

/**
 * 作り直した後の部品の選択（D-81）。新しいフレームワークでも選べる部品はそのまま（始める画面と同じ規則 validSetupChoices で確かめる）、
 * 選べない部品はフレームワークの既定に戻す。API の置き場は、同じ選択肢が無ければ同じ事業者に置く選択肢に替えて維持する
 * （例: Next.js の「Cloudflare Workers・D1」→ SPA の同じ名前の選択肢）。どちらも無ければ同じ事業者に同居（既定）。
 * 提案で付いた部品（チャットの Durable Objects など）は、新しいフレームワークでも選べれば残す。
 */
export function componentsAfterRewrite(
  state: Pick<
    GameState,
    'scenario' | 'stackIndex' | 'components' | 'framework'
  >,
  to: FrameworkId,
): Choices {
  const sc = scenarioOf(state);
  const platform = STACKS[state.stackIndex]!.provider;
  const cur = state.components;
  const apiOpts = componentsOf(platform, 'api', to);
  let api = cur.api;
  if (api !== undefined && !apiOpts.some((o) => o.id === api)) {
    const where = componentsOf(platform, 'api', state.framework).find(
      (o) => o.id === api,
    )?.platform;
    api = apiOpts.find((o) => o.id !== 'same' && o.platform === where)?.id;
  }
  const kept = validSetupChoices(sc, state.stackIndex, to, {
    ...cur,
    api: api ?? 'same',
  });
  const viaProposal: Choices = {};
  for (const [slot, option] of Object.entries(cur) as [SlotId, string][])
    if (
      proposalOnlyComponent(sc, slot, option) &&
      componentsOf(platform, slot, to).some((o) => o.id === option)
    )
      viaProposal[slot] = option;
  const out: Choices = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(to, platform, sc),
    ...kept,
    ...viaProposal,
  };
  // API を他の事業者に置いている間は、構成の DB の選択は使わない（D-65。差し替えの完了と同じ）
  if (apiPlacedElsewhere(out)) delete out.db;
  return out;
}

/** 作り直した後の再検証の値（新しいフレームワークの設定に無い値は既定の 5 分に戻す。例: オンデマンド → SPA の API のキャッシュの期間）。 */
function revalidateAfterRewrite(revalidateSec: number, to: FrameworkId) {
  return SETTINGS[revalidateSettingOf(to)].options.some(
    (o) => o.value === revalidateSec,
  )
    ? revalidateSec
    : DEFAULT_REVALIDATE_SEC;
}

/** 作り直せないとき、その理由（今の構成の事業者に新しいフレームワークを載せられない）。載せられれば undefined。 */
function rewriteUnsupported(
  stackIndex: number,
  to: FrameworkId,
): string | undefined {
  if (stackSupports(stackIndex, to)) return undefined;
  const note = deployTarget(to, STACKS[stackIndex]!.provider)?.note;
  return `今の構成に ${FRAMEWORKS[to].label} を載せる公式のアダプターが無い${note ? `（${note}）` : ''}`;
}

/** 作り直し先の候補（シナリオで選べるフレームワークのうち、今のもの以外）。 */
export function rewriteTargets(
  state: Pick<GameState, 'scenario' | 'framework'>,
): FrameworkId[] {
  return frameworksOf(scenarioOf(state)).allowed.filter(
    (f) => f !== state.framework,
  );
}

/**
 * アプリの作り直しの選択肢の文（D-81）。label は判断に直接効く数だけの短い文、detail は理由・仮定の説明（画面の ⓘ）。
 * 月あたりは今の維持の手間で減ることがあるので、見込みの月数は今の余力で数える。
 */
export function rewriteText(
  state: GameState,
  to: FrameworkId,
): { name: string; meta: string[]; detail: string } {
  const per = EFFORT.rewrite.perMonth;
  const required = rewriteEffort();
  const room = rewriteWanted({
    ...state,
    plannedEffort: 0,
    rewrite: { from: state.framework, to, required, done: 0 },
  });
  const months = room > 0 ? Math.ceil(required / room) : Infinity;
  const left = scenarioOf(state).months - state.history.length;
  const after = componentsAfterRewrite(state, to);
  const platform = STACKS[state.stackIndex]!.provider;
  const lost = (Object.keys(SLOT_LABELS) as SlotId[]).filter(
    (slot) =>
      state.components[slot] !== undefined &&
      after[slot] !== undefined &&
      componentsOf(platform, slot, state.framework).length > 1 &&
      componentsOf(platform, slot, to).length > 1 &&
      componentLabel(platform, slot, state.components[slot]) !==
        componentLabel(platform, slot, after[slot]),
  );
  return {
    name: `${FRAMEWORKS[to].label} に作り直す`,
    meta: [
      `手間 ${required}（毎月 ${Math.min(per, room)} を取る）`,
      Number.isFinite(months) ? `約 ${months} か月` : '今は進められない',
      '機能開発がほぼ止まる',
    ],
    detail:
      `アプリを ${FRAMEWORKS[to].label} で作り直す（事業者はそのまま）。作業の間は今のアプリのまま動き、` +
      `手間を入れ終えた翌月から新しいフレームワークの費用・満足度（SNS のカード・初回表示・鮮度）になる。` +
      `毎月の手間のうち最大 ${per} を作り直しに回すので、その間の機能開発はほぼ止まる（満足度の「機能」が下がる）。` +
      `構成の乗り換え・部品の差し替えとは同時に進められない。新しいフレームワークで選べない部品は既定に戻り、` +
      `API の置き場は同じ事業者に置ける選択肢があれば維持する。` +
      (lost.length
        ? `替わる部品: ${lost
            .map(
              (slot) =>
                `${SLOT_LABELS[slot]}（${componentLabel(platform, slot, state.components[slot])} → ${componentLabel(platform, slot, after[slot])}）`,
            )
            .join('・')}。`
        : '') +
      (months > left ? `残り ${left} か月では済まない見込み。` : '') +
      `手間の大きさはゲーム上の仮定。`,
  };
}

/**
 * 構成ごとの維持の手間（毎月）。自前運用（VPS）はシナリオの値、自分で組む構成（OpenNext）は EFFORT.assembledUpkeep、
 * コンテナで動かすマネージド（Cloud Run）は EFFORT.containerUpkeep、それ以外のマネージドなら 0。始める画面の手間のバーにも使う（D-36・D-63）。
 */
export function upkeepOf(
  sc: Scenario,
  stackIndex: number,
  /** 部品（VPS を部品として使うときも自前運用の維持がかかる。D-67）。省略は構成の既定。 */
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
  standby: Choices = {},
): number {
  const s = STACKS[stackIndex]!;
  // 自前で取るバックアップ（VPS の DB のダンプ・バイナリログ。D-93）は、構成の維持に足す
  const backup = selfBackupOf(stackIndex, components, framework)
    ? EFFORT.selfBackup.upkeep
    : 0;
  return (
    backup +
    (selfHostedOf(stackIndex, components, framework, standby)
      ? sc.effort.selfHostedUpkeep
      : s.assembled
        ? EFFORT.assembledUpkeep
        : s.containerized
          ? EFFORT.containerUpkeep
          : 0)
  );
}

const accountUpkeepFor = (
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
) => accountUpkeepOf(state.stackIndex, state.components, state.framework);

/**
 * 動いている構成（乗り換え中は新旧両方）の維持の手間。両方が自前運用でも 1 回分。今の構成は部品（差し替えの途中の新しい部品を含む）
 * で VPS を使うときも自前運用（D-67）。乗り換え先は既定の部品から始まる。
 */
function upkeepFor(
  state: Pick<
    GameState,
    | 'stackIndex'
    | 'migration'
    | 'scenario'
    | 'components'
    | 'framework'
    | 'componentSwap'
  >,
) {
  const sc = scenarioOf(state);
  const swap = state.componentSwap;
  return Math.max(
    upkeepOf(
      sc,
      state.stackIndex,
      state.components,
      state.framework,
      swap ? { [swap.slot]: swap.option } : {},
    ),
    ...(state.migration
      ? [
          upkeepOf(
            sc,
            state.migration.to,
            frameworkDefaults(
              state.framework,
              STACKS[state.migration.to]!.provider,
              sc,
            ),
            state.framework,
          ),
        ]
      : []),
  );
}

function migrationWanted(m: Migration | null): number {
  return m ? Math.min(EFFORT.migrationPerMonth, m.required - m.done) : 0;
}

function swapWanted(s: ComponentSwap | null): number {
  return s ? Math.min(EFFORT.dbSwap.perMonth, s.required - s.done) : 0;
}

/** 作り直しに必要な手間の合計（ゲーム上の仮定。D-81）。 */
export function rewriteEffort(): number {
  return EFFORT.rewrite.perMonth * EFFORT.rewrite.months;
}

/**
 * 作り直しに今月入れる手間（D-81）。月あたり EFFORT.rewrite.perMonth まで、維持・出来事への対応・機能の追加の作業・
 * 予定した行動の残りをすべて取る（維持の手間がある構成では月あたりが減り、そのぶん長くかかる）。
 */
function rewriteWanted(
  state: Pick<
    GameState,
    | 'rewrite'
    | 'effortPerMonth'
    | 'plannedEffort'
    | 'interrupts'
    | 'stackIndex'
    | 'migration'
    | 'scenario'
    | 'components'
    | 'framework'
    | 'componentSwap'
  >,
): number {
  const w = state.rewrite;
  if (!w) return 0;
  const room =
    state.effortPerMonth -
    upkeepFor(state) -
    accountUpkeepFor(state) -
    interruptOf(state) -
    featureWorkOf(state) -
    state.plannedEffort;
  return Math.max(
    0,
    Math.min(EFFORT.rewrite.perMonth, w.required - w.done, room),
  );
}

const interruptOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && !i.featureWork ? i.points : 0),
    0,
  );
const featureWorkOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? i.points : 0),
    0,
  );
const featureBonusOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? (i.bonus ?? 0) : 0),
    0,
  );

/** 次の月に、まだ行動に使える手間。 */
export function effortAvailable(state: GameState): number {
  return (
    state.effortPerMonth -
    upkeepFor(state) -
    accountUpkeepFor(state) -
    interruptOf(state) -
    featureWorkOf(state) -
    migrationWanted(state.migration) -
    swapWanted(state.componentSwap) -
    rewriteWanted(state) -
    state.plannedEffort
  );
}

/** 次の月の SSR の CPU（今月までの機能開発で重くなった分を含む）。 */
export function nextSsrCpuMs(state: GameState): number {
  return effectiveSsrCpuMs(
    baseSsrCpuMsOf(scenarioOf(state)),
    state.settings.ssrOptimizations,
    state.featurePoints,
  );
}

/** 今の状態で要る効果（再検証がすでにオンデマンドなら、切り替えの作業を除く。D-49）。 */
function effectsFor(
  state: Pick<GameState, 'framework' | 'settings'>,
  effects: readonly Effect[],
): Effect[] {
  const already = state.framework !== 'vite-spa' && isOnDemand(state.settings);
  return effects.filter(
    (e) => !(e.type === 'interrupt' && e.unlessOnDemand && already),
  );
}

const acceptEffort = (def: EventDef, state: GameState) =>
  effectsFor(state, def.accept?.effects ?? []).reduce(
    (a, e) =>
      a +
      (e.type === 'interrupt'
        ? e.points
        : e.type === 'imageRedesign'
          ? imageRedesignEffort(state)
          : 0),
    0,
  );

/**
 * 記事のデザインの刷新を受ける手間（D-47・ゲーム上の仮定）。原本を配っている（最適化しない）なら 0、
 * 一律で縮めて原本が無いなら 2（これからの投稿だけ大きくする作業）、原本があるなら 1。
 */
function imageRedesignEffort(state: GameState): number {
  const images = imagesOf(state);
  // 今の部品が原本を配っていても、一律で縮めて置いた原本の無い画像が多く残っていれば、一律で縮めた構成と同じ（OCL-0A3AC32F）
  if (images === 'none') return hasManyCoarseImages(state) ? 2 : 0;
  return images === 'resize' ? 2 : 1;
}

/**
 * 一律で縮めて置いた原本の無い画像が、在庫の coarseShare 以上残っているか（D-47）。部品を替えても、
 * それまでに縮めて置いた画像は大きくできない（OCL-0A3AC32F）。
 */
function hasManyCoarseImages(state: GameState): boolean {
  const rule = scenarioOf(state).imageRedesign;
  if (!rule || state.stock.images <= 0) return false;
  return (state.coarseImages ?? 0) / state.stock.images >= rule.coarseShare;
}

/** 記事のデザインの刷新の提案の id（D-47）。 */
export const IMAGE_REDESIGN_ID = 'p-image-redesign';

/**
 * 記事のデザインの刷新で、今月の画質を 1 段下げる理由（下げないなら undefined。D-47・ゲーム上の仮定）。
 * 断った: 断った後の declineMonths か月（原本を配っている構成は画像が既に大きいので下げない）。
 * 受けた: 原本の無い粗い画像が在庫の coarseShare 以上ある間。
 */
function imageRedesignQuality(
  state: GameState,
  sc: Scenario,
  month: number,
  images: string | undefined,
): string | undefined {
  const rule = sc.imageRedesign;
  if (!rule) return undefined;
  const res = state.responses[IMAGE_REDESIGN_ID];
  const at = state.schedule.find((x) => x.id === IMAGE_REDESIGN_ID)?.month;
  if (
    res === 'declined' &&
    at !== undefined &&
    // 原本を配っている構成は既に大きいので下げない。ただし原本の無い画像が多く残っていれば下げる（OCL-0A3AC32F）
    (images !== 'none' || hasManyCoarseImages(state)) &&
    month > at &&
    month <= at + rule.declineMonths
  )
    return '記事のデザインの刷新を断った（大きな画面で画像が小さく粗く見える）';
  if (state.imageRedesign && state.stock.images > 0) {
    const share = state.imageRedesign.coarseImages / state.stock.images;
    if (share >= rule.coarseShare)
      return `原本の無い粗い画像が在庫の ${Math.round(share * 100)}%（一律で縮めて置いた画像は、後から大きくできない）`;
  }
  return undefined;
}

/**
 * 設定が今の部品では効かない理由（効くなら undefined）。画像のサイズ違いは、最適化しない・一律で縮めて置く部品では
 * 作らない（1 種を配る）ので効かない（D-47）。画面は選択肢を無効にしてこの文を出す。
 */
export function settingInactiveReason(
  state: GameState,
  key: SettingKey,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  const images = imagesOf(state);
  const raw = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  // 原本をそのまま配るので、形式は変わらない（D-58）
  if (key === 'format')
    return images === 'none'
      ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なので原本の形式のまま配る`
      : undefined;
  if (key !== 'variants') return undefined;
  return images === 'none' || images === 'resize'
    ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なのでサイズ違いは作らない（1 種）`
    : undefined;
}

/**
 * 設定の今の効き方の注記（効かないわけではないが、選んだ値どおりにならないとき）。Next.js の画像の部品は JPEG を選んでも
 * WebP で配る（formats の既定。D-58）。
 */
export function settingNote(
  state: GameState,
  key: SettingKey,
): string | undefined {
  if (key !== 'format') return undefined;
  const platform = STACKS[state.stackIndex]!.provider;
  const images = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  if (usesNextImage(platform, state.framework, images))
    return 'Next.js の画像の部品は、ブラウザに合わせて既定で WebP を配る（JPEG を選んでも WebP）';
  if (astroImage(platform, state.framework, images))
    return 'Astro の画像の部品（<Image />）は既定で WebP を作る（JPEG を選んでも WebP）';
  return autoImageFormat(platform, state.framework, images)
    ? 'Cloudflare Images の閲覧のときの変換は、ブラウザに合わせた形式（format=auto）で配る（JPEG を選んでも WebP とみなす）'
    : undefined;
}

/**
 * ページの部品の今の効き方の注記（D-109）。コメント欄を記事のページに含めているときだけ（commentsNote）。
 */
export function routePartNote(
  state: GameState,
  part: RoutePartKey,
): string | undefined {
  return part === 'comments' ? commentsNote(state) : undefined;
}

/**
 * コメントを記事のページに含めているときの効き方の注記（D-82）。作り直しが増えるのは、更新のたびに作り直すとき
 * （オンデマンドの再検証・更新のたびのビルド）。時間の再検証は更新の数に依らないので増えず、間隔でまとめるビルドも
 * 間隔の数までしか増えない。どちらもコメントは間隔の分だけ遅れて見え、鮮度の判定に入る（D-85）。
 */
function commentsNote(state: GameState): string | undefined {
  const sc = scenarioOf(state);
  if (
    !commentsInPage(
      commentsOf(sc, state.routeParts),
      state.framework,
      sc,
      state.routes,
    )
  )
    return undefined;
  const fam = articleFamily(state);
  const rebuilds =
    fam !== undefined ? fam === 'static' : rebuildsStaticPages(state.framework);
  if (fam === 'ssr' || (!rebuilds && isrCacheOf(state) === 'none'))
    return 'ISR のキャッシュを使わない（毎回描く）ので、作り直しは増えない';
  if (isOnDemand(state.settings))
    return rebuilds
      ? 'コメントの投稿のたびにビルドし直す（コメントはビルドの時間の分だけ遅れて見える）'
      : state.framework === 'astro'
        ? 'コメントの投稿のたびに記事のページのキャッシュを消す（描き直しが増える）'
        : 'コメントの投稿のたびに記事のページを再検証する（再生成・CDN の無効化が増える）';
  return rebuilds
    ? `ビルドは間隔（${optionLabel('buildInterval', state.settings.revalidateSec)}）でまとめるので、回数は間隔の数までしか増えない。コメントは間隔とビルドの時間の分だけ遅れて見え、鮮度が下がる`
    : state.framework === 'astro'
      ? `記事のキャッシュが時間（${optionLabel('pageCache', state.settings.revalidateSec)}）なので、描き直しの回数は増えない。コメントはその分遅れて見え、鮮度が下がる`
      : `ISR の再検証が時間（${optionLabel('isr', state.settings.revalidateSec)}）なので、作り直しの回数は増えない。コメントはその分遅れて見え、鮮度が下がる`;
}

/** ISR のキャッシュの部品（Next.js）。Astro は事業者で決まる置き場で、キャッシュしない形は無い（D-103）。 */
function isrCacheOf(state: GameState): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  if (state.framework === 'astro') return astroPageCacheChoice(platform);
  return { ...DEFAULT_CHOICES[platform], ...state.components }.isrCache;
}

/** 状態の画像の部品で、1 ページの通信量の表示（画像の部品の ⓘ に使う）。 */
export function pageWeightOf(state: GameState, images?: string): string {
  const platform = STACKS[state.stackIndex]!.provider;
  const opt =
    images !== undefined ? imagesBehavior(platform, images) : imagesOf(state);
  return pageWeightLabel(
    pageWeightKB(
      scenarioOf(state),
      state.settings,
      state.mods,
      opt,
      autoImageFormat(platform, state.framework, opt),
    ),
  );
}

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
    return ng('not-playing', 'ゲームは終わっている');
  const busy = state.migration
    ? ng('busy', '乗り換えの最中は選べない')
    : state.componentSwap
      ? ng('busy', `${swapLabel(state.componentSwap.slot)}の最中は選べない`)
      : null;
  // 作り直しの最中は、乗り換え・部品の差し替え・別の作り直しを選べない（済むと部品が新しいフレームワークの選択に替わるため。
  // 同じ事業者のプラン変更・ストレージ変更オプションは選べる。D-81）
  const rewriting = state.rewrite
    ? ng(
        'busy',
        `${FRAMEWORKS[state.rewrite.to].label} への作り直しの最中は選べない`,
      )
    : null;
  switch (action.type) {
    case 'none':
      return ok(0);
    case 'set': {
      const def = SETTINGS[action.key];
      if (!def || !def.options.some((o) => o.value === action.value))
        return ng('invalid', '選択肢に無い');
      if (hiddenSettings(state).includes(action.key))
        return ng(
          'unavailable',
          action.key === 'isr' ||
            action.key === 'apiCacheTtl' ||
            action.key === 'buildInterval' ||
            action.key === 'pageCache'
            ? articleFamily(state) === 'ssr' ||
              (articleFamily(state) === 'api' && state.framework !== 'vite-spa')
              ? '記事のページをキャッシュしない描き方では効かない'
              : `${FRAMEWORKS[state.framework].label} では「${SETTINGS[revalidateSettingOf(state.framework, articleFamily(state))].label}」で選ぶ`
            : 'このシナリオでは効かない',
        );
      if (state.settings[def.field] === action.value)
        return ng('same', '今と同じ（または選択済み）');
      const inactive = settingInactiveReason(state, action.key);
      if (inactive) return ng('unavailable', inactive);
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
            `SSR の CPU は ${EFFORT.minSsrCpuMs} ms より下げられない`,
          );
    case 'plan':
    case 'migrate': {
      if (busy) return busy;
      if (action.type === 'migrate' && rewriting) return rewriting;
      if (!STACKS[action.stackIndex]) return ng('invalid', '構成が無い');
      if (action.stackIndex === state.stackIndex)
        return ng('same', '今の構成と同じ');
      if (!stackSupports(action.stackIndex, state.framework))
        return ng(
          'unavailable',
          `${FRAMEWORKS[state.framework].label} を載せる公式のアダプターが無い`,
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
            `年額のままの変更の前払い $${due.toFixed(2)} が所持金より多い`,
          );
      }
      // 乗り換えの手間は進行中の月ごとに取る（effortAvailable が減る）
      return ok(plan ? planChangeEffort(state.stackIndex) : 0);
    }
    case 'respond': {
      const def = eventDef(scenarioOf(state), action.eventId);
      if (!def?.accept) return ng('invalid', '提案が無い');
      if (!state.pendingProposals.includes(action.eventId))
        return ng('same', 'すでに返事をした');
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
        return ng('same', 'すでに付けている（戻せない）');
      return ok(EFFORT.storageOption);
    }
    case 'block-bots':
      return state.botBlocked
        ? ng('same', 'すでに入れている')
        : ok(BOT_BLOCK.effort);
    case 'commit': {
      const def = commitmentDef(action.key);
      if (!def) return ng('invalid', '確約が無い');
      if (!def.commitment.payments.some((p) => p.payment === action.payment))
        return ng('invalid', 'この確約に無い支払いの形');
      const cur = activeCommitments(state).find((c) => c.key === action.key);
      if (cur)
        return ng(
          'same',
          `すでに結んでいる（${cur.endMonth} か月目まで・取り消せない）`,
        );
      const offer = commitmentOffers(state).find(
        (o) => o.key === action.key && o.payment === action.payment,
      );
      if (!offer)
        return ng(
          'unavailable',
          '今月は対象の使用が無い（対象のサービスを使っている構成で結べる）',
        );
      // 同じ月に選んだほかの前払い（確約・年額のスケールアップの差額）も来月に払うので、合わせて所持金と比べる
      const reserved = pendingUpfrontUsd(state);
      if (offer.usd.upfront + reserved > state.cash)
        return ng(
          'limit',
          `前払い $${offer.usd.upfront.toFixed(2)}${reserved > 0 ? `（今月選んだ前払い $${reserved.toFixed(2)} と合わせて）` : ''} が所持金より多い`,
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
        return ng('invalid', '描き方に無い');
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
      })[r.id]!.strategy;
      if (strategyFamily(now) === strategyFamily(action.strategy))
        return ng(
          'same',
          strategyFamily(now) === 'cached'
            ? '期限とオンデマンドは設定で替える'
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
        return ng('invalid', '選択肢に無い');
      const r = publicRoute(sc);
      if (!r || r.id !== action.route || sc.comments === undefined)
        return ng('unavailable', 'このページには無い部品');
      if (!commentsChoosable(state.framework, sc, state.routes))
        return ng(
          'unavailable',
          state.framework === 'vite-spa'
            ? 'SPA には記事のページが無い（コメントはブラウザで読み込む）'
            : '記事のページが枠 + API なので、コメントを含める HTML が無い（コメントはブラウザで読み込む）',
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
      if (!opt) return ng('invalid', 'この事業者の部品に無い');
      const current = { ...DEFAULT_CHOICES[platform], ...state.components };
      if (current[action.slot] === action.option)
        return ng('same', '今の部品（または選択済み）');
      // チャットを受けたあとはリアルタイムを外せない
      if (action.slot === 'realtime' && state.mods.realtime)
        return ng('irreversible', 'チャットを受けたので外せない');
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
          return ng('via-proposal', `提案「${via.title}」を受けると付く`);
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

function newRewrite(
  state: Pick<GameState, 'framework'>,
  to: FrameworkId,
): Rewrite {
  return { from: state.framework, to, required: rewriteEffort(), done: 0 };
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
  const short = (need: number) => ng('effort', `手間が足りない: あと ${need}`);
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
  // 作り直しは残りの手間をすべて取れる（月あたりの上限まで）。今月 1 も回せないときだけ選べない
  if (
    action.type === 'rewrite' &&
    rewriteWanted({
      ...state,
      rewrite: newRewrite(state, action.framework),
    }) <= 0
  )
    return ng('effort', '作り直しに回せる手間が残っていない');
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

/** 部品の選択肢（今の事業者のスロットごと）と、今の部品。画面の「部品」の欄に使う。 */
export function componentSlots(state: GameState): {
  slot: SlotId;
  label: string;
  current: string;
  options: ReturnType<typeof componentsOf>;
}[] {
  const platform = STACKS[state.stackIndex]!.provider;
  const current = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(state.framework, platform, scenarioOf(state)),
    ...state.components,
  };
  return (Object.keys(SLOT_LABELS) as SlotId[])
    .map((slot) => ({
      slot,
      label: SLOT_LABELS[slot],
      current: current[slot] ?? '',
      options: componentsOf(platform, slot, state.framework),
    }))
    .filter(
      (x) =>
        x.options.length > 1 &&
        // このシナリオで効かないスロットは出さない（D-33・prd/09 E-6）。メールを送らないシナリオのメール送信も（D-101）
        !scenarioOf(state).hidden?.slots?.includes(x.slot) &&
        (x.slot !== 'email' || scenarioSendsEmail(scenarioOf(state))) &&
        // 今の選択で効かないスロット（API を他の事業者に置いたときの DB。D-65）
        !slotIneffective(x.slot, current, {
          stackIndex: state.stackIndex,
          framework: state.framework,
        }),
    );
}

// ---- 始める画面の部品の選択（D-45）----

/** 始める画面の部品の選択肢（files は構成が暗黙に持つファイルの置き場。catalog の fileStorageOf）。 */
export type SetupOption = {
  id: string;
  platform: ComponentProvider;
  slot: SlotId | 'files';
  label: string;
  note: string;
};

export type SetupSlot = {
  slot: SlotId | 'files';
  label: string;
  options: SetupOption[];
  /** この構成では 1 択（変更できない。未選択の判定に含めない）。 */
  fixed: boolean;
};

/**
 * 始める画面の部品のスロット（構成・フレームワークの組み合わせで）。ゲーム中の部品の欄（componentSlots）と同じ
 * スロットから、提案で付く部品（チャットの Durable Objects など）を除く。選択肢が 1 つしか残らないスロットは「固定」として出す。
 * 最後に、構成が暗黙に持つファイルの置き場（R2・VPS のディスクなど。構成のノードから引く）を固定のスロットとして足す。
 * スロットの一覧は持たず、catalog の部品の定義から引く（スロットが増えても追従する）。
 */
export function setupSlots(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  /** 選んだ部品（今の選択で効かないスロットを出さないために使う。API を他の事業者に置いたときの DB。D-65）。 */
  choices: Choices = {},
): SetupSlot[] {
  const fresh = newGame(stackIndex, 0, scenario, DEFAULT_START_DATE, framework);
  const draft = {
    ...fresh,
    components: { ...fresh.components, ...choices },
  };
  const slots: SetupSlot[] = componentSlots(draft).map(
    ({ slot, label, options }) => {
      const usable = options.filter(
        (o) => !proposalOnlyComponent(scenario, slot, o.id),
      );
      return { slot, label, options: usable, fixed: usable.length < 2 };
    },
  );
  const files = fileStorageOf(STACKS[stackIndex]!.id);
  if (files)
    slots.push({
      slot: 'files',
      label: FILE_STORAGE_LABEL,
      options: [{ ...files, slot: 'files' }],
      fixed: true,
    });
  return slots.filter((x) => x.options.length > 0);
}

/** 選ぶスロット（固定でないもの）。 */
const choosable = (slots: SetupSlot[]) =>
  slots.filter(
    (x): x is SetupSlot & { slot: SlotId } => !x.fixed && x.slot !== 'files',
  );

/** 選んだ部品のうち、その組み合わせで選べるものだけを残す（構成・フレームワークを替えたとき）。 */
export function validSetupChoices(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices,
): Choices {
  const out: Choices = {};
  // 選んだ部品で効くスロットを見る（DB で決まる DB のバックアップ。D-93）
  const slots = choosable(setupSlots(scenario, stackIndex, framework, choices));
  for (const x of slots) {
    const v = choices[x.slot];
    if (v !== undefined && x.options.some((o) => o.id === v)) out[x.slot] = v;
  }
  // 依存の崩れた選択（前段の CDN を外したのに残っている API のキャッシュなど）は外す。
  // 頼る側（後ろのスロット）から見るので、頼られる側（前段の CDN）の選択は残る
  const platform = STACKS[stackIndex]!.provider;
  for (const x of [...slots].reverse()) {
    const v = out[x.slot];
    if (
      v !== undefined &&
      componentConflict(platform, x.slot, v, out, framework)
    )
      delete out[x.slot];
  }
  return out;
}

/** サーバーが HTML の一部として作る区画の作られ方（S6 では枠になる。D-108）。 */
const HTML_SOURCES: readonly RegionSource[] = ['build', 'isr', 'cached', 'ssr'];

/** 描き方を替えた区画の作られ方（借りる図が無いとき。HTML の本体の区画だけを替え、API・アイランド・画像はそのまま）。 */
function retagSource(src: RegionSource, s: RouteStrategyId): RegionSource {
  if (src !== 'build' && src !== 'isr' && src !== 'cached' && src !== 'ssr')
    return src;
  switch (strategyFamily(s)) {
    case 'static':
      return 'build';
    case 'cached':
      return s === 'cached-purge' ? 'cached' : 'isr';
    case 'ssr':
      return 'ssr';
    case 'api':
      return 'api';
    default:
      return src;
  }
}

/** 見取り図の区画に、選んだフレームワークでの作られ方を付けたもの（D-102）。 */
export type ResolvedRegion = WireframeRegion & { source: RegionSource };

/**
 * 始める画面のページの見取り図（D-102）。シナリオの wireframes を、選んだフレームワークとコメントの描き方（D-82）で解く。
 * ページの名前はテンプレートのルートの label。comments は始める画面で選べるときだけ渡す（省略はブラウザで読み込む）。
 */
export function pageWireframes(
  sc: Scenario,
  framework: FrameworkId,
  comments?: number,
  /** 選んだページごとの描き方（D-107）。既定と違うページは、その描き方を既定に持つフレームワークの図を借りる。 */
  routes?: RouteOverrides,
): {
  route: string;
  label: string;
  regions: ResolvedRegion[];
  badges: PageBadge[];
}[] {
  const tpl = sc.template(1).routes;
  const inPage = commentsInPage(
    comments ?? COMMENTS_IN_BROWSER,
    framework,
    sc,
    routes,
  );
  return (sc.text?.wireframes ?? []).map((w) => {
    const r = tpl.find((x) => x.id === w.route);
    const chosen = routes?.[w.route];
    const audience = r ? routeAudienceOf(sc, r) : 'public';
    // 図を借りるフレームワーク: 選んだ描き方を既定に持つもの（記事の S1 は静的書き出し・個人向けの S5 は静的書き出しなど）
    const donor =
      chosen === undefined
        ? framework
        : // SPA の図（1 つのシェル）より、ページごとの HTML を持つフレームワークの図を先に借りる
          ([...frameworksOf(sc).allowed]
            .sort((a, b) => Number(a === 'vite-spa') - Number(b === 'vite-spa'))
            .find(
              (f) =>
                strategyFamily(FRAMEWORK_PRESETS[f][audience]) ===
                strategyFamily(chosen),
            ) ?? framework);
    // 借りる先が無い（記事を毎回描く S4 など）は、作られ方を描き方で置き換える
    const own = w.byFramework[donor];
    // 記事ごとの枠（全員に同じ中身のページの S5。D-109）は、枠（ビルド）と API の中身に分けた図
    const perPage =
      chosen !== undefined &&
      audience === 'public' &&
      strategyFamily(chosen) === 'api' &&
      perPageShellFramework(framework)
        ? w.shellPerPage
        : undefined;
    const base = perPage
      ? perPage.sources
      : chosen !== undefined && donor === framework
        ? Object.fromEntries(
            Object.entries(own).map(([id, src]) => [
              id,
              retagSource(src, chosen),
            ]),
          )
        : own;
    const sources = {
      ...base,
      ...(inPage ? w.commentsInPage?.[donor] : undefined),
    };
    // 枠 + サーバーの島（S6。D-108）: 人ごとに違う区画は島、ほかの HTML の区画は枠（API・画像の区画はそのまま）
    const islands =
      chosen !== undefined && strategyFamily(chosen) === 'island'
        ? new Set(w.islandRegions ?? [])
        : undefined;
    const sourceOf = (id: string): RegionSource => {
      const src = sources[id] ?? 'ssr';
      if (!islands) return src;
      if (islands.has(id)) return 'server-island';
      return HTML_SOURCES.includes(src) ? 'island-shell' : src;
    };
    return {
      route: w.route,
      label: r?.label ?? w.route,
      regions: w.regions.map((r) => ({
        ...r,
        source: sourceOf(r.id),
      })),
      badges: islands
        ? [
            {
              kind: 'cpu' as const,
              text:
                framework === 'astro'
                  ? 'CPU: 島の分だけ閲覧ごとに描く（島は別のリクエスト・枠はキャッシュ）'
                  : 'CPU: 島の分だけ閲覧ごとに描く（同じ応答の中で続けて流す）',
            },
          ]
        : (perPage?.badges ?? w.badges?.[donor] ?? []),
    };
  });
}

/**
 * 描き方の表の 1 行の、ほかの描き方（D-106・D-107）。available: この事業者・今の部品で選べるか。reason は使えない理由か条件。
 * value: 選ぶときに一緒に替える revalidateSec（S3 はオンデマンド、S3 から S2 は 5 分。省略は今の値のまま）。
 */
export type RouteAlternative = {
  strategy: RouteStrategyId;
  label: string;
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
  /** 描き方の名前（S 番号つき）。 */
  strategyLabel: string;
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
  /** ページの部品の選択（記事のページのコメント欄。D-109）。 */
  routeParts?: RouteParts | undefined;
};

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
      : validRouteOverrides(sc, to.stackIndex, to.framework, chosen);
  const before = routeChoices(sc, tpl, { ...from, platform: fromPlatform });
  const after = routeChoices(sc, tpl, {
    ...to,
    platform: toPlatform,
    routes: kept,
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
              `${f.label}は ${ROUTE_STRATEGIES[f.from].code} → ${ROUTE_STRATEGIES[f.to].code}（既定）`,
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
  >,
): RoutePlanInput => ({
  framework: state.framework,
  stackIndex: state.stackIndex,
  settings: state.settings,
  components: state.components,
  routes: state.routes,
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
    const preset = defaultStrategy(p.framework, platform, audience);
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
          ? `選んだ描き方（${FRAMEWORKS[p.framework].label} の既定は ${ROUTE_STRATEGIES[preset].code} ${ROUTE_STRATEGIES[preset].label}）`
          : choice.strategy === 'ssr'
            ? `${SLOT_LABELS.isrCache}の部品が「キャッシュしない」`
            : undefined;
    const alternatives = ROUTE_STRATEGY_ORDER.filter(
      (s) => s !== choice.strategy,
    ).flatMap((s): RouteAlternative[] => {
      const x = strategySupport(p.framework, platform, audience, s);
      if (x.support === 'unverified') return [];
      const d = ROUTE_STRATEGIES[s];
      // 部品で決まるもの（Next.js の S3）は、今の部品で消せるか（onDemandBlocker）で判定する
      const blocked =
        x.support === 'depends' && s === 'cached-purge' ? blocker : undefined;
      const value =
        s === 'cached-purge'
          ? ON_DEMAND_REVALIDATE
          : s === 'cached-ttl' && isOnDemand(p.settings)
            ? DEFAULT_REVALIDATE_SEC
            : undefined;
      return [
        {
          strategy: s,
          label: d.label,
          code: d.code,
          available:
            strategySelectable(p.framework, platform, audience, s) &&
            blocked === undefined,
          reason: blocked
            ? `${blocked.label}: ${blocked.reason}`
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
      strategyLabel: def.label,
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
  >,
): RoutePlanRow[] {
  return routePlanRows(state.scenario, state);
}

/** 表の行の要件の判定（D-107。始める画面の 1 か月目の見込みと同じ組み立て）。 */
export type RouteRowStatus = {
  route: string;
  /** 鮮度（全員に同じ中身のページだけ。1 か月目の満足度の判定）。 */
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
 * 1 か月目の基準の PV で、setupMonthOneEstimate（費用・止まる前提）と playMonth の 1 か月目（鮮度）を引く。出来事・乱数は含めない目安。
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
          state.framework,
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
                '更新はすぐ・間隔の内に見える',
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
                    text: 'HTML に中身が無いので、記事ごとの SNS のカードが出ない（話題の伸びが減る）',
                  }
                : { ok: true, text: '記事ごとの SNS のカードは HTML に入る' },
          }
        : {}),
      cpu: cpuHit.length
        ? { ok: false, text: cpuHit.map((b) => b.detail ?? b.text).join('・') }
        : { ok: true },
      deltas,
    };
  });
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

/** 始められない理由（まだ選んでいないスロット）。選び終えていれば null。 */
export function setupProblem(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices,
): string | null {
  const missing = choosable(
    setupSlots(scenario, stackIndex, framework, choices),
  ).filter((x) => !x.options.some((o) => o.id === choices[x.slot]));
  return missing.length
    ? `部品をまだ選んでいない: ${missing.map((x) => x.label).join('・')}`
    : null;
}

/**
 * 部品の差し替えの手間の説明（DB は進行中の月ごと）。state と option を渡すと、新しい事業者のアカウントが増える部品の
 * 一度きりの手間と毎月の維持を添える（D-52）。
 */
export function componentEffortLabel(
  slot: SlotId,
  state?: Pick<GameState, 'stackIndex' | 'components' | 'framework'> & {
    scenario?: Scenario;
  },
  option?: string,
): string[] {
  const added =
    state && option !== undefined ? newAccountsBy(state, slot, option) : [];
  const setup = added.length > 0 ? EFFORT.accountSetup : 0;
  // 部品で VPS を使い始める（VPS の API。D-67）と、自前運用の維持と偶発的な障害が加わる
  const selfHosting =
    state?.scenario &&
    option !== undefined &&
    !selfHostedOf(state.stackIndex, state.components, state.framework) &&
    selfHostedOf(
      state.stackIndex,
      { ...state.components, [slot]: option },
      state.framework,
    )
      ? [
          `自前運用になる（毎月の維持 ${state.scenario.effort.selfHostedUpkeep}・自前の障害 月 ${Math.round(state.scenario.incidents.selfHostedChancePerMonth * 100)}%）`,
        ]
      : [];
  const cross = [
    ...(added.length > 0
      ? [
          `${added.map(accountLabel).join('・')} のアカウントが増える（毎月の維持 ${EFFORT.accountUpkeep * added.length}）`,
        ]
      : []),
    ...selfHosting,
  ];
  return isDataSwap(slot)
    ? [
        `${EFFORT.dbSwap.perMonth} × ${EFFORT.dbSwap.months} か月${setup ? ` + 手間 ${setup}` : ''}`,
        '期間中は新旧両方の費用',
        ...cross,
      ]
    : [
        `手間 ${(state && option !== undefined ? componentBaseEffort(state, slot, option) : EFFORT.component[slot]) + setup}${setup ? `（他の事業者の設定 ${setup} を含む）` : ''}`,
        '来月から',
        ...(state && option !== undefined && selfBackupBy(state, slot, option)
          ? [
              `自前のバックアップの維持（毎月の手間 ${EFFORT.selfBackup.upkeep}）`,
            ]
          : []),
        ...cross,
      ];
}

/** その部品に替えると、自前で取るバックアップ（VPS）になるか（D-93）。 */
function selfBackupBy(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: SlotId,
  option: string,
): boolean {
  return (
    slot === 'dbBackup' &&
    selfBackupOf(
      state.stackIndex,
      { ...state.components, [slot]: option },
      state.framework,
    )
  );
}

/** 部品の差し替えの一度きりの手間（他の事業者の設定を除く）。VPS の自前のバックアップは仕組みを作る手間（D-93）。 */
function componentBaseEffort(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: Exclude<SlotId, 'db' | 'api'>,
  option: string,
): number {
  return selfBackupBy(state, slot, option)
    ? EFFORT.selfBackup.setup
    : EFFORT.component[slot];
}

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
    ),
    books: bk,
  });
  return r.bill.lines.filter(
    (l) => l.priceRef.meterId === INVALIDATION_METER && (l.quantity ?? 0) > 0,
  );
}

const INVALIDATION_METER = 'invalidation-paths';

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
    ),
    books: booksAt(state, 1),
  });
  const costUsd = toUsd(r.bill.totals);
  const loss = scenario.revenue.loss;
  const hit = (e: string[]) =>
    r.premises.some((p) => p.hit && e.includes(p.effect));
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
    blocking: r.premises
      .filter(
        (p) =>
          p.hit &&
          (p.effect === 'block' ||
            p.effect === 'upgrade-required' ||
            p.effect === 'throttle'),
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

export function newGame(
  stackIndex: number,
  seed = 42,
  scenario: Scenario = ARTICLE_COMMUNITY,
  startDate: string = DEFAULT_START_DATE,
  /** アプリのフレームワーク（省略はシナリオの既定。シナリオで選べないものは既定にする。prd/10 F-04）。 */
  framework?: FrameworkId,
  /** 始める画面で選んだ部品（D-45）。選べないものは捨て、省略したスロットは既定の部品。 */
  components?: Choices,
  /** 始める画面で選んだ ISR の再検証（D-49。秒・オンデマンドは 0）。選べないもの・省略は既定（defaultRevalidateSec。Astro はオンデマンド）。 */
  revalidateSec?: number,
  /**
   * 始める画面で選んだページの部品（記事のページのコメント欄。D-82・D-109）。選べないもの・省略は既定（ブラウザで読み込む）。
   */
  routeParts?: RouteParts,
  /** 始める画面で結んだ確約（D-97。setupCommitments にあるものだけ。1 か月目から 12 か月）。 */
  commitments?: readonly { key: string; payment: CommitmentPaymentId }[],
  /** 始める画面で選んだページごとの描き方（D-107）。選べないものは捨て、省略はフレームワークの既定。 */
  routes?: RouteOverrides,
): GameState {
  const fw = frameworksOf(scenario);
  // 載せられない構成（Astro × AWS など）では既定のフレームワークにする（画面では選べない。D-68）
  const app =
    framework !== undefined &&
    fw.allowed.includes(framework) &&
    stackSupports(stackIndex, framework)
      ? framework
      : fw.default;
  const chosen = components
    ? validSetupChoices(scenario, stackIndex, app, components)
    : {};
  const chosenRoutes = routes
    ? validRouteOverrides(scenario, stackIndex, app, routes)
    : {};
  const hasRoutes = Object.keys(chosenRoutes).length > 0;
  const comments = commentsOf(scenario, routeParts);
  const chosenParts = setupCommentOptions(scenario, app, chosenRoutes).some(
    (o) => o.value === comments,
  )
    ? withComments(scenario, undefined, comments)
    : {};
  return {
    startDate,
    ...(hasRoutes ? { routes: chosenRoutes } : {}),
    ...(Object.keys(chosenParts).length > 0 ? { routeParts: chosenParts } : {}),
    revisions: rollRevisions(scenario, seed, startDate, SCHEDULED_CHANGES),
    scenarioId: scenario.id,
    scenario,
    seed,
    startSeed: seed,
    schedule: rollSchedule(scenario, seed),
    stackIndex,
    framework: app,
    rewrite: null,
    components: {
      ...DEFAULT_CHOICES[STACKS[stackIndex]!.provider],
      ...frameworkDefaults(app, STACKS[stackIndex]!.provider, scenario),
      ...chosen,
    },
    storageOption: false,
    storageOptionFeeDue: null,
    componentSwap: null,
    commitments: (() => {
      if (!commitments?.length) return [];
      const offers = setupCommitments(scenario, stackIndex, app, components);
      const out: ActiveCommitment[] = [];
      for (const want of commitments) {
        const o = offers.find(
          (x) => x.key === want.key && x.payment === want.payment,
        );
        if (o && !out.some((c) => c.key === o.key))
          out.push(newCommitment(o, 1));
      }
      return out;
    })(),
    contracts: [],
    requirements: [],
    settings: {
      imageKB: 150,
      variants: 3,
      revalidateSec:
        revalidateSec !== undefined &&
        setupRevalidateOptions(scenario, app, chosenRoutes).some(
          (o) => o.value === revalidateSec,
        )
          ? revalidateSec
          : defaultRevalidateSec(app, stackIndex, scenario, chosenRoutes),
      ssrOptimizations: 0,
    },
    cash: scenario.startCash,
    basePV: scenario.scale.startPV,
    outages: 0,
    featurePoints: 0,
    migration: null,
    switching: false,
    plannedEffort: 0,
    policyWarnedMonth: null,
    effortPerMonth: scenario.effort.perMonth,
    seats: 0,
    mods: {},
    stock: initialStock(scenario),
    botBlocked: false,
    pendingProposals: [],
    responses: {},
    fired: [],
    interrupts: [],
    growthBonus: [],
    history: [],
    phase: 'playing',
  };
}

/** 効果の要約（画面の通知に出す）。 */
export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'traffic':
      return `${e.bot ? 'Bot の' : ''}PV ${fmtFactor(e.factor)}${e.peakFactor ? `・ピーク ${fmtFactor(e.peakFactor)}` : ''}（${e.months} か月${e.earnsRevenue ? '' : '・収益なし'}）`;
    case 'workload': {
      const m = e.mods;
      return [
        m.imagesPerPage !== undefined && `1 PV の画像 ${m.imagesPerPage} 枚`,
        m.uploadsFactor !== undefined &&
          `画像の投稿 ${fmtFactor(m.uploadsFactor)}`,
        m.ssrShare !== undefined &&
          `SSR の割合 ${Math.round(m.ssrShare * 100)}%`,
        m.writesPerCall !== undefined &&
          `API 1 回の書き込み ${m.writesPerCall}`,
        m.dbRateFactor !== undefined &&
          `DB の増え方 ${fmtFactor(m.dbRateFactor)}`,
        m.apiCpuMs !== undefined && `API 1 回の CPU ${m.apiCpuMs} ms`,
        m.apiResponseKB !== undefined && `API 1 回の応答 ${m.apiResponseKB} KB`,
      ]
        .filter(Boolean)
        .join('・');
    }
    case 'stock':
      return [
        e.add.dbGB && `DB +${e.add.dbGB} GB`,
        e.add.imagesGB && `画像 +${e.add.imagesGB} GB`,
        e.add.articlePages &&
          `記事ページ +${e.add.articlePages.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join('・');
    case 'basePV':
      return `基準の PV ${fmtFactor(e.factor)}（以降ずっと）`;
    case 'seats':
      return `席（メンバー）+${e.add}`;
    case 'effortPerMonth':
      return `開発の手間 +${e.add} / 月`;
    case 'interrupt':
      if (e.featureWork)
        return `機能の追加の作業 ${e.points} × ${e.months} か月（翌月から。その月の機能開発に数える${e.unlessOnDemand ? '。再検証がすでにオンデマンドなら不要' : ''}）`;
      return `対応の手間 ${e.points} × ${e.months} か月（翌月から）`;
    case 'feature':
      return `機能開発 +${e.points}`;
    case 'growth':
      return `成長 +${Math.round(e.add * 100)} ポイント × ${e.months} か月`;
    case 'component':
      return `${SLOT_LABELS[e.slot]}に部品を付ける（${componentLabel('cloudflare', e.slot, e.option)}）`;
    case 'on-demand-revalidate':
      return 'ISR の再検証をオンデマンドにする（Next.js）';
    case 'requirement':
      return `以後の要件: ${REQUIREMENT_LABEL[e.requirement]}（満たさない月は鮮度が下がる）`;
    case 'contract':
      return `契約の収益 $${e.usdPerMonth} / 月（${REQUIREMENT_LABEL[e.requires]}のときだけ）`;
    case 'imageRedesign':
      return '画像を大きく綺麗に出す（原本がある構成は過去の記事も・一律で縮めた構成はこれからの投稿だけ。原本が無いと過去の画像は大きくできない）';
  }
}

/** 効果を状態に当てる（traffic はその月の計算で扱うのでここでは何もしない）。 */
function applyEffects(
  state: GameState,
  allEffects: Effect[],
  eventId: string,
): GameState {
  let s = state;
  const effects = effectsFor(state, allEffects);
  const deferFeature = effects.some(
    (e) => e.type === 'interrupt' && e.featureWork,
  );
  const featurePointsOf = effects.reduce(
    (a, e) => a + (e.type === 'feature' ? e.points : 0),
    0,
  );
  for (const e of effects) {
    switch (e.type) {
      case 'workload':
        s = { ...s, mods: { ...s.mods, ...e.mods } };
        break;
      case 'stock':
        s = {
          ...s,
          stock: {
            dbGB: s.stock.dbGB + (e.add.dbGB ?? 0),
            imagesGB: s.stock.imagesGB + (e.add.imagesGB ?? 0),
            images: s.stock.images + (e.add.images ?? 0),
            articlePages: s.stock.articlePages + (e.add.articlePages ?? 0),
          },
        };
        break;
      case 'basePV':
        s = { ...s, basePV: s.basePV * e.factor };
        break;
      case 'seats':
        s = { ...s, seats: s.seats + e.add };
        break;
      case 'effortPerMonth':
        s = { ...s, effortPerMonth: s.effortPerMonth + e.add };
        break;
      case 'interrupt':
        s = {
          ...s,
          interrupts: [
            ...s.interrupts,
            {
              points: e.points,
              months: e.months,
              eventId,
              ...(e.featureWork
                ? { featureWork: true, bonus: featurePointsOf / e.months }
                : {}),
            },
          ],
        };
        break;
      case 'feature':
        // 機能の追加の作業がある提案は、加点を作業の月に按分して足す（D-29）
        if (!deferFeature)
          s = { ...s, featurePoints: s.featurePoints + e.points };
        break;
      case 'growth':
        s = {
          ...s,
          growthBonus: [...s.growthBonus, { add: e.add, months: e.months }],
        };
        break;
      case 'component':
        s = { ...s, components: { ...s.components, [e.slot]: e.option } };
        break;
      case 'on-demand-revalidate':
        // SPA には ISR が無い（revalidateSec は API のキャッシュの期間）ので変えない
        if (s.framework !== 'vite-spa')
          s = {
            ...s,
            settings: { ...s.settings, revalidateSec: ON_DEMAND_REVALIDATE },
          };
        break;
      case 'imageRedesign': {
        // 手間は画像の部品で決まる（D-47）。粗い画像の数はここで固定し、以後の一律で縮めた投稿は粗くない
        const points = imageRedesignEffort(s);
        s = {
          ...s,
          imageRedesign: { coarseImages: s.coarseImages ?? 0 },
          ...(points > 0
            ? {
                interrupts: [...s.interrupts, { points, months: 1, eventId }],
              }
            : {}),
        };
        break;
      }
      case 'requirement':
        s = s.requirements.includes(e.requirement)
          ? s
          : { ...s, requirements: [...s.requirements, e.requirement] };
        break;
      case 'contract':
        s = {
          ...s,
          contracts: [
            ...s.contracts,
            { eventId, usdPerMonth: e.usdPerMonth, requires: e.requires },
          ],
        };
        break;
      case 'traffic':
        break;
    }
  }
  return s;
}

function premiseRefsOf(
  def: Pick<EventDef, 'premiseRefs'>,
  premises: readonly PlatformPremise[],
): MonthEvent['premises'] {
  return premises
    .filter((p) => def.premiseRefs.some((ref) => p.id.startsWith(ref)))
    .map((p) => ({
      id: p.id,
      text: p.text,
      hit: p.hit,
      ...(p.detail !== undefined ? { detail: p.detail } : {}),
      ...(p.ratio !== undefined && Number.isFinite(p.ratio)
        ? { ratio: p.ratio }
        : {}),
    }));
}

/** 1 か月を進める（出来事 → 見積 → 収益 → 前提の判定 → 満足度 → 手間 → 所持金 → 在庫 → 終わりの判定）。 */
export function playMonth(input: GameState): GameState {
  if (input.phase !== 'playing') return input;
  const sc = scenarioOf(input);
  const month = input.history.length + 1;
  const prev = input.history[input.history.length - 1];

  // 返事のない提案は断ったことにする（罰はない。D-20 V-11）
  let state: GameState = input.pendingProposals.length
    ? {
        ...input,
        responses: {
          ...input.responses,
          ...Object.fromEntries(
            input.pendingProposals.map((id) => [id, 'declined' as const]),
          ),
        },
        pendingProposals: [],
      }
    : input;

  // 台本: 今月起きる出来事と予告（事業者を限った出来事は、その事業者の構成のときだけ。D-24 X-5）
  const events: MonthEvent[] = [];
  const platformNow = STACKS[state.stackIndex]!.provider;
  const forPlatform = (x: Scheduled) => {
    const ps = eventDef(sc, x.id)!.platforms;
    return !ps || ps.includes(platformNow);
  };
  const due = state.schedule.filter((x) => x.month === month && forPlatform(x));
  const noticed = state.schedule.filter(
    (x) => x.noticeMonth === month && forPlatform(x),
  );
  let humanFactor = 1;
  let botExtra = 0;
  let peakFactor = 1;
  let lasting = false;
  // 記事ごとの SNS のカードが出ないと、話題の伸びが小さい（SPA で OGP の前処理なし。ゲーム上の仮定・prd/10 F-05）
  const cardFactor = noSocialCards(state)
    ? (sc.frameworks?.spa?.socialCardFactor ?? 1)
    : 1;
  let socialLasting = false;
  const trafficEvents: {
    id: string;
    title: string;
    bot: boolean;
    factor: number;
    peak?: number;
    spikeDays?: number;
  }[] = [];
  const trafficNotes: string[] = [];
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    const n = def.notice!;
    if (n.pvFactor && n.bot) {
      // Bot の前兆（収益にならない。遮断していれば半分）
      const extra =
        (n.pvFactor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
      botExtra += extra;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: true,
        factor: 1 + extra,
      });
      trafficNotes.push(n.title);
    } else if (n.pvFactor) {
      humanFactor *= n.pvFactor;
      trafficEvents.push({
        id: `${def.id}:notice`,
        title: n.title,
        bot: false,
        factor: n.pvFactor,
      });
      trafficNotes.push(n.text);
    }
  }
  // 続いている流量の出来事（Bot は 2 か月など）
  for (const x of state.schedule) {
    if (x.month > month) continue;
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    for (const e of def.effects ?? []) {
      if (e.type !== 'traffic' || month >= x.month + e.months) continue;
      if (e.bot) {
        const extra =
          (e.factor - 1) * (state.botBlocked ? BOT_BLOCK.remaining : 1);
        botExtra += extra;
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: true,
          factor: 1 + extra,
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        trafficNotes.push(`${def.title}（Bot は収益にならない）`);
      } else {
        const factor = e.social ? 1 + (e.factor - 1) * cardFactor : e.factor;
        humanFactor *= factor;
        if (e.peakFactor) peakFactor *= e.peakFactor;
        if (e.lasting) lasting = true;
        if (e.lasting && e.social) socialLasting = true;
        if (e.social && cardFactor !== 1)
          trafficNotes.push(
            `記事ごとの SNS のカードが出ないので、話題の伸びが小さい（${fmtFactor(e.factor)} → ${fmtFactor(factor)}・ゲーム上の仮定）`,
          );
        trafficEvents.push({
          id: def.id,
          title: def.title,
          bot: false,
          factor,
          ...(e.peakFactor ? { peak: e.peakFactor } : {}),
          ...(e.spikeDays ? { spikeDays: e.spikeDays } : {}),
        });
        if (!e.lasting) trafficNotes.push(def.title);
      }
    }
  }
  // 台本の効果（流量以外）は起きた月から効く
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    if (def.kind === 'proposal') continue;
    state = applyEffects(state, def.effects ?? [], def.id);
  }
  const buzz = lasting;
  // 話題の後に残る伸びも、カードが出ないと小さい（同じ仮定）
  const buzzRule =
    socialLasting && cardFactor !== 1
      ? { ...sc.buzz, extra: sc.buzz.extra * cardFactor }
      : sc.buzz;
  const basePV = state.basePV;
  const humanPV = basePV * humanFactor;
  const botPV = humanPV * botExtra;
  const pv = humanPV + botPV;
  // 話題・Bot の上乗せ分は短い期間に集中する（容量の判定だけ。D-44）
  const spikes: Spike[] = trafficEvents.flatMap((t) =>
    t.spikeDays
      ? [
          {
            id: t.id,
            extraPV: t.bot
              ? humanPV * (t.factor - 1)
              : humanPV * (1 - 1 / t.factor),
            days: t.spikeDays,
          },
        ]
      : [],
  );

  const stackIndexNow = state.stackIndex;
  const stack = MVP_STACKS[stackIndexNow]!;
  const ssrCpuMs = nextSsrCpuMs(state);
  const parts: WorkloadParts = {
    pv,
    settings: state.settings,
    ssrCpuMs,
    mods: state.mods,
    stock: sc.stock ? state.stock : null,
    platform: platformNow,
    components: state.components,
    framework: state.framework,
    routes: state.routes,
    routeParts: state.routeParts,
    ...(peakFactor !== 1 ? { peakFactor } : {}),
    ...(spikes.length ? { spikes } : {}),
  };
  const workload = workloadFor(sc, parts);
  const swap = state.componentSwap;
  const architecture = architectureFor(
    stackIndexNow,
    state.seats,
    state.framework,
    state.components,
    swap ? { [swap.slot]: swap.option } : {},
    state.storageOption,
    staticBuildOf(sc, stackIndexNow, state.framework, state.routes),
  );
  const monthBooks = booksAt(state, month);
  const r = estimate({ workload, architecture, books: monthBooks });
  // 乗り換え中は新しい構成も動かしているので、その費用も払う（D-18 U-5）。乗り換え先は既定の部品（D-24 X-9）
  const target = state.migration
    ? (() => {
        const to = state.migration.to;
        const components = componentsAfterMigration(
          to,
          state.mods,
          state.framework,
          sc,
        );
        return estimate({
          workload: workloadFor(sc, {
            ...parts,
            platform: STACKS[to]!.provider,
            components,
          }),
          // 同じドメイン（.com 1 つ）の登録料は今の構成で払っているので、乗り換え先では数えない（D-96・OCL-A580D510）
          architecture: withoutDomainRegistration(
            architectureFor(
              to,
              state.seats,
              state.framework,
              components,
              {},
              false,
              staticBuildOf(sc, to, state.framework, state.routes),
            ),
          ),
          books: monthBooks,
        });
      })()
    : null;
  const parallelInfraCost = target ? toUsd(target.bill.totals) : 0;
  // ストレージ変更オプションの手数料（付けた次の月に一度だけ。D-30）
  // 申し込んだときのプランの金額を一度だけ払う（同じ月に上位へ変更しても変わらない）
  const fee = state.storageOptionFeeDue;
  const feeUsd = fee ? fee.amount / USD_JPY : 0;
  // 確約（D-97）: 今と乗り換え先の明細の対象の額に、結んだ確約を当てる（対象を使わなくなっても支払いは残る）
  const eligibleNow = commitmentEligible(
    [...r.bill.lines, ...(target?.bill.lines ?? [])],
    COMMITMENTS,
  );
  const commitLines = commitmentLines(
    state.commitments ?? [],
    eligibleNow,
    month,
  );
  const commitUsd = commitLines.reduce(
    (a, l) => a + usdOf(l.amount, l.currency),
    0,
  );
  const infraCost =
    toUsd(r.bill.totals) + parallelInfraCost + feeUsd + commitUsd;

  // 出来事の通知（起きた・予告・提案）
  for (const x of due) {
    const def = eventDef(sc, x.id)!;
    // 予告を持ちうる台本は、予告どおり起きたか、予告なしで起きたか（D-28）
    const announced =
      def.notice && def.kind !== 'proposal'
        ? { announced: x.noticeMonth !== undefined }
        : {};
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: def.kind === 'proposal' ? 'proposal' : 'occurred',
      ...announced,
      title: def.title,
      text:
        def.notice && x.noticeMonth === undefined && def.surpriseText
          ? def.surpriseText
          : def.text,
      effects: (def.effects ?? []).map(describeEffect),
      premises: premiseRefsOf(def, r.premises),
      ...(def.showMembers ? { members: membersOf(stackIndexNow) } : {}),
      ...(def.showSla ? { sla: slaOf(stackIndexNow) } : {}),
      ...(def.previewRequirement
        ? {
            requirementStatus: requirementStatus(
              stackIndexNow,
              state.components,
              def.previewRequirement,
              state.framework,
              articleFamily(state),
            ),
          }
        : {}),
      ...(def.accept
        ? {
            accept: {
              label: def.accept.label,
              effects: def.accept.effects.map(describeEffect),
              effort: acceptEffort(def, state),
              ...(unavailableReason(state, def)
                ? { unavailable: unavailableReason(state, def)! }
                : {}),
            },
          }
        : {}),
    });
  }
  for (const x of noticed) {
    const def = eventDef(sc, x.id)!;
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'notice',
      title: def.notice!.title,
      text: def.notice!.text,
      effects: [],
      premises: premiseRefsOf(def, r.premises),
    });
  }
  // 状態で起きる出来事（前提の使用率が境目を越えた。一度だけ）
  let fired = state.fired;
  for (const def of sc.events) {
    if (def.when.type !== 'premise' || fired.includes(def.id)) continue;
    const w = def.when;
    // 前の月は境目より下で、今月越えた前提（1 か月目から越えているものは「近づいた」と呼ばない）
    const p = r.premises.find(
      (q) =>
        w.premiseIds.some((id) => q.id.startsWith(id)) &&
        (q.ratio ?? 0) >= w.atLeast &&
        (prev?.snapshots.find((x) => x.id === q.id)?.ratio ?? Infinity) <
          w.atLeast,
    );
    if (!p) continue;
    fired = [...fired, def.id];
    events.push({
      id: def.id,
      kind: def.kind,
      tier: def.tier,
      phase: 'occurred',
      title: def.title,
      text: def.text,
      effects: [],
      premises: premiseRefsOf(
        { premiseRefs: w.premiseIds },
        r.premises.filter((q) => (q.ratio ?? 0) >= w.atLeast),
      ),
    });
  }
  // 実際に予告されている改定（始めた日が施行日より前のものだけ。D-21）
  const used = new Set(
    stack.nodes.flatMap((n) => (n.billing ? [n.billing.provider] : [])),
  );
  for (const rv of state.revisions) {
    if (rv.month !== month) continue;
    const c = SCHEDULED_CHANGES.find((x) => x.id === rv.id)!;
    events.push({
      id: c.id,
      kind: 'script',
      tier: 'common',
      phase: 'occurred',
      title: `${c.kind === 'pricing' ? '料金' : c.kind === 'limit' ? '制限' : '提供条件'}の改定が予告された（${c.provider}・施行日 ${c.effectiveFrom}）`,
      text: revisionText(c, used.has(c.provider)),
      effects: [],
      premises: [],
    });
  }

  // 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    accounts: accountUpkeepFor(state),
    interrupt: interruptOf(state),
    featureWork: featureWorkOf(state),
    featureBonus: featureBonusOf(state),
    // 乗り換え・DB の差し替え・作り直しは同時に進めない（どれか 1 つだけ。D-81）
    migrationWanted:
      migrationWanted(state.migration) +
      swapWanted(state.componentSwap) +
      rewriteWanted(state),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  let migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;
  let componentSwap = swap
    ? { ...swap, done: swap.done + effort.migration }
    : null;
  let rewrite = state.rewrite
    ? { ...state.rewrite, done: state.rewrite.done + effort.migration }
    : null;

  const [rand, seed] = nextRandom(state.seed);
  // 自前運用のサーバーの偶発的な障害。部品で VPS を使うとき（VPS の API。D-67）も、そのホストがリクエストを受けていれば当たる
  const apiOnlyHost = !STACKS[stackIndexNow]!.selfHosted;
  const incident =
    selfHostedOf(stackIndexNow, state.components, state.framework, {}, true) &&
    rand < sc.incidents.selfHostedChancePerMonth;

  // 規約違反（policy）はすぐには止めず、指摘 → 翌月にアカウント停止の流れで扱う（D-19）
  const blocking = r.premises.filter(
    (p) => p.hit && (p.effect === 'block' || p.effect === 'upgrade-required'),
  );
  const policy = r.premises.filter((p) => p.hit && p.effect === 'policy');
  const throttling = r.premises.filter((p) => p.hit && p.effect === 'throttle');
  // CDN の定額のプランの込みを超えた前提（請求は増えない）。急増が大きいか、続けて超えると性能が調整される（D-61）
  const prevAdjust = new Set(
    (state.history[state.history.length - 1]?.premises ?? [])
      .filter((p) => p.hit && p.effect === 'adjust')
      .map((p) => p.id),
  );
  const adjusted = r.premises.filter(
    (p) =>
      p.hit &&
      p.effect === 'adjust' &&
      ((p.ratio ?? 0) > FLAT_PLAN_ADJUST.spikeRatio ||
        // 続けて超えた: 前の月も同じ前提で超えていた（sustainedMonths = 2 か月）
        prevAdjust.has(p.id)),
  );
  const loss = sc.revenue.loss;
  let revenue =
    (sc.revenue.fixedUsdPerMonth ?? 0) +
    (humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
  let outages = state.outages;
  let status: MonthReport['status'] = 'ok';
  const notes: string[] = [];
  if (blocking.length) {
    revenue *= 1 - loss.block;
    outages++;
    status = 'down';
    notes.push('サービスが止まった（前提に当たった）');
  } else if (incident) {
    revenue *= 1 - loss.incident;
    outages++;
    status = 'incident';
    notes.push(
      apiOnlyHost
        ? 'API の VPS の障害で数時間止まった（SLA なし・1 台構成。シェルは出るが中身が読めない）'
        : 'VPS の障害で数時間止まった（SLA なし・1 台構成）',
    );
  } else if (throttling.length) {
    revenue *= 1 - loss.throttle;
    status = 'slow';
    notes.push('遅くなった（前提に近づいた）');
  }
  if (state.switching) {
    revenue *= 1 - loss.migration;
    notes.push('乗り換えの切り替えで収益が減った');
  }
  // 契約の収益（要件を満たす構成の月だけ。SLA の出来事・D-24）
  let contractRevenue = 0;
  for (const c of state.contracts) {
    if (
      meetsRequirement(
        stackIndexNow,
        c.requires,
        state.components,
        state.framework,
        articleFamily(state),
      )
    )
      contractRevenue += c.usdPerMonth;
    else
      notes.push(
        `契約の収益が入らなかった（${REQUIREMENT_LABEL[c.requires]}でない）`,
      );
  }
  revenue += contractRevenue;

  // 規約違反: 最初の月は指摘（警告）、翌月も違反したままならアカウント停止（D-19）
  const ps = policyStep({
    warnedMonth: state.policyWarnedMonth,
    violating: policy.length > 0,
    migrating: state.migration !== null,
    month,
  });
  const policyWarnedMonth = ps.warnedMonth;
  const policyWarning = ps.outcome === 'warned';
  const accountSuspended = ps.outcome === 'suspended';
  if (ps.outcome === 'warned')
    notes.push(
      `運営元から指摘が来た（規約違反の警告: ${policy[0]!.text}）。来月も違反したままならアカウントが停止される`,
    );
  else if (ps.outcome === 'grace')
    notes.push('規約違反のまま乗り換えの作業中（猶予中）');
  else if (accountSuspended)
    notes.push('規約違反が続いたため、アカウントが停止された');

  // 満足度と評判（prd/07 §9.1〜9.3）
  const sat = sc.satisfaction;
  // 部品で変わる判定の入力（D-24）: 最適化しない画像は原本の大きさ・キャッシュしないと記事は常に新しい・
  // KV を DB の代わりにすると書き込みがすぐ見えない
  const comps = { ...DEFAULT_CHOICES[platformNow], ...state.components };
  // 画像の部品の振る舞い（他の事業者の部品は同じ振る舞いの部品として見る。D-52）
  const imgs = imagesBehavior(platformNow, comps.images);
  const viewed: Settings = {
    ...state.settings,
    imageKB: deliveredImageKB(
      sc,
      state.settings,
      imgs,
      autoImageFormat(platformNow, state.framework, comps.images),
    ),
    // 最適化しない・一律で縮めて置くは、サイズ違いを作らず 1 種を配る（D-47）
    ...(imgs === 'resize' || imgs === 'none' ? { variants: 1 } : {}),
  };
  // 画質: 最適化しないは原本、それ以外は JPEG と同じ見た目（形式では下げない。D-58）。記事のデザインの刷新を断った月・
  // 受けたあと粗い画像（一律で縮めた原本の無い画像）が多い月は 1 段下げる（D-47）
  // 画像の形式は同じ見た目の画質で小さくするので、画質は下げない（D-58）。JPEG の大きさで判定する
  const qualityImageKB =
    imgs === 'none' ? viewed.imageKB : IMAGE_FORMAT_KB.jpeg;
  const redesign = imageRedesignQuality(state, sc, month, imgs);
  // SPA は ISR を持たず、ページの中身を毎回 API で読む（記事は常に新しい。prd/10）。
  // API の応答をキャッシュすると、記事はキャッシュの期間だけ古く見える（ISR の間隔と同じ判定。D-37）
  // 記事のページの描き方（D-107）: 枠 + API（S5）なら SPA と同じ判定、静的（S1）なら静的書き出しと同じ判定、毎回描く（S4）ならキャッシュなし。
  // 記事のページの無いシナリオ（受託）はフレームワークで決める（今までどおり）
  const fam = articleFamily(state);
  const spaFramework = state.framework === 'vite-spa';
  const spa = fam !== undefined ? fam === 'api' : spaFramework;
  const astro = state.framework === 'astro';
  // Next.js の静的書き出し（D-80）: 記事は静的なページ（鮮度はビルドの間隔）、マイページの中身は SPA と同じく API
  const nextExport = state.framework === 'nextjs-export';
  const rebuilds = fam !== undefined ? fam === 'static' : nextExport;
  const ssrArticle = fam === 'ssr';
  // Astro の記事は閲覧のときに描いて事業者の置き場にキャッシュする（D-103）。キャッシュしない形は無く、鮮度は Next.js の ISR と同じ
  // （オンデマンドで消す・期限で取り直す）。置き場は事業者で決まるので、ISR のキャッシュの部品の選択は見ない
  const cacheComps: Choices = astro
    ? { ...comps, isrCache: astroPageCacheChoice(platformNow) }
    : comps;
  const uncached = spa
    ? !apiCacheActive(platformNow, state.components, state.framework)
    : ssrArticle || (!rebuilds && cacheComps.isrCache === 'none');
  // SPA の API の CPU（速さの「SSR の重さ」の代わりに使う。SSR の CPU × dataCpuFactor）。初回表示の重さと速さの CPU は
  // フレームワークの性質のまま（Next.js・Astro のページを S5 にしても、静的書き出しのマイページと同じく SSR の値で見る。D-80・D-107）
  const firstLoad =
    spaFramework && (sc.frameworks?.spa?.firstLoadHeavy ?? false);
  // Astro の初回表示の軽さ（JS はアイランドの分だけ。速さの重さを 1 つ減らす。ゲーム上の仮定・D-68）
  const firstLoadLight =
    astro && (sc.frameworks?.astro?.firstLoadLight ?? false);
  // コンテナの冷えた起動（Cloud Run の最小インスタンス 0。D-88）
  const coldShare = coldStartViewShare(r);
  const coldStart = coldShare >= COLD_START.heavyShare;
  // 静的書き出しのマイページは、サーバーの描画が無い代わりにブラウザが HTML → JS → API の順に待つ。速さ・初回表示は
  // Next.js と同じ扱い（SSR の CPU の値をそのまま重さに使う。ゲーム上の仮定・D-80）
  const serverCpuMs = spaFramework
    ? ssrCpuMs * (sc.frameworks?.spa?.shape.dataCpuFactor ?? 1)
    : ssrCpuMs;
  // API を他の事業者に置いている間は、構成の DB の選択は使われない（DB は API の事業者の部品。OCL-5A7916E6）
  // ISR のページを前段の CDN でもキャッシュし、時間で再検証するなら、CDN は s-maxage（= 間隔）まで写しを返すので、
  // 更新は最大で間隔の約 2 倍遅れて見える（記事・ページに含めたコメントとも。D-91）。オンデマンドでは、再検証と一緒に
  // CDN のキャッシュを消せる部品（さくらの VPS の Cloudflare は Free の purge の API）なら遅れず、消せない部品
  // （AWS の自前の CloudFront）は古いページが残る（D-31 と同じく 1 段下げ、さらに即時反映を満たさない）
  const frontHtml =
    !spa && !rebuilds && !ssrArticle && htmlCachedAtFront(cacheComps);
  const frontDelayed = frontHtml && !isOnDemand(viewed);
  const frontUnpurged =
    frontHtml &&
    isOnDemand(viewed) &&
    componentsOf(platformNow, 'frontCdn').find((o) => o.id === comps.frontCdn)
      ?.onDemandIsr?.ok === false;
  const eventuallyConsistent =
    (comps.db === 'kv' && !apiPlacedElsewhere(comps)) || frontUnpurged;
  // 記事をビルドし直す形（静的書き出し）は、更新が載るまで間隔にビルドの時間を足した分だけ遅れる（オンデマンドでもビルドの時間は待つ。D-104）
  const buildDelaySec = rebuilds
    ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
    : 0;
  const judgedDelaySec =
    (frontDelayed
      ? viewed.revalidateSec * FRONT_CDN_DELAY_FACTOR
      : viewed.revalidateSec) + buildDelaySec;
  // 新しい記事は、ビルドが終わるまでページが無い。投稿した人が開けるまでの許容を超えたら、コミュニティの要件を満たさない（D-104）。
  // 記事ごとの枠（S5。D-109）も枠をビルドで書き出すので、中身は API で常に新しくても、新しい記事は枠のビルドが終わるまで開けない
  const shellBuildSec =
    spa && articleShellPerPage(state)
      ? (r.simulation.workload.input.build?.minutesPerBuild ?? 0) * 60
      : 0;
  const newPostLimit = sat.freshness.newPostVisibleSec;
  const newPostDelayed =
    newPostLimit !== undefined &&
    ((buildDelaySec > 0 && judgedDelaySec > newPostLimit) ||
      shellBuildSec > newPostLimit);
  // 即時反映（オンデマンド ISR）の要件を満たさない構成（D-32）。再検証の設定をオンデマンドにしたときも、
  // 対応しない部品があると再検証が届かず古いページが出る（同じ判定・同じ理由の文。D-49）
  const onDemandSetting = !spa && isOnDemand(state.settings);
  const onDemand =
    state.requirements.includes('on-demand-isr') || onDemandSetting
      ? onDemandBlocker(stackIndexNow, state.components, state.framework, fam)
      : undefined;
  // コメントを記事のページに含め、時間で再検証・ビルドするなら、コメントは間隔の分だけ遅れて見える（D-85）。
  // オンデマンド（コメントのたびに作り直す）・キャッシュしない（毎回 SSR）なら遅れない。ビルドし直す形はオンデマンドでもビルドの時間は遅れる（D-104）
  const commentsDelayed =
    sc.comments !== undefined &&
    commentsInPage(
      commentsOf(sc, state.routeParts),
      state.framework,
      sc,
      state.routes,
    ) &&
    !uncached &&
    (!isOnDemand(viewed) || buildDelaySec > 0);
  const stages = judgeStages(
    {
      blocked: blocking.length > 0,
      degraded: incident || state.switching,
      ssrCpuMs: serverCpuMs,
      firstLoadHeavy: firstLoad,
      firstLoadLight,
      coldStart,
      imageKB: viewed.imageKB,
      variants: viewed.variants,
      revalidateSec: judgedDelaySec,
      qualityImageKB,
      qualityDown: redesign !== undefined,
      featurePoints,
      month,
      premises: r.premises,
      uncached,
      eventuallyConsistent,
      onDemandUnmet: onDemand !== undefined,
      newPostDelayed,
      ...(commentsDelayed
        ? {
            commentFreshness: {
              delaySec: judgedDelaySec,
              ...sc.comments!.freshness,
            },
          }
        : {}),
      speedDown: adjusted.length > 0,
    },
    sat,
  );
  if (adjusted.length)
    notes.push(
      'CDN の定額のプランの込みを超え続け、配信の性能が調整された（請求は増えない。ゲーム上の仮定）',
    );
  const reasons = stageReasons(sc, stages, {
    blocking,
    throttling,
    adjusted,
    incident,
    switching: state.switching,
    ssrCpuMs: serverCpuMs,
    spa,
    spaFramework,
    apiOnly: nextExport,
    rebuilds,
    astro,
    settings: viewed,
    heaviness: speedHeaviness(
      {
        ...viewed,
        ssrCpuMs: serverCpuMs,
        premises: r.premises,
        firstLoadHeavy: firstLoad,
        firstLoadLight,
        coldStart,
      },
      sat,
    ),
    coldShare: coldStart ? coldShare : undefined,
    featurePoints,
    month,
    imagesUnoptimized: imgs === 'none',
    pageWeight: pageWeightLabel(
      pageWeightKB(
        sc,
        state.settings,
        state.mods,
        imgs,
        autoImageFormat(platformNow, state.framework, comps.images),
      ),
    ),
    qualityReason: redesign,
    eventuallyConsistent,
    frontDelayed,
    uncached,
    buildDelaySec,
    newPostDelayed,
    shellBuilds: shellBuildSec > 0,
    // 遅れがコメントの「良い」の境目を超えたときだけ理由に出す
    commentsDelayed:
      commentsDelayed && judgedDelaySec > sc.comments!.freshness.good,
    onDemandReason: onDemand
      ? state.requirements.includes('on-demand-isr')
        ? `即時反映の要件を満たさない（${onDemand.label}。${onDemand.reason}）`
        : `オンデマンドの再検証が届かない（${onDemand.label}。${onDemand.reason}）`
      : undefined,
  });
  const score = satisfactionScore(stages, sat.weights);
  const rep = reputation(score, prev?.satisfaction.score);
  const g = growthFromReputation(rep, stages.availability === 'bad', sc.growth);
  const bonus = state.growthBonus.reduce(
    (a, b) => a + (b.months > 0 ? b.add : 0),
    0,
  );
  // 速さが「悪い」月は、離脱と検索からの流入の減りで PV の伸びが下がる（ゲーム上の仮定・D-47）
  const slowPenalty = stages.speed === 'bad' ? (sc.growth.slowPenalty ?? 0) : 0;
  if (slowPenalty > 0 && reasons.speed)
    reasons.speed += `。速さが悪く PV の伸びが約 ${Math.round(slowPenalty * 100)}% 下がった`;
  const net = g.net + bonus - slowPenalty;

  const cash = state.cash + revenue - infraCost;

  // 前提が初めて境目を越えた月: 出来事を外して見積を引き直し、理由を確かめる（prd/07 §10.7）
  const crossings = crossingsOf(sc, {
    prev,
    premises: r.premises,
    parts,
    architecture,
    books: monthBooks,
    humanPV,
    basePV,
    trafficEvents,
    state,
  });

  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = stackIndexNow;
  let switching = false;
  let components = state.components;
  let mods = state.mods;
  let storageOption = state.storageOption;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    components = componentsAfterMigration(
      migration.to,
      state.mods,
      state.framework,
      scenarioOf(state),
    );
    // 乗り換え・契約し直しは新しいサーバーなので、ストレージ変更オプションは付いていない
    storageOption = false;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${stackName(migration.to, state.framework)} に切り替える（部品は既定の選択から始まる）`,
    );
    if (mods.realtime && !realtimeSupported(STACKS[migration.to]!.provider)) {
      mods = withoutRealtime(mods);
      notes.push(
        'チャットは乗り換え先のリアルタイムのデータを取得していないため、乗り換えとともに止めた',
      );
    }
    migration = null;
  }
  // DB の差し替えが済んだら、次の月から新しい DB に切り替える
  if (componentSwap && componentSwap.done >= componentSwap.required) {
    components = { ...components, [componentSwap.slot]: componentSwap.option };
    // API を他の事業者に移したら、構成の DB の選択は既定に戻す（DB は API の事業者に移った。
    // 同じ事業者へ戻すときは既定の DB へ移す。OCL-5A7916E6）
    if (componentSwap.slot === 'api' && apiPlacedElsewhere(components)) {
      const { db: _db, ...rest } = components;
      components = rest;
    }
    notes.push(
      `${swapLabel(componentSwap.slot)}が済んだ。来月から ${componentLabel(platformNow, componentSwap.slot, componentSwap.option)} を使う`,
    );
    componentSwap = null;
  }
  // 作り直しが済んだら、次の月から新しいフレームワークで動かす（事業者はそのまま。D-81）
  let framework = state.framework;
  let settings = state.settings;
  let routes = state.routes;
  if (rewrite && rewrite.done >= rewrite.required) {
    framework = rewrite.to;
    // 描き方は新しいフレームワークの既定に戻る（D-107）
    routes = undefined;
    components = componentsAfterRewrite({ ...state, components }, rewrite.to);
    settings = {
      ...settings,
      revalidateSec: revalidateAfterRewrite(settings.revalidateSec, rewrite.to),
    };
    notes.push(
      `作り直しが済んだ。来月から ${FRAMEWORKS[rewrite.to].label} で動かす（${stackName(stackIndex, rewrite.to, true, components)}。新しいフレームワークで選べない部品は既定に戻した）`,
    );
    rewrite = null;
  }

  // ためていく量（月ごとに増える。prd/07 §10.4）
  const stock = sc.stock ? grow(sc, state, humanPV) : state.stock;
  // 一律で縮めて置いた画像（原本が無い）は、記事のデザインの刷新を受ける前の分だけ粗い画像として数える（D-47）
  const coarseImages =
    (state.coarseImages ?? 0) +
    (imgs === 'resize' && !state.imageRedesign
      ? stock.images - state.stock.images
      : 0);

  const report: MonthReport = {
    month,
    stackName: stackName(
      stackIndexNow,
      state.framework,
      true,
      state.components,
    ),
    buzz,
    ...(trafficNotes.length ? { trafficNote: trafficNotes.join('・') } : {}),
    pv,
    humanPV,
    botPV,
    basePV,
    revenue,
    infraCost,
    parallelInfraCost,
    cash,
    status,
    notes,
    events,
    crossings,
    policyWarning,
    premises: r.premises.filter((p) => p.hit || (p.ratio ?? 0) >= 0.7),
    snapshots: r.premises
      .filter(
        (p) =>
          p.kind === 'threshold' &&
          p.ratio !== undefined &&
          Number.isFinite(p.ratio),
      )
      .map((p) => ({
        id: p.id,
        text: p.text,
        effect: p.effect,
        ratio: p.ratio!,
        hit: p.hit,
        accumulates: p.accumulates ?? false,
      })),
    lines: [
      ...[r, ...(target ? [target] : [])].flatMap((x) =>
        x.bill.lines
          .filter((l) => l.amount)
          .map((l) => ({
            label: lineLabel(l),
            provider: l.priceRef.provider,
            kind: l.kind,
            ...(l.priceRef.meterId ? { meterId: l.priceRef.meterId } : {}),
            amount: l.amount!,
            currency: l.currency,
            ...(l.priceRef.meterId === INVALIDATION_METER
              ? { quantity: l.quantity ?? 0 }
              : {}),
          })),
      ),
      ...(fee
        ? [
            {
              label: fee.label ?? `sakura-vps ${fee.name}（手数料・一度だけ）`,
              provider: 'sakura-vps',
              kind: 'fee' as const,
              amount: fee.amount,
              currency: 'JPY',
            },
          ]
        : []),
      ...commitLines.map((l) => ({
        label: l.label,
        provider: l.key.split(':')[0]!,
        kind: 'commitment' as const,
        amount: l.amount,
        currency: l.currency,
      })),
    ],
    unpricedLines: r.bill.unpricedLines + (target?.bill.unpricedLines ?? 0),
    settings: state.settings,
    ssrCpuMs,
    stock: state.stock,
    seats: state.seats,
    satisfaction: {
      stages,
      reasons,
      score,
      reputation: rep,
      acquisition: g.acquisition,
      churn: g.churn,
      growth: buzz ? buzzLasting(rep, buzzRule) * (1 - slowPenalty) - 1 : net,
      ...(slowPenalty > 0 ? { slowPenalty } : {}),
    },
    effort,
    featurePoints,
    components: comps,
    componentSummary: (Object.keys(SLOT_LABELS) as SlotId[])
      .filter(
        (slot) =>
          componentsOf(platformNow, slot, state.framework).length > 1 &&
          !slotIneffective(slot, comps, {
            stackIndex: stackIndexNow,
            framework: state.framework,
          }),
      )
      .map(
        (slot) =>
          `${SLOT_LABELS[slot]}: ${componentLabel(platformNow, slot, comps[slot])}`,
      )
      .join('・'),
    contractRevenue,
    ...(Object.keys(eligibleNow).length
      ? { commitmentEligible: eligibleNow }
      : {}),
    ...(commitLines.length ? { commitmentNet: -commitUsd } : {}),
    ...(swap
      ? {
          componentSwap: {
            label: `${SLOT_LABELS[swap.slot]}を ${componentLabel(platformNow, swap.slot, swap.option)} へ`,
            done: swap.done + effort.migration,
            required: swap.required,
          },
        }
      : {}),
    ...(state.migration
      ? {
          migration: {
            toName: stackName(state.migration.to, state.framework),
            done: state.migration.done + effort.migration,
            required: state.migration.required,
          },
        }
      : {}),
    ...(state.rewrite
      ? {
          rewrite: {
            toLabel: FRAMEWORKS[state.rewrite.to].label,
            done: state.rewrite.done + effort.migration,
            required: state.rewrite.required,
          },
        }
      : {}),
    framework: state.framework,
  };

  // 今月届いた提案は、月の終わりに返事を待つ
  const proposals = due.filter((x) => eventDef(sc, x.id)!.kind === 'proposal');

  const history = [...state.history, report];
  const finished = month >= sc.months;
  const end: GameState['end'] = accountSuspended
    ? { reason: 'policy', month }
    : outages > sc.goal.maxOutageMonths
      ? { reason: 'outages', month }
      : cash < 0
        ? { reason: 'cash', month }
        : finished
          ? {
              reason: passes(sc, { cash, outages, history }) ? 'won' : 'goal',
              month,
            }
          : undefined;
  // 乗り換え先で使えない描き方は既定に戻す（D-107）
  if (routes !== undefined) {
    const valid = validRouteOverrides(sc, stackIndex, framework, routes);
    routes = Object.keys(valid).length > 0 ? valid : undefined;
  }
  const { routes: _routes, ...base } = state;
  return {
    ...base,
    ...(routes !== undefined ? { routes } : {}),
    seed,
    stackIndex,
    framework,
    rewrite,
    settings,
    components,
    componentSwap,
    mods,
    storageOption,
    storageOptionFeeDue: null,
    cash,
    outages,
    featurePoints,
    migration,
    switching,
    plannedEffort: 0,
    policyWarnedMonth,
    stock,
    ...(coarseImages > 0 ? { coarseImages } : {}),
    fired,
    pendingProposals: end ? [] : proposals.map((x) => x.id),
    interrupts: state.interrupts
      .map((i) => ({ ...i, months: i.months - 1 }))
      .filter((i) => i.months > 0),
    growthBonus: state.growthBonus
      .map((b) => ({ ...b, months: b.months - 1 }))
      .filter((b) => b.months > 0),
    basePV: buzz
      ? basePV * buzzLasting(rep, buzzRule) * (1 - slowPenalty)
      : basePV * (1 + net),
    history,
    phase: end ? (end.reason === 'won' ? 'won' : 'lost') : 'playing',
    ...(end ? { end } : {}),
  };
}

function grow(sc: Scenario, state: GameState, humanPV: number): Stock {
  const rule = sc.stock!;
  const w = sc.template(1);
  // 1 MAU あたりの PV はテンプレートから読む（記事コミュニティは 10・業務アプリは 200。D-33）
  const mau = humanPV / Math.round(1 / w.traffic.mau);
  const uploads =
    mau * w.images.uploadsPerMau * (state.mods.uploadsFactor ?? 1);
  const s = state.stock;
  // 一律で縮めて置く部品なら、保存するのは縮めた大きさ（原本は残さない。D-47）
  const resize = imagesOf(state) === 'resize';
  const gbPerUpload = resize
    ? // 一律で縮めて置く: 形式が JPEG でなければ、古いブラウザ向けの JPEG も置く（MDN の推奨。D-58）
      (deliveredImageKB(sc, state.settings, 'resize') +
        (imageFormatOf(state.settings.imageKB) === 'jpeg'
          ? 0
          : sc.resizedImageKB)) /
      1e6
    : // 原本はそのまま置く（形式は閲覧・投稿のときに変える。D-58 で圧縮の比を掛けるのをやめた）
      rule.gbPerImage;
  return {
    dbGB:
      s.dbGB +
      (rule.dbGBPerMillionPV * humanPV * (state.mods.dbRateFactor ?? 1)) / 1e6,
    imagesGB: s.imagesGB + uploads * gbPerUpload,
    images: s.images + uploads,
    articlePages: s.articlePages,
  };
}

/** 境目を初めて越えた前提について、出来事ごとに効果を外した見積を引き直す（表示のためだけ）。 */
function crossingsOf(
  sc: Scenario,
  c: {
    prev: MonthReport | undefined;
    premises: readonly PlatformPremise[];
    parts: WorkloadParts;
    architecture: ArchitectureInput;
    books: PriceBook[];
    humanPV: number;
    basePV: number;
    trafficEvents: {
      id: string;
      title: string;
      bot: boolean;
      factor: number;
      peak?: number;
    }[];
    state: GameState;
  },
): Crossing[] {
  const crossed = c.premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.hit &&
      Number.isFinite(p.ratio ?? NaN) &&
      // 前の月にも同じ前提があり、境目より下だった（1 か月目・乗り換えの直後は数えない）
      (c.prev?.snapshots.find((q) => q.id === p.id)?.ratio ?? Infinity) <= 1,
  );
  if (!crossed.length) return [];
  // 外してみる候補: 流量の出来事・受けた提案（Workload の変化・在庫の一括の増加）
  const variants: { eventId: string; title: string; parts: WorkloadParts }[] =
    [];
  for (const t of c.trafficEvents) {
    const pv = t.bot
      ? c.parts.pv - c.humanPV * (t.factor - 1)
      : c.parts.pv / t.factor;
    const peakFactor = (c.parts.peakFactor ?? 1) / (t.peak ?? 1);
    // 外した出来事の集中を除き、人の流量の出来事を外すなら残りの上乗せも同じ割合で小さくする
    const spikes = (c.parts.spikes ?? [])
      .filter((s) => s.id !== t.id)
      .map((s) => (t.bot ? s : { ...s, extraPV: s.extraPV / t.factor }));
    variants.push({
      eventId: t.id,
      title: t.title,
      parts: { ...c.parts, pv, peakFactor, spikes },
    });
  }
  for (const [id, res] of Object.entries(c.state.responses)) {
    if (res !== 'accepted') continue;
    const def = eventDef(sc, id);
    if (!def?.accept) continue;
    let mods = c.parts.mods;
    let stock = c.parts.stock;
    let pv = c.parts.pv;
    // basePV を外すと、話題・Bot の上乗せ（集中する分）も同じ割合で小さくなる（OCL-37A91830）
    let baseFactor = 1;
    for (const e of def.accept.effects) {
      if (e.type === 'workload') {
        const next = { ...mods };
        for (const k of Object.keys(e.mods) as (keyof WorkloadMods)[])
          delete next[k];
        mods = next;
      } else if (e.type === 'stock' && stock) {
        stock = {
          dbGB: stock.dbGB - (e.add.dbGB ?? 0),
          imagesGB: stock.imagesGB - (e.add.imagesGB ?? 0),
          images: stock.images - (e.add.images ?? 0),
          articlePages: stock.articlePages - (e.add.articlePages ?? 0),
        };
      } else if (e.type === 'basePV') {
        pv /= e.factor;
        baseFactor *= e.factor;
      }
    }
    const spikes = (c.parts.spikes ?? []).map((s) => ({
      ...s,
      extraPV: s.extraPV / baseFactor,
    }));
    variants.push({
      eventId: id,
      title: def.title,
      parts: { ...c.parts, mods, stock, pv, spikes },
    });
  }
  const ratios = variants.map((v) => {
    const r = estimate({
      workload: workloadFor(sc, v.parts),
      architecture: c.architecture,
      books: c.books,
    });
    return new Map(r.premises.map((p) => [p.id, p.ratio ?? 0]));
  });
  return crossed.map((p) => ({
    premiseId: p.id,
    text: p.text,
    causes: variants.flatMap((v, i) => {
      const without = ratios[i]!.get(p.id) ?? 0;
      return without <= 1
        ? [{ eventId: v.eventId, title: v.title, ratioWithout: without }]
        : [];
    }),
  }));
}

function stageReasons(
  sc: Scenario,
  stages: Stages,
  c: {
    blocking: PlatformPremise[];
    throttling: PlatformPremise[];
    /** 定額のプランの込みを超えて性能が調整された前提（D-61）。 */
    adjusted: PlatformPremise[];
    incident: boolean;
    switching: boolean;
    ssrCpuMs: number;
    /** SPA（速さの理由を「API の CPU・初回表示」で書く）。 */
    spa: boolean;
    /** フレームワークが SPA か（速さの文。記事の描き方の spa と分ける。D-107）。 */
    spaFramework?: boolean;
    /** Next.js の静的書き出し（速さは Next.js と同じ扱いで、理由を「API を待つブラウザの描画」で書く。D-80）。 */
    apiOnly?: boolean;
    /** 記事をビルドし直す（Next.js の静的書き出し。鮮度の理由を「ビルドの間隔」で書く。D-80）。 */
    rebuilds?: boolean;
    /** Astro（鮮度の理由を「記事のキャッシュの期限」で書く。D-103）。 */
    astro?: boolean;
    settings: Settings;
    heaviness: number;
    featurePoints: number;
    month: number;
    imagesUnoptimized: boolean;
    /** 1 ページの通信量の表示（速さの理由に添える。D-47）。 */
    pageWeight: string;
    /** 画質を下げた理由（記事のデザインの刷新。D-47）。 */
    qualityReason?: string | undefined;
    eventuallyConsistent: boolean;
    /** HTML を前段の CDN でもキャッシュし、時間で再検証している（更新は最大で間隔の約 2 倍遅れる。D-91）。 */
    frontDelayed?: boolean;
    uncached: boolean;
    /** ビルドし直す形の 1 回のビルドの時間（秒。鮮度の遅れに足す。D-104）。 */
    buildDelaySec?: number;
    /** 記事ごとの枠（S5）をビルドで書き出す（新しい記事の理由を「枠のビルド」で書く。D-109）。 */
    shellBuilds?: boolean;
    /** 新しい記事がビルドまで開けず、投稿した人の許容を超える（D-104）。 */
    newPostDelayed?: boolean;
    /** コメントを記事のページに含め、時間で再検証・ビルドしている（コメントが間隔の分だけ遅れて見える。D-85）。 */
    commentsDelayed?: boolean;
    onDemandReason?: string | undefined;
    /** コンテナの冷えた起動を待つ閲覧の割合（速さの重さに数えたときだけ。D-88）。 */
    coldShare?: number | undefined;
  },
): Partial<Record<Element, string>> {
  const out: Partial<Record<Element, string>> = {};
  if (stages.availability !== 'good')
    out.availability = c.blocking.length
      ? `止まった: ${c.blocking[0]!.text}`
      : c.incident
        ? '偶発的な障害（数時間）'
        : '乗り換えの切り替え';
  if (stages.speed !== 'good')
    out.speed = c.throttling.length
      ? `前提に当たった: ${c.throttling[0]!.text}`
      : (c.spaFramework ?? c.spa)
        ? `重さ ${c.heaviness}（SPA の初回表示・API ${Number(c.ssrCpuMs.toFixed(1))} ms・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種・${c.pageWeight}）`
        : c.apiOnly
          ? `重さ ${c.heaviness}（API を待つブラウザの描画 ${c.ssrCpuMs} ms 相当・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種・${c.pageWeight}）`
          : `重さ ${c.heaviness}（SSR ${c.ssrCpuMs} ms・画像 ${c.settings.imageKB} KB × ${c.settings.variants} 種・${c.pageWeight}）`;
  if (
    stages.speed !== 'good' &&
    c.coldShare !== undefined &&
    !c.throttling.length
  )
    out.speed = `${out.speed}・閲覧の ${Math.round(c.coldShare * 100)}% がコンテナの冷えた起動を待つ（最小インスタンス 0）`;
  if (stages.quality !== 'good')
    out.quality = c.qualityReason ?? `画像 ${c.settings.imageKB} KB`;
  if (stages.freshness !== 'good')
    out.freshness = [
      !c.uncached &&
        (c.spa || c.rebuilds || !isOnDemand(c.settings)) &&
        (c.spa
          ? `API のキャッシュの期間 ${optionLabel('apiCacheTtl', c.settings.revalidateSec)}`
          : c.rebuilds
            ? `ビルドの間隔 ${optionLabel('buildInterval', c.settings.revalidateSec)} + ビルドの時間 約 ${Math.round((c.buildDelaySec ?? 0) / 60)} 分`
            : c.astro
              ? `記事のキャッシュの期限 ${optionLabel('pageCache', c.settings.revalidateSec)}`
              : `ISR の間隔 ${optionLabel('isr', c.settings.revalidateSec)}`),
      c.eventuallyConsistent &&
        'KV を DB の代わりにしているか、HTML を前段の CDN でキャッシュしていて（キャッシュを消せない）、更新がすぐ見えない',
      c.frontDelayed &&
        'HTML を前段の CDN でもキャッシュしているので、更新は最大で間隔の約 2 倍遅れて見える（オンデマンドの再検証でキャッシュを消せば遅れない）',
      c.newPostDelayed &&
        (c.shellBuilds
          ? '新しく投稿された記事は、記事ごとの枠のビルドが終わるまでページが無く、投稿した人がすぐ開けない（コミュニティの要件を満たさない）'
          : '新しく投稿された記事はビルドが終わるまでページが無く、投稿した人がすぐ開けない（コミュニティの要件を満たさない）'),
      c.commentsDelayed &&
        'コメントを記事のページに含めているので、コメントも間隔の分だけ遅れて見える',
      c.onDemandReason,
    ]
      .filter(Boolean)
      .join('・');
  if (stages.speed !== 'good' && c.adjusted.length)
    out.speed = `配信の性能が調整された: ${c.adjusted[0]!.text}・${out.speed}`;
  if (c.imagesUnoptimized && out.speed && !c.throttling.length)
    out.speed += '（画像を最適化していない）';
  if (stages.feature !== 'good') {
    const expected = sc.satisfaction.feature.expectedPerMonth * c.month;
    out.feature = `機能開発 ${c.featurePoints} / 期待 ${expected}`;
  }
  return out;
}

export function averageSatisfaction(history: readonly MonthReport[]): number {
  return history.length
    ? history.reduce((a, r) => a + r.satisfaction.score, 0) / history.length
    : 0;
}

function passes(
  sc: Scenario,
  s: {
    cash: number;
    outages: number;
    history: readonly MonthReport[];
  },
): boolean {
  return (
    s.cash >= sc.goal.cash &&
    averageSatisfaction(s.history) >= sc.goal.satisfaction &&
    s.outages <= sc.goal.maxOutageMonths
  );
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
        `${r.label ?? r.id}を${ROUTE_STRATEGIES[action.strategy].code} ${ROUTE_STRATEGIES[action.strategy].label}に`,
        {
          ...state,
          ...planned,
          routes: withRouteChoice(
            sc,
            state.framework,
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

/** 今月見込みを出さない理由（一時的に流量が増えた月。プレイヤーにも見えている出来事。prd/07 §10.7）。 */
export function projectionNote(r: MonthReport): string | undefined {
  if (r.buzz)
    return '話題になった月の伸びは続かないかもしれないので、今月は見込みを出さない';
  if (r.trafficNote)
    return `一時的に流量が増えた月（${r.trafficNote}）なので、今月は見込みを出さない`;
  return undefined;
}

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

export type Check = {
  label: string;
  ok: boolean;
  value: string;
  target: string;
};

export function goalChecks(state: GameState): Check[] {
  const goal = scenarioOf(state).goal;
  const avg = averageSatisfaction(state.history);
  return [
    {
      label: '所持金',
      ok: state.cash >= goal.cash,
      value: `$${state.cash.toFixed(2)}`,
      target: `$${goal.cash} 以上`,
    },
    {
      label: '満足度の平均',
      ok: avg >= goal.satisfaction,
      value: avg.toFixed(2),
      target: `${goal.satisfaction} 以上`,
    },
    {
      label: '止まった月',
      ok: state.outages <= goal.maxOutageMonths,
      value: `${state.outages} 回`,
      target: `${goal.maxOutageMonths} 回以内`,
    },
  ];
}

export const END_LABEL: Record<EndReason, string> = {
  won: '目標達成',
  goal: '目標に届かず',
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

// ---- 次のプレイへのヒント（目標に届かなかったとき。D-40）----

export type RetryHint = {
  /** 原因の種類（画面のキー・テスト用）。 */
  kind:
    | 'limit'
    | 'incident'
    | 'policy'
    | 'cost'
    | 'overage'
    | 'element'
    | 'ogp'
    | 'slow'
    | 'commitment';
  /** 何が起きたか（何か月目に・数値）。 */
  what: string;
  /** 次に試せる方向。正解の構成名は出さない（事業者の制限・プラン名など事実の名前は出してよい。D-40）。 */
  next: string;
};

/** 月の並び（1 つなら「3 か月目」、続くなら「3〜5 か月目」、飛ぶなら「3・7 か月目」）。 */
function monthsText(ms: readonly number[]): string {
  if (ms.length === 1) return `${ms[0]} か月目`;
  const contiguous = ms.every((m, i) => i === 0 || m === ms[i - 1]! + 1);
  return contiguous
    ? `${ms[0]}〜${ms[ms.length - 1]} か月目`
    : ms.length <= 4
      ? `${ms.join('・')} か月目`
      : `${ms[0]} か月目から計 ${ms.length} か月`;
}

const ELEMENT_NEXT: Record<Exclude<Element, 'availability'>, string> = {
  speed:
    'ページの重さ（サーバーの処理・画像の大きさと種類）を設定や部品で軽くするか、処理の上限に余裕のある構成を考える',
  quality:
    '画像の画質が下がっている（記事のデザインの刷新など）。画像の部品と、原本を残しているかを見直す',
  freshness:
    'キャッシュの間隔や部品の性質で更新が遅れて見える。間隔を短くするか、更新がすぐ届く部品を考える',
  feature:
    '機能開発に回せる手間が期待に届かない。維持・出来事への対応・行動の手間を減らして、機能開発に回す',
};

/**
 * SPA で OGP の前処理なしに話題の月を迎えたときの、取り逃がした収益の見積もり（D-43）。
 * 行動の列は状態に残らないのでプレイを引き直せない。代わりに、カードが出ないことの効き方（socialCardFactor）だけを
 * 戻して記録から見積もる: 話題の月の広告の収益は 話題の伸び（× f）/ 小さくなった伸び（× (1 + (f − 1) × c)）倍、
 * それ以後の月は、話題の後に残る伸び（buzzLasting。その月の評判で）の比の倍になる。成長率・費用・上限への当たり方の
 * 変化は織り込まない（大きくなった流量で上限に当たる構成なら、この見積もりより少なくなる）。最初の該当の月だけを見る。
 */
function socialCardLoss(
  state: GameState,
):
  | { month: number; factor: number; reduced: number; extraRevenue: number }
  | undefined {
  const sc = scenarioOf(state);
  const c = sc.frameworks?.spa?.socialCardFactor ?? 1;
  if (c === 1) return undefined;
  const h = state.history;
  const ads = (r: MonthReport) => {
    const raw = (r.humanPV / 1000) * sc.revenue.adsUsdPer1000PV;
    const fixed = sc.revenue.fixedUsdPerMonth ?? 0;
    // 収益から契約の分を除き、止まった月などの減り方は広告と固定の分で同じとみなす
    return raw > 0
      ? ((r.revenue - r.contractRevenue) * raw) / (raw + fixed)
      : 0;
  };
  for (const r of h) {
    // その月に動いていたフレームワークで見る（作り直しで替わる。D-81）
    if ((r.framework ?? state.framework) !== 'vite-spa') continue;
    if (!r.buzz || r.components.ogp === 'prerender') continue;
    const effect = state.schedule
      .filter((x) => x.month === r.month)
      .flatMap((x) => eventDef(sc, x.id)?.effects ?? [])
      .find((e) => e.type === 'traffic' && e.social && e.lasting);
    if (!effect || effect.type !== 'traffic') continue;
    const factor = effect.factor;
    const reduced = 1 + (factor - 1) * c;
    const rep = r.satisfaction.reputation;
    const lastingRatio =
      buzzLasting(rep, sc.buzz) /
      buzzLasting(rep, { ...sc.buzz, extra: sc.buzz.extra * c });
    const extraRevenue =
      ads(r) * (factor / reduced - 1) +
      h
        .filter((x) => x.month > r.month)
        .reduce((a, x) => a + ads(x) * (lastingRatio - 1), 0);
    return { month: r.month, factor, reduced, extraRevenue };
  }
  return undefined;
}

/**
 * 次のプレイへのヒント（目標に届かなかったとき・途中で終わったとき。達成なら空）。
 * 未達の目標と終わり方ごとに、原因を月の記録（止まった月の前提・費用の内訳・満足度の理由・手間の内訳・出来事）から特定し、
 * 影響の大きい順に最大 3 つ返す。終わり方の直接の原因 → 未達の目標の原因 の順に並べる。
 */
export function retryHintsOf(state: GameState): RetryHint[] {
  if (state.phase !== 'lost' || !state.end) return [];
  const sc = scenarioOf(state);
  const h = state.history;
  const n = Math.max(1, h.length);
  const reason = state.end.reason;
  const early = reason !== 'goal';
  const cashShort = reason === 'cash' || (!early && state.cash < sc.goal.cash);
  const satShort = !early && averageSatisfaction(h) < sc.goal.satisfaction;
  const w = sc.satisfaction.weights;
  const out: { hint: RetryHint; score: number }[] = [];
  // 終わり方の直接の原因は 300 台、未達の目標の原因は 200 台、補足は 100 台（それぞれの中は影響の大きさ）
  const tier = (direct: boolean, metric: number) =>
    (direct ? 300 : 200) + Math.min(99, metric);

  // ① 前提（上限）に当たって止まった月
  const limits = new Map<
    string,
    {
      text: string;
      detail?: string;
      months: number[];
      ratio: number;
      accumulates: boolean;
    }
  >();
  for (const r of h) {
    if (r.status !== 'down') continue;
    for (const p of r.premises) {
      if (!p.hit || (p.effect !== 'block' && p.effect !== 'upgrade-required'))
        continue;
      const cur = limits.get(p.id) ?? {
        text: p.text,
        ...(p.detail !== undefined ? { detail: p.detail } : {}),
        months: [],
        ratio: 0,
        accumulates: p.accumulates ?? false,
      };
      cur.months.push(r.month);
      cur.ratio = Math.max(cur.ratio, p.ratio ?? 0);
      limits.set(p.id, cur);
    }
  }
  // 同じ方向の対策になる前提はまとめる（無料プランは同じ月に複数の上限に当たる）
  const groups = new Map<
    string,
    {
      months: Set<number>;
      items: { text: string; ratio: number; detail?: string }[];
      cause?: string;
    }
  >();
  for (const [id, l] of limits) {
    const crossing = h
      .flatMap((r) => r.crossings)
      .find((c) => c.premiseId === id && c.causes.length);
    const cause = crossing
      ? [...crossing.causes].sort((a, b) => a.ratioWithout - b.ratioWithout)[0]
      : undefined;
    // 原因は一時的な流量の出来事か、受けた提案（以後ずっと効く負荷・保存量の追加）のどちらか（crossingsOf）
    const permanent =
      cause !== undefined && eventDef(sc, cause.eventId)?.kind === 'proposal';
    const next = permanent
      ? l.accumulates
        ? '受けた提案で保存量が増え、上限を越えた。ためていく量は減らない。受ける前に容量との余裕を確かめるか、容量の大きいプラン・部品へ移す'
        : '受けた提案で以後の負荷が増え、上限を越えた。受ける前に上限との余裕を確かめるか、上限の大きいプラン・部品・設定で負荷を下げる'
      : cause
        ? cause.eventId === 'bot'
          ? 'Bot の大量アクセスで上限を越えた。Bot を遮断するか、上限に余裕のあるプラン・部品を考える'
          : '一時的に流量が増える出来事で上限を越えた。予告や前兆が来たら、前もって上限に余裕を作る'
        : l.accumulates
          ? 'ためていく量（保存量）は減らない。上限に届く前に、容量の大きいプラン・部品へ移すか、ためる量を減らす'
          : '込みの量・無料枠の上限に当たると止まる。上限の大きいプラン・部品に変えるか、設定・部品で量や処理を減らす';
    const g = groups.get(next) ?? { months: new Set<number>(), items: [] };
    l.months.forEach((m) => g.months.add(m));
    g.items.push({
      text: l.text,
      ratio: l.ratio,
      ...(l.detail !== undefined ? { detail: l.detail } : {}),
    });
    if (cause && !g.cause) g.cause = cause.title;
    groups.set(next, g);
  }
  const times = (r: number) =>
    r > 1 && Number.isFinite(r) ? `${r.toFixed(1)} 倍` : '';
  for (const [next, g] of groups) {
    const months = [...g.months].sort((a, b) => a - b);
    const items = [...g.items].sort((a, b) => b.ratio - a.ratio);
    const top = items[0]!;
    const by = g.cause ? `。「${g.cause}」が無ければ越えなかった` : '';
    const what =
      items.length === 1
        ? `${monthsText(months)}に「${top.text}」に当たって止まった${times(top.ratio) ? `。使用量は上限の ${times(top.ratio)}` : ''}${top.detail ? `。${top.detail}` : ''}${by}`
        : `${monthsText(months)}に止まった。当たった上限: ${items
            .slice(0, 2)
            .map(
              (x) =>
                `「${x.text}」${times(x.ratio) ? `（${times(x.ratio)}）` : ''}${x.detail ? `（${x.detail}）` : ''}`,
            )
            .join(
              '・',
            )}${items.length > 2 ? ` ほか ${items.length - 2} 件` : ''}${by}`;
    out.push({
      hint: { kind: 'limit', what, next },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? months.length * 10 + Math.min(9, top.ratio)
          : (100 * w.availability * months.length) / n,
      ),
    });
  }

  // ② 自前運用の偶発的な障害
  const incidents = h
    .filter((r) => r.status === 'incident')
    .map((r) => r.month);
  if (incidents.length)
    out.push({
      hint: {
        kind: 'incident',
        what: `${monthsText(incidents)}に自前運用のサーバーの障害で止まった（偶発的。1 台構成・SLA なし）`,
        next: '自前運用は偶発的に止まることがある。止まった回数の上限に余裕を残すか、障害の対応を事業者に任せられる構成を考える',
      },
      score: tier(
        reason === 'outages',
        reason === 'outages'
          ? incidents.length * 10
          : (100 * w.availability * incidents.length * 0.5) / n,
      ),
    });

  // ③ 規約違反（指摘の翌月も違反したまま）
  if (reason === 'policy') {
    // 停止につながった指摘は最後の指摘（一度解消して再び違反すると、指摘からやり直しになる。policyStep）
    const warned = h.findLast((r) => r.policyWarning);
    const p = warned?.premises.find((x) => x.hit && x.effect === 'policy');
    out.push({
      hint: {
        kind: 'policy',
        what: `${warned ? `${warned.month} か月目に運営元から規約違反の指摘${p ? `（${p.text}）` : ''}を受け、` : ''}${state.end.month} か月目も違反したままでアカウントが停止された`,
        next: '指摘が来た月のうちにプランを変えるか、乗り換えを始める（乗り換えの作業中は猶予される）。規約の条件は始める前に構成の説明で確かめられる',
      },
      score: tier(true, 99),
    });
  }

  // ④ 費用（所持金が足りない・尽きた）
  if (cashShort) {
    const byLabel = new Map<string, number>();
    const baseLabels = new Set<string>();
    const invLabels = new Set<string>();
    for (const r of h)
      for (const l of r.lines) {
        const v = l.currency === 'JPY' ? l.amount / USD_JPY : l.amount;
        if (v > 0) byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + v);
        if (l.kind === 'base-fee') baseLabels.add(l.label);
        if (l.meterId === INVALIDATION_METER) invLabels.add(l.label);
      }
    const top = [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const infra = h.reduce((a, r) => a + r.infraCost, 0);
    const revenue = h.reduce((a, r) => a + r.revenue, 0);
    const positive = [...byLabel.values()].reduce((a, v) => a + v, 0);
    const baseSum = [...byLabel]
      .filter(([k]) => baseLabels.has(k))
      .reduce((a, [, v]) => a + v, 0);
    const base = baseSum > positive / 2;
    const share = infra / Math.max(1, revenue);
    // オンデマンドの再検証の CloudFront の無効化が最も大きい費用（D-66）
    const inv = h.flatMap((r) =>
      r.lines.filter((l) => l.meterId === INVALIDATION_METER),
    );
    const invalidation =
      top[0] && invLabels.has(top[0][0])
        ? {
            paths: inv.reduce((a, l) => a + (l.quantity ?? 0), 0),
            usd: top[0][1],
          }
        : undefined;
    const shortText =
      reason === 'cash'
        ? `${state.end.month} か月目に所持金が尽きた`
        : `所持金 ${usd(state.cash)} で、目標 ${usd(sc.goal.cash)} に ${usd(sc.goal.cash - state.cash)} 足りない`;
    if (top.length)
      out.push({
        hint: {
          kind: 'cost',
          what: `${shortText}。${h.length} か月の収益 ${usd(revenue)} に対し、インフラの費用は ${usd(infra)}（${Math.round(100 * share)}%）で、大きいのは ${top.map(([k, v]) => `${k} ${usd(v)}`).join('・')}`,
          next: invalidation
            ? `オンデマンドの再検証で CloudFront の無効化が増えた（${h.length} か月で ${commas(invalidation.paths)} パス・${usd(invalidation.usd)}）。更新のたびにページごとに無効化するので、記事の更新が多い規模では高くつく。無効化が込みの定額のプラン・時間の再検証にする、または部品「CDN の無効化のまとめ方」でワイルドカードにまとめる${commentsInPage(commentsOf(sc, state.routeParts), state.framework, sc, state.routes) ? '。コメントを記事のページに含めているなら、ブラウザで読み込む形に戻すとコメントの投稿のたびの無効化が無くなる' : ''}`
            : share < 0.2
              ? `費用は収益に比べて小さく、差は収益（PV の伸び）の側にもある。伸びは満足度（評判）で決まるので、「良い」でない要素や止まった月を減らす。費用を削るなら、${base ? '規模に見合う基本料を見直す' : '設定・部品で量を下げる'}`
              : base
                ? '基本料（固定費）が費用の大半。今の規模に見合う基本料か、込みの量や席がそこまで要るかを見直す'
                : '使った分の費用が大きい。設定・部品で量（転送・変換・実行）を下げるか、込みの量の大きいプランと比べる',
        },
        score: tier(reason === 'cash', 50 + Math.min(49, 100 * share)),
      });
    // 込み分を超えて請求が付いた前提
    const over = new Map<string, { text: string; months: number[] }>();
    for (const r of h)
      for (const p of r.premises) {
        if (!p.hit || p.effect !== 'cost') continue;
        const cur = over.get(p.id) ?? { text: p.text, months: [] };
        cur.months.push(r.month);
        over.set(p.id, cur);
      }
    // 確約できた使用（D-97）: 対象の使用が半分以上の月で続き、確約を結ばなかった（補足。費用の差は小さいことが多い）
    const committed = new Set((state.commitments ?? []).map((c) => c.key));
    for (const d of COMMITMENTS) {
      if (committed.has(d.key)) continue;
      const ms = h.filter((r) => (r.commitmentEligible?.[d.key] ?? 0) > 0);
      if (ms.length < Math.ceil(n / 2)) continue;
      const offers = d.commitment.payments.flatMap(
        (p) => offerOf(d, p.payment, undefined, 12) ?? [],
      );
      const rate =
        d.commitment.kind === 'spend'
          ? Math.max(...d.commitment.payments.map((p) => p.discount ?? 0))
          : Math.max(0, ...offers.map((o) => o.discount));
      const sum = ms.reduce(
        (a, r) => a + usdOf(r.commitmentEligible![d.key]!, d.currency),
        0,
      );
      const saving = sum * rate;
      if (saving < 1) continue;
      out.push({
        hint: {
          kind: 'commitment',
          what: `${d.commitment.label}の対象の使用が ${ms.length} か月あった（オンデマンドで ${usd(sum)}）`,
          next: `1 年の確約で最大 ${Math.round(100 * rate)}% 安くなる（この ${ms.length} か月なら約 ${usd(saving)}）。確約は取り消せず、乗り換え・部品の切り替えで使わなくなっても支払いは残る。全額前払いは所持金から一度に引く`,
        },
        // 差は月に数ドルのことが多いので、ほかの補足（100 台）より下に置く（ほかに出すものが少ないときだけ出る）
        score: Math.min(99, saving),
      });
    }
    for (const o of over.values())
      out.push({
        hint: {
          kind: 'overage',
          what: `${o.months[0]} か月目から「${o.text}」を超え、超えた分が請求された`,
          next: '込みの量・クレジットを超えた分は使った分だけ請求される。設定・部品で量を下げるか、超えたときの単価をプランごとに比べる',
        },
        score: tier(false, 20 + o.months.length),
      });
  }

  // ⑦ 速さが「悪い」で PV の伸びが下がった月（離脱・検索からの流入。ゲーム上の仮定・D-47）
  if (cashShort) {
    const slow = h.filter((r) => (r.satisfaction.slowPenalty ?? 0) > 0);
    if (slow.length) {
      const pen = slow[0]!.satisfaction.slowPenalty!;
      const cut =
        1 - slow.reduce((a, r) => a * (1 - r.satisfaction.slowPenalty!), 1);
      out.push({
        hint: {
          kind: 'slow',
          what: `${monthsText(slow.map((r) => r.month))}、速さが悪く PV の伸びが下がった（1 か月あたり約 ${Math.round(pen * 100)}%・合わせて約 ${Math.round(cut * 100)}%。${(slow[0]!.satisfaction.reasons.speed ?? '').replace(/。速さが悪く PV の伸び.*$/, '')}）`,
          next: '速さを「悪い」から戻す: 画像を原本のまま配っていないか（1 ページの通信量）、SSR の重さ、ピークに詰まる前提を見直す',
        },
        // 合わせて 1 割未満なら補足（100 台）。大きいときは未達の原因として並べる
        score:
          cut >= 0.1
            ? tier(reason === 'cash', Math.min(99, 100 * cut))
            : 100 + Math.min(99, 100 * cut),
      });
    }
  }

  // ⑥ SPA で OGP の前処理なしに話題の月を迎えた（記事ごとの SNS のカードが出ず、伸びが小さい。D-43）
  if (cashShort) {
    const ogp = socialCardLoss(state);
    if (ogp) {
      const shortfall = Math.max(1, sc.goal.cash - state.cash);
      const platform = STACKS[state.stackIndex]!.provider;
      // VPS で前段の CDN が無いと、伸びた話題の月に回線が詰まりうる（話題は短い期間に集中する。D-44）
      const noFrontCdn =
        platform === 'sakura' &&
        (state.components.frontCdn ?? 'none') === 'none';
      out.push({
        hint: {
          kind: 'ogp',
          what: `${ogp.month} か月目の話題で、記事ごとの SNS のカードが出ないため伸びが小さかった（話題の伸び ${fmtFactor(ogp.factor)} → ${fmtFactor(ogp.reduced)}・ゲーム上の仮定）。前処理があれば、収益は約 +${usd(ogp.extraRevenue)} の見込み${noFrontCdn ? '（ただし前段の CDN が無いと、伸びた話題の月に回線が詰まりうるので、増えた分の一部が失われる）' : ''}`,
          next: `SNS のカード（OGP）の前処理の部品（${componentLabel(platform, 'ogp', 'prerender')}）を、話題の前に付ける${noFrontCdn ? '。前段の CDN も一緒に付けると、話題の月の回線の詰まりを避けられる' : ''}。または、記事ごとに HTML を返すフレームワークへ作り直す（大きな手間で数か月かかり、その間は機能開発がほぼ止まるので、話題に間に合うよう早めに）`,
        },
        // 影響額で比べる: 足りない額に対する、取り戻せた収益の割合（半分以上なら最上位）
        score: tier(
          reason === 'cash',
          50 + Math.min(49, (100 * ogp.extraRevenue) / shortfall),
        ),
      });
    }
  }

  // ⑤ 満足度の要素（満足度の目標・伸び＝収益にも効く。可用性は ①② で扱う）
  if (satShort || cashShort) {
    const eff = reflectionOf(state).effort;
    for (const e of ELEMENTS) {
      if (e === 'availability' || !w[e]) continue;
      const months = h.filter((r) => r.satisfaction.stages[e] !== 'good');
      if (!months.length) continue;
      const loss =
        h.reduce(
          (a, r) => a + w[e] * (1 - STAGE_VALUE[r.satisfaction.stages[e]]),
          0,
        ) / n;
      const last = months[months.length - 1]!;
      // 維持には他の事業者の管理（D-52）を含める
      const upkeepSum = eff.upkeep + (eff.accounts ?? 0);
      // 作り直し（D-81）に入れた手間。その間は機能開発がほぼ止まる
      const rewriteSum = h.reduce(
        (a, r) => a + (r.rewrite ? r.effort.migration : 0),
        0,
      );
      const spent = upkeepSum + eff.interrupt + rewriteSum;
      const effortText =
        e === 'feature' && spent > 0
          ? `。維持の手間 計 ${upkeepSum}・出来事への対応 計 ${eff.interrupt}${rewriteSum > 0 ? `・作り直し 計 ${rewriteSum}` : ''}（手間の合計 ${eff.total} の ${Math.round((100 * spent) / Math.max(1, eff.total))}%）`
          : '';
      const growth = satShort ? '' : '満足度は伸び（PV と収益）にも効く。';
      const rewriteNext =
        e === 'feature' && rewriteSum > 0
          ? '。作り直しの間は機能開発がほぼ止まるので、作り直すなら早い月に始めて、止まる月を短くする'
          : '';
      out.push({
        hint: {
          kind: 'element',
          what: `${ELEMENT_LABEL[e]}が「良い」でない月が ${months.length} か月${last.satisfaction.reasons[e] ? `（${last.month} か月目: ${last.satisfaction.reasons[e]}）` : ''}${effortText}`,
          next: growth + ELEMENT_NEXT[e] + rewriteNext,
        },
        score: satShort
          ? tier(false, 100 * loss)
          : 100 + Math.min(99, 100 * loss),
      });
    }
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.hint);
}

// ---- 基準プレイ（目標値の根拠・成績の目盛り。prd/07 §9.6・§10.8）----

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
export { nextRandom } from './random.ts';
export * from './rules.ts';
export * from './trends.ts';
export * from './scenario.ts';
export * from './save.ts';
export * from './estimate-mode.ts';
export * from './commitments.ts';
export { ARTICLE_COMMUNITY } from './scenarios/article-community.ts';
export {
  FRAMEWORKS,
  ROUTE_STRATEGIES,
  type FrameworkId,
  type RouteStrategyId,
} from 'catalog';
