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

圧縮後の大きさ（2026-11-11 に同じ HTML の見本を `gzip -9` で縮めた値。見積の大きさを転送の大きさ＝圧縮後で持つ D-211・
App Router の文書の倍率 D-212 の根拠）:

| | items=10 | items=30 |
|---|---|---|
| Astro | 23.7 KB → **4.6 KB** | 63.0 KB → **8.8 KB** |
| vinext | 76.2 KB → **11.6 KB** | 184.6 KB → **22.0 KB** |
| vinext ÷ Astro（圧縮後） | 2.5 | 2.5 |

RSC の埋め込みは同じツリーの繰り返しなのでよく縮むが、圧縮後でも Astro の約 2.5 倍が残る。本家の Next.js 16.4.6 も圧縮前で同じ形
（下の表。全体 ÷ 見える部分が 2.7〜2.8）なので、App Router の文書は圧縮後で約 2.5 倍とみる（Next.js の圧縮後の値は測っていない）。

> 表の値は、架空のユーザー名を今の `Alex Example` に替える（2026-11-11。前の名前は 1 文字長かった）前に測ったもの。
> 今の `shared/feed.ts` で作ると、名前とハンドルが出る箇所ごとに 1 バイトずつ小さくなる（数十バイトの差で、表の読み方は変わらない）。
> 本番の結果（`results/2026-11-11-workers-free/requests.tsv`）も替える前のコードで測った。

### 本家の Next.js との比べ（2026-11-11・手元）

本家の Next.js（App Router）でも、HTML が RSC の埋め込みで同じように大きくなるかを手元で確かめた。
`nextjs/` は vinext と同じページ（`app/`・`components/` は vinext の写し。`"use client"` 無し・`dynamic = 'force-dynamic'`・
`buildFeedPage` の 2 回呼びも同じ）を Next.js 16.4.6 で作ったもの。`next build`（Turbopack）→ `next start`（Node）で
`./local-bench.sh --apps nextjs` を流した。内訳は `html-size.mjs`（正規表現で `<script>` 要素を数える目安）。
Astro・vinext の行は 2026-11-03 の手元の HTML の見本（`runs/local-*`）を同じ道具で数えた値。

| | items=10 全体 | 見える部分（script を除く） | script（うち RSC の埋め込み） | 全体 ÷ 見える部分 |
|---|---|---|---|---|
| Astro | 23,684 B | 23,684 B | 0 B | 1.00 |
| vinext 1.4.1 | 76,207 B | 25,380 B | 50,827 B（`vinext.navigationRuntime` の `rsc` 49,227 B） | 3.00 |
| Next.js 16.4.6 | 71,195 B | 25,146 B | 46,049 B（`self.__next_f` 45,380 B） | 2.83 |

| | items=30 全体 | 見える部分（script を除く） | script（うち RSC の埋め込み） | 全体 ÷ 見える部分 |
|---|---|---|---|---|
| Astro | 62,956 B | 62,956 B | 0 B | 1.00 |
| vinext 1.4.1 | 184,632 B | 66,572 B | 118,060 B（116,460 B。2 つの script に分かれる） | 2.77 |
| Next.js 16.4.6 | 179,469 B | 66,338 B | 113,131 B（`self.__next_f` 112,462 B） | 2.71 |

- Next.js も **同じように約 2.7〜2.8 倍** になる。RSC の埋め込みは App Router の性質で、vinext に固有のものではない。
- Next.js は vinext より 4〜6 KB（6〜8%）小さい。埋め込みの中身はどちらも同じ Flight の行（`\"` でエスケープした文字列）で、
  vinext は境界の部品（`LayoutSegmentProvider`・`BfcacheChildrenBoundary`・`Unauthorized` / `Forbidden` / `NotFound` の境界・
  `AppRouterScrollTarget` など）の参照の行が多く、`\\` のエスケープも多い（推測。items=10 の埋め込みの先頭の行とエスケープの数を比べただけ）。
- Next.js の行は名前を `Alex Example` に替えた後のコードで測ったので、vinext より名前の分（数十バイト）小さく出る。表の読み方は変わらない。

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
| next（`nextjs/`。手元の比べだけ・2026-11-11 時点の最新の安定版） | 16.4.6（react / react-dom 19.3.1） |

ロックファイル（各 `pnpm-lock.yaml`）も入れてある。

## 構成

```
spikes/ssr-cpu-2026-11-03/
  shared/feed.ts     両アプリが import する決定論的データと CSS
  astro/             Astro（/feed）。Worker 名 ssr-cpu-astro
  vinext/            vinext App Router（/feed）。Worker 名 ssr-cpu-vinext
  nextjs/            本家の Next.js App Router（/feed）。手元の next start だけ（deploy しない）
  deploy.sh          build → wrangler deploy（--check で中身だけ表示）
  load.sh            サイズごとに直列で 300 回ずつ送る
  results.sh         GraphQL Analytics API から CPU 時間の分位を取る
  local-bench.sh     ローカル（wrangler dev / next start）での相対比較と HTML の大きさ
  html-size.mjs      HTML の大きさの内訳（全体・script を除く・RSC の埋め込み）
  results/           本番の結果のうち残すもの（runs/ は git 管理外）
```

- 3 つのアプリはそれぞれ独立した pnpm のルート（各ディレクトリに `pnpm-workspace.yaml`）。リポジトリ直下の
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
./local-bench.sh --requests 100     # build → wrangler dev / next start → 計測 → 停止 をアプリごとに
./local-bench.sh --apps nextjs      # 1 つだけ（--port で待ち受けのポートを替えられる。既定 8799）
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

2026-11-11 の手元の Next.js 16.4.6（`next start`・Node。各 100 回・中央値 / p90）: items=10 は 4.5 / 5.7 ms、items=30 は 6.7 / 8.1 ms。
**wrangler dev（workerd とその前段のプロキシ）を通らないので、上の表の Astro・vinext とは同じ物差しではない**（日も違う）。
Next.js と workerd 上の vinext の CPU を比べたいなら、同じ実行環境で測り直す必要がある。

## 本番の結果（2026-11-11）

生の値は [`results/2026-11-11-workers-free/`](./results/2026-11-11-workers-free/)（`results.json` は GraphQL の応答・
`windows.tsv` はサイズごとの時間の窓・`requests.tsv` は各リクエストの HTTP コード・バイト数・TTFB）。
`runs/` は git 管理外なので、本番の 1 回分だけをここへ写した（アカウント ID・URL は含まない）。

### 条件

- Workers **Free**・workers.dev のサブドメイン。
- 各アプリへ暖機 5 回の後、サイズ（items=10 → 30）ごとに **直列で各約 300 回**。
- サイズは **時間の窓で分けた**（items=10 は 02:13:00〜02:14:59Z、items=30 は 02:15:00〜02:16:59Z。UTC）。
- CPU 時間は GraphQL Analytics の `workersInvocationsAdaptive` の `quantiles.cpuTime*`。
  スキーマの説明で **単位はマイクロ秒** と確かめた（下の表は ms に換算）。

### CPU 時間の分位（ms）

| | 回数 | p50 | p90 | p99 | p99.9 | wall p50 |
|---|---|---|---|---|---|---|
| Astro items=10（約 23 KB） | 300 | 2.62 | 6.19 | 20.34 | 25.39 | 3.56 |
| Astro items=30（約 62 KB） | 308 | 3.47 | 8.19 | 21.62 | 30.02 | 4.84 |
| vinext items=10（約 74 KB） | 301 | 18.39 | 39.71 | 100.2 | 197.45 | 20.59 |
| vinext items=30（約 180 KB） | 298 | 31.53 | 53.76 | 91.22 | 97.07 | 34.78 |

- 回数は GraphQL の `sum.requests`（全 1,207 回）。load.sh が窓の中で送ったのは各 300 回（`windows.tsv`）で、ずれの理由（標本抽出の推定か窓の端か）は未確認。全部が `status: success`・`errors` 0。
- 手元の `requests.tsv` でも全部 HTTP 200 で、**Error 1102（exceededCpu）は 0 件**。
- 平均 TTFB（ネットワーク込み・手元から）: Astro 137 / 131 ms、vinext 149 / 159 ms（items=10 / 30）。

### 読み方

- **Astro** は p50 で Free の上限 10 ms を大きく下回る（2.6〜3.5 ms）。p90 も下回るが、p99 は 20 ms を超える。
- **vinext** は p50 で常に上限の 2〜3 倍（18〜32 ms）を使ったが、1102 で止まったリクエストは無かった。
- Free の 10 ms は厳密な打ち切りではない。公式の limits のページ（https://developers.cloudflare.com/workers/platform/limits/ 。
  2026-10-29 更新・2026-11-11 取得）は「Each isolate has some built-in flexibility ... infrequently runs over」とし、
  「If your Worker starts hitting the limit consistently, its execution will be terminated」とも書く。
  Cloudflare の社員はフォーラムで isolate ごとの「rollover bank」（使わなかった分を貯めて超過に充てる）と説明している
  （https://community.cloudflare.com/t/worker-cpu-time-rollover/187072 。原文は未確認）。
- 今回は 1 アプリ・1 サイズあたり 2 分・約 300 回の短い観測なので、**vinext が Free で「止まらない」とは言えない**。
  いつ止まり始めるかの閾値を公開で実測したものは見つからなかった。

### vinext が重い理由（推測）

- App Router（RSC）は 1 リクエストで同じ木を 3 回扱う: RSC で木を Flight の形式に書き出す → それを読み戻して
  react-dom/server で HTML にする → Flight を `<script>` へエスケープして HTML に埋め込む。Astro は木を HTML に 1 回書くだけ。
- items を 10 → 30 にしたときの p50 の増え方は Astro +0.9 ms・vinext +13 ms。記事 1 件あたりの費用が 1 桁違う。

### 既知の非最適化

- vinext のページ（`vinext/app/feed/page.tsx`）は `generateMetadata` と本体で `buildFeedPage` を 2 回呼ぶ。
  React の `cache()` で 1 回にできる。データ作りは軽いので、影響は 1 ms 程度の見込み（未計測）。
- バンドルに React の開発版の印は無かった（本番ビルドで測っている）。

## 片付け

```bash
(cd astro && pnpm exec wrangler delete --name ssr-cpu-astro)
(cd vinext && pnpm exec wrangler delete --name ssr-cpu-vinext)
```

Workers Logs は保持期間（Free 3 日）で消える。

2026-11-11 の計測の後、両方の Worker は削除済み。

## 見積への戻し方

> 2026-11-11 時点で、上の本番の結果はまだ見積に反映していない（どう戻すかはユーザーが論点を検討中。D-209）。
> 以下は計測の前に書いた案。

- results.sh の **items=30（≒ 60 KB）の CPU p50** を、そのフレームワークの「個人化されたページ」の `cpuMs` にする
  （今は Next.js 想定で一律 15 ms。`packages/catalog/src/templates/index.ts`）。p90 / p99 は Free の 10 ms 上限に
  どれだけ当たるか（超過の割合）の判断に使う。
- 今の仮定はフレームワークで `cpuMs` を変えていない。値が大きく違えば、FrameworkProfile 側に「SSR の CPU の係数」を持たせる
  （フレームワーク固有の扱いはデータに閉じ込める。prd/06）。
- このページは I/O を含まない。実際のページの CPU は「描画（ここで測る）+ DB の応答の処理（JSON の解析など）」なので、
  ここの値は下限寄り。
- vinext の HTML は RSC ペイロードの分だけ大きい（60 KB のページで約 3 倍）。転送量の仮定（`responseKB`）にも効く。

## 未確認

- ~~GraphQL の分位フィールドのうち `cpuTimeP90` / `cpuTimeP999` / `wallTimeP50` は未確認~~ → 2026-11-11 の本番で全部取れた。
- ~~分位の単位はマイクロ秒と想定~~ → `./results.sh --schema` のスキーマの説明でマイクロ秒と確かめた（2026-11-11）。
- vinext が Free で上限を常に超えたとき、どれだけ続けば止められるか（上の「読み方」）。
- `workersInvocationsAdaptive` の標本抽出が数百件の規模で効くか、`datetime` の粒度（窓を分単位で切っているのはそのため）。
- Workers Logs の CPU time のキー名。
