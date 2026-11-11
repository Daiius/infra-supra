// 設定・部分の注記（効かない理由・補足）とページの重さの表示。
import {
  astroPageCacheChoice,
  DEFAULT_CHOICES,
  type FrameworkId,
  imagesBehavior,
  type Platform,
  rebuildsStaticPages,
  strategyTitle,
} from 'catalog';
import { scenarioOf } from './core.ts';
import { commentsInPage, commentsOf } from './routes/comments.ts';
import { articleFamily } from './routes/strategy.ts';
import {
  fixedImageFormat,
  IMAGE_FORMAT_KB,
  isOnDemand,
  optionLabel,
  pageWeightKB,
  pageWeightLabel,
  type SettingKey,
} from './settings.ts';
import { componentLabel, imagesOf, STACKS } from './stacks.ts';
import type { GameState, RoutePartKey } from './state.ts';

/**
 * 設定が今の部品では効かない理由（効くなら undefined）。画像のサイズ違いは、最適化しない・一律で縮めて置く部品では
 * 作らない（1 種を配る）ので効かない（D-47）。画像の形式は、原本をそのまま配る部品と、閲覧のときに変換して自分で形式を選ぶ
 * 部品（fixedImageFormat）では効かない（D-58 とその補足）。画面は選択肢を無効にしてこの文を出す。
 */
export function settingInactiveReason(
  state: GameState,
  key: SettingKey,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  const raw = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  if (key === 'format')
    return imageFormatInactiveReason(platform, state.framework, raw);
  if (key !== 'variants') return undefined;
  const images = imagesOf(state);
  return images === 'none' || images === 'resize'
    ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なのでサイズ違いは作りません（1 種）`
    : undefined;
}

/**
 * 欄を無効にして値を固定しているときの、表示する値（設定の値。固定していなければ undefined）。画像の形式は、閲覧のときに
 * 変換して形式を自分で選ぶ部品ではその形式の大きさ（D-58 の補足）。保存した設定の値は替えない（部品を戻せば元の値に戻る）。
 */
export function fixedSettingValue(
  state: GameState,
  key: SettingKey,
): number | undefined {
  if (key !== 'format') return undefined;
  const platform = STACKS[state.stackIndex]!.provider;
  const raw = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  const fixed = fixedImageFormat(platform, state.framework, raw);
  return fixed ? IMAGE_FORMAT_KB[fixed.format] : undefined;
}

/**
 * 画像の形式の設定が効かない理由（見積モードの画像の行と共通）。images は部品の id（既定を補ったもの）。
 * 原本をそのまま配る部品は形式を変えない（D-58）。閲覧のときに変換する部品が形式を自分で選ぶなら、その形式に固定する（D-58 の補足）。
 */
export function imageFormatInactiveReason(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): string | undefined {
  const label = componentLabel(platform, 'images', images);
  if (imagesBehavior(platform, images) === 'none')
    return `画像の部品が「${label}」なので原本の形式のまま配ります`;
  const fixed = fixedImageFormat(platform, framework, images);
  return fixed ? `画像の部品が「${label}」なので、${fixed.how}` : undefined;
}

/**
 * 設定の今の効き方の注記（効かないわけではないが、補足が要るとき）。Cloudflare の構成の Images はバインディングで変換し、
 * 形式は Worker のコードが選ぶので、ここで選んだ形式で配る（D-62 の「WebP とみなす」をやめた。D-58 の補足）。
 */
export function settingNote(
  state: GameState,
  key: SettingKey,
): string | undefined {
  if (key !== 'format' || settingInactiveReason(state, key)) return undefined;
  const platform = STACKS[state.stackIndex]!.provider;
  return platform === 'cloudflare' && imagesOf(state) === 'images'
    ? 'Cloudflare Images のバインディングで変換するので、形式は Worker のコード（Accept を見て選ぶ）が決めます。ここで選んだ形式で配ります'
    : undefined;
}

/**
 * ページの部品の今の効き方の注記（D-109）。コメント欄を記事のページに含めているときだけ（commentsNote）。
 */
export function routePartNote(
  state: GameState,
  part: RoutePartKey,
): string | undefined {
  return part === 'comments' ? commentsNote(state) : undefined;
}

/**
 * コメントを記事のページに含めているときの効き方の注記（D-82）。作り直しが増えるのは、更新のたびに作り直すとき
 * （オンデマンドの再検証・更新のたびのビルド）。時間の再検証は更新の数に依らないので増えず、間隔でまとめるビルドも
 * 間隔の数までしか増えない。どちらもコメントは間隔の分だけ遅れて見え、鮮度の判定に入る（D-85）。
 */
function commentsNote(state: GameState): string | undefined {
  const sc = scenarioOf(state);
  if (
    !commentsInPage(
      commentsOf(sc, state.routeParts),
      state.framework,
      sc,
      state.routes,
    )
  )
    return undefined;
  const fam = articleFamily(state);
  const rebuilds =
    fam !== undefined ? fam === 'static' : rebuildsStaticPages(state.framework);
  if (fam === 'ssr' || (!rebuilds && isrCacheOf(state) === 'none'))
    return `ISR のキャッシュを使わない（${strategyTitle('ssr', state.framework)}）ので、作り直しは増えません`;
  if (isOnDemand(state.settings))
    return rebuilds
      ? 'コメントの投稿のたびにビルドし直します（コメントはビルドの時間の分だけ遅れて見えます）'
      : state.framework === 'astro'
        ? 'コメントの投稿のたびに記事のページのキャッシュを消します（描き直しが増えます）'
        : 'コメントの投稿のたびに記事のページを再検証します（作り直し・CDN の無効化が増えます）';
  return rebuilds
    ? `ビルドは間隔（${optionLabel('buildInterval', state.settings.revalidateSec)}）でまとめるので、回数は間隔の数までしか増えません。コメントは間隔とビルドの時間の分だけ遅れて見え、鮮度が下がります`
    : state.framework === 'astro'
      ? `記事のキャッシュが時間（${optionLabel('pageCache', state.settings.revalidateSec)}）なので、描き直しの回数は増えません。コメントはその分遅れて見え、鮮度が下がります`
      : `ISR の再検証が時間（${optionLabel('isr', state.settings.revalidateSec)}）なので、作り直しの回数は増えません。コメントはその分遅れて見え、鮮度が下がります`;
}

/** ISR のキャッシュの部品（Next.js）。Astro は事業者で決まる置き場で、キャッシュしない形は無い（D-103）。 */
function isrCacheOf(state: GameState): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  if (state.framework === 'astro') return astroPageCacheChoice(platform);
  return { ...DEFAULT_CHOICES[platform], ...state.components }.isrCache;
}

/** 状態の画像の部品で、1 ページの通信量の表示（画像の部品の ⓘ に使う）。 */
export function pageWeightOf(state: GameState, images?: string): string {
  const platform = STACKS[state.stackIndex]!.provider;
  const raw =
    images ?? { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  const opt = imagesBehavior(platform, raw);
  return pageWeightLabel(
    pageWeightKB(
      scenarioOf(state),
      state.settings,
      state.mods,
      opt,
      fixedImageFormat(platform, state.framework, raw)?.format,
      state.framework,
    ),
  );
}
