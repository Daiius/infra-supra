// Bunny（転送の安い従量の CDN。D-98・prd/11 §23）: 画像を Bunny で配る・前段の CDN を Bunny にする部品を、始める画面と
// ゲーム中に選べ、Bunny のアカウントの手間がかかる。基準プレイ（何もしない・シード 1〜20）。
import { describe, expect, it } from 'vitest';
import { meetsReference } from './reference.test-helpers.ts';
import type { Choices } from 'catalog';
import {
  addedAccounts,
  applyActions,
  ARTICLE_COMMUNITY,
  checkAction,
  componentFlavor,
  DEFAULT_START_DATE,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  STACKS,
  type FrameworkId,
} from './index.ts';
import type { Scenario } from './scenario.ts';

const idx = (id: string) => STACKS.findIndex((s) => s.id === id);
const AMPLIFY = idx('aws-amplify');
const OPENNEXT = idx('aws-opennext');
const GCP = idx('gcp-cloud-run');
const VPS = idx('sakura-vps-2gb');
const CF_PAID = idx('cloudflare-vinext-paid');
const article = ARTICLE_COMMUNITY;
const contract = SCENARIOS['contract-operations']!;

/** 何もしない・シード 1〜20 の達成数と、12 か月の費用の平均（月）。 */
function run(
  sc: Scenario,
  stack: number,
  framework: FrameworkId,
  components: Choices = {},
) {
  let won = 0;
  let cost = 0;
  let months = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let s = playMonth(
      newGame(stack, seed, sc, DEFAULT_START_DATE, framework, components),
    );
    while (s.phase === 'playing') s = playMonth(s);
    if (meetsReference(s)) won++;
    cost += s.history.reduce((a, h) => a + h.infraCost, 0);
    months += s.history.length;
  }
  return { won, monthly: Math.round((cost / months) * 10) / 10 };
}

describe('Bunny の部品', () => {
  it('始める画面: 画像（Amplify・OpenNext・Google Cloud）と前段の CDN（Amplify の Next.js・VPS）に出て、説明がある', () => {
    const ids = (stack: number, slot: string, fw: FrameworkId = 'nextjs') =>
      setupSlots(article, stack, fw)
        .find((x) => x.slot === slot)
        ?.options.map((o) => o.id) ?? [];
    for (const s of [AMPLIFY, OPENNEXT, GCP])
      expect(ids(s, 'images')).toEqual(
        expect.arrayContaining(['bunny-images', 'bunny-resize']),
      );
    expect(ids(AMPLIFY, 'frontCdn')).toContain('bunny');
    expect(ids(VPS, 'frontCdn')).toContain('bunny');
    expect(ids(VPS, 'images')).not.toContain('bunny-images');
    for (const s of [AMPLIFY, VPS])
      for (const x of setupSlots(article, s, 'nextjs'))
        for (const o of x.options)
          if (o.platform === 'bunny') expect(componentFlavor(o)).toBeDefined();
  });

  it('Bunny のアカウントが増える（D-52 のアカウントの手間）', () => {
    expect(addedAccounts(AMPLIFY, { images: 'bunny-resize' })).toEqual([
      'bunny',
    ]);
    expect(addedAccounts(VPS, { frontCdn: 'bunny' })).toEqual(['bunny']);
  });

  it('VPS の API の応答のキャッシュは Cloudflare の前段だけ（Bunny の前段では選べない）', () => {
    const s = newGame(VPS, 1, article, DEFAULT_START_DATE, 'vite-spa', {
      frontCdn: 'bunny',
    });
    const c = checkAction(s, {
      type: 'component',
      slot: 'apiCache',
      option: 'cdn',
    });
    expect(c.ok).toBe(false);
  });

  it('ゲーム中に画像を Bunny へ差し替えられ、明細に Bunny の転送が出る', () => {
    let s = playMonth(
      newGame(OPENNEXT, 1, article, DEFAULT_START_DATE, 'nextjs'),
    );
    s = playMonth(
      applyActions(s, [
        { type: 'component', slot: 'images', option: 'bunny-resize' },
      ]),
    );
    for (let i = 0; i < 6 && s.components.images !== 'bunny-resize'; i++)
      s = playMonth(applyActions(s, []));
    expect(s.components.images).toBe('bunny-resize');
    const last = s.history[s.history.length - 1]!;
    expect(
      last.lines.some(
        (l) => l.provider === 'bunny' && l.meterId === 'bandwidth',
      ),
    ).toBe(true);
  });
});

describe('基準プレイ（何もしない・シード 1〜20。prd/11 §23.3）', () => {
  it('CF Paid（目標の根拠）は変わらない', () => {
    expect(run(article, CF_PAID, 'nextjs').won).toBe(20);
    expect(run(contract, CF_PAID, 'nextjs').won).toBe(20);
  });

  it('記事 × Amplify: 前段を Bunny にすると、自前の CloudFront の前段より安く、達成は減らない（静的なファイルが常時無料の 1 TB を超える分）', () => {
    const cf = run(article, AMPLIFY, 'nextjs', { frontCdn: 'static' });
    const bn = run(article, AMPLIFY, 'nextjs', { frontCdn: 'bunny' });
    expect(bn.monthly).toBeLessThan(cf.monthly);
    // D-121 の前は達成も増えた（10 → 14）。一律で縮める画像はサムネイルにも 400 KB を配るので、どちらも届かなくなった（0 / 20）
    expect(bn.won).toBeGreaterThanOrEqual(cf.won);
  });

  it('記事 × OpenNext・Google Cloud: 画像を Bunny で配ると全シード達成（画像だけ Cloudflare よりは高い）', () => {
    for (const stack of [OPENNEXT, GCP]) {
      const bn = run(article, stack, 'nextjs', { images: 'bunny-images' });
      const cf = run(article, stack, 'nextjs', {
        images: stack === GCP ? 'cf-images' : 'cf-resize',
      });
      expect(bn.won).toBe(20);
      expect(bn.monthly).toBeGreaterThan(cf.monthly);
    }
  });

  it('記事 × VPS: Bunny の前段は転送に課金されるので、Cloudflare の無料の前段より高い', () => {
    const cf = run(article, VPS, 'nextjs', { frontCdn: 'static' });
    const bn = run(article, VPS, 'nextjs', { frontCdn: 'bunny' });
    expect(bn.monthly).toBeGreaterThan(cf.monthly);
  });
});
