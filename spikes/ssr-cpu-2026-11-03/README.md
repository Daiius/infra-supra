# スパイク: SSR の 1 リクエストあたり CPU 時間（Cloudflare Workers Free・Astro vs vinext）

（2026-11-03）

## 目的

見積のテンプレート（`packages/catalog/src/templates/index.ts` の `articleCommunity`）は、個人化されたページ
（ログイン中の人のフィード・マイページ）を **CPU 15 ms + I/O 待ち 65 ms・応答 60 KB** と仮定している。
Workers Free の CPU 上限は **1 リクエスト 10 ms**。この仮定の CPU の部分を、フレームワークごとの実測に置き換える。

- 比べるのは **Astro**（`@astrojs/cloudflare`）と **vinext**（Cloudflare による Vite 製の Next.js の再実装。
  Cloudflare の Next.js ガイドが既定として推す。https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ ）。
- OpenNext は対象外。
- 先行の公開実測は見当たらなかった（調査メモは手元の `.claude-personal/`）。

## 測るもの

同じ「個人のフィード」ページを両方で作り、本番の Workers（Free）で **CPU 時間の分位（p50 / p90 / p99）** を
フレームワーク × サイズごとに取る。

- データはメモリ上で決定論的に作る（`shared/feed.ts`。fetch も DB も無い）。I/O 待ちが無いので、測れるのは描画（とルーティング等の枠組み）の CPU だけ。
- `?items=N` で記事数を変える。**items=10（約 20 KB）と items=30（約 60 KB）** の 2 点。
- マークアップは同じ構造: ヘッダー・ナビ、ユーザーの概要カード、フィード（題・抜粋 約 300 字・著者・日時・タグ・いいね/コメント数・操作ボタン・先頭コメント）、サイドバー、フッター。CSS も同じ文字列を `<style>` で入れる。
- 書き方は各フレームワークの素直な形: Astro は `.astro` コンポーネント（`export const prerender = false`）、
  vinext は App Router の React Server Components（`dynamic = "force-dynamic"`）。クライアントの島は無し。
- キャッシュはしない（Astro は `Cache-Control: no-store`、vinext は動的ルート・CDN キャッシュ無しの初期化）。

### HTML のサイズ（ローカルで実測）

| | items=10 | items=30 |
|---|---|---|
| Astro | 23,684 B | 62,956 B |
| vinext | 76,207 B（うち `<script>` 内の RSC ペイロード等 約 50 KB） | 184,632 B（同 約 117 KB） |

vinext の **見える部分のマークアップは Astro とほぼ同じ**（script を除くと 25 KB / 66 KB）。差は App Router が
水和用に同じツリーを RSC ペイロード（エスケープされた JSON）として HTML に埋め込む分。島が無くても埋め込まれる。
これは App Router を使う限り付いてくる費用なので、そのまま測る（転送量の仮定 60 KB にも効く点に注意）。

## 版（2026-11-03 時点の最新に固定）

| | 版 |
|---|---|
| astro | 7.4.5 |
| @astrojs/cloudflare | 14.4.4（内部の @cloudflare/vite-plugin 1.66.0） |
| vinext | 1.4.1 |
| react / react-dom / react-server-dom-webpack | 19.3.1 |
| @vitejs/plugin-rsc | 0.5.38 |
| @cloudflare/vite-plugin（vinext 側） | 1.67.0 |
| vite | 8.3.5 |
| wrangler | 4.156.2 |
| compatibility_date | 2026-11-02（`nodejs_compat`） |

ロックファイル（各 `pnpm-lock.yaml`）も入れてある。

## 構成

```
spikes/ssr-cpu-2026-11-03/
  shared/feed.ts     両アプリが import する決定論的データと CSS
  astro/             Astro（/feed）。Worker 名 ssr-cpu-astro
  vinext/            vinext App Router（/feed）。Worker 名 ssr-cpu-vinext
  deploy.sh          build → wrangler deploy（--check で中身だけ表示）
  load.sh            サイズごとに直列で 300 回ずつ送る
  results.sh         GraphQL Analytics API から CPU 時間の分位を取る
  local-bench.sh     ローカル（wrangler dev）での相対比較
```

- 2 つのアプリはそれぞれ独立した pnpm のルート（各ディレクトリに `pnpm-workspace.yaml`）。リポジトリ直下の
  workspace は `packages/*` だけなので、ルートの `pnpm install` / `typecheck` / `test` には入らない。
- 両方の `wrangler.jsonc` で `observability.enabled = true`（Workers Logs に CPU time / Wall time が残る。Free でも可・1 日 20 万件・保持 3 日）。
- Astro はセッション（KV）と Images のバインディングを切ってある（`astro.config.mjs`）。既定のままだと deploy で KV namespace が自動作成されるため。
- vinext の設定は `vinext init --platform=cloudflare --legacy-wrangler-cloudflare-init --cdn-cache=none` の生成物に observability を足したもの。

## 手順

前提: Node 24・pnpm 11・jq・curl。

```bash
cd spikes/ssr-cpu-2026-11-03

# 1. ログイン（初回だけ。ブラウザが開く）
npx wrangler login

# 2. deploy（--check で何をするかだけ見られる）
./deploy.sh --check
./deploy.sh                # 最後に workers.dev の URL が出る

# 3. 負荷（数分。サイズの切り替えで分の境目まで待つ）
./load.sh https://ssr-cpu-astro.<subdomain>.workers.dev https://ssr-cpu-vinext.<subdomain>.workers.dev

# 4. 集計（集計の遅延があるので load の数分後に）
export CLOUDFLARE_ACCOUNT_ID=<アカウント ID>
export CLOUDFLARE_API_TOKEN=<Account Analytics: Read のトークン>
./results.sh --schema      # 分位のフィールド名と単位の説明を確かめる（任意）
./results.sh               # runs/ の最新を集計
```

Claude Code のセッション内で動かすなら `! ./deploy.sh --check` のように `!` を付ける。

### load.sh の中身

- サイズ（items=10 → 30）ごと・アプリごとに **300 回を直列**（同時に送らない）。
- 最初に各アプリへ 5 回の暖機を送り、計測の窓には入れない（コールドスタートを除く）。
- GraphQL の `workersInvocationsAdaptive` は Worker 名（`scriptName`）では分けられるが、**URL（path・query）では分けられない**。
  そこでサイズを **時間帯で分ける**: 各サイズの計測を分の境目から始め、次のサイズは次の分の境目まで待つ。
  窓は `runs/<日時>/windows.tsv`、各リクエストの HTTP コード・サイズ・TTFB は `runs/<日時>/requests.tsv` に残る（`runs/` は git 管理外）。
- リクエスト数は 2 アプリ × 2 サイズ × 305 ≒ 1,220 回。Free の 1 日 10 万リクエストに十分収まる。
- 非 200（503・Error 1102）が出たら、CPU 上限（10 ms）超過の可能性。results.sh の `status` 列にも出る（`exceededResources` 等）。

### results.sh の中身

- エンドポイント `https://api.cloudflare.com/client/v4/graphql`、データセット `viewer.accounts.workersInvocationsAdaptive`、
  フィルタ `scriptName` / `datetime_geq` / `datetime_leq`、`quantiles { cpuTimeP50 … }`、`sum { requests errors }`、`dimensions { status }`。
- トークンの権限: **Account → Account Analytics → Read**（ダッシュボードの「My Profile → API Tokens → Create Custom Token」）。
  トークンと ID は環境変数で渡すだけで、ディスクには書かない（curl へもコマンドライン引数でなく標準入力から渡す）。
- 出力: フレームワーク × items × status ごとの requests・errors・CPU p50/p90/p99/p99.9・wall p50。生の応答は `runs/<日時>/results.json`。

### ダッシュボードで見る（代わりの方法）

Workers & Pages → `ssr-cpu-astro`（または vinext）→ **Observability（Workers Logs）** → クエリビルダーで

- 可視化: **CPU Time の Median**（P90・P99 も選べる）
- フィルタ: リクエストの URL が `items=10` を含む / `items=30` を含む（ログはリクエスト単位なので、ここでは URL でサイズを分けられる）
- 時間帯: load.sh を流した時間

フィールドの正確なキー名（`$workers.cpuTimeMs` など）は未確認。画面の候補から「CPU Time」を選ぶ。
Workers の Metrics タブの「CPU Time per execution」（分位）でも、サイズの時間帯ごとに目視できる。

## ローカルでの相対比較（参考）

```bash
./local-bench.sh --requests 100     # build → wrangler dev → 計測 → 停止 をアプリごとに
```

ループバックで応答完了までの時間（`curl` の `time_total`）を測る。**手元の CPU と本番の Workers は違い、
ネットワーク・TLS も無いので、10 ms に収まるかの判定には使わない**。フレームワーク間の比の目安だけ。
サーバーはスクリプトの中で起動して必ず止める（プロセスグループごと TERM → 残れば KILL）。

2026-11-03 の手元の値（各 100 回・中央値 / p90。wall 時間で CPU 時間ではない。Linux x86_64 のデスクトップ）:

| | items=10 | items=30 |
|---|---|---|
| Astro | 5.9 / 6.7 ms | 6.2 / 7.3 ms |
| vinext | 13.7 / 15.3 ms | 16.4 / 19.6 ms |

- Astro はサイズを 3 倍にしても 0.3 ms しか増えない。手元の値には `wrangler dev` の前段（プロキシ）と curl の固定の時間が
  数 ms 乗っていると見られる（推測）ので、**比ではなく差で読む**: vinext は Astro より items=10 で約 8 ms、items=30 で約 10 ms 多い。
- 本番の CPU 時間がこの差を保つなら、vinext は Free の 10 ms に近いか超える側、Astro は下回る側の見込み（推測。本番で確かめる）。

## 片付け

```bash
(cd astro && pnpm exec wrangler delete --name ssr-cpu-astro)
(cd vinext && pnpm exec wrangler delete --name ssr-cpu-vinext)
```

Workers Logs は保持期間（Free 3 日）で消える。

## 見積への戻し方

- results.sh の **items=30（≒ 60 KB）の CPU p50** を、そのフレームワークの「個人化されたページ」の `cpuMs` にする
  （今は Next.js 想定で一律 15 ms。`packages/catalog/src/templates/index.ts`）。p90 / p99 は Free の 10 ms 上限に
  どれだけ当たるか（超過の割合）の判断に使う。
- 今の仮定はフレームワークで `cpuMs` を変えていない。値が大きく違えば、FrameworkProfile 側に「SSR の CPU の係数」を持たせる
  （フレームワーク固有の扱いはデータに閉じ込める。prd/06）。
- このページは I/O を含まない。実際のページの CPU は「描画（ここで測る）+ DB の応答の処理（JSON の解析など）」なので、
  ここの値は下限寄り。
- vinext の HTML は RSC ペイロードの分だけ大きい（60 KB のページで約 3 倍）。転送量の仮定（`responseKB`）にも効く。

## 未確認

- GraphQL の分位フィールドのうち公式のチュートリアルで確認できたのは `cpuTimeP50` / `cpuTimeP99` だけ。`cpuTimeP90` / `cpuTimeP999` / `wallTimeP50` は未確認
  （失敗したら results.sh が P50/P99 だけで取り直す）。
- 分位の **単位はマイクロ秒と想定**（未確認）。`./results.sh --schema` の説明で確かめ、違えば換算を直す。
- `workersInvocationsAdaptive` の標本抽出が数百件の規模で効くか、`datetime` の粒度（窓を分単位で切っているのはそのため）。
- Workers Logs の CPU time のキー名。
