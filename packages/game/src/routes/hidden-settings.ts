// 描き方とフレームワークで意味の無い設定（隠す設定）と、revalidateSec を何の設定として出すか。
import {
  type Choices,
  deployTarget,
  type FrameworkId,
  rebuildsStaticPages,
} from 'catalog';
import { onDemandBlocker } from '../requirements.ts';
import type { Scenario } from '../scenario.ts';
import {
  DEFAULT_REVALIDATE_SEC,
  ON_DEMAND_REVALIDATE,
  type SettingKey,
} from '../settings.ts';
import { STACKS } from '../stacks.ts';
import type { GameState, RouteOverrides, StrategyFamily } from '../state.ts';
import { articleFamily } from './strategy.ts';

/**
 * 画面に出さず、選べない設定（シナリオで効かないもの + 記事の描き方で意味の無いもの。prd/10・OCL-8DFFDBEC・D-37・D-107）。
 * revalidateSec は記事の描き方ごとの意味で 1 つだけ出す（S1 はビルドの間隔・S2/S3 は ISR の再検証か Astro の記事のキャッシュ・
 * SPA の S5 は API のキャッシュの期間。毎回描く S4 と、API の応答のキャッシュの無い S5 では出さない）。
 */
export function hiddenSettings(
  state: Pick<GameState, 'framework' | 'scenario'> & {
    routes?: RouteOverrides | undefined;
  },
): SettingKey[] {
  const fromScenario: SettingKey[] = [
    ...(state.scenario.hidden?.settings ?? []),
  ];
  const fam = articleFamily(state);
  const byFramework =
    fam === undefined
      ? FRAMEWORK_HIDDEN_SETTINGS[state.framework]
      : hiddenByFamily(state.framework, fam);
  return [...new Set([...fromScenario, ...byFramework])];
}

const REVALIDATE_KEYS: SettingKey[] = [
  'isr',
  'apiCacheTtl',
  'buildInterval',
  'pageCache',
];

/** 記事の描き方で意味の無い設定（D-107。フレームワークの既定では FRAMEWORK_HIDDEN_SETTINGS と同じになる）。 */
function hiddenByFamily(
  framework: FrameworkId,
  fam: StrategyFamily,
): SettingKey[] {
  const visible = revalidateKeyFor(framework, fam);
  return REVALIDATE_KEYS.filter((k) => k !== visible);
}

/** 記事の描き方での revalidateSec の意味（出さないなら undefined）。 */
function revalidateKeyFor(
  framework: FrameworkId,
  fam: StrategyFamily,
): SettingKey | undefined {
  switch (fam) {
    case 'static':
      return 'buildInterval';
    case 'cached':
      return framework === 'astro' ? 'pageCache' : 'isr';
    case 'api':
      // API の応答のキャッシュ（D-37）は SPA の部品だけ
      return framework === 'vite-spa' ? 'apiCacheTtl' : undefined;
    default:
      return undefined;
  }
}

/** フレームワークで意味の無い設定（記事のページの無いシナリオ。revalidateSec をフレームワークごとの意味で 1 つだけ出す。D-37・D-68）。 */
const FRAMEWORK_HIDDEN_SETTINGS: Record<FrameworkId, SettingKey[]> = {
  nextjs: ['apiCacheTtl', 'buildInterval', 'pageCache'],
  'vite-spa': ['isr', 'buildInterval', 'pageCache'],
  astro: ['isr', 'apiCacheTtl', 'buildInterval'],
  'nextjs-export': ['isr', 'apiCacheTtl', 'pageCache'],
};

/**
 * revalidateSec を何の設定として出すか（ISR の間隔・API のキャッシュの期間・ビルドの間隔・Astro の記事のキャッシュ。D-103）。
 * 記事の描き方（fam）を渡すとそれで決める（D-107）。省略はフレームワークの既定。
 */
export function revalidateSettingOf(
  framework: FrameworkId,
  fam?: StrategyFamily,
): SettingKey {
  if (fam !== undefined) return revalidateKeyFor(framework, fam) ?? 'isr';
  return framework === 'vite-spa'
    ? 'apiCacheTtl'
    : framework === 'astro'
      ? 'pageCache'
      : rebuildsStaticPages(framework)
        ? 'buildInterval'
        : 'isr';
}

/**
 * 始めるときの revalidateSec の既定（D-103・D-125）。記事のキャッシュの再検証（Next.js の ISR・部品ごとにキャッシュの部品の作り直し・
 * Astro の記事のキャッシュ）は、今の置き場・部品でオンデマンドが選べるならオンデマンド（記事の更新のとき）、選べなければ（onDemandBlocker。
 * Cloudflare の ISR を KV に置く・Google Cloud の Hosting の CDN の Astro など）5 分。静的書き出しのビルドの間隔・SPA の API の
 * キャッシュの期間・設定を出さないシナリオ（受託）は 5 分のまま（ビルドの回数・オンデマンドの無い設定。D-125）。
 * 部品（components）は始める画面の選択（未選択のスロットは既定の部品とみる。onDemandBlocker と同じ）。
 */
export function defaultRevalidateSec(
  framework: FrameworkId,
  stackIndex: number,
  /** 設定を出さないシナリオ（受託）では 5 分のまま。省略はフレームワークの既定の描き方で決める。 */
  scenario?: Scenario,
  routes?: RouteOverrides,
  components?: Choices,
): number {
  const fam = scenario
    ? articleFamily({ scenario, framework, routes })
    : undefined;
  const key = revalidateSettingOf(framework, fam);
  if (key !== 'isr' && key !== 'pageCache') return DEFAULT_REVALIDATE_SEC;
  if (scenario && hiddenSettings({ scenario, framework, routes }).includes(key))
    return DEFAULT_REVALIDATE_SEC;
  if (!STACKS[stackIndex]) return DEFAULT_REVALIDATE_SEC;
  return onDemandBlocker(stackIndex, components, framework, fam) === undefined
    ? ON_DEMAND_REVALIDATE
    : DEFAULT_REVALIDATE_SEC;
}

/**
 * D-125 より前の revalidateSec の既定（Astro の記事のキャッシュは消せる置き場ならオンデマンド、ほかは 5 分。D-103）。
 * revalidateSec を持たない古い保存を、遊んだときと同じ既定で再生するのに使う。
 */
export function legacyDefaultRevalidateSec(
  framework: FrameworkId,
  stackIndex: number,
  scenario?: Scenario,
  routes?: RouteOverrides,
): number {
  if (framework !== 'astro') return DEFAULT_REVALIDATE_SEC;
  if (
    scenario &&
    hiddenSettings({ scenario, framework, routes }).includes('pageCache')
  )
    return DEFAULT_REVALIDATE_SEC;
  const platform = STACKS[stackIndex]?.provider;
  return platform !== undefined &&
    deployTarget('astro', platform)?.pageCache?.onDemand === true
    ? ON_DEMAND_REVALIDATE
    : DEFAULT_REVALIDATE_SEC;
}
