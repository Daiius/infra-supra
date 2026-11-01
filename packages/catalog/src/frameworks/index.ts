// 見積対象のフレームワーク（prd/06 §2.2・§2.3 の最小の実装。prd/10 F-02）。
// FrameworkProfile は 2 つ（Next.js・Vite の SPA）、DeployTarget は「どのホストにどう載るか」の表だけを持つ。
// BuildOutput は新しい型を作らず、Workload の routes をそのまま使う（フレームワークの違いはテンプレートの書き換えに閉じ込める）。
// 対応の状況は公式の文書を出典にし、取得日を付ける（prd/03 §1 と同じ規律）。
import type { WorkloadInput } from 'estimator';
import type { Platform } from '../stacks/index.ts';

export type FrameworkId = 'nextjs' | 'vite-spa' | 'astro';

type Source = { url: string; retrievedAt: string };
const R = '2026-11-01';
const src = (url: string): Source => ({ url, retrievedAt: R });
/** Astro の調査の取得日（D-68）。 */
const src2 = (url: string): Source => ({ url, retrievedAt: '2026-11-02' });

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
  astro: {
    id: 'astro',
    label: 'Astro',
    renderingModes: ['static', 'ssr'],
    note: '既定ではページをビルドのときに HTML にしておき（静的）、ログインの要るページだけをアダプターでリクエストのたびに描く。ブラウザの JS は動きのある部品（アイランド）の分だけ。記事ごとの SNS のカード（OGP）は HTML に入る。静的なページの更新はビルドし直しで反映する（ISR は使わない）',
    sources: [
      src2('https://docs.astro.build/en/guides/on-demand-rendering/'),
      src2('https://docs.astro.build/en/concepts/islands/'),
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
  // Astro（D-68・prd/06 §6）。静的なページは事業者の静的な配信、ログインの要るページはアダプター
  {
    framework: 'astro',
    platform: 'cloudflare',
    adapter: '@astrojs/cloudflare（Workers）',
    support: 'native',
    note: '静的なページ・JS・CSS は Workers の静的アセット（Worker を起動しない）、それ以外は Worker が描く。Pages はアダプターの対象外になった。ISR に当たる機能は無い。画像は Images の binding（imageService: cloudflare-binding）。ビルドは Workers Builds',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/cloudflare/'),
      src2(
        'https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/',
      ),
    ],
  },
  {
    framework: 'astro',
    platform: 'vercel',
    adapter: '@astrojs/vercel',
    support: 'native',
    note: '静的なページは CDN、それ以外は Vercel Functions。アダプターの isr を有効にすると、リクエストのたびに描くページを最初の閲覧の後にキャッシュする（期限・bypassToken での無効化。このモデルでは使わず、記事は静的にビルドする）。画像は imageService で Vercel の画像の最適化',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/vercel/'),
      src2('https://vercel.com/docs/pricing'),
    ],
  },
  {
    framework: 'astro',
    platform: 'sakura',
    adapter: '@astrojs/node（standalone）',
    support: 'native',
    note: 'nginx が静的なページを配り、それ以外は同じ VPS の Node（standalone は静的なファイルも配れる）。ビルドも VPS の上（ビルドの CPU は数えていない・仮定）',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/node/'),
    ],
  },
  {
    framework: 'astro',
    platform: 'aws',
    adapter: 'なし（公式のアダプターが無い）',
    support: 'unsupported',
    note: 'Astro の AWS の手順は、静的なら Amplify・S3 + CloudFront、リクエストのたびに描くページは Amplify のコミュニティのアダプター（astro-aws-amplify）か SST。公式のアダプターが無いので、このモデルでは扱わない',
    sources: [src2('https://docs.astro.build/en/guides/deploy/aws/')],
  },
  {
    framework: 'astro',
    platform: 'aws-opennext',
    adapter: 'なし（OpenNext は Next.js 用）',
    support: 'unsupported',
    note: 'OpenNext は Next.js のビルド出力を直す道具で、Astro には使えない',
    sources: [src2('https://docs.astro.build/en/guides/deploy/aws/')],
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
  // Netlify（D-71・prd/11 §14）
  {
    framework: 'nextjs',
    platform: 'netlify',
    adapter: 'OpenNext のアダプター（設定なし）',
    support: 'native',
    note: 'Next.js 13.5 以降を設定なしで載せる。SSR・ISR・Route Handler・Server Actions は Netlify Functions、ミドルウェアは Edge Functions。ISR は時間・オンデマンド（パス・タグ）の再検証とも完全に対応。next/image は Netlify Image CDN',
    sources: [src2('https://docs.netlify.com/frameworks/next-js/overview/')],
  },
  {
    framework: 'vite-spa',
    platform: 'netlify',
    adapter: '静的 + Netlify Functions の API',
    support: 'native',
    note: 'dist を配り、SPA は書き換えの規則で index.html を返す。API は同じサイトの Netlify Functions',
    sources: [
      src2(
        'https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/',
      ),
    ],
  },
  {
    framework: 'astro',
    platform: 'netlify',
    adapter: '@astrojs/netlify',
    support: 'native',
    note: '静的なページは CDN、リクエストのたびに描くページは Netlify Functions。画像は既定で Netlify Image CDN。cacheOnDemandPages で描いたページを CDN にキャッシュできる（このモデルでは使わず、記事は静的にビルドする）。ビルドし直しは本番のデプロイ 1 回ごとにクレジットを使う',
    sources: [
      src2('https://docs.astro.build/en/guides/integrations-guide/netlify/'),
      src2(
        'https://docs.netlify.com/build/frameworks/framework-setup-guides/astro/',
      ),
    ],
  },
];

/** フレームワークをその事業者に載せられるか（DeployTarget が unsupported・無いなら載せられない。D-68）。 */
export function frameworkSupported(
  framework: FrameworkId,
  platform: Platform,
): boolean {
  const d = deployTarget(framework, platform);
  return d !== undefined && d.support !== 'unsupported';
}

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

/**
 * Astro にしたときのアプリの形（テンプレートの既定値。template-default・実測ではない。D-68）。
 * assetsFactor: ページあたりの JS・CSS のファイル数を Next.js の何倍とみなすか（アイランドの分だけ）。
 * minutesPerBuild: 1 回のビルドの時間（分）= base + 静的なページ 1,000 あたり perThousandPages。
 */
export type AstroShape = {
  assetsFactor: number;
  minutesPerBuild: { base: number; perThousandPages: number };
};

/**
 * テンプレートの Workload を Astro の形に書き換える（D-68）。ISR だったルート（全員に同じ中身の記事）は静的にビルドし、
 * SSR のルート（個人化）はアダプターでリクエストのたびに描く。JS・CSS はアイランドの分だけ（assetsFactor）。
 * 静的なページの更新はビルドし直し: 内容の更新（updatesPerMonth。記事のページを作り直す更新 = 記事の投稿・編集。
 * コメントはアイランドが API で読むのでビルドしない。D-70）を、間隔（省略は更新のたび）でまとめてビルドする。
 */
export function toAstro(
  w: WorkloadInput,
  shape: AstroShape,
  build: { updatesPerMonth: number; intervalSeconds?: number },
): WorkloadInput {
  let staticPages = 0;
  const routes = w.routes.map((r) => {
    if (r.rendering !== 'isr') return r;
    staticPages += r.pages;
    return {
      id: r.id,
      rendering: 'static' as const,
      share: r.share,
      pages: r.pages,
      processing: r.processing,
    };
  });
  return {
    ...w,
    routes,
    perPage: { ...w.perPage, assets: w.perPage.assets * shape.assetsFactor },
    ...(staticPages > 0
      ? {
          build: {
            updatesPerMonth: build.updatesPerMonth,
            ...(build.intervalSeconds !== undefined
              ? { intervalSeconds: build.intervalSeconds }
              : {}),
            minutesPerBuild:
              shape.minutesPerBuild.base +
              (staticPages / 1000) * shape.minutesPerBuild.perThousandPages,
          },
        }
      : {}),
  };
}
