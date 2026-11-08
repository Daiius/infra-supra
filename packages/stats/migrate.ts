// drizzle/*/migration.sql を順に当てる（drizzle-orm の migrator。seseraki の packages/server/migrate.ts に倣う）。
// 🔒 管理ロール（DDL。DB_ADMIN_USER / DB_ADMIN_PASSWORD）で流す。常駐のサーバーのロールには DDL の権限が無い。
// 本番はイメージに同梱した /app/migrate.js を使い捨てのコンテナで流す（適用する SQL とコードの版がずれない）。
// ⚠ パッケージの直下に置く（./drizzle をこのファイルからの相対で解く。dev では packages/stats/drizzle、バンドル後は /app/drizzle）。
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { connectionConfig, createDb } from './src/db/connection.ts';

const migrationsFolder = fileURLToPath(new URL('./drizzle', import.meta.url));
const client = new pg.Pool({ ...connectionConfig('admin'), max: 1 });

try {
  await migrate(createDb(client), { migrationsFolder });
  console.log('migrations applied (up to date)');
  await client.end();
  process.exit(0);
} catch (err) {
  // message だけでは本当の理由（権限・型）が cause に隠れるので、Error ごと出す
  console.error(err);
  process.exit(1);
}
