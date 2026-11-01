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

  it('ファイルの置き場は S3、載せ方の表に Next.js と SPA の両方がある', () => {
    expect(fileStorageOf('aws-amplify')?.id).toBe('s3');
    expect(deployTarget('nextjs', 'aws')?.adapter).toContain('Amplify');
    expect(deployTarget('vite-spa', 'aws')?.adapter).toContain('CloudFront');
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

  it('API の応答を CloudFront でキャッシュすると、Lambda に届く件数が減る', () => {
    const at = (apiCache: string) =>
      run(1_000_000, { apiCache }, 'vite-spa').simulation.nodes.lambda!
        .resources.invocations!;
    expect(at('cdn')).toBeLessThan(at('none'));
  });
});
