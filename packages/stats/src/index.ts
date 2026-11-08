// 集計のサーバーの起動（node の常駐プロセス。D-135）。接続先・資格情報・ポートは環境変数だけから読む（packages/stats/.env.example）。
import { serve } from '@hono/node-server';
import pg from 'pg';
import { connectionConfig, createDb } from './db/connection.ts';
import { drizzleRepo } from './db/repo.ts';
import { buildVersionFromEnv, createApp } from './route.ts';

const pool = new pg.Pool(connectionConfig('server'));
const app = createApp({
  repo: drizzleRepo(createDb(pool)),
  version: buildVersionFromEnv(process.env),
});
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stats server listening on port ${info.port}`);
});
