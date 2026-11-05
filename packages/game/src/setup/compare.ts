// 部品のスロットの比較（部品の ⓘ の表と月額の横棒。D-124）。スロットの選択肢ごとに、そのスロットだけ替えた見積を引き、
// 表の列（課金の形・上限・請求先のアカウント）を見積の結果から機械的に出す。選択肢に手で事実を書き足さない（出典のない数値を作らない）。
// ゲームの部品の欄（今月の基準の PV）・始める画面（1 か月目の見込みと同じ条件）・見積モード（web が見積を引いて analyzeSlot に渡す）で共有する。
import {
  type Choices,
  type ComponentProvider,
  componentsOf,
  type FrameworkId,
  type SlotId,
} from 'catalog';
import type { EstimateResult } from 'estimator';
import { accountLabel } from '../accounts.ts';
import { booksAt, DEFAULT_START_DATE, scenarioOf } from '../core.ts';
import { toUsd, usdOf } from '../format.ts';
import { pageWeightOf } from '../notes.ts';
import { partsOfComments } from '../routes/comments.ts';
import type { Scenario } from '../scenario.ts';
import { STACKS } from '../stacks.ts';
import type { GameState, RouteOverrides } from '../state.ts';
import { componentFlavor } from '../components.ts';
import { monthEstimate } from './estimates.ts';
import { newGame, setupSlots } from './new-game.ts';

/** 比べる選択肢（catalog の ComponentOption・始める画面の SetupOption の共通の形）。 */
export type SlotCompareOption = {
  id: string;
  slot: SlotId;
  platform: ComponentProvider;
  label: string;
  note: string;
};

/** 部品の上限の前提（止まる・遅くなる・プランの変更が要る）。 */
export type SlotCompareLimit = {
  text: string;
  effect: 'block' | 'throttle' | 'upgrade-required';
  hit: boolean;
  /** 今の規模での使用率（量の境目があるものだけ）。 */
  ratio?: number;
};

export type SlotCompareRow = {
  id: string;
  label: string;
  note: string;
  flavor?: string;
  /** 構成の事業者と別の事業者の部品か。 */
  other: boolean;
  /** その部品にしたときの構成全体の月の費用（USD・クレジットの後）。見積を引けなければ null。 */
  costUsd: number | null;
  /**
   * その部品だけが持つ課金のノードの明細（月額固定・従量（クレジットを差し引いた）・無料 / 込みの分を使ったか）。
   * どの選択肢にもある同じノードは数えない。部品が自分のノードを持たない（設定だけが替わる）ときは undefined。
   */
  charge?: { fixedUsd: number; usageUsd: number; allowance: boolean };
  /** その部品のノードに付く上限（止まる・遅くなる。量の境目のあるもの）。 */
  limits: SlotCompareLimit[];
  /** その部品のノードに付く事実の前提（料金データの文。アイドルで止まるなど）。 */
  facts: string[];
  /** 構成全体で、今の規模で当たって止まる・遅くなる前提の数。 */
  blocking: number;
  /** その部品の請求先のアカウント（added: 今の部品の構成に無いアカウント）。 */
  accounts: { id: string; label: string; added: boolean }[];
  /** スロット固有の添え書き（画像は 1 ページの通信量）。 */
  extra?: string;
};

const LIMIT_EFFECTS = new Set(['block', 'throttle', 'upgrade-required']);

/** 課金のノードの見分け（同じ id でも請求先・プランが違えば別のノード）。 */
const nodeKey = (
  n: EstimateResult['simulation']['architecture']['nodes'][number],
) =>
  n.billing ? `${n.id}|${n.billing.accountId}|${n.billing.planId}` : undefined;

/**
 * 選択肢ごとの見積の結果から、表の行を作る（純粋関数。見積は呼び出し側が引く）。
 * - charge: その選択肢の見積にあって、他のどれかの選択肢の見積に無い課金のノード（部品のノード）の明細
 * - limits・facts: 部品のノードに付く前提
 * - accounts: 部品のノードの請求先。今の選択肢（current）の構成に無ければ added
 */
export function analyzeSlot(p: {
  options: readonly SlotCompareOption[];
  /** options と同じ順の見積（引けなかった選択肢は null）。 */
  results: readonly (EstimateResult | null)[];
  /** 今の部品（構成の土台の事業者。他の事業者の部品の見分けに使う）。 */
  current: string | undefined;
  provider: string;
  extra?: (option: string) => string | undefined;
}): SlotCompareRow[] {
  const keysOf = (r: EstimateResult) =>
    new Set(
      r.simulation.architecture.nodes.flatMap((n) => {
        const k = nodeKey(n);
        return k ? [k] : [];
      }),
    );
  const valid = p.results.filter((r): r is EstimateResult => r !== null);
  const keySets = valid.map(keysOf);
  // どの選択肢にもある課金のノード（選択肢が 1 つしか引けなければ、部品のノードを見分けられない）
  const common =
    keySets.length > 1
      ? new Set([...keySets[0]!].filter((k) => keySets.every((s) => s.has(k))))
      : undefined;
  const currentIndex = p.options.findIndex((o) => o.id === p.current);
  const currentResult =
    currentIndex >= 0 ? (p.results[currentIndex] ?? null) : null;
  const currentAccounts = new Set(
    currentResult
      ? currentResult.simulation.architecture.nodes.flatMap((n) =>
          n.billing ? [n.billing.accountId] : [],
        )
      : [],
  );
  return p.options.map((o, i) => {
    const r = p.results[i] ?? null;
    const flavor = componentFlavor(o);
    const extra = p.extra?.(o.id);
    const base = {
      id: o.id,
      label: o.label,
      note: o.note,
      ...(flavor ? { flavor } : {}),
      other: o.platform !== p.provider,
      ...(extra ? { extra } : {}),
    };
    if (!r)
      return {
        ...base,
        costUsd: null,
        limits: [],
        facts: [],
        blocking: 0,
        accounts: [],
      };
    const own = r.simulation.architecture.nodes.filter((n) => {
      const k = nodeKey(n);
      return k !== undefined && common !== undefined && !common.has(k);
    });
    const ownIds = new Set(own.map((n) => n.id));
    const onOwn = (ids: readonly string[]) =>
      ids.length > 0 && ids.every((id) => ownIds.has(id));
    let charge: SlotCompareRow['charge'];
    if (own.length > 0) {
      const lines = r.bill.lines.filter((l) => onOwn(l.nodeIds));
      const sum = (ls: typeof lines) =>
        ls.reduce((a, l) => a + usdOf(l.amount ?? 0, l.currency), 0);
      charge = {
        fixedUsd: sum(lines.filter((l) => l.kind === 'base-fee')),
        usageUsd: sum(lines.filter((l) => l.kind !== 'base-fee')),
        allowance: lines.some(
          (l) => l.kind === 'usage' && (l.allowanceApplied ?? 0) > 0,
        ),
      };
    }
    const ownPremises = r.premises.filter((q) =>
      q.nodeIds.some((id) => ownIds.has(id)),
    );
    const limits: SlotCompareLimit[] = ownPremises
      .filter((q) => q.kind === 'threshold' && LIMIT_EFFECTS.has(q.effect))
      .map((q) => ({
        text: q.detail ? `${q.text}（${q.detail}）` : q.text,
        effect: q.effect as SlotCompareLimit['effect'],
        hit: q.hit,
        ...(q.ratio !== undefined ? { ratio: q.ratio } : {}),
      }))
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    const facts = [
      ...new Set(
        ownPremises.filter((q) => q.kind === 'fact').map((q) => q.text),
      ),
    ];
    const accounts = [
      ...new Set(own.flatMap((n) => (n.billing ? [n.billing.accountId] : []))),
    ].map((id) => ({
      id,
      label: accountLabel(id),
      added: currentResult !== null && !currentAccounts.has(id),
    }));
    return {
      ...base,
      costUsd: toUsd(r.bill.totals),
      ...(charge ? { charge } : {}),
      limits,
      facts,
      blocking: r.premises.filter((q) => q.hit && LIMIT_EFFECTS.has(q.effect))
        .length,
      accounts,
    };
  });
}

/** 見積を引く（組めない組み合わせは null。表の行は「計算できない」と出す）。 */
function tryEstimate(f: () => EstimateResult): EstimateResult | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/**
 * ゲームの部品の欄の比較: 今月の基準の PV と今の他の部品で、そのスロットだけ各選択肢に替えた月の見積（componentPreview と同じ条件）。
 * current は画面の今の部品（componentSlots の current。既定を重ねたもの）。
 */
export function componentComparison(
  state: GameState,
  slot: SlotId,
  current: string,
): SlotCompareRow[] {
  const sc = scenarioOf(state);
  const provider = STACKS[state.stackIndex]!.provider;
  const options = componentsOf(provider, slot, state.framework);
  const books = booksAt(state, state.history.length + 1);
  const components = { ...state.components, [slot]: current };
  return analyzeSlot({
    options,
    results: options.map((o) =>
      tryEstimate(() =>
        monthEstimate(sc, state, {
          components: { ...components, [slot]: o.id },
          books,
        }),
      ),
    ),
    current,
    provider,
    ...(slot === 'images'
      ? { extra: (id: string) => `${pageWeightOf(state, id)}・画像込み` }
      : {}),
  });
}

/**
 * 始める画面の比較: 1 か月目の見込み（setupMonthOneEstimate）と同じ条件で、そのスロットだけ各選択肢に替えた月の見積。
 * components は選んだ部品（未選択のスロットは既定で数える）。current は選んでいる部品（未選択なら undefined で、差を出さない）。
 */
export function setupComponentComparison(
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  components: Choices,
  /** スロット（始める画面のスロットの id。ファイルの置き場などの比べないスロットは空の行）。 */
  slot: string,
  opts: {
    revalidateSec?: number | undefined;
    comments?: number | undefined;
    routes?: RouteOverrides | undefined;
  } = {},
): SlotCompareRow[] {
  const options =
    setupSlots(scenario, stackIndex, framework, components).find(
      (x) => x.slot === slot,
    )?.options ?? [];
  const stateWith = (c: Choices) =>
    newGame(
      stackIndex,
      1,
      scenario,
      DEFAULT_START_DATE,
      framework,
      c,
      opts.revalidateSec,
      partsOfComments(scenario, opts.comments),
      undefined,
      opts.routes,
    );
  return analyzeSlot({
    options: options.map((o) => ({ ...o, slot: slot as SlotId })),
    results: options.map((o) =>
      tryEstimate(() => {
        const state = stateWith({ ...components, [slot]: o.id });
        return monthEstimate(scenario, state, { books: booksAt(state, 1) });
      }),
    ),
    current: components[slot as SlotId],
    provider: STACKS[stackIndex]!.provider,
    ...(slot === 'images'
      ? {
          extra: (id: string) =>
            `${pageWeightOf(stateWith({ ...components, images: id }), id)}・画像込み`,
        }
      : {}),
  });
}
