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
| `burst` | 時間内のピーク / 平均の比 | assumption |

月は 730 時間（01 §3.3）。週の時間 h の月間件数は `月間件数 × w(h)`、h の平均 RPS は `月間件数 × w(h) / (730 / 168) / 3600`。

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
N(image-transform)         = on-demand なら 画像の種類 × variantsPerImage（変換結果がキャッシュされる前提。再変換率は assumption）
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

ゲームでは U = 月の PV × 1 PV あたりの API の呼び出し × 書き込みの割合（`writesPerCall`）× **ページを変える割合 0.5**
（記事の投稿・編集・ページに出るコメント。いいね・既読などはページを変えない。ゲーム上の仮定 `ON_DEMAND_PAGE_UPDATE_SHARE`）。
記事コミュニティの 1 か月目（30 万 PV）で U = 1.5 万回、5 分の間隔の再生成（約 18 万回）の 1 割未満になる。

**オンデマンドの最大寿命**（D-56）: オンデマンドでも、再検証の呼び出しの取りこぼしに備えて時間の再検証（最大寿命 T_max）を併せて持つとみなし、
その分を足す（閲覧の回数を超えない）:

```
miss_r = min(閲覧_r, U_r × 閲覧_r / (U_r + 閲覧_r) + 閲覧_r / (1 + λ_r × T_max / 1 か月))   （ピークは λ_r を peakHourFactor 倍）
```

ゲームでは T_max = 1 日（`ON_DEMAND_MAX_AGE_SEC`。よく使われる 1 時間〜1 日の長い側・仮定。選択肢にはしない）。
時間の式の分は、閲覧が濃いページでは頭打ち（ページ数 × 1 か月 / T_max）だが、閲覧の薄いページではほぼ閲覧の回数になる
（1 日に数回しか読まれない記事は、読まれるたびに 1 日が過ぎていて作り直す）。記事コミュニティの 1 か月目（2,000 記事・1 記事 1 日 3 回ほど）では
最大寿命の分が約 4.5 万回で、オンデマンドの再生成は約 1.4 万 → 5.9 万回になる（5 分の約 18 万回よりは少ない）。

**期間つきの CDN の後ろの再生成**（D-55）: ISR のページを期間つきでキャッシュする `cdn`（`ttlClasses` に document-isr）が経路の前にあると、
再生成を起こすのは CDN を miss して ISR を返すノードに届いた閲覧だけ。CDN と ISR の期間は同じ（Next.js は s-maxage に再検証の間隔を付ける）なので、
届いた閲覧はそのつど ISR の期間も切れていて再生成を 1 回起こす: `N(isr-revalidate) = 届いた閲覧 = miss_r の合計`（月は上の式と同じ値・ピークはピークの miss。ピークの再生成の処理も、ルートごとのピークの miss で重み付けしてまとめる `peakRevalidateFlow`。OCL-55732091）。
CDN が無い構成は、再生成を月の数のまま流す（変えていない）。

構成の `cdn` は `ttlClasses` に挙げたクラス、`function` は `cache.classes` に挙げたクラス（Workers の Cache API などコードの中のキャッシュ。
リクエスト・実行の件数は変わらず、ヒットは `hitCpuMs` だけ・次のノードへは miss だけ）でこのヒット率を使う。
キャッシュの後ろへ渡す流れは、ルートごとの miss の件数で重み付けした処理（`ResolvedWorkload.cacheMissFlow`）にする。閲覧の密度と処理の重さがルートで違うと、クラス全体の平均の処理に miss 率を掛けた値とずれるため（OCL-48C8B649）。

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

### 3.6 `object-storage`

```
storage-gb-month = 保存量（保持期間を考慮した平均）
object-writes    = N(image-write) × (1 + 派生画像の数)
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

## 4. 二重計上の点検（テストで確かめる性質）

- CDN の `hits + misses = 入力件数`（各クラス）。
- 転送量は edge ごとに 1 件。同じ edge の転送が 2 つのノードの Usage に載らない。
- `hostedOn` のある process は固定費の明細を作らない。
- 共有プールの無料枠は合算してから引く（[03](./03-pricing-schema.md) §4）。

## 5. 未決（要確認）

- 月内の成長を扱うか（ゲームで月末にユーザー数が倍になる場合など）。MVP は月初の値で代表させる案。
- `burst` の既定値。（話題・Bot のスパイクは §3.8 で入れた。D-44）
- 画像の派生（サムネイル生成）を `image-write` の処理として数えるか、別のバッチとして数えるか。
