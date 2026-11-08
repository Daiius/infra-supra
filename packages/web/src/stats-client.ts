// 集計のサーバー（packages/stats。Hono RPC）への送信（D-134・D-152・prd/15 §4）。web はサーバーの型（AppType）だけを読む。
// seseraki の packages/web/src/lib/honoClient.ts に倣い、ベースはオリジンの根（''）。/api/* は Vercel が同じオリジンで中継する（D-139）。
//
// - 送るのは VITE_STATS_ENABLED が立っているときだけ（サーバーが無い間に 404 を出し続けない）。
// - 終わったプレイ（完走・途中終了）を 1 プレイ 1 回だけ送る（手元の履歴に新しく足したとき。App.tsx）。
// - 失敗しても画面には何も出さず、送り直さない。サーバーも同じプレイを 1 行にする（playHash）。
// - 送るもの: 始めたときの選択・行動の列（前の試行は除く）・4 軸・終わり方。名前・IP・端末の情報は送らない（本文に入れない）。
import {
  resultAxesOf,
  withoutPrevious,
  type GameState,
  type SaveData,
} from 'game';
import { hc } from 'hono/client';
import type { AppType } from 'stats';

/** 送信を有効にする環境変数が立っているか（呼ぶたびに読む。テストで差し替えられる）。 */
export function statsEnabled(): boolean {
  const v = import.meta.env.VITE_STATS_ENABLED;
  return v === 'true' || v === '1';
}

// Hono RPC の型推論が遠いモジュールを参照しがちなので、一度型だけ取り出して付け直す（TS2742 の回避。seseraki と同じ）
type Client = ReturnType<typeof hc<AppType>>;

let client: Client | undefined;
const statsClient = (): Client =>
  (client ??= hc<AppType>('', {
    // 呼ぶときの fetch を使う（テストが差し替えた fetch も効く）。cookie は送らない
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'omit' }),
  }));

/** 送る中身（prd/15 §4）。 */
export function submissionOf(save: SaveData, state: GameState) {
  return {
    save: withoutPrevious(save),
    axes: resultAxesOf(state),
    end: state.end!,
  };
}

/**
 * 終わったプレイを送る。送らなかった・失敗したときも例外を出さない（画面を壊さない）。
 * 戻り値は送ったか（応答の状態は問わない）。
 */
export async function submitResult(
  save: SaveData,
  state: GameState,
): Promise<boolean> {
  if (!statsEnabled() || state.phase === 'playing' || !state.end) return false;
  try {
    await statsClient().api.results.$post({ json: submissionOf(save, state) });
    return true;
  } catch {
    return false;
  }
}
