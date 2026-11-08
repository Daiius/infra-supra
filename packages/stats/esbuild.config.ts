// 本番のバンドル（seseraki の packages/server/esbuild.config.ts に倣う）。dist/server.js と dist/migrate.js を作る。
// game・catalog・estimator はワークスペースの TypeScript のままバンドルに入る。
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const entryPoints = {
  server: './src/index.ts',
  migrate: './migrate.ts',
};

await build({
  entryPoints,
  outdir: './dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  sourcemap: false,
  // バンドルに入る CJS の依存（pg など）が require などを使うので ESM の出力に用意する（名前は衝突しないよう接頭辞つき）
  banner: {
    js: `
import { createRequire as __esbuildCreateRequire } from 'module';
import { fileURLToPath as __esbuildFileURLToPath } from 'url';
import { dirname as __esbuildDirname } from 'path';
const require = __esbuildCreateRequire(import.meta.url);
const __filename = __esbuildFileURLToPath(import.meta.url);
const __dirname = __esbuildDirname(__filename);
`,
  },
});

// 生成物を Node の構文解析に通す（banner の衝突は esbuild が見つけられない）。実行はしないので DB には繋がない
for (const name of Object.keys(entryPoints)) {
  const file = `./dist/${name}.js`;
  const { status, stderr } = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });
  if (status !== 0) {
    console.error(`syntax check failed: ${file}\n${stderr}`);
    process.exit(1);
  }
}
console.log('Build completed successfully!');
