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
 * 構成の既定に含まれるアカウントは数えない。Cloudflare + Hyperdrive の Supabase・VPS の前段の CDN の Cloudflare・
 * Vercel の画像の Cloudflare は数える。
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

/** 他の事業者の管理の毎月の手間（増えたアカウント 1 つにつき EFFORT.accountUpkeep。ゲーム上の仮定・D-52）。 */
export function accountUpkeepOf(
  stackIndex: number,
  components: Choices = {},
  framework: FrameworkId = 'nextjs',
): number {
  return (
    addedAccounts(stackIndex, components, framework).length *
    EFFORT.accountUpkeep
  );
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
