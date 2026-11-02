# 08. ロードマップ

## フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
> 状態は 2026-11-02 の main（D-77 まで）に合わせた。決定の中身は [_grilling/decisions.md](./_grilling/decisions.md)、未決の一覧はその末尾。

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 雛形・PRD（本文書群） | **済**（雛形・PRD。決定は D-01〜D-77。残る論点は decisions の「未決」の節で扱う） |
| 1 | 計算エンジン（workload → usage → bill・容量の判定）と MVP 3 構成の料金データ | **ほぼ済**（下の表。残りは P1-9 のスナップショットと golden・P1-11 の CLI。BuildOutput の型は作らず代用した（P1-6b）） |
| 2 | 見積モードの UI（テンプレート・入力・内訳・構成比較・費用曲線・JSON 保存） | **最初の形は済**（下の「見積モードの今の形」・D-73〜D-76）。残りは JSON の保存・料金の改定の予告・判断ポイントの境目の値・PV 以外を振る曲線 |
| 3 | ゲームエンジン（ターン・成長・イベント・収益・判定） | **済**（07 §8 の GD-1〜GD-5。シナリオは記事コミュニティと受託の業務アプリ（09・D-33））。その後も前提・部品・事業者を足し続けている（D-35〜D-72）。画像投稿サービスは将来の候補 |
| 4 | ゲーム UI | **試作の画面の上で進行中**（始める画面で構成・フレームワーク・部品・設定を選ぶ・1 か月目の費用の見込み・月の報告・推移と見込み・次のプレイへのヒント・動き。D-22 の画面の形（固定バー・タブ）は保留のまま） |
| 5 | アーキテクチャエディタ（React Flow） | 計画中 |
| 6 | 拡張（AWS・動画・WebSocket・WebRTC・性能モデル・料金の自動取得） | **AWS は済**（Amplify・S3 + CloudFront + Lambda・OpenNext・Aurora 系・CloudFront の定額。D-51・D-61・D-63・D-66）。MVP の外の事業者として Netlify（D-71）・Neon（D-77）、フレームワークとして Astro（D-68）も足した。動画・WebSocket・WebRTC・性能モデル・料金の自動取得は計画中 |
| — | 外部のシナリオとランキング（[12](./12-external-scenarios-and-ranking.md)） | 下書き・未決（ES-01〜16）。ユーザーが「今の作業が落ち着いてから設計する」と決めた |

Phase 1 が終わった時点で「CLI で見積を出して内訳を読める」状態を目指す。UI より先に計算の妥当性を確かめるため。
→ 実際は CLI より先に、ゲームモードの画面と見積モードの画面で内訳を読めるようにした（D-73）。CLI（P1-11）は計画中のまま。

## 見積モードの今の形（D-73）

web のヘッダーのタブ「見積」（URL の `?mode=estimate`）。単独のツールとして切り出せる完成度が目標（README）。

- **入力**: テンプレート（記事コミュニティ・業務アプリ）・月の PV・フレームワーク・構成（6 つの土台の事業者（Cloudflare・Vercel・さくらの VPS・AWS の Amplify / S3 + CloudFront・OpenNext・Netlify）の全構成）・部品（始める画面と同じ規則で選べる組だけ。選んでも変わらない部品（D1 の DB のバックアップなど）は出さず、URL に残った値は無視して既定にする（D-94）。画像だけ Cloudflare・API を Workers に・DB だけ Neon（D-77）など他の事業者の部品を含む。既定は catalog・フレームワークの既定）・設定（再検証の間隔 / API のキャッシュの期間 / ビルドの間隔・画像の形式・サイズ違い。テンプレートとフレームワークで効かないものは出さない）。入力は URL のクエリに残る。
- **出力**: 月の合計（USD と円の目安。為替は仮定）・事業者とメーターごとの明細（使用量・込み分・課金対象・金額・クレジットの当て方）・前提の使用率と超過の印（超えると何が起きるか）・料金未取得の件数・料金データの出典（版・取得日・URL）・構成の比較（載せられる全構成の月額。並べ替え可）。
- **数え方**: ゲームの 1 か月目と同じ（`game` の `estimateComponents`・`estimateWorkload`）。料金は catalog の `composeStack` と estimator の `estimate` を web が直接呼ぶ。計算と入力の扱いは `packages/web/src/estimate/model.ts`。
- **費用の曲線**（D-74）: 今の条件のまま月の PV を 1 万〜3,000 万の 8 点（対数の刻み）で振り、今の構成と比べたい構成（既定は今の PV で安い順に 4 構成。チェックで最大 6）の月額を折れ線にする。軸は PV・月額とも対数（$1 未満は底に寄せる）。止まる前提に当たる点は ×、ツールチップに「止まる: 〜」。色は事業者、点の形は事業者の中のプランで固定。部品は今の構成だけ今の選択、他は既定。計算は model.ts の `costCurves`。
- **席と消費税**（D-76）: 入力の「チームの人数（管理画面を使う人）」（既定 1・URL の `seats`）を構成のアカウントの席にし、席課金のプラン（料金データの `members` が `per-seat`）だけ月額・比較・曲線に効く。席の料金が無い・書かれていないプランは前提の文で出す。「税込の目安（円）」（既定で出す・URL の `tax=0` で消す）は、日本の利用者に消費税が足されると文書で確かめた事業者（catalog の `JAPAN_TAX`）だけ 10% を足し、税込の価格（さくら）・未確認の事業者（Supabase・Netlify・Neon）は足さない。Vercel は D-84 で足す側にした（国税庁の公表サイトに登録あり）。個人・登録番号なしの想定の 1 つだけ。
- **明細の行の名前**（D-75）: 料金データの表示名（`label`。「日本語（公式の名称）」）。無い架空の料金だけ ID から作る。
- **まだ無いもの**: JSON の保存・料金の改定の予告（今の版で数える。2026-12-01 の Workers Logs → Cloudflare Observability もゲームだけが改定の出来事の月から反映する。D-94）・判断ポイントの境目の値（どの PV で構成が入れ替わるか）・PV 以外（画像の量・再検証の間隔）を振る曲線・Supabase・Netlify・Neon の日本の消費税の確認（D-76・D-84）。
  見積だけを切り出すには、game の `estimate-mode.ts` が持つ部品の規則と Workload の組み立てを catalog（か新しいパッケージ）へ移す必要がある（D-73）。

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
| P1-6b | フレームワーク | FrameworkProfile・BuildOutput・DeployTarget の型と `compileBuildOutput`。架空のフレームワークで ISR・ミドルウェアの件数を確かめるテスト | P1-3, P1-6 （最小の形で済: FrameworkProfile と DeployTarget の表だけ。BuildOutput・`compileBuildOutput` は作らず、テンプレートの書き換えで代用。06 冒頭・10 §7・D-34） |
| P1-7 | 資源シミュレーション | ComponentKind（cdn・serverless-function・serverless-sql・managed-postgres・object-storage・vps・process）と 05 §3 のテスト | P1-3, P1-6 （最初の形・済） |
| P1-8 | 容量の判定 | Limit の判定・VPS の使用率・LimitBreach の合流 | P1-5, P1-7 （最初の形・済。`assessPremises`：プール・制限・ホストの容量・利用資格を前提の 1 文で出す） |
| P1-S | ゲームのターンのスパイク | P1-5・P1-7 の最初の形を使い、月ごとの成長・スパイク・行動（画像圧縮（当時。今は画像の形式・D-58）・プラン変更）で「前提に当たる瞬間」がイベントとして面白いかを確かめる（使い捨て・`spikes/`） | P1-5, P1-7 （済: spikes/game-2026-10-31。`pnpm play`） |
| P1-9 | Estimate | 全体の組み立て・スナップショット・直列化・05 §5〜6 の golden テスト | P1-5, P1-7, P1-8 （組み立ての `estimate` は済。スナップショット・直列化・estimator の golden は計画中。golden は今はゲームの基準プレイの側にある） |
| P1-10 | 実在の料金データ | Cloudflare（Workers・D1・R2・Pages）・Vercel（Hobby・Pro）・Supabase（Free・Pro）・さくらの VPS 2GB（D-13）・KV・Images（スパイクで一次取得済み。catalog の形式へ移して出典を付け直す）。出典 URL と取得日つき | P1-4 （済: Cloudflare・Vercel・Supabase・さくらの VPS。catalog/src/providers。後から AWS・Netlify・Neon も足した） |
| P1-10b | 実在のフレームワークの対応データ | Vite・Next.js・vinext の FrameworkProfile と、MVP の 3 ホストへの DeployTarget（出典・取得日つき） | P1-6b （済: Next.js・Vite の SPA・Astro × Cloudflare・Vercel・VPS・AWS・Netlify。catalog/src/frameworks） |
| P1-11 | 規模の掃引と CLI | PV を振った費用曲線のデータと、見積を表で出す開発用 CLI（node 専用・別パッケージ） | P1-9, P1-10 （費用曲線のデータは見積モードの `costCurves` で済・D-74。CLI は計画中） |

- P1-10 は P1-4 のスキーマが固まれば並行して進められる。**実データを集めてスキーマの穴が見つかったら P1-4 に戻す**
  （例: クレジットの適用順、リージョン差の持ち方）。スキーマを固めすぎる前に、1 プロバイダー分を試しに入れてみるのがよい。
- Astro は Phase 1 の直後（Phase 2 と並行可）に、**データの追加だけで足せるか**の検証として入れる（[06](./06-frameworks.md) §3）。→ 入れた（D-68）。答えは [06](./06-frameworks.md) §6.6。
- Performance の p50/p95/p99 は Phase 1 に入れない（使用率と制限の判定まで）。
