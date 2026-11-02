// ページごとの描き方のプリセット（D-106・段 2）が、フレームワークの書き換え（toSpa・toAstro・toNextExport）と同じ Workload を作ることの確認。
// スナップショットは main（20901a9。プリセットに置き換える前）で記録した。置き換えの後も 1 文字も変わらないこと（バランスを変えない）。
// 2 シナリオ × 選べるフレームワーク × 載せられる構成（隠した構成も。古い保存の再生に使う。D-100）× 部品の選択肢（1 つずつ替える）
// × 再検証・コメントの描き方 × 個人向けのページの割合・在庫の有無で、workloadFor の出力を正規化した JSON のハッシュにまとめる。
import type { Choices, SlotId } from 'catalog';
import { describe, expect, it, vi } from 'vitest';

// 約 2 万の Workload を組むので、並列で回すと既定の 5 秒を超えることがある
vi.setConfig({ testTimeout: 60_000 });
import {
  COMMENTS_IN_BROWSER,
  COMMENTS_IN_PAGE,
  frameworksOf,
  SCENARIOS,
  setupSlots,
  STACKS,
  stackSupports,
  workloadFor,
  type FrameworkId,
  type Scenario,
} from './index.ts';

/** キーを並べ替えた JSON（オブジェクトのキーの順に依らない。undefined のキーは落ちる＝toEqual と同じ見方）。 */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.entries(x)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(x);
}

/** FNV-1a 64 bit（スナップショットを短くするため。衝突は気にしない大きさ）。 */
function hash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** 部品の選択肢を 1 つずつ替えた組（既定 = {} を含む）。 */
function componentVariants(
  sc: Scenario,
  stackIndex: number,
  fw: FrameworkId,
): Choices[] {
  const out: Choices[] = [{}];
  for (const x of setupSlots(sc, stackIndex, fw)) {
    if (x.fixed || x.slot === 'files') continue;
    for (const o of x.options) out.push({ [x.slot as SlotId]: o.id });
  }
  return out;
}

const REVALIDATE = [0, 60, 300, 3600, 21600];
const COMMENTS = [COMMENTS_IN_BROWSER, COMMENTS_IN_PAGE];
const MODS = [{}, { ssrShare: 0.55 }];
const STOCKS = [
  null,
  { dbGB: 3, imagesGB: 40, images: 12_000, articlePages: 3_500 },
];

function digest(sc: Scenario, fw: FrameworkId, stackIndex: number): string {
  const parts: string[] = [];
  for (const components of componentVariants(sc, stackIndex, fw))
    for (const revalidateSec of REVALIDATE)
      for (const comments of COMMENTS)
        for (const mods of MODS)
          for (const stock of STOCKS)
            parts.push(
              canonical(
                workloadFor(sc, {
                  pv: 300_000,
                  settings: {
                    imageKB: 150,
                    variants: 3,
                    revalidateSec,
                    comments,
                    ssrOptimizations: 0,
                  },
                  ssrCpuMs: 15,
                  mods,
                  stock,
                  platform: STACKS[stackIndex]!.provider,
                  components,
                  framework: fw,
                }),
              ),
            );
  return `${parts.length}:${hash(parts.join('\n'))}`;
}

describe('描き方のプリセットは今までの書き換えと同じ Workload を作る（D-106）', () => {
  it('すべてのシナリオ × フレームワーク × 構成 × 部品 × 設定で、workloadFor の出力が記録と同じ', () => {
    const out: Record<string, string> = {};
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed)
        for (const s of STACKS)
          if (stackSupports(s.index, fw))
            out[`${sc.id} × ${fw} × ${s.id}`] = digest(sc, fw, s.index);
    expect(Object.keys(out).length).toBeGreaterThan(40);
    expect(out).toMatchSnapshot();
  });
});
