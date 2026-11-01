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
  [{ type: 'set', key: 'format', value: 105 }],
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

  it('フレームワークの無い古い保存は Next.js として読む（版は上げない。prd/10 B-9）', () => {
    const old = {
      version: 1,
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 7,
      startDate: '2026-10-31',
      turns: TURNS,
    };
    const parsed = parseSave(old);
    expect(parsed?.framework).toBe('nextjs');
    const s = replaySave(parsed!);
    expect(s.framework).toBe('nextjs');
    expect(s).toEqual(replaySave({ ...parsed!, framework: 'nextjs' }));
  });

  it('「画像の圧縮」の古い保存は「画像の形式」に読み替える（D-58）', () => {
    const old = {
      version: 1,
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 7,
      startDate: '2026-10-31',
      turns: [
        [{ type: 'set', key: 'compress', value: 100 }],
        [{ type: 'set', key: 'compress', value: 70 }],
        [{ type: 'set', key: 'compress', value: 150 }],
      ],
    };
    const parsed = parseSave(old)!;
    expect(parsed.turns.map((t) => t[0])).toEqual([
      { type: 'set', key: 'format', value: 105 },
      { type: 'set', key: 'format', value: 84 },
      { type: 'set', key: 'format', value: 150 },
    ]);
    const s = replaySave(parsed);
    expect(s.history.map((h) => h.settings.imageKB)).toEqual([
      150, 105, 84, 150,
    ]);
  });

  it('SPA の保存は SPA のまま再生し、知らないフレームワークは読めない', () => {
    const save = withTurn(
      newSave({
        scenarioId: 'article-community',
        stackIndex: 1,
        framework: 'vite-spa',
        seed: 5,
        startDate: '2026-10-31',
      }),
      [{ type: 'component', slot: 'ogp', option: 'prerender' }],
    );
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    const s = replaySave(parsed!);
    expect(s.framework).toBe('vite-spa');
    expect(s.components.ogp).toBe('prerender');
    expect(
      parseSave({ ...JSON.parse(JSON.stringify(save)), framework: 'remix' }),
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
