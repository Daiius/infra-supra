// OGP の画像の URL（D-191）: VITE_SITE_URL が無ければ相対・あればそのオリジン + /og.png・壊れた値は止める。
import { describe, expect, it } from 'vitest';
import { OG_IMAGE_TOKEN, ogImageUrl } from './og-meta.ts';
import indexHtml from '../index.html?raw';

describe('ogImageUrl', () => {
  it('VITE_SITE_URL が無い・空なら相対の /og.png', () => {
    expect(ogImageUrl(undefined)).toBe('/og.png');
    expect(ogImageUrl('  ')).toBe('/og.png');
  });
  it('あればオリジンだけを使う（末尾の / やパスは落とす）', () => {
    expect(ogImageUrl('https://example.com')).toBe(
      'https://example.com/og.png',
    );
    expect(ogImageUrl('https://example.com/')).toBe(
      'https://example.com/og.png',
    );
    expect(ogImageUrl('https://example.com/app/')).toBe(
      'https://example.com/og.png',
    );
  });
  it('URL として読めない・http(s) でない値は止める', () => {
    expect(() => ogImageUrl('example.com')).toThrow();
    expect(() => ogImageUrl('ftp://example.com')).toThrow();
  });
});

describe('index.html の OGP のメタタグ', () => {
  it('og:image と twitter:image は置き換えの目印を持ち、大きな画像のカードにする', () => {
    expect(indexHtml).toContain(
      `<meta property="og:image" content="${OG_IMAGE_TOKEN}" />`,
    );
    expect(indexHtml).toContain(
      `<meta name="twitter:image" content="${OG_IMAGE_TOKEN}" />`,
    );
    expect(indexHtml).toContain(
      '<meta property="og:image:width" content="1200" />',
    );
    expect(indexHtml).toContain(
      '<meta property="og:image:height" content="630" />',
    );
    expect(indexHtml).toContain(
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    expect(indexHtml).toMatch(/<meta property="og:title" content="[^"]+" \/>/);
    expect(indexHtml).toMatch(
      /<meta\s+property="og:description"\s+content="[^"]+"\s*\/>/,
    );
  });
});
