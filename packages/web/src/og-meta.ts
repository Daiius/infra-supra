// OGP の画像の URL（D-191）。og:image・twitter:image は絶対 URL が望ましいので、本番のオリジンをビルドの環境変数 VITE_SITE_URL
// （Vercel のダッシュボードで設定する。例の形: https://<ホスト名>）から入れる。実ドメインはリポジトリに書かない。
// 無ければ相対の /og.png にする（ページは壊れないが、SNS によっては画像を出さない）。vite.config.ts の transformIndexHtml から呼ぶ。

/** index.html の中で置き換える目印。 */
export const OG_IMAGE_TOKEN = '__OG_IMAGE_URL__';
/** 書き出した画像の置き場（public/og.png）。 */
export const OG_IMAGE_PATH = '/og.png';

/** VITE_SITE_URL から og:image の URL を作る（純粋）。無い・空なら相対。URL として読めない・http(s) でなければ止める。 */
export function ogImageUrl(siteUrl: string | undefined): string {
  const raw = siteUrl?.trim();
  if (!raw) return OG_IMAGE_PATH;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_SITE_URL が URL として読めません');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_SITE_URL は http(s) のオリジンにしてください');
  }
  return `${url.origin}${OG_IMAGE_PATH}`;
}
