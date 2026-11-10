// サイトとして配るもの（D-194）: robots.txt・sitemap.xml・canonical・index.html の頭・manifest・404.html。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  robotsTxt,
  siteOrigin,
  sitemapXml,
} from './site-meta.ts';

const webRoot = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(webRoot, p), 'utf8');

describe('siteOrigin', () => {
  it('無い・空なら undefined、あればオリジンだけ（パスは落とす）', () => {
    expect(siteOrigin(undefined)).toBeUndefined();
    expect(siteOrigin(' ')).toBeUndefined();
    expect(siteOrigin('https://example.com/app/')).toBe('https://example.com');
  });
  it('URL として読めない・http(s) でない値は止める', () => {
    expect(() => siteOrigin('example.com')).toThrow(/VITE_SITE_URL/);
    expect(() => siteOrigin('ftp://example.com')).toThrow(/VITE_SITE_URL/);
  });
});

describe('robots.txt', () => {
  it('全部を許可し、オリジンがあるときだけ Sitemap の行を足す', () => {
    expect(robotsTxt(undefined)).toBe('User-agent: *\nAllow: /\n');
    expect(robotsTxt('https://example.com')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });
});

describe('sitemap.xml', () => {
  it('オリジンが無ければ出さない', () => {
    expect(sitemapXml(undefined)).toBeUndefined();
  });
  it('トップ（ゲーム）と見積モードの 2 つを絶対 URL で載せる', () => {
    const xml = sitemapXml('https://example.com')!;
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
      'https://example.com/',
      'https://example.com/?mode=estimate',
    ]);
  });
});

describe('canonicalUrl', () => {
  it('オリジンがあるときだけトップの URL', () => {
    expect(canonicalUrl(undefined)).toBeUndefined();
    expect(canonicalUrl('https://example.com')).toBe('https://example.com/');
  });
});

describe('配る HTML と manifest', () => {
  it('index.html と 404.html は HTML のコメントを持たない（開発のメモを本番に配らない）', () => {
    for (const p of ['index.html', 'public/404.html'])
      expect(read(p)).not.toContain('<!--');
  });

  it('index.html は theme-color・manifest へのリンク・noscript の案内を持つ', () => {
    const html = read('index.html');
    expect(html).toContain('<meta name="theme-color" content="#ffffff" />');
    expect(html).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />',
    );
    expect(html).toMatch(
      /<noscript>[\s\S]*JavaScript を有効にしてください。[\s\S]*<\/noscript>/,
    );
    // canonical は VITE_SITE_URL があるときだけビルドで足す（index.html には書かない）
    expect(html).not.toContain('rel="canonical"');
  });

  it('manifest は日本語・トップから始まり、アイコンは favicon.svg と PNG の 192・512（D-195）', () => {
    const m = JSON.parse(read('public/manifest.webmanifest')) as Record<
      string,
      unknown
    >;
    expect(m).toMatchObject({
      name: 'infra-supra',
      short_name: 'infra-supra',
      lang: 'ja',
      start_url: '/',
      theme_color: '#ffffff',
    });
    expect(typeof m.display).toBe('string');
    expect(typeof m.background_color).toBe('string');
    expect(m.icons).toEqual([
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ]);
    // 置いたファイルが manifest・index.html の参照と一致する（PNG の寸法は IHDR の幅・高さ）
    for (const [p, size] of [
      ['public/icon-192.png', 192],
      ['public/icon-512.png', 512],
      ['public/apple-touch-icon.png', 180],
    ] as const) {
      const png = readFileSync(join(webRoot, p));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });

  it('index.html は apple-touch-icon を持つ（D-195）', () => {
    expect(read('index.html')).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    );
  });

  it('404.html は JS 無しで読め、トップへのリンクを持つ', () => {
    const html = read('public/404.html');
    expect(html).toContain('<html lang="ja">');
    expect(html).not.toContain('<script');
    expect(html).toContain('<a href="/">');
    expect(html).toContain('ページが見つかりません');
  });
});
