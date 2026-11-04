// 他の事業者の DB を選んだときに土台の組み立てが置く仮の DB（D-114 段 2b・段 2d）。applyCrossDb（cross.ts）が部品の DB と中継に差し替える。
// 土台の組み立て（aws.ts・gcp.ts・opennext.ts）から読むので、cross.ts（aws.ts を読む）とは別のファイルに置く（循環させない）。
import type { ArchitectureInput } from 'estimator';

/** 土台の組み立てに渡す DB の選択の印（composeStack が他の事業者の DB をこれに替えて渡す）。 */
export const CROSS_DB = '(cross-db)';

/** 仮の DB（課金なし。経路の上の位置を決めるだけ）。 */
export const crossDbPlaceholder = (): ArchitectureInput['nodes'][number] => ({
  id: 'db',
  role: 'sql-db',
  label: 'DB',
  config: { kind: 'managed-db' },
});
