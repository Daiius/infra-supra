// ローカルと remote（Cloudflare Tunnel 越し）で設定を分けず、差分は env（リポジトリ直下の .env.remote）だけに集約する。
//   pnpm dev          → 127.0.0.1:5173
//   pnpm dev:remote   → vite --mode remote が .env.remote を読む（WEB_BIND・DEV_ALLOWED_HOST）
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * root（packages/web）の外にあるワークスペースのパッケージの src を、開発サーバーの監視に足す。
 * 理由: 監視していないと、estimator・catalog・game の変更（ブランチの切り替えを含む）が反映されず、
 * 古いモジュールが配信され続けた（App.tsx だけ新しく「does not provide an export named …」で画面が白くなった）。
 * `server.watcher` は chokidar の FSWatcher で、`add` に足したパスを監視する（vite 8 の型定義 ViteDevServer.watcher・FSWatcher.add）。
 * src だけを足すので node_modules は監視しない。
 */
function watchWorkspacePackages(): Plugin {
  return {
    name: 'watch-workspace-packages',
    configureServer(server) {
      server.watcher.add(
        ['estimator', 'catalog', 'game'].map((p) =>
          fileURLToPath(new URL(`../${p}/src`, import.meta.url)),
        ),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const [bindHost = '127.0.0.1', bindPort = '5173'] = (
    env.WEB_BIND ?? '127.0.0.1:5173'
  ).split(':');
  const publicHost = env.DEV_ALLOWED_HOST;
  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss(), watchWorkspacePackages()],
    server: {
      host: bindHost,
      port: Number(bindPort),
      strictPort: true,
      ...(publicHost
        ? {
            // 公開ホスト名からのアクセスを許可し、HMR は前段（https）越しの wss:443 で張る
            allowedHosts: [publicHost],
            hmr: {
              protocol: 'wss',
              host: publicHost.replace(/^\./, ''),
              clientPort: 443,
            },
          }
        : {}),
    },
  };
});
