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

## 4. 二重計上の点検（テストで確かめる性質）

- CDN の `hits + misses = 入力件数`（各クラス）。
- 転送量は edge ごとに 1 件。同じ edge の転送が 2 つのノードの Usage に載らない。
- `hostedOn` のある process は固定費の明細を作らない。
- 共有プールの無料枠は合算してから引く（[03](./03-pricing-schema.md) §4）。

## 5. 未決（要確認）

- 月内の成長を扱うか（ゲームで月末にユーザー数が倍になる場合など）。MVP は月初の値で代表させる案。
- `burst` の既定値と、スパイク（`spikeMultiplier` × 継続時間）を代表週にどう重ねるか。
- 画像の派生（サムネイル生成）を `image-write` の処理として数えるか、別のバッチとして数えるか。
