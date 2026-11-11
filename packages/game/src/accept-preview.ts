// 提案を受けたときの、止まりうる上限の見込み（D-203）。今月選んでいる行動を当てた状態（受けない）と、
// そこに「受ける」の効果を当てた状態の見積を、今の規模（基準の PV）で比べる。表示のためだけで、ゲームの状態には入れない。
// 推移の外挿（premiseTrends）とは別で、出来事の効果をそのまま当てた見積から出す。
import type { PlatformPremise } from 'estimator';
import { applyActions } from './actions/apply.ts';
import { booksAt, eventDef, scenarioOf } from './core.ts';
import { applyEffects } from './events.ts';
import { emailOnlyPremise, isStopEffect, stopsSite } from './month/outcome.ts';
import { stockOf } from './month/transitions.ts';
import { monthEstimate } from './setup/estimates.ts';
import { isPlanChange, STACKS, storageOptionAddon } from './stacks.ts';
import type { Action, GameState } from './state.ts';

/** 提案の効果に関わる、止まりうる上限 1 つの見込み。used の単位は unit（gb など）。 */
export type AcceptLimit = {
  id: string;
  /** 前提の文（catalog のまま）。 */
  text: string;
  unit?: PlatformPremise['unit'];
  effect: PlatformPremise['effect'];
  limit: number;
  /** 受けない来月の使用量（今月選んでいる行動を当てた状態）。 */
  before: number;
  /** 受けた来月の使用量。 */
  after: number;
  /** 受けると来月止まる（month/outcome.ts の stopsSite と同じ規則）。 */
  stops: boolean;
  /**
   * 止まるとき、同じ事業者のプラン変更かストレージ変更オプションで止まらなくなるか（引き上げられるか）。止まらないなら undefined。
   */
  raisable?: boolean;
  /**
   * 来月は止まらないが、今の規模のまま残りの月のうちに止まる見込みのとき、今から何か月後か（来月 = 1）。
   * ためていく量（保存量）だけ。見込めない・届かないなら undefined（monthsUntilLimit）。
   */
  monthsUntil?: number;
};

/** 使用量が変わったとみなす差（表示の丸めより十分小さい）。 */
const EPSILON = 1e-9;

/** プラン（catalog の planId）を伏せた前提の id（プランを変えても同じ上限を指すように）。 */
function limitKey(p: Pick<PlatformPremise, 'id' | 'planId'>): string {
  return p.planId ? p.id.replace(`:${p.planId}:`, ':*:') : p.id;
}

/**
 * 提案を受けたときの、提案の premiseRefs に当たる止まりうる上限（止まる・プランの変更が要る量の境目）の見込み。
 * 受けても使用量が変わらない上限は出さない。提案でない・受ける効果が無いなら空。
 * actions: 今月選んでいる行動（プラン変更・ストレージ変更オプションなど）。この提案への返事は除いて当てる。
 */
export function acceptPreview(
  state: GameState,
  eventId: string,
  actions: readonly Action[] = [],
): AcceptLimit[] {
  const sc = scenarioOf(state);
  const def = eventDef(sc, eventId);
  if (!def?.accept || def.premiseRefs.length === 0) return [];
  const base = applyActions(
    state,
    actions.filter((a) => !(a.type === 'respond' && a.eventId === eventId)),
  );
  const after = applyEffects(base, def.accept.effects, def.id);
  const books = booksAt(state, state.history.length + 1);
  const rb = monthEstimate(sc, base, { books });
  const ra = monthEstimate(sc, after, { books });
  const relevant = (p: PlatformPremise) =>
    p.kind === 'threshold' &&
    isStopEffect(p.effect) &&
    !emailOnlyPremise(p) &&
    p.used !== undefined &&
    p.limit !== undefined &&
    def.premiseRefs.some((ref) => p.id.startsWith(ref));
  const out: AcceptLimit[] = [];
  for (const p of ra.premises) {
    if (!relevant(p)) continue;
    const before = rb.premises.find((q) => q.id === p.id)?.used ?? 0;
    if (Math.abs(p.used! - before) <= EPSILON * Math.max(1, p.limit!)) continue;
    const stops = stopsSite(p);
    out.push({
      id: p.id,
      text: p.text,
      ...(p.unit !== undefined ? { unit: p.unit } : {}),
      effect: p.effect,
      limit: p.limit!,
      before,
      after: p.used!,
      stops,
    });
  }
  if (out.length === 0) return out;
  // 止まるなら、引き上げられるか（同じ事業者のプラン変更・ストレージ変更オプションで止まらなくなるか）
  if (out.some((x) => x.stops)) {
    const alts = raiseAlternatives(after).map(
      (s) => monthEstimate(sc, s, { books }).premises,
    );
    for (const x of out) {
      if (!x.stops) continue;
      const key = limitKey(ra.premises.find((p) => p.id === x.id)!);
      x.raisable = alts.some(
        (ps) => !ps.some((p) => limitKey(p) === key && stopsSite(p)),
      );
    }
  }
  const until = monthsUntilLimit(after, ra.premises);
  for (const x of out) {
    if (x.stops) continue;
    const n = until.get(x.id);
    if (n !== undefined) x.monthsUntil = n;
  }
  return out;
}

/** 止まる上限を引き上げうる、同じ事業者のほかのプランとストレージ変更オプションを当てた状態。 */
function raiseAlternatives(state: GameState): GameState[] {
  const plans = STACKS.filter((s) =>
    isPlanChange(state.stackIndex, s.index),
  ).map((s): GameState => ({ ...state, stackIndex: s.index }));
  const storage =
    storageOptionAddon(state.stackIndex) && !state.storageOption
      ? [{ ...state, storageOption: true }]
      : [];
  return [...plans, ...storage];
}

/**
 * 今の規模（基準の PV）のまま月を重ねたとき、ためていく量（保存量）の止まりうる上限に届くのが今から何か月後か（来月 = 1）。
 * 1 か月分の在庫の伸び（playMonth と同じ stockOf）を当てた見積との差を 1 か月の増分とし、まっすぐ伸ばす。
 * 残りの月（シナリオの最後の月まで）に届かない・増えない・来月すでに当たっているものは入れない。
 */
export function monthsUntilLimit(
  state: GameState,
  premises: readonly PlatformPremise[] = monthEstimate(
    scenarioOf(state),
    state,
    { books: booksAt(state, state.history.length + 1) },
  ).premises,
): Map<string, number> {
  const out = new Map<string, number>();
  const sc = scenarioOf(state);
  if (!sc.stock) return out;
  const next = state.history.length + 1;
  const watched = premises.filter(
    (p) =>
      p.kind === 'threshold' &&
      p.accumulates &&
      !p.hit &&
      isStopEffect(p.effect) &&
      p.used !== undefined &&
      p.limit !== undefined,
  );
  if (watched.length === 0 || next >= sc.months) return out;
  const grown: GameState = {
    ...state,
    stock: stockOf(sc, state, state.basePV, undefined).stock,
  };
  const later = monthEstimate(sc, grown, {
    books: booksAt(state, next + 1),
  }).premises;
  for (const p of watched) {
    const q = later.find((x) => x.id === p.id);
    const step = (q?.used ?? p.used!) - p.used!;
    if (!(step > 0)) continue;
    // 来月から k か月重ねた月に当たる（当たるのは used > limit。estimator の threshold と同じ）
    const k = Math.floor((p.limit! - p.used!) / step) + 1;
    if (next + k <= sc.months) out.set(p.id, k + 1);
  }
  return out;
}
