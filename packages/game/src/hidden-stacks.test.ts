// 一時的に隠した構成（D-100。AWS の OpenNext・Netlify）: 選ぶ場所には出さず、計算と古い保存はそのまま動く。
import { HIDDEN_PLATFORMS } from 'catalog';
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  ARTICLE_COMMUNITY,
  comparisonRows,
  DEFAULT_START_DATE,
  FRAMEWORKS,
  frameworksOf,
  newGame,
  newSave,
  offeredBaselines,
  playMonth,
  replaySave,
  SCENARIOS,
  STACKS,
  stackOffered,
  stackSupports,
  withTurn,
  type FrameworkId,
} from './index.ts';

const FWS = Object.keys(FRAMEWORKS) as FrameworkId[];
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const HIDDEN_IDS = [
  'aws-opennext',
  'netlify-supabase-free',
  'netlify-supabase-personal',
  'netlify-supabase-pro',
];

describe('隠した構成（D-100）', () => {
  it('隠すのは AWS の OpenNext と Netlify の全プランだけ（添字は変えない）', () => {
    expect([...HIDDEN_PLATFORMS].sort()).toEqual(['aws-opennext', 'netlify']);
    expect(STACKS.filter((s) => s.hidden).map((s) => s.id)).toEqual(HIDDEN_IDS);
    // 保存と基準プレイの stackIndex（OpenNext は 7）
    expect(idx('aws-opennext')).toBe(7);
  });

  it('選ぶ場所に出さない（どのフレームワークでも）。載せられるかの判定（stackSupports）は変えない', () => {
    for (const fw of FWS)
      for (const s of STACKS)
        expect(stackOffered(s.index, fw), `${s.id} × ${fw}`).toBe(
          stackSupports(s.index, fw) && !HIDDEN_IDS.includes(s.id),
        );
    expect(stackSupports(idx('netlify-supabase-pro'), 'nextjs')).toBe(true);
    // 隠していない構成は、どのシナリオのどのフレームワークでも 1 つ以上選べる
    for (const sc of Object.values(SCENARIOS))
      for (const fw of frameworksOf(sc).allowed)
        expect(STACKS.some((s) => stackOffered(s.index, fw))).toBe(true);
  });

  it('隠した構成の古い保存は、そのまま再生できる（行き先が隠した構成の乗り換えも）', () => {
    let save = newSave({
      scenarioId: ARTICLE_COMMUNITY.id,
      stackIndex: idx('netlify-supabase-pro'),
      seed: 42,
      startDate: DEFAULT_START_DATE,
    });
    save = withTurn(save, []);
    save = withTurn(save, [
      { type: 'migrate', stackIndex: idx('aws-opennext') },
    ]);
    const s = replaySave(save);
    expect(s.history).toHaveLength(3);
    expect(s.migration?.to ?? s.stackIndex).toBe(idx('aws-opennext'));
  });

  it('結果の比較に、隠した構成の基準プレイを出さない', () => {
    const hiddenBaselines = ARTICLE_COMMUNITY.baselines.filter(
      (b) => STACKS[b.stackIndex]!.hidden,
    );
    expect(hiddenBaselines.map((b) => b.id)).toEqual(['aws-opennext-images']);
    expect(offeredBaselines(ARTICLE_COMMUNITY)).toHaveLength(
      ARTICLE_COMMUNITY.baselines.length - 1,
    );
    let s = playMonth(newGame(idx('cloudflare-vinext-paid'), 42));
    while (s.phase === 'playing') s = playMonth(applyActions(s, []));
    const ids = comparisonRows(s).map((r) => r.id);
    expect(ids).not.toContain('aws-opennext-images');
    expect(ids).toContain('aws-amplify-cdn');
  });
});
