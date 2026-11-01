# 10. フレームワークの分岐（Vite の SPA か Next.js か）と API の置き場

> 状態: **確定（2026-11-01・D-34）・段 1 は実装済み（§7）・API の応答のキャッシュを部品として追加（§8・D-37）・段 2（API の置き場）を実装（§9・D-65・2026-11-02）・段 3（Next.js の API・VPS の API）を実装（§9.5〜・D-67）**。F-01〜F-14 はユーザーが**推奨どおり一括で**決めた（§5）。
> 段 1 で入れたのは F-01・F-02・F-04・F-05・F-07（F-09 は記録だけ）。段 2 で F-10〜F-13 を入れた（§9）。段 3 で F-14（Next.js でも API を別に置く）を入れた（§9.5・D-67）。F-03・F-06・F-08 は**後の段**（§3.5・§5・§9.4）。
> 調査の根拠は [調査メモ](./research/2026-11-01-framework-branch.md)（公式の文書・2026-11-01 取得）。
> ここに出てくる効き方の大きさ（倍率・手間・段階）は**ゲーム上の仮定**で、実在の値ではない。

## 0. ユーザーの問いへの答え（要約）

- **考慮できる**。06 の「FrameworkProfile → BuildOutput → DeployTarget」は、まさにこの分岐のために置いた設計で、まだ実装していないだけ。
  今の catalog の構成（Cloudflare + vinext・Vercel + Supabase・さくらの VPS の `next start`）はすべて「Next.js 系」の 1 列で、SPA の列が空いている。
- 費用の差は**思ったより小さい**（§1.3。記事コミュニティでは画像と転送量が支配的で、ISR と SSR がなくなる分だけ減る）。
  差が大きいのは**満足度（初回表示・SNS のカード）と、載せられるホスト・API の置き場**のほう。プロダクトの軸（D-12「前提が生むポイント」）にそのまま乗る。
- **API の置き場**は SPA では必ず決める必要があり、Next.js では既定が同居。順番は「分岐 → API の置き場（事業者をまたぐ選択）」を推奨（§3.5・F-10）。
  分岐の段で SPA の API は「同じ事業者に同居」だけ入れ、別の事業者に置く選択は次の段で入れる。

## 1. 分岐の意味

### 1.1 アプリの形

| | Next.js（App Router。今の構成） | Vite の SPA + API |
|---|---|---|
| HTML | ルートごとにサーバーが作る（ISR・SSR）。`next/link` の遷移も RSC の取得でサーバーに届く | 1 つの静的なシェル（`index.html`）。遷移はブラウザの中で、データは API で取る |
| サーバーの処理 | 同じデプロイの中（Route Handler・Server Actions） | **別のプログラム**（API サーバー）が要る。置き場を選ぶ（§3） |
| ホストに要るもの | Node か、Next.js のアダプター（Vercel はネイティブ・Cloudflare は vinext（D-08）・VPS は `next start`） | 静的ファイルを配れれば何でもよい + API の実行環境 |
| ディープリンク | そのまま | フォールバックの設定が要る（Cloudflare: `not_found_handling = "single-page-application"`・Vercel: `rewrites` で `/index.html`・nginx: `try_files`）。いずれも公式の手順がある（メモ §1・§2・§3） |

Next.js の `output: 'export'`（静的書き出し）は、この 2 つの中間にある。ルートごとの HTML をビルドの時に作るので**内容が JS を待たずに見え、メタタグも HTML に入る**が、
ISR・Server Actions・Cookie・Middleware（Proxy）・リクエストに依る Route Handler・既定の画像の最適化・`generateStaticParams` のない動的ルートが使えない（メモ §3）。
記事コミュニティでは「記事が増えるたびにビルドし直す」形になり、コメント・個人化は SPA と同じく API で取る。→ F-03。

### 1.2 リクエストの種類（prd/01 §3.2・prd/04 §2）

| クラス | Next.js（今） | Vite の SPA |
|---|---|---|
| `document-static` | なし（記事コミュニティでは） | **シェル**。訪問の入口だけ（概ね セッション数 = PV ÷ ページ/セッション）。遷移では生じない |
| `document-isr`・`isr-revalidate` | 記事（60%）。閲覧はキャッシュ、再生成は PV でなく在庫で頭打ち | **なし** |
| `document-ssr` | 個人化（40%） | **なし** |
| `asset` | JS・CSS（ページあたり 10・ブラウザの再利用 0.7） | JS の束は大きくなりがち（仮定）。ただし遷移で読み直さないので、件数は入口に比例 |
| `api` | ページあたり 1 回（コメントの取得など） | ページあたり 1 回 + **データの取得**（記事・個人化の中身。HTML の描画がない分 CPU は軽い・仮定） |
| `image-*` | 変わらない | 変わらない |

- 記事の閲覧は、Next.js では「ISR のキャッシュ（CDN・KV）から返る」のに対し、SPA では「毎回 API → DB」になる。
  API の応答を CDN でキャッシュすれば ISR に近づく（Vercel は上流の `Cache-Control` を尊重する。メモ §2）。キャッシュするかは SPA 側の判断ポイント（F-01 の付随）。
- **鮮度**は SPA のほうが良い（API を毎回読むなら記事は常に新しい。今の「キャッシュしない」部品と同じ扱い・D-24）。

### 1.3 費用（今の catalog と estimator での概算）

SPA を今の型で近似して回した値（2026-11-01・シナリオの外。近似: HTML は静的なシェル 1 つを全 PV で数える＝上振れ、データの API は 1 ページ +1 回・CPU 7 ms・I/O 50 ms・2 クエリ（仮定））。

| 月間 PV | Cloudflare Paid（vinext → SPA） | Vercel Pro + Supabase Pro | さくらの VPS 2GB |
|---|---|---|---|
| 30 万 | $10 → $10 | $45 → $45 | ¥1,958 → ¥1,958 |
| 300 万 | $14 → $10 | $180 → $156 | 同じ（固定費） |
| 1,000 万 | $34 → $15（KV の書き込みが消える） | $929 → $853 | 同じ（固定費） |

- 費用の差は ISR（KV の書き込み・ISR の読み書き）と SSR の関数の分だけ。Vercel の大部分は画像と Fast Data Transfer で、どちらでも変わらない。
- Cloudflare Free では、Next.js は SSR の 15 ms が**1 リクエスト CPU 10 ms**に当たるが、SPA の API（7 ms と仮定）は当たらない。**API の重さの仮定しだいで反転する**ので、
  見積の「重要な前提」（prd/01 §8 の `estimate-key-point`）として境目を出すのがよい。
- 静的なシェル・JS・CSS は、Cloudflare では**無料・無制限**（Worker を起動しない。ナビゲーションも Worker を起動しない・メモ §1）、Vercel では CDN Requests と FDT に数える（既存のメーター）、VPS では nginx の CPU と回線。

### 1.4 満足度・ホスト・API の置き場

| 観点 | Next.js | Vite の SPA | 根拠 |
|---|---|---|---|
| 初回表示 | HTML に内容が入っている | シェル → JS → API の順に待つ。2 回目以降の遷移は速い | Next.js の文書（strict SPA は初回の JS が多く、データの滝になりがち）。どれだけ遅いかは**仮定** |
| 検索 | 問題なし | Google は JS を描画してインデックスする（待ち行列あり）。SSR・事前レンダリングを推奨し、「すべてのボットが JS を実行できるわけではない」 | Google の文書（メモ §5）。流入への影響の大きさは公式の数値がない |
| SNS のカード（OGP） | 記事ごとのメタタグが HTML に入る | シェルのメタタグは全ページ同じ。記事ごとのカードにするには、サーバー側で HTML にメタタグを差し込む処理が要る | Facebook・Slack は HTML の頭を読む書き方だが、JS を実行しないとは書いていない（メモ §5・**推測**）。ゲームでは仮定として扱う |
| 鮮度 | ISR の間隔で決まる | API を毎回読むなら常に新しい | 今のゲームのルール（`freshness`） |
| 載せられるホスト | アダプターしだい（Cloudflare は vinext のみ・D-08） | 静的ファイルを配れればどこでも | Vite の文書・各ホストの手順 |
| API の置き場 | 既定は同居（Route Handler・Worker・`next start`）。別に置くのは任意 | **必須の選択**（同じ事業者に同居でも、別のプログラムとして選ぶ） | §3 |

## 2. 実装の案（06 の最小の実装）

### 2.1 範囲

06 §2 の 3 つの型を、**Next.js と Vite の SPA の 2 つ**が通る最小で作る。vinext は今の Cloudflare の構成を「Next.js の Cloudflare 向けの DeployTarget」として扱う（D-08 のまま）。

| 型 | 最小の形 | 置き場 |
|---|---|---|
| `FrameworkProfile` | `id`（`nextjs` / `vite-spa`）・`renderingModes`・`features`・`sourceIds`。`defaults` は持たない（テンプレートが持つ） | catalog `frameworks/` |
| `BuildOutput` | **新しい型を作らず**、Workload の `routes` + `perPage` + `assets` をそのまま BuildOutput とみなす。フレームワークの違いは「テンプレートの Workload を書き換える関数」に閉じ込める（`applyComponentsToWorkload` と同じ流れ） | catalog |
| `DeployTarget` | `{ framework, platform, adapter, supports }` の表だけ。`mapping` は持たず、構成の組み立て（`composeStack`）が `framework` で分岐する | catalog `stacks/` |

- 06 §2.1 の `BuildOutput`（`middleware`・`imageOptimization` の独立した形）は、Astro や Middleware を足すときに作る。今作ると、使う側がない型が増える。
- `supports` の表（MVP）:

| フレームワーク | Cloudflare | Vercel | さくらの VPS |
|---|---|---|---|
| `nextjs` | `vinext`（ISR は KV など・今の構成） | ネイティブ（今の構成） | `next start`（今の構成） |
| `vite-spa` | 静的アセット + Worker（API） | 静的 + Functions（API）※ | nginx で静的 + Node の API |

※ 素の Vite で Vercel Functions を足す方法は、Vercel の Vite のページでは Nitro などを推奨していて、`/api` のディレクトリの扱いは**未確認**（メモ §2）。データにする前に確かめる。

### 2.2 エンジン（estimator）への拡張

| # | 内容 | 大きさ |
|---|---|---|
| E-1 | `RouteGroup.rendering` に `'spa'` を足す。件数は「入口だけシェル（`document-static`）+ ページごとにデータの API（`dataCalls` と処理）」。prd/04 §2 の「SPA のページ遷移は API として数える」をそのまま式にする。`asset` も入口に比例させる（`perVisit` か `perPage` かを持つ） | 小（resolve・schema・テスト。200 行程度） |
| E-2 | API の応答を CDN でキャッシュするかの値（`api.cacheableShare`・既定 0）。`cdn` の `hitRate` に `api` を許す（今は prd/04 §3.1 で `hit = 0` に固定） | 小 |
| E-3 | 構成の検証で `supports` が `unsupported` の組を落とす（prd/01 §4.2 の検証の純関数） | 小 |

golden（今の Next.js の構成の見積）は E-1〜E-3 で変わらない（新しい値はすべて既定で今と同じ）。

### 2.3 データだけで済む部分（catalog）

| 内容 | 大きさ |
|---|---|
| `FrameworkProfile` 2 つ・`DeployTarget` の表（出典つき） | 小 |
| `composeStack` に `framework` を足し、SPA の 3 構成を組む（Cloudflare: `assets` + `worker`（API だけ）+ D1、Vercel: `cdn` + `fn`（API だけ）+ Supabase、さくら: `vps` 1 つ）。ISR のスロットは SPA では出さない | 中（300 行程度 + テスト） |
| テンプレートの書き換え `toSpa(workload)`（記事・個人化を `spa` に、データの API の値は仮定） | 小 |
| Cloudflare の静的アセットの事実（無料・無制限・ファイル数の制限・`run_worker_first` の課金と Free の 429）を `notes` から `facts`・`limits` へ | 小 |

### 2.4 ゲーム（game・web）

| 内容 | 大きさ |
|---|---|
| 状態に `framework` を足す（保存は id だけ。D-26 の保存の版を上げる） | 小 |
| シナリオに `frameworks: { allowed; default }` を足す（§4） | 小 |
| 満足度のルール: 初回表示（速さに 1 つ足す）・SNS のカード（話題の効き方）・鮮度（SPA は「常に新しい」） | 中 |
| 始める画面の選択・前提の文 | 小 |
| 基準プレイの追加（SPA の 3 構成）と目標の確かめ直し（シード 1〜50） | 中 |

全体の大きさ: 分岐だけなら **estimator 小・catalog 中・game 中**。GD-4 の部品の選択（D-24）より小さい見込み。

## 3. API の置き場（部品のスロットとして）

### 3.1 スロットの案

GD-4 の `composeStack` / `COMPONENTS` の仕組みに、スロット `api`（受け持つクラス: `api`・`image-write`。SPA ではデータの取得も `api`）を足す。

| 部品 | 中身 | Next.js | Vite の SPA |
|---|---|---|---|
| `same`（同居） | 同じデプロイの中。Next.js は Route Handler（vinext は同じ Worker・Vercel は同じ関数・VPS は `next start`）。SPA は同じ事業者の中に別のプログラム（Cloudflare は静的アセットと同じ Worker・Vercel は同じプロジェクトの関数・VPS は同じホストの Node） | **既定** | **既定**（分岐の段ではこれだけ） |
| `cloudflare-workers` | Cloudflare の Worker に置く | 事業者をまたぐ（Cloudflare 以外のとき） | 同上 |
| `vercel-functions` | Vercel の関数に置く | 同上（Vercel 以外のとき） | 同上 |
| `sakura-node` | さくらの VPS の Node に置く | 同上（さくら以外のとき） | 同上 |

非対称:

| | Next.js | Vite の SPA |
|---|---|---|
| API の置き場を選ぶか | 任意（既定は同居。別に置く理由は費用・DB との距離・Node の機能） | **必須**（SPA にはサーバーがない。同居でも「API サーバーを書く」選択） |
| 別に置いたとき残るもの | HTML の生成（SSR・ISR）は元のホストに残る | 元のホストは静的配信だけになる（Cloudflare なら無料・無制限） |
| 典型の組 | Vercel の Next.js + 重い処理だけ VPS | 静的は Cloudflare・API はさくらの VPS（固定費）/ 静的は Vercel・API は Cloudflare Workers |

- 事業者をまたぐ部品は、D-20 の「プロバイダーをまたぐ構成」の 2 例目になる。1 例目はさくらの VPS の前段の Cloudflare（D-31・`frontCdn`）。
  部品が自分の `provider`・`accountId` を持つ決めごと（prd/07 §11.6）がそのまま使える。
- 組を自由にすると 3 × 3 × 2 で 18 通りになり、基準プレイと前提の文が追いつかない。**決まった組だけ**を入れる案（F-11）。

### 3.2 判断ポイント: 既存の catalog の前提に当たるもの（事実）

| 判断 | 当たる前提（catalog・既存） | 出典の状態 |
|---|---|---|
| 同時接続 → DB の接続数 | Supabase Micro の pooler 200 接続（`pool…pooler-connections`）・Hyperdrive の接続先への接続（Free 約 20・Paid 約 100。GD-4 の調査メモ） | 既存 |
| API の CPU | Workers Free の 1 リクエスト CPU 10 ms・Workers Paid の CPU 込み分・Vercel の Active CPU・VPS の CPU | 既存 |
| API のリクエスト数 | Workers の Free 1 日 10 万・Paid 1,000 万込み・Vercel の Invocations・CDN Requests | 既存 |
| 転送量 | Supabase の egress（DB → API）・Vercel の FDT・FOT・さくらの共有回線 | 既存 |
| 静的配信 | Cloudflare の静的アセットは無料・無制限（**`notes` の文だけ**。事実にする）・Vercel の CDN Requests と FDT | 一部要整備 |

### 3.3 判断ポイント: 公式の出典がある事実（catalog には未収録）

| 判断 | 事実 | 出典 |
|---|---|---|
| DB との距離 | Vercel の関数は新規プロジェクトで `iad1`（米国東部）が既定。データ源の近くに置くよう勧める。Hobby は 1 リージョン | メモ §2 |
| コールドスタート | Vercel: 本番で 2 週間使われないと archive され、最初の起動に 1 秒以上加わる。Fluid は同じインスタンスで同時に処理する。Cloudflare: isolate は VM のコールドスタートをなくす | メモ §1・§2 |
| SPA の OGP の前処理 | Cloudflare の `run_worker_first` に一致するパスは Worker の起動として課金。Free で上限を超えると 429（アセットに戻らない） | メモ §1 |
| 同じドメインに見せる | Vercel の外部への rewrite で別の API を同じドメインの下に置ける（逆プロキシ）。課金への効き方は**記載なし** | メモ §2 |
| Cookie | `SameSite=None` は `Secure` が必須。`Lax` は別のサイトからは安全なトップレベルの遷移だけ | メモ §6（MDN） |

### 3.4 ゲーム上の仮定にするもの

| 判断 | 仮定の案 | 理由 |
|---|---|---|
| 事業者をまたぐ往復の遅延 | **計算しない**。前提の文で「計算していない」と明示する（GD-4 の Hyperdrive と同じ。prd/07 §11.6 の 3） | `ArchEdge.boundary` がまだない。rtt の値に公式の出典がない |
| CORS・認証の Cookie | 別の事業者に置くと、**一度きりの手間**（例 2）と「同じサイトのサブドメインに置く」前提の文 | 実装の手間はアプリの性質で、料金ではない |
| 2 つの事業者の運用 | 自前運用（VPS）を含むなら今の `selfHostedUpkeep` をそのまま足す。サーバーレス同士は足さない | 今のルールの延長 |
| API を VPS に置いたときの可用性 | 今の偶発的な障害（`selfHostedChancePerMonth`）を API にだけ効かせる（静的は落ちない → 可用性は「悪い」でなく「普通」） | 静的と API を分けた価値がそのまま見える |

### 3.5 順番（ユーザーの問い「順番に行うべきか」への案）

| 段 | 入れるもの | 理由 |
|---|---|---|
| 1 | 分岐（§2）。SPA の API は `same` だけ | SPA は API の置き場が必須なので、分岐と同時に「既定の置き場」は要る。別の事業者は入れなくても SPA は成り立つ |
| 2 | `api` のスロット（決まった組だけ・遅延は計算しない）。**入れた（§9・D-65）**。SPA だけで、Next.js（F-14）は段 3 に回した | 事業者をまたぐ形が D-31 の 1 例目で固まってから。分岐と同時だと、基準プレイの組み合わせが一度に増えすぎる |
| 3 | 遅延の計算（`ArchEdge.boundary`・rtt の仮定）・Next.js で API を別に置く選択 | 往復の遅延は D-20 の将来の範囲と一緒に |

## 4. ゲームへの入れ方

### 4.1 どこで決めるか

| 案 | 内容 | 良い点 | 弱い点 |
|---|---|---|---|
| A. シナリオのデータ | 記事コミュニティは Next.js、別のシナリオ（管理画面・会員向けの道具など SEO が要らないもの）は SPA | 「アプリの性質でフレームワークが決まる」を素直に表す | 記事コミュニティで SPA の不利を体験できない |
| B. 始める画面の選択 | フレームワーク × 事業者を始めるときに選ぶ | 同じシナリオで差を比べられる。見積モードの比較と同じ | 選んだ瞬間に大勢が決まる（途中の判断にならない） |
| **C. A + B**（推奨） | シナリオが「選べるフレームワークと既定」を持ち、始める画面で選ぶ。記事コミュニティは Next.js が既定・SPA も選べる | B の比べやすさと、シナリオの性格（既定）を両立 | 基準プレイが倍になる |

- 画面の文言は「Next.js（App Router）で作った記事 + コメント」（`packages/web/src/App.tsx`）を、選んだフレームワークで出し分ける。
- 受託のシナリオ（prd/09・別ブランチで設計中）は「案件ごとにフレームワークを変える」を将来の範囲にしている。そこでは**案件の要件（SEO の要否など）がフレームワークを決める**ので、案 A の形（シナリオ・案件のデータが決める）が自然。
  今回の FrameworkProfile と DeployTarget は、その前提になる。

### 4.2 途中の作り直し（Next.js ↔ SPA）

- 乗り換え（12〜18。事業者が変わる）より重い「**作り直し**」として出す案。手間の目安（仮定）: 乗り換えの 1.5〜2 倍・3 か月。期間中は新旧両方の費用（U-5 と同じ）。
  事業者を同時に変えるなら、さらに乗り換えの手間を足す。
- まれな出来事（SNS の話題で OGP が効かなかった・SEO の要求）をきっかけに「作り直しを検討する」通知を出せる（§3 の「まれ」）。
- 最初の段では**入れない**のを推奨（F-06）。始める画面の選択（案 C）だけで差は体験でき、作り直しは基準プレイと目標の再調整が重い。

### 4.3 記事コミュニティで SPA を選ぶと何が起きるか（ゲーム上の仮定）

| 場面 | 起きること | 事実 / 仮定 |
|---|---|---|
| 費用 | ISR・SSR がなくなり、Cloudflare は KV の書き込み、Vercel は ISR と関数の分が減る（§1.3） | エンジンの計算（料金は実データ） |
| Cloudflare Free | SSR の CPU 10 ms に当たらなくなりうる（API の重さしだい） | 料金・制限は実データ、API の重さは仮定 |
| 鮮度 | 「常に新しい」（今の「キャッシュしない」と同じ） | 今のルール |
| 初回表示 | 速さに「初回の JS が重い」を 1 つ数える（段階を 1 つ下げうる） | **仮定** |
| SNS の話題（SC-1） | 記事ごとのカードが出ないので、話題の月の倍率（× 3）・残る倍率が小さい（例: 残る分を半分） | **仮定**（SNS のクローラーが JS を実行しないとは公式に書かれていない。メモ §5） |
| 部品「OGP の前処理」 | 記事の URL だけ Worker・関数で HTML にメタタグを差し込む。Cloudflare なら `run_worker_first` に一致したナビゲーションが Worker の起動になり、Free では上限で 429 | 課金・429 は事実、話題が戻る効き方は仮定 |
| 検索 | 表さない（推奨。F-08） | Google は JS を描画すると書いており、差の大きさに根拠がない |

- 「SPA は SNS に弱い」と断定する文面にしない。前提の文は「記事ごとのカードを出すには、サーバーが返す HTML にメタタグが要る（このゲームの仮定）」の形にし、仮定の印を付ける。

## 5. 論点の一覧（依存の順。2026-11-01 にすべて推奨どおりに決定・D-34）

| # | 問い | 選択肢 | 推奨と理由 |
|---|---|---|---|
| F-01 | SPA を Workload にどう表すか | ① `rendering: 'spa'` を足す（入口だけシェル + データの API） ② 今の `static` + `api` の回数で近似 ③ 06 の BuildOutput を先に作ってそこから導く | **①**。prd/04 §2 に式の考え方があり小さい。② は入口と遷移の区別ができず、Vercel の CDN Requests を数えすぎる。③ は使う側がない型が増える |
| F-02 | FrameworkProfile / DeployTarget をどこまで作るか | ① 最小（2 プロファイル + `supports` の表・`composeStack` が分岐）② 06 §2 の全部（`mapping`・`BuildOutput`）③ 作らず構成の名前で分ける | **①**。Astro のときに ② へ広げる（06 §3 の「データ追加だけで足せるか」の検証と一緒に） |
| F-03 | Next.js の `output: 'export'` を扱うか | ① 今は扱わない ② `nextjs` のモードとして扱う ③ 別のプロファイルにする | **①**。BuildOutput では SPA と静的の中間で、記事コミュニティでは「記事ごとにビルドし直す」手間の仮定が要る。Astro の静的出力と一緒に入れる |
| F-04 | ゲームでフレームワークを決める場所 | ① シナリオで固定 ② 始める画面で選ぶ ③ シナリオが選べるものと既定を持ち、始める画面で選ぶ | **③**（§4.1 の C）。受託シナリオでは案件のデータが決める形（①）にもそのまま使える |
| F-05 | SPA の満足度への効き方 | ① 初回表示と SNS のカードの 2 つ ② 初回表示だけ ③ 効かせない（費用の差だけ） | **①**。費用の差が小さい（§1.3）ので、満足度に出さないと分岐の意味が見えない。値は仮定として印を付ける |
| F-06 | 途中の作り直し（Next.js ↔ SPA） | ① 入れない ② 大きな行動（乗り換えの 1.5〜2 倍）③ まれな出来事のときだけ選べる | **① → 後で ②**。始める画面の選択だけで差は体験できる。作り直しは基準プレイの再調整が重い |
| F-07 | 「OGP の前処理」の部品を入れるか | ① 入れる（SPA のとき・Cloudflare は `run_worker_first`）② 入れない | **①**。「無料・無制限の静的配信が、前処理を足すと Worker の課金と Free の 429 に変わる」は D-12 の前提がそのまま出る |
| F-08 | 検索流入を表すか | ① 表さない ② 獲得率を少し下げる（仮定） | **①**。Google は JS を描画すると公式に書いており、差の大きさに根拠がない。根拠なく下げると「SPA は検索に弱い」と断定することになる |
| F-09 | 見積モードでの見せ方 | ① フレームワークを構成の列に足す（06 §4 の表）② 判断ポイントとして「SPA にしたら」を出す ③ 両方 | **①**。② は境目の計算（D-09）ができてから |
| F-10 | API の置き場のスロットを入れる順番 | ① 分岐の後（分岐の段は `same` だけ）② 分岐と同時 ③ 分岐より先（Next.js で） | **①**（§3.5）。SPA は `same` で成り立ち、事業者をまたぐ形は D-31 の 1 例目で固まってから 2 例目にする |
| F-11 | API の置き場の選べる範囲 | ① 決まった組だけ（例: 静的は Cloudflare・API はさくら / 静的は Vercel・API は Cloudflare Workers）② 3 事業者を自由に ③ 同じ事業者の中だけ | **①**。② は 18 通りで基準プレイと前提の文が追いつかない。③ だと選ぶ意味が小さい |
| F-12 | 事業者をまたぐ往復の遅延 | ① 計算せず前提の文で明示 ② `ArchEdge.boundary` と rtt の仮定で壁時計時間に効かせる | **①**（GD-4 の Hyperdrive と同じ）。② は D-20 の将来の範囲と一緒に |
| F-13 | CORS・Cookie を表すか | ① 一度きりの手間 + 「同じサイトのサブドメインに置く」前提の文 ② 表さない ③ 別のサイトに置く選択も出し、Cookie の制約を前提にする | **①**。③ はブラウザのサードパーティ Cookie の扱いが未確認（メモ §6） |
| F-14 | Next.js でも API を別に置けるようにするか | ① 段 2 で許す（既定は同居）② SPA だけ | **①**（段 2）。「Node の機能が要る機能追加」（prd/07 §10.11）の受け皿になる |

## 6. 未確定のまま進めると危ない点・ブロッカー

| # | 内容 | 影響 |
|---|---|---|
| B-1 | **SNS のクローラーが JS を実行しないことは公式に書かれていない**（Facebook・Slack の文書は記載なし。X の文書は取得できなかった） | F-05・F-07 の効き方はすべてゲーム上の仮定になる。仮定の印と文面（§4.3 の末尾）を決めずに作ると、事実のように見える |
| B-2 | 素の Vite のアプリに Vercel Functions を足す方法（`/api` のディレクトリ）が、Vercel の Vite のページでは確認できない（Nitro を推奨） | Vercel の SPA の DeployTarget の `adapter` と出典が決まらない。データにする前に確かめる |
| B-3 | Vercel の外部への rewrite の課金（FOT・CDN Requests）が記載なし | **解消（D-65）**: rewrite を使わず、API を別のサブドメイン（Worker のカスタムドメイン）に置いてブラウザから CORS で呼ぶ形にした（F-13 の前提）。rewrite の課金は今も未確認 |
| B-4 | 記事コミュニティの目標（$1,730）と基準プレイは Next.js の構成で決めた | SPA を選べるようにすると、シード 1〜50 での公平さを確かめ直す必要がある（D-20 V-8 の作法）。SPA が全シードで楽に届くなら、満足度の仮定（F-05）を見直す |
| B-5 | SPA のデータの API の重さ（CPU・I/O）は仮定で、Cloudflare Free の 10 ms の境目を左右する（§1.3） | 判断ポイント（`estimate-key-point`）として境目を出さないと、「SPA なら Free で済む」が仮定の値で決まってしまう |
| B-6 | vinext は experimental（06 §5）。Next.js の Cloudflare の列は vinext の仕様の変化を受ける | SPA との比較で Cloudflare の Next.js の列が古くなりうる。DeployTarget の版と取得日で追う |
| B-7 | decisions の Q-09（どのテンプレートでどのフレームワークを既定にするか）が未決 | F-04 を決めると Q-09 も実質決まる。一緒に記録する |
| B-8 | 受託シナリオ（prd/09）が別ブランチで設計中 | 案件ごとのフレームワークは FrameworkProfile が前提。F-02 の範囲が受託シナリオの「案件のデータ」で足りるか、両方の決定のときに確かめる |
| B-9 | 保存の版（D-26） | 状態に `framework` を足すと、保存の形が変わる。古い保存は「Next.js」とみなして読む（壊れた保存として捨てない）ことを決めておく |

## 7. 実装（段 1・済・2026-11-01）

| 層 | 入れたもの |
|---|---|
| estimator | `RouteGroup.rendering: 'spa'` と `shellKB`。シェル（`document-static`）は入口だけ（PV ÷ ページ/セッション）、ページの中身はデータの API（`api` に件数で重み付けしてまとめる）、JS・CSS も入口だけ。まとめたクラスの中の CPU の最大（`maxCpuMs`）を持ち、1 リクエストの CPU の制限はその最大で判定する（平均にすると SPA の重い API が軽い API に薄まって境目を越えないため） |
| catalog | `frameworks/`（`FRAMEWORKS`・`DEPLOY_TARGETS`・`toSpa`）。テンプレートの SPA の形 `ARTICLE_COMMUNITY_SPA`・`BUSINESS_APP_SPA`（シェル 5 KB・API の CPU は SSR の 0.5 倍・応答 10 KB。template-default）。`composeStack(…, { framework })` が SPA の構成を組む（ISR のキャッシュを作らない・SSR / ISR の経路を外す）。部品に選べるフレームワーク（`frameworks`）を持たせ、ISR のキャッシュと「HTML もキャッシュする前段の CDN」は Next.js だけ、スロット `ogp`（OGP の前処理）は SPA だけ。Cloudflare の静的アセットの事実（無料・無制限・ファイル数の制限・ページ遷移は Worker を起動しない・`run_worker_first` の課金と Free の 429）を `notes` から `facts` へ（出典つき） |
| game | `GameState.framework`（乗り換えでも変わらない）。`Scenario.frameworks`（選べるもの・既定・SPA の形と効き方）。SPA は鮮度が「常に新しい」・即時反映の要件を満たす・速さは SSR の代わりに API の CPU で判定し、初回表示を重さ 1 つに数える（`firstLoadHeavy`。記事コミュニティだけ）。話題の流量に `social` の印を付け、SPA で前処理なしのときは伸び（倍率 − 1 と後に残る分）を `socialCardFactor` 倍（記事コミュニティ 0.5）。比較の表の基準プレイは、あなたと同じフレームワークで回す |
| 保存 | `SaveData.framework`。無い古い保存は Next.js として読む（版は上げない・B-9） |
| web | 始める画面は「シナリオ → シナリオの説明 → 『どの構成で始めますか？』」の順（D-35）。フレームワークはシナリオの属性ではなく構成と同列の選択なので、構成のカードの中で「アプリを何で作りましたか？」（シナリオで 2 つ以上選べるときだけ。推奨・既定の印は付けない）とインフラの構成を並べて選ぶ。シナリオの説明はフレームワークに依らない文だけにし、フレームワークで変わる文（シナリオの `text.byFramework`）は、選んだときだけ出る短い注記（`note`）と ⓘ の長い説明（`app` と、SSR / API の CPU の行・10 ms の境目の注記）に置く。構成の名前は SPA では vinext を外し「（Vite の SPA）」を添える |

### 7.1 B-5: Cloudflare Free の 10 ms の境目

SPA のデータの API の CPU は「SSR の CPU × `dataCpuFactor`（0.5・仮定）」。記事コミュニティは 15 ms × 0.5 = 7.5 ms で当たらず、
機能開発で SSR が重くなる（最大 +5 ms）と 10 ms に届く。受託の業務アプリは 20 ms × 0.5 = 10 ms で境目にちょうど乗る。
**この仮定の値で、SPA なら Cloudflare Free で済むかが決まる**（catalog `frameworks.test.ts` で 0.5 と 1 の反転を固定）。始める画面のフレームワーク欄の ⓘ と、テンプレートの注記に同じことを書いた。

### 7.2 基準プレイ（シード 1〜50。目標の値は Next.js のまま）

Next.js の golden（`game.test.ts`・`contract.test.ts`）は変わらない。SPA で同じ基準プレイ（行動は同じ。SPA で選べない部品の行動は効かない）を回した結果:

| 記事コミュニティ | Next.js 合格 | Next.js 中央値 | SPA 合格 | SPA 中央値 |
|---|---|---|---|---|
| CF Paid・何もしない | 50 | $2,166 | 50 | $1,886 |
| CF Paid・提案を受ける | 48 | $2,224 | 49 | $1,978 |
| VPS・画像の提案 | 45 | $1,875 | 14 | $1,658 |
| Vercel Pro・何もしない | 0 | $1,606 | 0 | $1,380 |
| Vercel Pro → CF Paid | 42 | $1,755 | 0 | $1,516 |
| CF Free | 0 | $143 | 0 | $143 |
| CF Paid・KV を DB に | 50 | $1,979 | 32 | $1,734 |
| CF Paid・チャット | 50 | $2,201 | 50 | $1,916 |
| VPS・SLA | 40 | $1,850 | 7 | $1,609 |

| 受託 | Next.js 合格 | Next.js 中央値 | SPA 合格 | SPA 中央値 |
|---|---|---|---|---|
| CF Paid | 50 | $2,035 | 50 | $2,099 |
| CF Paid・提案を受ける | 27 | $1,737 | 35 | $1,784 |
| VPS・何もしない | 0 | $1,658 | 4 | $1,658 |
| VPS・手入れ | 45 | $1,850 | 45 | $1,860 |
| VPS・SLA | 45 | $1,853 | 45 | $1,862 |
| Vercel Pro | 0 | $1,563 | 0 | $1,627 |
| Vercel Pro → CF Paid | 50 | $1,844 | 50 | $1,877 |
| Vercel Hobby | 0 | $179 | 0 | $179 |
| CF Free | 0 | $237 | 0 | $237 |

- どちらのシナリオも、SPA でシード 1〜50 のどれでも基準プレイのどれか 1 本は合格する（`framework.test.ts`）。
- 記事コミュニティの SPA は約 $280 下がる。費用の差は小さく（§1.3）、**話題の伸びが半分**になる分の収益が効いている。OGP の前処理を最初に付けると戻る（CF Paid の中央値 $1,886 → $2,168・VPS の合格 2 → 40 / 50。基準プレイには入れていない）。
- 受託の SPA は少し上がる（HTML の生成が無く、初回表示も効かせない仮定）。業務アプリを SPA で作るのは自然、という向きと合う。
- §2.2 の E-3（載せられない組の検証）は入れていない（今の 2 つのフレームワークは 3 事業者すべてに載るので、表の `support` だけ）。後の段。E-2 は割合の値でなく部品として §8 で入れた（D-37）。

## 8. API の応答のキャッシュ（部品・2026-11-01・D-37）

ユーザーの決定: 「部品の追加と 80% の修正を両方」。SPA に部品「API の応答のキャッシュ」を足し、Vercel の CDN の ISR のヒット率の固定値 0.8 を同じ式に揃えた。

### 8.1 対象と式

- **対象は記事の中身の API だけ**（全員に同じ中身。Next.js で ISR だったルート）。個人化された中身（Next.js で SSR だったルート＝マイページ）と、もともとの API（コメントの取得・書き込み）は対象にしない。
  そのため estimator に新しいクラス `api-content` を足した。SPA のルートに `cacheSeconds`（s-maxage）を与えたときだけ、その中身の API を `api` から分ける（与えなければ今までどおり `api` にまとめる＝キャッシュなしの見積は変わらない）。
- **ヒット率は固定値にしない。** ISR の再生成と同じ形で、1 ページへの閲覧の到着率 λ（月の閲覧 ÷ ページ数）と期間 T から `λT / (1 + λT)`（miss は `閲覧 / (1 + λT)`。人気が一様と仮定）。`ResolvedWorkload.cacheHitRate` に持ち、構成の `cdn` は `ttlClasses` に挙げたクラス、`function` は `cache.classes` に挙げたクラスでこの値を使う。
- 記事コミュニティ（30 万 PV・記事 2,000 ページ・閲覧 18 万 / 月 = 1 ページ月 90 閲覧）では: 1 分 0.2%・**5 分 1.0%**・1 時間 11.0%・6 時間 42.5%。閲覧の薄い記事はほとんどヒットせず、期間を延ばすと効く（そのぶん鮮度が下がる）。
- **期間**は ISR の間隔と同じ値（`Settings.revalidateSec`）を使い、SPA では設定「API のキャッシュの期間」（`apiCacheTtl`。1 分・5 分・1 時間・6 時間・手間は ISR の間隔と同じ）として出す。Next.js では出さない。保存の形は変わらない。
- 鮮度: キャッシュを付けると「記事は常に新しい」でなくなり、期間で ISR の間隔と同じ判定（記事コミュニティでは 5 分まで良い・1 時間まで普通・6 時間は悪い）。

### 8.2 部品（事業者ごと・SPA だけ・手間 2）

| 事業者 | 部品 | 効き方 | 根拠 |
|---|---|---|---|
| Cloudflare | Workers Cache（Worker の前のキャッシュ） | ヒットは Worker を動かさない（CPU 0・D1 を読まない）。**ただし有効にすると Worker へのリクエストはヒットも含めてすべて課金され、ふだん無料の静的アセットへのリクエストも課金される**。tiered | [Workers Cache](https://developers.cloudflare.com/workers/cache/)（2026-10-30 更新・2026-11-01 取得） |
| Cloudflare | Workers の Cache API（コードの中） | Worker は毎回動く（リクエスト数は減らない）。ヒットは CPU 2 ms（ISR のページをキャッシュから返す CPU と同じ・**ゲーム上の仮定**）で D1 を読まない。拠点（データセンター）ごとで複製されない。料金の記載なし（費用なしと解釈） | [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)・[How the cache works](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)（2026-11-01 取得） |
| Vercel | CDN のキャッシュ（s-maxage） | ヒットは CDN が返す（Invocations・Active CPU・Fast Origin Transfer は miss だけ。CDN Requests・Fast Data Transfer は残る）。条件は GET・Authorization なし・Set-Cookie なし。リージョンごと | [CDN Cache](https://vercel.com/docs/caching/cdn-cache)（2026-09-14 更新・2026-11-01 取得） |
| さくらの VPS | 前段の CDN でキャッシュ（s-maxage） | 前段の CDN（D-31）がヒットを返し、VPS の CPU・回線が減る。**前段の CDN が要る**（無いと選べない・キャッシュ中は前段の CDN を外せない。`checkAction`） | Cloudflare は既定で JSON をキャッシュしない（既存の事実）。Cache Rules で API のパスを対象にする前提（推測） |

- 調査担当の事実メモは「Cloudflare の CDN 前段ではヒット分は Worker を起動しない」だったが、Worker の前に置けるキャッシュは Workers Cache で、公式の文書は**ヒットもリクエストとして課金する**と書いている（CPU だけが減る）。文書のとおりに入れた。そのため Cloudflare では「CDN のキャッシュ」も「Cache API」もリクエスト数は減らず、差は CPU（ヒットで 0 か 2 ms か）と静的アセットの課金。
- Cache API のヒット率は拠点ごとに分かれて下がるはずだが、その分は計算に入れていない（Vercel のリージョンごとの分割・Workers Cache の階層化も同じく入れていない）。拠点の数を仮定しないため。既存の ISR の Workers Cache の部品と同じ扱い。
- Next.js では出さない（Next.js の記事は ISR で、中身の API が無い）。受託のシナリオでは出さない（中身がすべてログインの要る個人化された API）。
- 即時反映（オンデマンド ISR）の要件との関係は**扱わない**（SPA は今までどおり要件を満たす扱い。キャッシュの期間の分は鮮度で下がる）。パージの手段（Vercel のパージ・Cloudflare の purge）を事実として集めてから決める。

### 8.3 Vercel の CDN の ISR のヒット率（0.8 → 同じ式）

- Vercel の CDN の `document-isr` は `hitRate: 0.8`（固定）だったが、同じ構成の再生成の数（`閲覧 / (1 + λT)`）から出る実質のヒット率は 5 分で約 1% で、整合しなかった。`ttlClasses: ['document-isr']` にして同じ式から出す。
  さくらの VPS の前段の CDN で HTML もキャッシュする部品（Next.js だけ・不適切）も、「Vercel の CDN と同じ値」としていた 0.8 を同じ式にした。
- 効き: CDN の miss が 20% → 約 99% になり、ISR の読み取り（8 KB 単位）と Fast Origin Transfer が増える（30 万 PV で ISR の読み取りが約 29 万 → 約 143 万単位、FOT が約 2.2 → 10.7 GB / 月）。
  golden（`game.test.ts`）は Vercel を通る基準プレイの所持金だけ下がり、結果（合格・目標未達・月）は変わらない: シード 42 の Vercel Pro $1,686.66 → $1,681.81・シード 3 の Vercel Pro $1,601.93 → $1,585.49・シード 31 の Vercel Pro $1,608.35 → $1,591.32・シード 31 の CF Paid・提案を受ける（Vercel Pro へ乗り換える）$1,583.47 → $1,551.68。

### 8.4 基準プレイ（何もしない・シード 1〜20）

キャッシュは 1 か月目の終わりに選ぶ（2 か月目から効く）。VPS は前段の CDN（静的と画像だけ）も一緒に付ける。費用は 12 か月のインフラ費の合計の平均（USD）。

| 記事コミュニティ | Next.js | SPA なし | SPA + キャッシュ（5 分） | （参考）SPA + キャッシュ 6 時間 |
|---|---|---|---|---|
| Cloudflare Free | 0 / 20・$0.5 | 0・$0.5 | 0・$0.5（Workers Cache） | 0・$0.5 |
| Cloudflare Paid | 20・$183.1 | 20・$174.4 | 20・$174.4（Workers Cache） | 0・$170.4（鮮度が悪い） |
| Vercel Hobby | 0・$0.0 | 0・$0.0 | 0・$0.0 | 0・$0.0 |
| Vercel Pro | 0・$768.9 | 0・$681.3 | 0・$681.2 | 0・$678.4 |
| さくらの VPS 2GB | 16・$148.2 | 0・$148.2 | 0・$148.2 | 0・$148.2 |
| さくらの VPS 4GB | 6・$299.6 | 0・$299.6 | 0・$299.6 | 0・$299.6 |

| 受託 | Next.js | SPA なし | SPA + キャッシュ |
|---|---|---|---|
| Cloudflare Free | 0・$0.1 | 0・$0.1 | 出さない |
| Cloudflare Paid | 20・$68.0 | 20・$68.3 | 出さない |
| Vercel Hobby | 0・$0.0 | 0・$0.0 | 出さない |
| Vercel Pro | 0・$540.0 | 0・$540.0 | 出さない |
| さくらの VPS 2GB | 0・$146.8 | 1・$146.8 | 出さない |
| さくらの VPS 4GB | 8・$299.6 | 12・$299.6 | 出さない |

- 5 分では記事の閲覧が薄く（ヒット 1%）、費用はほとんど変わらない。6 時間でもヒット 42% で、Vercel Pro で 12 か月 $3 ほど。記事コミュニティの費用は画像と転送量が支配的（§1.3）なので、API のキャッシュの効きは小さいのが実際の形。
- 値の調整はしていない（Cloudflare の SPA をクリアできなくするような調整はしない。実際の料金に反するため）。

## 9. API の置き場（段 2・2026-11-02・D-65）

SPA に部品のスロット「API の置き場」（`api`）を足した。既定は同じ事業者（段 1 の形）。他の事業者の部品は `stacks/cross.ts` の `CROSS_PAIRS`（D-52 の仕組み）で許した組だけ（F-11・AX-08）。
**DB は API と同じ事業者に置く**（API と DB の間に事業者をまたぐ往復を作らない）。遅延は計算しない（F-12・AX-13）。D1 の REST での直結は出さない（AX-10）。

### 9.1 入れた組と根拠（公式・2026-11-02 取得）

| 静的（土台） | API と DB（部品） | 経路と課金 | 根拠 |
|---|---|---|---|
| Vercel（Hobby・Pro） | **Cloudflare: Workers + D1**（`cf-workers`） | シェル・JS・CSS・画像は今の Vercel の CDN。API（`api`・`api-content`）は Worker → D1（binding）。Supabase は外れる。Worker の課金は Pro なら Workers Paid・Hobby なら Workers Free（どちらを使うかは仮定）。投稿の画像は、Vercel Blob ならアップロードを Vercel の関数に残し（仮定）、R2（画像だけ Cloudflare）なら Worker が書く | [カスタムドメイン](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)（「A Worker running on a Custom Domain is treated as an origin」・自分のゾーンが要る）・[CORS の例](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)・[D1 の Worker の API](https://developers.cloudflare.com/d1/worker-api/)（「execute SQL queries on your D1 database from a Worker using the Worker Binding API」） |
| AWS（S3 + CloudFront） | **Cloudflare: Workers + D1**（`cf-workers`） | シェル・JS・CSS・画像は CloudFront に残る。API Gateway・Lambda・DynamoDB は外れる。投稿の画像は Worker が S3 に書く（S3 はインターネットからの受信に課金しない）。Workers Paid（仮定） | 上と同じ + [S3 の料金](https://aws.amazon.com/s3/pricing/)（課金の例外に「Data transferred in from the internet」） |
| Cloudflare（Free・Paid） | **AWS: API Gateway（HTTP API）+ Lambda + DynamoDB**（`aws-lambda`） | シェル・JS・CSS は Workers の静的アセット（Worker を起動しないので無料）。Worker と D1 は外れる（OGP の前処理・リアルタイムを使うときは Worker だけ残る）。API の応答は CloudFront を通らず API Gateway から外へ送るので、**東京 → インターネットの転送**（月 100 GB 無料の後 $0.114/GB）で数える。投稿の画像は Lambda が R2 に書く（同じ転送）。画像の変換は Worker の binding でなくゾーンの URL で頼む | [API Gateway の料金](https://aws.amazon.com/api-gateway/pricing/)（HTTP API は「Pay only for the API calls you receive and the amount of data transferred out」・「charged at the EC2 data transfer rate」）・[Lambda の料金](https://aws.amazon.com/lambda/pricing/)・[EC2 の料金](https://aws.amazon.com/ec2/pricing/on-demand/)（月 100 GB の無料） |

- **入れなかった組**（→ D-67 で入れた。§9.5）: VPS（API）+ 静的は Cloudflare。API だけを自前運用にすると、§3.4 の「偶発的な障害を API にだけ効かせる（可用性は普通）」と「自前運用の維持の手間を部品で足す」が要り、今の障害・維持のルールは構成（`STACKS[].selfHosted`）で決まっていて部品では変わらない。ルールを広げる段で入れる。
  Vercel の外部への rewrite で同じドメインに見せる形も入れていない（課金が未確認・B-3）。
- 事業者の間の転送: 送り出す側の egress で数える（prd/11 §2.3）。Cloudflare（Worker・R2）から外への転送は課金されない。Vercel の関数から外への通信は未確認なので数えない（この組では Vercel の関数は Blob のアップロードにしか残らない）。

### 9.2 ゲーム

- **CORS・Cookie（F-13）**: 別のサブドメイン（api）の API をブラウザから呼ぶ前提を部品の説明（ⓘ）と前提の文（`cors-headers`・`custom-domain-origin`）で出す。一度きりの手間は D-52 のアカウントの設定（1）に含める。
- **依存**（`componentConflict`。始める画面とゲーム中で共通）: API を他の事業者に置くと、構成の DB のスロットは出さない（DB は API の事業者の部品）。API の応答のキャッシュ（この事業者の CDN・Worker の前のキャッシュ）とは同時に選べない。Cloudflare で画像を D1 に置いているときは選べない（読み出す Worker が無くなる）。頼る側を先に戻す（D-37 と同じ向き）。
- **ゲーム中の移し替え**: API と一緒に DB のデータを移すので、DB の差し替えと同じく進行中の状態を持つ（手間 6 × 1 か月・期間中は新旧両方の費用・ゲーム上の仮定）。アカウントが増えるなら一度きりの 1 と毎月の維持 0.5（D-52）。始める画面では手間はかからない。
- 説明文（`COMPONENT_FLAVOR`）は利点だけを書き、損（CORS・アカウント・転送・移行）は ⓘ と手間に出す（prd/11 §3.2 の方針）。
- Vercel Hobby は静的の配信が Hobby のプランに残るので、API を Workers に出しても非商用の規約（`personal-non-commercial`）に当たる。

### 9.3 基準プレイ（SPA・何もしない・シード 1〜20・始める画面で部品を選ぶ）

12 か月の費用は事業者別の中央値（請求の明細を事業者で足した）。所持金は中央値。

| シナリオ | 構成 | API の置き場（画像） | 達成 | 12 か月の費用（事業者別） | 所持金 |
|---|---|---|---|---|---|
| 記事 | CF Paid | 同じ（既定・目標の根拠） | **20 / 20** | $175（CF $175） | $1,870 |
| 記事 | CF Paid | AWS（既定の Images） | 20 / 20 | $145（CF $115・AWS $30） | $1,900 |
| 記事 | CF Free | 同じ | 0 / 20（3 か月目に停止） | $1 | $143 |
| 記事 | CF Free | AWS（既定の Images） | 0 / 20（Images Free の月 5,000 の変換で停止） | $3 | $140 |
| 記事 | CF Free | AWS（投稿のときに縮める） | **20 / 20** | $32（CF $2・AWS $30） | $2,013 |
| 記事 | Vercel Pro | 同じ | 0 / 20 | $1,274（Vercel $974・Supabase $300） | $774 |
| 記事 | Vercel Pro | Workers + D1（既定の画像） | 0 / 20 | $948（Vercel $888・CF $60） | $1,106 |
| 記事 | Vercel Pro | Workers + D1（Cloudflare: R2 に縮める） | 0 / 20 | $442（Vercel $380・CF $62） | $1,613 |
| 記事 | Vercel Pro | Workers + D1（Cloudflare: R2 + Images） | 0 / 20 | $555（Vercel $380・CF $175） | $1,501 |
| 記事 | Vercel Hobby | Workers + D1 | 0 / 20（2 か月目に規約で停止） | — | $118 |
| 記事 | AWS | 同じ | 19 / 20 | $179（AWS $179） | $1,860 |
| 記事 | AWS | Workers + D1 | 19 / 20 | $199（AWS $139・CF $60） | $1,841 |
| 記事 | AWS | Workers + D1（Cloudflare: R2 に縮める） | 20 / 20 | $62（CF $62） | $1,982 |
| 受託 | CF Paid | 同じ（既定） | **20 / 20** | $68 | $2,100 |
| 受託 | CF Free | 同じ | 0 / 20 | $0 | $237 |
| 受託 | CF Free・Paid | AWS | **20 / 20** | $64（AWS $56・CF $8） | $2,104 |
| 受託 | Vercel Pro | 同じ | 0 / 20 | $542（Vercel $242・Supabase $300） | $1,624 |
| 受託 | Vercel Pro | Workers + D1 | **20 / 20** | $300（Vercel $240・CF $60） | $1,868 |
| 受託 | Vercel Hobby | Workers + D1 | 0 / 20（規約） | — | $179 |
| 受託 | AWS | 同じ / Workers + D1 | 20 / 20 | $50 / $65 | $2,002 / $1,988 |

- **CF Paid・既定（目標の根拠）は変わらない**（既存の golden・基準プレイもすべて同じ。新しい部品の既定は同じ事業者）。
- **「Vercel の静的 + Workers の API + D1」は記事コミュニティでは届かない**。Supabase Pro の固定費（$300）は消えるが、Vercel Pro の席（$240）と HTML・JS の転送（Fast Data Transfer）・CDN Requests が残る。画像も R2 に出して $1,613 で、目標 $1,730 に約 $120 足りない。Hobby は非商用の規約があるので静的だけでも使えず、**Vercel の席の固定費は避けられない**。
  **受託では届く**（20 / 20）: 受託は画像と閲覧が少なく、Vercel の費用の大半が席と Supabase Pro の固定費で、Supabase が消える分が効く。
- Cloudflare の静的 + AWS の API は、Workers の料金（Paid $5 / 月・Free の CPU 10 ms と 1 日 10 万リクエスト）を払わずに済むので、**CF Free の構成でも届く道筋**になる（受託・記事の画像を縮めるとき）。記事で Images を使うと Images Free の上限で止まる（Free のプランのまま）。
- 満足度は替えても同じ（速さ・可用性に事業者をまたぐ往復を数えない・AX-13）。

### 9.4 残した点

- F-14（Next.js でも API を別に置く）・VPS（API）の組: D-67 で入れた（§9.5）。
- Vercel の外部への rewrite（B-3）・往復の遅延（F-12）。
- 構成の名前: ゲーム中（月の表・結果・プラン変更の文面）は、API を他の事業者に置くと実際の組で出す（例「Vercel Pro の静的 + Cloudflare Workers・D1（Vite の SPA）」「Cloudflare Paid の静的 + AWS Lambda・DynamoDB（Vite の SPA）」。`stackName` に部品を渡す）。始める画面の構成の一覧と乗り換え先（既定の部品に戻る）は構成の名前のまま。
- Cloudflare Paid の構成で API を AWS に出すと、Workers Paid の基本料は数えない（Worker を使わないので契約しない前提）。構成の名前は Paid のまま。

### 9.5 段 3: Next.js の API を別の事業者に・VPS の API（2026-11-02・D-67）

ユーザーの方針「より現実的なコスト感・費用を抑える複雑な構成も可能にしたい」を受け、§9.1 で入れなかった 2 つを推奨案で入れた。仕組みは同じ（`CROSS_PAIRS`・アカウントの手間・データの移行 6 × 1 か月）。

| 土台 | API と DB（部品） | 経路と課金 | 根拠（公式・2026-11-02 取得） |
|---|---|---|---|
| Vercel（Hobby・Pro）・AWS（Amplify）・AWS（OpenNext）の **Next.js** | **Cloudflare: Workers + D1（Next.js のサーバーから呼ぶ）**（`cf-workers-server`） | ブラウザは今の事業者の Next.js だけを呼ぶ（CORS は要らない）。SSR・ISR の作り直し・Route Handler の経路の DB を Worker → D1 に差し替える（CDN・サーバーの関数は残る）。API を呼ぶたびに Worker のリクエスト。サーバーから外への通信は、OpenNext の Lambda だけ EC2 のデータ転送（月 100 GB 無料の後 $0.114/GB）で数え、Vercel・Amplify は料金の文書に項目が無いので数えない（前提の文 `function-outbound`・`ssr-outbound`） | [Next.js のデータの取得](https://nextjs.org/docs/app/getting-started/fetching-data)（「`fetch` requests are not cached by default and will block the page from rendering until the request is complete」）・[Vercel の料金の文書](https://vercel.com/docs/pricing)・[Amplify の料金](https://aws.amazon.com/amplify/pricing/)（課金はビルド・保存・配信の転送・SSR のリクエストと時間だけ）・[Lambda の料金](https://aws.amazon.com/lambda/pricing/)・§9.1 の Workers・D1 |
| Cloudflare（Free・Paid）の **SPA** | **さくらの VPS 2GB / 4GB: API と MySQL**（`sakura-vps-2gb`・`sakura-vps-4gb`） | シェル・JS・CSS は Workers の静的アセット、画像は R2。api のサブドメインは DNS だけのレコードで VPS に直接向ける（CDN を通らない）。VPS の経路は API と投稿だけなので、回線（100 Mbps 共有の半分）・CPU の判定と話題の集中（D-44）も API の分だけ。ディスクに画像を数えない（`storesImages: false`） | [DNS のプロキシの状態](https://developers.cloudflare.com/dns/proxy-status/)（DNS だけのレコードは「does not route HTTP/HTTPS traffic through its network」）・[静的アセットの課金](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)・[さくらの VPS の仕様](https://vps.sakura.ad.jp/specification/) |

- **自前運用のルールを部品にも効かせた**: 維持の手間（シナリオの値・3 / 月）と偶発的な障害（月 8%）は、構成が VPS のときに加えて、構成のノードに VPS のホストがあるとき（`selfHostedOf`）にもかかる。
  維持は差し替えの途中の新しい VPS も数える（新旧の両方を動かす）。障害は VPS が経路に載っている（リクエストを受けている）月だけで、文は「API の VPS の障害」（シェルは出るが中身が読めない）。売上の減り方は VPS の構成と同じ（§3.4 の「可用性は普通」は入れていない）。
  始める画面の手間のバー・部品の手間の見込み（「自前運用になる（毎月の維持 3・自前の障害 月 8%）」）にも出す。
- 構成の名前（ゲーム中）: 「Vercel Pro + Cloudflare Workers・D1」「AWS Amplify の Next.js + Cloudflare Workers・D1」「AWS の OpenNext + Cloudflare Workers・D1」「Cloudflare Paid の静的 + さくらの VPS 2GB（API・MySQL）（Vite の SPA）」。
- Next.js の既定の部品にも `api: 'same'` を足した（SPA と同じ）。既存の基準プレイ・golden は変わらない。
- Astro（§10・D-68）の API の置き場は、最初は同じ事業者のみにしていた。公式で組を確かめて D-69 で 2 つを許した（§9.7）。

**置いた仮定**（ゲーム上の仮定）:
- Next.js のサーバーは 1 回の描画（SSR・ISR の作り直し）・1 回の API で Worker を 1 回呼ぶ。Worker の CPU は 1 回 5 ms（`SERVER_API_WORKER_CPU_MS`。記事コミュニティの API の CPU と同じ値。HTML の描画の CPU はサーバーの側に残る）。
  OpenNext の Lambda から送る問い合わせは 1 回 1 KB（`SERVER_API_REQUEST_KB`。応答の受信は課金されない）。Workers のプランは Vercel Hobby なら Free、それ以外は Paid（§9.1 と同じ）。
- API の VPS はストレージ変更オプションなし。常駐メモリ・CPU の仮定は VPS の構成と同じ（nginx + Node + MySQL）。2GB ↔ 4GB の移し替えもデータの移行（6 × 1 か月・新旧両方の月額）として扱う。

### 9.6 段 3 の基準プレイ（何もしない・シード 1〜20・始める画面で部品を選ぶ）

12 か月の費用は事業者別の中央値、所持金は中央値（§9.3 と同じ取り方）。

| シナリオ | 構成 | API の置き場（他の部品） | 達成 | 12 か月の費用（事業者別） | 所持金 |
|---|---|---|---|---|---|
| 記事 | CF Paid（SPA） | 同じ（既定・目標の根拠） | **20 / 20** | $175（CF $175） | $1,870 |
| 記事 | CF Paid（SPA） | VPS 2GB | 0 / 20（目標 17・障害 3） | $265（さくら $157・CF $108） | $1,468 |
| 記事 | CF Free・Paid（SPA） | VPS 2GB（画像は投稿のときに縮める） | 0 / 20（目標 17・障害 3） | $159（さくら $157・CF $2） | $1,575 |
| 記事 | CF Free（SPA） | VPS 2GB（既定の Images） | 0 / 20（Images Free の上限で停止） | $40 | $102 |
| 記事 | CF Paid（SPA） | VPS 4GB | 0 / 20 | $425（さくら $317・CF $108） | $1,308 |
| 記事 | VPS 2GB（SPA・比較） | — | 0 / 20 | $157 | $1,566 |
| 記事 | Vercel Pro（Next.js） | 同じ | 0 / 20 | $1,491（Vercel $1,191・Supabase $300） | $851 |
| 記事 | Vercel Pro（Next.js） | Workers + D1 | 0 / 20 | $1,251（Vercel $1,191・CF $60） | $1,091 |
| 記事 | Vercel Pro（Next.js） | Workers + D1（画像: Cloudflare に縮める） | 0 / 20 | $718（Vercel $656・CF $62） | $1,619 |
| 記事 | Vercel Hobby（Next.js） | Workers + D1 | 0 / 20（規約で停止） | — | $118 |
| 記事 | Amplify（Next.js） | 同じ / Workers + D1 | 10 / 20 → 9 / 20 | $623 → $678（AWS $618・CF $60） | $1,702 → $1,648 |
| 記事 | OpenNext（Next.js・既定） | 同じ / Workers + D1 | 17 / 20 → 14 / 20 | $444 → $499（AWS $439・CF $60） | $1,877 → $1,822 |
| 記事 | OpenNext・画像の最適化 | 同じ / Workers + D1 | 20 / 20 → 20 / 20 | $72 → $127（AWS $67・CF $60） | $2,264 → $2,209 |
| 受託 | CF Paid（SPA） | 同じ（既定） | **20 / 20** | $68 | $2,100 |
| 受託 | CF Free・Paid（SPA） | VPS 2GB | **17 / 20**（障害 3） | $164（さくら $157・CF $7） | $1,862 |
| 受託 | CF Free・Paid（SPA） | VPS 4GB | 11 / 20 | $324（さくら $317・CF $7） | $1,702 |
| 受託 | VPS 2GB / 4GB（SPA・比較） | — | 1 / 20・12 / 20 | $157 / $317 | $1,636 / $1,710 |
| 受託 | Vercel Pro（Next.js） | 同じ → Workers + D1 | 0 / 20 → **20 / 20** | $559 → $323（Vercel $263・CF $60） | $1,545 → $1,794 |
| 受託 | Vercel Hobby（Next.js） | Workers + D1 | 0 / 20（規約） | — | $179 |
| 受託 | Amplify（Next.js） | 同じ / Workers + D1 | 20 / 20 | $180 → $225（AWS $165・CF $60） | $1,872 → $1,827 |
| 受託 | OpenNext（Next.js） | 同じ / Workers + D1 | 20 / 20 | $22 → $67（AWS $7・CF $60） | $2,031 → $1,985 |

- **CF Paid・既定（目標の根拠）は変わらない**（SPA・Next.js とも。既存の golden・基準プレイもすべて同じ）。
- **Next.js の API を Workers に出して得をするのは、DB の固定費がある構成**（Vercel Pro + Supabase Pro）。受託では Supabase Pro の $300 が消えて届く（SPA の §9.3 と同じ形）。記事コミュニティでは Vercel の転送と席が残り届かない。
  DB が従量で安い AWS（DynamoDB）では、Workers Paid の基本料（$5 / 月）の分だけ高くなる。
- **Cloudflare の静的 + VPS の API は、受託では VPS だけの構成より届く**（1 → 17 / 20）。VPS の構成は画像でディスクが埋まって止まるが、画像を R2 に置くとディスクに余裕が出る。届かなかった 3 件は偶発的な障害。
  記事コミュニティでは VPS の構成と同じく届かない（維持の手間 3 とアカウントの 0.5 で機能開発が減る）。VPS の回線の使用率は、VPS だけの構成の 0.66 から 0.02 に下がる（シード 1 の最大）。
- 満足度は替えても同じ（往復の遅延は計算しない・AX-13）。SSR が外の API を待つことは前提の文（`server-fetch`）で出す。

### 9.7 Astro の API の置き場（2026-11-02・D-69）

D-67 と D-68 が並行で入ったので、Astro では「同じ事業者のみ」にしていた。公式で確かめて、現実にできる 2 つの組だけを許した。不可・未確認の組は出さない（渡されても既定に戻る）。仕組みは同じ（`CROSS_PAIRS`・アカウントの手間 D-52・データの移行 6 × 1 か月）。

| 土台（Astro のアダプター） | API と DB（部品） | 経路と課金 | 根拠（公式・2026-11-02 取得） |
|---|---|---|---|
| Vercel（Hobby・Pro。`@astrojs/vercel`）・さくらの VPS（`@astrojs/node` standalone） | **Cloudflare: Workers + D1（Astro のサーバーから呼ぶ）**（`cf-workers-astro`） | D-67 の `cf-workers-server` と同じ形。ブラウザは今の事業者の Astro だけを呼び（CORS は要らない）、マイページの SSR・API の経路の DB を Worker → D1 に差し替える。記事は静的なビルドのまま今の場所から配る。Vercel の関数から外への通信は数えず（前提の文 `function-outbound`）、VPS は転送量が無制限なので数えない。**VPS は MySQL を動かさない**（常駐メモリ 1.35 → 0.75 GB・DB の CPU 0・ディスクに DB を置かない。エンジンに `host` の `storesDb`） | [Data fetching](https://docs.astro.build/en/guides/data-fetching/)（「If SSR mode is enabled, any fetch calls will be executed at runtime」）・[@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/)・[@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/)・[さくらの VPS の仕様](https://vps.sakura.ad.jp/specification/)（データ転送量 無制限）・§9.1 の Workers・D1 |
| Cloudflare（Free・Paid。`@astrojs/cloudflare`） | **さくらの VPS 2GB / 4GB: API と MySQL**（`sakura-vps-2gb`・`sakura-vps-4gb`。SPA と同じ部品） | D-67 の VPS の API と同じ形（api のサブドメインを DNS だけのレコードで VPS へ。ブラウザの API・投稿は VPS に直接、画像は R2）。加えて、**マイページを描く Worker が VPS の API を fetch で呼ぶ**（経路 `document-ssr` = Worker → VPS）。D1 は外れ、Worker・Images（binding）・ビルドは残る。Worker から外への fetch は課金されず転送の料金も無く、待つ時間は CPU 時間に数えない（前提の文 `worker-outbound`） | [Workers の料金](https://developers.cloudflare.com/workers/platform/pricing/)（「There are no additional charges for data transfer (egress) or throughput (bandwidth)」・「Cloudflare does not bill for subrequests you make from your Worker」）・[Workers の制限](https://developers.cloudflare.com/workers/platform/limits/)（「Waiting on network requests (such as fetch() calls …) does not count toward CPU time」・サブリクエスト Free 50 / Paid 10,000）・[@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)・§9.5 の DNS・VPS |

- 出さない組: Astro × AWS（D-68 で載せない）。Cloudflare の Astro + AWS の API（`aws-lambda`）は、Worker の SSR から API Gateway を呼ぶ転送の扱い（Lambda の応答が Worker に返る分）を確かめていないので出さない。VPS の Astro + 他の事業者の画像も今までどおり出さない。
- 構成の名前（ゲーム中）: 「Vercel Pro + Cloudflare Workers・D1（Astro）」「さくらの VPS 2GB（東京） + Cloudflare Workers・D1（Astro）」「Cloudflare Paid + さくらの VPS 2GB（API・MySQL）（Astro）」（D-65 の実際の組の名前 +「（Astro）」）。
- 自前運用（D-67 の `selfHostedOf`）: Cloudflare + VPS の API は部品の VPS で維持・障害がかかる。VPS の Astro から Workers に出しても VPS の構成のまま（維持・障害は変わらない）。
- 置いた仮定: Worker の CPU は 1 回 5 ms（`SERVER_API_WORKER_CPU_MS`・D-67 と同じ）。VPS の Astro + Workers の Workers のプランは Paid（Vercel Hobby だけ Free・§9.1 と同じ）。Cloudflare + VPS の API で、Worker が VPS を呼ぶ 1 回の受け渡しは VPS の回線にページの大きさで数える（多めの見積もり。マイページの分だけなので小さい）。

基準プレイ（何もしない・シード 1〜20・ビルドの間隔 5 分・始める画面で部品を選ぶ）。12 か月の費用は事業者別の中央値、所持金は中央値（§9.3 と同じ取り方）。

| シナリオ | 構成（Astro） | API の置き場（他の部品） | 達成 | 12 か月の費用（事業者別） | 所持金 |
|---|---|---|---|---|---|
| 記事 | CF Paid（Next.js・目標の根拠） | 同じ | **20 / 20** | $182 | $2,152 |
| 記事 | CF Paid | 同じ（既定） | 20 / 20 | $189 | $2,601 |
| 記事 | CF Paid | VPS 2GB | 17 / 20（障害 3） | $336（CF $179・さくら $157） | $2,003 |
| 記事 | CF Paid | VPS 4GB | 16 / 20 | $496（CF $179・さくら $317） | $1,842 |
| 記事 | CF Paid | VPS 2GB（画像は投稿のときに縮める） | 11 / 20 | $219（CF $62・さくら $157） | $1,747 |
| 記事 | CF Free | VPS 2GB / 4GB | 0 / 20（3 か月目に停止: マイページの SSR が CPU 10 ms に当たる） | — | $104 / $64 |
| 記事 | Vercel Pro | 同じ → Workers + D1 | 0 / 20 | $1,712 → $1,472（Vercel $1,412・CF $60） | $1,076 → $1,316 |
| 記事 | Vercel Pro | Workers + D1（画像: Cloudflare に縮める） | 0 / 20 | $740（Vercel $678・CF $62） | $1,595 |
| 記事 | Vercel Hobby | Workers + D1 | 0 / 20（2 か月目に規約で停止） | — | $118 |
| 記事 | VPS 2GB | 同じ → Workers + D1 | 17 / 20 → 17 / 20 | $157 → $217（さくら $157・CF $60） | $2,090 → $2,030 |
| 記事 | VPS 4GB | 同じ → Workers + D1 | 16 / 20 → 16 / 20 | $317 → $377 | $1,930 → $1,870 |
| 受託 | CF Paid | 同じ（既定） | **20 / 20** | $68 | $2,036 |
| 受託 | CF Paid | VPS 2GB / 4GB | 12 / 20・0 / 20 | $224 / $384（CF $67・さくら $157 / $317） | $1,775 / $1,615 |
| 受託 | CF Free | VPS 2GB | 0 / 20（3 か月目に停止） | — | $198 |
| 受託 | Vercel Pro | 同じ → Workers + D1 | 0 / 20 → **20 / 20** | $559 → $323（Vercel $263・CF $60） | $1,545 → $1,794 |
| 受託 | VPS 2GB | 同じ → Workers + D1 | 0 / 20 → 1 / 20 | $157 → $217 | $1,653 → $1,599 |
| 受託 | VPS 4GB | 同じ → Workers + D1 | 8 / 20 → 0 / 20 | $317 → $377 | $1,683 → $1,623 |

- **目標の根拠（CF Paid × Next.js）と Astro の既定は変わらない**（既存の golden・基準プレイもすべて同じ）。
- **受託の Vercel Pro の Astro は Workers + D1 で届く**（0 → 20 / 20）。Next.js（§9.6）と同じく Supabase Pro の固定費 $300 が消える分。記事は Vercel の転送と席が残り届かない。
- **Cloudflare の Astro + VPS の API は、Cloudflare の Astro だけより損**（記事 20 → 17 / 20・受託 20 → 12 / 20）。Workers Paid の費用はほぼ残り（マイページの SSR とビルド）、VPS の月額・維持の手間 3・偶発的な障害が足される。CF Free では、マイページの SSR が CPU 10 ms に当たるので VPS に出しても止まる（D-68 の CF Free と同じ）。
- **VPS の Astro + Workers は、MySQL を外しても VPS の上限に当たらない規模なので得にならない**（Workers Paid の $5 / 月の分だけ所持金が減る）。受託の VPS 2GB は画像でディスクが埋まって止まる（DB を外した分だけ 1 件届く）。

## 10. 3 つ目のフレームワーク: Astro（2026-11-02・D-68）

仕様・出典・仮定・基準プレイは [06](./06-frameworks.md) §6。この文書の分岐（Next.js か SPA か）との関係だけ書く。

- Astro は「記事は静的にビルド（ISR の代わりにビルドし直し）+ マイページは SSR（アダプター）+ JS はアイランドだけ」。SNS のカードは Next.js と同じく HTML に入る（`noSocialCards` は SPA だけ）。
- 始める画面のフレームワーク欄（F-04・D-35）に 3 つ目として出る。§7 の `framework` の保存は id だけで、古い保存は今のまま読める（`astro` を許す id に足しただけ）。
- 載せられない組（§2.2 の E-3）を初めて入れた: Astro × AWS（公式のアダプターが無い）は始める画面の一覧に出さず、乗り換えもできない（`stackSupports`）。
- revalidateSec の意味はフレームワークごと: Next.js は ISR の間隔・SPA は API のキャッシュの期間（§8）・Astro はビルドの間隔（`revalidateSettingOf`・`hiddenSettings`）。
