# 08. ロードマップ

## フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 雛形・PRD（本文書群） | **進行中**（雛形は作成済み。PRD の未決を grill で詰める） |
| 1 | 計算エンジン（workload → usage → bill・容量の判定）と MVP 3 構成の料金データ | 計画中 |
| 2 | 見積モードの UI（テンプレート・入力・内訳・構成比較・費用曲線・JSON 保存） | 計画中 |
| 3 | ゲームエンジン（ターン・成長・イベント・収益・判定） | 最初の形と試作画面は済（`packages/game`・`packages/web`）。設計は確定（07）、07 §8 の GD-1〜5 で作り直す |
| 4 | ゲーム UI | 計画中 |
| 5 | アーキテクチャエディタ（React Flow） | 計画中 |
| 6 | 拡張（AWS・動画・WebSocket・WebRTC・性能モデル・料金の自動取得） | 計画中 |

Phase 1 が終わった時点で「CLI で見積を出して内訳を読める」状態を目指す。UI より先に計算の妥当性を確かめるため。

## Phase 1 のタスク分解

依存の順に並べる。各タスクは 1 PR を目安にする。

| # | タスク | 成果物 | 依存 |
|---|---|---|---|
| P1-1 | 雛形 | pnpm workspace・estimator / catalog の空パッケージ・PRD・コンセプト確認のスパイク | — （済） |
| P1-2 | 数値の基盤 | 数値の規律（`ceilUnits`。D-16）・Unit・Quantity・Money・`Sourced<T>`・Derivation | P1-1 （済） |
| P1-3 | Workload | zod スキーマ（入力と正規形）・`resolveWorkload`（導出と上書き）・代表週の時間分布 | P1-2 （最初の形・済） |
| P1-4 | 料金スキーマ | PriceBook の zod スキーマと検証規則（03 §9〜10）・架空の PriceBook 一式 | P1-2 （済） |
| P1-5 | 料金計算 | `priceUsage`（プール・丸め・段階・クレジット・固定費・超過時の挙動）と 05 §2 のテスト | P1-4 （済） |
| P1-6 | Architecture | グラフの型・構成の検証・BillingAccount・3 つの架空スタック | P1-2 （最初の形・済。クラスごとの経路） |
| P1-6b | フレームワーク | FrameworkProfile・BuildOutput・DeployTarget の型と `compileBuildOutput`。架空のフレームワークで ISR・ミドルウェアの件数を確かめるテスト | P1-3, P1-6 |
| P1-7 | 資源シミュレーション | ComponentKind（cdn・serverless-function・serverless-sql・managed-postgres・object-storage・vps・process）と 05 §3 のテスト | P1-3, P1-6 （最初の形・済） |
| P1-8 | 容量の判定 | Limit の判定・VPS の使用率・LimitBreach の合流 | P1-5, P1-7 （最初の形・済。`assessPremises`：プール・制限・ホストの容量・利用資格を前提の 1 文で出す） |
| P1-S | ゲームのターンのスパイク | P1-5・P1-7 の最初の形を使い、月ごとの成長・スパイク・行動（画像圧縮・プラン変更）で「前提に当たる瞬間」がイベントとして面白いかを確かめる（使い捨て・`spikes/`） | P1-5, P1-7 （済: spikes/game-2026-10-31。`pnpm play`） |
| P1-9 | Estimate | 全体の組み立て・スナップショット・直列化・05 §5〜6 の golden テスト | P1-5, P1-7, P1-8 |
| P1-10 | 実在の料金データ | Cloudflare（Workers・D1・R2・Pages）・Vercel（Hobby・Pro）・Supabase（Free・Pro）・さくらの VPS 2GB（D-13）・KV・Images（スパイクで一次取得済み。catalog の形式へ移して出典を付け直す）。出典 URL と取得日つき | P1-4 （済: Cloudflare・Vercel・Supabase・さくらの VPS。catalog/src/providers） |
| P1-10b | 実在のフレームワークの対応データ | Vite・Next.js・vinext の FrameworkProfile と、MVP の 3 ホストへの DeployTarget（出典・取得日つき） | P1-6b |
| P1-11 | 規模の掃引と CLI | PV を振った費用曲線のデータと、見積を表で出す開発用 CLI（node 専用・別パッケージ） | P1-9, P1-10 |

- P1-10 は P1-4 のスキーマが固まれば並行して進められる。**実データを集めてスキーマの穴が見つかったら P1-4 に戻す**
  （例: クレジットの適用順、リージョン差の持ち方）。スキーマを固めすぎる前に、1 プロバイダー分を試しに入れてみるのがよい。
- Astro は Phase 1 の直後（Phase 2 と並行可）に、**データの追加だけで足せるか**の検証として入れる（[06](./06-frameworks.md) §3）。
- Performance の p50/p95/p99 は Phase 1 に入れない（使用率と制限の判定まで）。
