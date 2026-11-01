// 見積モード（D-73）の入力の組み立て。料金の計算はしない（web が catalog の composeStack と estimator を直接呼ぶ）。
// ここが持つのは、ゲームと同じ数え方にそろえたい 2 つだけ: 選べる部品の規則（始める画面の setupSlots）と、
// テンプレートを PV・設定・部品で替えた Workload（ゲームの 1 か月目と同じ組み立て。workloadFor）。
import { DEFAULT_CHOICES, type Choices, type FrameworkId } from 'catalog';
import type { WorkloadInput } from 'estimator';
import {
  baseSsrCpuMsOf,
  frameworkDefaults,
  setupSlots,
  STACKS,
  validSetupChoices,
  workloadFor,
  type Settings,
} from './index.ts';
import type { Scenario } from './scenario.ts';

/**
 * 見積の部品。始める画面と同じ規則で選べるものだけを残し、選んでいないスロットは既定にする
 * （catalog の既定・フレームワークの既定がそのスロットの選択肢にあればそれ、無ければ最初の選択肢）。
 * chosen は選べるスロットの選択（URL に残す分）、components は構成に渡す全体（既定を含む。ゲームの newGame と同じ重ね方）。
 */
export function estimateComponents(
  sc: Scenario,
  stackIndex: number,
  framework: FrameworkId,
  choices: Choices = {},
): { chosen: Choices; components: Choices } {
  const platform = STACKS[stackIndex]!.provider;
  const base: Choices = {
    ...DEFAULT_CHOICES[platform],
    ...frameworkDefaults(framework, platform, sc),
  };
  let chosen = validSetupChoices(sc, stackIndex, framework, choices);
  // 選択でスロットが増減する（API を他の事業者に置くと DB のスロットが消える。D-65）ので、埋まるまで繰り返す
  for (let i = 0; i < 4; i++) {
    let filled = false;
    for (const x of setupSlots(sc, stackIndex, framework, chosen)) {
      const slot = x.slot;
      if (x.fixed || slot === 'files') continue;
      if (x.options.some((o) => o.id === chosen[slot])) continue;
      const def = base[slot];
      chosen = {
        ...chosen,
        [slot]: x.options.some((o) => o.id === def) ? def : x.options[0]!.id,
      };
      filled = true;
    }
    chosen = validSetupChoices(sc, stackIndex, framework, chosen);
    if (!filled) break;
  }
  return { chosen, components: { ...base, ...chosen } };
}

/**
 * 見積の Workload。シナリオのテンプレートを、提案の変化なし・SSR の最適化なし・在庫はテンプレートの値（PV に応じた既定）で、
 * PV・設定・部品を替えて作る（画像の形式・再検証・SPA と Astro への書き換え・部品が Workload を変えるもの）。
 */
export function estimateWorkload(
  sc: Scenario,
  p: {
    pv: number;
    stackIndex: number;
    framework: FrameworkId;
    components: Choices;
    settings: Omit<Settings, 'ssrOptimizations'>;
  },
): WorkloadInput {
  return workloadFor(sc, {
    pv: p.pv,
    settings: { ...p.settings, ssrOptimizations: 0 },
    ssrCpuMs: baseSsrCpuMsOf(sc),
    mods: {},
    stock: null,
    platform: STACKS[p.stackIndex]!.provider,
    components: p.components,
    framework: p.framework,
  });
}
