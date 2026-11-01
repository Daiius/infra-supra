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
| [prd/06-frameworks.md](./prd/06-frameworks.md) | 見積対象のフレームワーク（Vite・Next.js・vinext・Astro（§6）・Next.js の静的書き出し（§7））とビルド出力の中間表現・ホストへの写し方 |
| [prd/07-game-design.md](./prd/07-game-design.md) | ゲームデザイン（試作への指摘から決めた満足度・開発の手間・出来事・部品の選択・推移と見込み・評価）と実装の順序 GD-1〜5 |
| [prd/08-roadmap.md](./prd/08-roadmap.md) | フェーズの状態（済み・残り）・見積モードの今の形・Phase 1 のタスク分解 |
| [prd/09-scenario-contract.md](./prd/09-scenario-contract.md) | 2 本目のシナリオ: 受託先の業務アプリの運用（受託は設定だけ・運用費に集中。D-33） |
| [prd/10-framework-branch.md](./prd/10-framework-branch.md) | フレームワークの分岐（Vite の SPA か Next.js か）と API の置き場（確定 D-34。段 1〜3・API の応答のキャッシュ・Astro の API の置き場まで実装済み。D-37・D-65・D-67・D-69） |
| [prd/11-aws-and-cross-provider.md](./prd/11-aws-and-cross-provider.md) | AWS（Amplify・OpenNext）・事業者をまたぐ構成（画像だけ Cloudflare など）・CloudFront の定額・Netlify・Neon（論点 AX-01〜14 は D-50 で決定し、実装済み。D-51・D-52・D-61・D-63・D-66・D-71・D-77） |
| [prd/12-external-scenarios-and-ranking.md](./prd/12-external-scenarios-and-ranking.md) | 外部のシナリオ（JSON + zod・ファイル / URL の読み込み）と、再生による検証のランキング（**下書き・未実装・未決 ES-01〜16**） |

> 決定ログと未決の論点: [`prd/_grilling/decisions.md`](./prd/_grilling/decisions.md)（未決の一覧は末尾の「未決」の節）

## 技術スタック / 構成

- フルスタック TypeScript の **pnpm monorepo**。テストは vitest。
- **Front**: React 19 + Vite + TailwindCSS v4 + daisyUI。サーバーなし・ローカル保存（[prd/02](./prd/02-architecture.md) §4〜5）。
  ルーターはまだ入れていない（画面はゲーム・見積の 2 つで、ヘッダーのタブで切り替える。TanStack Router は画面が増えたら。D-73）。グラフは `packages/web/src/charts.tsx` の自前の SVG。

### パッケージ

| パッケージ | 役割 |
|---|---|
| [`packages/estimator`](./packages/estimator) | 見積エンジン（workload / architecture / resource / pricing / performance）と zod スキーマ。**環境非依存**（`lib: esnext` / `types: []`）。他パッケージに依存しない |
| [`packages/catalog`](./packages/catalog) | 料金データ（`src/providers/`: Cloudflare・Vercel・Supabase・さくらの VPS・AWS・Netlify・Neon。出典つき・版付き）・フレームワーク（Next.js・Vite の SPA・Astro・Next.js の静的書き出し）・テンプレート・構成スタック（`src/stacks/`。事業者をまたぐ部品は `cross.ts`）・日本の消費税（`src/tax/`）。estimator の型だけに依存 |
| [`packages/game`](./packages/game) | ゲームエンジン。純粋関数・シード付き乱数。ゲームのバランスの値と出来事はシナリオのデータ `src/scenarios/`（記事コミュニティ・受託の業務アプリ。ゲーム上の仮定。prd/07 §10・prd/09）。見積モードと数え方をそろえる口（`estimate-mode.ts`） |
| [`packages/web`](./packages/web) | 画面（Vite + React + Tailwind v4 + daisyUI）。ゲームモード（始める画面・月の報告・推移・ヒント）と見積モード（`?mode=estimate`。明細・構成の比較・費用の曲線・席・税込の目安。`src/estimate/`。D-73〜D-76。今の形は [prd/08](./prd/08-roadmap.md)「見積モードの今の形」） |

依存の向きは [prd/02](./prd/02-architecture.md) §1（web → game → catalog → estimator。web は catalog・estimator も直接呼ぶ）。

## 守ること

- 🔒 **出典を確認していない数値を、実在の料金・制限のように書かない。** 実在の料金は公式の料金表を一次情報にし、
  出典 URL と取得日を付ける。テスト用の架空料金は provider ID を `fictional-` で始める（`status: 'fictional'`。スキーマが ID と status の一致を検査する）
  （[prd/03](./prd/03-pricing-schema.md) §1・§10）。置き場は `packages/catalog/src/fictional/`（`catalog/fictional` で読む。本番の `loadPriceBooks` には入れない）。
  estimator の単体テストは依存の向き上 catalog を読めないので、`packages/estimator/src/pricing/fixtures.test-helpers.ts` と生成器（`random.test-helpers.ts`）の架空データを使う（D-78）。
- 見積対象のフレームワーク・構成を特定のスタックに寄せない。フレームワーク固有の扱いは FrameworkProfile / DeployTarget のデータに閉じ込める（[prd/06](./prd/06-frameworks.md)）。
- 金額・使用量は number で計算し、課金の切り上げは `ceilUnits` だけを使う（`Math.ceil` を直接使わない）。丸めは表示のときだけ（[prd/02](./prd/02-architecture.md) §3）。
- estimator・catalog・game の計算は純粋関数にする（時刻・乱数・I/O に触れない。乱数はシードを引数で受ける）。

## 開発コマンド

```bash
pnpm install
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm test         # 全パッケージ vitest run
pnpm format       # prettier（*.md は対象外）
pnpm format:check # prettier の検査だけ（書き換えない）
pnpm dev          # web を 127.0.0.1:5173 で起動
pnpm dev:remote   # web を .env.remote の設定で起動（Cloudflare Tunnel 越しの確認用）
pnpm play         # ゲームのスパイク（spikes/game-2026-10-31。今の packages/game より前の形）をターミナルで遊ぶ
pnpm hooks:install # clone 後に一度だけ（下の「git hooks」）
```

### リモート dev（Cloudflare Tunnel 越し）

ローカルと設定を分けず、差分は `.env.remote`（gitignore 対象）だけに集約する。`cp .env.remote.example .env.remote` で値を埋める。

- `WEB_BIND`: web(Vite) の待ち受け。`127.0.0.1` の 1 ポートだけにし、cloudflared をここへ向ける。
- `DEV_ALLOWED_HOST`: 公開ホスト名。Vite の `allowedHosts` と、HMR の `wss://<host>:443` に使う（ローカルから開くと HMR だけ失敗するのは想定どおり）。
- トンネル側（公開ホスト名 → `http://localhost:<WEB_BIND のポート>`、Access の制限）は Cloudflare のダッシュボードで設定する。実ドメインは公開文書に書かない。
- パッケージをまたぐ変更（estimator・catalog・game）が画面に反映されないときは、`packages/web/vite.config.ts` の `watchWorkspacePackages` を確かめるか、開発サーバーを再起動する。
- API・DB がないので compose は使わない（必要になったら seseraki と同じく compose を env で切り替える形にする）。

## 秘密の検査（Betterleaks）

public リポジトリなので、秘密（トークン・`.env*` など）のコミットを push の前と CI で止める。規則は [`.betterleaks.toml`](./.betterleaks.toml)
（組み込みの規則 + `.env*` をファイル名で止める規則。`.example` などの雛形は通す）。**設定は自動では読まれないので、`betterleaks` を直接叩くときは `--config .betterleaks.toml` を渡す。**

- push 前: [`.githooks/pre-push`](./.githooks/pre-push) が、送るコミットだけを検査して止める（betterleaks が無いホストでは警告してスキップ）。
  範囲は新しいブランチなら origin の他のブランチに無いコミットだけで、手元の 2 段目の網。CI が毎回全履歴を見るので取りこぼしはそちらで拾う。
  merge commit にだけ足した内容と内容を変えない改名も見るよう、`--diff-merges=separate --no-renames` を渡している（CI も同じ）。
- CI: [`.github/workflows/secret-scan.yml`](./.github/workflows/secret-scan.yml)（全ブランチの push と PR。範囲を計算せず毎回全履歴・全 ref を検査する）。バイナリは checksums.txt と照合して取得する。最終の砦。
- pre-commit の検査は、ホストのグローバル hook（`hook.betterleaks`）に任せ、リポジトリ側では持たない。

### git hooks（git 2.55+ の config ベース hooks）

**clone 後に `pnpm hooks:install` を一度だけ実行する。** [`.githooks/install.sh`](./.githooks/install.sh) が
[`.githooks.gitconfig`](./.githooks.gitconfig) を `include.path` で冪等に登録する。
`pnpm install` の `prepare` には相乗りさせない（install は CI など git と無関係な環境でも走るため。叩き忘れても壊れるのはローカルの hooks だけで、CI が砦）。

## Git / PR 運用

- **レビュー中の PR は追加コミットを積む**。`git commit --amend` + `git push --force` はしない。
- マージは **merge commit**（2026-11-01 に推奨案で決定）。作業ブランチを積み重ねるため、squash だと上の段の rebase で衝突が増える。D-番号ごとのコミットを履歴に残す。
- PR は oculibis のレビューの指摘がゼロになってからマージする。

## ローカル専用メモ（存在すれば読む）

`.claude-personal/CLAUDE.md`（gitignore 対象）が**存在する場合は、セッション開始時に必ず読む**。
