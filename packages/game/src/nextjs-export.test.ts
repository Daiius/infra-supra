// Next.js の静的書き出し（output: 'export'。D-80・prd/06 §7）: 記事は静的にビルドし直し（D-68 の Astro と同じ仕組み）、
// マイページの中身はブラウザが API で取る（SPA と同じ。API の置き場も SPA の組）。初回表示・JS の量は Next.js と同じ扱い。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  checkAction,
  componentSlots,
  DEFAULT_START_DATE,
  hiddenSettings,
  newGame,
  ON_DEMAND_REVALIDATE,
  playMonth,
  requirementStatus,
  SCENARIOS,
  setupRevalidateOptions,
  stackName,
  stackSupports,
  STACKS,
  type FrameworkId,
} from './index.ts';

const article = SCENARIOS['article-community']!;
const contract = SCENARIOS['contract-operations']!;
const idx = (id: string) => STACKS.findIndex((x) => x.id === id);
const CF_PAID = idx('cloudflare-vinext-paid');
const VERCEL_PRO = idx('vercel-supabase-pro');
const VPS_2GB = idx('sakura-vps-2gb');
const AWS = idx('aws-amplify');
const OPENNEXT = STACKS.findIndex((x) => x.provider === 'aws-opennext');

const ex = (stack = CF_PAID, sc = article, seed = 42, components = {}) =>
  playMonth(
    newGame(stack, seed, sc, DEFAULT_START_DATE, 'nextjs-export', components),
  );

/** 何もしないで最後まで回した所持金。 */
function endCash(fw: FrameworkId, stack: number, seed: number, sc = article) {
  let s = playMonth(newGame(stack, seed, sc, DEFAULT_START_DATE, fw));
  while (s.phase === 'playing') s = playMonth(applyActions(s, []));
  return s;
}

describe('Next.js の静的書き出し（D-80）', () => {
  it('両方のシナリオで選べる。AWS は S3 + CloudFront に載り、OpenNext は使わない（乗り換えもできない）', () => {
    expect(ex().framework).toBe('nextjs-export');
    expect(ex(CF_PAID, contract).framework).toBe('nextjs-export');
    expect(stackSupports(AWS, 'nextjs-export')).toBe(true);
    expect(stackSupports(OPENNEXT, 'nextjs-export')).toBe(false);
    expect(
      checkAction(ex(), { type: 'migrate', stackIndex: OPENNEXT }).ok,
    ).toBe(false);
    expect(checkAction(ex(), { type: 'migrate', stackIndex: AWS }).ok).toBe(
      true,
    );
    expect(stackName(CF_PAID, 'nextjs-export')).toBe(
      'Cloudflare Paid（Next.js の静的書き出し）',
    );
    expect(stackName(CF_PAID, 'nextjs-export', false)).toBe('Cloudflare Paid');
  });

  it('ISR のキャッシュ・OGP の前処理・API の応答のキャッシュは出さず、API の置き場は SPA と同じ組', () => {
    const slots = componentSlots(ex()).map((x) => x.slot);
    for (const x of ['isrCache', 'ogp', 'apiCache'])
      expect(slots).not.toContain(x);
    expect(slots).toContain('api');
    expect(
      componentSlots(ex(VERCEL_PRO))
        .find((x) => x.slot === 'api')
        ?.options.map((o) => o.id),
    ).toEqual(['same', 'cf-workers']);
    expect(ex(CF_PAID, article, 42, { api: 'aws-lambda' }).components.api).toBe(
      'aws-lambda',
    );
    expect(
      stackName(VERCEL_PRO, 'nextjs-export', true, { api: 'cf-workers' }),
    ).toBe(
      'Vercel Pro の静的 + Cloudflare Workers・D1（Next.js の静的書き出し）',
    );
  });

  it('画像: Vercel・VPS は既定のローダーが使えないので「投稿のときに縮める」が既定で、閲覧のときの変換は選べない（受託は画像を出さないので替えない）', () => {
    for (const st of [VERCEL_PRO, VPS_2GB]) {
      const s = ex(st);
      expect(s.components.images).toBe('resize');
      const opts = componentSlots(s)
        .find((x) => x.slot === 'images')!
        .options.map((o) => o.id);
      expect(opts).not.toContain('default');
    }
    expect(ex(CF_PAID).components.images).toBe('images');
    expect(ex(VERCEL_PRO, contract).components.images).toBe('default');
  });

  it('revalidateSec は「ビルドの間隔」として出し、延ばすと鮮度が下がる。即時反映の要件は記事の更新ごとのビルドで満たす（仮定）', () => {
    const s = ex();
    expect(hiddenSettings(s)).toEqual(
      expect.arrayContaining(['isr', 'apiCacheTtl']),
    );
    expect(hiddenSettings(s)).not.toContain('buildInterval');
    expect(setupRevalidateOptions(article, 'nextjs-export').length).toBe(5);
    expect(setupRevalidateOptions(contract, 'nextjs-export')).toEqual([]);
    const t = playMonth(
      applyActions(s, [{ type: 'set', key: 'buildInterval', value: 21600 }]),
    );
    const r = t.history[t.history.length - 1]!;
    expect(r.satisfaction.stages.freshness).toBe('bad');
    expect(r.satisfaction.reasons.freshness).toContain('ビルドの間隔');
    expect(
      requirementStatus(CF_PAID, {}, 'on-demand-isr', 'nextjs-export')[0]?.ok,
    ).toBe(true);
  });

  it('Vercel Pro ではビルドの時間が請求に出る', () => {
    const ids = ex(VERCEL_PRO).history[0]!.lines.map((l) => l.meterId);
    expect(ids).toContain('build-cpu-minutes');
  });

  // D-117 でメールの通数から Bot の PV を除き、所持金がわずかに増えて記事は 17 → 18 / 20
  it('CF Paid は何もしないで、受託はシード 1〜20 のすべてで合格する。記事は新しい記事がビルドまで開けない分（D-104）だけ鮮度が下がり、20 → 18 / 20', () => {
    const failing = (sc: typeof article) => {
      const out: number[] = [];
      for (let seed = 1; seed <= 20; seed++)
        if (endCash('nextjs-export', CF_PAID, seed, sc).end?.reason !== 'won')
          out.push(seed);
      return out;
    };
    expect(failing(contract)).toEqual([]);
    expect(failing(article).length).toBe(2);
  });

  it('記事: 鮮度の遅れは間隔 + ビルドの時間（記事 2,000 ページで 2 分）。新しい記事はビルドまで開けないので、投稿した人の許容（1 分）を超えて 1 段下げる（D-104）', () => {
    expect(article.satisfaction.freshness.newPostVisibleSec).toBe(60);
    // 既定の 5 分: 遅れ 5 分 + 2 分 = 7 分で「普通」、さらに 1 段下げて「悪い」
    const r = ex().history[0]!;
    expect(r.satisfaction.stages.freshness).toBe('bad');
    expect(r.satisfaction.reasons.freshness).toContain(
      'ビルドの間隔 5 分 + ビルドの時間 約 2 分',
    );
    expect(r.satisfaction.reasons.freshness).toContain(
      '投稿した人がすぐ開けない',
    );
    // 更新のたびのビルド: 遅れはビルドの時間だけ（2 分で「良い」）だが、許容の 1 分を超えるので「普通」
    const o = playMonth(
      applyActions(ex(), [
        { type: 'set', key: 'buildInterval', value: ON_DEMAND_REVALIDATE },
      ]),
    ).history.at(-1)!;
    expect(o.satisfaction.stages.freshness).toBe('fair');
    // Next.js の ISR・Astro のキャッシュは新しい記事を閲覧のときに描くので下げない
    for (const fw of ['nextjs', 'astro'] as const)
      expect(
        playMonth(newGame(CF_PAID, 42, article, DEFAULT_START_DATE, fw))
          .history[0]!.satisfaction.stages.freshness,
      ).toBe('good');
  });
});
