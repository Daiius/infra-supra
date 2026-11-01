// 見積対象のフレームワーク（prd/06 §2.2・§2.3 の最小の実装。prd/10 F-02）。
// FrameworkProfile は 2 つ（Next.js・Vite の SPA）、DeployTarget は「どのホストにどう載るか」の表だけを持つ。
// BuildOutput は新しい型を作らず、Workload の routes をそのまま使う（フレームワークの違いはテンプレートの書き換えに閉じ込める）。
// 対応の状況は公式の文書を出典にし、取得日を付ける（prd/03 §1 と同じ規律）。
import type { WorkloadInput } from 'estimator';
import type { Platform } from '../stacks/index.ts';

export type FrameworkId = 'nextjs' | 'vite-spa';

type Source = { url: string; retrievedAt: string };
const R = '2026-11-01';
const src = (url: string): Source => ({ url, retrievedAt: R });

export type FrameworkProfile = {
  id: FrameworkId;
  /** 画面の名前。 */
  label: string;
  renderingModes: ('static' | 'ssr' | 'isr' | 'spa')[];
  /** 選ぶ前に出す説明（何が変わるか）。 */
  note: string;
  sources: Source[];
};

export const FRAMEWORKS: Record<FrameworkId, FrameworkProfile> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js（App Router）',
    renderingModes: ['static', 'ssr', 'isr'],
    note: 'ページごとの HTML をサーバーが作る（ISR・SSR）。記事ごとの SNS のカード（OGP）は HTML に入る。API は同じデプロイの中（Route Handler）',
    sources: [
      src('https://nextjs.org/docs/app/guides/single-page-applications'),
    ],
  },
  'vite-spa': {
    id: 'vite-spa',
    label: 'Vite（SPA）+ API',
    renderingModes: ['static', 'spa'],
    note: '1 つの静的なシェル（index.html）とブラウザの JS で描き、中身は API で取る。HTML の生成（ISR・SSR）は無い。API は同じ事業者に同居させる（別の事業者に置く選択は後の段。prd/10 §3.5）',
    sources: [
      src('https://vite.dev/guide/static-deploy'),
      src('https://nextjs.org/docs/app/guides/single-page-applications'),
    ],
  },
};

/** フレームワーク × 事業者の載せ方（prd/06 §2.3 の最小の形。mapping は composeStack が持つ）。 */
export type DeployTarget = {
  framework: FrameworkId;
  platform: Platform;
  /** 使うアダプター・配り方。 */
  adapter: string;
  support: 'native' | 'emulated' | 'unsupported';
  note: string;
  sources: Source[];
};

export const DEPLOY_TARGETS: readonly DeployTarget[] = [
  {
    framework: 'nextjs',
    platform: 'cloudflare',
    adapter: 'vinext',
    support: 'native',
    note: 'Next.js の API を Vite の上で実装し Workers へ載せる（experimental。D-08・prd/06 §5）',
    sources: [
      {
        url: 'https://github.com/cloudflare/vinext',
        retrievedAt: '2026-10-31',
      },
    ],
  },
  {
    framework: 'nextjs',
    platform: 'vercel',
    adapter: 'ネイティブ',
    support: 'native',
    note: 'Vercel がそのまま載せる',
    sources: [src('https://vercel.com/docs/frameworks/full-stack/nextjs')],
  },
  {
    framework: 'nextjs',
    platform: 'sakura',
    adapter: 'next start（Node）',
    support: 'native',
    note: 'nginx の後ろで next start を動かす（自前運用）',
    sources: [src('https://nextjs.org/docs/app/getting-started/deploying')],
  },
  {
    framework: 'vite-spa',
    platform: 'cloudflare',
    adapter: 'Workers の静的アセット + 同じ Worker の API',
    support: 'native',
    note: 'not_found_handling = "single-page-application" でシェルを返す。ページ遷移は Worker を起動しない。API（/api/*）は同じ Worker',
    sources: [
      src(
        'https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/',
      ),
      src(
        'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/',
      ),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'vercel',
    adapter: '静的 + Vercel Functions の API',
    support: 'native',
    note: 'vercel.json の rewrites で /index.html を返す。素の Vite に関数を足す方法は、Vercel の Vite のページでは Nitro などを推奨していて /api の扱いは未確認（prd/10 B-2）',
    sources: [src('https://vercel.com/docs/frameworks/frontend/vite')],
  },
  {
    framework: 'vite-spa',
    platform: 'sakura',
    adapter: 'nginx で静的 + 同じホストの Node の API',
    support: 'native',
    note: 'nginx が dist を配り（try_files でシェルへ）、API は同じ VPS の Node',
    sources: [src('https://vite.dev/guide/static-deploy')],
  },
  // AWS（prd/11 段 1・D-50）
  {
    framework: 'nextjs',
    platform: 'aws',
    adapter: 'Amplify Hosting（SSR の計算）',
    support: 'native',
    note: 'Amplify Hosting が Next.js 12〜15 の SSR・ISR・画像の最適化を扱う。オンデマンド ISR・ストリーミング・Edge のミドルウェアは非対応（16 の機能は使わない前提。prd/11 AX-03）',
    sources: [
      src(
        'https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html',
      ),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'aws',
    adapter: 'S3 + CloudFront + Lambda（API Gateway の HTTP API）',
    support: 'native',
    note: 'シェルと静的なファイルを S3 に置いて CloudFront で配り、API は HTTP API の後ろの Lambda。ディープリンクをシェルへ寄せる設定（CloudFront のエラー応答など）の手順は未確認（prd/11 §1.2）',
    sources: [src('https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/')],
  },
  // AWS の OpenNext（D-63）
  {
    framework: 'nextjs',
    platform: 'aws-opennext',
    adapter: 'OpenNext（Lambda + CloudFront + S3 + DynamoDB + SQS）',
    support: 'emulated',
    note: 'OpenNext がビルド出力を Lambda 向けに直す。ISR は S3 のキャッシュ・DynamoDB のタグ・SQS の再検証で自前に再現する（オンデマンドの再検証に対応）。Next.js 15 が対象。インフラは SST などで自分で組む',
    sources: [
      src('https://opennext.js.org/aws'),
      src('https://opennext.js.org/aws/inner_workings/architecture'),
      src('https://opennext.js.org/aws/inner_workings/components/server/node'),
    ],
  },
  {
    framework: 'vite-spa',
    platform: 'aws-opennext',
    adapter: 'S3 + CloudFront + Lambda（API Gateway の HTTP API）',
    support: 'native',
    note: 'SPA では OpenNext を使わず、AWS の SPA と同じ形になる',
    sources: [src('https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/')],
  },
];

export function deployTarget(
  framework: FrameworkId,
  platform: Platform,
): DeployTarget | undefined {
  return DEPLOY_TARGETS.find(
    (d) => d.framework === framework && d.platform === platform,
  );
}

/**
 * SPA にしたときのアプリの形（テンプレートの既定値。template-default・実測ではない）。
 * dataCpuFactor: HTML の描画が無い分、ページの中身を返す API の CPU を SSR の何倍とみなすか（仮定）。
 * この値で Cloudflare Free の 1 リクエスト CPU 10 ms に当たるかが決まる（prd/10 B-5）。
 */
export type SpaShape = {
  shellKB: number;
  dataCpuFactor: number;
  dataResponseKB: number;
};

/**
 * テンプレートの Workload を SPA の形に書き換える（ISR・SSR のルートを spa に。静的なルートはそのまま）。
 * ページの中身はデータの API で取り、処理は SSR の値から作る（CPU は dataCpuFactor 倍・DB の往復は同じ）。
 * cacheContent: 記事（ISR だったルート＝全員に同じ中身）の API の応答をキャッシュする。期間は ISR の間隔
 * （revalidateSeconds）をそのまま使う。SSR だったルートは個人化された中身なのでキャッシュしない（D-37）。
 */
export function toSpa(
  w: WorkloadInput,
  shape: SpaShape,
  options: { cacheContent?: boolean } = {},
): WorkloadInput {
  return {
    ...w,
    routes: w.routes.map((r) => {
      if (r.rendering === 'static' || r.rendering === 'spa') return r;
      return {
        id: r.id,
        rendering: 'spa' as const,
        share: r.share,
        pages: r.pages,
        shellKB: shape.shellKB,
        ...(options.cacheContent &&
        r.rendering === 'isr' &&
        r.revalidateSeconds !== undefined
          ? { cacheSeconds: r.revalidateSeconds }
          : {}),
        processing: {
          ...r.processing,
          cpuMs: r.processing.cpuMs * shape.dataCpuFactor,
          responseKB: shape.dataResponseKB,
        },
      };
    }),
  };
}
