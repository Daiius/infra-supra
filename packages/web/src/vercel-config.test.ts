// Vercel の設定（vercel.ts。D-150・D-194）: API_ORIGIN が無ければ中継を足さない・あれば /api/* だけを中継する・壊れた値は止める。
// 安全のヘッダーは API_ORIGIN の有無と無関係に常に付ける。
import { describe, expect, it } from 'vitest';
import { apiRewritesFor, vercelConfigFor } from '../vercel.ts';

/** 資格情報の付いた URL（秘密の検査に掛からないよう、文字列に直書きしない）。 */
const withUser = (origin: string) => {
  const u = new URL(origin);
  u.username = 'someone';
  u.password = 'x';
  return u.href;
};

describe('apiRewritesFor', () => {
  it('API_ORIGIN が無い・空なら中継を作らない（今の本番のまま）', () => {
    expect(apiRewritesFor(undefined)).toEqual([]);
    expect(apiRewritesFor('')).toEqual([]);
    expect(apiRewritesFor('  ')).toEqual([]);
  });

  it('https のオリジンなら /api/* をそのパスのまま中継する（末尾の / は落とす）', () => {
    for (const o of [
      'https://stats.example.test',
      'https://stats.example.test/',
    ])
      expect(apiRewritesFor(o)).toEqual([
        {
          source: '/api/:path*',
          destination: 'https://stats.example.test/api/:path*',
        },
      ]);
    expect(
      apiRewritesFor('https://stats.example.test:8443')[0]!.destination,
    ).toBe('https://stats.example.test:8443/api/:path*');
  });

  it('https でない・パスや資格情報の付いた・読めない値はビルドを止める（値は文に出さない）', () => {
    for (const bad of [
      'http://stats.example.test',
      'https://stats.example.test/api',
      withUser('https://stats.example.test'),
      'https://stats.example.test/?x=1',
      'stats.example.test',
    ]) {
      expect(() => apiRewritesFor(bad)).toThrow(/API_ORIGIN/);
      try {
        apiRewritesFor(bad);
      } catch (e) {
        expect(String(e)).not.toContain('stats.example.test');
      }
    }
  });
});

describe('vercelConfigFor（安全のヘッダー。D-194）', () => {
  const headerMap = (origin: string | undefined) => {
    const c = vercelConfigFor(origin);
    expect(c.headers).toHaveLength(1);
    expect(c.headers![0]!.source).toBe('/(.*)');
    return Object.fromEntries(
      c.headers![0]!.headers.map((h) => [h.key, h.value]),
    );
  };

  it('API_ORIGIN の有無と無関係に、全部のパスへ同じ安全のヘッダーを付ける', () => {
    for (const origin of [undefined, 'https://stats.example.test']) {
      const h = headerMap(origin);
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      for (const feature of ['camera', 'microphone', 'geolocation'])
        expect(h['Permissions-Policy']).toContain(`${feature}=()`);
      // CSP は埋め込みを断る 1 指令だけ（本格的な CSP は入れない）
      expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    }
  });

  it('rewrites は API_ORIGIN があるときだけ持つ', () => {
    expect(vercelConfigFor(undefined).rewrites).toBeUndefined();
    expect(vercelConfigFor('https://stats.example.test').rewrites).toEqual(
      apiRewritesFor('https://stats.example.test'),
    );
  });
});
