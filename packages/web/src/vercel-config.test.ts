// Vercel の中継の設定（vercel.ts。D-150）: API_ORIGIN が無ければ何も足さない・あれば /api/* だけを中継する・壊れた値は止める。
import { describe, expect, it } from 'vitest';
import { apiRewritesFor } from '../vercel.ts';

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
