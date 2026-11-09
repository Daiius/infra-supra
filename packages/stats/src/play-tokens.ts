// 開始のトークン（D-174・prd/15 §5.5）。大量の送信だけを止めるための使い捨ての番号で、個人の情報を含まない（IP は使わない）。
// - `POST /api/plays` で発行し、置き場に「値 = 発行時刻（ミリ秒）」・TTL つきで置く。
// - 送信のときに原子的に取り出して消す（使い捨て）。発行から送信までが短すぎる送信は、保存はするが分布に入れない。
// 置き場は interface にし、本番は Redis（ioredis）、開発・テストはメモリ上の実装（実の Redis を使わない）。
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** トークンを置いておく時間（人のプレイは 5〜10 分。D-174 でユーザーが 7 日から 1 日にした）。 */
export const PLAY_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** 発行から送信までの下限（遊んだ月の数 × この秒数より短い送信は分布に入れない）。 */
export const MIN_SECONDS_PER_MONTH = 3;

/** 同じ結果（play_hash）が直近のこの時間に分布に入った件数を数える。 */
export const DUP_CAP_WINDOW_MS = 60 * 60 * 1000;

/** 同じ結果がこの件数だけ分布に入っていたら、それより後の送信は分布に入れない。 */
export const DUP_CAP_MAX = 3;

/** トークンの形（32 バイトの乱数の base64url）。 */
export const PLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newPlayToken = (): string => randomBytes(32).toString('base64url');

export interface PlayTokenStore {
  /** トークンを置く（値は発行時刻・ミリ秒）。 */
  put(token: string, issuedAt: number): Promise<void>;
  /** トークンを取り出して消す（原子的・使い捨て）。無い・期限切れ・使い済みなら null。 */
  take(token: string): Promise<number | null>;
}

const KEY_PREFIX = 'infra-supra:play-token:';

/** Redis の実装。取り出しは MULTI の GET + DEL（GETDEL の無い古い Redis でも原子的に動く）。 */
export function redisTokenStore(
  redis: Redis,
  ttlSeconds = PLAY_TOKEN_TTL_SECONDS,
): PlayTokenStore {
  return {
    async put(token, issuedAt) {
      await redis.set(KEY_PREFIX + token, String(issuedAt), 'EX', ttlSeconds);
    },
    async take(token) {
      const res = await redis
        .multi()
        .get(KEY_PREFIX + token)
        .del(KEY_PREFIX + token)
        .exec();
      const [err, value] = res?.[0] ?? [new Error('MULTI が中断されました')];
      if (err) throw err;
      const n = Number(value);
      return typeof value === 'string' && Number.isFinite(n) ? n : null;
    },
  };
}

/** メモリ上の実装（テスト・開発用。期限は now で見る）。 */
export function memoryTokenStore(
  now: () => number = Date.now,
  ttlSeconds = PLAY_TOKEN_TTL_SECONDS,
): PlayTokenStore & { tokens: Map<string, number> } {
  const tokens = new Map<string, number>();
  return {
    tokens,
    async put(token, issuedAt) {
      tokens.set(token, issuedAt);
    },
    async take(token) {
      const issuedAt = tokens.get(token);
      tokens.delete(token);
      if (issuedAt === undefined || now() - issuedAt >= ttlSeconds * 1000)
        return null;
      return issuedAt;
    },
  };
}
