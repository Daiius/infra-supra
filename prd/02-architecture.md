# 02. アーキテクチャ

## 1. パッケージと依存の向き

```
                 web（Vite + React）
                /        |         \
           game  ───▶ catalog ───▶ estimator
             └───────────────────────▲
       （ゲーム）      （データ）     （純ロジック）
```

| パッケージ | 役割 | 状態（2026-11-02） |
|---|---|---|
| `packages/estimator` | Workload・Architecture・ComponentKind・資源シミュレーション・料金計算・容量評価（前提）と、それらの zod スキーマ。**環境非依存** | 実装済み（P1-2〜P1-8。[08](./08-roadmap.md)） |
| `packages/catalog` | ServiceOffering と PriceBook（プロバイダー別・版付き）、フレームワーク、アプリのテンプレート、構成スタックと部品（事業者をまたぐ部品を含む）、日本の消費税。架空データは `src/fictional/` に分ける（`catalog/fictional`。本体の index からは export しない。D-78） | 実装済み（7 事業者。[README](./README.md)「スコープ」） |
| `packages/game` | 経営シミュレーション（ターン・ユーザー成長・イベント・収益・評価）。シード付き乱数 | 実装済み（GD-1〜GD-5・2 シナリオ。[07](./07-game-design.md) §8） |
| `packages/stats` | 集計のサーバー（Hono RPC・drizzle + Postgres。node 専用）。終わったプレイを game で再生して照合し保存する・分布を返す | 実装済み（段 2。デプロイ待ち。[15](./15-results-and-stats.md) §5.4・§7.1） |
| `packages/web` | 見積モード・ゲームモードの UI | ゲームモードと、見積モードの最初の形（ルーターなし・タブで切り替え。[08](./08-roadmap.md)・D-73〜D-76） |

依存の規則:

- **estimator は他のどのパッケージにも依存しない。** catalog のデータは引数で受け取る（注入）。
  テストでは架空の PriceBook を渡せる。
- **catalog → estimator**（型とスキーマだけを使う）。catalog のテストは「全データが estimator のスキーマを通る」ことを確かめる。
- **game → catalog・estimator**。game は料金を計算しない。catalog の `composeStack` で構成を組み、estimator の Bill をそのまま使う（企画書 §11.1）。
- **集計のサーバー（D-135・`packages/stats`。段 2 で実装・D-155）→ game → catalog・estimator。** web はサーバーの型（Hono RPC の `AppType`）だけを devDependencies で読み、実行時にサーバーのコードを含めない（[15](./15-results-and-stats.md) §5）。
- **estimator・catalog は game を知らない。** 見積ツールを単独で切り出すときは web から game を外す。
  ただし今の見積モードは、ゲームと数え方をそろえるため部品の規則と Workload の組み立てを game の `estimate-mode.ts` から使っている。切り出すには、それを catalog（か新しいパッケージ）へ移す必要がある（D-73）。

## 2. 環境非依存

estimator・catalog・game は `lib: ["esnext"]` / `types: []` でビルドし、DOM・node の API を使わない。
ブラウザのメインスレッド・Web Worker・Node（CLI・テスト）のどこでも同じコードが動く。
料金データは **TypeScript モジュールとして export する JSON 相当のオブジェクト**にする（ファイル I/O を不要にするため）。
将来の自動取得では、取得スクリプト（node 専用・別パッケージ）が同じ形のファイルを生成する。

## 3. 数値と決定論

- **金額・使用量は普通の number で計算する**（D-16。10 進数のライブラリは使わない）。見積の精度を決めるのは仮定
  （SSR の CPU 時間・画像のサイズなど、幅が数十 %）のほうで、浮動小数点の誤差（相対 10⁻¹⁵ 程度）は表示の桁に届かない。
  浮動小数点で実際に困るのは**小数の量を小数の単位で切り上げる境界**だけ（`0.1 × 3` を 0.1 単位で切り上げると 4 単位になる）なので、次の規律で扱う:
  1. 課金の切り上げは `ceilUnits`（許容誤差つき・単位の個数を返す）だけを使う。`Math.ceil` を直接使わない
  2. 量はできるだけ整数の単位で持つ（バイト・ms・件）。整数は 2⁵³ まで正確
  3. 丸めは表示のときだけ。テストは表示の桁か `nearlyEqual` で比べる
- 性能評価（使用率・待ち行列）も同じ number で、`Math.exp` / `Math.pow` などの超越関数は JS エンジン間で
  結果が一致する保証がない。ゲームの再現性（同じシード・同じ行動なら同じ結果）に効く値には使わない
  （四則演算と `Math.sqrt` は IEEE 754 で一致するので、決定論は崩れない）。
- 丸めは**課金の丸め（料金データが指定）**と**表示の丸め（UI）**を分ける。エンジンは表示用の丸めをしない。

## 4. 技術スタック

| 層 | 選定 | 理由 |
|---|---|---|
| 言語・構成 | TypeScript の pnpm monorepo | 企画書 §7.1。seseraki と同じ型 |
| テスト | vitest（+ 性質ベースのテストに fast-check） | 単調性・保存則などを網羅的に確かめる（[05](./05-test-strategy.md)）。fast-check はまだ入れていない（gap） |
| スキーマ | zod | 保存データ・料金データ・UI 入力の検証を 1 か所にまとめる |
| 集計のサーバー（D-135・`packages/stats`） | **Hono RPC**（さくらの VPS・node）+ 既存の Postgres（drizzle） | 終わったプレイの匿名の集計だけ。ゲームと見積の計算はブラウザのまま。構成は seseraki に倣う（[15](./15-results-and-stats.md) §5） |
| フロント | React 19 + **Vite**（Next.js は使わない）+ TanStack Router + Tailwind v4 + daisyUI | MVP はサーバーが要らない（計算はブラウザ、保存はローカル）。静的配信だけで動く。**今はルーターを入れていない**（画面は 2 つでタブで切り替え。画面が増えたら入れる。D-73） |
| 最適化 | **React Compiler**（`babel-plugin-react-compiler` 1.0。`@vitejs/plugin-react` 6 の `reactCompilerPreset` を `@rolldown/plugin-babel` 0.2 + `@babel/core` 7 で掛ける） | 描き直しの抑制を手書きの `useMemo`・`useCallback` に頼らない。入れ方は [react.dev の Installation](https://react.dev/learn/react-compiler/installation) の Vite の節。plugin-react 6 は Babel を内蔵しないので Babel は別の plugin。vitest（jsdom）も同じ変換を通る。手書きの memo を外すのは後で |
| グラフ | 費用曲線は Recharts か visx（Phase 2 で決める）、構成図は React Flow（Phase 5） | 企画書 §7.1。**今は自前の SVG**（`packages/web/src/charts.tsx` の `LineChart`・`CurveChart`。D-74・D-179）でライブラリは入れていない |

Vite を選んだ判断は [_grilling/decisions.md](./_grilling/decisions.md) D-01。

**JS の分け方（code splitting）**: 開いた画面に要るものだけを最初に読む。

- 見積の画面（`estimate/estimate-mode.tsx`）と運営中の画面（`game-screen.tsx`）は `App.tsx` の `React.lazy` + `Suspense` で分けて読む。最初に読むのは、タブ・始める画面・保存の読み書きまで。
  始める画面と運営中の画面の両方が使う小物は `commitment-meta.ts` に置く（`App.tsx` から運営中の画面を静的に読まないため）。
- 依存（react・zod）と料金データ（catalog）・エンジン（estimator・game）は `vite.config.ts` の `build.rolldownOptions.output.codeSplitting.groups` で別の chunk にする。
  どれも最初の画面に要るので初回の量は減らないが、画面だけを直したときに変わらない chunk をキャッシュから読める。1 つの chunk が 500 KB を超える警告も消える。
- 描画テストは分けた画面の読み込みを待つ（`smoke.test-helpers.tsx` の `waitLoaded`。`renderApp`・`startGame` は async）。

## 5. 永続化

> ⚠ **D-134・D-135 で例外ができた**（[15](./15-results-and-stats.md)）: 終わったプレイ（始めたときの選択・行動の列・4 軸の値・終わり方）を匿名でサーバー（さくらの VPS の Hono RPC・既存の Postgres）に送る。サーバーなしで遊べる前提は変えない（送れなくてもゲームは続き、比較は手元の履歴に戻る）。途中の保存は今までどおりローカルだけ。

- MVP は**ローカル保存**（localStorage / IndexedDB）と **JSON の書き出し・読み込み**。
- 保存形式は zod スキーマに `schemaVersion` を持たせ、読み込み時に移行関数を通す。
- 見積は §1 の流れの入力と PriceBook の版を保存し、結果は再計算で復元する（結果のキャッシュも持つが正は入力）。
- **ゲームの途中の保存（D-26・実装済み）**: localStorage のキー `infra-supra:game-save` に、始めたときの選択（シナリオ・構成・シード・始めた日）と月ごとの行動の列だけを `version` つきで保存する（`packages/game/src/save.ts` の `SaveData`）。GameState そのものは保存しない。読み込みは `replaySave`（純粋関数）で同じ順に再生して復元する（ゲームは決定論）。読めない・版が違う・再生で例外が出たら、黙って捨てて初期画面にする。「最初から」で消す。保存から再開したときは、出来事・目標達成のダイアログを自動では開かない（ボタンで開ける）。I/O は web の中だけ。
  過去の月に戻る（D-128）は、その月以降の行動を切り落とした保存を再生する（`rewindSave`）。戻る直前の行動の列は前の試行として保存の `previous` に 1 本だけ残し（任意の欄・版は上げない）、推移のグラフに破線で重ねる。

## 6. 自分自身のデプロイ（計画中）

静的配信だけで動くので、このアプリ自体を MVP の比較対象のどれかに載せ、
**自分の見積と実際の請求を突き合わせる**ことができる（見積ツールの検証に使える）。デプロイ先は未決。
⚠ D-135 で、画面は Vercel、集計のサーバーはさくらの VPS に置くことにした（両方の版は手動でそろえる。[15](./15-results-and-stats.md) §5）。API は Vercel 経由で同じオリジンの `/api/*` に中継し、本番の接続先はリポジトリに書かない（D-139・prd/15 §5.3）。
