# 04. Workload からリソース消費量への変換

> 状態: **設計中**。式は MVP の粒度。記号は §1。数値の例はすべて説明用で、実在の料金・制限ではない。

## 1. 記号と前提

| 記号 | 意味 | 出所 |
|---|---|---|
| `PV` | 月間 PV = MAU × DAU/MAU × 30 × セッション/日 × ページ/セッション | derived |
| `w(h)` | 代表週の時間 h（0..167）の重み。Σw = 1 | template-default / user-input |
| `share(c)` | ページの種類 c の割合（static / ssr / spa） | template-default |
| `n_api, n_asset, n_img` | 1 ページあたりの API 呼び出し・アセット・画像の数 | template-default |
| `r_browser` | ブラウザキャッシュで再取得しない割合（アセット・画像） | assumption |
| `hit(k)` | CDN のクラス k のヒット率 | assumption |
| `size(k)` | クラス k の平均応答サイズ | template-default |
| `cpu(k), io(k)` | クラス k の 1 リクエストあたり CPU ms・I/O 待ち ms | assumption |
| `peakHourFactor` | 多い時間帯 / 平均の時間の比（時間より短い山も含めた容量の判定用の係数。D-83） | template-default（ゲーム上の仮定） |

月は 730 時間（01 §3.3）。週の時間 h の月間件数は `月間件数 × w(h)`、h の平均 RPS は `月間件数 × w(h) / (730 / 168) / 3600`。

> 実装（D-83）: 代表週の重み `w(h)` と時間内の山の比 `burst` は入れていない。容量の判定のピークは
> `月の総量 / 月の秒数 × peakHourFactor`（× 話題・Bot の集中の倍率。§3.8）の 1 つの係数で表し、時間より短い山もこの係数に含める
> （記事コミュニティ 2.5・受託の業務アプリ 4。どちらもテンプレートの仮定で、出典のある値ではない）。下の式の `max_h(… × burst)` は
> `… × peakHourFactor` と読む。
>
> 時間帯の形（D-89・2026-11-02）: 代表週の重みは「1 日 24 時間の重み `hourlyProfile` × 平日 5 日・休日 2 日（量の比は `weekdayToWeekend`）」の
> 48 区間（`ResolvedWorkload.timeBuckets`。区間ごとに月の流れの割合 share と月の時間 hours、1 回の長さ slotHours（1 時間）と直前の時間帯 prev を持つ）で表す。
> 使うのは**コンテナのサービス**（§3.3.1）と**止まる DB**（§3.5.1・D-90）だけで、
> 容量の判定は引き続き `peakHourFactor`、課金の総量は月の総量のまま。形の山を `peakHourFactor` に掛けない（二重に数えない）。
> テンプレートの形は「平日の最も多い時間 / 平均 ≤ peakHourFactor」になるように置いている（`peakHourFactor` は時間より短い山を含む）。
> 形を与えなければ月全体の 1 区間で、D-88 の式に戻る。

## 2. リクエストクラスの件数

```
N(document-static) = PV × share(static)
N(document-ssr)    = PV × share(ssr)
N(api)             = PV × n_api                     （SPA のページ遷移は API として数える）
N(asset)           = PV × n_asset × (1 − r_browser)
N(image-read)      = PV × n_img   × (1 − r_browser)
N(image-write)     = MAU × アップロード数/MAU/月
```

フレームワーク由来のクラス（[06](./06-frameworks.md) §2.1）:

```
N(document-isr-revalidate) = Σ_ISR ルート min(そのルートの閲覧数, 730h × 3600 / revalidateSeconds) × キャッシュの地域数
N(middleware)              = runsOn が all なら全リクエスト、dynamic-only なら動的なクラスの件数
N(image-transform)         = on-demand なら min(画像の種類 × variantsPerImage, N(image-read))（変換結果がキャッシュされる前提。再変換率は assumption）
                             投稿のときに作るなら N(image-write) × variantsPerImage、作らないなら 0（D-24 の transformAt）
```

ISR のルートの閲覧（`document-isr`）自体は CDN・ホストのキャッシュで返るクラスとして数え、再生成だけが関数に届く。

期間つきのキャッシュ（ISR の再検証の間隔・SPA の記事の中身の API の s-maxage。D-37・[10](./10-framework-branch.md) §8）は、同じ式で miss とヒット率を出す（実装の正。上の `min` の式は古い案）:

```
λ_r        = ルート r の月の閲覧 / ページ数            （1 ページへの到着率。人気が一様と仮定）
miss_r     = 閲覧_r / (1 + λ_r × T_r / 1 か月)         （T: 再検証の間隔・s-maxage）
hit(k)     = 1 − Σ miss_r / Σ 閲覧_r                    （k = document-isr・api-content。ResolvedWorkload.cacheHitRate）
N(isr-revalidate) = Σ miss_r                           （ISR の再生成 = CDN の miss と同じ数）
N(api-content)    = Σ 閲覧_r（SPA で cacheSeconds を持つルートだけ。持たない中身は api にまとめる）
```

**オンデマンドの再検証**（D-49）: ISR のルートに `onDemandUpdatesPerMonth`（月の内容の更新の回数 U）を与えると、`revalidateSeconds` の代わりに
更新のあとの最初の閲覧で 1 回作り直すとして数える。

```
miss_r = U_r × 閲覧_r / (U_r + 閲覧_r)      （更新と閲覧がページに一様に散ると仮定。U ≪ 閲覧なら U、閲覧 ≪ U なら閲覧に近づく）
ピークの miss の割合は月の平均と同じとみなす（更新も閲覧と同じ時間帯の形と仮定）
```

ゲームでは U = 月の PV × 1 PV あたりの API の呼び出し × 書き込みの割合（`writesPerCall`）× **記事のページを作り直す割合**
（シナリオの `pageUpdateShare`。記事コミュニティ 0.01・受託 0。D-70）。作り直すのは**記事の投稿・編集だけ**で、
コメント・いいねは記事のページと別のデータとして読み込む（クライアントで取得する・Server Components なら Suspense の内側で
リクエストのたびに流す）ので、記事のページの再生成・無効化を起こさないとみなす（一般的な作り方の仮定。根拠は D-70）。
記事コミュニティの 1 か月目（30 万 PV）で U = 300 回（1 日 10 回ほど）。Astro のビルドし直し（D-68）も同じ U を使う。
（D-49 の初版は「ページを変える割合 0.5」（コメントも作り直す）で U = 1.5 万回だった。）
設定「コメントの描き方」を**記事のページに含める**にすると（D-82）、コメントの投稿（シナリオの `comments.pageUpdateShare`。記事コミュニティ 0.49）も U に足し
（30 万 PV で 1.5 万回）、1 回の更新で再検証するページの数は記事 2・コメント 1 の加重平均にする。代わりに記事のページを開いたときのコメントの取得
（API の読み込み）を除く（書き込みの回数は変えない）。時間の再検証の再生成は U に依らないので変わらない。
その代わり、時間の再検証（Astro・静的書き出しは間隔でまとめるビルド）では、コメントが間隔の分だけ遅れて見える。満足度の鮮度は記事とコメントの
**悪い方**で、コメントの段階は遅れ（= 間隔）を記事より厳しい境目（シナリオの `comments.freshness`。記事コミュニティは 1 分まで「良い」・5 分まで「普通」。
ゲーム上の仮定）で判定する（D-85）。ブラウザで読み込む・オンデマンド（コメントのたびに作り直す）・ISR のキャッシュを使わない（毎回描く）ならコメントは遅れない。

**オンデマンドの最大寿命**（D-56）: オンデマンドでも、再検証の呼び出しの取りこぼしに備えて時間の再検証（最大寿命 T_max）を併せて持つとみなし、
その分を足す（閲覧の回数を超えない）:

```
miss_r = min(閲覧_r, U_r × 閲覧_r / (U_r + 閲覧_r) + 閲覧_r / (1 + λ_r × T_max / 1 か月))   （ピークは λ_r を peakHourFactor 倍）
```

ゲームでは T_max = 1 日（`ON_DEMAND_MAX_AGE_SEC`。よく使われる 1 時間〜1 日の長い側・仮定。選択肢にはしない）。
時間の式の分は、閲覧が濃いページでは頭打ち（ページ数 × 1 か月 / T_max）だが、閲覧の薄いページではほぼ閲覧の回数になる
（1 日に数回しか読まれない記事は、読まれるたびに 1 日が過ぎていて作り直す）。記事コミュニティの 1 か月目（2,000 記事・1 記事 1 日 3 回ほど）では
最大寿命の分が約 4.5 万回で、オンデマンドの再生成は約 4.6 万回（更新の分は 300 回。5 分の約 18 万回よりは少ない）。再生成はほぼ最大寿命の分になる。

**オンデマンドの再検証と CDN の無効化**（D-66）: 再検証を呼ぶページの数 = U_r × 1 回の更新で再検証するページ（`onDemandPagesPerUpdate`・既定 1）。
再生成の回数（miss_r）とは別で、閲覧が無くても更新のたびに呼ぶ。`cdn` が `invalidationPathsPerPage` を持ち、ISR のページを期間つきでキャッシュする（`ttlClasses` に document-isr）ときだけ、
`invalidation-paths = 再検証を呼ぶページ × invalidationPathsPerPage` を数える（OpenNext の CloudFront。prd/11 §13.1）。
`cdn` が `invalidationWildcardPathsPerUpdate` を持つ（ワイルドカードでまとめる。D-79）ときは `invalidation-paths = U × その値` とし、更新のたびにルートの全ページがその CDN から消えるとみなす:
CDN の miss = min(閲覧, U × 閲覧 / (U + 閲覧 / ページ数) + 最大寿命の分)（`cdnFlushMissFlow`）。後ろの ISR のキャッシュは消えないので、再生成（miss_r）は変えない。
ゲームでは 1 回の更新で記事のページと一覧の 2 ページ（`ON_DEMAND_PAGES_PER_UPDATE`・仮定）。記事コミュニティの 1 か月目で 300 × 2 = 600 ページ（OpenNext の CloudFront で 1,200 パス）。

**ISR のキャッシュの保存量**（D-66）: `object-storage` の `isrCacheSizeFactor` が正なら、ISR のページの大きさ（ページ数 × 応答の大きさ。`storage.isrPagesGB`）× その倍率を保存する。

**期間つきの CDN の後ろの再生成**（D-55）: ISR のページを期間つきでキャッシュする `cdn`（`ttlClasses` に document-isr）が経路の前にあると、
再生成を起こすのは CDN を miss して ISR を返すノードに届いた閲覧だけ。CDN と ISR の期間は同じ（Next.js は s-maxage に再検証の間隔を付ける）なので、
届いた閲覧はそのつど ISR の期間も切れていて再生成を 1 回起こす: `N(isr-revalidate) = 届いた閲覧 = miss_r の合計`（月は上の式と同じ値・ピークはピークの miss。ピークの再生成の処理も、ルートごとのピークの miss で重み付けしてまとめる `peakRevalidateFlow`。OCL-55732091）。
CDN が無い構成は、再生成を月の数のまま流す（変えていない）。

構成の `cdn` は `ttlClasses` に挙げたクラス、`function` は `cache.classes` に挙げたクラス（Workers の Cache API などコードの中のキャッシュ。
リクエスト・実行の件数は変わらず、ヒットは `hitCpuMs` だけ・次のノードへは miss だけ）でこのヒット率を使う。
キャッシュの後ろへ渡す流れは、ルートごとの miss の件数で重み付けした処理（`ResolvedWorkload.cacheMissFlow`）にする。閲覧の密度と処理の重さがルートで違うと、クラス全体の平均の処理に miss 率を掛けた値とずれるため（OCL-48C8B649）。

- **静的なページのビルドし直し**（Astro の静的出力。D-68・[06](./06-frameworks.md) §6）: Workload の `build`（内容の更新 U（オンデマンドの再検証と同じ U。D-70）・間隔 T・1 回の時間 m 分）から、
  枠 `N = 1 か月 / max(T, m 分)`、回数 `N × (1 − e^(−U / N))`（枠に更新が 1 回でもあれば 1 回。更新は一様に到着すると仮定）、時間 `回数 × ⌈m⌉`。
  経路を持たないノード `ci-build` が `build-minutes`（× `cpusPerBuild`）として数える。

## 3. ComponentKind ごとの変換

各 Kind は「受け取った件数と転送量」から **Usage（汎用リソース）** と **次のノードへ流す件数** を返す。

### 3.1 `cdn`

```
hits(k)    = N_in(k) × hit(k)          misses(k) = N_in(k) − hits(k)   … 保存則: hits + misses = N_in
requests   = Σ N_in(k)
egress     = Σ N_in(k) × size(k)       （クライアントへの転送。edge: CDN→internet に 1 回だけ記録）
origin     = Σ misses(k) × size(k)     （オリジン→CDN の転送。edge: origin→CDN に記録）
次へ流す   = misses(k)
```

キャッシュできないクラス（`api`・個人向けの `document-ssr`）は `hit = 0` に固定し、入力で変えられないようにする。
キャッシュできる中身の API は別のクラス `api-content` にし、ヒット率は §2 の期間つきのキャッシュの式から出す（D-37）。

### 3.2 `static-hosting`

CDN と一体のサービスが多いので、MVP では `cdn` の振る舞い + 「ビルド・デプロイ回数」（Phase 2 以降）として扱う。

### 3.3 `serverless-function`

```
invocations = Σ N_in(k)
cpu-ms      = Σ N_in(k) × cpu(k)
wall-ms     = Σ N_in(k) × (cpu(k) + io(k) + q(k) × rtt(edge→db))   q: 1 リクエストあたりのクエリ数
gb-seconds  = wall-ms / 1000 × メモリ設定(GB)
peak-concurrency = max_h（h の RPS × burst × 平均 wall-ms / 1000）   … リトルの法則
```

- **CPU 課金のサービスと壁時計時間課金のサービスで、I/O 待ち（DB の往復）の効き方が変わる。**
  `rtt` は edge の `boundary` から仮定値を引く（same-provider < cross-provider）。Vercel と Supabase のリージョンが
  離れていると壁時計時間が伸びる、という差がここに出る。
- 1 リクエストあたりの CPU 上限（Limit）を `cpu(k)` が超えたら `LimitBreach`。

### 3.3.1 `container`（Cloud Run 型。D-88・2026-11-02）

コンテナのサービスをリクエストで課金する型。件ごとの CPU・壁時計時間の数え方は §3.3 と同じで、課金はインスタンスが 1 件以上を処理している時間（アクティブ）に掛かる。

```
区間 b（時間帯。§1 の timeBuckets。share_b: 月の流れの割合・S_b: 区間の秒数）ごとに:
x_b                = share_b × Σ N_in(k) × wall(k) / S_b     同時に処理している件数の平均
active_b           = max(1 − e^(−x_b), x_b / concurrency, share_b × cpu-ms / 1000 / S_b / vCPU)
λ_b                = share_b × 前景のリクエストの件数 / S_b

cpu-hours          = Σ_b active_b × hours_b × vCPU         memory-gb-hours も同じ（× メモリ(GB)）
idle-cpu-hours     = Σ_b max(0, minInstances − active_b) × hours_b × vCPU   （メモリも同じ）
cold-start-share   = minInstances = 0 なら Σ_b share_b × e^(−λ_b × idleKeepSeconds)、1 以上なら 0
```

- 1 − e^(−x) は到着をポアソンとみたときに 1 件以上を処理している時間の割合（M/G/∞ の空でない確率）。閲覧が薄いと重ならず ≒ 壁時計時間の合計、
  濃いと同時実行の上限で割った値（x / concurrency）と CPU を使い切る分が下限になる。
- 時間帯（D-89）: 冷えた起動は届いたリクエストの割合なので、区間の件数の割合 share_b で重みづけする（重み 0 の時間帯は件数が無いので入らない）。
  e^(−λT) は凸なので、偏りがあると月の平均の到着率で出すより増える。
- アクティブな時間・待機も同じ区間で積む（月の平均で十分とはしない）。理由: 冷えた起動と同じ区間で数えないと、「夜間はインスタンスが無い」と
  「夜間もアクティブの時間を平均の密度で数える」が食い違う。1 − e^(−x) は凹なので月の平均は高めの側に出る（区間で積むと少し下がり、最小インスタンスの待機はその分増える）。
  max の中の同時実行・CPU の項は線形なので、区間に分けても上回るのは山の時間帯だけ。今のシナリオでは月 $0.1 未満の差（D-89 の表）。
- 区間の中は一定の到着率とみる（区間の境目、たとえば深夜 0 件から朝の最初の 1 件が必ず冷えた起動になる分は数えない。1 日に数件で、閲覧の割合としては無視できる）。
- 時間帯は他のノードに効かせない。容量の判定（VPS の回線・CPU のピーク、DB の同時接続など）は `peakHourFactor` が山を表しているので二重になる。
  止まる DB（Aurora Serverless v2 の 0 ACU・Neon の自動の停止）は D-90 で同じ区間に乗せた（§3.5.1）。
- 裏で走るクラス（ISR の作り直し・一意な変換）はリクエストの件数に数えず、時間には数える。インスタンスの時間の 100 ms の切り上げは数えない。

### 3.3.2 実行ごとのログ（`function`・`container` の `logs`。D-92・2026-11-02）

関数・コンテナは実行のたびに事業者の行（起動・終了・要求ログ）とアプリの出力を書き、ログの取り込みに課金する事業者ではアクセスに比例した費用になる。

```
log-gb     = 前景の実行の件数 × kbPerInvocation × 1000 / 10^9
log-events = 前景の実行の件数 × eventsPerInvocation
```

- 前景の実行の件数は `invocations` と同じ（裏で走るクラスは同じ実行の中なので数えない。コードの中のキャッシュのヒットも関数は起動するので数える）。
- 値は catalog の `stacks/logs.ts` が課金先のプランごとに持つ（ゲーム上の仮定・出典なし）。構成を組み終えた後に関数・コンテナのノードへまとめて差す
  （部品ごとの組み立てで config を差し替えても落ちない）。挙げないプラン（Vercel・Netlify・Workers Free・VPS）はログを数えない（課金が無い）。

| 課金先 | 1 回の実行あたり | 理由 |
|---|---|---|
| Lambda・Amplify の SSR | 0.5 KB | START・END・REPORT の 3 行（RequestId の UUID・実行時間・メモリ。約 0.3 KB）+ アプリのアクセスログ 1 行（約 0.2 KB） |
| Cloud Run | 1.5 KB | 自動の要求ログ（LogEntry の JSON。httpRequest・インスタンスの ID・trace・リソースのラベルで約 1 KB）+ アクセスログ 1 行（stdout の 1 行も LogEntry になり同じラベルが付く。約 0.5 KB）。Cloud Logging は索引の前の LogEntry の大きさで数える |
| Workers Paid | 2 件・1.5 KB | 呼び出しのログ 1 件 + console.log 1 件（Workers Logs は行の数で数える。公式の料金の例も 1 リクエスト 2 件）。2026-12-01 からの Cloudflare Observability は量で数えるので、呼び出しのログ 約 1 KB + console.log 約 0.5 KB とみる（D-94。公式に 1 件の大きさの記載なし） |

- アプリが書くのはどの事業者でも 1 回の実行にアクセスログ 1 行とそろえた（事業者の差は事業者が自動で書く行の差だけにする）。
- 保持（保存）の費用は数えない。CloudWatch Logs は既定で無期限だが保存は圧縮後の量で、12 か月ためても取り込みの 1 割に届かない。Cloud Logging の既定の 30 日は無料（prd/11 §18）。
  例外は Cloudflare Observability（D-94）: 保存を GB 月（各日に問い合わせられる量の最大の和 / 30）で課金するので、`logs.retentionDays` を持つノードは
  `log-gb-month` = 月の取り込み × 保持の日数 / 30 を出す（毎日同じ量を取り込み、保持の日数だけ残る定常の形）。

### 3.4 `serverless-sql`（D1 型）

```
rows-read    = Σ N_in(k) × rowsRead(k)
rows-written = Σ N_in(k) × rowsWritten(k)
storage      = 初期容量 + 増加量 × 経過月      （見積モードは指定月の値。ゲームは月ごとに更新）
```

データベースあたりの容量上限は Limit で判定する。行の読み取り数は**インデックスの効き方で桁が変わる**ため、
テンプレートでは「インデックスあり / なし」の 2 値を用意し、学習上の見どころにする（Phase 2）。

### 3.5 `managed-postgres`（Supabase 型）

課金は主に「コンピュートのサイズ × 時間」「保存容量」「転送量」。行数では課金されない。
容量の判定は `vps` と同じ使用率の考え方（§3.7）を、サイズごとの性能プロファイル（assumption）で行う。

### 3.5.1 止まる DB（`managed-db` の `pauseAfterIdleSeconds`。D-51・D-77・D-90）

Aurora Serverless v2 の 0 ACU（接続が無い時間が既定 300 秒）と Neon の scale to zero（問い合わせが無い時間が既定 5 分）。
動いている時間の割合 awake だけ時間課金（`instance-hours = 730 × capacityUnits × awake`）。

```
λ_b   = share_b × DB に届く件数 / S_b
W     = T + 1 件の処理の時間（busyMs / 件数）           T: pauseAfterIdleSeconds
L     = 1 回の時間帯の長さ（3,600 秒）
p_b   = 直前の時間帯の λ_prev × W・a_b = λ_b × W

asleep_b = [ W × (e^(−a_b) − e^(−p_b)) / (p_b − a_b) + (L − W) × e^(−a_b) ] / L      （W < L のとき）
           W ≥ L なら prev を 2 つ以上たどり、窓の積分が線形に変わる区切り（L ごと）で同じ閉じた形を足す（OCL-C6476435）
awake    = Σ_b (1 − asleep_b) × hours_b / 730
resume   = Σ_b share_b × asleep_b                       止まっている DB に届いて再開を待つ件数の割合

区間が月全体の 1 つ（hourlyProfile なし）: awake = λT / (1 + λT)・resume = 1 / (1 + λT)（D-51 の式のまま）
```

- 時刻 t に止まっている確率は「直前の W 秒に 1 件も届いていない」= e^(−∫λ)。区間の中はポアソンで一定の到着率とみる。コンテナの冷えた起動（§3.3.1）の
  e^(−λ × idleKeepSeconds) と同じ形で、止まる時間の割合と再開を待つ件数の割合が同じ式から出る（区間の中は到着率が一定なので、時間の割合 = 件数の割合）。
- 区間の頭の W 秒は直前の時間帯の到着も窓に入る（夜 0 件の時間帯でも、直前の時間帯に届いていれば W 秒は動いている）。0〜W の窓の積分を閉じた形で足す。
  直前の時間帯は同じ日の種類の中の 1 時間前（0 時の前は同じ種類の 23 時。金曜 23 時 → 土曜 0 時の違いは数えない）。
- 形が無いときは D-51 の λT / (1 + λT) のまま。これは到着率が時間で揺れる分を指数分布で混ぜた e^(−ΛT) の平均と同じ値で、揺れの形が分からないときの近似とみる。
  形を与えたら揺れは区間で表しているので、区間の中は e^(−λW)（揺れを二重に数えない）。このため**平らな形は形なしと一致しない**（コンテナと違う点。形なしの方が止まる側）。
- 再開の待ち（resume）は速さに入れない（D-90）。基準プレイの規模（月 30 万 PV〜）では DB に届く件数の 0.01% 未満（夜に止まった DB を朝の 1 件目が起こすだけ）で、
  コンテナの 5% の閾値に遠く届かない。Neon の再開は数百 ms で冷えた起動より短い。Aurora の再開（約 15 秒）は前提の文で出す。
- 時間帯は課金（動いている時間）だけに使い、同時接続などの容量の判定は `peakHourFactor` のまま。

### 3.6 `object-storage`

```
storage-gb-month = 保存量（保持期間を考慮した平均）
object-writes    = N(image-write) × (1 + 派生画像の数)   （派生 = サイズ違い variants。投稿のときに作る構成だけ。D-83）
object-reads     = N_in(image-read)            （CDN の miss だけが届く）
egress           = object-reads × size(image)  （edge の boundary で無料／有料が分かれる）
```

### 3.7 `vps` と `process`

VPS は**容量を買う**モデル。課金は固定費（＋転送量の超過）で、使用量は使用率として評価する。

```
cpu-util(h)  = Σ_process（h の RPS × burst × cpu(k)）/ 1000 / vCPU 数
mem          = Σ_process 常駐メモリ（MySQL のバッファ・アプリの常駐分。assumption）+ 同時リクエスト × リクエストあたりメモリ
egress-month = Σ クライアントへの転送                 （プランに含まれる転送量との比較）
disk         = DB 容量 + オブジェクトの保存量（VPS に置く場合）+ ログ・OS（assumption）
```

- `process`（nginx・アプリ・MySQL）は `hostedOn` のホストの容量を共有し、それ自体は課金されない。
- 使用率が閾値（assumption）を超えたら `throttle` 相当の劣化、メモリ・ディスクが溢れたら `block` 相当とする。
- API だけを置く VPS（Cloudflare の静的 + VPS の API。D-67）は `storesImages: false` で、ディスクに画像を数えない（画像は R2）。
  経路に載るのは API と投稿だけなので、回線・CPU の使用率と話題の集中（§3.8）も API の分だけになる。
- サーバーから外の API への問い合わせ（Next.js のサーバー → 別の事業者の API。D-67）は、`cdn` の `egressKBPerRequest` で
  1 件あたりの送信を固定の KB で数える（応答の受信は課金されない向き）。

### 3.8 話題・Bot の集中（容量の判定だけ。D-44・2026-11-01）

容量の判定（ホストの CPU・回線のピーク、DB の同時接続、KV の同じキーへの書き込み/秒など `peakHourFactor` を使うもの）は
「月の総量 ÷ 秒 × ピーク係数」で出す。話題・Bot の上乗せ分も月全体に均等に配ると、実際の「1〜2 日に集中する山」が出ない。そこで:

```
N        = 集中しない分の PV（月の PV − Σ E_i）
E_i      = 出来事 i の上乗せ分（factor − 1 の PV）。D_i 日に集中する（ゲーム上の仮定。シナリオのデータ spikeDays）
倍率     = (N + Σ E_i × 30.4 / D_i) / 月の PV      … その日の時間帯の形（ピーク / 平均）はふだんと同じと仮定
peakHourFactor(その月) = ピーク係数 × 倍率
```

- 課金は月の総量のまま（変えない）。容量の前提の当たり方（遅くなる・止まる）は既存の前提のまま。
- 期間つきのキャッシュ（ISR・API の応答・§2）は、ピークの時間帯は 1 ページへの到着率も `peakHourFactor` 倍なので、容量の判定だけ
  ピークのヒット率（`λT × peakHourFactor` で同じ式）で流し直す（`peakCacheHitRate`・`peakCacheMissFlow`。課金は月の平均のヒット率）。
  ISR の再生成の件数（`isr-revalidate`）はピークでも月の値の比例のまま（簡単のため）。
- 置いた値（記事コミュニティ）: 話題（PV × 3・1 か月）は **2 日**、Bot（PV × 2・2 か月）は **7 日**。話題の月のピーク係数の倍率は約 10.5（Bot の月は約 2.7）
  （SPA で OGP の前処理なしは伸びが小さいので約 8.1）。受託のシナリオは繁忙期のピーク × 2（D-33）のままで、集中は入れていない。
- **日次の無料枠・制限の判定にも効かせる**（D-60）: 1 日あたりのプール（`period: 'day'`。Workers Free の 1 日 10 万リクエスト・KV Free の
  1 日 1,000 回の書き込み・D1 Free の 1 日の行の読み書き・Durable Objects Free・Hyperdrive Free の 1 日 10 万クエリ）は、平日・休日の 1 日に加えて
  **月のうち最も多い日** = 平均の日 × 倍率（= N / 30.4 + Σ E_i / D_i）でも判定し、多いほうを使う（Workload の `traffic.peakDayFactor`・`MeterUsage.daily.peakDay`）。
  その日で判定した前提には「話題・Bot の日は、上乗せの量が短い期間に集中すると仮定」を添える（画面は ⓘ）。料金計算（日次の超過の課金・停止の明細）は
  平日・休日のまま（課金は変えない）。資源はどれも PV に比例すると仮定（ISR の再生成など、PV に比例しないものもまとめて倍率を掛ける）。

### 3.9 DB のバックアップ・PITR（`db-backup`。D-93・2026-11-02）

経路を持たないノード。DB の大きさ（`storage.dbGB`）と、月に DB に書く行の数（全クラスの `count × rowsWritten`）から、保持の間に残す量を数える。

```
変更（GB / 月） = 月に書く行 × changeKBPerRow × 1000 / 10^9
残す量          = fullCopies × DB の大きさ + 変更 × retentionDays / 30
backup-gb-month = max(0, 残す量 − 無料の分)     無料の分 = freeUpToDbSize ? max(DB の大きさ, minFreeGB) : 0
backup-hours    = addonHours ? 730 : 0          （時間で課金するアドオン。Supabase の PITR）
```

- 値は catalog の `stacks/backups.ts` が DB ごと・選択（既定 / 延ばす・付ける）ごとに持つ（保持の日数・課金の形は事業者の文書、`changeKBPerRow` 2 KB はゲーム上の仮定）。
  組み終えた構成の経路に載っている DB ごとに 1 つ足す（差し替えの途中の移す先は数えない）。
- 形の例: RDS は全体 1 + 7 日分の差分から割り当て（20 GiB から）を引く。Aurora は保持 7 日でクラスターの大きさを引く。DynamoDB・Firestore の PITR は DB の大きさ（全体 1・差分 0）。
  Neon は窓の間の変更だけ。Cloud SQL は全体 1 + 7 日分の差分（無料の分なし）。VPS の自前は日次のダンプ 7 つ + 7 日分のバイナリログ。
- 料金の値と表は prd/11 §19。

### 3.10 メールの送信（`email-sender`。D-95・2026-11-02）

経路を持たないノード。Workload の `email`（省略は送らない）から月の通数を出し、資源 `emails` に数える。

```
書き込み = PV × ページあたりの API × 1 回あたりの書き込み       （ゲームの内容の更新の数え方と同じ）
emails   = MAU × perMau + 書き込み × perWrite
```

- 値はテンプレートの仮定（記事 `perMau` 0.02・`perWrite` 0.1、受託 `perMau` 10・`perWrite` 0）。SPA・Astro・静的書き出しへの書き換えは書き込みの数を変えない。
- 送り先（Email Service・SES・Resend）は課金先のプランで決まり、catalog の `stacks/email.ts` が構成の最後に 1 つ足す。Resend Free の 1 日 100 通は日次のプール（平日・休日・最も多い日）で判定する。
- 料金の値と表は prd/11 §20。

## 4. 二重計上の点検（テストで確かめる性質）

- CDN の `hits + misses = 入力件数`（各クラス）。
- 転送量は edge ごとに 1 件。同じ edge の転送が 2 つのノードの Usage に載らない。
- `hostedOn` のある process は固定費の明細を作らない。
- 共有プールの無料枠は合算してから引く（[03](./03-pricing-schema.md) §4）。

## 5. 未決（要確認）

- 月内の成長を扱うか（ゲームで月末にユーザー数が倍になる場合など）。MVP は月初の値で代表させる案。→ D-09（暫定）で月初の値に決めた。話題・Bot の月内の集中だけは §3.8 で扱う（D-44・D-60）。
- ~~`burst` の既定値~~ → **D-83（決定済み）**: `burst` は入れない（コードにも無い）。時間より短い山は `peakHourFactor` に含め、
  話題・Bot の集中は §3.8（D-44・D-60）の倍率で表す。§1 の注記のとおり、式の `burst` は `peakHourFactor` と読む。
- ~~画像の派生（サムネイル生成）を `image-write` の処理として数えるか、別のバッチとして数えるか~~ → **D-83（決定済み）**:
  - 記事の一覧などのサムネイルは**サイズ違い（`images.variants`）の 1 つ**として数え、別には数えない。テンプレートの `variants: 3` は
    「サムネイル・本文の幅・大きい表示」の 3 つと読む。1 ページで配る画像の数（`perPage.images`: 記事コミュニティは 5 枚）は
    一覧のサムネイルも含めたページの平均で、一覧のページを別のルートにはしない。配る 1 枚の大きさ（`images.sizeKB`）もサイズ違いを
    混ぜた平均と読む（サムネイルは小さいが、平均で代表させる近似）。
  - 派生を作る処理は `image-write` の処理にも別のバッチにもせず、`image-transform` のクラスで数える。いつ作るかは部品の
    `transformAt`（D-24）で決まる: 閲覧のとき = min(種類 × サイズ違い, 画像の閲覧)・投稿のとき = 投稿数 × サイズ違い（書き込みにも足す）・
    作らない = 0。形式のフォールバック（D-58: 投稿のときに作る構成で WebP・AVIF なら JPEG も作る）はサイズ違いの数を 2 倍にして表す。
  - 投稿のときに作るサイズ違いの保存量は、1 枚を `sizeKB` とみなす（サムネイルの分は多めに数える近似）。値は変えていない。
