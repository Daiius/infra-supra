import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sourcedSchema } from './provenance.ts';

const Price = sourcedSchema(z.string());

describe('sourcedSchema', () => {
  it('official には出典が必要', () => {
    expect(Price.safeParse({ value: '1', basis: 'official' }).success).toBe(
      false,
    );
    expect(
      Price.safeParse({
        value: '1',
        basis: 'official',
        sourceRef: {
          url: 'https://example.com/pricing',
          retrievedAt: '2000-01-01',
        },
      }).success,
    ).toBe(true);
  });

  it('derived には導出が必要', () => {
    expect(Price.safeParse({ value: '2', basis: 'derived' }).success).toBe(
      false,
    );
    expect(
      Price.safeParse({
        value: '2',
        basis: 'derived',
        derivation: {
          id: 'double',
          label: '2 倍',
          expression: 'a × 2',
          inputs: [{ name: 'a', value: 1, basis: 'fictional' }],
          result: 2,
        },
      }).success,
    ).toBe(true);
  });

  it('assumption と fictional は出典なしで通る', () => {
    expect(Price.safeParse({ value: '1', basis: 'assumption' }).success).toBe(
      true,
    );
    expect(Price.safeParse({ value: '1', basis: 'fictional' }).success).toBe(
      true,
    );
  });

  it('取得日は YYYY-MM-DD', () => {
    expect(
      Price.safeParse({
        value: '1',
        basis: 'official',
        sourceRef: { url: 'https://example.com', retrievedAt: '2000/01/01' },
      }).success,
    ).toBe(false);
  });
});
