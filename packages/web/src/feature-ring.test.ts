// 手間の輪の「機能」の段階の出し方（OCL-7D797D79）: 月の報告は実際の段階（メールが届かない分の下げを含む）を出す。
import { describe, expect, it } from 'vitest';
import { featureStageView } from './feature-ring.tsx';

describe('featureStageView', () => {
  it('実際の段階が機能開発の比だけの段階と違えば、実際の段階と理由を出す', () => {
    expect(featureStageView('good', 'fair')).toEqual({
      stage: 'fair',
      note: '（メールが届かない分で下がりました。機能開発だけなら良いです）',
    });
  });

  it('同じなら断りを付けない。実際の段階が無い（来月の見込み）ときは渡した断りを添える', () => {
    expect(featureStageView('good', 'good')).toEqual({
      stage: 'good',
      note: '',
    });
    expect(featureStageView('fair', undefined, '（見込み）')).toEqual({
      stage: 'fair',
      note: '（見込み）',
    });
  });
});
