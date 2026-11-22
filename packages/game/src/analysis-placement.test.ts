// 部品「解析の置き場」（prd/17 §5.1・D-235）: 解析のあるシナリオ（棋譜解析）だけで出し、部品の行動で切り替わる。
// 記事・受託ではスロットを出さず、構成も変えない（golden は game.test.ts・contract.test.ts が見る）。
import { describe, expect, it } from 'vitest';
import {
  actionEffort,
  addedAccounts,
  applyAction,
  checkAction,
  componentSlots,
  DEFAULT_START_DATE,
  EFFORT,
  ESTIMATE_ONLY_SCENARIOS,
  newGame,
  playMonth,
  scenarioAnalyzes,
  SCENARIOS,
  selfHostedOf,
  setupSlots,
  STACKS,
  type GameState,
} from './index.ts';

// 遊びの値（所持金など）は PR-11 で決めるまで受託の仮のもの。1 局面の重さ（D-236）では 1 か月目で尽きるので、所持金だけ足す
const kifu = {
  ...ESTIMATE_ONLY_SCENARIOS['kifu-analysis']!,
  startCash: 1e7,
};
const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const VERCEL_PRO = idx('vercel-supabase-pro');
const CF_PAID = idx('cloudflare-vinext-paid');
const VPS = idx('sakura-vps-2gb');
const analysis = (option: string) =>
  ({ type: 'component', slot: 'analysis', option }) as const;
const last = (s: GameState) => s.history[s.history.length - 1]!;
const usdOf = (s: GameState, nodeId: string) =>
  last(s)
    .lines.filter((l) => l.nodeIds?.includes(nodeId))
    .reduce((a, l) => a + l.amount, 0);

describe('解析のあるシナリオだけで出す', () => {
  it('非同期の API（解析）を持つのは棋譜解析だけ', () => {
    expect(scenarioAnalyzes(kifu)).toBe(true);
    expect(scenarioAnalyzes(article)).toBe(false);
    expect(scenarioAnalyzes(contract)).toBe(false);
  });

  it('記事・受託ではスロットを出さず、部品の選択も持たず、行動も選べない', () => {
    for (const sc of [article, contract])
      for (const s of STACKS) {
        if (s.hidden) continue;
        expect(
          setupSlots(sc, s.index, 'nextjs').some((x) => x.slot === 'analysis'),
        ).toBe(false);
        const g = newGame(s.index, 1, sc);
        expect(g.components.analysis).toBeUndefined();
        expect(componentSlots(g).some((x) => x.slot === 'analysis')).toBe(
          false,
        );
        expect(checkAction(g, analysis('client')).ok).toBe(false);
      }
  });

  it('棋譜解析では既定がアプリと同じ実行環境で、5 つから選べる', () => {
    for (const s of STACKS) {
      if (s.hidden) continue;
      const slot = setupSlots(kifu, s.index, 'nextjs').find(
        (x) => x.slot === 'analysis',
      );
      expect(slot?.options.map((o) => o.id).sort(), s.id).toEqual(
        ['client', 'hybrid', 'same', 'worker-vps-2gb', 'worker-vps-4gb'].sort(),
      );
      expect(newGame(s.index, 1, kifu).components.analysis).toBe('same');
    }
  });
});

describe('部品の行動で切り替える', () => {
  const start = (stack: number) =>
    playMonth(newGame(stack, 1, kifu, DEFAULT_START_DATE, 'nextjs'));

  it('worker に替えると工数を使い、翌月から worker の VPS の月額がかかり、自前運用になる', () => {
    const s = start(VERCEL_PRO);
    expect(usdOf(s, 'analysis-worker')).toBe(0);
    // さくらのアカウントが増えるので、設定の一度きりの工数も今月使う
    expect(actionEffort(s, analysis('worker-vps-2gb'))).toBe(
      EFFORT.component.analysis + EFFORT.accountSetup,
    );
    expect(actionEffort(s, analysis('client'))).toBe(EFFORT.component.analysis);
    expect(actionEffort(s, analysis('same'))).toBeNull();
    const a = applyAction(s, analysis('worker-vps-2gb'));
    expect(a.components.analysis).toBe('worker-vps-2gb');
    const next = playMonth(a);
    expect(last(next).components.analysis).toBe('worker-vps-2gb');
    expect(usdOf(next, 'analysis-worker')).toBeGreaterThan(0);
    expect(selfHostedOf(VERCEL_PRO, next.components)).toBe(true);
    // さくらのアカウントが 1 つ増える
    expect(addedAccounts(VERCEL_PRO, { analysis: 'worker-vps-2gb' })).toEqual([
      'sakura',
    ]);
  });

  it('端末に替えると、翌月からアプリの関数の解析の CPU が無くなる（費用が下がる）', () => {
    const s = start(CF_PAID);
    const fn = (g: GameState) =>
      last(g)
        .lines.filter((l) => l.meterId === 'cpu-ms')
        .reduce((a, l) => a + l.amount, 0);
    const next = playMonth(applyAction(s, analysis('client')));
    expect(last(next).components.analysis).toBe('client');
    expect(fn(next)).toBeLessThan(fn(s));
  });

  it('VPS の構成で worker を足すと、アプリの VPS とは別にもう 1 台分の月額がかかる', () => {
    const s = start(VPS);
    const next = playMonth(applyAction(s, analysis('worker-vps-2gb')));
    expect(usdOf(next, 'analysis-worker')).toBeGreaterThan(0);
    expect(usdOf(next, 'vps')).toBeGreaterThan(0);
    expect(addedAccounts(VPS, { analysis: 'worker-vps-2gb' })).toEqual([]);
  });
});
