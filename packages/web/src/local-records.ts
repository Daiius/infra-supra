// 遊び方を見たかの記録と、このアプリのローカルの記録の消去（D-146・D-147）。
// 形の確かめと消去は Storage を引数で受ける（テストでは jsdom の localStorage・sessionStorage を渡す）。

/** このアプリが localStorage・sessionStorage に置くキーの接頭辞（セーブ・前回の構成・結果の履歴・タブの選択など）。 */
export const APP_KEY_PREFIX = 'infra-supra:';

/** 遊び方を見たかの記録（D-146）。中身を大きく替えたら版を上げ、もう一度自動で出す。 */
export const HOWTO_SEEN_KEY = 'infra-supra:howto-seen';
export const HOWTO_VERSION = 1;

/** 保存した値が今の版の「見た」か。読めない・形が違う・版が違うものは見ていない扱い。 */
export function parseHowtoSeen(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const v: unknown = JSON.parse(raw);
    return (
      typeof v === 'object' &&
      v !== null &&
      (v as { version?: unknown }).version === HOWTO_VERSION
    );
  } catch {
    return false;
  }
}

/** 遊び方を見たか。保存領域が使えない環境では見ていない扱い（毎回出る）。 */
export function loadHowtoSeen(): boolean {
  try {
    return parseHowtoSeen(localStorage.getItem(HOWTO_SEEN_KEY));
  } catch {
    return false;
  }
}

/** 遊び方を見たことを書く。書けなければ何もしない（次も自動で出るだけ）。 */
export function storeHowtoSeen(): void {
  try {
    localStorage.setItem(
      HOWTO_SEEN_KEY,
      JSON.stringify({ version: HOWTO_VERSION }),
    );
  } catch {
    // 保存領域が使えない環境では覚えない
  }
}

/** storage にあるこのアプリのキー（接頭辞 infra-supra:）を全部消し、消したキーを返す。他のアプリのキーは残す。 */
export function clearAppKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(APP_KEY_PREFIX)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
  return keys;
}

/**
 * ローカルの記録を全部消す（設定の「ローカルの記録を消す」。D-147）。localStorage（セーブ・前回の構成・結果の履歴・
 * タブと表示の選択・遊び方を見たか）と sessionStorage（出来事の既読）の両方。使えない保存領域は飛ばす。
 */
export function clearLocalRecords(): void {
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      clearAppKeys(get());
    } catch {
      // 保存領域が使えない環境では消すものが無い
    }
  }
}
