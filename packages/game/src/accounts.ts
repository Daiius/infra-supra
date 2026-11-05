// 事業者のアカウント（部品で増える契約先と、その維持の手間）。
import {
  accountsOf,
  type Choices,
  composeStack,
  type FrameworkId,
  type SlotId,
  STACK_DEFS,
} from 'catalog';
import { EFFORT } from './rules.ts';
import type { GameState } from './state.ts';

/** 課金のアカウントの画面の名前（D-52）。 */
const ACCOUNT_LABEL: Readonly<Record<string, string>> = {
  cloudflare: 'Cloudflare',
  vercel: 'Vercel',
  aws: 'AWS',
  supabase: 'Supabase',
  netlify: 'Netlify',
  neon: 'Neon',
  bunny: 'Bunny',
  resend: 'Resend',
  sakura: 'さくらのクラウド',
  gcp: 'Google Cloud',
};
export const accountLabel = (id: string) => ACCOUNT_LABEL[id] ?? id;

/** 構成の課金のアカウント（部品の選択で増える。D-52）。 */
export function accountsFor(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): string[] {
  return accountsOf(
    composeStack(STACK_DEFS[stackIndex]!, components, { framework }),
  );
}

/**
 * 部品の選択で、構成の既定より増えた事業者のアカウント（D-52・AX-11）。Vercel Pro + Supabase Pro の Supabase のように
 * 構成の既定に含まれるアカウントは入らない。Cloudflare + Hyperdrive の Supabase・VPS の前段の CDN の Cloudflare・
 * Vercel の画像の Cloudflare は入る。毎月の手間は増えた分ではなく数そのもので数える（accountUpkeepOf。D-123）。
 */
export function addedAccounts(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): string[] {
  const base = accountsFor(stackIndex, {}, framework);
  return accountsFor(stackIndex, components, framework).filter(
    (a) => !base.includes(a),
  );
}

/**
 * 構成の主のアカウント（構成の既定の部品で最初に課金する事業者。Vercel Pro + Supabase Pro なら Vercel。D-123）。
 * フレームワークで既定の部品のアカウントは変わらない（D-123 の一覧）が、引数で受けて既定の組み立てに渡す。
 */
export function mainAccountOf(
  stackIndex: number,
  framework: FrameworkId = 'nextjs',
): string | undefined {
  return accountsFor(stackIndex, {}, framework)[0];
}

/** 主のアカウント以外の事業者のアカウント（D-123。構成の既定に含まれるものも数える）。 */
export function otherAccounts(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): string[] {
  const main = mainAccountOf(stackIndex, framework);
  return accountsFor(stackIndex, components, framework).filter(
    (a) => a !== main,
  );
}

/**
 * 他の事業者の管理の毎月の手間（主のアカウント以外 1 つにつき EFFORT.accountUpkeep。ゲーム上の仮定・D-123 で D-52 を改めた）。
 * 構成の既定に含まれるアカウント（Vercel Pro + Supabase Pro の Supabase・メールの AWS）も数え、そのかわり月の手間に
 * 既定の分（accountAllowanceOf）を足す。
 */
export function accountUpkeepOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): number {
  return (
    otherAccounts(stackIndex, components, framework).length *
    EFFORT.accountUpkeep
  );
}

/**
 * 構成の既定の部品のときの、他の事業者の管理の手間（D-123）。月の手間（シナリオの基礎）にこの分を足すので、
 * 既定のままなら機能開発に回る量は基礎と同じ。部品でアカウントを増やせば減り、減らせば増える。
 */
export function accountAllowanceOf(
  stackIndex: number,
  framework: FrameworkId = 'nextjs',
): number {
  return accountUpkeepOf(stackIndex, {}, framework);
}

/** その部品に替えると新しく増えるアカウント（差すときの一度きりの手間が付く。D-52）。 */
export function newAccountsBy(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: SlotId,
  option: string,
): string[] {
  const now = accountsFor(state.stackIndex, state.components, state.framework);
  return accountsFor(
    state.stackIndex,
    { ...state.components, [slot]: option },
    state.framework,
  ).filter((a) => !now.includes(a));
}

/** その部品に替えると要らなくなるアカウント（毎月の維持が減る。メールの SES → Resend の AWS など。D-123）。 */
export function droppedAccountsBy(
  state: Pick<GameState, 'stackIndex' | 'components' | 'framework'>,
  slot: SlotId,
  option: string,
): string[] {
  const after = accountsFor(
    state.stackIndex,
    { ...state.components, [slot]: option },
    state.framework,
  );
  return accountsFor(
    state.stackIndex,
    state.components,
    state.framework,
  ).filter((a) => !after.includes(a));
}
