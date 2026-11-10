// サイトとして配るもの（D-194）: robots.txt・sitemap.xml・canonical の URL。絶対 URL は OGP（D-191・og-meta.ts）と同じく
// ビルドの環境変数 VITE_SITE_URL（Vercel のダッシュボードで設定する。例の形: https://<ホスト名>）から入れる。実ドメインはリポジトリに書かない。
// vite.config.ts のプラグインから呼び、ビルドの出力（dist）に書き出す（public の静的ファイルにはしない。値が環境変数で変わるため）。
//
// VITE_SITE_URL が無いとき（手元のビルド・プレビューなど）:
// - robots.txt は出す（全部を許可）。Sitemap の行は絶対 URL が要るので省く
// - sitemap.xml は出さない（sitemap の <loc> は絶対 URL でなければならないため）
// - canonical の link は付けない（相対の canonical は付けない方がまし）

/** VITE_SITE_URL からオリジンを取り出す（純粋）。無い・空なら undefined。URL として読めない・http(s) でなければ止める。 */
export function siteOrigin(siteUrl: string | undefined): string | undefined {
  const raw = siteUrl?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_SITE_URL が URL として読めません');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_SITE_URL は http(s) のオリジンにしてください');
  }
  return url.origin;
}

/** sitemap に載せるページ（トップ = ゲーム・見積モード）。オリジンからの相対。 */
export const SITEMAP_PATHS = ['/', '/?mode=estimate'] as const;

/** robots.txt の中身（全部を許可。オリジンがあれば Sitemap の行を足す）。 */
export function robotsTxt(origin: string | undefined): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (origin) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

const escapeXml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** sitemap.xml の中身（オリジンが無ければ undefined = 出さない）。 */
export function sitemapXml(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  const urls = SITEMAP_PATHS.map(
    (p) => `  <url>\n    <loc>${escapeXml(`${origin}${p}`)}</loc>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** canonical の URL（トップ。オリジンが無ければ undefined = 付けない）。 */
export function canonicalUrl(origin: string | undefined): string | undefined {
  return origin ? `${origin}/` : undefined;
}
