// ゲームの再現性（企画書 §10「同じシナリオ・同じシード・同じ行動なら同じ結果」）とスパイクとの一致。
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  newGame,
  playMonth,
  type Action,
  type GameState,
} from './index.ts';

function play(stackIndex: number, actions: Action[], seed = 42): GameState {
  let s = playMonth(newGame(stackIndex, seed));
  for (const a of actions) {
    if (s.phase !== 'playing') break;
    s = playMonth(applyAction(s, a));
  }
  while (s.phase === 'playing') s = playMonth(s);
  return s;
}

describe('game', () => {
  it('同じシード・同じ行動なら同じ結果', () => {
    const a = play(4, [{ type: 'none' }], 3);
    const b = play(4, [{ type: 'none' }], 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('12 か月で終わる', () => {
    expect(play(1, []).history).toHaveLength(12);
  });

  it('スパイク（spikes/game-2026-10-31）と同じ結果になる', () => {
    // スパイクの自動プレイ: Vercel 何もしない $6,043.49 / 1 か月目に画像を圧縮 $7,026.81 / CF Paid $8,870.72
    expect(play(3, []).cash.toFixed(2)).toBe('6043.49');
    expect(
      play(3, [{ type: 'improve', key: 'compress' }]).cash.toFixed(2),
    ).toBe('7026.81');
    expect(play(1, []).cash.toFixed(2)).toBe('8870.72');
    expect(play(3, []).phase).toBe('lost');
    expect(play(1, []).phase).toBe('won');
  });

  it('同じ改善は 2 回できない・同じ構成へは乗り換えられない', () => {
    const s = playMonth(newGame(1));
    const once = applyAction(s, { type: 'improve', key: 'compress' });
    expect(applyAction(once, { type: 'improve', key: 'compress' })).toBe(once);
    expect(applyAction(s, { type: 'migrate', stackIndex: 1 })).toBe(s);
  });
});
