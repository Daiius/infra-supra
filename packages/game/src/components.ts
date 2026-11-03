// 部品の提案と、部品どうしの組み合わせの衝突（API の置き場・CDN の定額）。
import {
  apiPlacedElsewhere,
  type Choices,
  COMPONENT_FLAVOR,
  type ComponentProvider,
  composeStack,
  type FrameworkId,
  type Platform,
  type SlotId,
  STACK_DEFS,
} from 'catalog';
import type { EventDef, Scenario } from './scenario.ts';
import { eventDef, scenarioOf } from './core.ts';
import type { GameState } from './state.ts';

/**
 * その部品を付ける提案が届いているか（部品の欄で選ぶのは、その提案を受けるのと同じ。D-24 の画面確認）。
 * 届いている提案の「受ける」の効果に、同じスロット・同じ部品を付ける効果があればその id。
 */
export function componentProposal(
  state: Pick<GameState, 'pendingProposals' | 'scenario'>,
  slot: SlotId,
  option: string,
): string | undefined {
  const sc = scenarioOf(state);
  return state.pendingProposals.find((id) =>
    eventDef(sc, id)?.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/** 提案で付く部品か（どの提案の「受ける」にも、この部品を付ける効果がある）。 */
export function proposalOnlyComponent(
  sc: Scenario,
  slot: SlotId,
  option: string,
): EventDef | undefined {
  return sc.events.find((d) =>
    d.accept?.effects.some(
      (e) => e.type === 'component' && e.slot === slot && e.option === option,
    ),
  );
}

/**
 * 部品どうしの依存で選べない理由（ゲーム中の差し替えと始める画面で共有。D-37・D-45）。
 * さくらの VPS の API の応答のキャッシュは前段の CDN の上で効くので、前段の CDN なしでは選べず、
 * キャッシュしている間は前段の CDN を外せない。choices はスロットごとの今の選択（始める画面では未選択もある）。
 */
export function componentConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
  /** フレームワーク（AWS の CDN の料金のプランの判定に使う。省略は Next.js）。 */
  framework: FrameworkId = 'nextjs',
): string | null {
  const api = apiConflict(platform, slot, option, choices);
  if (api) return api;
  // OpenNext は 1 つの CloudFront がページを返すので、画像を R2 に出しても CloudFront は残る（同じ規則で衝突しない。D-63）
  if (platform === 'aws' || platform === 'aws-opennext')
    return cdnPlanConflict(platform, slot, option, choices, framework);
  if (platform !== 'sakura') return null;
  // API の応答のキャッシュは Cloudflare の前段（Cache Rules）だけ。Bunny の前段（D-98）では扱わない
  const cfFront = (v: string | undefined) => v === 'static' || v === 'html';
  if (slot === 'apiCache' && option !== 'none' && !cfFront(choices.frontCdn))
    return (choices.frontCdn ?? 'none') === 'none'
      ? '前段の CDN が要る（先に前段の CDN を選ぶ）'
      : 'API の応答のキャッシュは Cloudflare の前段だけで扱う（先に前段を Cloudflare にする）';
  if (
    slot === 'frontCdn' &&
    !cfFront(option) &&
    (choices.apiCache ?? 'none') !== 'none'
  )
    return 'API の応答を前段の CDN でキャッシュしている（先にキャッシュを外す）';
  return null;
}

/**
 * SPA の API の置き場の依存（D-65）。他の事業者に置くと、DB はその事業者の部品になり（構成の DB は選べない）、
 * この事業者の API の応答のキャッシュは効かず、D1 に置いた画像を読む Worker の API も無くなる。頼る側を先に戻す（D-37 と同じ向き）。
 */
function apiConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
): string | null {
  const elsewhere = apiPlacedElsewhere(choices);
  if (slot === 'db' && elsewhere)
    return 'API を他の事業者に置いているので、DB はその事業者の部品になる（構成の DB は選べない）';
  if (slot === 'apiCache' && option !== 'none' && elsewhere)
    return 'API を他の事業者に置いているので、この事業者の API の応答のキャッシュは効かない';
  if (slot === 'images' && option === 'd1' && elsewhere)
    return 'API を他の事業者に置いているので、画像を読み出す Worker の API が無い';
  if (slot === 'api' && option !== 'same') {
    if ((choices.apiCache ?? 'none') !== 'none')
      return 'API の応答のキャッシュを使っている（先にキャッシュを外す）';
    if (platform === 'cloudflare' && choices.images === 'd1')
      return '画像を D1 に置いている（読み出す Worker の API が無くなる。先に画像の置き場を替える）';
  }
  return null;
}

/** AWS の構成に CloudFront（課金されるノード）があるか。 */
function hasCloudFront(
  platform: Platform,
  choices: Choices,
  framework: FrameworkId,
): boolean {
  const def = STACK_DEFS.find((d) => d.platform === platform);
  if (!def) return false;
  return composeStack(def, choices, { framework }).nodes.some((n) =>
    n.billing?.planId.startsWith('cloudfront'),
  );
}

/**
 * CDN の料金のプラン（D-61）は CloudFront があるときだけ効く。前段の CloudFront が無い Amplify で画像を他の事業者（R2）に出すと
 * CloudFront が無くなるので、定額のプランは選べない（B-11・D-62。効かない設定の扱い D-47 と同じ形で理由を出す）。
 * 定額のプランを選んでいる間は、CloudFront が無くなる選択（画像を R2 に出す・前段を外す）も選べない（頼る側を先に戻す。D-37 と同じ）。
 */
function cdnPlanConflict(
  platform: Platform,
  slot: SlotId,
  option: string,
  choices: Choices,
  framework: FrameworkId,
): string | null {
  const flat = (v: string | undefined) => v !== undefined && v !== 'payg';
  if (slot === 'cdnPlan')
    return flat(option) && !hasCloudFront(platform, choices, framework)
      ? 'この構成には CloudFront が無い（前段の CloudFront が無く、画像も他の事業者から配る）ので、CDN の料金のプランは効かない'
      : null;
  if (!flat(choices.cdnPlan)) return null;
  const next = { ...choices, [slot]: option };
  return hasCloudFront(platform, choices, framework) &&
    !hasCloudFront(platform, next, framework)
    ? 'CloudFront が無くなり、定額のプランが効かなくなる（先に CDN の料金のプランを従量に戻す）'
    : null;
}

/** 部品の選択肢の短い説明（フレーバー。catalog の COMPONENT_FLAVOR。D-45）。 */
export function componentFlavor(o: {
  platform: ComponentProvider;
  slot: SlotId | 'files';
  id: string;
}): string | undefined {
  return COMPONENT_FLAVOR[`${o.platform}:${o.slot}:${o.id}`];
}
