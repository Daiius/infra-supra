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
  STACKS,
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
 * プレイの id の形（D-169）: 新しいプレイを始めたときに web が作るランダムな UUID（小文字の 16 進）と、手元の結果の履歴の id
 * （FNV-1a 32 ビットの 16 進 8 文字。D-144）を `.` でつないだもの。端末や人を識別する値ではない。
 */
export const PLAY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{8}$/;

/**
 * 送る中身（prd/15 §4）。保存はおおまかな形だけをここで確かめ（未知の欄は通す）、細かい形は game の parseSave が確かめる。
 * 前の試行（previous）は受け取っても使わない（照合と保存の前に外す）。
 */
export const submissionSchema = z.object({
  /** 二重の送信を 1 行にする鍵（D-169）。同じ端末の同じプレイの送り直しは同じ値、別の端末なら別の値になる。 */
  playId: z.string().max(64).regex(PLAY_ID_PATTERN),
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
    totalCost: finite,
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
 * 結果の中身のハッシュ（OCL-64BE2E4E。D-169 からは一意の鍵ではなく分析用の列）。送られた行動の列ではなく、
 * **再生した月ごとの結果**（月の報告の列）と、それを決める始めたときの選択（シナリオ・シード・構成・フレームワーク）の SHA-256（16 進）。
 * 結果を変えない書き換えは同じ値になる。別の人の同じ遊び方（既定のシード 42・同じ構成・何もしない）も同じ値になるので、
 * 鍵にすると人気の遊び方が少なく数えられた。二重の送信は playId（端末ごとのプレイの id）で 1 行にする（D-169）。
 */
export function playHashOf(
  save: Pick<SaveData, 'scenarioId' | 'seed' | 'stackIndex' | 'framework'>,
  state: Pick<GameState, 'history'>,
): string {
  const content = canonicalJson({
    scenarioId: save.scenarioId,
    seed: save.seed,
    // 構成は id で（並びが変わっても同じ値。D-171）
    stackId: STACKS[save.stackIndex]?.id ?? null,
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
  // 列には構成の id を入れる（STACKS の並びが変わっても過去の行の意味がずれない。D-171）
  const stack = STACKS[save.stackIndex];
  if (!stack) return { ok: false, code: 'invalid-save' };
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
      playId: sub.playId,
      playHash: playHashOf(save, state),
      scenarioId: save.scenarioId,
      seed: save.seed,
      startDate: save.startDate,
      stackId: stack.id,
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
