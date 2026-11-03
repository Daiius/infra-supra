// 始める画面の設定の選択肢（revalidateSec・コメント）。
import type { Scenario } from '../scenario.ts';
import type { FrameworkId } from 'catalog';
import { commentsChoosable, ROUTE_PARTS } from '../routes/comments.ts';
import {
  hiddenSettings,
  revalidateSettingOf,
} from '../routes/hidden-settings.ts';
import { articleFamily } from '../routes/strategy.ts';
import { SETTING_FLAVOR, settingFlavor, SETTINGS } from '../settings.ts';
import type { RouteOverrides } from '../state.ts';

/**
 * 始める画面で選べる ISR の再検証（D-49）。ISR のある構成（Next.js）で、シナリオが隠していないときだけ。
 * 各選択肢に短い説明（フレーバー）を添える。
 */
export function setupRevalidateOptions(
  scenario: Scenario,
  framework: FrameworkId,
  /** 選んだページごとの描き方（D-107）。 */
  routes?: RouteOverrides,
): { value: number; label: string; flavor: string }[] {
  const key = revalidateSettingOf(
    framework,
    articleFamily({ scenario, framework, routes }),
  );
  if (key === 'apiCacheTtl') return [];
  if (hiddenSettings({ scenario, framework, routes }).includes(key)) return [];
  return SETTINGS[key].options.map((o) => ({
    ...o,
    flavor: settingFlavor(key, o.value) ?? '',
  }));
}

/**
 * 選べるコメント欄の描き方（記事のページの部品。D-82・D-109）。コメントのあるシナリオで、記事のページが HTML のとき
 * （SPA・枠 + API の記事以外）だけ。始める画面・見積モード・ゲームの途中の表の記事の行に出す。
 */
export function setupCommentOptions(
  scenario: Scenario,
  framework: FrameworkId,
  routes?: RouteOverrides,
): { value: number; label: string; flavor: string }[] {
  if (!commentsChoosable(framework, scenario, routes)) return [];
  return ROUTE_PARTS.comments.options.map((o) => ({
    ...o,
    flavor: SETTING_FLAVOR[`comments:${o.value}`] ?? '',
  }));
}
