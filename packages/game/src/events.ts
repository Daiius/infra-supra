// 出来事の効果（適用と説明）と、出来事を受けるときの手間（画像の作り直しなど）。
import type { Effect, EventDef, Scenario } from './scenario.ts';
import { SLOT_LABELS } from 'catalog';
import type { PlatformPremise } from 'estimator';
import { scenarioOf } from './core.ts';
import { fmtFactor } from './format.ts';
import { REQUIREMENT_LABEL } from './requirements.ts';
import { isOnDemand, ON_DEMAND_REVALIDATE } from './settings.ts';
import { componentLabel, imagesOf } from './stacks.ts';
import type { GameState, MonthEvent } from './state.ts';

/** 今の状態で要る効果（再検証がすでにオンデマンドなら、切り替えの作業を除く。D-49）。 */
function effectsFor(
  state: Pick<GameState, 'framework' | 'settings'>,
  effects: readonly Effect[],
): Effect[] {
  const already = state.framework !== 'vite-spa' && isOnDemand(state.settings);
  return effects.filter(
    (e) => !(e.type === 'interrupt' && e.unlessOnDemand && already),
  );
}

export const acceptEffort = (def: EventDef, state: GameState) =>
  effectsFor(state, def.accept?.effects ?? []).reduce(
    (a, e) =>
      a +
      (e.type === 'interrupt'
        ? e.points
        : e.type === 'imageRedesign'
          ? imageRedesignEffort(state)
          : 0),
    0,
  );

/**
 * 記事のデザインの刷新を受ける手間（D-47・ゲーム上の仮定）。原本を配っている（最適化しない）なら 0、
 * 一律で縮めて原本が無いなら 2（これからの投稿だけ大きくする作業）、原本があるなら 1。
 */
function imageRedesignEffort(state: GameState): number {
  const images = imagesOf(state);
  // 今の部品が原本を配っていても、一律で縮めて置いた原本の無い画像が多く残っていれば、一律で縮めた構成と同じ（OCL-0A3AC32F）
  if (images === 'none') return hasManyCoarseImages(state) ? 2 : 0;
  return images === 'resize' ? 2 : 1;
}

/**
 * 一律で縮めて置いた原本の無い画像が、在庫の coarseShare 以上残っているか（D-47）。部品を替えても、
 * それまでに縮めて置いた画像は大きくできない（OCL-0A3AC32F）。
 */
function hasManyCoarseImages(state: GameState): boolean {
  const rule = scenarioOf(state).imageRedesign;
  if (!rule || state.stock.images <= 0) return false;
  return (state.coarseImages ?? 0) / state.stock.images >= rule.coarseShare;
}

/** 記事のデザインの刷新の提案の id（D-47）。 */
export const IMAGE_REDESIGN_ID = 'p-image-redesign';

/**
 * 記事のデザインの刷新で、今月の画質を 1 段下げる理由（下げないなら undefined。D-47・ゲーム上の仮定）。
 * 断った: 断った後の declineMonths か月（原本を配っている構成は画像が既に大きいので下げない）。
 * 受けた: 原本の無い粗い画像が在庫の coarseShare 以上ある間。
 */
export function imageRedesignQuality(
  state: GameState,
  sc: Scenario,
  month: number,
  images: string | undefined,
): string | undefined {
  const rule = sc.imageRedesign;
  if (!rule) return undefined;
  const res = state.responses[IMAGE_REDESIGN_ID];
  const at = state.schedule.find((x) => x.id === IMAGE_REDESIGN_ID)?.month;
  if (
    res === 'declined' &&
    at !== undefined &&
    // 原本を配っている構成は既に大きいので下げない。ただし原本の無い画像が多く残っていれば下げる（OCL-0A3AC32F）
    (images !== 'none' || hasManyCoarseImages(state)) &&
    month > at &&
    month <= at + rule.declineMonths
  )
    return '記事のデザインの刷新を断った（大きな画面で画像が小さく粗く見える）';
  if (state.imageRedesign && state.stock.images > 0) {
    const share = state.imageRedesign.coarseImages / state.stock.images;
    if (share >= rule.coarseShare)
      return `原本の無い粗い画像が在庫の ${Math.round(share * 100)}%（一律で縮めて置いた画像は、後から大きくできない）`;
  }
  return undefined;
}

/** 効果の要約（画面の通知に出す）。 */
export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'traffic':
      return `${e.bot ? 'Bot の' : ''}PV ${fmtFactor(e.factor)}${e.peakFactor ? `・ピーク ${fmtFactor(e.peakFactor)}` : ''}（${e.months} か月${e.earnsRevenue ? '' : '・収益なし'}）`;
    case 'workload': {
      const m = e.mods;
      return [
        m.imagesPerPage !== undefined && `1 PV の画像 ${m.imagesPerPage} 枚`,
        m.uploadsFactor !== undefined &&
          `画像の投稿 ${fmtFactor(m.uploadsFactor)}`,
        m.ssrShare !== undefined &&
          `SSR の割合 ${Math.round(m.ssrShare * 100)}%`,
        m.writesPerCall !== undefined &&
          `API 1 回の書き込み ${m.writesPerCall}`,
        m.dbRateFactor !== undefined &&
          `DB の増え方 ${fmtFactor(m.dbRateFactor)}`,
        m.apiCpuMs !== undefined && `API 1 回の CPU ${m.apiCpuMs} ms`,
        m.apiResponseKB !== undefined && `API 1 回の応答 ${m.apiResponseKB} KB`,
      ]
        .filter(Boolean)
        .join('・');
    }
    case 'stock':
      return [
        e.add.dbGB && `DB +${e.add.dbGB} GB`,
        e.add.imagesGB && `画像 +${e.add.imagesGB} GB`,
        e.add.articlePages &&
          `記事ページ +${e.add.articlePages.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join('・');
    case 'basePV':
      return `基準の PV ${fmtFactor(e.factor)}（以降ずっと）`;
    case 'seats':
      return `席（メンバー）+${e.add}`;
    case 'effortPerMonth':
      return `開発の手間 +${e.add} / 月`;
    case 'interrupt':
      if (e.featureWork)
        return `機能の追加の作業 ${e.points} × ${e.months} か月（翌月から。その月の機能開発に数える${e.unlessOnDemand ? '。再検証がすでにオンデマンドなら不要' : ''}）`;
      return `対応の手間 ${e.points} × ${e.months} か月（翌月から）`;
    case 'feature':
      return `機能開発 +${e.points}`;
    case 'growth':
      return `成長 +${Math.round(e.add * 100)} ポイント × ${e.months} か月`;
    case 'component':
      return `${SLOT_LABELS[e.slot]}に部品を付ける（${componentLabel('cloudflare', e.slot, e.option)}）`;
    case 'on-demand-revalidate':
      return 'ISR の再検証をオンデマンドにする（Next.js）';
    case 'requirement':
      return `以後の要件: ${REQUIREMENT_LABEL[e.requirement]}（満たさない月は鮮度が下がる）`;
    case 'contract':
      return `契約の収益 $${e.usdPerMonth} / 月（${REQUIREMENT_LABEL[e.requires]}のときだけ）`;
    case 'imageRedesign':
      return '画像を大きく綺麗に出す（原本がある構成は過去の記事も・一律で縮めた構成はこれからの投稿だけ。原本が無いと過去の画像は大きくできない）';
  }
}

/** 効果を状態に当てる（traffic はその月の計算で扱うのでここでは何もしない）。 */
export function applyEffects(
  state: GameState,
  allEffects: Effect[],
  eventId: string,
): GameState {
  let s = state;
  const effects = effectsFor(state, allEffects);
  const deferFeature = effects.some(
    (e) => e.type === 'interrupt' && e.featureWork,
  );
  const featurePointsOf = effects.reduce(
    (a, e) => a + (e.type === 'feature' ? e.points : 0),
    0,
  );
  for (const e of effects) {
    switch (e.type) {
      case 'workload':
        s = { ...s, mods: { ...s.mods, ...e.mods } };
        break;
      case 'stock':
        s = {
          ...s,
          stock: {
            dbGB: s.stock.dbGB + (e.add.dbGB ?? 0),
            imagesGB: s.stock.imagesGB + (e.add.imagesGB ?? 0),
            images: s.stock.images + (e.add.images ?? 0),
            articlePages: s.stock.articlePages + (e.add.articlePages ?? 0),
          },
        };
        break;
      case 'basePV':
        s = { ...s, basePV: s.basePV * e.factor };
        break;
      case 'seats':
        s = { ...s, seats: s.seats + e.add };
        break;
      case 'effortPerMonth':
        s = { ...s, effortPerMonth: s.effortPerMonth + e.add };
        break;
      case 'interrupt':
        s = {
          ...s,
          interrupts: [
            ...s.interrupts,
            {
              points: e.points,
              months: e.months,
              eventId,
              ...(e.featureWork
                ? { featureWork: true, bonus: featurePointsOf / e.months }
                : {}),
            },
          ],
        };
        break;
      case 'feature':
        // 機能の追加の作業がある提案は、加点を作業の月に按分して足す（D-29）
        if (!deferFeature)
          s = { ...s, featurePoints: s.featurePoints + e.points };
        break;
      case 'growth':
        s = {
          ...s,
          growthBonus: [...s.growthBonus, { add: e.add, months: e.months }],
        };
        break;
      case 'component':
        s = { ...s, components: { ...s.components, [e.slot]: e.option } };
        break;
      case 'on-demand-revalidate':
        // SPA には ISR が無い（revalidateSec は API のキャッシュの期間）ので変えない
        if (s.framework !== 'vite-spa')
          s = {
            ...s,
            settings: { ...s.settings, revalidateSec: ON_DEMAND_REVALIDATE },
          };
        break;
      case 'imageRedesign': {
        // 手間は画像の部品で決まる（D-47）。粗い画像の数はここで固定し、以後の一律で縮めた投稿は粗くない
        const points = imageRedesignEffort(s);
        s = {
          ...s,
          imageRedesign: { coarseImages: s.coarseImages ?? 0 },
          ...(points > 0
            ? {
                interrupts: [...s.interrupts, { points, months: 1, eventId }],
              }
            : {}),
        };
        break;
      }
      case 'requirement':
        s = s.requirements.includes(e.requirement)
          ? s
          : { ...s, requirements: [...s.requirements, e.requirement] };
        break;
      case 'contract':
        s = {
          ...s,
          contracts: [
            ...s.contracts,
            { eventId, usdPerMonth: e.usdPerMonth, requires: e.requires },
          ],
        };
        break;
      case 'traffic':
        break;
    }
  }
  return s;
}

export function premiseRefsOf(
  def: Pick<EventDef, 'premiseRefs'>,
  premises: readonly PlatformPremise[],
): MonthEvent['premises'] {
  return premises
    .filter((p) => def.premiseRefs.some((ref) => p.id.startsWith(ref)))
    .map((p) => ({
      id: p.id,
      text: p.text,
      hit: p.hit,
      ...(p.detail !== undefined ? { detail: p.detail } : {}),
      ...(p.ratio !== undefined && Number.isFinite(p.ratio)
        ? { ratio: p.ratio }
        : {}),
    }));
}
