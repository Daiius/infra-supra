// 送られたプレイの照合（D-135・prd/15 §5.1）。保存を game で再生して 4 軸と終わり方を数え直し、クライアントの値と比べる。
// 食い違えば受け付けない（書き換えと、画面とサーバーの版ずれの両方をここで止める。版のハッシュは付けない）。
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  parseSave,
  replaySave,
  resultAxesOf,
  RESULT_AXES,
  SCENARIOS,
  type EndReason,
  type GameState,
  type SaveData,
  type ResultAxes,
} from 'game';
import { z } from 'zod';
import type { ResultRecord } from './repo.ts';

/** 1 か月に選べる行動の数・月の数の上限（形の検査。中身は再生で確かめる）。どのシナリオも 12 か月で、行動は数個。 */
const MAX_TURNS = 24;
const MAX_ACTIONS_PER_TURN = 64;

const END_REASONS = [
  'completed',
  'cash',
  'outages',
  'policy',
] as const satisfies readonly EndReason[];

const finite = z.number().refine(Number.isFinite);

/**
 * 送る中身（prd/15 §4）。保存はおおまかな形だけをここで確かめ（未知の欄は通す）、細かい形は game の parseSave が確かめる。
 * 前の試行（previous）は受け取っても使わない（照合と保存の前に外す）。
 */
export const submissionSchema = z.object({
  save: z.looseObject({
    version: z.number().int(),
    scenarioId: z.string().max(64),
    stackIndex: z.number().int(),
    /**
     * シード（32 ビットの整数。乱数は seed | 0 で使うので、小数や範囲の外の値は同じ列の別のシードとして数を水増しできる）。
     */
    seed: z
      .number()
      .int()
      .min(-(2 ** 31))
      .max(2 ** 31 - 1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    turns: z
      .array(
        z
          .array(z.looseObject({ type: z.string().max(64) }))
          .max(MAX_ACTIONS_PER_TURN),
      )
      .max(MAX_TURNS),
  }),
  axes: z.object({
    cash: finite,
    satisfaction: finite,
    featurePoints: finite,
    edgeMonths: finite,
  }),
  end: z.object({
    reason: z.enum(END_REASONS),
    month: z.number().int(),
  }),
});

export type Submission = z.infer<typeof submissionSchema>;

/** 受け付けない理由。 */
export type RejectCode =
  /** 保存の形が読めない（シナリオが無い・版が違う・欄の形が違う）。 */
  | 'invalid-save'
  /** 再生できない（行動の途中で終わっている・月数が合わない・例外）。 */
  | 'replay-failed'
  /** 再生すると、まだ終わっていない。 */
  | 'unfinished'
  /** 再生した 4 軸・終わり方が、送られた値と食い違う。 */
  | 'mismatch';

export type VerifyResult =
  | { ok: true; record: ResultRecord }
  | { ok: false; code: RejectCode; fields?: string[] };

/**
 * 4 軸の値が同じとみなすか。照合は同じエンジンの再生なので本来は一致するが、JS エンジンの間で超越関数（estimator の
 * Math.exp など。determinism.test.ts）の最後の桁が違いうるので、相対 1e-9 の差までは同じとみなす。
 * 書き換え（1 セント・満足度 0.001 の違い）はこの幅より大きい。
 */
export function sameAxisValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * 二重の送信を 1 行にする鍵（OCL-64BE2E4E）。送られた行動の列ではなく、**再生した月ごとの結果**（月の報告の列）と、
 * それを決める始めたときの選択（シナリオ・シード・構成・フレームワーク）の SHA-256（16 進）。
 * 行動に未知の欄を足す・何もしない行動を足すなど、結果を変えない書き換えは同じ鍵になる（別の行として数を水増しできない）。
 * 結果が月ごとに全部同じプレイは、行動の列が違っても 1 つのプレイとして数える。
 */
export function playHashOf(
  save: Pick<SaveData, 'scenarioId' | 'seed' | 'stackIndex' | 'framework'>,
  state: Pick<GameState, 'history'>,
): string {
  const content = canonicalJson({
    scenarioId: save.scenarioId,
    seed: save.seed,
    stackIndex: save.stackIndex,
    framework: save.framework,
    history: state.history,
  });
  return createHash('sha256').update(content).digest('hex');
}

/** 照合する（純粋。保存はしない）。 */
export function verifySubmission(sub: Submission): VerifyResult {
  const { previous: _, ...raw } = sub.save;
  if (!(sub.save.scenarioId in SCENARIOS))
    return { ok: false, code: 'invalid-save' };
  const save = parseSave(raw);
  if (!save) return { ok: false, code: 'invalid-save' };
  let state;
  try {
    state = replaySave(save);
  } catch {
    return { ok: false, code: 'replay-failed' };
  }
  if (state.phase === 'playing' || !state.end)
    return { ok: false, code: 'unfinished' };
  const axes: ResultAxes = resultAxesOf(state);
  const fields = RESULT_AXES.filter(
    (a) => !sameAxisValue(axes[a.id], sub.axes[a.id]),
  ).map((a) => a.id as string);
  if (state.end.reason !== sub.end.reason) fields.push('end.reason');
  if (state.end.month !== sub.end.month) fields.push('end.month');
  if (fields.length > 0) return { ok: false, code: 'mismatch', fields };
  return {
    ok: true,
    record: {
      playHash: playHashOf(save, state),
      scenarioId: save.scenarioId,
      seed: save.seed,
      startDate: save.startDate,
      stackIndex: save.stackIndex,
      framework: save.framework,
      rewound: save.rewound === true,
      endReason: state.end.reason,
      endMonth: state.end.month,
      outages: state.outages,
      // 保存するのはサーバーが数えた値（クライアントの値とは上の幅の中で同じ）
      ...axes,
      save,
    },
  };
}
