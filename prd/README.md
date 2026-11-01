# PRD: infra-supra（仮称）

> **この PRD は「実装予定の仕様（あるべき設計）」を書く正典である。** 実装が追いついていない箇所は
> 「gap」「計画中」と明示する。未確定の論点は「要確認」と書き、[`_grilling/decisions.md`](./_grilling/decisions.md) で決める。
> 出発点の企画書は [00-concept.md](./00-concept.md)（原文保存・正典ではない）。

## 目的

> **軸: Web アプリケーションプラットフォームの「前提」が生む重要なポイントを扱える仕組み・ゲームにする**（2026-10-31・D-12）。
> 金額の精密さそのものではなく、「このプラットフォームはこういう前提で動くので、このアプリではここが効く」を
> 見積でもゲームでも同じ言葉で示すことを中心に置く。

実在するクラウド／ホスティングの**料金体系**を使って、Web アプリのインフラ構成ごとの月額費用と性能上の制約を比べる。
同じ計算エンジンの上に、2 つのモードを載せる。

1. **見積モード（Estimator）**: 「こういう Web アプリを、この規模で動かすと、どの構成がいくらで、どこが詰まるか」を答える。
   **単独のツールとして切り出せる完成度を目標にする**（[02](./02-architecture.md) §1 のパッケージ分割はこれを前提にする）。
2. **ゲームモード（Tycoon）**: 成長するサービスを月単位のターンで運営し、費用・性能・運用負荷のトレードオフを体験する。
   費用は見積エンジンが算出したものをそのまま使う（ゲームのために料金を作らない）。

## 設計の柱

| 柱 | 内容 | 詳細 |
|---|---|---|
| 料金は実データ、性能は明示した仮定 | 料金は公式料金表を一次情報にする。性能・障害率・ユーザー行動は「仮定」として出所を区別する | [01](./01-domain-model.md) §2 |
| 計算過程を説明できる | すべての金額は「どの使用量 × どの単価 − どの無料枠」の根拠をたどれる | [01](./01-domain-model.md) §6 |
| 振る舞いはコード、具体値はデータ | コンポーネントの種類（CDN・サーバーレス関数・VPS…）の振る舞いはエンジンのコード。個々のサービスとプランはデータ。料金改定はデータの更新だけで済ませる | [01](./01-domain-model.md) §4 / [03](./03-pricing-schema.md) |
| 見積とゲームを分ける | 依存は「ゲーム → 見積」の一方向のみ | [02](./02-architecture.md) §1 |
| 決定論 | 同じ入力と同じ料金データの版なら、同じ結果になる。課金の切り上げは許容誤差つきの 1 関数に閉じ込める | [02](./02-architecture.md) §3 |
| 特定のスタックに寄せない | 見積対象のアプリのフレームワークとレンダリング方式は入力の軸。フレームワーク非依存の中間表現（BuildOutput）を経て構成に写す | [06](./06-frameworks.md) |
| コストに効く仮定は選択肢にする | 結論を左右する仮定は幅にせず、シナリオ・利用者の選択肢、見積の「重要な前提」（境目の値つき）として出す | [01](./01-domain-model.md) §8 |
| 過度な精密化を避ける | 物理シミュレーションより、規模によって最適な構成が入れ替わる様子の再現を優先する | [04](./04-resource-simulation.md) |

## スコープ

> 今の状態（2026-11-02・D-79 まで）。フェーズごとの済み・残りは [08](./08-roadmap.md)。

- **実装済み**:
  - 見積エンジン（estimator）: 数値の基盤・料金スキーマと料金計算・Workload・構成・資源シミュレーション・前提（使用率と止まる / 遅くなる / 課金が増える）の判定・`estimate`（P1-2〜P1-8）。
  - 料金データ（catalog）: 下の事業者の公式の料金表から、出典 URL と取得日つき（P1-10）。明細の表示名（D-75）・日本の消費税の扱い（D-76）。
  - ゲームモード（game・web）: GD-1〜GD-5（[07](./07-game-design.md) §8）。シナリオは記事コミュニティと受託の業務アプリ（[09](./09-scenario-contract.md)）。始める画面で構成・フレームワーク・部品・設定を選び、1 か月目の費用の見込みを出す（D-45・D-72）。
  - 見積モード（web の `?mode=estimate`）: 明細・前提・構成の比較・費用の曲線・席・税込の目安（D-73〜D-76。今の形は [08](./08-roadmap.md)「見積モードの今の形」）。
- **計画中**: 見積の JSON の保存・料金の改定の予告・判断ポイントの境目の値（D-73・D-74 の残し）、見積のスナップショットと golden（P1-9 の残り）、外部のシナリオとランキング（[12](./12-external-scenarios-and-ranking.md)・未決）、アーキテクチャエディタ（Phase 5）。
- **対象の事業者と構成**（catalog の `src/providers/`・`src/stacks/`）:

  | 事業者 | 構成・役割 | 決定 |
  |---|---|---|
  | Cloudflare | Workers（Free・Paid）+ D1 + R2 + KV + Images。Next.js は vinext で載せる（D-08） | MVP |
  | Vercel | Hobby・Pro（+ Supabase）。Pro は $20 のクレジットがすべての従量に当たる（D-48） | MVP |
  | Supabase | Vercel・Netlify の構成の DB（Free・Pro）。Cloudflare からは Hyperdrive 経由の部品 | MVP |
  | さくらの VPS | 2GB・4GB（東京）。Docker Compose + MySQL + Nginx の自前運用 | D-13・D-24 |
  | AWS（東京・常時無料だけ） | Amplify Hosting（Next.js）・S3 + CloudFront + Lambda（SPA）・OpenNext（Next.js を自分で組む）。DB は DynamoDB・RDS・Aurora・DSQL。CloudFront の定額のプラン | D-51・D-61・D-63・D-66 |
  | Netlify | Free・Personal・Pro（+ Supabase）。クレジット制 | D-71 |
  | Neon | Vercel・Netlify の DB の他の事業者の部品（従量の Postgres） | D-77 |
  | Google Cloud | Cloud Run + Firebase Hosting（東京）。DB は Firestore・Cloud SQL | D-88 |

  事業者をまたぐ部品（画像だけ Cloudflare・API を Workers + D1 に・Cloudflare の静的 + AWS / VPS の API・DB だけ Neon）は、公式で確かめた組だけを catalog の `CROSS_PAIRS` で許す（D-52・D-65・D-67・D-69・D-77。[11](./11-aws-and-cross-provider.md) §2・[10](./10-framework-branch.md) §9）。
- **対象のフレームワーク**: Next.js（App Router）・Vite（SPA）+ API・Astro・Next.js の静的書き出し（`output: 'export'`）（[06](./06-frameworks.md)・[10](./10-framework-branch.md)・D-34・D-68・D-80）。vinext はフレームワークではなく、Next.js を Cloudflare に載せる経路（D-08）。Astro × AWS は公式のアダプターが無いので対象外。
- **対象外**: 企画書 §8 のとおり（WebRTC の詳細・動画エンコード・マルチリージョン・障害伝播・認証など）。遅延は計算しない（AX-13）。AWS の新規アカウントの 1 回きりのクレジットは入れない（AX-06）。

## 文書

| 文書 | 内容 |
|---|---|
| [00-concept.md](./00-concept.md) | 企画書の原文（正典ではない） |
| [01-domain-model.md](./01-domain-model.md) | ドメインモデル（Workload / Architecture / ComponentKind / Usage / PriceBook / Bill / Estimate）と計算の流れ |
| [02-architecture.md](./02-architecture.md) | パッケージ分割と依存の向き / 技術スタック / 数値と決定論 / 永続化 |
| [03-pricing-schema.md](./03-pricing-schema.md) | 料金データのスキーマ（メーター・無料枠プール・段階料金・クレジット・上限超過時の挙動・出典） |
| [04-resource-simulation.md](./04-resource-simulation.md) | Workload からリソース消費量への変換仕様（MVP のコンポーネント種別ごと） |
| [05-test-strategy.md](./05-test-strategy.md) | 料金計算のテストケース設計（架空料金データの扱いを含む） |
| [06-frameworks.md](./06-frameworks.md) | フレームワークとビルド出力（FrameworkProfile・BuildOutput・DeployTarget。ISR・ミドルウェア・画像最適化の写し方） |
| [07-game-design.md](./07-game-design.md) | ゲームデザイン（満足度・開発の手間・出来事・部品の選択・推移と見込み・評価）と実装の順序 |
| [08-roadmap.md](./08-roadmap.md) | フェーズの状態（済み・残り）・見積モードの今の形・Phase 1 のタスク分解 |
| [09-scenario-contract.md](./09-scenario-contract.md) | 2 本目のシナリオ: 受託先の業務アプリの運用（テンプレート・出来事・確定した値と基準プレイ） |
| [10-framework-branch.md](./10-framework-branch.md) | フレームワークの分岐（Vite の SPA か Next.js か）・API の応答のキャッシュ・API の置き場（段 1〜3）・Astro の API の置き場・Next.js の静的書き出し（§11）。確定・実装済み |
| [11-aws-and-cross-provider.md](./11-aws-and-cross-provider.md) | AWS（Amplify・OpenNext・Aurora 系・CloudFront の定額）・事業者をまたぐ構成・Netlify・Neon・Google Cloud。論点 AX-01〜14 は D-50 で決定・実装済み |
| [12-external-scenarios-and-ranking.md](./12-external-scenarios-and-ranking.md) | 外部のシナリオ（JSON + zod）と再生による検証のランキング。**下書き・未実装・未決 ES-01〜16** |
| [research/](./research/) | 調査メモ（公式の文書の抜き書き。正典ではなく、使う値は catalog に出典つきで入れたものだけ） |
| [_grilling/decisions.md](./_grilling/decisions.md) | 決定ログ（D-01〜D-79）と、末尾に未決の論点の一覧 |

## 用語

| 用語 | 意味 |
|---|---|
| Workload | アプリの利用状況と処理内容。簡易入力から**正規形**（全項目が埋まった形）へ解決してからエンジンに渡す |
| Architecture | ノード（役割にサービスとプランを割り当てたもの）と接続のグラフ |
| ComponentKind | コンポーネントの種類（`cdn`・`serverless-function`・`vps` など）。トラフィックを受けて使用量を生む振る舞いをコードで持つ |
| ServiceOffering | 実在サービスの 1 プラン（例: Cloudflare Workers Paid）。ComponentKind のパラメータ（制限・メーター）をデータで与える |
| Meter | 課金の計量単位（例: リクエスト数・CPU ms・GB 月・行の読み取り数）。プロバイダーの呼び方に合わせる |
| BuildOutput | フレームワーク非依存のビルド出力の中間表現（静的アセット・ルートごとのレンダリング方式・ミドルウェア・画像最適化）。**gap**: 型は作っておらず、Workload の routes とテンプレートの書き換えで代用している（[06](./06-frameworks.md) 冒頭・§6.6） |
| DeployTarget | フレームワーク × ホストの組み合わせ。どの機能が対応し、どのノード・メーターに写るかを持つ |
| Usage | ノード × メーター × 期間の使用量。導出の根拠を伴う |
| PriceBook | プロバイダー単位・版付きの料金データ。出典と取得日を持つ |
| Bill | Usage に PriceBook を当てた結果。明細行（LineItem）ごとに根拠を持つ |
| Estimate | 1 回の見積の入力・料金データの版・仮定・結果を固めたスナップショット（スナップショットと直列化は計画中。今の `estimate` は結果を返すだけ） |
| 前提（Premise） | 「このプラットフォームはこういう前提で動く」を、使用率・境目・超えたときの効き方（止まる・遅くなる・課金が増える・調整される）つきで出す 1 文（`assessPremises`。D-12） |
| 構成（スタック） | 事業者とプランの組（例: Cloudflare Paid + vinext）。catalog の `STACK_DEFS` と `composeStack` |
| 部品・スロット | 構成の役割（画像・DB・ISR の置き場・API の置き場・前段の CDN など）ごとに選ぶ選択肢。他の事業者の部品は `CROSS_PAIRS` で許した組だけ（D-24・D-52） |
| 設定 | 再検証の間隔（オンデマンドを含む）・API のキャッシュの期間・ビルドの間隔・画像の形式（JPEG / WebP / AVIF。D-58）・サイズ違いの数 |
| シナリオ / テンプレート | ゲームのシナリオ（記事コミュニティ・受託の業務アプリ）と、その元になるアプリの形。見積モードではテンプレートとして選ぶ |
| 基準プレイ | 構成 × 方針を決まったシードで自動で回した結果。所持金の目標の根拠と golden に使う（[07](./07-game-design.md) §10.8・D-64） |
| ゲーム上の仮定 | 手間・倍率・確率・満足度への効き方など、出典の無いゲームのための値。実在の値のように扱わない |
