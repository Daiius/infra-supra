// 部品「保存の形」（prd/17 §5.4・KF-12・D-237）。解析の結果を DB にどう置くか: 一手を 1 行（既定）/ 1 局を 1 行。
// 構成（ノード・経路）は変えず、Workload の書き込みの行・1 行の大きさ・ページが読む行と、DB の在庫を替える
// （catalog の applyAnalysisSettings。game は設定と同じく analysisSettingsOf で渡す）。解析のあるシナリオだけで出し
// （game の scenarioAnalyzes）、選択が無ければ構成を変えない（記事・受託は不変）。
// 選んだときだけ、D1 のノードに行の数え方の前提（d1-rows-counting）を足す（DynamoDB・Firestore のノードは前から数え方の前提を挙げる）。
import type { ArchitectureInput } from 'estimator';
import type { StorageShape } from '../templates/analysis-job.ts';
import type { ComponentOption, Platform } from './index.ts';

type ArchNodeIn = ArchitectureInput['nodes'][number];

/** 部品の id を保存の形に（知らない id・選択なしは一手を 1 行）。 */
export const storageShapeOf = (id: string | undefined): StorageShape =>
  id === 'per-game' ? 'per-game' : 'per-move';

const PER_MOVE_NOTE =
  '解析の結果を一手ごとに 1 行で保存します（1 行に候補の数ぶん）。棋譜を開くと手数ぶんの行を読み、書き込みも手数ぶんの行です。' +
  '行の数・返した文書の数で数える DB（D1・Firestore）では読み書きの量が手数に比例し、行ごとのオーバーヘッドの分だけ保存の量も増えます';

const PER_GAME_NOTE =
  '1 局の解析の結果を 1 行にまとめて保存します。棋譜を開くと 1 行を読むだけで、1 局まとめて解析すれば書き込みも 1 局 1 行です。' +
  '局面ごと・小分けに解析すると、その行を何度も上書きします（大きさで数える DB（DynamoDB）は上書きのたびに行全体の大きさで数えるので、書き込みが増えます）。' +
  '棋譜をまたいで局面を探す検索はしにくくなります（このゲームでは満足度に効かせません）';

const PLATFORMS: readonly Platform[] = [
  'cloudflare',
  'vercel',
  'sakura',
  'aws',
  'aws-opennext',
  'netlify',
  'gcp',
];

/** 部品「保存の形」の選択肢（どの土台でも 2 つ）。 */
export const STORAGE_COMPONENTS: readonly ComponentOption[] = PLATFORMS.flatMap(
  (platform): ComponentOption[] => [
    {
      id: 'per-move',
      slot: 'storage',
      platform,
      label: '一手を 1 行',
      note: PER_MOVE_NOTE,
      premiseRefs: [],
    },
    {
      id: 'per-game',
      slot: 'storage',
      platform,
      label: '1 局を 1 行',
      note: PER_GAME_NOTE,
      premiseRefs: [],
    },
  ],
);

/** D1 のノード（Workers の D1 の binding。課金は Workers のプラン）。 */
const isD1 = (n: ArchNodeIn): boolean =>
  n.id === 'd1' && n.config.kind === 'sql-db';

/**
 * 保存の形を構成に当てる（composeStack から）。選択が無ければ構成を変えない。選んだときは D1 のノードに行の数え方の前提を足す。
 */
export function applyStorageShape(
  arch: ArchitectureInput,
  choice: string | undefined,
): ArchitectureInput {
  if (choice === undefined) return arch;
  return {
    ...arch,
    nodes: arch.nodes.map((n) =>
      isD1(n)
        ? {
            ...n,
            facts: [...new Set([...(n.facts ?? []), 'd1-rows-counting'])],
          }
        : n,
    ),
  };
}
