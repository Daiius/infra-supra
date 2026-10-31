// 遊んでいる途中の保存（D-26）。同じ保存 → 同じ状態。壊れた保存は読めない。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  newGame,
  newSave,
  parseSave,
  playMonth,
  replaySave,
  withTurn,
  type Action,
} from './index.ts';

const TURNS: Action[][] = [
  [{ type: 'set', key: 'compress', value: 100 }],
  [],
  [{ type: 'component', slot: 'db', option: 'kv' }],
  [{ type: 'optimize' }],
];

describe('保存と再生', () => {
  it('画面の操作と同じ順に再生すると、同じ状態になる', () => {
    let s = playMonth(newGame(1, 7, undefined, '2026-10-31'));
    let save = newSave({
      scenarioId: s.scenarioId,
      stackIndex: 1,
      seed: 7,
      startDate: '2026-10-31',
    });
    for (const t of TURNS) {
      s = playMonth(applyActions(s, t));
      save = withTurn(save, t);
    }
    expect(replaySave(save)).toEqual(s);
  });

  it('JSON を通しても同じ状態に戻る', () => {
    const save = TURNS.reduce(
      (a, t) => withTurn(a, t),
      newSave({
        scenarioId: 'article-community',
        stackIndex: 4,
        seed: 3,
        startDate: '2026-10-31',
      }),
    );
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    expect(parsed).not.toBeNull();
    expect(replaySave(parsed!)).toEqual(replaySave(save));
  });

  it('壊れた保存・版が違う保存は読めない', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('x')).toBeNull();
    expect(parseSave({ version: 999 })).toBeNull();
    expect(
      parseSave({
        version: 1,
        scenarioId: 'no-such',
        stackIndex: 1,
        seed: 1,
        startDate: '2026-10-31',
        turns: [],
      }),
    ).toBeNull();
  });

  it('行動が多すぎる（途中で終わった後の行動がある）保存は再生で例外', () => {
    // CF Free は 3 か月目に終わる
    const save = Array.from({ length: 6 }, () => [] as Action[]).reduce(
      (a, t) => withTurn(a, t),
      newSave({
        scenarioId: 'article-community',
        stackIndex: 0,
        seed: 42,
        startDate: '2026-10-31',
      }),
    );
    expect(() => replaySave(save)).toThrow();
  });
});
