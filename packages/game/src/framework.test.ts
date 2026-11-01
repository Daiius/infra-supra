// フレームワークの分岐（prd/10 段 1・D-34）。SPA を選んだときの基準プレイと、効き方の仕組み。
// 効き方の値（話題の伸び・初回表示）はゲーム上の仮定。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  checkAction,
  hiddenSettings,
  componentPreview,
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

  it('受託の説明の添付件数は計算と同じ（月 2 件。OCL-A1AC2862）', () => {
    const app = contract.text?.app ?? [];
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

describe('SPA の API の応答のキャッシュ（D-37）', () => {
  const VERCEL_PRO = 3;
  const VPS = 4;
  const spaGame = (stack: number) =>
    playMonth(newGame(stack, 42, article, DEFAULT_START_DATE, 'vite-spa'));

  it('記事コミュニティの SPA だけに出る（Next.js・受託では出さない）。期間の設定も SPA だけ', () => {
    const spa = spaGame(VERCEL_PRO);
    expect(componentSlots(spa).map((x) => x.slot)).toContain('apiCache');
    expect(hiddenSettings(spa)).not.toContain('apiCacheTtl');
    const next = playMonth(newGame(VERCEL_PRO, 42, article));
    expect(componentSlots(next).map((x) => x.slot)).not.toContain('apiCache');
    expect(hiddenSettings(next)).toContain('apiCacheTtl');
    const c = newGame(1, 42, contract, DEFAULT_START_DATE, 'vite-spa');
    expect(componentSlots(c).map((x) => x.slot)).not.toContain('apiCache');
    expect(hiddenSettings(c)).toContain('apiCacheTtl');
  });

  it('キャッシュすると記事は期間だけ古く見え、期間を延ばすと鮮度が下がる', () => {
    let s = applyActions(spaGame(VERCEL_PRO), [
      { type: 'component', slot: 'apiCache', option: 'cdn' },
      { type: 'set', key: 'apiCacheTtl', value: 21600 },
    ]);
    s = playMonth(s);
    const r = s.history[s.history.length - 1]!;
    expect(r.satisfaction.stages.freshness).toBe('bad');
    expect(r.satisfaction.reasons.freshness).toContain(
      'API のキャッシュの期間',
    );
  });

  it('選ぶ前に、Workers Cache の課金の事実を出す（Free・Paid とも）', () => {
    for (const stack of [0, 1]) {
      const ids = componentPreview(spaGame(stack), 'apiCache', 'cdn').map(
        (p) => p.id,
      );
      expect(ids.some((id) => id.endsWith(':workers-cache-front'))).toBe(true);
    }
  });

  it('VPS は前段の CDN が無いと選べず、キャッシュしている間は前段の CDN を外せない', () => {
    const s = spaGame(VPS);
    const cache = {
      type: 'component',
      slot: 'apiCache',
      option: 'cdn',
    } as const;
    expect(checkAction(s, cache).ok).toBe(false);
    const withCdn = applyActions(s, [
      { type: 'component', slot: 'frontCdn', option: 'static' },
    ]);
    expect(checkAction(withCdn, cache).ok).toBe(true);
    const both = applyActions(withCdn, [cache]);
    expect(
      checkAction(both, { type: 'component', slot: 'frontCdn', option: 'none' })
        .ok,
    ).toBe(false);
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

  // D-47: 記事のデザインの刷新の提案（7 か月目）を断る基準プレイは、2 か月画質が下がって所持金が少し下がる
  it('記事コミュニティの SPA の基準プレイ（golden。シード 42）', () => {
    // D-48: Vercel Pro の込み分をやめ、クレジットがすべての従量に当たる形に（Vercel Pro・何もしないは所持金が約 $550 減る）
    const r = Object.fromEntries(
      article.baselines.map((b) => {
        const s = playStrategy(b, 42, article, DEFAULT_START_DATE, 'vite-spa');
        return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
      }),
    );
    expect(r).toEqual({
      'cf-paid': ['1840.83', 'won', 12],
      'cf-paid-accept': ['1936.66', 'won', 12],
      'vps-images': ['1641.36', 'goal', 12],
      'vercel-pro': ['829.40', 'goal', 12],
      'vercel-to-cf': ['1408.57', 'goal', 12],
      'cf-free': ['142.89', 'outages', 3],
      'cf-paid-kvdb': ['1695.56', 'goal', 12],
      'cf-paid-chat': ['1867.32', 'won', 12],
      'vps-sla': ['1593.41', 'goal', 12],
    });
  });
});
