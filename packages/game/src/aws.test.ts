// AWS の構成（prd/11 段 1・D-50）をゲームで選べること。始める画面の部品・維持の手間・何もしない方針の性質。
import { describe, expect, it } from 'vitest';
import {
  applyActions,
  ARTICLE_COMMUNITY,
  DEFAULT_START_DATE,
  goalChecks,
  autoImageFormat,
  componentConflict,
  componentSlots,
  isPlanChange,
  meetsRequirement,
  newGame,
  playMonth,
  SCENARIOS,
  setupSlots,
  stackFlavor,
  STACKS,
  upkeepOf,
  invalidationNote,
  onDemandInvalidationEstimate,
  retryHintsOf,
  setupInvalidationEstimate,
  type FrameworkId,
} from './index.ts';
import { EFFORT } from './rules.ts';
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

  it('始める画面: Next.js は ISR のキャッシュ・画像・API の置き場（D-67）・DB・前段の CDN を選び、ファイルの置き場（S3）は固定', () => {
    const slots = setupSlots(ARTICLE_COMMUNITY, AWS, 'nextjs');
    expect(slots.map((x) => [x.slot, x.fixed])).toEqual([
      ['isrCache', false],
      ['images', false],
      ['api', false],
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
      free.history[0]!.lines.some(
        (l) => l.meterId === 'cloudfront-transfer-out',
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
    expect(slots).toEqual([
      'isrCache',
      'images',
      'api',
      'db',
      'cdnPlan',
      'cdnInvalidation',
      'files',
    ]);
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
      h.lines.find((l) => l.meterId === 'invalidation-paths');
    // 1 か月目: PV 30 万 × 書き込み 0.1 × 記事の投稿・編集 0.01 = 更新 300 × 2 ページ × 2 パス = 1,200 パス（D-70）
    const payg = first('payg', 0);
    expect(line(payg)!.amount).toBeCloseTo((1_200 - 1_000) * 0.005, 6);
    // 定額 Pro は込み・時間の再検証は無効化しない
    expect(line(first('flat-pro', 0))?.amount ?? 0).toBe(0);
    expect(line(first('payg', 300))?.amount ?? 0).toBe(0);
  });

  it('オンデマンドを選ぶ前に無効化の見込みが分かる: 従量はパスと金額、定額は込み、無効化しない構成は出さない（D-66）', () => {
    const ON = STACKS.findIndex((x) => x.id === 'aws-opennext');
    const payg = setupInvalidationEstimate(ARTICLE_COMMUNITY, ON, 'nextjs', {
      cdnPlan: 'payg',
    })!;
    // 1 か月目（30 万 PV）: 更新 300 × 2 ページ × 2 パス（D-70）
    expect(payg.paths).toBeCloseTo(1_200, 6);
    expect(payg.usd).toBeCloseTo(200 * 0.005, 6);
    expect(payg.included).toBe(false);
    // ワイルドカードでまとめたときの見込みも添える（D-79）: 更新 300 × 1 パス
    expect(payg.ifWildcard!.paths).toBeCloseTo(300, 6);
    expect(payg.ifWildcard!.usd).toBe(0);
    expect(invalidationNote(payg)).toBe(
      '無効化 月約 1,200 パス・約 $1（月 1,000 パスまで無料、以降 1 パス $0.005）。ワイルドカードでまとめると 約 300 パス・約 $0（代わりに更新していないページの CDN のキャッシュも消える）',
    );
    const flat = setupInvalidationEstimate(ARTICLE_COMMUNITY, ON, 'nextjs', {
      cdnPlan: 'flat-pro',
    })!;
    expect(flat.included).toBe(true);
    expect(invalidationNote(flat)).toBe(
      '無効化 月約 1,200 パス（定額のプランでは込み。解釈）',
    );
    // ISR をキャッシュしない部品・Amplify は無効化しない
    expect(
      setupInvalidationEstimate(ARTICLE_COMMUNITY, ON, 'nextjs', {
        isrCache: 'none',
      }),
    ).toBeUndefined();
    expect(
      setupInvalidationEstimate(ARTICLE_COMMUNITY, AWS, 'nextjs', {}),
    ).toBeUndefined();
    // ゲーム中は今月の規模で引く（今の設定が時間の再検証でも、オンデマンドにしたときの見込み）
    const st = newGame(ON, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE, 'nextjs', {
      cdnPlan: 'payg',
    });
    expect(st.settings.revalidateSec).toBe(300);
    expect(onDemandInvalidationEstimate(st)!.paths).toBeCloseTo(1_200, 6);
    // 同じ月に選んだ部品の変更（行動を当てた draft）にも合わせる（OCL-7EDA42D6）
    const flatSt = playMonth(
      newGame(ON, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE, 'nextjs', {
        cdnPlan: 'flat-pro',
      }),
    );
    expect(onDemandInvalidationEstimate(flatSt)!.included).toBe(true);
    const draft = applyActions(flatSt, [
      { type: 'component', slot: 'cdnPlan', option: 'payg' },
    ]);
    expect(onDemandInvalidationEstimate(draft)!.included).toBe(false);
    // 提案への返事で変わる書き込み量（mods）も読む（OCL-8B602E76）: 書き込み 0.1 → 0.2 で更新もパスも倍
    expect(
      onDemandInvalidationEstimate({
        ...draft,
        mods: { ...draft.mods, writesPerCall: 0.2 },
      })!.paths,
    ).toBeCloseTo(2 * onDemandInvalidationEstimate(draft)!.paths, 6);
    expect(
      onDemandInvalidationEstimate(
        applyActions(flatSt, [
          { type: 'component', slot: 'isrCache', option: 'none' },
        ]),
      ),
    ).toBeUndefined();
  });

  it('無効化の費用が主因で負けたら、次のプレイへのヒントが定額・時間の再検証・まとめる方向を出す（D-66）', () => {
    const ON = STACKS.findIndex((x) => x.id === 'aws-opennext');
    // コメントでも記事のページを作り直す作り方（書き込みの半分。D-70 より前の仮定）なら、1 か月目の無効化 6 万パスで負ける
    const commentsRegenerate = { ...ARTICLE_COMMUNITY, pageUpdateShare: 0.5 };
    let s = playMonth(
      newGame(
        ON,
        1,
        commentsRegenerate,
        DEFAULT_START_DATE,
        'nextjs',
        { cdnPlan: 'payg', images: 'default' },
        0,
      ),
    );
    while (s.phase === 'playing') s = playMonth(applyActions(s, []));
    expect(s.end?.reason).toBe('cash');
    const cost = retryHintsOf(s).find((x) => x.kind === 'cost')!;
    expect(cost.what).toContain(
      'キャッシュの無効化（CloudFront: invalidation paths）',
    );
    expect(cost.next).toContain('60,000 パス・$295');
    expect(cost.next).toContain('定額のプラン');
    expect(cost.next).toContain('時間の再検証');
    expect(cost.next).toContain('ワイルドカードにまとめる');
  });

  it('無効化をワイルドカードでまとめる（D-79）: パスは更新ごとに 1、CDN の外れと関数の呼び出しが増え、再生成は変わらない', () => {
    const ON = STACKS.findIndex((x) => x.id === 'aws-opennext');
    const commentsRegenerate = { ...ARTICLE_COMMUNITY, pageUpdateShare: 0.5 };
    const est = (sc: typeof ARTICLE_COMMUNITY, c: Choices) =>
      setupInvalidationEstimate(sc, ON, 'nextjs', { cdnPlan: 'payg', ...c })!;
    const wild = est(ARTICLE_COMMUNITY, { cdnInvalidation: 'wildcard' });
    expect(wild.wildcard).toBe(true);
    expect(wild.paths).toBeCloseTo(300, 6);
    expect(wild.ifWildcard).toBeUndefined();
    expect(invalidationNote(wild)).toContain('ワイルドカードでまとめた分');
    // コメントも作り直す作り（更新 1.5 万回）: ページごと 6 万パス・$295 → 1.5 万パス・$70
    const perPage = est(commentsRegenerate, {});
    expect(perPage.paths).toBeCloseTo(60_000, 6);
    expect(perPage.ifWildcard!.paths).toBeCloseTo(15_000, 6);
    expect(perPage.ifWildcard!.usd).toBeCloseTo(14_000 * 0.005, 6);
    // 定額のプランは込みなので、まとめたときの見込みは出さない
    expect(est(ARTICLE_COMMUNITY, { cdnPlan: 'flat-pro' }).ifWildcard).toBe(
      undefined,
    );
    // 部品の欄に出る（ISR をキャッシュしない部品では効かないので出さない）・差し替えは手間 1
    const st = newGame(ON, 1, ARTICLE_COMMUNITY, DEFAULT_START_DATE, 'nextjs');
    expect(componentSlots(st).map((x) => x.slot)).toContain('cdnInvalidation');
    expect(
      componentSlots({
        ...st,
        components: { ...st.components, isrCache: 'none' },
      }).map((x) => x.slot),
    ).not.toContain('cdnInvalidation');
    expect(EFFORT.component.cdnInvalidation).toBe(1);
  });
});
