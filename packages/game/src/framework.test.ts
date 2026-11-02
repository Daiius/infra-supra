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
  requirementStatus,
  SCENARIOS,
  setupRevalidateOptions,
  stackName,
  stackSupports,
  STACKS,
  type GameState,
} from './index.ts';
import { speedHeaviness } from './rules.ts';

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
    // D-95: メールの送信（CF Paid は Email Service・ほかは SES）の費用で所持金が $9〜40 減る（結果は変わらない）
    // D-96: ドメインの登録と DNS の費用で所持金が $3〜17 減る（結果は変わらない）
    // D-48: Vercel Pro の込み分をやめ、クレジットがすべての従量に当たる形に（Vercel Pro・何もしないは所持金が約 $550 減る）
    const r = Object.fromEntries(
      article.baselines.map((b) => {
        const s = playStrategy(b, 42, article, DEFAULT_START_DATE, 'vite-spa');
        return [b.id, [s.cash.toFixed(2), s.end?.reason, s.end?.month]];
      }),
    );
    expect(r).toEqual({
      'cf-paid': ['1806.06', 'won', 12],
      'cf-paid-accept': ['1885.66', 'won', 12],
      'vps-images': ['1620.95', 'goal', 12],
      'vercel-pro': ['807.89', 'goal', 12],
      'vercel-to-cf': ['1376.32', 'goal', 12],
      'cf-free': ['138.79', 'outages', 3],
      'cf-paid-kvdb': ['1663.35', 'goal', 12],
      'cf-paid-chat': ['1832.10', 'won', 12],
      'vps-sla': ['1573.24', 'goal', 12],
      'vps-cdn': ['1555.48', 'goal', 12],
      'vercel-cf-images': ['1334.03', 'goal', 12],
      'aws-amplify-cdn': ['1787.88', 'won', 12],
      'aws-opennext-images': ['1928.34', 'won', 12],
    });
  });
});

describe('Astro（D-68）', () => {
  const CF_PAID = 1;
  const VERCEL_PRO = 3;
  const AWS = STACKS.findIndex((x) => x.id === 'aws-amplify');
  const astro = (stack = CF_PAID, sc = article, seed = 42) =>
    playMonth(newGame(stack, seed, sc, DEFAULT_START_DATE, 'astro'));

  it('両方のシナリオで選べる。AWS には公式のアダプターが無いので載せず、乗り換えもできない', () => {
    expect(astro().framework).toBe('astro');
    expect(astro(CF_PAID, contract).framework).toBe('astro');
    expect(stackSupports(AWS, 'astro')).toBe(false);
    expect(stackSupports(AWS, 'nextjs')).toBe(true);
    // 載せられない構成で始めようとしたら既定（Next.js）
    expect(
      newGame(AWS, 42, article, DEFAULT_START_DATE, 'astro').framework,
    ).toBe('nextjs');
    const r = checkAction(astro(), { type: 'migrate', stackIndex: AWS });
    expect(r.ok).toBe(false);
    expect(
      checkAction(astro(), { type: 'migrate', stackIndex: VERCEL_PRO }).ok,
    ).toBe(true);
  });

  it('ISR のキャッシュ・OGP の前処理・API の応答のキャッシュは出さない。構成の名前は vinext を外して（Astro）を添える', () => {
    const slots = componentSlots(astro()).map((x) => x.slot);
    for (const x of ['isrCache', 'ogp', 'apiCache'])
      expect(slots).not.toContain(x);
    // API の置き場は許した組だけ（Cloudflare の Astro + VPS の API。D-69）
    expect(slots).toContain('api');
    expect(slots).toContain('images');
    expect(stackName(CF_PAID, 'astro')).toBe('Cloudflare Paid（Astro）');
    expect(stackName(CF_PAID, 'astro', false)).toBe('Cloudflare Paid');
  });

  it('revalidateSec は「ビルドの間隔」として出し、ISR の間隔・API のキャッシュの期間は出さない（受託では出さない）', () => {
    const s = astro();
    expect(hiddenSettings(s)).toEqual(
      expect.arrayContaining(['isr', 'apiCacheTtl']),
    );
    expect(hiddenSettings(s)).not.toContain('buildInterval');
    expect(checkAction(s, { type: 'set', key: 'isr', value: 3600 }).ok).toBe(
      false,
    );
    expect(
      checkAction(s, { type: 'set', key: 'buildInterval', value: 3600 }).ok,
    ).toBe(true);
    expect(hiddenSettings(playMonth(newGame(1, 42, article)))).toContain(
      'buildInterval',
    );
    expect(hiddenSettings(astro(CF_PAID, contract))).toContain('buildInterval');
    expect(setupRevalidateOptions(article, 'astro').length).toBe(5);
    expect(setupRevalidateOptions(contract, 'astro')).toEqual([]);
  });

  it('ビルドの間隔を延ばすと鮮度が下がる（理由は「ビルドの間隔」）', () => {
    let s = applyActions(astro(), [
      { type: 'set', key: 'buildInterval', value: 21600 },
    ]);
    s = playMonth(s);
    const r = s.history[s.history.length - 1]!;
    expect(r.satisfaction.stages.freshness).toBe('bad');
    expect(r.satisfaction.reasons.freshness).toContain('ビルドの間隔');
  });

  it('Vercel Pro ではビルドの時間が請求に出る。即時反映の要件は記事の更新ごとのビルドで満たす（仮定）', () => {
    const s = astro(VERCEL_PRO);
    const ids = s.history[0]!.lines.map((l) => l.meterId);
    expect(ids).toContain('build-cpu-minutes');
    expect(requirementStatus(1, {}, 'on-demand-isr', 'astro')[0]?.ok).toBe(
      true,
    );
  });

  it('初回表示の軽さ（ゲーム上の仮定）は速さの重さを 1 つ減らす（0 より下げない）', () => {
    const base = { ssrCpuMs: 20, imageKB: 200, variants: 3, premises: [] };
    const sat = article.satisfaction;
    expect(speedHeaviness({ ...base, firstLoadLight: true }, sat)).toBe(
      speedHeaviness(base, sat) - 1,
    );
    expect(
      speedHeaviness(
        { ...base, ssrCpuMs: 1, imageKB: 1, firstLoadLight: true },
        sat,
      ),
    ).toBe(0);
  });

  it('CF Paid（目標の根拠）は何もしないでシード 1〜20 のすべてで合格する（記事・受託）', () => {
    for (const sc of [article, contract]) {
      const failing: number[] = [];
      for (let seed = 1; seed <= 20; seed++) {
        let s = astro(CF_PAID, sc, seed);
        while (s.phase === 'playing') s = playMonth(applyActions(s, []));
        if (s.end?.reason !== 'won') failing.push(seed);
      }
      expect(failing).toEqual([]);
    }
  });
});
