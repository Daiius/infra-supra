// AWS の構成（prd/11 段 1・D-50）。構成の形・経路と、常時無料のプール・料金未取得の明細の出方を確かめる。
import { describe, expect, it } from 'vitest';
import { estimate } from 'estimator';
import { loadPriceBooks } from '../index.ts';
import { articleCommunity } from '../templates/index.ts';
import { deployTarget, toSpa } from '../frameworks/index.ts';
import { fileStorageOf } from './files.ts';
import {
  applyComponentsToWorkload,
  componentsOf,
  composeStack,
  type Choices,
} from './index.ts';

const books = loadPriceBooks();

/** SPA の形（テンプレートの既定値の例。値は仮定）。 */
const SHAPE = { shellKB: 2, dataCpuFactor: 0.5, dataResponseKB: 20 };

const run = (
  pv: number,
  choices: Choices = {},
  framework: 'nextjs' | 'vite-spa' = 'nextjs',
) =>
  estimate({
    workload: applyComponentsToWorkload(
      framework === 'vite-spa'
        ? toSpa(articleCommunity(pv), SHAPE, {
            cacheContent: choices.apiCache === 'cdn',
          })
        : articleCommunity(pv),
      'aws',
      choices,
      {
        originalImageKB: 4000,
        resizedImageKB: 400,
      },
    ),
    architecture: composeStack('aws-amplify', choices, { framework }),
    books,
  });

const lines = (r: ReturnType<typeof run>, planId: string, meterId: string) =>
  r.bill.lines.filter(
    (l) =>
      l.priceRef.provider === 'aws' &&
      l.priceRef.planId === planId &&
      'meterId' in l.priceRef &&
      l.priceRef.meterId === meterId,
  );

describe('AWS の構成（Next.js・Amplify Hosting）', () => {
  it('既定は Amplify の CDN と SSR・CloudFront + S3 の画像・DynamoDB', () => {
    const a = composeStack('aws-amplify');
    expect(a.nodes.map((n) => n.id)).toEqual([
      'cdn',
      'ssr',
      'cf',
      's3',
      'dynamodb',
    ]);
    expect(a.routes['image-read']).toEqual(['cf', 's3']);
    expect(a.routes['document-isr']).toEqual(['cdn', 'ssr']);
    expect(a.nodes.every((n) => n.billing?.accountId === 'aws')).toBe(true);
  });

  it('Amplify の画像の最適化は料金未取得の明細になり、合計に入らない', () => {
    const r = run(1_000_000, { images: 'default' });
    const opt = lines(r, 'amplify-hosting', 'image-optimization');
    expect(opt.length).toBeGreaterThan(0);
    expect(opt.every((l) => l.status === 'unpriced')).toBe(true);
    expect(r.bill.unpricedLines).toBeGreaterThan(0);
  });

  it('ISR はオンデマンドの再検証に対応しない（部品の事実）。キャッシュしないなら対応する', () => {
    const [isr, none] = ['default', 'none'].map((id) =>
      componentsOf('aws', 'isrCache').find((c) => c.id === id)!,
    );
    expect(isr!.onDemandIsr?.ok).toBe(false);
    expect(none!.onDemandIsr?.ok).toBe(true);
  });

  it('RDS は時間課金（730 時間 × $0.025）。DynamoDB は時間課金が無い', () => {
    const rds = run(300_000, { db: 'rds' });
    const inst = lines(rds, 'rds-postgres-t4g-micro', 'instance');
    expect(inst[0]!.amount).toBeCloseTo(730 * 0.025, 6);
    const ddb = run(300_000);
    expect(ddb.simulation.nodes.dynamodb!.resources['instance-hours']).toBe(
      undefined,
    );
  });

  it('Aurora Serverless v2: 最小 0.5 ACU は 730 時間 × 0.5 × $0.20。0 ACU まで縮めても記事コミュニティではほぼ止まらない', () => {
    const a = run(300_000, { db: 'aurora' });
    expect(lines(a, 'aurora-serverless-v2-io', 'acu')[0]!.amount).toBeCloseTo(
      730 * 0.5 * 0.2,
      6,
    );
    const p = run(300_000, { db: 'aurora-pause' });
    const awake = p.simulation.nodes['aurora-pause']!.awakeShare!;
    expect(awake).toBeGreaterThan(0.9);
    expect(awake).toBeLessThan(1);
  });

  it('Aurora DSQL: DB に届く件数 × 0.14 DPU（仮定）で、月 10 万 DPU までは無料', () => {
    const small = run(30_000, { db: 'dsql' });
    const dpu = lines(small, 'aurora-dsql', 'dpu');
    expect(dpu.length).toBeGreaterThan(0);
    expect(
      small.simulation.nodes.dsql!.resources['processing-units'],
    ).toBeGreaterThan(0);
  });

  it('DB の差し替えの途中は新旧の両方の DB が載り、経路は今の DB だけ', () => {
    const a = composeStack(
      'aws-amplify',
      { db: 'dynamodb' },
      {
        standby: { db: 'rds' },
      },
    );
    expect(a.nodes.some((n) => n.id === 'rds')).toBe(true);
    expect(a.routes.api).toEqual(['cdn', 'ssr', 'dynamodb']);
  });

  it('CloudFront は常時無料（1 TB・1,000 万リクエスト）の内なら 0 円', () => {
    const r = run(300_000);
    const cf = r.bill.lines.filter(
      (l) =>
        l.priceRef.provider === 'aws' && l.priceRef.planId === 'cloudfront',
    );
    expect(cf.length).toBeGreaterThan(0);
    expect(cf.reduce((a, l) => a + (l.amount ?? 0), 0)).toBe(0);
  });

  it('自前の CloudFront を前に置くと、静的なファイルは Amplify から配らず、HTML と API は両方で数える', () => {
    const base = run(1_000_000);
    const st = run(1_000_000, { frontCdn: 'static' });
    const html = run(1_000_000, { frontCdn: 'html' });
    const amplifyGB = (r: typeof base) =>
      r.simulation.nodes.cdn!.resources['egress-gb'] ?? 0;
    expect(amplifyGB(st)).toBeLessThan(amplifyGB(base));
    expect(amplifyGB(html)).toBeLessThan(amplifyGB(st));
    // API は前段でキャッシュしないので、前段と Amplify の両方の転送に乗る
    expect(st.simulation.nodes.front!.resources['egress-gb']).toBeGreaterThan(
      0,
    );
    const a = composeStack('aws-amplify', { frontCdn: 'html' });
    expect(a.routes.api).toEqual(['front', 'cdn', 'ssr', 'dynamodb']);
    const cdn = a.nodes.find((n) => n.id === 'cdn')!.config;
    expect(cdn.kind === 'cdn' && cdn.ttlClasses).toBeFalsy();
    const opt = componentsOf('aws', 'frontCdn').find((c) => c.id === 'html')!;
    expect(opt.onDemandIsr?.ok).toBe(false);
  });

  it('ファイルの置き場は S3、載せ方の表に Next.js と SPA の両方がある', () => {
    expect(fileStorageOf('aws-amplify')?.id).toBe('s3');
    expect(deployTarget('nextjs', 'aws')?.adapter).toContain('Amplify');
    expect(deployTarget('vite-spa', 'aws')?.adapter).toContain('CloudFront');
  });
});

describe('CloudFront の料金のプラン（D-61）', () => {
  it('定額 Pro は月 $15 だけで、転送とリクエストは込み（超えても請求は増えず、前提は adjust）', () => {
    const r = run(3_000_000, { cdnPlan: 'flat-pro' }, 'vite-spa');
    const pro = r.bill.lines.filter(
      (l) =>
        l.priceRef.provider === 'aws' &&
        l.priceRef.planId === 'cloudfront-flat-pro',
    );
    expect(pro.reduce((a, l) => a + (l.amount ?? 0), 0)).toBeCloseTo(15, 6);
    const free = run(3_000_000, { cdnPlan: 'flat-free' }, 'vite-spa');
    const over = free.premises.filter(
      (p) => p.hit && p.id.startsWith('pool:aws:cloudfront-flat-free:'),
    );
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((p) => p.effect === 'adjust')).toBe(true);
    expect(
      free.bill.lines
        .filter((l) => l.priceRef.planId === 'cloudfront-flat-free')
        .reduce((a, l) => a + (l.amount ?? 0), 0),
    ).toBe(0);
  });

  it('Amplify の前段に定額を使うと、Amplify をオリジンにする構成が未確認という事実を出す', () => {
    const a = composeStack('aws-amplify', {
      frontCdn: 'static',
      cdnPlan: 'flat-pro',
    });
    expect(a.nodes.find((n) => n.id === 'front')!.facts).toContain(
      'flat-amplify-origin',
    );
    expect(a.nodes.find((n) => n.id === 'cf')!.facts).not.toContain(
      'flat-amplify-origin',
    );
  });
});

describe('AWS の構成（Vite の SPA・S3 + CloudFront + Lambda）', () => {
  it('HTML の生成が無く、API は CloudFront → API Gateway → Lambda → DB', () => {
    const a = composeStack('aws-amplify', {}, { framework: 'vite-spa' });
    expect(a.routes['document-ssr']).toBeUndefined();
    expect(a.routes['document-isr']).toBeUndefined();
    expect(a.routes.api).toEqual(['cf', 'apigw', 'lambda', 'dynamodb']);
    expect(a.nodes.some((n) => n.id === 'ssr')).toBe(false);
    const r = run(1_000_000, {}, 'vite-spa');
    expect(r.simulation.unroutedClasses).toEqual([]);
  });

  it('HTTP API は 512 KB ごとに 1 リクエスト: 原本（4 MB）のアップロードは 1 件 8 リクエスト、Lambda の起動は 1 回', () => {
    const r = run(1_000_000, { images: 'none' }, 'vite-spa');
    const writes = r.simulation.workload.classes['image-write'];
    const api = r.simulation.workload.classes.api;
    const apiContent = r.simulation.workload.classes['api-content'];
    const perApi = (kb: number) => Math.max(1, Math.ceil(kb / 512));
    expect(r.simulation.nodes.apigw!.resources.requests).toBeCloseTo(
      writes.count * 8 +
        api.count * perApi(api.perRequest.kb) +
        apiContent.count * perApi(apiContent.perRequest.kb),
      3,
    );
    expect(r.simulation.nodes.lambda!.resources.invocations).toBeCloseTo(
      writes.count + api.count + apiContent.count,
      3,
    );
  });

  it('API の応答を CloudFront でキャッシュすると、Lambda に届く件数が減る', () => {
    const at = (apiCache: string) =>
      run(1_000_000, { apiCache }, 'vite-spa').simulation.nodes.lambda!
        .resources.invocations!;
    expect(at('cdn')).toBeLessThan(at('none'));
  });
});

describe('AWS の OpenNext の構成（D-63）', () => {
  const runOn = (pv: number, choices: Choices = {}) =>
    estimate({
      workload: applyComponentsToWorkload(
        articleCommunity(pv),
        'aws-opennext',
        choices,
        { originalImageKB: 4000, resizedImageKB: 400 },
      ),
      architecture: composeStack('aws-opennext', choices),
      books,
    });

  it('1 つの CloudFront → サーバーの Lambda。ISR は S3 のキャッシュ・DynamoDB のタグ・SQS の再検証（1 件 3 リクエスト）', () => {
    const a = composeStack('aws-opennext');
    expect(a.routes['document-isr']).toEqual([
      'cf',
      'server',
      's3-cache',
      'tags',
    ]);
    expect(a.routes['isr-revalidate']![0]).toBe('queue');
    const r = runOn(1_000_000);
    expect(r.simulation.unroutedClasses).toEqual([]);
    const regen = r.simulation.workload.classes['isr-revalidate'].count;
    expect(r.simulation.nodes.queue!.resources.requests).toBeCloseTo(
      regen * 3,
      3,
    );
    const isr = componentsOf('aws-opennext', 'isrCache').find(
      (c) => c.id === 'default',
    )!;
    expect(isr.onDemandIsr?.ok).toBe(true);
  });

  it('OpenNext の画像の最適化は Lambda で課金される（料金未取得にならない）', () => {
    const r = runOn(1_000_000, { images: 'default' });
    expect(r.bill.unpricedLines).toBe(0);
    expect(
      r.simulation.nodes['image-fn']!.resources['memory-gb-hours'],
    ).toBeGreaterThan(0);
  });
});
