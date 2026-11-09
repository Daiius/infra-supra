// 集計に送るプレイの id（D-169）。
import { newSave, rewindSave, replaySave, withTurn } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPlayNonce,
  loadPlayToken,
  newPlayNonce,
  PLAY_TOKEN_KEY,
  STATS_PLAY_ID_PATTERN,
  statsPlayId,
  storePlayNonce,
  storePlayToken,
} from './play-nonce.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const finished = (first: Parameters<typeof withTurn>[1] = []) => {
  let save = newSave({
    scenarioId: 'article-community',
    stackIndex: 1,
    seed: 42,
    startDate: '2026-11-02',
  });
  for (let i = 0; replaySave(save).phase === 'playing'; i++)
    save = withTurn(save, i === 0 ? first : []);
  return save;
};

describe('play-nonce', () => {
  it('nonce は小文字の UUID で、毎回違う', () => {
    const a = newPlayNonce();
    expect(isPlayNonce(a)).toBe(true);
    expect(newPlayNonce()).not.toBe(a);
    expect(isPlayNonce('x')).toBe(false);
    expect(isPlayNonce(a.toUpperCase())).toBe(false);
  });

  it('randomUUID が無い環境でも getRandomValues で UUID v4 を作る', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (b: Uint8Array) => b.fill(0xff),
    });
    const n = newPlayNonce();
    expect(n).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(isPlayNonce(n)).toBe(true);
  });

  it('送る id は nonce と手元の履歴の id。同じ nonce でも違う行動で終え直せば別の id（D-148）', () => {
    const nonce = newPlayNonce();
    const a = finished();
    const id = statsPlayId(nonce, a);
    expect(id).toMatch(STATS_PLAY_ID_PATTERN);
    expect(id.startsWith(`${nonce}.`)).toBe(true);
    expect(statsPlayId(nonce, a)).toBe(id);
    // 別の端末（別の nonce）の同じプレイは別の id
    expect(statsPlayId(newPlayNonce(), a)).not.toBe(id);
    // 戻って違う行動で終え直す
    let b = rewindSave(a, 1);
    b = withTurn(b, [{ type: 'set', key: 'format', value: 84 }]);
    while (replaySave(b).phase === 'playing') b = withTurn(b, []);
    expect(statsPlayId(nonce, b)).not.toBe(id);
  });
});

describe('開始のトークン（D-174）', () => {
  const memoryStorage = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  const token = 'a'.repeat(43);

  it('nonce と組で持ち、そのプレイにだけ返す。別のプレイを始める・プレイが無くなると消える', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const a = newPlayNonce();
    const b = newPlayNonce();
    storePlayNonce(a);
    storePlayToken(a, token);
    expect(JSON.parse(storage.m.get(PLAY_TOKEN_KEY)!)).toEqual({
      nonce: a,
      token,
    });
    expect(loadPlayToken(a)).toBe(token);
    expect(loadPlayToken(b)).toBeNull();
    // 同じ nonce を書き直しても残る（再開）
    storePlayNonce(a);
    expect(loadPlayToken(a)).toBe(token);
    // 別のプレイを始めると消える
    storePlayNonce(b);
    expect(storage.m.has(PLAY_TOKEN_KEY)).toBe(false);
    storePlayToken(b, token);
    storePlayNonce(null);
    expect(loadPlayToken(b)).toBeNull();
  });

  it('形の違う値は読まない', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const a = newPlayNonce();
    for (const v of ['x', '{}', JSON.stringify({ nonce: a, token: 'short' })]) {
      storage.m.set(PLAY_TOKEN_KEY, v);
      expect(loadPlayToken(a)).toBeNull();
    }
  });

  it('localStorage が使えない環境でも、開いている間はメモリに持つ', () => {
    const broken = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', {
      getItem: broken,
      setItem: broken,
      removeItem: broken,
    });
    const a = newPlayNonce();
    storePlayToken(a, token);
    expect(loadPlayToken(a)).toBe(token);
    storePlayNonce(null);
    expect(loadPlayToken(a)).toBeNull();
  });
});
