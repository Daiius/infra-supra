// 始める画面の部品の選択（D-45）と、ゲームを始める（newGame）。部品の欄（componentSlots）もここに置く（setupSlots が使う）。
import { rollRevisions, rollSchedule, type Scenario } from '../scenario.ts';
import {
  type Choices,
  type ComponentProvider,
  componentsOf,
  DEFAULT_CHOICES,
  FILE_STORAGE_LABEL,
  fileStorageOf,
  type FrameworkId,
  SLOT_LABELS,
  type SlotId,
} from 'catalog';
import { ARTICLE_COMMUNITY } from '../scenarios/article-community.ts';
import type { ActiveCommitment, CommitmentPaymentId } from '../commitments.ts';
import { componentConflict, proposalOnlyComponent } from '../components.ts';
import {
  DEFAULT_START_DATE,
  frameworkDefaults,
  frameworksOf,
  scenarioOf,
  scenarioSendsEmail,
  SCHEDULED_CHANGES,
} from '../core.ts';
import {
  type CommitmentOffer,
  COMMITMENTS,
  newCommitment,
  offersFor,
} from '../offers.ts';
import { commentsOf, withComments } from '../routes/comments.ts';
import { defaultRevalidateSec } from '../routes/hidden-settings.ts';
import { validRouteOverrides } from '../routes/strategy.ts';
import { slotIneffective, STACKS, stackSupports } from '../stacks.ts';
import type { GameState, RouteOverrides, RouteParts } from '../state.ts';
import { architectureFor, initialStock } from '../workload.ts';
import { setupCommentOptions, setupRevalidateOptions } from './options.ts';

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
  /** 部品ごとにキャッシュを既定にする前の既定で描き方を決める（保存の版 3 までの再生だけ。D-111）。 */
  legacyRouteDefaults?: boolean,
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
    ? validRouteOverrides(
        scenario,
        stackIndex,
        app,
        routes,
        legacyRouteDefaults,
      )
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
    ...(legacyRouteDefaults ? { legacyRouteDefaults: true } : {}),
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
