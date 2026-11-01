// 構成・部品のフレーバー（D-41・D-45）: すべてにあり、数値を書かない（出典のある数値でも、ここでは書かない方針）。
// 製品名の中の数字（R2・D1）は数値ではないので通す。
import { describe, expect, it } from 'vitest';
import { COMPONENT_FLAVOR, STACK_FLAVOR } from './flavor.ts';
import { COMPONENTS, SLOT_LABELS, STACK_DEFS } from './index.ts';

const NUMBER = /(?<![A-Za-z])[0-9０-９]/;

describe('STACK_FLAVOR', () => {
  it('すべての構成に短い説明があり、余計な id がない', () => {
    expect(Object.keys(STACK_FLAVOR).sort()).toEqual(
      STACK_DEFS.map((s) => s.id).sort(),
    );
  });

  it.each(Object.entries(STACK_FLAVOR))('%s は数値を書かない', (_, text) => {
    expect(text).not.toMatch(NUMBER);
    expect(text.length).toBeLessThanOrEqual(80);
  });
});

describe('COMPONENT_FLAVOR', () => {
  it('すべての部品の選択肢に短い説明があり、余計なキーがない', () => {
    expect(Object.keys(COMPONENT_FLAVOR).sort()).toEqual(
      [
        ...new Set(COMPONENTS.map((c) => `${c.platform}:${c.slot}:${c.id}`)),
      ].sort(),
    );
  });

  it.each(Object.entries(COMPONENT_FLAVOR))(
    '%s は数値を書かない',
    (_, text) => {
      expect(text).not.toMatch(NUMBER);
      expect(text.length).toBeLessThanOrEqual(60);
    },
  );

  it('部品の名前・説明・スロットの名前に「不適切」と書かない（画面に出さない。D-45）', () => {
    for (const c of COMPONENTS) {
      expect(c.label).not.toContain('不適切');
      expect(c.note).not.toContain('不適切');
    }
    for (const label of Object.values(SLOT_LABELS))
      expect(label).not.toContain('不適切');
  });
});
