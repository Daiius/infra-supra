// イベントのカードの本体に出す最初の 1 文（D-224）。
import { describe, expect, it } from 'vitest';
import { leadSentence } from './game-screen/events.tsx';

describe('leadSentence', () => {
  it('最初の「。」まで。括弧の中の「。」では切らない', () => {
    expect(leadSentence('A が来ました（2 か月。続きます）。B です。')).toBe(
      'A が来ました（2 か月。続きます）。',
    );
    expect(leadSentence('「直して。」と依頼。続き')).toBe(
      '「直して。」と依頼。',
    );
  });
  it('1 文だけ・「。」が無ければそのまま', () => {
    expect(leadSentence('1 文です。')).toBe('1 文です。');
    expect(leadSentence('句点なし')).toBe('句点なし');
  });
});
