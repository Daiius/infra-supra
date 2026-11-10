// Vercel のプロジェクトの設定（D-139・D-150・prd/15 §5.3）。画面と同じオリジンの /api/* を、集計のサーバー（VPS の packages/stats）へ中継する。
// 🔒 宛先（VPS のオリジン）はリポジトリに書かない。Vercel のダッシュボードの環境変数 API_ORIGIN（例の形: https://<ホスト名>）から読む。
//
// - vercel.ts はビルドのときに評価され、vercel.json に写される（https://vercel.com/docs/project-configuration/vercel-ts 。
//   「environment variables to conditionally set routes」とあるので process.env を読む。2026-11-09 に確かめた範囲）。
// - API_ORIGIN が無いときは中継を作らない（rewrites を足さない。安全のヘッダーは付ける）。値が https のオリジンでなければビルドを止める
//   （壊れた宛先で中継しない）。
// - vercel.json と同時には置けない（同じ文書）。このプロジェクトに vercel.json は無い。
// - 実行のときに読む依存を持たないよう、@vercel/config は型だけを読み、rewrites は vercel.json と同じ形の値で書く。
// Vercel のプロジェクト infra-supra（チーム faveo-systema）の Root Directory は packages/web（2026-11-09 に CLI で読み取って確認済み。Framework Preset は Vite・Node は 26.x）なので、ここに置く（prd/15 §7.1）。
// - 安全のヘッダー（D-194）は API_ORIGIN の有無と無関係に、全部のパス（/api/* の中継の応答・404 も含む）に常に付ける。
//   CSP は埋め込みを断る frame-ancestors の 1 指令だけ（本格的な CSP は入れていない。D-194）。
import type { VercelConfig } from '@vercel/config/v1';

type Rewrite = { source: string; destination: string };
type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

/** 全部の応答に付ける安全のヘッダー（D-194）。 */
export const SECURITY_HEADERS: HeaderRule[] = [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ],
  },
];

/** API_ORIGIN から中継の rewrites を作る（純粋。無ければ空）。 */
export function apiRewritesFor(origin: string | undefined): Rewrite[] {
  const raw = origin?.trim();
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API_ORIGIN が URL として読めません');
  }
  if (
    url.protocol !== 'https:' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      'API_ORIGIN は https のオリジンだけ（パス・クエリ・資格情報なし）にしてください',
    );
  return [{ source: '/api/:path*', destination: `${url.origin}/api/:path*` }];
}

/** vercel.json に写す設定（純粋。API_ORIGIN が無ければ rewrites を持たない）。 */
export function vercelConfigFor(origin: string | undefined): VercelConfig {
  const rewrites = apiRewritesFor(origin);
  return {
    headers: SECURITY_HEADERS,
    ...(rewrites.length > 0 ? { rewrites } : {}),
  };
}

export const config: VercelConfig = vercelConfigFor(process.env.API_ORIGIN);
