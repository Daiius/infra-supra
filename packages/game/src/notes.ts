// 設定・部分の注記（効かない理由・補足）とページの重さの表示。
import {
  astroPageCacheChoice,
  DEFAULT_CHOICES,
  imagesBehavior,
  rebuildsStaticPages,
} from 'catalog';
import { scenarioOf } from './core.ts';
import { commentsInPage, commentsOf } from './routes/comments.ts';
import { articleFamily } from './routes/strategy.ts';
import {
  astroImage,
  autoImageFormat,
  isOnDemand,
  optionLabel,
  pageWeightKB,
  pageWeightLabel,
  type SettingKey,
  usesNextImage,
} from './settings.ts';
import { componentLabel, imagesOf, STACKS } from './stacks.ts';
import type { GameState, RoutePartKey } from './state.ts';

/**
 * 設定が今の部品では効かない理由（効くなら undefined）。画像のサイズ違いは、最適化しない・一律で縮めて置く部品では
 * 作らない（1 種を配る）ので効かない（D-47）。画面は選択肢を無効にしてこの文を出す。
 */
export function settingInactiveReason(
  state: GameState,
  key: SettingKey,
): string | undefined {
  const platform = STACKS[state.stackIndex]!.provider;
  const images = imagesOf(state);
  const raw = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  // 原本をそのまま配るので、形式は変わらない（D-58）
  if (key === 'format')
    return images === 'none'
      ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なので原本の形式のまま配る`
      : undefined;
  if (key !== 'variants') return undefined;
  return images === 'none' || images === 'resize'
    ? `画像の部品が「${componentLabel(platform, 'images', raw)}」なのでサイズ違いは作らない（1 種）`
    : undefined;
}

/**
 * 設定の今の効き方の注記（効かないわけではないが、選んだ値どおりにならないとき）。Next.js の画像の部品は JPEG を選んでも
 * WebP で配る（formats の既定。D-58）。
 */
export function settingNote(
  state: GameState,
  key: SettingKey,
): string | undefined {
  if (key !== 'format') return undefined;
  const platform = STACKS[state.stackIndex]!.provider;
  const images = { ...DEFAULT_CHOICES[platform], ...state.components }.images;
  if (usesNextImage(platform, state.framework, images))
    return 'Next.js の画像の部品は、ブラウザに合わせて既定で WebP を配る（JPEG を選んでも WebP）';
  if (astroImage(platform, state.framework, images))
    return 'Astro の画像の部品（<Image />）は既定で WebP を作る（JPEG を選んでも WebP）';
  return autoImageFormat(platform, state.framework, images)
    ? 'Cloudflare Images の閲覧のときの変換は、ブラウザに合わせた形式（format=auto）で配る（JPEG を選んでも WebP とみなす）'
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
    return 'ISR のキャッシュを使わない（毎回描く）ので、作り直しは増えない';
  if (isOnDemand(state.settings))
    return rebuilds
      ? 'コメントの投稿のたびにビルドし直す（コメントはビルドの時間の分だけ遅れて見える）'
      : state.framework === 'astro'
        ? 'コメントの投稿のたびに記事のページのキャッシュを消す（描き直しが増える）'
        : 'コメントの投稿のたびに記事のページを再検証する（再生成・CDN の無効化が増える）';
  return rebuilds
    ? `ビルドは間隔（${optionLabel('buildInterval', state.settings.revalidateSec)}）でまとめるので、回数は間隔の数までしか増えない。コメントは間隔とビルドの時間の分だけ遅れて見え、鮮度が下がる`
    : state.framework === 'astro'
      ? `記事のキャッシュが時間（${optionLabel('pageCache', state.settings.revalidateSec)}）なので、描き直しの回数は増えない。コメントはその分遅れて見え、鮮度が下がる`
      : `ISR の再検証が時間（${optionLabel('isr', state.settings.revalidateSec)}）なので、作り直しの回数は増えない。コメントはその分遅れて見え、鮮度が下がる`;
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
  const opt =
    images !== undefined ? imagesBehavior(platform, images) : imagesOf(state);
  return pageWeightLabel(
    pageWeightKB(
      scenarioOf(state),
      state.settings,
      state.mods,
      opt,
      autoImageFormat(platform, state.framework, opt),
    ),
  );
}
