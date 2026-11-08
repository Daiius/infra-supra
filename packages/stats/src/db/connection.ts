// Postgres への接続（seseraki の packages/server/src/db/connection.ts に倣う）。プールは作らない（作るのは index.ts と migrate.ts）。
// 🔒 接続先・資格情報は環境変数だけから読む（実値は公開リポジトリに書かない。雛形は packages/stats/.env.example）。
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

/**
 * ロール: server は常駐のサーバー（DML だけ。results への INSERT・SELECT）、admin は migration（DDL）。
 * 常駐のサーバーに DDL の権限を持たせない。
 */
export type DbRole = 'server' | 'admin';

/** ロールごとの資格情報の環境変数の接頭辞（<接頭辞>_USER・<接頭辞>_PASSWORD）。 */
const CREDENTIAL_PREFIX: Record<DbRole, string> = {
  server: 'DB',
  admin: 'DB_ADMIN',
};

export function connectionConfig(
  role: DbRole,
  env: Record<string, string | undefined> = process.env,
): pg.PoolConfig {
  const prefix = CREDENTIAL_PREFIX[role];
  const user = env[`${prefix}_USER`];
  const password = env[`${prefix}_PASSWORD`];
  if (!user || !password)
    throw new Error(`${prefix}_USER / ${prefix}_PASSWORD が未設定です`);
  return {
    host: env.DB_HOST ?? 'localhost',
    port: env.DB_PORT ? Number(env.DB_PORT) : 5432,
    database: env.DB_NAME ?? 'infra_supra',
    user,
    password,
  };
}

export function createDb(client: pg.Pool) {
  return drizzle({ client });
}
