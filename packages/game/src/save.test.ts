// 遊んでいる途中の保存（D-26）。同じ保存 → 同じ状態。壊れた保存は読めない。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  newGame,
  newSave,
  parseSave,
  playMonth,
  previousSave,
  replaySave,
  replaySaveTo,
  rewindSave,
  withoutPrevious,
  withTurn,
  type Action,
  type SaveData,
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

describe('古い保存の Astro の「ビルドの間隔」を「記事のキャッシュ」に読み替える（D-103・OCL-99FE28E7）', () => {
  const legacy = (framework: 'astro' | 'nextjs-export') =>
    newSave({
      scenarioId: 'article-community',
      stackIndex: 1,
      framework,
      seed: 7,
      startDate: '2026-10-31',
      revalidateSec: 300,
    });

  it('Astro の buildInterval は pageCache として当たり、値と手間が戻る', () => {
    const save = withTurn(legacy('astro'), [
      { type: 'set', key: 'buildInterval', value: 21600 },
    ]);
    const s = replaySave(parseSave(JSON.parse(JSON.stringify(save)))!);
    expect(s.settings.revalidateSec).toBe(21600);
    // 今の行動（pageCache）で遊んだのと同じ状態（手間も同じ）
    const now = replaySave(
      withTurn(legacy('astro'), [
        { type: 'set', key: 'pageCache', value: 21600 },
      ]),
    );
    expect(s).toEqual(now);
  });

  it('途中で作り直した保存は、行動のときのフレームワークで読み替える（静的書き出しの buildInterval はそのまま）', () => {
    let save = withTurn(legacy('nextjs-export'), [
      { type: 'set', key: 'buildInterval', value: 3600 },
      { type: 'rewrite', framework: 'astro' },
    ]);
    // 作り直しが終わるまで何もしない
    while (replaySave(save).rewrite) save = withTurn(save, []);
    const before = replaySave(save);
    expect(before.framework).toBe('astro');
    expect(before.settings.revalidateSec).toBe(3600);
    save = withTurn(save, [
      { type: 'set', key: 'buildInterval', value: 21600 },
    ]);
    const s = replaySave(save);
    expect(s.framework).toBe('astro');
    expect(s.settings.revalidateSec).toBe(21600);
  });
});

describe('この月に戻ると前の試行（D-128）', () => {
  const start = () =>
    newSave({
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 7,
      startDate: '2026-10-31',
    });
  const played = (turns: Action[][]): SaveData =>
    turns.reduce((a, t) => withTurn(a, t), start());
  /** 画面の操作と同じ順に、始めた月から turns を当てて進めた状態。 */
  const byHand = (turns: Action[][]) => {
    let s = playMonth(newGame(1, 7, undefined, '2026-10-31'));
    for (const t of turns) s = playMonth(applyActions(s, t));
    return s;
  };

  it('n か月目に戻ると、n か月目の行動を選ぶ直前の状態（再生した結果）になる', () => {
    const save = played(TURNS);
    for (let m = 1; m <= TURNS.length; m++) {
      const back = rewindSave(save, m);
      expect(back.turns).toEqual(TURNS.slice(0, m - 1));
      const s = replaySave(back);
      expect(s.history).toHaveLength(m);
      expect(s.phase).toBe('playing');
      expect(s).toEqual(byHand(TURNS.slice(0, m - 1)));
      expect(replaySaveTo(save, m)).toEqual(s);
    }
    // turns の数 + 1 は今の状態そのもの
    expect(replaySaveTo(save, TURNS.length + 1)).toEqual(replaySave(save));
  });

  it('戻る直前の行動の列が前の試行として残り、再生すると戻る前の状態になる', () => {
    const save = played(TURNS);
    const back = rewindSave(save, 3);
    expect(back.previous).toEqual(TURNS);
    expect(replaySave(previousSave(back)!)).toEqual(replaySave(save));
    // 戻った後に別の行動で進めても、前の試行は残り、今の試行は再生と一致する
    const other: Action[] = [{ type: 'optimize' }];
    const next = withTurn(back, other);
    expect(next.previous).toEqual(TURNS);
    expect(replaySave(next)).toEqual(byHand([...TURNS.slice(0, 2), other]));
    // 前の試行を消す
    expect(withoutPrevious(next).previous).toBeUndefined();
    expect(previousSave(withoutPrevious(next))).toBeNull();
    expect(replaySave(withoutPrevious(next))).toEqual(replaySave(next));
  });

  it('もう一度戻ると、前の試行は戻る直前の列で上書きされる', () => {
    const first = withTurn(rewindSave(played(TURNS), 2), [
      { type: 'optimize' },
    ]);
    const second = rewindSave(first, 1);
    expect(second.previous).toEqual(first.turns);
    expect(second.previous).not.toEqual(TURNS);
    expect(second.turns).toEqual([]);
  });

  it('前の試行は JSON を通しても残り、前の試行の無い保存・壊れた前の試行は前の試行なしで読む', () => {
    const back = rewindSave(played(TURNS), 2);
    const parsed = parseSave(JSON.parse(JSON.stringify(back)))!;
    expect(parsed.previous).toEqual(TURNS);
    expect(replaySave(parsed)).toEqual(replaySave(back));
    expect(
      parseSave(JSON.parse(JSON.stringify(played(TURNS))))!.previous,
    ).toBeUndefined();
    const broken = parseSave({
      ...JSON.parse(JSON.stringify(back)),
      previous: [[1]],
    });
    expect(broken).not.toBeNull();
    expect(broken!.previous).toBeUndefined();
    // 前の試行の古い行動も今の形に読み替える（D-58）
    const legacy = parseSave({
      ...JSON.parse(JSON.stringify(back)),
      previous: [[{ type: 'set', key: 'compress', value: 100 }]],
    })!;
    expect(legacy.previous).toEqual([
      [{ type: 'set', key: 'format', value: 105 }],
    ]);
  });

  it('終わった後も、行動を選んだ月には戻れる。今の月・最後の月・範囲外には戻れない', () => {
    // CF Free は 3 か月目に終わる
    const save = [[], []].reduce(
      (a, t: Action[]) => withTurn(a, t),
      newSave({
        scenarioId: 'article-community',
        stackIndex: 0,
        seed: 42,
        startDate: '2026-10-31',
      }),
    );
    const ended = replaySave(save);
    expect(ended.phase).not.toBe('playing');
    const back = replaySave(rewindSave(save, 2));
    expect(back.phase).toBe('playing');
    expect(back.history).toHaveLength(2);
    expect(replaySave(previousSave(rewindSave(save, 2))!)).toEqual(ended);
    expect(() => rewindSave(save, 3)).toThrow(RangeError);
    expect(() => rewindSave(save, 0)).toThrow(RangeError);
    expect(() => rewindSave(save, 1.5)).toThrow(RangeError);
    expect(() => replaySaveTo(save, 4)).toThrow(RangeError);
  });
});
