// 構成が暗黙に持っているファイル・オブジェクトの保存（画像の原本・添付の置き場。D-45）。
// 始める画面で「この構成では 1 択」の部品として見せる（ゲームでは替えられない）。置き場は構成のノードから引く:
// object-storage のノードがあればそれ、無くてホスト（VPS）ならそのディスク。
import { MVP_STACKS, STACK_DEFS, type Platform } from './index.ts';

export type FileStorage = {
  /** ノードの id（ホストのディスクは 'host-disk'）。説明文のキー「事業者:files:id」に使う。 */
  id: string;
  platform: Platform;
  label: string;
  /** 事実の説明（ⓘ に出す）。 */
  note: string;
};

export const FILE_STORAGE_LABEL = 'ファイルの保存（画像の原本など）';

/** 構成（STACK_DEFS の id）のファイルの置き場。どちらのノードも無ければ undefined。 */
export function fileStorageOf(stackId: string): FileStorage | undefined {
  const i = STACK_DEFS.findIndex((s) => s.id === stackId);
  if (i < 0) return undefined;
  const platform = STACK_DEFS[i]!.platform;
  const nodes = MVP_STACKS[i]!.nodes;
  const obj = nodes.find((n) => n.config.kind === 'object-storage');
  if (obj)
    return {
      id: obj.id,
      platform,
      label: obj.label,
      note: obj.billing
        ? `${obj.label} に置く。料金は ${obj.billing.provider} のプラン（${obj.billing.planId}）のメーターで見積もる`
        : `${obj.label}。置き場所の料金は取得していないので、見積では課金先なし（対応なし）として出す`,
    };
  const host = nodes.find((n) => n.config.kind === 'host');
  if (host)
    return {
      id: 'host-disk',
      platform,
      label: 'サーバーのディスク',
      note: 'VPS のディスクに DB と一緒に置く。容量はプランのディスクで決まり、ためていくと上限に当たりうる',
    };
  return undefined;
}
