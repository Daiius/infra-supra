// 手元の結果の履歴（D-144）の純粋な部分: 形の確かめ・足し方・比べ方・花火の段（D-145）。
import {
  newSave,
  parseSave,
  replaySave,
  ROUTE_STRATEGIES,
  withTurn,
  type ResultAxes,
  type SaveData,
} from 'game';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  compareWithHistory,
  fireworkLevel,
  mergeResults,
  parseResults,
  playId,
  RESULTS_LIMIT,
  RESULTS_VERSION,
  resultEntryOf,
  withResult,
  type ResultEntry,
  type ResultStore,
} from './results-history.ts';

const axes = (
  cash: number,
  satisfaction = 0.8,
  featurePoints = 50,
  edgeMonths = 1,
): ResultAxes => ({ cash, satisfaction, featurePoints, edgeMonths });
const entry = (
  id: string,
  a: ResultAxes,
  reason: ResultEntry['end']['reason'] = 'completed',
  scenarioId = 'article-community',
): ResultEntry => ({
  id,
  scenarioId,
  seed: 1,
  startDate: '2026-11-02',
  finishedAt: '2026-11-09',
  setup: 'x',
  axes: a,
  outages: 0,
  end: { reason, month: reason === 'completed' ? 12 : 3 },
});
const store = (entries: ResultEntry[]): ResultStore => ({
  version: RESULTS_VERSION,
  entries,
});

describe('parseResults', () => {
  it('壊れた値・版の違う値は空にし、壊れた 1 件だけを捨てる', () => {
    expect(parseResults(null).entries).toEqual([]);
    expect(parseResults('x').entries).toEqual([]);
    expect(parseResults({ version: 999, entries: [] }).entries).toEqual([]);
    const ok = entry('a', axes(100));
    const parsed = parseResults({
      version: RESULTS_VERSION,
      entries: [ok, { ...ok, axes: { cash: 'x' } }, { ...ok, end: null }, 1],
    });
    expect(parsed.entries).toEqual([ok]);
  });
});

describe('withResult', () => {
  it('新しい順に先頭へ足し、同じ id は二重に足さず、上限を超えた古いものを落とす', () => {
    let s = store([]);
    s = withResult(s, entry('a', axes(1)));
    s = withResult(s, entry('b', axes(2)));
    expect(s.entries.map((e) => e.id)).toEqual(['b', 'a']);
    expect(withResult(s, entry('a', axes(9)))).toBe(s);
    for (let i = 0; i < RESULTS_LIMIT + 5; i++)
      s = withResult(s, entry(`n${i}`, axes(i)));
    expect(s.entries.length).toBe(RESULTS_LIMIT);
    expect(s.entries[0]!.id).toBe(`n${RESULTS_LIMIT + 4}`);
  });
});

describe('playId・resultEntryOf', () => {
  it('前の試行を除いた保存から決まり、行動が違えば別の id', () => {
    const base = newSave({
      scenarioId: 'article-community',
      stackIndex: 1,
      seed: 42,
      startDate: '2026-11-02',
    });
    const a = withTurn(base, []);
    expect(playId({ ...a, previous: [[]] })).toBe(playId(a));
    expect(playId(withTurn(a, []))).not.toBe(playId(a));
  });

  it('キーの並びが違っても同じ id。描き方と確約を選んだ保存は読み直しても id が変わらない（OCL-09A16C94）', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(
      '{"a":[{"d":2}],"b":1}',
    );
    const route = Object.keys(ROUTE_STRATEGIES)[0]!;
    // 始める画面と同じ並び（routes → commitments）で作り、読み直し（parseSave は commitments → routes の並び）と比べる
    const save: SaveData = {
      ...newSave({
        scenarioId: 'article-community',
        stackIndex: 1,
        seed: 42,
        startDate: '2026-11-02',
        routes: { article: route as never },
        commitments: [{ key: 'k', payment: 'no-upfront' }],
      }),
    };
    const reread = parseSave(JSON.parse(JSON.stringify(save)))!;
    expect(reread.routes).toEqual(save.routes);
    expect(reread.commitments).toEqual(save.commitments);
    expect(playId(reread)).toBe(playId(save));
    const shuffled = Object.fromEntries(
      Object.entries(save).reverse(),
    ) as SaveData;
    expect(playId(shuffled)).toBe(playId(save));
  });

  it('終わった状態から 4 軸・止まった月・終わり方を写す', () => {
    let save = newSave({
      scenarioId: 'article-community',
      stackIndex: 0,
      seed: 42,
      startDate: '2026-11-02',
    });
    while (replaySave(save).phase === 'playing') save = withTurn(save, []);
    const st = replaySave(save);
    const e = resultEntryOf(save, st, '2026-11-09');
    expect(e.end).toEqual(st.end);
    expect(e.outages).toBe(st.outages);
    expect(e.axes.cash).toBe(st.cash);
    expect(e.setup).toContain('Cloudflare');
    expect(parseResults(store([e])).entries).toEqual([e]);
  });
});

describe('mergeResults', () => {
  it('別のタブが足した結果を消さず、この画面だけが持つ結果も残す（OCL-E9D5918D）', () => {
    const persisted = store([entry('other-tab', axes(1)), entry('a', axes(2))]);
    const memory = store([entry('mine', axes(3)), entry('a', axes(2))]);
    expect(mergeResults(persisted, memory).entries.map((e) => e.id)).toEqual([
      'other-tab',
      'a',
      'mine',
    ]);
    const many = store(
      Array.from({ length: RESULTS_LIMIT }, (_, i) => entry(`p${i}`, axes(i))),
    );
    expect(
      mergeResults(many, store([entry('x', axes(0))])).entries.length,
    ).toBe(RESULTS_LIMIT);
  });
});

describe('compareWithHistory・fireworkLevel', () => {
  const cur = (a: ResultAxes) => ({
    id: 'now',
    scenarioId: 'article-community',
    axes: a,
  });

  it('過去が無ければ比べず、花火は 1 段', () => {
    const c = compareWithHistory(cur(axes(100)), [entry('now', axes(100))]);
    expect(c.map((x) => x.count)).toEqual([0, 0, 0, 0]);
    expect(c.some((x) => x.newBest)).toBe(false);
    expect(c[0]!.rank).toBe(1);
    expect(fireworkLevel(c)).toBe(1);
  });

  it('同じシナリオの完走だけと比べ、自己ベスト・前回との差・順位を出す', () => {
    const past = [
      entry('now', axes(999)), // 今のプレイの記録は除く
      entry('last', axes(150, 0.7, 60, 0)),
      entry('old', axes(200, 0.9, 40, 0)),
      entry('lost', axes(5000), 'cash'), // 途中終了は混ぜない
      entry('other', axes(5000), 'completed', 'contract-operations'),
    ];
    const c = compareWithHistory(cur(axes(180, 0.8, 70, 2)), past);
    const by = Object.fromEntries(c.map((x) => [x.id, x]));
    expect(by.cash).toMatchObject({
      count: 2,
      best: 200,
      newBest: false,
      diffFromLast: 30,
      rank: 2,
    });
    expect(by.featurePoints).toMatchObject({ newBest: true, rank: 1 });
    expect(by.edgeMonths).toMatchObject({ newBest: true, diffFromLast: 2 });
    expect(by.satisfaction!.rank).toBe(2);
    // 自己ベストの更新が 2 軸 → 2 段
    expect(fireworkLevel(c)).toBe(2);
  });

  it('同じ値は自己ベストの更新に数えず、3 軸以上の更新で 3 段', () => {
    const past = [entry('a', axes(100, 0.5, 10, 0))];
    const tie = compareWithHistory(cur(axes(100, 0.5, 10, 0)), past);
    expect(tie.every((x) => !x.newBest && x.rank === 1)).toBe(true);
    const up = compareWithHistory(cur(axes(101, 0.6, 11, 0)), past);
    expect(fireworkLevel(up)).toBe(3);
  });
});
