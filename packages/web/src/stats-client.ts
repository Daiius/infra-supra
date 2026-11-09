// 集計のサーバー（packages/stats。Hono RPC）への送信（D-134・D-152・prd/15 §4）。web はサーバーの型（AppType）だけを読む。
// seseraki の packages/web/src/lib/honoClient.ts に倣い、ベースはオリジンの根（''）。/api/* は Vercel が同じオリジンで中継する（D-139）。
//
// - 送るのは VITE_STATS_ENABLED が立っているときだけ（サーバーが無い間に 404 を出し続けない）。
// - 終わったプレイ（完走・途中終了）を 1 プレイ 1 回だけ送る（手元の履歴に新しく足したとき。App.tsx）。
// - 失敗しても画面には何も出さず、送り直さない。サーバーも同じプレイを 1 行にする（playId。D-169）。
// - 送るもの: プレイの id（プレイごとのランダムな nonce と手元の履歴の id。端末や人を識別しない）・始めたときの選択・
//   行動の列（前の試行は除く）・4 軸・終わり方。名前・IP・端末の情報は送らない（本文に入れない）。
// - 開始のトークン（D-174）: 新しいプレイを始めるときに取りに行き（requestPlayToken）、送信に添える。失敗しても遊べる
//   （トークン無しで送る。サーバーは保存するが分布に入れない）。
// - 分布（段 3・D-161）: 完走したら、送信が終わった後に 4 軸 × 2 の分布を 1 回で取る（fetchDistribution）。
import {
  RESULT_AXES,
  resultAxesOf,
  withoutPrevious,
  type GameState,
  type ResultAxes,
  type SaveData,
} from 'game';
import { hc } from 'hono/client';
import {
  loadPlayToken,
  statsPlayId,
  STATS_PLAY_TOKEN_PATTERN,
  storePlayToken,
} from './play-nonce.ts';
import type { AppType, Distribution } from 'stats';
import {
  membershipOf,
  parseMembership,
  standingsOf,
  STATS_MEMBERSHIP_KEY,
  withMembership,
  type StatsView,
} from './distribution.ts';

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

/** 送る中身（prd/15 §4）。nonce は play-nonce.ts（D-169）。token は開始のトークン（無ければ欄ごと付けない。D-174）。 */
export function submissionOf(
  save: SaveData,
  state: GameState,
  nonce: string,
  token: string | null = null,
) {
  return {
    playId: statsPlayId(nonce, save),
    ...(token ? { token } : {}),
    save: withoutPrevious(save),
    axes: resultAxesOf(state),
    end: state.end!,
  };
}

/**
 * 新しいプレイの開始のトークンを取りに行き、nonce と組にして持つ（D-174）。フラグが無い・開発用の架空の分布のときは取りに行かない。
 * 失敗しても何もしない（例外を出さない。トークン無しで送るだけ）。
 */
export async function requestPlayToken(nonce: string): Promise<void> {
  if (statsMockEnabled() || !statsEnabled()) return;
  try {
    const res = await statsClient().api.plays.$post();
    if (!res.ok) return;
    const body: unknown = await res.json().catch(() => null);
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token === 'string' && STATS_PLAY_TOKEN_PATTERN.test(token))
      storePlayToken(nonce, token);
  } catch {
    // 取れなくても遊べる
  }
}

/**
 * 送信の結末。included はサーバーが保存し、保存されている行が分布に入る（同じ結果の行がすでにあった duplicate は、その行の印で決まる）。
 * excluded は保存されたが分布に入らない（戻った印つきの行が先にあったなど。OCL-9B705B16）。rejected は 4xx・5xx、
 * failed は通信の失敗、skipped は送らなかった（フラグが無い・終わっていない）。
 */
export type SubmitOutcome =
  'included' | 'excluded' | 'rejected' | 'failed' | 'skipped';

/**
 * 終わったプレイを送る。送らなかった・失敗したときも例外を出さない（画面を壊さない）。
 * 戻り値は結末（分布に自分が入っているかの判断に使う。D-162）。
 */
export async function submitResult(
  save: SaveData,
  state: GameState,
  nonce: string,
): Promise<SubmitOutcome> {
  // 開発用の架空の分布を出している間は、フラグがあっても送らない（開発のプレイを集計に混ぜない。OCL-87C871FB）
  if (
    statsMockEnabled() ||
    !statsEnabled() ||
    state.phase === 'playing' ||
    !state.end
  )
    return 'skipped';
  try {
    const res = await statsClient().api.results.$post({
      json: submissionOf(save, state, nonce, loadPlayToken(nonce)),
    });
    if (!res.ok) return 'rejected';
    const body: unknown = await res.json().catch(() => null);
    return (body as { inHistogram?: unknown } | null)?.inHistogram === true
      ? 'included'
      : 'excluded';
  } catch {
    return 'failed';
  }
}

/** 応答の形をおおまかに確かめる（版のずれた応答で画面を壊さない）。 */
function isDistribution(x: unknown): x is Distribution {
  if (typeof x !== 'object' || x === null) return false;
  const axes = (x as { axes?: unknown }).axes;
  if (typeof axes !== 'object' || axes === null) return false;
  return RESULT_AXES.every((a) => {
    const h = (axes as Record<string, unknown>)[a.id] as
      | {
          seed?: { count?: unknown; bins?: unknown };
          all?: { count?: unknown; bins?: unknown };
        }
      | undefined;
    return [h?.seed, h?.all].every(
      (v) => typeof v?.count === 'number' && Array.isArray(v.bins),
    );
  });
}

/**
 * 4 軸 ×（同じシード / 全シード）の分布を 1 回で取る（D-161）。フラグが無い・通信の失敗・4xx・5xx・形が違うときは null
 * （画面は手元の履歴との比較に戻る）。例外は出さない。
 */
export async function fetchDistribution(q: {
  scenarioId: string;
  seed: number;
  axes: ResultAxes;
}): Promise<Distribution | null> {
  if (!statsEnabled()) return null;
  try {
    const res = await statsClient().api.results.distribution.$get({
      query: {
        scenario: q.scenarioId,
        seed: String(q.seed),
        ...(Object.fromEntries(
          RESULT_AXES.map((a) => [a.id, String(q.axes[a.id])]),
        ) as Record<keyof ResultAxes, string>),
      },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isDistribution(body) ? body : null;
  } catch {
    return null;
  }
}

/** 送ったプレイが分布に入ったか（id → 入ったか）を読む。読めなければ undefined。 */
function loadMembership(id: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(STATS_MEMBERSHIP_KEY);
    return membershipOf(parseMembership(raw ? JSON.parse(raw) : null), id);
  } catch {
    return undefined;
  }
}

/** 送ったプレイが分布に入ったかを覚える（localStorage が使えなければ覚えない）。 */
function storeMembership(id: string, included: boolean): void {
  try {
    const raw = localStorage.getItem(STATS_MEMBERSHIP_KEY);
    let current = parseMembership(null);
    try {
      current = parseMembership(raw ? JSON.parse(raw) : null);
    } catch {
      // 壊れた値は捨てる
    }
    localStorage.setItem(
      STATS_MEMBERSHIP_KEY,
      JSON.stringify(withMembership(current, id, included)),
    );
  } catch {
    // 覚えられなくても画面は壊さない
  }
}

/** 開発用の架空の分布を使うか（`pnpm dev` で VITE_STATS_MOCK を立てたときだけ。D-164）。 */
function statsMockEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  const v = import.meta.env.VITE_STATS_MOCK;
  return v === 'true' || v === '1';
}

/** 分布を取りに行くか（取りに行かなければ段 1 の表示だけ）。 */
export const statsViewEnabled = (): boolean =>
  statsMockEnabled() || statsEnabled();

/**
 * 完走したプレイの分布の中での位置を取る（D-161・D-162）。sent は送信の結末（今回送らなかった＝前に送ったプレイの開き直しは null）。
 * 送信が終わってから取るので、保存されていれば自分は分布に入っている（included）。戻ったプレイ（rewound）は
 * ヒストグラムに入らない（D-148）ので含まない扱いにする。例外は出さない。
 */
export async function loadStatsView(q: {
  /** プレイの id（手元の履歴と同じ。分布に入ったかを開き直しのために覚える）。 */
  id: string;
  scenarioId: string;
  seed: number;
  axes: ResultAxes;
  rewound: boolean;
  sent: Promise<SubmitOutcome> | null;
}): Promise<StatsView> {
  if (statsMockEnabled()) {
    const { mockDistribution } = await import('./stats-mock.ts');
    return standingsOf(mockDistribution(q), q.axes, false, true);
  }
  if (!statsEnabled()) return { status: 'off' };
  // 送ったときは結末を覚え、開き直し（送らない）ときは覚えた結末を使う。覚えていなければ入っていない扱い
  // （送れていなかった・この形より前に送った。1 件ずれても多めに数えない。OCL-9B705B16）
  let included: boolean;
  if (q.sent) {
    const outcome = await q.sent;
    included = outcome === 'included';
    if (outcome !== 'skipped') storeMembership(q.id, included);
  } else {
    included = !q.rewound && loadMembership(q.id) === true;
  }
  const dist = await fetchDistribution(q);
  if (!dist) return { status: 'failed' };
  return standingsOf(dist, q.axes, included);
}
