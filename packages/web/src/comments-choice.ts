// コメント欄の描き方（ブラウザで読み込む / 記事のページに含める。D-82・D-109）は、画面では選ばせない（D-220）。
// 含めて得をする組が無く（API は減るが、作り直し・無効化・ビルドし直しが増えるか、コメントが遅れて見えて反映スピードが下がる）、
// 選ばせても迷わせるだけなので、どのシナリオも「ブラウザで読み込む」（COMMENTS_IN_BROWSER）にする。
// エンジン（game の setupCommentOptions・設定の値）は残す。古いセーブ・集計の再生はそのまま読める。
import type { setupCommentOptions } from 'game';

/** 画面で出すコメント欄の選択肢（いつも空。web では game の setupCommentOptions の代わりにこれを使う）。 */
export const commentOptionsOf = (
  ..._: Parameters<typeof setupCommentOptions>
): ReturnType<typeof setupCommentOptions> => [];
