// ゲームエンジン（Phase 3 の最初の形。spikes/game-2026-10-31 から移し、GD-2 で満足度と開発の手間、GD-3 でシナリオのデータと出来事を足した）。
// 純粋関数: 状態を受け取り、新しい状態を返す。
// 料金・前提は estimator と catalog（実データ）をそのまま使い、ゲームのために料金を作らない（企画書 §11.1）。
// シナリオの値（収益・成長・手間・満足度・障害の影響・出来事・目標）はゲーム上の仮定で、実在の値ではない（prd/07 §10）。
//
// このファイルは公開の口（barrel）だけを持つ。実装は関心ごとのモジュールに分けてある（web・テストはここから読む）。
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
  fixedImageFormat,
  type FixedImageFormat,
  SETTINGS,
  type SettingKey,
  deliveredImageKB,
  deliveredThumbnailKB,
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
  stackUnsupportedReason,
  frameworkOnStack,
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
  accountAllowanceOf,
  otherAccounts,
  droppedAccountsBy,
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
  legacyDefaultRevalidateSec,
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
  editsReflectImmediately,
  meetsRequirement,
  onDemandBlocker,
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
export {
  setupCommitments,
  componentSlots,
  type SetupOption,
  type SetupSlot,
  setupSlots,
  validSetupChoices,
  setupProblem,
  setupMissingSlots,
  setupWithDefaults,
  newGame,
} from './setup/new-game.ts';
export {
  upkeepOf,
  rewriteEffort,
  effortAvailable,
  effortTotalOf,
  effortTotalNote,
  nextSsrCpuMs,
  componentEffortLabel,
} from './effort.ts';
export { IMAGE_REDESIGN_ID, acceptSummary, describeEffect } from './events.ts';
export {
  type FeatureOutlook,
  type FeatureProgress,
  featureOutlook,
  featureProgressOf,
  featureRuleText,
} from './feature-outlook.ts';
export {
  componentsAfterRewrite,
  rewriteTargets,
  rewriteText,
} from './rewrite.ts';
export {
  settingInactiveReason,
  imageFormatInactiveReason,
  fixedSettingValue,
  settingNote,
  routePartNote,
  pageWeightOf,
} from './notes.ts';
export {
  type ResolvedRegion,
  pageWireframes,
  scenarioOffscreen,
  scenarioWireframes,
} from './wireframes.ts';
export {
  type RouteAlternative,
  type RoutePlanRow,
  type RoutePartRow,
  type RoutePlanInput,
  routePlanRows,
  routePlanOf,
  routeAlternativeAction,
  resolvedRouteStrategies,
} from './routes/plan.ts';
export {
  type RouteFallback,
  routeFallbacks,
  routeFallbackNotice,
  stackChangeRouteFallbacks,
  rewriteRouteFallbacks,
  stackChangeRouteNotice,
  rewriteRouteNotice,
  setupRouteNotice,
  type SetupRouteState,
  setupRouteFallbacks,
} from './routes/fallbacks.ts';
export {
  componentPreview,
  type InvalidationEstimate,
  onDemandInvalidationEstimate,
  setupInvalidationEstimate,
  invalidationNote,
  type MonthOneEstimate,
  setupMonthOneEstimate,
} from './setup/estimates.ts';
export {
  analyzeSlot,
  componentComparison,
  setupComponentComparison,
  type SlotCompareLimit,
  type SlotCompareOption,
  type SlotCompareRow,
} from './setup/compare.ts';
export {
  BOT_BLOCK,
  type ActionBlockReason,
  type ActionCheck,
  actionEffort,
  checkAction,
} from './actions/check.ts';
export { checkActions, applyAction, applyActions } from './actions/apply.ts';
export { averageSatisfaction } from './month/satisfaction.ts';
export { playMonth, projectionNote } from './month/play.ts';
export {
  type RouteRowStatus,
  type RouteSetup,
  routePlanStatus,
} from './routes/status.ts';
export {
  type Axes,
  axesOf,
  type Check,
  goalChecks,
  END_LABEL,
  type Surprise,
  type Reflection,
  surprisesOf,
  reflectionOf,
  BASELINES,
  playStrategy,
  type ComparisonRow,
  comparisonRows,
} from './review.ts';
export { type RetryHint, retryHintsOf } from './hints.ts';
export {
  isPolicyViolation,
  type PolicyCause,
  policyCauseOf,
  premisePlanLabel,
} from './policy-cause.ts';
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
