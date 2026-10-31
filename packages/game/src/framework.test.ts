// フレームワークの分岐（prd/10 段 1・D-34）。SPA を選んだときの基準プレイと、効き方の仕組み。
// 効き方の値（話題の伸び・初回表示）はゲーム上の仮定。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  checkAction,
  hiddenSettings,
  componentSlots,
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  playStrategy,
  SCENARIOS,
  stackName,
  type GameState,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;

/** 話題の月まで、何もしないで進める（SPA の OGP の前処理だけ最初に選べる）。 */
function untilBuzz(seed: number, prerender: boolean): GameState {
  let s = playMonth(newGame(1, seed, article, DEFAULT_START_DATE, 'vite-spa'));
  if (prerender)
    s = applyActions(s, [
      { type: 'component', slot: 'ogp', option: 'prerender' },
    ]);
  while (s.phase === 'playing' && !s.history[s.history.length - 1]!.buzz)
    s = playMonth(applyActions(s, []));
  return s;
}

describe('フレームワークの選択', () => {
  it('既定は Next.js。シナリオで選べないフレームワークは既定にする', () => {
    expect(newGame(1, 42, article).framework).toBe('nextjs');
    expect(
      newGame(1, 42, article, DEFAULT_START_DATE, 'vite-spa').framework,
    ).toBe('vite-spa');
    const { frameworks: _, ...rest } = article;
    const nextOnly = { ...rest, id: 't-next-only' };
    expect(
      newGame(1, 42, nextOnly, DEFAULT_START_DATE, 'vite-spa').framework,
    ).toBe('nextjs');
  });

  it('SPA では ISR のキャッシュのスロットが無く、OGP の前処理を選べる（受託では出さない）', () => {
    const a = newGame(1, 42, article, DEFAULT_START_DATE, 'vite-spa');
    const slots = componentSlots(a).map((x) => x.slot);
    expect(slots).not.toContain('isrCache');
    expect(slots).toContain('ogp');
    expect(
      componentSlots(newGame(1, 42, article)).map((x) => x.slot),
    ).not.toContain('ogp');
    const c = newGame(1, 42, contract, DEFAULT_START_DATE, 'vite-spa');
    expect(componentSlots(c).map((x) => x.slot)).not.toContain('ogp');
    expect(stackName(1, 'vite-spa')).not.toContain('vinext');
  });

  it('SPA では ISR の間隔の設定を選べない（画面にも出さない。OCL-8DFFDBEC）', () => {
    const spa = playMonth(
      newGame(1, 42, article, DEFAULT_START_DATE, 'vite-spa'),
    );
    const r = checkAction(spa, { type: 'set', key: 'isr', value: 3600 });
    expect(r.ok).toBe(false);
    expect(hiddenSettings(spa)).toContain('isr');
    const next = playMonth(newGame(1, 42, article));
    expect(checkAction(next, { type: 'set', key: 'isr', value: 3600 }).ok).toBe(
      true,
    );
    expect(hiddenSettings(next)).not.toContain('isr');
  });

  it('受託の SPA の説明の添付件数は計算と同じ（月 2 件。OCL-A1AC2862）', () => {
    const app = contract.text?.byFramework?.['vite-spa']?.app ?? [];
    const perUser = contract.template(300_000).images.uploadsPerMau;
    expect(app.some((l) => l.includes(`月 ${perUser} 件`))).toBe(true);
  });

  it('SPA は記事が常に新しく（鮮度は良い）、記事コミュニティでは初回表示が速さに効く', () => {
    const s = playMonth(
      newGame(1, 42, article, DEFAULT_START_DATE, 'vite-spa'),
    );
    const r = s.history[0]!;
    expect(r.satisfaction.stages.freshness).toBe('good');
    expect(r.satisfaction.reasons.speed).toContain('SPA の初回表示');
  });

  it('記事ごとの SNS のカードが出ないと、話題の伸びが小さい（OGP の前処理で戻る）', () => {
    for (const seed of [42, 3, 7]) {
      const plain = untilBuzz(seed, false);
      const pre = untilBuzz(seed, true);
      const last = (s: GameState) => s.history[s.history.length - 1]!;
      expect(last(plain).buzz).toBe(true);
      expect(last(plain).humanPV / last(plain).basePV).toBeLessThan(
        last(pre).humanPV / last(pre).basePV,
      );
      expect(last(plain).trafficNote).toContain('SNS のカードが出ない');
    }
  });
});

describe('SPA の基準プレイ（prd/10 B-4。目標の値は Next.js のまま）', () => {
  for (const sc of [article, contract])
    it(`${sc.name}: シード 1〜50 のどれでも、基準プレイのどれか 1 本は合格する`, () => {
      const failing: number[] = [];
      for (let seed = 1; seed <= 50; seed++) {
        const any = sc.baselines.some(
          (b) =>
            playStrategy(b, seed, sc, DEFAULT_START_DATE, 'vite-spa').end
              ?.reason === 'won',
        );
        if (!any) failing.push(seed);
      }
      expect(failing).toEqual([]);
    });

  it('記事コミュニティの SPA の基準プレイ（golden。シード 42）', () => {
    const r = Object.fromEntries(
      article.baselines.map((b) => {
        const s = playStrategy(b, 42, article, DEFAULT_START_DATE, 'vite-spa');
        return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
      }),
    );
    expect(r).toEqual({
      'cf-paid': ['1859.73', 'won', 12],
      'cf-paid-accept': ['1936.66', 'won', 12],
      'vps-images': ['1657.84', 'goal', 12],
      'vercel-pro': ['1394.34', 'goal', 12],
      'vercel-to-cf': ['1490.75', 'goal', 12],
      'cf-free': ['142.89', 'outages', 3],
      'cf-paid-kvdb': ['1712.50', 'goal', 12],
      'cf-paid-chat': ['1886.68', 'won', 12],
      'vps-sla': ['1609.19', 'goal', 12],
    });
  });
});
