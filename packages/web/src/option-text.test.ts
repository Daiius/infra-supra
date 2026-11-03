// ⓘ と離さない末尾の組み方（語の途中で分けない・狭い幅で長いまとまりが nowrap のままはみ出さない）。
import { describe, expect, it } from 'vitest';
import { INFO_TAIL_MAX_CHARS, splitForInfo } from './option-text.tsx';

describe('splitForInfo', () => {
  it('最後の語を末尾にする（英語の語は今までと同じ）', () => {
    expect(splitForInfo('KV')).toEqual(['', 'KV']);
    expect(splitForInfo('Workers KV')).toEqual(['Workers ', 'KV']);
  });

  it('括弧で終わる名前は、括弧のまとまり全体を末尾にする（「オンデ／マンド」のように語の途中で切れない）', () => {
    expect(splitForInfo('AWS: DynamoDB（オンデマンド）')).toEqual([
      'AWS: DynamoDB',
      '（オンデマンド）',
    ]);
    expect(splitForInfo('AWS: Aurora Serverless v2（最小 0.5 ACU）')[1]).toBe(
      '（最小 0.5 ACU）',
    );
  });

  it('長い括弧は nowrap にする末尾を短くし、幅 360 を超える nowrap を作らない', () => {
    const name = 'Neon: 従量の Postgres（閲覧が途切れると止まる）';
    const [head, tail] = splitForInfo(name);
    expect(head + tail).toBe(name);
    expect([...tail].length).toBeLessThanOrEqual(INFO_TAIL_MAX_CHARS);
    expect(tail.endsWith('）')).toBe(true);
    // 長すぎる語は nowrap にしない
    const long = 'あ'.repeat(INFO_TAIL_MAX_CHARS + 5);
    expect(splitForInfo(`（${long}）`)[1].length).toBeLessThanOrEqual(
      INFO_TAIL_MAX_CHARS,
    );
  });
});
