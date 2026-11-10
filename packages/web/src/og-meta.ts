// OGP の画像の URL（D-191）。og:image・twitter:image は絶対 URL が望ましいので、本番のオリジンをビルドの環境変数 VITE_SITE_URL
// （Vercel のダッシュボードで設定する。例の形: https://<ホスト名>）から入れる。実ドメインはリポジトリに書かない。
// 無ければ相対の /og.png にする（ページは壊れないが、SNS によっては画像を出さない）。vite.config.ts の transformIndexHtml から呼ぶ。
import { siteOrigin } from './site-meta.ts';

/** index.html の中で置き換える目印。 */
export const OG_IMAGE_TOKEN = '__OG_IMAGE_URL__';
/** 書き出した画像の置き場（public/og.png）。 */
export const OG_IMAGE_PATH = '/og.png';
/**
 * 画像の版。og.png を作り直したら上げる（SNS・zenn などのリンクのカードのキャッシュを破るため、og:image の URL に ?v= で付ける）。
 * 2: 2026-11-10 にロゴを Philosopher Bold・neutral-700 にし、背景を濃くした版。
 */
export const OG_IMAGE_VERSION = 2;

/** VITE_SITE_URL から og:image の URL を作る（純粋。末尾に ?v=版）。無い・空なら相対。URL として読めない・http(s) でなければ止める。 */
export function ogImageUrl(siteUrl: string | undefined): string {
  const path = `${OG_IMAGE_PATH}?v=${OG_IMAGE_VERSION}`;
  return `${siteOrigin(siteUrl) ?? ''}${path}`;
}
