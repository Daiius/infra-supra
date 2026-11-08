import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit の設定（**生成専用**。seseraki に倣う）。
 * - `pnpm --filter stats db:generate` … schema.ts の差分から drizzle/<ts>_<name>/migration.sql を作る（DB には繋がない）
 * - 適用は drizzle-kit ではなく migrate.ts（drizzle-orm の migrator）。`drizzle-kit push` は使わない。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
