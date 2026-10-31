# 02. アーキテクチャ

## 1. パッケージと依存の向き

```
                 web（Vite + React。Phase 2〜）
                /        |         \
           game  ───▶ estimator ◀── catalog
       （Phase 3〜）   （純ロジック）   （データ）
```

| パッケージ | 役割 | 状態 |
|---|---|---|
| `packages/estimator` | Workload・Architecture・ComponentKind・資源シミュレーション・料金計算・容量評価と、それらの zod スキーマ。**環境非依存** | 空の雛形 |
| `packages/catalog` | ServiceOffering と PriceBook（プロバイダー別・版付き）、アプリのテンプレート、構成スタック。架空データは `src/fictional/` に分ける | 空の雛形 |
| `packages/game` | 経営シミュレーション（ターン・ユーザー成長・イベント・収益・評価）。シード付き乱数 | 計画中（Phase 3） |
| `packages/web` | 見積モード・ゲームモードの UI | 計画中（Phase 2） |

依存の規則:

- **estimator は他のどのパッケージにも依存しない。** catalog のデータは引数で受け取る（注入）。
  テストでは架空の PriceBook を渡せる。
- **catalog → estimator**（型とスキーマだけを使う）。catalog のテストは「全データが estimator のスキーマを通る」ことを確かめる。
- **game → estimator**。game は料金を計算しない。estimator の Bill をそのまま使う（企画書 §11.1）。
- **estimator・catalog は game を知らない。** 見積ツールを単独で切り出すときは web から game を外すだけで済む。

## 2. 環境非依存

estimator・catalog・game は `lib: ["esnext"]` / `types: []` でビルドし、DOM・node の API を使わない。
ブラウザのメインスレッド・Web Worker・Node（CLI・テスト）のどこでも同じコードが動く。
料金データは **TypeScript モジュールとして export する JSON 相当のオブジェクト**にする（ファイル I/O を不要にするため）。
将来の自動取得では、取得スクリプト（node 専用・別パッケージ）が同じ形のファイルを生成する。

## 3. 数値と決定論

- **金額と単価は 10 進数で計算する**（2 進の浮動小数点を使わない）。料金表の単価は `"0.30"` のように**文字列**で持ち、
  10 進ライブラリで読む。候補は `big.js`（小さい・依存なし）。Phase 1 の P1-2 で決める。
- 使用量（リクエスト数・バイト数）も 10 進で持つ。月 1000 万 PV × 画像 20 枚 × 200 KB は 4 × 10¹³ バイトで、
  整数としては `Number` に収まるが、単価との積で誤差が出るため。
- **性能評価（使用率・待ち行列）は浮動小数点でよい**が、`Math.exp` / `Math.pow` などの超越関数は JS エンジン間で
  結果が一致する保証がない。ゲームの再現性（同じシード・同じ行動なら同じ結果）に効く値には使わない
  （四則演算と `Math.sqrt` は IEEE 754 で一致する）。
- 丸めは**課金の丸め（料金データが指定）**と**表示の丸め（UI）**を分ける。エンジンは表示用の丸めをしない。

## 4. 技術スタック

| 層 | 選定 | 理由 |
|---|---|---|
| 言語・構成 | TypeScript の pnpm monorepo | 企画書 §7.1。seseraki と同じ型 |
| テスト | vitest（+ 性質ベースのテストに fast-check） | 単調性・保存則などを網羅的に確かめる（[05](./05-test-strategy.md)） |
| スキーマ | zod | 保存データ・料金データ・UI 入力の検証を 1 か所にまとめる |
| フロント | React 19 + **Vite**（Next.js は使わない）+ TanStack Router + Tailwind v4 + daisyUI | MVP はサーバーが要らない（計算はブラウザ、保存はローカル）。静的配信だけで動く |
| グラフ | 費用曲線は Recharts か visx（Phase 2 で決める）、構成図は React Flow（Phase 5） | 企画書 §7.1 |

Vite を選んだ判断は [_grilling/decisions.md](./_grilling/decisions.md) D-01。

## 5. 永続化

- MVP は**ローカル保存**（localStorage / IndexedDB）と **JSON の書き出し・読み込み**。
- 保存形式は zod スキーマに `schemaVersion` を持たせ、読み込み時に移行関数を通す。
- 見積は §1 の流れの入力と PriceBook の版を保存し、結果は再計算で復元する（結果のキャッシュも持つが正は入力）。

## 6. 自分自身のデプロイ（計画中）

静的配信だけで動くので、このアプリ自体を MVP の比較対象のどれかに載せ、
**自分の見積と実際の請求を突き合わせる**ことができる（見積ツールの検証に使える）。デプロイ先は未決。
