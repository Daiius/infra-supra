// ⓘ と離さない末尾の組み方（狭い幅で長い語が nowrap のままはみ出さないように）。
import { describe, expect, it } from 'vitest';
import { INFO_TAIL_CHARS, splitForInfo } from './option-text.tsx';

describe('splitForInfo', () => {
  it('最後の語が短ければ、その語を末尾にする（今までと同じ）', () => {
    expect(splitForInfo('Workers KV')).toEqual(['Workers ', 'KV']);
    expect(splitForInfo('D1')).toEqual(['', 'D1']);
  });

  it('最後の語が長ければ（日本語の続く文）、最後の数文字だけを末尾にする', () => {
    const name = 'Neon: 従量の Postgres（閲覧が途切れると止まる）';
    const [head, tail] = splitForInfo(name);
    expect(head + tail).toBe(name);
    expect([...tail]).toHaveLength(INFO_TAIL_CHARS);
    expect(tail).toBe('止まる）');
  });
});
