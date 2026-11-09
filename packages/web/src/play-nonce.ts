// 集計に送るプレイの id（D-169・prd/15 §4）。新しいプレイを始めるときにランダムな nonce（UUID）を作り、進行中の保存と並べて
// localStorage に持つ（game の SaveData には入れない。保存の形と golden を変えない）。送る id は nonce と手元の結果の履歴の id
// （D-144 の FNV）をつないだもの:
// - 同じ端末からの同じプレイの送り直し → 同じ id（サーバーで 1 行）
// - 別の端末の同じプレイ（既定のシード 42・同じ構成・何もしない など）→ nonce が違うので別の行
// - 「この月に戻る」で違う行動で終え直したプレイ → 履歴の id が変わるので別の行（D-148）
// nonce は端末やあなたを識別する値ではない（プレイごとに作り直す）。
import type { SaveData } from 'game';
import { playId as historyId } from './results-history.ts';

/** 進行中のプレイの nonce の localStorage のキー（infra-supra: で始まるので、ローカルの記録の消去でも消える）。 */
export const PLAY_NONCE_KEY = 'infra-supra:play-nonce';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** packages/stats の PLAY_ID_PATTERN と同じ形（UUID + . + 16 進 8 文字）。 */
export const STATS_PLAY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{8}$/;

export const isPlayNonce = (x: unknown): x is string =>
  typeof x === 'string' && UUID.test(x);

/**
 * 新しい nonce（UUID v4・小文字）。crypto.randomUUID が無い環境（安全でない文脈の http など）では getRandomValues で組み立てる。
 */
export function newPlayNonce(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID().toLowerCase();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 送るプレイの id（nonce + . + 手元の履歴の id）。 */
export const statsPlayId = (nonce: string, save: SaveData): string =>
  `${nonce}.${historyId(save)}`;

/** 保存した nonce を読む。無い・形が違う・読めなければ null。 */
export function loadPlayNonce(): string | null {
  try {
    const v = localStorage.getItem(PLAY_NONCE_KEY);
    return isPlayNonce(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * nonce を書く（null なら消す）。書けなくても遊べる（再読み込みで nonce が替わるだけ）。
 * 別のプレイ（別の nonce）の開始のトークンが残っていれば一緒に消す（D-174）。
 */
export function storePlayNonce(nonce: string | null): void {
  currentNonce = nonce;
  try {
    if (nonce) localStorage.setItem(PLAY_NONCE_KEY, nonce);
    else localStorage.removeItem(PLAY_NONCE_KEY);
  } catch {
    // 保存領域が使えない環境では何もしない
  }
  if (nonce === null || readPlayToken()?.nonce !== nonce) clearPlayToken();
}

// 開始のトークン（D-174・prd/15 §4）。新しいプレイを始めるときに集計のサーバーから受け取る使い捨ての番号（個人を識別しない）。
// nonce と組にして持ち、同じプレイの送信にだけ添える（再開しても同じトークン・別のプレイには使わない）。
// localStorage が使えない・書き込みだけ失敗する環境でも、開いている間はメモリに持つ（OCL-07814537）。
// 取りに行った後に別のプレイを始めていたら、遅れて届いた応答は捨てる（OCL-DE27A041）。

/** 開始のトークンの localStorage のキー（infra-supra: で始まるので、ローカルの記録の消去でも消える）。 */
export const PLAY_TOKEN_KEY = 'infra-supra:play-token';

/** packages/stats の PLAY_TOKEN_PATTERN と同じ形（32 バイトの base64url）。 */
export const STATS_PLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type StoredToken = { nonce: string; token: string };
let memoToken: StoredToken | null = null;
/** memoToken を localStorage に書けなかった（読み出しはメモリを優先する）。 */
let memoUnsaved = false;
/** 今のプレイの nonce（storePlayNonce が最後に書いた値。このタブの中だけ）。 */
let currentNonce: string | null = null;

function readPlayToken(): StoredToken | null {
  if (memoToken && memoUnsaved) return memoToken;
  try {
    const raw = localStorage.getItem(PLAY_TOKEN_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (
      typeof v === 'object' &&
      v !== null &&
      isPlayNonce((v as StoredToken).nonce) &&
      typeof (v as StoredToken).token === 'string' &&
      STATS_PLAY_TOKEN_PATTERN.test((v as StoredToken).token)
    )
      return {
        nonce: (v as StoredToken).nonce,
        token: (v as StoredToken).token,
      };
    return null;
  } catch {
    return memoToken;
  }
}

/** そのプレイ（nonce）の開始のトークン。無ければ null（取りに行かなかった・失敗した・別のプレイのもの）。 */
export function loadPlayToken(nonce: string): string | null {
  const v = readPlayToken();
  return v?.nonce === nonce ? v.token : null;
}

/**
 * 開始のトークンを nonce と組にして書く。nonce が今のプレイのものでなければ書かない（取りに行った後に別のプレイを始めていた。
 * 遅れて届いた古い応答で今のプレイのトークンを上書きしない。OCL-DE27A041）。
 */
export function storePlayToken(nonce: string, token: string): void {
  if (nonce !== currentNonce) return;
  memoToken = { nonce, token };
  try {
    localStorage.setItem(PLAY_TOKEN_KEY, JSON.stringify(memoToken));
    memoUnsaved = false;
  } catch {
    // 書けない環境（容量の上限など）ではメモリにだけ持ち、読み出しもメモリから（OCL-07814537）
    memoUnsaved = true;
  }
}

function clearPlayToken(): void {
  memoToken = null;
  memoUnsaved = false;
  try {
    localStorage.removeItem(PLAY_TOKEN_KEY);
  } catch {
    // 保存領域が使えない環境では何もしない
  }
}
