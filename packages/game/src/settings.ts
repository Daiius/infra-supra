// 設定（Settings・SETTINGS の選択肢）と、設定から決まる値（オンデマンドの再検証・画像の形式と重さ・設定のフレーバー）。
import {
  type FrameworkId,
  FRAMEWORKS,
  imagesBehavior,
  imagesServedFormat,
  type Platform,
  termName,
} from 'catalog';
import { EFFORT } from './rules.ts';
import type { Scenario, WorkloadMods } from './scenario.ts';

export type Settings = {
  /**
   * 画像 1 枚（サイズ違い 1 種）の大きさ（KB）。画像の形式で決まる（JPEG 150・WebP 105・AVIF 84。同じ見た目の画質での比較。D-58）。
   */
  imageKB: number;
  variants: number;
  revalidateSec: number;
  /** SSR の最適化の段数。 */
  ssrOptimizations: number;
};

/** ISR の再検証の設定の「オンデマンド」（revalidateSec の値。時間の間隔はすべて正。D-49）。 */
export const ON_DEMAND_REVALIDATE = 0;

/** コメントの描き方: ブラウザで読み込む（既定。記事のページはコメントを含まない。D-70）。 */
export const COMMENTS_IN_BROWSER = 0;
/** コメントの描き方: 記事のページに含める（ISR・静的なページの HTML にコメントも入れる。D-82）。 */
export const COMMENTS_IN_PAGE = 1;

/**
 * コメントの投稿で再検証するページの数（その記事のページだけ。一覧にはコメントを出さないとみなす。ゲーム上の仮定・D-82）。
 * 記事の投稿・編集は ON_DEMAND_PAGES_PER_UPDATE（記事と一覧の 2）。
 */
export const COMMENT_PAGES_PER_UPDATE = 1;

/** 再検証がオンデマンドか（Next.js の ISR の設定。SPA では revalidateSec は API のキャッシュの期間で、0 にならない）。 */
export function isOnDemand(settings: Pick<Settings, 'revalidateSec'>): boolean {
  return settings.revalidateSec === ON_DEMAND_REVALIDATE;
}

/**
 * オンデマンドの最大寿命の説明（設定の ⓘ に出す。D-56）。Next.js の文書（ISR のガイド・2026-10-15 更新）で確かめたのは、
 * タグで再検証するデータに revalidate: 3600 を併せて付けた例（unstable_cache）があることまで。
 */
/** 投稿・編集でページのキャッシュを消す設定のチップの名前（フレームワークの呼び名。D-193）。再検証は Next.js、記事のキャッシュは Astro。 */
export const NEXT_ON_DEMAND = termName('nextjs', 'onDemand', '更新で消す');
export const ASTRO_ON_DEMAND = termName('astro', 'onDemand', '更新で消す');

export const ON_DEMAND_MAX_AGE_NOTE =
  '実際には、再検証の呼び出しの取りこぼし（webhook の失敗・呼び忘れ・外部データの変化）に備えて、時間の再検証（最大寿命）を併せて設定することが多いです（1 時間〜1 日など。Next.js の文書の例にも、タグで再検証するデータに revalidate: 3600 を併せて付けたものがあります）。このゲームでは 1 日とみなし、その分の作り直しも数えます';

/**
 * 画像の形式ごとの 1 枚の大きさ（KB。同じ見た目の画質。D-58）。JPEG はテンプレートの 150 KB。
 * WebP: 同等の SSIM の JPEG より 25〜34% 小さい（https://developers.google.com/speed/webp/docs/webp_study ・2025-08-07 更新・
 * 2026-11-01 取得）の中ほどの 30% とする。AVIF: WebP より約 20% 小さい（https://nextjs.org/docs/app/api-reference/components/image
 * の formats・2026-09-28 更新・2026-11-01 取得）。範囲の取り方はゲーム上の仮定。
 */
export const IMAGE_FORMAT_KB = { jpeg: 150, webp: 105, avif: 84 } as const;

/** 画像の形式（設定の値から）。 */
export function imageFormatOf(imageKB: number): 'jpeg' | 'webp' | 'avif' {
  return imageKB <= IMAGE_FORMAT_KB.avif
    ? 'avif'
    : imageKB <= IMAGE_FORMAT_KB.webp
      ? 'webp'
      : 'jpeg';
}

/**
 * Next.js の画像の部品（next/image）で閲覧のときに変換する構成か（Vercel の画像の最適化・VPS の next start）。
 * next/image の formats の既定は WebP で、ブラウザの Accept を見て形式を選ぶ（JPEG は選べない。D-58）。
 */
export function usesNextImage(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): boolean {
  return (
    framework === 'nextjs' &&
    platform !== 'cloudflare' &&
    // 他の事業者の部品は振る舞いで見る（R2 に原本を置き、変換は土台の画像の最適化。D-114 段 2c）
    (imagesBehavior(platform, images) ?? 'default') === 'default'
  );
}

/** 部品が自分で選んで配る画像の形式と、配り方の説明（fixedImageFormat）。 */
export type FixedImageFormat = { format: 'webp' | 'avif'; how: string };

/**
 * 閲覧のときに変換する部品が、設定に依らず自分で選んで配る形式（設定の「画像の形式」を無効にして固定する。D-58 の補足・
 * 2026-11-04 のユーザーの決定）。省略は、形式を設定（アプリのコード）で選ぶ構成。
 * - 部品のデータ（catalog の servedFormat）: Cloudflare Images の URL の format=auto（cf-images）は AVIF・Netlify Image CDN と
 *   Bunny Optimizer は WebP。
 * - next/image（usesNextImage）: images.formats の既定は ['image/webp'] で、Accept を見て選ぶ
 *   （https://nextjs.org/docs/app/api-reference/components/image ・2026-09-28 更新・2026-11-04 取得）。
 * - Astro の <Image />（astroImage）: 「By default, the <Image /> component will produce a .webp file」
 *   （https://docs.astro.build/en/reference/modules/astro-assets/ ・2026-11-04 取得）。Cloudflare の構成（Images の
 *   バインディング）でも <Image /> が WebP を頼むとみなす（バインディングがその指定どおりに変換するかは文書に記載が無い）。
 * Cloudflare の構成の Images（vinext・SPA）はバインディングで変換し、形式は Worker のコードが Accept を見て選ぶ
 * （「Your Worker is responsible for automatic format negotiation」）ので、設定どおり（D-62 の WebP とみなす読み替えをやめた）。
 * images は部品の id（他の事業者の部品も id のまま渡す）。
 */
export function fixedImageFormat(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): FixedImageFormat | undefined {
  const served = imagesServedFormat(platform, images);
  if (served) return served;
  if (usesNextImage(platform, framework, images))
    return {
      format: 'webp',
      how: 'Next.js の画像の部品（next/image）がブラウザに合わせて WebP で配ります（images.formats の既定）',
    };
  if (astroImage(platform, framework, images))
    return {
      format: 'webp',
      how: 'Astro の画像の部品（<Image />）が既定で WebP を作ります',
    };
  if (
    framework === 'astro' &&
    platform === 'cloudflare' &&
    imagesBehavior(platform, images) === 'images'
  )
    return {
      format: 'webp',
      how: 'Astro の画像の部品（<Image />）が既定で WebP を頼みます（Images のバインディングがその指定どおりに変換するとみなします。文書に記載はありません）',
    };
  return undefined;
}

/**
 * Astro の画像の部品（astro:assets の <Image />）で閲覧のときに変換する構成か（Vercel の画像の最適化・VPS の Node）。
 * <Image /> は既定で WebP を作る（「By default, the <Image /> component will produce a .webp file」。D-68）。
 */
export function astroImage(
  platform: Platform,
  framework: FrameworkId,
  images: string | undefined,
): boolean {
  return (
    framework === 'astro' &&
    platform !== 'cloudflare' &&
    // 他の事業者の部品は振る舞いで見る（R2 に原本を置き、変換は土台の画像の最適化。D-114 段 2c）
    (imagesBehavior(platform, images) ?? 'default') === 'default'
  );
}

/** 戻せる設定（prd/07 §9.5）。値はゲーム上の仮定。 */
export const SETTINGS = {
  format: {
    label: '画像の形式',
    field: 'imageKB',
    effort: EFFORT.setting.format,
    note: '同じ見た目の画質のまま、画像を小さくする形式です（転送量・保存量・速さに効き、画質は下がりません）。WebP は同等の SSIM の JPEG より 25〜34% 小さくなります（Google の WebP の比較の文書）。AVIF は WebP より約 20% 小さいですが、変換に約 50% 長くかかります（Next.js の画像の部品の文書）。古いブラウザ向けに JPEG の代わり（フォールバック）を用意するのが推奨（MDN）で、投稿のときに作って置く構成では JPEG も保存します。閲覧のときに変換する部品の多くはブラウザに合わせて形式を自分で選ぶので、その部品では選べません（Next.js の next/image・Astro の <Image />・Netlify Image CDN・Bunny Optimizer は WebP、Cloudflare Images の URL の変換（format=auto）は AVIF）。Cloudflare の構成の Images（バインディング）は Worker のコードが形式を選ぶので、ここで選んだ形式で配ります',
    options: [
      { value: IMAGE_FORMAT_KB.jpeg, label: 'JPEG（そのまま）' },
      { value: IMAGE_FORMAT_KB.webp, label: 'WebP' },
      { value: IMAGE_FORMAT_KB.avif, label: 'AVIF' },
    ],
  },
  variants: {
    label: '画像のサイズ違い',
    field: 'variants',
    effort: EFFORT.setting.variants,
    note: '画像変換の件数に効きます。1 種だと大きい画像を全端末に配るので遅くなります',
    options: [
      { value: 3, label: '3 種' },
      { value: 2, label: '2 種' },
      { value: 1, label: '1 種' },
    ],
  },
  isr: {
    label: 'ISR の再検証',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note:
      `作り直しの回数に効きます。間隔を延ばすと記事の更新が遅れて見え、反映スピード（満足度）が下がります。「${NEXT_ON_DEMAND}」は記事の更新のときに再検証します（作り直しはおもに更新の回数です。ISR のキャッシュの置き場所によっては再検証が届きません。時間からの切り替えは実装の手間がかかります）。` +
      ON_DEMAND_MAX_AGE_NOTE,
    options: [
      {
        value: ON_DEMAND_REVALIDATE,
        label: NEXT_ON_DEMAND,
      },
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
  /**
   * SPA の記事の中身の API の応答のキャッシュの期間（s-maxage。D-37）。ISR の間隔と同じ値（revalidateSec）を使う
   * （SPA には ISR が無いので、同じ値をこちらの意味で選ぶ）。
   */
  apiCacheTtl: {
    label: 'API のキャッシュの期間',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note: 'API の応答のキャッシュを使うときだけ効きます。延ばすとヒットが増えて取り直しが減りますが、記事の更新が遅れて見え、反映スピード（満足度）が下がります',
    options: [
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
  /**
   * Next.js の静的書き出しの静的なページ（記事）をビルドし直す間隔（D-80。Astro は D-103 でキャッシュに替えた）。ISR の間隔と
   * 同じ値（revalidateSec）を使う（ISR が無いので、同じ値をこちらの意味で選ぶ）。オンデマンドは記事を更新するたびにビルドする。
   */
  buildInterval: {
    label: 'ビルドの間隔',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note: '記事の投稿・編集をまとめてビルドし直す間隔です。ビルドの回数と時間（Workers Builds・Vercel のビルドの料金）に効きます。記事の更新は間隔にビルドの時間を足した分だけ遅れて見え、反映スピード（満足度）が下がります。新しく投稿された記事は、ビルドが終わるまでページがありません（投稿した人がすぐ開けない）。「更新のたびにビルド」は記事を更新するたびにビルドします（ビルドの時間より短くはまとまらない）',
    options: [
      {
        value: ON_DEMAND_REVALIDATE,
        label: '更新のたびにビルド',
      },
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
  /**
   * Astro の記事のキャッシュの取り直し（D-103）。ISR の間隔と同じ値（revalidateSec）をこの意味で選ぶ。オンデマンドは記事の投稿・編集の
   * ときにそのページのキャッシュを消す（Astro の route caching の cache.invalidate・Vercel の bypassToken）。時間は期限（s-maxage・expiration）。
   */
  pageCache: {
    label: '記事のキャッシュ',
    field: 'revalidateSec',
    effort: EFFORT.setting.isr,
    note:
      `記事のページは閲覧のときにサーバーが描き、前段（Cloudflare は Workers Cache・Vercel は ISR・VPS は Node のメモリ・Google Cloud は Hosting の CDN）にキャッシュします。「${ASTRO_ON_DEMAND}」は記事の投稿・編集のときにそのページのキャッシュを消します（Astro の Route caching。消せない置き場では届かず、古いページが出ます）。時間はキャッシュの期限で、延ばすと描き直しが減りますが、記事の更新が遅れて見え、反映スピード（満足度）が下がります。消した・期限が切れた後の最初の閲覧は描き終わるのを待つので、その閲覧に描画の CPU の全部が乗ります（Workers の 1 リクエストの CPU の上限に効く）。` +
      ON_DEMAND_MAX_AGE_NOTE,
    options: [
      {
        value: ON_DEMAND_REVALIDATE,
        label: ASTRO_ON_DEMAND,
      },
      { value: 60, label: '1 分' },
      { value: 300, label: '5 分' },
      { value: 3600, label: '1 時間' },
      { value: 21600, label: '6 時間' },
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    field: Exclude<keyof Settings, 'ssrOptimizations'>;
    effort: number;
    note: string;
    options: readonly { value: number; label: string }[];
  }
>;
export type SettingKey = keyof typeof SETTINGS;

/** 1 枚あたり配る画像の大きさ（KB）。画像の部品と画像の形式の設定から（D-47・D-58）。 */
export function deliveredImageKB(
  sc: Scenario,
  settings: Settings,
  images: string | undefined,
  /** 部品が自分で選んで配る形式（fixedImageFormat）。あれば設定の形式に依らずこの形式の大きさ（D-58 の補足）。 */
  fixed?: FixedImageFormat['format'],
): number {
  if (images === 'none') return sc.unoptimizedImageKB;
  const kb = fixed ? IMAGE_FORMAT_KB[fixed] : settings.imageKB;
  if (images === 'resize')
    return sc.resizedImageKB * (kb / IMAGE_FORMAT_KB.jpeg);
  return kb;
}

/**
 * サムネイル 1 枚（関連記事・一覧）あたり配る大きさ（KB。D-121）。サイズ違いを作るなら、本文の 1 枚にテンプレートの比
 * （サムネイル / 本文の大きさ）を掛ける。サイズ違いが 1 種・一律で縮める・原本のままなら、本文と同じファイルを配る。
 */
export function deliveredThumbnailKB(
  sc: Scenario,
  settings: Settings,
  images: string | undefined,
  fixed?: FixedImageFormat['format'],
): number {
  const body = deliveredImageKB(sc, settings, images, fixed);
  const t = sc.template(1).images;
  if (
    !t.thumbnails ||
    t.sizeKB <= 0 ||
    images === 'none' ||
    images === 'resize' ||
    settings.variants <= 1
  )
    return body;
  return body * (t.thumbnails.sizeKB / t.sizeKB);
}

/**
 * 1 ページの通信量（KB・転送の大きさ。D-211）: HTML（SPA はデータの API）+ JS・CSS + 画像（本文とサムネイル。D-121）。ブラウザのキャッシュが無い最初の
 * 1 ページ（D-47）。ページはテンプレートの最初のルート（記事のページ）。本文の画像の枚数は提案で変わる（mods.imagesPerPage）。
 * HTML はフレームワークの文書の倍率（App Router の RSC の埋め込み。D-212）を掛ける（省略は倍率 1）。
 */
export function pageWeightKB(
  sc: Scenario,
  settings: Settings,
  mods: WorkloadMods,
  images: string | undefined,
  fixed?: FixedImageFormat['format'],
  framework?: FrameworkId,
): number {
  const w = sc.template(1);
  const page = w.routes[0]!;
  const html =
    page.processing.responseKB *
    (framework ? FRAMEWORKS[framework].documentKBFactor.value : 1);
  const perImage = deliveredImageKB(sc, settings, images, fixed);
  const perThumb = deliveredThumbnailKB(sc, settings, images, fixed);
  return (
    html +
    w.perPage.assets * w.assets.sizeKB +
    (mods.imagesPerPage ?? page.images ?? w.perPage.images) * perImage +
    (page.thumbnails ?? w.perPage.thumbnails ?? 0) * perThumb
  );
}

/** 1 ページの通信量の表示（例: 「1 ページ約 20.5 MB」）。 */
export function pageWeightLabel(kb: number): string {
  return kb >= 1000
    ? `1 ページ約 ${Number((kb / 1000).toFixed(1))} MB`
    : `1 ページ約 ${Math.round(kb)} kB`;
}

/** ISR の再検証の既定（5 分）。 */
export const DEFAULT_REVALIDATE_SEC = 300;

/**
 * 設定の選択肢の短い説明（部品の説明 COMPONENT_FLAVOR と同じ方針: 事実だが、それだけで選ぶと外れうる文。数値は書かない。D-49）。
 * 「設定:値」で引く。
 */
export const SETTING_FLAVOR: Readonly<Record<string, string>> = {
  [`format:${IMAGE_FORMAT_KB.jpeg}`]:
    'どのブラウザでも表示でき、作るのも速いです。仕組みがいちばん単純です',
  [`format:${IMAGE_FORMAT_KB.webp}`]:
    '見た目の画質を保ったまま小さくなり、今の主なブラウザで表示できます',
  [`format:${IMAGE_FORMAT_KB.avif}`]:
    'いちばん小さくなる新しい形式です。画質を保ったまま転送量を大きく減らせます',
  'isr:0':
    '記事を更新したときだけ作り直すので、無駄な作り直しがなく、いつも最新です',
  'isr:60':
    '少し待てば更新が見えます。設定を書くだけで、追加の実装は要りません',
  'isr:300': '更新の反映と作り直しの回数の釣り合いを取った、ほどほどの間隔です',
  'isr:3600': '間隔が長いほど、同じページを作り直すまでの間があきます',
  'isr:21600':
    '更新はゆっくり見えますが、同じページを作り直すのは一日に数回までです',
  'buildInterval:0':
    '記事を更新するたびにビルドするので、待つのはビルドの間だけです。仕組みもいちばん素直です',
  'buildInterval:60':
    '少し待てば更新が見えます。間隔の間の更新はまとめて 1 回でビルドします',
  'buildInterval:300':
    '更新の反映とビルドの回数の釣り合いを取った、ほどほどの間隔です',
  'buildInterval:3600': '間隔が長いほど、ビルドの回数はまとまって減ります',
  'buildInterval:21600': '更新はゆっくり見えますが、ビルドは一日に数回までです',
  'pageCache:0':
    '記事を投稿・編集したときだけそのページを消すので、無駄な描き直しがなく、いつも最新です',
  'pageCache:60': '少し待てば更新が見えます。消す呼び出しを書かなくて済みます',
  'pageCache:300':
    '更新の反映と描き直しの回数の釣り合いを取った、ほどほどの期限です',
  'pageCache:3600': '期限が長いほど、同じページを描き直すまでの間があきます',
  'pageCache:21600':
    '更新はゆっくり見えますが、同じページを描き直すのは一日に数回までです',
  [`comments:${COMMENTS_IN_BROWSER}`]:
    '記事のページはコメントが付いても変わらないので、作り直すのは記事を更新したときだけです',
  [`comments:${COMMENTS_IN_PAGE}`]:
    'コメントも記事と一緒に HTML で届き、ページを開いてからコメントを取りに行く通信が要りません',
};

export function settingFlavor(
  key: SettingKey,
  value: number,
): string | undefined {
  return SETTING_FLAVOR[`${key}:${value}`];
}

export const optionLabel = (key: SettingKey, value: number) =>
  SETTINGS[key].options.find((o) => o.value === value)?.label ?? String(value);
