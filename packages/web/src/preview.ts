// 開発中のシナリオ（Scenario.preview。D-232）を画面に出すか。普段は出さず、URL に `?preview=1` を付けて開いたときだけ出す。
// 1 度付けて開けば localStorage に覚え（次からは付けなくてよい）、`?preview=0` で消す。保存領域が使えない環境では URL の値だけで決める。
// 開発中のシナリオは集計に送らない（stats-client.ts）・統計の画面には出さない（stats-mode.tsx。サーバーが受け付けない）。
import { listedScenarios, type Scenario } from 'game';

/** 覚えておくキー（接頭辞が infra-supra: なので、設定の「ローカルの記録を消す」でも消える）。 */
export const PREVIEW_KEY = 'infra-supra:preview';

/** 保存領域（使えない環境では undefined。プライベートウィンドウなどで getter が投げることがある）。 */
function storageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * URL のクエリ（search）の preview を覚えた値に反映し、出すかを返す。1 は覚える・0 は消す・ほかの値と無しは覚えた値。
 * 保存領域の読み書きに失敗しても例外を出さない（URL の値か、出さない）。
 */
export function readPreview(
  search: string,
  storage: Storage | undefined,
): boolean {
  const q = new URLSearchParams(search).get('preview');
  try {
    if (q === '1') storage?.setItem(PREVIEW_KEY, '1');
    else if (q === '0') storage?.removeItem(PREVIEW_KEY);
  } catch {
    // 覚えられなくても、今開いている間は URL の値で出す
  }
  if (q === '1') return true;
  if (q === '0') return false;
  try {
    return storage?.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** 今のページで開発中のシナリオを出すか（呼ぶたびに URL と保存領域を読む。テストで URL を差し替えられる）。 */
export const previewEnabled = (): boolean =>
  readPreview(window.location.search, storageOrUndefined());

/** 始める画面に並べるシナリオ（登録順。開発中のものは previewEnabled のときだけ）。 */
export const scenarioList = (): Scenario[] => listedScenarios(previewEnabled());
