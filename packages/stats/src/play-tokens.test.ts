// 開始のトークンの置き場（D-174）。実の Redis は使わない（Redis の実装は送るコマンドの形だけを、手元の偽物で確かめる）。
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import {
  memoryTokenStore,
  newPlayToken,
  PLAY_TOKEN_PATTERN,
  PLAY_TOKEN_TTL_SECONDS,
  redisTokenStore,
} from './play-tokens.ts';

describe('トークン', () => {
  it('32 バイトの乱数の base64url（毎回違う）', () => {
    const a = newPlayToken();
    expect(a).toMatch(PLAY_TOKEN_PATTERN);
    expect(newPlayToken()).not.toBe(a);
  });
});

describe('memoryTokenStore', () => {
  it('取り出すと消える（使い捨て）・置いていないものは null', async () => {
    const s = memoryTokenStore(() => 1000);
    await s.put('t', 1000);
    expect(await s.take('t')).toBe(1000);
    expect(await s.take('t')).toBeNull();
    expect(await s.take('nope')).toBeNull();
  });

  it('TTL を過ぎたものは null', async () => {
    let now = 0;
    const s = memoryTokenStore(() => now);
    await s.put('a', 0);
    await s.put('b', 0);
    now = PLAY_TOKEN_TTL_SECONDS * 1000 - 1;
    expect(await s.take('a')).toBe(0);
    now = PLAY_TOKEN_TTL_SECONDS * 1000;
    expect(await s.take('b')).toBeNull();
  });
});

describe('redisTokenStore', () => {
  /** SET … EX と MULTI の GET・DEL だけを持つ偽物。 */
  function fakeRedis() {
    const data = new Map<string, string>();
    const calls: unknown[][] = [];
    const redis = {
      async set(...args: unknown[]) {
        calls.push(['set', ...args]);
        data.set(args[0] as string, args[1] as string);
        return 'OK';
      },
      multi() {
        const ops: [string, string][] = [];
        const chain = {
          get(k: string) {
            ops.push(['get', k]);
            return chain;
          },
          del(k: string) {
            ops.push(['del', k]);
            return chain;
          },
          async exec() {
            calls.push(['multi', ...ops.map((o) => o.join(' '))]);
            return ops.map(([op, k]) => {
              if (op === 'get') return [null, data.get(k) ?? null];
              return [null, data.delete(k) ? 1 : 0];
            });
          },
        };
        return chain;
      },
    };
    return { redis: redis as unknown as Redis, calls };
  }

  it('TTL つきで置き、GET と DEL を 1 つの MULTI で取り出す', async () => {
    const { redis, calls } = fakeRedis();
    const s = redisTokenStore(redis);
    await s.put('tok', 1234);
    expect(await s.take('tok')).toBe(1234);
    expect(await s.take('tok')).toBeNull();
    const key = 'infra-supra:play-token:tok';
    expect(calls[0]).toEqual([
      'set',
      key,
      '1234',
      'EX',
      PLAY_TOKEN_TTL_SECONDS,
    ]);
    expect(calls[1]).toEqual(['multi', `get ${key}`, `del ${key}`]);
  });
});
