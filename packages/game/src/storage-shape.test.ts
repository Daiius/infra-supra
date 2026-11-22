// 部品「保存の形」（prd/17 §5.4・D-237）: 解析のあるシナリオ（棋譜解析）だけで出し、部品の行動で切り替わる。
// 記事・受託ではスロットを出さず、構成も Workload も変えない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  applyAction,
  checkAction,
  componentSlots,
  DEFAULT_START_DATE,
  EFFORT,
  ESTIMATE_ONLY_SCENARIOS,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  STACKS,
  type GameState,
} from './index.ts';

// 遊びの値（所持金など）は PR-11 で決めるまで仮。1 か月目で尽きないよう所持金だけ足す（analysis-placement.test.ts と同じ）
const kifu = {
  ...ESTIMATE_ONLY_SCENARIOS['kifu-analysis']!,
  startCash: 1e7,
};
const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const GCP = STACKS.findIndex((s) => s.id === 'gcp-cloud-run');
const storage = (option: string) =>
  ({ type: 'component', slot: 'storage', option }) as const;
const last = (s: GameState) => s.history[s.history.length - 1]!;

describe('解析のあるシナリオだけで出す', () => {
  it('記事・受託ではスロットを出さず、部品の選択も持たず、行動も選べない', () => {
    for (const sc of [article, contract])
      for (const s of STACKS) {
        if (s.hidden) continue;
        expect(
          setupSlots(sc, s.index, 'nextjs').some((x) => x.slot === 'storage'),
        ).toBe(false);
        const g = newGame(s.index, 1, sc);
        expect(g.components.storage).toBeUndefined();
        expect(componentSlots(g).some((x) => x.slot === 'storage')).toBe(false);
        expect(checkAction(g, storage('per-game')).ok).toBe(false);
      }
  });

  it('棋譜解析では既定が一手を 1 行で、2 つから選べる', () => {
    for (const s of STACKS) {
      if (s.hidden) continue;
      const slot = setupSlots(kifu, s.index, 'nextjs').find(
        (x) => x.slot === 'storage',
      );
      expect(
        slot?.options.map((o) => o.label),
        s.id,
      ).toEqual(['一手を 1 行', '1 局を 1 行']);
      expect(newGame(s.index, 1, kifu).components.storage).toBe('per-move');
    }
  });
});

describe('部品の行動で切り替える', () => {
  it('工数を使い、翌月から Firestore の読み取りが減り、DB の増え方が小さくなる', () => {
    const s = playMonth(
      newGame(GCP, 1, kifu, DEFAULT_START_DATE, 'nextjs', {
        db: 'firestore',
      }),
    );
    expect(actionEffort(s, storage('per-game'))).toBe(EFFORT.component.storage);
    expect(actionEffort(s, storage('per-move'))).toBeNull();
    const reads = (g: GameState) =>
      last(g)
        .lines.filter((l) => l.meterId === 'reads')
        .reduce((a, l) => a + l.amount, 0);
    const before = playMonth(s);
    const after = playMonth(applyAction(s, storage('per-game')));
    expect(last(after).components.storage).toBe('per-game');
    expect(reads(after)).toBeLessThan(reads(before));
    expect(after.stock.dbGB - s.stock.dbGB).toBeLessThan(
      before.stock.dbGB - s.stock.dbGB,
    );
  });
});
