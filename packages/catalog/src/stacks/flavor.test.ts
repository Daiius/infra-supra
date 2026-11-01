// 構成のフレーバー（D-41）: すべての構成にあり、数値を書かない（出典のある数値でも、ここでは書かない方針）。
import { describe, expect, it } from 'vitest';
import { STACK_FLAVOR } from './flavor.ts';
import { STACK_DEFS } from './index.ts';

describe('STACK_FLAVOR', () => {
  it('すべての構成に短い説明があり、余計な id がない', () => {
    expect(Object.keys(STACK_FLAVOR).sort()).toEqual(
      STACK_DEFS.map((s) => s.id).sort(),
    );
  });

  it.each(Object.entries(STACK_FLAVOR))('%s は数値を書かない', (_, text) => {
    expect(text).not.toMatch(/[0-9０-９]/);
    expect(text.length).toBeLessThanOrEqual(80);
  });
});
