// 照合（D-135・prd/15 §7 段 2 の合格の条件: 書き換えた値・版のずれた送信がエラーになる。同じ送信を 2 回照合して同じ値）。
import { replaySave, rewindSave, withTurn } from 'game';
import { describe, expect, it } from 'vitest';
import { finishedSave, submissionOf } from './plays.test-helpers.ts';
import {
  sameAxisValue,
  submissionSchema,
  verifySubmission,
  type Submission,
} from './verify.ts';

const save = finishedSave();
const good = submissionOf(save);

const tampered = (f: (s: Submission) => void): Submission => {
  const s = structuredClone(good);
  f(s);
  return s;
};

describe('照合', () => {
  it('終わったプレイ（完走）は通り、サーバーが数えた 4 軸と終わり方で行を作る', () => {
    expect(replaySave(save).phase).toBe('completed');
    const v = verifySubmission(good);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.record).toMatchObject({
      scenarioId: 'article-community',
      seed: 42,
      startDate: '2026-11-01',
      stackIndex: 1,
      rewound: false,
      endReason: 'completed',
      endMonth: good.end.month,
      ...good.axes,
    });
    expect(v.record.playHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.record.save.turns).toEqual(save.turns);
  });

  it('同じ送信を 2 回照合して同じ値（決定論）', () => {
    expect(verifySubmission(structuredClone(good))).toEqual(
      verifySubmission(structuredClone(good)),
    );
  });

  it('4 軸のどれかを書き換えると mismatch（食い違った欄を返す）', () => {
    expect(verifySubmission(tampered((s) => (s.axes.cash += 0.01)))).toEqual({
      ok: false,
      code: 'mismatch',
      fields: ['cash'],
    });
    expect(
      verifySubmission(
        tampered((s) => {
          s.axes.satisfaction += 0.001;
          s.axes.edgeMonths += 1;
        }),
      ),
    ).toEqual({
      ok: false,
      code: 'mismatch',
      fields: ['satisfaction', 'edgeMonths'],
    });
    expect(
      verifySubmission(tampered((s) => (s.axes.featurePoints += 1))),
    ).toMatchObject({ code: 'mismatch', fields: ['featurePoints'] });
  });

  it('終わり方を書き換えると mismatch', () => {
    expect(
      verifySubmission(tampered((s) => (s.end.reason = 'cash'))),
    ).toMatchObject({ code: 'mismatch', fields: ['end.reason'] });
    expect(verifySubmission(tampered((s) => (s.end.month -= 1)))).toMatchObject(
      { code: 'mismatch', fields: ['end.month'] },
    );
  });

  it('行動の列を書き換えると（版のずれも同じ形で現れる）、送った値と食い違う', () => {
    // 1 か月目に画像の形式を替えた別のプレイの行動を、何もしないプレイの 4 軸で送る
    const other = finishedSave(42, [{ type: 'set', key: 'format', value: 84 }]);
    const v = verifySubmission({ ...good, save: submissionOf(other).save });
    expect(v).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('まだ終わっていないプレイは unfinished', () => {
    const s = tampered((x) => (x.save.turns = x.save.turns.slice(0, 3)));
    expect(verifySubmission(s)).toEqual({ ok: false, code: 'unfinished' });
  });

  it('終わった後にも行動がある・形の違う保存は受け付けない', () => {
    const after = submissionOf(save);
    after.save = JSON.parse(JSON.stringify(withTurn(save, [])));
    expect(verifySubmission(after)).toEqual({
      ok: false,
      code: 'replay-failed',
    });
    expect(
      verifySubmission(tampered((s) => (s.save.scenarioId = 'nope'))),
    ).toEqual({ ok: false, code: 'invalid-save' });
    expect(verifySubmission(tampered((s) => (s.save.version = 99)))).toEqual({
      ok: false,
      code: 'invalid-save',
    });
    expect(
      verifySubmission(tampered((s) => (s.save.framework = 'rails' as never))),
    ).toEqual({ ok: false, code: 'invalid-save' });
  });

  it('前の試行（previous）は照合にも鍵にも使わない', () => {
    const withPrev = tampered((s) => (s.save.previous = [[], []]));
    const a = verifySubmission(good);
    const b = verifySubmission(withPrev);
    expect(b.ok && a.ok && b.record.playHash === a.record.playHash).toBe(true);
    expect(b.ok && 'previous' in b.record.save).toBe(false);
  });

  it('「この月に戻る」を使ったプレイは rewound の印つきで通る（ST-06・D-148）', () => {
    let back = rewindSave(save, 2);
    while (replaySave(back).phase === 'playing') back = withTurn(back, []);
    const v = verifySubmission(submissionOf(back));
    expect(v.ok && v.record.rewound).toBe(true);
  });

  it('形の検査（zod）: 数でないシード・欠けた 4 軸・多すぎる月を通さない', () => {
    expect(submissionSchema.safeParse(good).success).toBe(true);
    expect(
      submissionSchema.safeParse(tampered((s) => (s.save.seed = '42' as never)))
        .success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({ save: good.save, end: good.end }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse(
        tampered((s) => (s.save.turns = Array.from({ length: 25 }, () => []))),
      ).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse(
        tampered((s) => (s.axes.cash = Number.POSITIVE_INFINITY)),
      ).success,
    ).toBe(false);
  });

  it('同じとみなす幅は相対 1e-9（エンジンの間の最後の桁の差だけを吸収する）', () => {
    expect(sameAxisValue(1234.56, 1234.56 * (1 + 1e-12))).toBe(true);
    expect(sameAxisValue(1234.56, 1234.57)).toBe(false);
    expect(sameAxisValue(0.8, 0.8 + 1e-6)).toBe(false);
    expect(sameAxisValue(0, 1e-12)).toBe(true);
  });
});
