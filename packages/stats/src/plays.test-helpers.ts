// テスト用: 終わったプレイの保存と、web が送るのと同じ中身（prd/15 §4）を作る。
import {
  newSave,
  replaySave,
  STACKS,
  resultAxesOf,
  withTurn,
  type Action,
  type SaveData,
} from 'game';
import type { Submission } from './verify.ts';

/**
 * 何もしない方針で終わるまで進めた保存（Cloudflare Paid・記事コミュニティ。どのシードでも完走する。D-142）。
 * first に行動を渡すと 1 か月目の終わりに当てる。
 */
export function finishedSave(
  seed = 42,
  first: Action[] = [],
  stackIndex = STACKS.findIndex((s) => s.id === 'cloudflare-vinext-paid'),
): SaveData {
  let save = newSave({
    scenarioId: 'article-community',
    stackIndex,
    seed,
    startDate: '2026-11-01',
  });
  for (let i = 0; replaySave(save).phase === 'playing'; i++)
    save = withTurn(save, i === 0 ? first : []);
  return save;
}

/** 保存から送る中身（web の stats-client.ts と同じ形）。 */
export function submissionOf(save: SaveData): Submission {
  const state = replaySave(save);
  return {
    save: JSON.parse(JSON.stringify(save)),
    axes: resultAxesOf(state),
    end: state.end!,
  };
}
