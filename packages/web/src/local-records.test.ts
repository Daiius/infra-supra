// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAppKeys,
  clearLocalRecords,
  HOWTO_SEEN_KEY,
  HOWTO_VERSION,
  loadHowtoSeen,
  parseHowtoSeen,
  storeHowtoSeen,
} from './local-records.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('遊び方を見た記録（D-146）', () => {
  it('今の版だけを見た扱いにし、無い・壊れた・形や版が違うものは見ていない扱い', () => {
    expect(parseHowtoSeen(null)).toBe(false);
    expect(parseHowtoSeen('')).toBe(false);
    expect(parseHowtoSeen('{壊れた')).toBe(false);
    expect(parseHowtoSeen('null')).toBe(false);
    expect(parseHowtoSeen('1')).toBe(false);
    expect(parseHowtoSeen(JSON.stringify({ version: HOWTO_VERSION + 1 }))).toBe(
      false,
    );
    expect(parseHowtoSeen(JSON.stringify({ version: HOWTO_VERSION }))).toBe(
      true,
    );
  });

  it('書いたら読める', () => {
    expect(loadHowtoSeen()).toBe(false);
    storeHowtoSeen();
    expect(loadHowtoSeen()).toBe(true);
    expect(localStorage.getItem(HOWTO_SEEN_KEY)).toBe(
      JSON.stringify({ version: HOWTO_VERSION }),
    );
  });
});

describe('ローカルの記録の消去（D-147）', () => {
  it('infra-supra: で始まるキーだけを消し、消したキーを返す', () => {
    localStorage.setItem('infra-supra:game-save', '{}');
    localStorage.setItem('infra-supra:results', '{}');
    localStorage.setItem('other', '1');
    localStorage.setItem('infra-suprax', '1');
    expect(clearAppKeys(localStorage).sort()).toEqual([
      'infra-supra:game-save',
      'infra-supra:results',
    ]);
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem('other')).toBe('1');
  });

  it('localStorage と sessionStorage の両方から消す', () => {
    storeHowtoSeen();
    sessionStorage.setItem('infra-supra:events-seen', 'a:1');
    sessionStorage.setItem('keep', '1');
    clearLocalRecords();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });
});
