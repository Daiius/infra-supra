// 開発の手間: 毎月の維持・乗り換え・差し替え・書き直しに要る手間と、使える手間。
import type { Scenario } from './scenario.ts';
import type { Choices, FrameworkId, SlotId } from 'catalog';
import { effectiveSsrCpuMs, EFFORT } from './rules.ts';
import { accountLabel, accountUpkeepOf, newAccountsBy } from './accounts.ts';
import { baseSsrCpuMsOf, frameworkDefaults, scenarioOf } from './core.ts';
import { isDataSwap, selfBackupOf, selfHostedOf, STACKS } from './stacks.ts';
import type { ComponentSwap, GameState, Migration } from './state.ts';

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

export const accountUpkeepFor = (
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
) => accountUpkeepOf(state.stackIndex, state.components, state.framework);

/**
 * 動いている構成（乗り換え中は新旧両方）の維持の手間。両方が自前運用でも 1 回分。今の構成は部品（差し替えの途中の新しい部品を含む）
 * で VPS を使うときも自前運用（D-67）。乗り換え先は既定の部品から始まる。
 */
export function upkeepFor(
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

export function migrationWanted(m: Migration | null): number {
  return m ? Math.min(EFFORT.migrationPerMonth, m.required - m.done) : 0;
}

export function swapWanted(s: ComponentSwap | null): number {
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
export function rewriteWanted(
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

export const interruptOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && !i.featureWork ? i.points : 0),
    0,
  );
export const featureWorkOf = (state: Pick<GameState, 'interrupts'>) =>
  state.interrupts.reduce(
    (a, i) => a + (i.months > 0 && i.featureWork ? i.points : 0),
    0,
  );
export const featureBonusOf = (state: Pick<GameState, 'interrupts'>) =>
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
export function componentBaseEffort(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: Exclude<SlotId, 'db' | 'api'>,
  option: string,
): number {
  return selfBackupBy(state, slot, option)
    ? EFFORT.selfBackup.setup
    : EFFORT.component[slot];
}
