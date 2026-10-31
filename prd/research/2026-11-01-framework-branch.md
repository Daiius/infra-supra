# 調査メモ: Vite の SPA と Next.js の分岐・API の置き場（2026-11-01 取得）

> [prd/10](../10-framework-branch.md) の根拠。公式の文書だけを出典にし、書かれていないことは「記載なし」「未確認」とする。
> 推測は「推測」と書く。catalog にはまだ入れていない（入れるときは prd/03 §1 の規律で出典と取得日を付ける）。

## 1. Cloudflare（Workers の静的アセット）

出典: <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>・
<https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/>・
<https://developers.cloudflare.com/workers/platform/limits/>・
<https://developers.cloudflare.com/workers/reference/how-workers-works/>（いずれも 2026-11-01 取得）

- 静的アセットへのリクエストは**無料・無制限**。アセットの保存にも追加の費用はない。Worker のスクリプトを起動したリクエストだけが Workers の料金で課金される（billing-and-limitations）。
  - catalog には `cloudflare.ts` の `notes` に同じ趣旨の文があるだけで、出典つきの事実（`facts`）にはなっていない。
- SPA のフォールバック: `assets.not_found_handling = "single-page-application"` で、どのアセットにも一致しないリクエストに `/index.html` を 200 で返す。
- ナビゲーション（`Sec-Fetch-Mode: navigate`）のリクエストは、Worker のスクリプトがあり `not_found_handling` が設定され、互換日が 2025-04-01 以降（またはフラグ）なら **Worker を起動しない**（課金されない）。ブラウザの `fetch("/api/…")` は Worker に届く。
- `run_worker_first`（例: `["/api/*", "!/api/docs/*"]`）で一致するパスは常に Worker を起動し、Worker の起動として課金される。Free で上限を超えると、アセットに戻らず **429** を返す。
- 制限: アセットのファイル数は Worker の版あたり Free 20,000・Paid 100,000。1 ファイル 25 MiB（limits）。
- Worker の起動: isolate は「VM のモデルのコールドスタートをなくす」「Node のプロセスより 100 倍ほど速く起動する」（how-workers-works）。グローバルスコープの評価は 1 秒以内（limits）。
- Cloudflare Pages は今回は読んでいない（MVP の構成は Workers の静的アセットを使っている。prd/06 §4）。

## 2. Vercel

出典: <https://vercel.com/docs/frameworks/frontend/vite>（2026-08-26 更新）・<https://vercel.com/docs/manage-cdn-usage>（2026-09-14 更新）・
<https://vercel.com/docs/rewrites>（2026-08-11 更新）・<https://vercel.com/docs/functions/configuring-functions/region>（2026-08-11 更新）・
<https://vercel.com/kb/guide/improve-function-cold-start-performance-on-vercel>（2026-07-23 更新）（いずれも 2026-11-01 取得）

- Vite の SPA は、`vercel.json` の `rewrites`（`/(.*)` → `/index.html`）でディープリンクを動かす。「本番は Multi-Page App のモードを推奨」とも書いている（vite）。
- Vite のアプリに関数を足すには「Vite を土台にしたフレームワークの方法」か Nitro を推奨（vite）。素の Vite で `/api` に関数を置く方法はこのページには**記載なし**（未確認）。SSR も Nitro を推奨。
- 静的な配信の課金: **静的アセットも関数も CDN Requests を生む**。Fast Data Transfer は CDN と訪問者の間の転送で、静的ファイルも含む。Fast Origin Transfer は Functions・Middleware・Blob・Data Cache（ISR）で生じる（manage-cdn-usage）。
  → 既存の catalog（`vercel.ts` の CDN Requests・FDT・FOT）と既存の `cdn` ノードで足りる。静的配信に新しいメーターは要らない。
- 外部のオリジンへの rewrite（`/api/:path*` → 別の API）で、Vercel を逆プロキシにできる（同じドメインに見せられる）。上流の `Cache-Control` を尊重してキャッシュする（2026-04-06 以降の新規プロジェクトの既定）（rewrites）。
  外部への rewrite が Fast Origin Transfer や CDN Requests をどう生むかは**記載なし**（未確認）。
- 関数の既定のリージョンは新規プロジェクトで `iad1`（米国東部）。データ源（DB）の近くに置くよう勧めている。Hobby は 1 リージョン、Pro は 5 リージョン（region）。
- コールドスタート: 関数の最初の起動。依存の大きさで伸びる。本番で 2 週間使われないと archive され、その後の最初の起動に少なくとも 1 秒が加わる。Fluid は同じインスタンスで同時に処理し、有料プランでは本番のインスタンスを温めておく（kb）。

## 3. Next.js

出典: <https://nextjs.org/docs/app/guides/static-exports>（2026-08-09 更新）・<https://nextjs.org/docs/app/guides/single-page-applications>（2026-10-15 更新）（いずれも 2026-11-01 取得）

- `output: 'export'` でルートごとの HTML を出す。静的ファイルを配れるどのサーバーにも置ける（nginx の `try_files` の例つき）。
- Server Components はビルドの時に動く。Route Handler は `GET` だけで、ビルドの時に静的な応答になる。
- **使えない機能**: `dynamicParams: true` の動的ルート・`generateStaticParams()` のない動的ルート・Request に依る Route Handler・Cookies・Rewrites・Redirects・Headers・Proxy（Middleware）・**ISR**・既定のローダーでの画像の最適化（カスタムローダーなら可）・Draft Mode・**Server Actions**・Intercepting Routes。
- 「strict SPA」は 1 つの HTML とブラウザの JS ですべてを描く形。初回の操作までに多くの JS を読み込みがちで、クライアントのデータ取得の滝が問題になる、と書く。静的書き出しは「ルートごとの HTML で、JS を待たずに内容が見える」点で strict SPA より有利、と書く。
- `use(browser())` の説明で「JavaScript を実行しないクローラーはフォールバックを見る」と書いている（JS を実行しないクローラーがいる前提の記述）。

## 4. Vite

出典: <https://vite.dev/guide/static-deploy>（2026-11-01 取得）

- ビルドの出力は `dist`。好きなプラットフォームに置ける静的なデプロイとして説明している。Vercel・Cloudflare（Workers と Pages）を含む多数の手順がある。
- `appType: 'spa'` やフォールバックの一般的な説明はこのページには**記載なし**（Firebase の例の rewrite だけ）。

## 5. 検索・SNS のカード（OGP）

出典: <https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>（2026-03-04 更新）・
<https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/>・<https://api.slack.com/robots>（いずれも 2026-11-01 取得）

- Google: JavaScript のアプリをクロール・レンダリング・インデックスの 3 段で処理する。レンダリングの待ち行列には「数秒のこともあるが、もっとかかることもある」。headless Chromium で JS を実行し、描画後の HTML でインデックスする。
  それでも「サーバー側のレンダリングや事前レンダリングは良い考え」「**すべてのボットが JavaScript を実行できるわけではない**」と書く。
- Facebook のクローラー: Open Graph のプロパティはページの最初の 1 MB の中に置く。数秒以内に内容に届く必要がある。**JS を実行するかは記載なし**。
- Slack: oEmbed・Twitter Card・Open Graph のタグを探し、HTTP の Range で「できるだけ少なく」取得する。**JS を実行するかは記載なし**。
- X（Twitter）のカードの文書は今回取得できなかった（402・404）。
- **推測**: Range で頭の部分だけを取る・最初の 1 MB に置く、という書き方から、SNS のカードは**サーバーが返す HTML の中のメタタグ**を読むと見るのが自然。ただし「JS を実行しない」とは公式に書かれていない。
  ゲームで OGP の効き方を使うなら、事実ではなく**ゲーム上の仮定**として扱う。

## 6. Cookie（API を別のサイトに置く場合）

出典: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie>（2026-11-01 取得。ブラウザの仕様の解説）

- `SameSite` は「別のサイト（スキームを含む）からのリクエストに Cookie を送るか」。`Lax` は同じサイトと、別のサイトからのトップレベルのナビゲーションのうち安全なメソッドだけ。`None` は `Secure` が必須。
  `SameSite` を付けないと `Lax` を既定にするブラウザがある。
- サードパーティ Cookie をブラウザが既定で遮断するかは、このページには**記載なし**（未確認。各ブラウザの文書で確かめる）。
- 推測: API を**同じサイトのサブドメイン**（例: `api.example.com`）に置けば `Lax` のままで送れる。**別のサイト**（事業者の既定のドメインなど）だと `None; Secure` が要り、遮断の影響を受けうる。CORS は同じサイトでも別オリジンなら要る。

## 7. 今の catalog の料金データで足りるか

| 要るもの | 今の catalog | 不足 |
|---|---|---|
| Cloudflare の静的アセット（無料・無制限） | `notes` の文だけ | 出典つきの事実にする（`facts`）。ファイル数の制限（Free 2 万・Paid 10 万）は未収録 |
| Cloudflare の `run_worker_first` の課金・Free の 429 | なし | 事実と制限として足す（OGP の前処理の部品で使う） |
| Vercel の静的配信 | CDN Requests・FDT（既存） | なし |
| Vercel の外部への rewrite の課金 | なし | 未確認（公式に記載なし） |
| Vercel の関数の既定リージョン | なし | 事実として足す（API を Supabase と離して置く前提の文） |
| さくらの VPS で nginx が静的を配る | ホストの CPU・回線（既存。D-31 で nginx の CPU の仮定） | なし |
| Supabase のリージョン・pooler | pooler 200 接続（既存） | リージョンの一覧は未取得（遅延は計算しないので今は要らない） |
| Workers・Vercel・VPS のコールドスタート | なし | 数値の料金ではないので事実の文だけ（Vercel の archive 後 1 秒以上など） |
