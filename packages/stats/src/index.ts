// 集計のサーバーの起動（node の常駐プロセス。D-135）。接続先・資格情報・ポートは環境変数だけから読む（packages/stats/.env.example）。
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import pg from 'pg';
import { connectionConfig, createDb } from './db/connection.ts';
import { drizzleRepo } from './db/repo.ts';
import {
  memoryTokenStore,
  redisTokenStore,
  type PlayTokenStore,
} from './play-tokens.ts';
import { buildVersionFromEnv, createApp } from './route.ts';

/**
 * 開始のトークンの置き場（D-174）。REDIS_URL があれば Redis。無ければ、本番（NODE_ENV=production。Dockerfile.prod が立てる）は
 * 起動を止める（黙って全部の送信をトークン無しの扱いにしない）。開発（`pnpm dev`）だけメモリ上の置き場で動かす（再起動で消える）。
 */
function tokenStoreFromEnv(env: NodeJS.ProcessEnv): PlayTokenStore {
  const url = env.REDIS_URL?.trim();
  if (url) {
    // 繋がらないときに送信を長く待たせない（失敗した送信は 500。画面は何も出さない）
    const redis = new Redis(url, { maxRetriesPerRequest: 2 });
    // 接続の失敗は ioredis が繰り返し試す。文には接続先を出さない
    redis.on('error', (e: Error) =>
      console.error(`redis: ${e.name}: ${(e as { code?: string }).code ?? ''}`),
    );
    return redisTokenStore(redis);
  }
  if (env.NODE_ENV === 'production')
    throw new Error(
      'REDIS_URL が未設定です（本番では開始のトークンの置き場が要ります）',
    );
  console.warn(
    'REDIS_URL が無いので、開始のトークンをメモリに置きます（開発用）',
  );
  return memoryTokenStore();
}

const pool = new pg.Pool(connectionConfig('server'));
const app = createApp({
  repo: drizzleRepo(createDb(pool)),
  tokens: tokenStoreFromEnv(process.env),
  version: buildVersionFromEnv(process.env),
});
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stats server listening on port ${info.port}`);
});
