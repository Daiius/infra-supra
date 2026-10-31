# AGENTS.md

> このファイルがリポジトリの**正典**です（使用する各コーディングエージェント共通）。簡潔・リンク中心に保つこと。
> 詳細仕様は [`prd/`](./prd/) を参照。

## プロジェクト目的

実在するクラウド／ホスティングの料金体系で、Web アプリのインフラ構成ごとの月額費用と性能上の制約を比べる。
同じ計算エンジンの上に **見積モード**（単独のツールとして切り出せる完成度が目標）と **ゲームモード**（月単位のターンで運営）を載せる。
→ 詳細は [`prd/README.md`](./prd/README.md)。企画書の原文は [`prd/00-concept.md`](./prd/00-concept.md)（正典ではない）。

## ドキュメント（PRD）

| 文書 | 内容 |
|---|---|
| [prd/README.md](./prd/README.md) | 目的 / 設計の柱 / スコープ / 索引 / 用語 |
| [prd/01-domain-model.md](./prd/01-domain-model.md) | ドメインモデルと計算の流れ（出所・Workload・Architecture・Usage・Bill・Estimate・判断ポイント） |
| [prd/02-architecture.md](./prd/02-architecture.md) | パッケージと依存の向き / 環境非依存 / 数値と決定論 / 技術スタック / 永続化 |
| [prd/03-pricing-schema.md](./prd/03-pricing-schema.md) | 料金データのスキーマ（無料枠プール・メーター・段階料金・クレジット・制限・出典） |
| [prd/04-resource-simulation.md](./prd/04-resource-simulation.md) | Workload → リソース消費量の変換仕様 |
| [prd/05-test-strategy.md](./prd/05-test-strategy.md) | テスト設計（架空料金の扱い・料金計算・性質ベースのテスト・golden） |
| [prd/06-frameworks.md](./prd/06-frameworks.md) | 見積対象のフレームワーク（Vite・Next.js・vinext、次に Astro）とビルド出力の中間表現・ホストへの写し方 |
| [prd/07-game-design.md](./prd/07-game-design.md) | ゲームデザイン（試作への指摘から決めた満足度・開発の手間・出来事・部品の選択・推移と見込み・評価）と実装の順序 GD-1〜5 |
| [prd/08-roadmap.md](./prd/08-roadmap.md) | フェーズと Phase 1 のタスク分解 |

> 決定ログと未決の論点: [`prd/_grilling/decisions.md`](./prd/_grilling/decisions.md)

## 技術スタック / 構成

- フルスタック TypeScript の **pnpm monorepo**。テストは vitest。
- **Front**（Phase 2〜）: React 19 + Vite + TanStack Router + TailwindCSS v4 + daisyUI。サーバーなし・ローカル保存（[prd/02](./prd/02-architecture.md) §4〜5）。

### パッケージ

| パッケージ | 役割 |
|---|---|
| [`packages/estimator`](./packages/estimator) | 見積エンジン（workload / architecture / resource / pricing / performance）と zod スキーマ。**環境非依存**（`lib: esnext` / `types: []`）。他パッケージに依存しない |
| [`packages/catalog`](./packages/catalog) | サービスカタログと料金データ（プロバイダー別・版付き）・テンプレート・構成スタック。estimator の型だけに依存 |

| [`packages/game`](./packages/game) | ゲームエンジン（最初の形。spikes/game-2026-10-31 から移した）。純粋関数・シード付き乱数。ゲームのバランスの値と出来事はシナリオのデータ `src/scenarios/`（ゲーム上の仮定。prd/07 §10） |
| [`packages/web`](./packages/web) | 画面（Vite + React + Tailwind v4 + daisyUI）。今はゲームモードの試作だけ |

依存の向きは [prd/02](./prd/02-architecture.md) §1（web → game → estimator ← catalog）。

## 守ること

- 🔒 **出典を確認していない数値を、実在の料金・制限のように書かない。** 実在の料金は公式の料金表を一次情報にし、
  出典 URL と取得日を付ける。テスト用の架空料金は `packages/catalog/src/fictional/` に置き、provider ID を `fictional-` で始める
  （[prd/03](./prd/03-pricing-schema.md) §1・§10）。
- 見積対象のフレームワーク・構成を特定のスタックに寄せない。フレームワーク固有の扱いは FrameworkProfile / DeployTarget のデータに閉じ込める（[prd/06](./prd/06-frameworks.md)）。
- 金額・使用量は number で計算し、課金の切り上げは `ceilUnits` だけを使う（`Math.ceil` を直接使わない）。丸めは表示のときだけ（[prd/02](./prd/02-architecture.md) §3）。
- estimator・catalog・game の計算は純粋関数にする（時刻・乱数・I/O に触れない。乱数はシードを引数で受ける）。

## 開発コマンド

```bash
pnpm install
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm test         # 全パッケージ vitest run
pnpm format       # prettier（*.md は対象外）
pnpm dev          # web を 127.0.0.1:5173 で起動
pnpm dev:remote   # web を .env.remote の設定で起動（Cloudflare Tunnel 越しの確認用）
pnpm play         # ゲームのスパイクをターミナルで遊ぶ
```

### リモート dev（Cloudflare Tunnel 越し）

ローカルと設定を分けず、差分は `.env.remote`（gitignore 対象）だけに集約する。`cp .env.remote.example .env.remote` で値を埋める。

- `WEB_BIND`: web(Vite) の待ち受け。`127.0.0.1` の 1 ポートだけにし、cloudflared をここへ向ける。
- `DEV_ALLOWED_HOST`: 公開ホスト名。Vite の `allowedHosts` と、HMR の `wss://<host>:443` に使う（ローカルから開くと HMR だけ失敗するのは想定どおり）。
- トンネル側（公開ホスト名 → `http://localhost:<WEB_BIND のポート>`、Access の制限）は Cloudflare のダッシュボードで設定する。実ドメインは公開文書に書かない。
- パッケージをまたぐ変更（estimator・catalog・game）が画面に反映されないときは、`packages/web/vite.config.ts` の `watchWorkspacePackages` を確かめるか、開発サーバーを再起動する。
- API・DB がないので compose は使わない（必要になったら seseraki と同じく compose を env で切り替える形にする）。

## Git / PR 運用

- **レビュー中の PR は追加コミットを積む**。`git commit --amend` + `git push --force` はしない。
- マージ手法は未決（初回の PR までに決める）。

## ローカル専用メモ（存在すれば読む）

`.claude-personal/CLAUDE.md`（gitignore 対象）が**存在する場合は、セッション開始時に必ず読む**。
