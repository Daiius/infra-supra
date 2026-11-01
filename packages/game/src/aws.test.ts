// AWS の構成（prd/11 段 1・D-50）をゲームで選べること。始める画面の部品・維持の手間・何もしない方針の性質。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  goalChecks,
  meetsRequirement,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  stackFlavor,
  STACKS,
  upkeepOf,
  type FrameworkId,
} from './index.ts';
import type { Choices } from 'catalog';

const AWS = STACKS.findIndex((s) => s.id === 'aws-amplify');

function doNothing(
  seed: number,
  framework: FrameworkId,
  components: Choices = {},
) {
  let s = playMonth(
    newGame(
      AWS,
      seed,
      ARTICLE_COMMUNITY,
      DEFAULT_START_DATE,
      framework,
      components,
    ),
  );
  while (s.phase === 'playing') s = playMonth(applyActions(s, []));
  return s;
}

describe('AWS の構成', () => {
  it('既存の構成の後ろに足している（保存と基準プレイの添字を変えない）', () => {
    expect(AWS).toBe(6);
    expect(STACKS[AWS]!.provider).toBe('aws');
    expect(stackFlavor(AWS)).toBeDefined();
  });

  it('始める画面: Next.js は ISR のキャッシュ・画像・DB・前段の CDN を選び、ファイルの置き場（S3）は固定', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, AWS, 'nextjs');
    expect(slots.map((x) => [x.slot, x.fixed])).toEqual([
      ['isrCache', false],
      ['images', false],
      ['db', false],
      ['frontCdn', false],
      ['files', true],
    ]);
    expect(
      slots.find((x) => x.slot === 'images')!.options.map((o) => o.id),
    ).toEqual(['default', 'none', 'resize']);
  });

  it('始める画面: SPA は Amplify の画像の最適化を選べない', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, AWS, 'vite-spa');
    expect(slots.map((x) => x.slot)).not.toContain('isrCache');
    expect(slots.map((x) => x.slot)).not.toContain('frontCdn');
    expect(
      slots.find((x) => x.slot === 'images')!.options.map((o) => o.id),
    ).toEqual(['none', 'resize']);
  });

  it('マネージドなので維持の手間は 0。即時反映は ISR を持つ間は満たせない', () => {
    for (const sc of Object.values(SCENARIOS))
      expect(upkeepOf(sc, AWS)).toBe(0);
    expect(meetsRequirement(AWS, 'on-demand-isr')).toBe(false);
    expect(meetsRequirement(AWS, 'on-demand-isr', { isrCache: 'none' })).toBe(
      true,
    );
    expect(meetsRequirement(AWS, 'uptime-sla')).toBe(false);
    // ISR をキャッシュしなければ、前段の CDN の「HTML も」は即時反映を妨げない（OCL-490F1874）
    expect(
      meetsRequirement(AWS, 'on-demand-isr', {
        isrCache: 'none',
        frontCdn: 'html',
      }),
    ).toBe(true);
    expect(
      meetsRequirement(AWS, 'on-demand-isr', {
        isrCache: 'default',
        frontCdn: 'html',
      }),
    ).toBe(false);
  });

  it('何もしない方針で 12 か月を終える。SPA は Lambda の常時無料のプールに当たる（または近づく）', () => {
    const next = doNothing(1, 'nextjs');
    expect(next.history).toHaveLength(12);
    const spa = doNothing(1, 'vite-spa');
    expect(
      spa.history.some((h) =>
        h.premises.some((p) => p.id === 'pool:aws:lambda:lambda-free-requests'),
      ),
    ).toBe(true);
  });

  it('料金未取得の明細（Amplify の画像の最適化）は件数として月の報告に残る', () => {
    const s = doNothing(1, 'nextjs', { images: 'default' });
    expect(s.history[0]!.unpricedLines).toBeGreaterThan(0);
  });

  it('RDS は時間課金なので、DynamoDB より 12 か月の費用が大きい（記事コミュニティ・シード 1）', () => {
    const cost = (c: Choices) =>
      doNothing(1, 'vite-spa', c).history.reduce((a, h) => a + h.infraCost, 0);
    expect(cost({ db: 'rds' })).toBeGreaterThan(cost({ db: 'dynamodb' }));
  });

  it('記事コミュニティの SPA・既定の部品は、シード 1〜20 の多くで目標に届く（目盛り。目標の値は決め直す・D-50）', () => {
    const passed = Array.from({ length: 20 }, (_, i) =>
      doNothing(i + 1, 'vite-spa'),
    ).filter((s) => goalChecks(s).every((c) => c.ok)).length;
    expect(passed).toBeGreaterThanOrEqual(15);
  });
});
