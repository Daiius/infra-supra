// 開発中の印（Scenario.preview。D-232）。架空のシナリオで、印の付いたものだけが並びから外れることを確かめる。
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_COMMUNITY,
  isPreviewScenario,
  listedScenarios,
  SCENARIOS,
  type Scenario,
} from './index.ts';

const FICTIONAL_PREVIEW: Scenario = {
  ...ARTICLE_COMMUNITY,
  id: 'fictional-preview',
  name: '架空の開発中のシナリオ',
  preview: true,
};

describe('開発中の印（D-232）', () => {
  it('今ある組み込みのシナリオには印が無い（画面・集計は変わらない）', () => {
    for (const sc of Object.values(SCENARIOS)) {
      expect(sc.preview, sc.id).toBeUndefined();
      expect(isPreviewScenario(sc.id), sc.id).toBe(false);
    }
    expect(listedScenarios(false)).toEqual(Object.values(SCENARIOS));
    expect(listedScenarios(true)).toEqual(Object.values(SCENARIOS));
  });

  it('印の付いたシナリオは preview のときだけ並ぶ（登録順のまま）', () => {
    const all = [ARTICLE_COMMUNITY, FICTIONAL_PREVIEW];
    expect(listedScenarios(false, all).map((s) => s.id)).toEqual([
      ARTICLE_COMMUNITY.id,
    ]);
    expect(listedScenarios(true, all).map((s) => s.id)).toEqual([
      ARTICLE_COMMUNITY.id,
      FICTIONAL_PREVIEW.id,
    ]);
  });

  it('知らない id・継承した名前は開発中ではない', () => {
    expect(isPreviewScenario('nope')).toBe(false);
    expect(isPreviewScenario('constructor')).toBe(false);
  });
});
