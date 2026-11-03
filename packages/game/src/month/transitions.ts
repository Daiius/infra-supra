// playMonth の手間と切り替えの段: 手間の配分と作業の進み、乗り換え・部品の差し替え・作り直しが済んだときの切り替え、
// ためていく量（在庫）の増え方。
import { apiPlacedElsewhere, FRAMEWORKS, type Platform } from 'catalog';
import { scenarioOf } from '../core.ts';
import {
  accountUpkeepFor,
  featureBonusOf,
  featureWorkOf,
  interruptOf,
  migrationWanted,
  rewriteWanted,
  swapWanted,
  upkeepFor,
} from '../effort.ts';
import { allocateEffort } from '../rules.ts';
import { componentsAfterRewrite, revalidateAfterRewrite } from '../rewrite.ts';
import { validRouteOverrides } from '../routes/strategy.ts';
import type { Scenario, Stock } from '../scenario.ts';
import { deliveredImageKB, imageFormatOf } from '../settings.ts';
import {
  componentLabel,
  componentsAfterMigration,
  imagesOf,
  realtimeSupported,
  stackName,
  STACKS,
  swapLabel,
  withoutRealtime,
} from '../stacks.ts';
import type { GameState } from '../state.ts';

export type Progress = {
  effort: ReturnType<typeof allocateEffort>;
  featurePoints: number;
  migration: GameState['migration'];
  componentSwap: GameState['componentSwap'];
  rewrite: GameState['rewrite'];
};

/** 手間（維持 → 割り込み → 乗り換え → 行動。余りが機能開発）を配り、作業の進みを足す。 */
export function progressOf(state: GameState): Progress {
  const effort = allocateEffort({
    upkeep: upkeepFor(state),
    accounts: accountUpkeepFor(state),
    interrupt: interruptOf(state),
    featureWork: featureWorkOf(state),
    featureBonus: featureBonusOf(state),
    // 乗り換え・DB の差し替え・作り直しは同時に進めない（どれか 1 つだけ。D-81）
    migrationWanted:
      migrationWanted(state.migration) +
      swapWanted(state.componentSwap) +
      rewriteWanted(state),
    actions: state.plannedEffort,
    perMonth: state.effortPerMonth,
  });
  const featurePoints = state.featurePoints + effort.feature;
  const swap = state.componentSwap;
  const migration = state.migration
    ? { ...state.migration, done: state.migration.done + effort.migration }
    : null;
  const componentSwap = swap
    ? { ...swap, done: swap.done + effort.migration }
    : null;
  const rewrite = state.rewrite
    ? { ...state.rewrite, done: state.rewrite.done + effort.migration }
    : null;
  return { effort, featurePoints, migration, componentSwap, rewrite };
}

export type Transitioned = Pick<
  GameState,
  | 'stackIndex'
  | 'switching'
  | 'components'
  | 'mods'
  | 'storageOption'
  | 'framework'
  | 'settings'
  | 'migration'
  | 'componentSwap'
  | 'rewrite'
> & {
  /** 次の月の描き方（乗り換え先で使えないものは既定に戻した。無ければ undefined）。 */
  routes: GameState['routes'];
  notes: string[];
};

/** 乗り換え・部品の差し替え・作り直しが済んだら、次の月から新しい構成・部品・フレームワークに切り替える。 */
export function transitionsOf(
  sc: Scenario,
  state: GameState,
  platformNow: Platform,
  progress: Pick<Progress, 'migration' | 'componentSwap' | 'rewrite'>,
): Transitioned {
  let { migration, componentSwap, rewrite } = progress;
  const notes: string[] = [];
  // 乗り換えが済んだら、次の月から新しい構成に切り替える
  let stackIndex = state.stackIndex;
  let switching = false;
  let components = state.components;
  let mods = state.mods;
  let storageOption = state.storageOption;
  if (migration && migration.done >= migration.required) {
    stackIndex = migration.to;
    switching = true;
    components = componentsAfterMigration(
      migration.to,
      state.mods,
      state.framework,
      scenarioOf(state),
    );
    // 乗り換え・契約し直しは新しいサーバーなので、ストレージ変更オプションは付いていない
    storageOption = false;
    notes.push(
      `乗り換えの作業が済んだ。来月から ${stackName(migration.to, state.framework)} に切り替える（部品は既定の選択から始まる）`,
    );
    if (mods.realtime && !realtimeSupported(STACKS[migration.to]!.provider)) {
      mods = withoutRealtime(mods);
      notes.push(
        'チャットは乗り換え先のリアルタイムのデータを取得していないため、乗り換えとともに止めた',
      );
    }
    migration = null;
  }
  // DB の差し替えが済んだら、次の月から新しい DB に切り替える
  if (componentSwap && componentSwap.done >= componentSwap.required) {
    components = { ...components, [componentSwap.slot]: componentSwap.option };
    // API を他の事業者に移したら、構成の DB の選択は既定に戻す（DB は API の事業者に移った。
    // 同じ事業者へ戻すときは既定の DB へ移す。OCL-5A7916E6）
    if (componentSwap.slot === 'api' && apiPlacedElsewhere(components)) {
      const { db: _db, ...rest } = components;
      components = rest;
    }
    notes.push(
      `${swapLabel(componentSwap.slot)}が済んだ。来月から ${componentLabel(platformNow, componentSwap.slot, componentSwap.option)} を使う`,
    );
    componentSwap = null;
  }
  // 作り直しが済んだら、次の月から新しいフレームワークで動かす（事業者はそのまま。D-81）
  let framework = state.framework;
  let settings = state.settings;
  let routes = state.routes;
  if (rewrite && rewrite.done >= rewrite.required) {
    framework = rewrite.to;
    // 描き方は新しいフレームワークの既定に戻る（D-107）
    routes = undefined;
    components = componentsAfterRewrite({ ...state, components }, rewrite.to);
    settings = {
      ...settings,
      revalidateSec: revalidateAfterRewrite(settings.revalidateSec, rewrite.to),
    };
    notes.push(
      `作り直しが済んだ。来月から ${FRAMEWORKS[rewrite.to].label} で動かす（${stackName(stackIndex, rewrite.to, true, components)}。新しいフレームワークで選べない部品は既定に戻した）`,
    );
    rewrite = null;
  }
  // 乗り換え先で使えない描き方は既定に戻す（D-107）
  if (routes !== undefined) {
    const valid = validRouteOverrides(
      sc,
      stackIndex,
      framework,
      routes,
      state.legacyRouteDefaults,
    );
    routes = Object.keys(valid).length > 0 ? valid : undefined;
  }
  return {
    stackIndex,
    switching,
    components,
    mods,
    storageOption,
    framework,
    settings,
    routes,
    migration,
    componentSwap,
    rewrite,
    notes,
  };
}

/** ためていく量（月ごとに増える。prd/07 §10.4）と、一律で縮めて置いた粗い画像の数。 */
export function stockOf(
  sc: Scenario,
  state: GameState,
  humanPV: number,
  imgs: string | undefined,
): { stock: Stock; coarseImages: number } {
  const stock = sc.stock ? grow(sc, state, humanPV) : state.stock;
  // 一律で縮めて置いた画像（原本が無い）は、記事のデザインの刷新を受ける前の分だけ粗い画像として数える（D-47）
  const coarseImages =
    (state.coarseImages ?? 0) +
    (imgs === 'resize' && !state.imageRedesign
      ? stock.images - state.stock.images
      : 0);
  return { stock, coarseImages };
}

function grow(sc: Scenario, state: GameState, humanPV: number): Stock {
  const rule = sc.stock!;
  const w = sc.template(1);
  // 1 MAU あたりの PV はテンプレートから読む（記事コミュニティは 10・業務アプリは 200。D-33）
  const mau = humanPV / Math.round(1 / w.traffic.mau);
  const uploads =
    mau * w.images.uploadsPerMau * (state.mods.uploadsFactor ?? 1);
  const s = state.stock;
  // 一律で縮めて置く部品なら、保存するのは縮めた大きさ（原本は残さない。D-47）
  const resize = imagesOf(state) === 'resize';
  const gbPerUpload = resize
    ? // 一律で縮めて置く: 形式が JPEG でなければ、古いブラウザ向けの JPEG も置く（MDN の推奨。D-58）
      (deliveredImageKB(sc, state.settings, 'resize') +
        (imageFormatOf(state.settings.imageKB) === 'jpeg'
          ? 0
          : sc.resizedImageKB)) /
      1e6
    : // 原本はそのまま置く（形式は閲覧・投稿のときに変える。D-58 で圧縮の比を掛けるのをやめた）
      rule.gbPerImage;
  return {
    dbGB:
      s.dbGB +
      (rule.dbGBPerMillionPV * humanPV * (state.mods.dbRateFactor ?? 1)) / 1e6,
    imagesGB: s.imagesGB + uploads * gbPerUpload,
    images: s.images + uploads,
    articlePages: s.articlePages,
  };
}
