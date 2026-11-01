// Next.js の静的書き出し（output: 'export'。D-80・prd/06 §7）: 記事は静的にビルドし直し（Astro と同じ）、
// マイページの中身はブラウザが API で取る（SPA と同じ。API の置き場も SPA の組）。初回表示・JS の量は Next.js と同じ扱い。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  checkAction,
  componentSlots,
  DEFAULT_START_DATE,
  hiddenSettings,
  newGame,
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

  it('CF Paid は何もしないでシード 1〜20 のすべてで合格する（記事・受託）。初回表示は Next.js と同じ扱いで、所持金は Next.js に近い', () => {
    for (const sc of [article, contract]) {
      const failing: number[] = [];
      for (let seed = 1; seed <= 20; seed++)
        if (endCash('nextjs-export', CF_PAID, seed, sc).end?.reason !== 'won')
          failing.push(seed);
      expect(failing).toEqual([]);
    }
    const diff =
      endCash('nextjs-export', CF_PAID, 1).cash -
      endCash('nextjs', CF_PAID, 1).cash;
    expect(Math.abs(diff)).toBeLessThan(100);
  });
});
