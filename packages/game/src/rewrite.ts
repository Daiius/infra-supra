// フレームワークの書き直し（部品・設定の引き継ぎと表示）。
import {
  apiPlacedElsewhere,
  type Choices,
  componentsOf,
  DEFAULT_CHOICES,
  deployTarget,
  type FrameworkId,
  FRAMEWORKS,
  SLOT_LABELS,
  type SlotId,
} from 'catalog';
import { EFFORT } from './rules.ts';
import { proposalOnlyComponent } from './components.ts';
import { frameworkDefaults, frameworksOf, scenarioOf } from './core.ts';
import { rewriteEffort, rewriteWanted } from './effort.ts';
import { revalidateSettingOf } from './routes/hidden-settings.ts';
import { DEFAULT_REVALIDATE_SEC, SETTINGS } from './settings.ts';
import { validSetupChoices } from './setup/new-game.ts';
import { componentLabel, STACKS, stackSupports } from './stacks.ts';
import type { GameState, Rewrite } from './state.ts';

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
export function revalidateAfterRewrite(revalidateSec: number, to: FrameworkId) {
  return SETTINGS[revalidateSettingOf(to)].options.some(
    (o) => o.value === revalidateSec,
  )
    ? revalidateSec
    : DEFAULT_REVALIDATE_SEC;
}

/** 作り直せないとき、その理由（今の構成の事業者に新しいフレームワークを載せられない）。載せられれば undefined。 */
export function rewriteUnsupported(
  stackIndex: number,
  to: FrameworkId,
): string | undefined {
  if (stackSupports(stackIndex, to)) return undefined;
  const note = deployTarget(to, STACKS[stackIndex]!.provider)?.note;
  return `今の構成に ${FRAMEWORKS[to].label} を載せる公式のアダプターがありません${note ? `（${note}）` : ''}`;
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
      `アプリを ${FRAMEWORKS[to].label} で作り直します（事業者はそのまま）。作業の間は今のアプリのまま動き、` +
      `手間を入れ終えた翌月から新しいフレームワークの費用・満足度（SNS のカード・初回表示・鮮度）になります。` +
      `毎月の手間のうち最大 ${per} を作り直しに回すので、その間の機能開発はほぼ止まります（満足度の「機能」が下がります）。` +
      `構成の乗り換え・部品の差し替えとは同時に進められません。新しいフレームワークで選べない部品は既定に戻り、` +
      `API の置き場は同じ事業者に置ける選択肢があれば維持します。` +
      (lost.length
        ? `替わる部品: ${lost
            .map(
              (slot) =>
                `${SLOT_LABELS[slot]}（${componentLabel(platform, slot, state.components[slot])} → ${componentLabel(platform, slot, after[slot])}）`,
            )
            .join('・')}。`
        : '') +
      (months > left ? `残り ${left} か月では済まない見込みです。` : '') +
      `手間の大きさはゲーム上の仮定です。`,
  };
}

export function newRewrite(
  state: Pick<GameState, 'framework'>,
  to: FrameworkId,
): Rewrite {
  return { from: state.framework, to, required: rewriteEffort(), done: 0 };
}
