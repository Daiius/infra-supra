// AWS の構成（prd/11 段 1・D-50）をゲームで選べること。始める画面の部品・維持の手間・何もしない方針の性質。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  goalChecks,
  autoImageFormat,
  componentConflict,
  isPlanChange,
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
      ['cdnPlan', false],
      ['files', true],
    ]);
    expect(
      slots.find((x) => x.slot === 'images')!.options.map((o) => o.id),
    ).toEqual(['default', 'none', 'resize', 'cf-images', 'cf-resize']);
  });

  it('始める画面: SPA は Amplify の画像の最適化を選べない', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, AWS, 'vite-spa');
    expect(slots.map((x) => x.slot)).not.toContain('isrCache');
    expect(slots.map((x) => x.slot)).not.toContain('frontCdn');
    expect(
      slots.find((x) => x.slot === 'images')!.options.map((o) => o.id),
    ).toEqual(['none', 'resize', 'cf-images', 'cf-resize']);
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

  it('CDN の定額のプラン: 込みを超えても請求は増えず、続けて超えると速さが 1 段下がる（D-61）', () => {
    const free = doNothing(1, 'vite-spa', { cdnPlan: 'flat-free' });
    const over = free.history.map((h) =>
      h.premises.some(
        (p) =>
          p.hit &&
          p.effect === 'adjust' &&
          p.id.startsWith('pool:aws:cloudfront-flat-free:'),
      ),
    );
    // 記事コミュニティは最初から込み（100 GB）を超える
    expect(over[0]).toBe(true);
    // 1 か月目は 3 倍までなら調整されない・2 か月目は続けて超えたので調整される
    const notes = (i: number) => free.history[i]!.notes.join('・');
    expect(notes(1)).toContain('配信の性能が調整された');
    expect(free.history[1]!.satisfaction.reasons.speed).toContain(
      '配信の性能が調整された',
    );
    // CloudFront の料金は定額（Free は 0 円）で、従量の転送の明細が無い
    expect(
      free.history[0]!.lines.some((l) =>
        l.label.includes('cloudfront-transfer-out'),
      ),
    ).toBe(false);
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

  it('OpenNext（D-63）: 別の事業者として足し、維持の手間 1・オンデマンドの即時反映を満たす・Amplify との行き来は乗り換え', () => {
    const ON = STACKS.findIndex((x) => x.id === 'aws-opennext');
    expect(ON).toBe(7);
    expect(STACKS[ON]!.provider).toBe('aws-opennext');
    for (const sc of Object.values(SCENARIOS)) expect(upkeepOf(sc, ON)).toBe(1);
    expect(meetsRequirement(ON, 'on-demand-isr')).toBe(true);
    expect(meetsRequirement(AWS, 'on-demand-isr')).toBe(false);
    expect(isPlanChange(AWS, ON)).toBe(false);
    const slots = setupSlots(ARTICLE_COMMUNITY, ON, 'nextjs').map(
      (x) => x.slot,
    );
    expect(slots).toEqual(['isrCache', 'images', 'db', 'cdnPlan', 'files']);
  });

  it('OpenNext の画像の最適化は next/image（Lambda）なのでブラウザに合わせた形式の対象。画像を R2 に出しても CloudFront が残り、定額のプランを選べる（D-62・D-63）', () => {
    expect(autoImageFormat('aws-opennext', 'nextjs', 'default')).toBe(true);
    expect(
      componentConflict('aws-opennext', 'cdnPlan', 'flat-pro', {
        images: 'cf-images',
      }),
    ).toBeNull();
    expect(
      componentConflict('aws-opennext', 'images', 'cf-images', {
        cdnPlan: 'flat-pro',
      }),
    ).toBeNull();
    // Amplify（前段なし）は CloudFront が無くなるので選べない
    expect(
      componentConflict('aws', 'cdnPlan', 'flat-pro', { images: 'cf-images' }),
    ).not.toBeNull();
  });

  it('OpenNext のオンデマンドの再検証は CloudFront を無効化する: 従量は月 1,000 パスを超えると 1 パス $0.005、定額は込み（D-66）', () => {
    const ON = STACKS.findIndex((x) => x.id === 'aws-opennext');
    const first = (cdnPlan: string, revalidateSec: number) =>
      playMonth(
        newGame(
          ON,
          1,
          ARTICLE_COMMUNITY,
          DEFAULT_START_DATE,
          'nextjs',
          { cdnPlan, images: 'default' },
          revalidateSec,
        ),
      ).history[0]!;
    const line = (h: ReturnType<typeof first>) =>
      h.lines.find((l) => l.label.includes('invalidation-paths'));
    // 1 か月目: PV 30 万 × 書き込み 0.1 × ページを変える 0.5 = 更新 1.5 万 × 2 ページ × 2 パス = 6 万パス
    const payg = first('payg', 0);
    expect(line(payg)!.amount).toBeCloseTo((60_000 - 1_000) * 0.005, 6);
    // 定額 Pro は込み・時間の再検証は無効化しない
    expect(line(first('flat-pro', 0))?.amount ?? 0).toBe(0);
    expect(line(first('payg', 300))?.amount ?? 0).toBe(0);
  });
});
