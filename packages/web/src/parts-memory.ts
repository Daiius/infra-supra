// 部品の選択の記憶（D-176）: 同じ事業者のプラン（Cloudflare の Free / Paid・Vercel の Hobby / Pro・さくらの VPS の 2GB / 4GB など、
// 構成の事業者のタブ。D-221）は部品の選択を共有する。
// 記憶は組ごとの生の選択で、今のプランで選べないもの（Vercel Pro だけの CDN のプランなど）も残す。計算・始める・見積に使うのは、
// その構成で選べるものだけ（validSetupChoices で絞った値）。ゲームの始める画面と見積モードで共用する。
import {
  frameworkOnStack,
  STACKS,
  validSetupChoices,
  type FrameworkId,
  type Scenario,
} from 'game';

type Choices = Partial<Record<string, string>>;

/** 組（事業者）ごとの、部品の生の選択。 */
export type PartsMemory = Partial<Record<string, Choices>>;

/** 構成の組: 土台の事業者（STACKS の provider）。構成の事業者のタブと同じ key。 */
export const stackGroupOf = (stackIndex: number): string =>
  STACKS[stackIndex]!.provider;

/**
 * 今の構成で部品を選び直したときの記憶: 選び直したスロット（前と値が違うもの）だけを書き換え、外れたスロットは消す。
 * 今のプランで選べずに残している記憶（見えていないスロット）は触らない（ほかの部品を選んでも消えない）。
 */
export function editParts(
  raw: Choices | undefined,
  prev: Choices,
  next: Choices,
): Choices {
  const out: Choices = { ...(raw ?? prev) };
  for (const slot of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (prev[slot] === next[slot]) continue;
    if (next[slot] === undefined) delete out[slot];
    else out[slot] = next[slot];
  }
  return out;
}

/**
 * 今の構成を離れるときの組の記憶: 今の選択に、記憶のうち今の構成では選べないもの（ほかのプランで選んだもの）を重ねる。
 * 今の構成で選べる記憶は、今の選択のほうが新しいので今の選択を使う。
 */
export function leaveParts(
  raw: Choices | undefined,
  current: Choices,
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
): Choices {
  const out: Choices = { ...current };
  for (const [slot, v] of Object.entries(raw ?? {})) {
    if (v === undefined || current[slot] === v) continue;
    const tried: Choices = validSetupChoices(scenario, stackIndex, framework, {
      ...current,
      [slot]: v,
    });
    const choosable = tried[slot] === v;
    if (!choosable) out[slot] = v;
  }
  return out;
}

/**
 * 構成を離れるときに今の組の記憶を書き戻した記憶（leaveParts）。今の構成の選択は current。
 */
export function rememberCurrent(
  memory: PartsMemory,
  current: Choices,
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
): PartsMemory {
  const g = stackGroupOf(stackIndex);
  return {
    ...memory,
    [g]: leaveParts(memory[g], current, scenario, stackIndex, framework),
  };
}

/**
 * シナリオ・フレームワークを替えたときの記憶: 組のどのプランでも選べなくなったものを落とす（戻しても復活しない。OCL-09D12A43）。
 * 組のどれかのプランで選べるものは残す（プランを替えて選べなくなっただけのものと同じ扱い）。今のフレームワークを載せられない
 * 構成は、選んだときに付け替わる先のフレームワーク（frameworkOnStack）で見る。
 */
export function prunePartsMemory(
  memory: PartsMemory,
  scenario: Scenario,
  framework: FrameworkId,
): PartsMemory {
  const out: PartsMemory = {};
  for (const [g, raw] of Object.entries(memory)) {
    if (!raw) continue;
    const plans = STACKS.filter(
      (s) => stackGroupOf(s.index) === g && !s.hidden,
    );
    const valid = (plans.length > 0 ? plans : STACKS).map((s): Choices =>
      validSetupChoices(
        scenario,
        s.index,
        frameworkOnStack(scenario, s.index, framework),
        raw,
      ),
    );
    const kept: Choices = {};
    for (const [slot, v] of Object.entries(raw))
      if (v !== undefined && valid.some((c) => c[slot] === v)) kept[slot] = v;
    out[g] = kept;
  }
  return out;
}

/**
 * その構成で使う部品（組の記憶を、その構成で選べるものだけに絞る）。組の記憶が無ければ undefined。
 * 今のフレームワークを載せられない構成は、選んだときに付け替わる先のフレームワークで見る。
 */
export function partsOfStack(
  memory: PartsMemory,
  scenario: Scenario,
  stackIndex: number,
  framework: FrameworkId,
): Choices | undefined {
  const raw = memory[stackGroupOf(stackIndex)];
  return raw
    ? validSetupChoices(
        scenario,
        stackIndex,
        frameworkOnStack(scenario, stackIndex, framework),
        raw,
      )
    : undefined;
}
