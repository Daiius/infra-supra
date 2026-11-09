// 集計に送るプレイの id（D-169）。
import { newSave, rewindSave, replaySave, withTurn } from 'game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPlayNonce,
  newPlayNonce,
  STATS_PLAY_ID_PATTERN,
  statsPlayId,
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
